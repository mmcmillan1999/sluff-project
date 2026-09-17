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
// SEPT 2026: the rule above priced the ROUND and lost to the PERSON. In games
// with a human (Aug 20 - Sept 17) humans took 13.1 points a deal off the bots:
// a quote that is fair on average, offered to someone who knows their own hand
// and only says yes when it is wrong in their favour, loses. The default is
// now the 'informed' rule (insurancePricing.js, _informedMove below): post the
// quote that earns the most GIVEN that the other side only accepts what is
// good for them, priced from an estimate corrected for its measured bias and
// overconfidence. scripts/simulate-insurance.js is the harness that chose it:
// against an adversary who strikes whenever a deal suits them the rule above
// loses ~550 points per 100 rounds; the informed rule makes ~+14 on the rounds
// it was tuned on and +12 to +15 on 3,300 it never saw. The rule above stays
// as the rollback: INSURANCE_PRICING=market.
//
// A structural note the estimator prices automatically: a failed bid pays
// three shares (two defenders plus the absorber/sitting dealer) while a made
// bid collects only two, so on a failing bid there is real mutual surplus in
// a deal — the two sides split what the absorber would have taken. Expect
// rational bots to strike deals mostly on failing bids. That is correct play,
// and it is exactly how strong humans use the market.

const { buildPublicView } = require('./PublicRoundView');
const { estimateBidderPoints } = require('./RolloutEstimator');
const { insuranceLimits } = require('../insuranceLimits');
const { informedQuote, estimatorCorrection, INFORMED_VIEW, INFORMED_ESTIMATE } = require('./insurancePricing');
const gameLogic = require('../logic');

