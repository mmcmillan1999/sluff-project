// backend/src/core/bot-strategies/MarketInsuranceStrategy.js
//
// Prices the insurance market from a Monte Carlo estimate of the bidder's
// final card points, using only information a human in the seat could have
// (see PublicRoundView). One rule for every branch the old strategy hard-
// coded: quote your certainty-equivalent value, shaded in your favor by a
// margin that decays as the round resolves.
//
// The engine auto-executes the moment ask <= sum(offers), so quoting true
// value IS the defense: a defender beating the bidder posts a negative offer
// (a demand), which closes the "failing bidder drops the ask to 0 and
// escapes for free" leak; a dominating bidder's ask tracks the projected
// exchange, which closes the "winning bot asks for 5" leak.
//
// A structural note the estimator prices automatically: a failed bid pays
// three shares (two defenders plus the absorber/sitting dealer) while a made
// bid collects only two, so on a failing bid there is real mutual surplus in
// a deal — the two sides split what the absorber would have taken. Expect
// rational bots to strike deals mostly on failing bids. That is correct play,
// and it is exactly how strong humans use the market.

const { buildPublicView } = require('./PublicRoundView');
const { estimateBidderPoints } = require('./RolloutEstimator');

const NO_QUOTE_AFTER_TRICK = 8;   // parity with the legacy strategy
const MIN_EMIT_DELTA = 5;         // engine granularity
const MAX_CACHED_QUOTES = 512;    // ~a few dozen live tables' worth of rounds
const roundTo5 = v => Math.round(v / 5) * 5;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// FNV-1a: a stable 32-bit seed from the public-state key, so the same board
// always samples the same worlds and a bot's quote cannot wobble on nothing.
function seedFrom(text) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
}

class MarketInsuranceStrategy {
    constructor(pool = null, io = null, { rollouts = 160 } = {}) {
        this.pool = pool;
        this.io = io;
        this.rollouts = rollouts;
        // The estimator used to run fresh on every 1.5 s heartbeat while a
        // human thought, with a fresh random seed each time. Its sampling
        // noise exceeded MIN_EMIT_DELTA, so quotes drifted 15 points on an
        // unchanged board, every drift emitted state and wrote an analytics
        // row, and ~30 ms of synchronous work per bot per tick went nowhere.
        // Now: one price per public state, seeded by that state.
        this._quoteCache = new Map();
    }

    // Everything public that can change the estimate. Offers are left out on
    // purpose: they change whether we emit, not what we think it is worth.
    _stateKey(engine, botName) {
        const trick = (engine.currentTrickCards || []).map(c => c?.card ?? '').join(',');
        return [
            engine.gameId ?? 'g',
            engine.roundHistory?.length ?? 0,
            botName,
            engine.tricksPlayedCount ?? 0,
            (engine.allCardsPlayedThisRound || []).length,
            trick,
            engine.trumpSuit ?? '',
            engine.bidWinnerInfo?.bid ?? '',
            engine.bidWinnerInfo?.playerName ?? '',
            (engine.hands?.[botName] || []).join(','),
            // Scores drive risk appetite and the never-eliminate-yourself floor.
            JSON.stringify(engine.scores || {}),
        ].join('|');
    }

    _cachedPrice(key, compute) {
        if (this._quoteCache.has(key)) return this._quoteCache.get(key);
        const priced = compute();
        this._quoteCache.set(key, priced);
        if (this._quoteCache.size > MAX_CACHED_QUOTES) {
            this._quoteCache.delete(this._quoteCache.keys().next().value);
        }
        return priced;
    }

    // Personality shapes negotiation style only — every bot shares the same
    // (correct) estimator. Same name-hash the legacy strategy used.
    _personality(botName) {
        const nameHash = botName.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
        const offset = (nameHash % 20) - 10;                 // -10 .. 9
        return {
            marginScale: 1 + offset * 0.025,                 // 0.75 .. 1.225
            lambdaShift: offset * 0.005,                     // -0.05 .. 0.045
        };
    }

    // Risk appetite from game context: protect a lead, gamble from behind.
    _lambda(view, personality) {
        const myScore = view.scores[view.botName];
        const others = view.activeNames
            .filter(name => name !== view.botName)
            .map(name => view.scores[name])
            .filter(Number.isFinite);
        const lead = Number.isFinite(myScore) && others.length > 0
            ? myScore - Math.max(...others)
            : 0;
        return clamp(0.12 + lead / 500 + personality.lambdaShift, -0.05, 0.4);
    }

