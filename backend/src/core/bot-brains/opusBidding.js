// backend/src/core/bot-brains/opusBidding.js
//
// Opus 5.5's auction: bid by playing the hand out (Sept 2026).
//
// The shared bidder (bidAdvice.js) scores a hand's control with hand-tuned
// weights and bars; trump for a Solo is simply the longest non-heart suit.
// Opus asks the question directly instead. For every contract it could name —
// Frog, Solo in spades, clubs or diamonds, Heart Solo — it deals the cards it
// cannot see (the two other hands and the widow) many times at random, plays
// each deal out with raven's search core (policy rollout, then the last
// tricks solved exactly), and prices the result with the real scoring table:
// a made bid collects two shares, a failed one pays three, times the bid's
// multiplier. It bids the best contract whose expected payoff clears a bar;
// a Solo names the suit that priced best.
//
// Information: the bot's own eleven cards, and nothing else — every other card
// is dealt at random in each world. The Frog widow is dealt too (it is only
// revealed after the auction); in a Frog world the bidder takes it up and
// buries three cards with the shared discard policy before play.
//
// Worlds are played with every hand face up, which flatters whoever plays
// better blind; CALIBRATION subtracts what that flattery was measured to be
// (scripts/calibrate-opus-bids.js), per contract.

'use strict';

const { deck, BID_HIERARCHY, BID_MULTIPLIERS } = require('../constants');
const gameLogic = require('../logic');
const { frogDiscardStrategyFor } = require('../frogDiscards');
const { makeRng } = require('../bot-strategies/RolloutEstimator');
const search = require('./ravenSearch');

const CONTRACTS = [
    { key: 'Frog', bid: 'Frog', trump: 'H' },
    { key: 'Solo S', bid: 'Solo', trump: 'S' },
    { key: 'Solo C', bid: 'Solo', trump: 'C' },
    { key: 'Solo D', bid: 'Solo', trump: 'D' },
    { key: 'Heart Solo', bid: 'Heart Solo', trump: 'H' },
];

// Bidder points the face-up playouts over-state, per bid type.
let CALIBRATION = { Frog: 0, Solo: 0, 'Heart Solo': 0 };
try {
    CALIBRATION = { ...CALIBRATION, ...require(process.env.OPUS_BID_CALIBRATION_PATH || './opusBidCalibration.json').offsets };
} catch (error) { /* uncalibrated */ }

const handMasks = (cards) => {
    const m = [0, 0, 0, 0];
    for (const card of cards) { const idx = search.cardIdx(card); m[(idx / 9) | 0] |= 1 << (idx % 9); }
    return m;
};