// Which rule prices a quote. 'informed' (Sept 2026) assumes the other side
// only accepts what is good for them; 'market' is the Aug 2026 certainty-
// equivalent rule it replaced, kept as the rollback: INSURANCE_PRICING=market.
const DEFAULT_PRICING = process.env.INSURANCE_PRICING === 'market' ? 'market' : 'informed';
// Chosen on the exploitability harness (scripts/simulate-insurance.js). Tried
// beside it: assuming a less informed counterparty (75%, 50% — fewer, fatter
// deals; about the same total), a minimum edge of 3 (too few deals to matter),
// and the raw estimate without the measured correction (still bleeding from
// the bidder's seat).
const INFORMED_COUNTERPARTY = 1;        // assume they know how the round ends
const INFORMED_MIN_EDGE = 1;            // expected points a quote must earn to be a deal the bot wants
// A PRICE ON THE TABLE, TO THE LAST CARD (Sept 17 2026, the same day, in two
// steps). The first live game under the rule above: Matt bid a Heart Solo he
// was making, asked 120, and both bot defenders sat at the default for seven
// tricks — "bots not playing insurance at all". Correct, and no fun: nobody
// can sell a winner to someone who knows it is a winner, so the bots said
// nothing. Step one kept a stingy price up behind a flat 12-point margin and
// still took it down at trick 10. Matt again: "I don't want them to withdraw
// their bid. They should just keep a small margin... Closer to the end of the
// round it should dial in closer and closer." So now:
//   - the bot always shows the friendliest price it can afford (lossBudget: a
//     quarter point per 1x of expected loss per card state, against someone
//     who KNOWS the result);
//   - the margin behind it is sized to what is still unknown — 0.7 of the
//     estimate's spread per share: a dozen points at the deal, when all a bot
//     has is the statistics of its hand; a point or two by the last tricks;
//     nothing once the hand is decided. It never quotes past what the banked
//     points allow, and it quotes to the last card;
//   - it assumes the other side needs a reason to say yes (entice: 2 points
//     per 1x), so the deals that are good for everyone — a bidder going down
//     10 pays 30 on the cards, 26 in a deal, and each defender gets 13 instead
//     of 10 — are offered at a price people take.
// Bots' points per 100 rounds against the harness adversary (knowing 25% / 50%
// / all of the result at the first card) on 3,300 rounds nothing was tuned on,
// and how often that adversary found a deal worth taking:
//                                       strikes at +3        strikes at +1
//     this rule                       +18 /  +9 / +16  44%   +31 / +26 / +45  57%
//     ...entice 1                     +77 / +68 / +77  21%  +126 /+119 /+133  29%
//     ...entice 3                     -99 /-105 / -93  55%   -78 / -82 / -62  59%
//     flat margin 12, down at trick 10 +29 / +25 / +38   6%   +46 / +41 / +56   7%
//     the Aug market rule            -533 /-601 /-510  54%  -460 /-532 /-434  57%
// As many deals as the rule humans were farming, and the bots a little ahead
// instead of 500 behind. Pricing to the end is worth more than it costs: the
// last tricks are where a failing bidder settles, and where a stale or absent
// quote gave that away. A budget that GROWS late (0.25 -> 1.5) was tried and
// bleeds 180-300: late is exactly when the other side knows the most.
// INSURANCE_ALWAYS_QUOTE=false goes back to quoting only what the bot wants.
const INFORMED_LOSS_BUDGET_PER_M = 0.25;
const INFORMED_SAFETY_PER_SD = 0.7;
const INFORMED_ENTICE_PER_M = 2;
const INFORMED_MIN_MOVE_PER_M = 3;      // smaller re-prices are not worth a state emit...
const INFORMED_MIN_MOVE_SHARE = 0.25;   // ...unless the margin itself is small: a quarter of it, never under a point
const DEFAULT_ALWAYS_QUOTE = process.env.INSURANCE_ALWAYS_QUOTE !== 'false';

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
    constructor(pool = null, io = null, { rollouts = 160, pricing = DEFAULT_PRICING, alwaysQuote = DEFAULT_ALWAYS_QUOTE } = {}) {
        this.pool = pool;
        this.io = io;
        this.rollouts = rollouts;
        this.pricing = pricing;
        this.alwaysQuote = alwaysQuote;
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
        if (this.pricing === 'informed') return this._informedMove(engine, bot);
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

            // Nobody offers more points than they hold: when the price this
            // bot would pay runs past its stack it puts up every point but
            // its last, no more (insuranceLimits.js — the engine enforces the
            // same fence, so quoting past it would only be pulled back).
            const limits = insuranceLimits({ multiplier: m, stack: myScore, isBidder });

            if (isBidder) {
                // The ask is the settlement the bidder receives; never quote
                // below the certainty equivalent of just playing. A negative
                // ask means paying to escape a failing bid.
                return { value: clamp(roundTo5(ce + margin), limits.min, limits.max) };
            }

            // Defender: the deal changes this bot's round by -offer, so it is
            // willing to offer at most -ce (negative ce -> pays to cap a loss,
            // positive ce -> demands payment to give up a winning position).
            return { value: clamp(roundTo5(-ce - margin), limits.min, limits.max) };
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

    // The Sept 2026 rule (insurancePricing.informedQuote): price the person on
    // the other side, not only the round. Differences from the rule above
    // that matter at the table:
    //   - with a deal it wants (a failing bidder, mostly) it posts the price
    //     that earns the most from someone who knows their own hand; with none
    //     it still shows a price, a stingy one (see INFORMED_LOSS_BUDGET_PER_M)
    //     — only when even that is off the scale does it sit at the round's
    //     unagreeable default like a player who has not touched insurance;
    //   - it quotes whole points, re-priced on every card to the LAST one. The
    //     old rule stopped updating after trick 8 and left a stale quote
    //     standing for the three tricks in which everyone learns how the round
    //     ends; this one keeps pricing, and its margin shrinks with what is
    //     still unknown, so it homes in on the fair number instead;
    //   - it never quotes past what the banked points allow: with the
    //     defenders on 50, a Frog bidder cannot ask for more than the 20 a
    //     70-50 finish would pay.
    _informedMove(engine, bot) {
        const insurance = engine.insurance;
        const view = buildPublicView(engine, bot.playerName);
        if (!view) return null;
        const isBidder = view.botIsBidder;
        if (!isBidder && !(bot.playerName in insurance.defenderOffers)) return null;

        const m = insurance.bidMultiplier || 1;
        const limits = insuranceLimits({ multiplier: m, stack: view.scores[view.botName], isBidder });
        const unagreeable = isBidder ? limits.max : limits.min;
        const key = `informed|${this._stateKey(engine, bot.playerName)}`;
        const { value: quote, margin } = this._cachedPrice(key, () => {
            const { samples } = estimateBidderPoints(
                { ...view, ...INFORMED_VIEW },
                { rollouts: this.rollouts, seed: seedFrom(key), ...INFORMED_ESTIMATE },
            );
            // What the table can see bounds the result: the bidder keeps what
            // is banked (a Frog bidder knows its own discards too) and cannot
            // touch what the defenders have taken.
            const ownDiscards = isBidder ? (view.frog?.myDiscards || []) : [];
            const bounds = {
                lo: (view.bidderCardPoints || 0) + gameLogic.calculateCardPoints(ownDiscards),
                hi: 120 - (view.defenderCardPoints || 0),
            };
            // Personality is a little more or less appetite for a deal.
            const appetite = this._personality(bot.playerName).marginScale;
            const priced = informedQuote({
                samples,
                m,
                isBidder,
                limits,
                bounds,
                informed: INFORMED_COUNTERPARTY,
                minEdge: INFORMED_MIN_EDGE * appetite,
                entice: INFORMED_ENTICE_PER_M * m,
                lossBudget: this.alwaysQuote ? INFORMED_LOSS_BUDGET_PER_M * m : 0,
                safetyPerSd: INFORMED_SAFETY_PER_SD * appetite,
                correction: estimatorCorrection({ isBidder, bidType: view.bidType, tricksPlayed: view.tricksPlayed }),
            });
            return { value: priced.quote, margin: priced.margin || 0 };
        });

        const current = isBidder ? insurance.bidderRequirement : insurance.defenderOffers[bot.playerName];
        if (quote === current) return null;
        // A standing price re-priced on every card would twitch a point or two
        // each time (and emit state and write an analytics row for it). Moves
        // small beside the margin wait — so early on it takes a few points to
        // move a quote and at the end a single point does; putting a quote up
        // or taking one down never waits.
        const withdrawing = quote === unagreeable || current === unagreeable;
        const worthMoving = Math.max(1, Math.min(INFORMED_MIN_MOVE_PER_M * m, Math.round(margin * INFORMED_MIN_MOVE_SHARE)));
        if (!withdrawing && Math.abs(quote - current) < worthMoving) return null;
        return { settingType: isBidder ? 'bidderRequirement' : 'defenderOffer', value: quote };
    }
}

module.exports = MarketInsuranceStrategy;
