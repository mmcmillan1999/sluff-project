// backend/src/core/bot-brains/ravenBrain.js
//
// RAVEN — the next-generation brain (Sept 2026).
//
// Ravens count, remember, and plan. This brain plays every card by searching
// the rest of the round:
//
//   1. It samples hidden WORLDS — deals of the unseen cards into the other
//      seats and the widow — from the same public-information boundary the
//      insurance market uses (PublicRoundView: own hand, every card played
//      with seat attribution, the voids the follow/trump rules have proven,
//      the revealed Frog widow). It never reads another hand or the widow.
//   2. In each world it evaluates every genuinely distinct legal card: the
//      early tricks are rolled forward with a fast full-information policy,
//      and the last EXACT_TRICKS tricks are solved EXACTLY — alpha-beta over
//      the bidder's card points with a transposition table shared across the
//      candidates of that world. Late in the round every candidate is scored
//      by an exact solve of the whole remaining position.
//   3. Each world's final bidder points become the round's real payoff for
//      this seat — made bids collect two shares, failed bids pay three, times
//      the bid multiplier — and the card with the best average payoff wins.
//      Defenders' payoff is linear in points, so for them this is simply
//      "minimize the bidder's expected points, exactly"; a bidder is mildly
//      risk-averse around 60, as the scoring table says it should be.
//
// Budget: WORLDS worlds per decision and MAX_NODES solver nodes per world,
// both deterministic, plus a wall-clock guard that stops adding worlds if a
// slow host ever threatens the bot-action window. The Sept 2026 audition
// (scripts/simulate-brains.js, 300-game sweeps from 24 to 120 worlds and
// exact-4 to exact-7) found every budget inside one noise band, so the
// default is the cheap end: 40 worlds, exact from five tricks out — about
// 7 ms median and 50 ms at the 90th percentile per decision on a desktop
// core. Falls back to the counting brain whenever the public view cannot be
// built.

'use strict';

const gameLogic = require('../logic');
const { RANKS_ORDER, CARD_POINT_VALUES, BID_MULTIPLIERS } = require('../constants');
const { getLegalMoves } = require('../legalMoves');
const { buildPublicView } = require('../bot-strategies/PublicRoundView');
const { sampleWorld, makeRng } = require('../bot-strategies/RolloutEstimator');
const countingBrain = require('./countingBrain');
const search = require('./ravenSearch');

const rankValue = (card) => RANKS_ORDER.indexOf(gameLogic.getRank(card));
const pointValue = (card) => CARD_POINT_VALUES[gameLogic.getRank(card)] || 0;

// Env overrides exist for the simulator's tuning runs (RAVEN_WORLDS etc.);
// production runs the literals.
const envNumber = (key, fallback) => {
    const raw = process.env[key];
    const n = raw === undefined || raw === '' ? NaN : Number(raw);
    return Number.isFinite(n) ? n : fallback;
};
const DEFAULTS = {
    worlds: envNumber('RAVEN_WORLDS', 40),            // sampled worlds per decision
    exactTricks: envNumber('RAVEN_EXACT_TRICKS', 5),  // solve exactly once this many tricks remain
    maxNodes: envNumber('RAVEN_MAX_NODES', 60000),    // solver node budget per world (then policy playout)
    timeBudgetMs: envNumber('RAVEN_TIME_MS', 90),     // stop adding worlds past this wall-clock spend
    minWorlds: envNumber('RAVEN_MIN_WORLDS', 8),      // never decide on fewer worlds than this
    // 'clip': a loss beyond my own stack is no worse than busting — the
    // game ends either way — so a seat near zero plays for the make (or the
    // set) rather than for expected points. 'payoff': raw round payoff.
    utility: process.env.RAVEN_UTILITY || 'clip',
};
const config = { ...DEFAULTS };

// Simulator / test hook: tune the search budget without touching the module.
const configure = (overrides = {}) => Object.assign(config, overrides);
const resetConfig = () => Object.assign(config, DEFAULTS);

// Round payoff for THIS seat given the bidder's final card points. Made bids
// collect one share from each defender; failed bids pay a share to each
// defender plus the absorber (3-player) or sitting-out dealer (4-player).
const payoffFor = (isBidder, multiplier, bidderPts) => {
    const diff = bidderPts - 60;
    if (diff === 0) return 0;
    if (isBidder) return diff > 0 ? 2 * multiplier * diff : 3 * multiplier * diff;
    return -multiplier * diff;
};

// Collapse the legal set to distinct choices. Two of my cards are
// interchangeable when they share a point value and every card between them
// in rank is dead: already played or in my own hand. (Unseen cards might be
// in play, so they keep the classes apart.)
const distinctCandidates = (view, legal) => {
    const dead = new Set([...view.playedSet, ...view.myHand]);
    const keep = [];
    const bySuit = {};
    for (const card of [...legal].sort((a, b) => rankValue(a) - rankValue(b))) {
        (bySuit[gameLogic.getSuit(card)] = bySuit[gameLogic.getSuit(card)] || []).push(card);
    }
    for (const suit of Object.keys(bySuit)) {
        let prev = null;
        for (const card of bySuit[suit]) {
            if (prev && pointValue(prev) === pointValue(card)) {
                let live = false;
                for (let r = rankValue(prev) + 1; r < rankValue(card); r += 1) {
                    if (!dead.has(RANKS_ORDER[r] + suit)) { live = true; break; }
                }
                if (!live) { prev = card; continue; }
            }
            keep.push(card);
            prev = card;
        }
    }
    return keep;
};