const shuffle = (arr, rng) => {
    for (let i = arr.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
};

const payoff = (multiplier, pts) => {
    const diff = pts - 60;
    if (diff === 0) return 0;
    return diff > 0 ? 2 * multiplier * diff : 3 * multiplier * diff;
};

/**
 * Expected bidder payoff of every contract for this hand.
 *   opts { worlds, exactTricks, maxNodes, seed, discardPolicy, calibration }
 * Returns { [key]: { mean, points, made } } — mean payoff, mean bidder points
 * (calibrated), share of worlds made.
 */
function contractValues(hand, opts = {}) {
    const worlds = opts.worlds || 48;
    const exactTricks = opts.exactTricks || 5;
    const maxNodes = opts.maxNodes || 20000;
    const rng = makeRng(opts.seed ?? Math.floor(Math.random() * 0xFFFFFFFF));
    const discard = opts.discardPolicy || frogDiscardStrategyFor('opus');
    const calibration = opts.calibration || CALIBRATION;
    const mine = new Set(hand);
    const unseen = deck.filter(card => !mine.has(card));
    const out = {};
    for (const c of CONTRACTS) out[c.key] = { sumPay: 0, sumPts: 0, made: 0 };

    for (let w = 0; w < worlds; w += 1) {
        const pool = shuffle([...unseen], rng);
        const a = pool.slice(0, 11);
        const b = pool.slice(11, 22);
        const widow = pool.slice(22, 25);
        // Seat order at the table is unknown to the value; alternate it so
        // neither defender is always the one behind the bidder.
        const [left, right] = w % 2 === 0 ? [a, b] : [b, a];
        for (const c of CONTRACTS) {
            let myCards = hand;
            let bonus = 0;
            let lastTrickBonus = 0;
            if (c.bid === 'Frog') {
                const full = [...hand, ...widow];
                const buried = discard(full);
                const buriedSet = new Set(buried);
                myCards = full.filter(card => !buriedSet.has(card));
                bonus = gameLogic.calculateCardPoints(buried);
            } else if (c.bid === 'Solo') {
                bonus = gameLogic.calculateCardPoints(widow);
            } else {
                lastTrickBonus = gameLogic.calculateCardPoints(widow);
            }
            const st = search.makeState({
                hands: [handMasks(myCards), handMasks(left), handMasks(right)],
                trump: search.SUIT_IDX[c.trump],
                broken: false,
                bidder: 0,
                leader: 0,
                plays: [],
                tricksLeft: search.TRICKS_PER_ROUND,
                bidderPts: 0,
                bonus,
                lastTrickBonus,
            });
            const pts = search.evaluate(st, { exactTricks, maxNodes, tt: new Map() }) - (calibration[c.bid] || 0);
            const row = out[c.key];
            row.sumPay += payoff(BID_MULTIPLIERS[c.bid], pts);
            row.sumPts += pts;
            if (pts > 60) row.made += 1;
        }
    }
    const result = {};
    for (const c of CONTRACTS) {
        const row = out[c.key];
        result[c.key] = { bid: c.bid, trump: c.trump, mean: row.sumPay / worlds, points: row.sumPts / worlds, made: row.made / worlds };
    }
    return result;
}

/**
 * The auction decision. `bars` = the expected payoff a contract must clear to
 * be bid, per bid type (a pass is worth about nothing: someone else may bid
 * and I defend, or the hand is thrown in).
 * Returns { bid, trump, values }.
 */
function decide(values, currentHighestBid, bars) {
    const level = currentHighestBid ? BID_HIERARCHY.indexOf(currentHighestBid) : -1;
    let best = null;
    for (const v of Object.values(values)) {
        if (BID_HIERARCHY.indexOf(v.bid) <= level) continue;
        const edge = v.mean - (bars[v.bid] || 0);
        if (edge <= 0) continue;
        if (!best || edge > best.edge) best = { ...v, edge };
    }
    return best ? { bid: best.bid, trump: best.trump } : { bid: 'Pass', trump: null };
}

// Best Solo suit by expected payoff.
function bestSoloSuit(values) {
    let best = null;
    for (const v of Object.values(values)) if (v.bid === 'Solo' && (!best || v.mean > best.mean)) best = v;
    return best ? best.trump : 'C';
}

/**
 * Frog burial by search. `full` = the 14 cards after taking up the widow
 * (the revealed widow is public, so the 22 unseen cards are exactly the two
 * defenders' hands). Every burial of three non-trump, non-ace cards is priced
 * on the same sampled deals (common random numbers: the comparison between two
 * burials is paired), screened on a few deals, and the best few re-priced on
 * more. The shared policy's burial always runs in the final. Returns the three
 * cards.
 *   opts { screenWorlds, finalWorlds, finalists, exactTricks, maxNodes, seed, fallback }
 */
function searchFrogDiscards(full, opts = {}) {
    const screenWorlds = opts.screenWorlds || 12;
    const finalWorlds = opts.finalWorlds || 48;
    const finalists = opts.finalists || 6;
    const exactTricks = opts.exactTricks || 5;
    const maxNodes = opts.maxNodes || 20000;
    const rng = makeRng(opts.seed ?? Math.floor(Math.random() * 0xFFFFFFFF));
    const fallback = opts.fallback || frogDiscardStrategyFor('opus');
    const shared = fallback(full);
    const mine = new Set(full);
    const unseen = deck.filter(card => !mine.has(card));
    const buriable = full.filter(card => gameLogic.getSuit(card) !== 'H' && gameLogic.getRank(card) !== 'A');
    const combos = [];
    for (let i = 0; i < buriable.length; i += 1) {
        for (let j = i + 1; j < buriable.length; j += 1) {
            for (let k = j + 1; k < buriable.length; k += 1) combos.push([buriable[i], buriable[j], buriable[k]]);
        }
    }
    const key = (cards) => [...cards].sort().join(',');
    if (!combos.some(c => key(c) === key(shared))) combos.push(shared);
    if (combos.length <= 1) return shared;

    const deals = (n) => Array.from({ length: n }, (_, w) => {
        const pool = shuffle([...unseen], rng);
        return w % 2 === 0 ? [pool.slice(0, 11), pool.slice(11, 22)] : [pool.slice(11, 22), pool.slice(0, 11)];
    });
    const price = (burial, worlds) => {
        const buried = new Set(burial);
        const hand = handMasks(full.filter(card => !buried.has(card)));
        const bonus = gameLogic.calculateCardPoints(burial);
        let total = 0;
        for (const [left, right] of worlds) {
            const st = search.makeState({
                hands: [hand.slice(), handMasks(left), handMasks(right)],
                trump: search.SUIT_IDX.H, broken: false, bidder: 0, leader: 0, plays: [],
                tricksLeft: search.TRICKS_PER_ROUND, bidderPts: 0, bonus, lastTrickBonus: 0,
            });
            total += payoff(1, search.evaluate(st, { exactTricks, maxNodes, tt: new Map() }));
        }
        return total / worlds.length;
    };
    const screen = deals(screenWorlds);
    const ranked = combos.map(c => ({ c, v: price(c, screen) })).sort((a, b) => b.v - a.v);
    const finals = ranked.slice(0, finalists).map(r => r.c);
    if (!finals.some(c => key(c) === key(shared))) finals.push(shared);
    const final = deals(finalWorlds);
    let best = null;
    for (const c of finals) {
        const v = price(c, final);
        if (!best || v > best.v) best = { c, v };
    }
    return best.c;
}

module.exports = { CONTRACTS, contractValues, decide, bestSoloSuit, payoff, searchFrogDiscards };
