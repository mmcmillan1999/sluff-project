// backend/src/core/bot-brains/opusBrain.js
//
// OPUS 5.5 (Sept 2026). Plays Courtney M. since Sept 24 2026 (Matt's call,
// BRAIN_PROFILES in index.js); Grandpa George stays on raven-1.2, so the two
// human-paced seats are a live side-by-side in round_results.
//
// Card play is raven-1.2's search. What is new is the auction: every live
// brain bids, picks trump and decides the Frog upgrade with the shared,
// hand-tuned rules (bidAdvice.js, BotPlayer), and Opus instead prices every
// contract by playing the hand out over sampled deals (opusBidding.js). It
// owns decideBid / chooseTrump / decideFrogUpgrade; BotPlayer defers to a
// brain that has them.
//
// Measured (Sept 22 2026, insurance off, all against raven-1.2 in the same
// seat on identical deals — scripts/simulate-seat.js, which pairs the seat's
// whole-round score because a different bid changes who plays):
//   auction alone, bar -10       +1.1 / +2.4 / +2.0 / +2.4 pts a round
//   + searched Frog burial       +2.3 / +4.1 / +3.3 / +3.7 (burial alone
//                                 +1.25 to +1.70, z 6-8)
//   fresh seeds, 12,000 rounds   +2.6 / +3.8 / +3.4 / +3.6 (z 3.8-5.8)
// on tables counting+sphinx / raven-1.2 x2 / sphinx+raven-1.2 /
// coyote+flytrap. Five-brain round robin, 2,400 games (±1.3): opus-5.5 50.8%,
// raven-1.2 42.6%, sphinx 32.2%, coyote 21.4%, counting 19.7%; bids made
// 84.0% vs 78.5%. The bar and the calibration were fitted against bots; human
// defenders are the open question. Think time: the auction 30-75 ms once a
// hand, a Frog burial 0.3-0.7 s.
//
// Also built and kept as an option, OFF: reading the table
// (playInference.js, profile `inference`) — weighting sampled worlds by how
// well they explain the plays seen. It makes the beliefs measurably truer
// (unseen cards placed right 50.9% -> 53.5%, Aces and 10s 56.7% -> 60.7%) and
// the card play no better: 14,400 paired rounds against raven-1.2 on three
// tables, every cell within ±0.3 points.
//
// Information boundary: card play is raven's (PublicRoundView only). The
// auction sees the bot's own eleven cards and the bid on the table; every
// other card is dealt at random in each priced world.

'use strict';

const { createSearchBrain } = require('./ravenBrain');
const { PROFILES: RAVEN_NEXT } = require('./ravenNextBrain');
const opusBidding = require('./opusBidding');
const { frogDiscardStrategyFor } = require('../frogDiscards');

const DEFAULT_PROFILE = {
    play: { ...RAVEN_NEXT['raven-1.2'] },
    bidding: {
        worlds: 48,
        // Expected payoff a contract must clear to be bid, by bid type.
        // Below zero because a pass is not worth zero: someone else may bid
        // and I defend. Swept 0 / -5 / -10 / -15 / -20 on four tables (3,000
        // paired rounds each): -10 is the robust middle (+1.1 to +2.4 pts a
        // round against raven-1.2); weak tables want looser, strong tighter.
        bars: { Frog: -10, Solo: -10, 'Heart Solo': -10 },
        // Frog burial by search (opusBidding.searchFrogDiscards) instead of
        // the shared discard policy.
        searchDiscards: true,
        // Budgets. Both searches run on the server's event loop before the
        // bot's think-time delay starts, so they are kept near raven's own
        // per-card budget. Defaults for exactTricks come from opusBidding.
        // Burial at exact-4 with a smaller screen: 66 ms median, 99 ms p90
        // (the full search: 430 / 660 ms); on 12,000 fresh paired rounds it
        // gives back 0.08-0.17 pts a round (±0.11), inside the noise. The
        // auction stays exact-5 (~60 ms median): exact-4 there cost ~0.4
        // pts a round on the strong tables.
        auction: {},
        discardSearch: { screenWorlds: 6, finalWorlds: 24, finalists: 4, exactTricks: 4 },
        // The Frog bidder facing a Solo: upgrade to Heart Solo when that is
        // worth more than this (passing means defending the Solo).
        upgradeBar: 0,
    },
};

// Simulator tuning: OPUS_PROFILE='{"bidding":{"bars":{"Solo":10}}}' (deep merge).
const merge = (base, over) => {
    const out = { ...base };
    for (const [k, v] of Object.entries(over || {})) {
        out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' ? merge(base[k], v) : v;
    }
    return out;
};

function createOpusBrain(profile = {}) {
    const config = merge(DEFAULT_PROFILE, profile);
    const play = createSearchBrain(config.play);
    // One pricing per dealt hand: the bid, a later re-bid, the trump choice
    // and the upgrade all read the same numbers.
    let cache = { key: null, values: null };
    const valuesFor = (hand) => {
        const key = [...hand].sort().join(',');
        if (cache.key !== key) cache = { key, values: opusBidding.contractValues(hand, { worlds: config.bidding.worlds, ...config.bidding.auction }) };
        return cache.values;
    };
    const handOf = (engine, bot) => engine.hands[bot.playerName] || [];

    return {
        playCard: play.playCard,
        configure: play.configure,
        resetConfig: play.resetConfig,
        config,
        decideBid(engine, bot) {
            const hand = handOf(engine, bot);
            if (hand.length !== 11) return 'Pass';
            const current = engine.currentHighestBidDetails?.bid || null;
            return opusBidding.decide(valuesFor(hand), current, config.bidding.bars).bid;
        },
        chooseTrump(engine, bot) {
            const hand = handOf(engine, bot);
            return opusBidding.bestSoloSuit(valuesFor(hand.length === 11 ? hand : hand.slice(0, 11)));
        },
        submitFrogDiscards(engine, bot) {
            const hand = handOf(engine, bot);
            const fallback = frogDiscardStrategyFor(bot.playerName);
            if (!config.bidding.searchDiscards || hand.length !== 14) return fallback(hand);
            return opusBidding.searchFrogDiscards(hand, { ...config.bidding.discardSearch, fallback });
        },
        decideFrogUpgrade(engine, bot) {
            const hand = handOf(engine, bot);
            if (hand.length !== 11) return 'Pass';
            return valuesFor(hand)['Heart Solo'].mean > config.bidding.upgradeBar ? 'Heart Solo' : 'Pass';
        },
    };
}

const PROFILES = { 'opus-5.5': {} };
const envProfile = (() => { try { return JSON.parse(process.env.OPUS_PROFILE || '{}'); } catch (e) { return {}; } })();

const brains = {};
for (const [name, profile] of Object.entries(PROFILES)) brains[name] = createOpusBrain(merge(profile, envProfile));

module.exports = { brains, PROFILES, createOpusBrain, DEFAULT_PROFILE };