const handMasks = (cards) => {
    const masks = [0, 0, 0, 0];
    for (const card of cards) {
        const idx = search.cardIdx(card);
        masks[(idx / 9) | 0] |= 1 << (idx % 9);
    }
    return masks;
};

// Translate a sampled world into a search state positioned at this decision.
const buildState = (view, world) => {
    const seats = view.activeNames;
    const hands = seats.map(name => handMasks(world.hands[name]));
    const trump = search.SUIT_IDX[view.trumpSuit];
    const plays = view.partialTrick.map(play => {
        const idx = search.cardIdx(play.card);
        return { p: seats.indexOf(play.playerName), s: (idx / 9) | 0, r: idx % 9 };
    });
    let bonus = 0;
    let lastTrickBonus = 0;
    if (view.bidType === 'Frog') bonus = gameLogic.calculateCardPoints(world.frogDiscards);
    else if (view.bidType === 'Solo') bonus = gameLogic.calculateCardPoints(world.widow);
    else if (view.bidType === 'Heart Solo') lastTrickBonus = gameLogic.calculateCardPoints(world.widow);
    return search.makeState({
        hands,
        trump,
        broken: view.trumpBroken,
        bidder: seats.indexOf(view.bidderName),
        leader: seats.indexOf(view.trickLeaderName),
        plays,
        tricksLeft: search.TRICKS_PER_ROUND - view.tricksPlayed,
        bidderPts: view.bidderCardPoints,
        bonus,
        lastTrickBonus,
    });
};

// Score every candidate across sampled worlds; returns { card, payoff } per
// candidate plus the number of worlds actually used.
const searchCandidates = (view, candidates, rng, now = Date.now) => {
    const me = view.activeNames.indexOf(view.botName);
    const multiplier = BID_MULTIPLIERS[view.bidType] || 1;
    const myStack = Number.isFinite(view.scores?.[view.botName]) ? view.scores[view.botName] : Infinity;
    const floor = config.utility === 'clip' ? -Math.max(0, myStack) : -Infinity;
    const utility = (bidderPts) => Math.max(floor, payoffFor(view.botIsBidder, multiplier, bidderPts));
    const totals = new Array(candidates.length).fill(0);
    const started = now();
    let used = 0;
    for (let w = 0; w < config.worlds; w += 1) {
        if (used >= config.minWorlds && now() - started > config.timeBudgetMs) break;
        const world = sampleWorld(view, rng);
        const st = buildState(view, world);
        const tt = new Map(); // shared by every candidate in this world
        for (let i = 0; i < candidates.length; i += 1) {
            const idx = search.cardIdx(candidates[i]);
            search.applyPlay(st, me, (idx / 9) | 0, idx % 9);
            let closed = null;
            if (st.plays.length === 3) closed = search.closeTrick(st);
            const bidderPts = search.evaluate(st, {
                exactTricks: config.exactTricks,
                maxNodes: config.maxNodes,
                tt,
            });
            if (closed) search.reopenTrick(st, closed);
            search.undoPlay(st);
            totals[i] += utility(bidderPts);
        }
        used += 1;
    }
    return {
        worlds: used,
        results: candidates.map((card, i) => ({ card, payoff: totals[i] / Math.max(1, used) })),
    };
};

const playCard = (engine, bot) => {
    const hand = engine.hands[bot.playerName];
    if (!hand || hand.length === 0) return null;

    const isLeading = engine.currentTrickCards.length === 0;
    const legal = getLegalMoves(hand, isLeading, engine.leadSuitCurrentTrick, engine.trumpSuit, engine.trumpBroken);
    if (legal.length === 0) return null;
    if (legal.length === 1) return legal[0];

    const view = buildPublicView(engine, bot.playerName);
    if (!view) return countingBrain.playCard(engine, bot);

    const candidates = distinctCandidates(view, legal);
    if (candidates.length === 1) return candidates[0];

    const rng = makeRng(Math.floor(Math.random() * 0xFFFFFFFF));
    const { results } = searchCandidates(view, candidates, rng);

    // Best average payoff; ties go to the counting brain's instinct when it
    // is among the tied cards, else the cheapest card.
    let best = results[0];
    for (const r of results) if (r.payoff > best.payoff + 1e-9) best = r;
    const tied = results.filter(r => Math.abs(r.payoff - best.payoff) <= 1e-9);
    if (tied.length > 1) {
        const instinct = countingBrain.playCard(engine, bot);
        const match = tied.find(r => r.card === instinct);
        if (match) return match.card;
        return tied.sort((a, b) => (pointValue(a.card) - pointValue(b.card)) || (rankValue(a.card) - rankValue(b.card)))[0].card;
    }
    return best.card;
};

module.exports = {
    playCard,
    configure,
    resetConfig,
    // exposed for tests
    payoffFor,
    distinctCandidates,
    buildState,
    searchCandidates,
    DEFAULTS,
};