    // Shading over fair value: a fraction of the outcome's remaining
    // uncertainty, decaying as tricks resolve. Proportional to sd rather
    // than flat so early quotes are stingy without pricing every trade —
    // especially the mutually-profitable failing-bid escapes — out of the
    // market entirely.
    _margin(view, sd, personality) {
        const t = view.tricksPlayed;
        const decay = Math.max(0, NO_QUOTE_AFTER_TRICK - t) / NO_QUOTE_AFTER_TRICK;
        return 0.45 * sd * decay * personality.marginScale + 3;
    }

    /**
     * Same contract as the legacy strategies:
     * returns { settingType, value } or null.
     */
    calculateInsuranceMove(engine, bot) {
        const insurance = engine.insurance;
        if (!insurance?.isActive || insurance.dealExecuted) return null;
        if (engine.tricksPlayedCount >= NO_QUOTE_AFTER_TRICK) return null;

        const view = buildPublicView(engine, bot.playerName);
        if (!view) return null;
        const isBidder = view.botIsBidder;
        // A seated player outside the round (4-player sitting dealer) is not
        // a party to insurance.
        if (!isBidder && !(bot.playerName in insurance.defenderOffers)) return null;

        const m = insurance.bidMultiplier || 1;
        const key = this._stateKey(engine, bot.playerName);
        const { value: quote } = this._cachedPrice(key, () => {
            const { samples } = estimateBidderPoints(view, { rollouts: this.rollouts, seed: seedFrom(key) });

            // Per-sample point change for this bot under the no-deal card
            // exchange: surplus S = pts - 60; a made bid pays the bidder 2*S*m
            // (each active defender pays S*m); a failed bid costs the bidder
            // 3*|S|*m (defenders and the absorber/sitting dealer each collect).
            const myDeltas = samples.map(pts => {
                const surplus = pts - 60;
                if (surplus === 0) return 0;
                if (isBidder) return surplus > 0 ? 2 * surplus * m : 3 * surplus * m;
                return -surplus * m;
            });
            const mean = myDeltas.reduce((s, v) => s + v, 0) / myDeltas.length;
            const sd = Math.sqrt(
                myDeltas.reduce((s, v) => s + (v - mean) * (v - mean), 0)
                / Math.max(1, myDeltas.length - 1),
            );

            const personality = this._personality(bot.playerName);
            const lambda = this._lambda(view, personality);
            const margin = this._margin(view, sd, personality);
            // Certainty equivalent of playing the round out.
            const ce = mean - lambda * sd;
            const myScore = view.scores[view.botName];

            if (isBidder) {
                // The ask is the settlement the bidder receives; never quote
                // below the certainty equivalent of just playing.
                let ask = roundTo5(ce + margin);
                // A negative ask means paying to escape a failing bid; never pay
                // yourself out of the game.
                if (Number.isFinite(myScore)) ask = Math.max(ask, roundTo5(-(myScore - 5)));
                return { value: clamp(ask, -120 * m, 120 * m) };
            }

            // Defender: the deal changes this bot's round by -offer, so it is
            // willing to offer at most -ce (negative ce -> pays to cap a loss,
            // positive ce -> demands payment to give up a winning position).
            let offer = roundTo5(-ce - margin);
            // Never pay yourself out of the game to settle a round.
            if (Number.isFinite(myScore)) offer = Math.min(offer, roundTo5(myScore - 5));
            return { value: clamp(offer, -60 * m, 60 * m) };
        });

        if (isBidder) {
            const current = insurance.bidderRequirement ?? 0;
            if (Math.abs(quote - current) >= MIN_EMIT_DELTA) {
                return { settingType: 'bidderRequirement', value: quote };
            }
            return null;
        }

        const offer = quote;
        const current = insurance.defenderOffers[bot.playerName] ?? 0;
        if (Math.abs(offer - current) >= MIN_EMIT_DELTA) {
            return { settingType: 'defenderOffer', value: offer };
        }
        return null;
    }
}

module.exports = MarketInsuranceStrategy;
