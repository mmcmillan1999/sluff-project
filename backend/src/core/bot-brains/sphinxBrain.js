// backend/src/core/bot-brains/sphinxBrain.js
//
// SPHINX — the oracle brain. (Matt: you asked not to be told the logic;
// stop reading here if you want the blind-tester experience.)
//
// Sphinx doesn't follow rules — it consults futures. For every genuinely
// distinct legal card, it deals the unseen cards into possible worlds
// (consistent with every void the table has revealed, same public-info
// boundary as everything else), plays the round out in each world with a
// fast baseline policy, and picks the card whose futures score best: a
// bidder maximizes its expected card points, a defender minimizes the
// bidder's. Determinized Monte Carlo, the same machinery that prices the
// insurance market, turned into a card player. Budgeted to stay far under
// the live bot-action window.

'use strict';

const gameLogic = require('../logic');
const { RANKS_ORDER, CARD_POINT_VALUES } = require('../constants');
const { getLegalMoves } = require('../legalMoves');
const { buildPublicView } = require('../bot-strategies/PublicRoundView');
const { sampleWorld, makeRng } = require('../bot-strategies/RolloutEstimator');
const countingBrain = require('./countingBrain');

const rankValue = (card) => RANKS_ORDER.indexOf(gameLogic.getRank(card));
const pointValue = (card) => CARD_POINT_VALUES[gameLogic.getRank(card)] || 0;

const WORLDS_PER_CANDIDATE = 14;

// --- Fast baseline policy for the playouts (all seats) ------------------
const isBossIn = (card, playedSet) => {
    const suit = gameLogic.getSuit(card);
    for (let i = RANKS_ORDER.length - 1; i >= 0; i -= 1) {
        const candidate = RANKS_ORDER[i] + suit;
        if (candidate === card) return true;
        if (!playedSet.has(candidate)) return false;
    }
    return false;
};

const policyChoose = (sim, playerName) => {
    const hand = sim.hands[playerName];
    const isLeading = sim.plays.length === 0;
    const legal = getLegalMoves(hand, isLeading, sim.leadSuit, sim.trumpSuit, sim.trumpBroken);
    if (legal.length === 1) return legal[0];
    const byPts = (a, b) => (pointValue(a) - pointValue(b)) || (rankValue(a) - rankValue(b));
    if (isLeading) {
        const bosses = legal.filter(c => isBossIn(c, sim.playedSet));
        if (bosses.length) return bosses.reduce((x, c) => (byPts(c, x) > 0 ? c : x));
        return legal.reduce((x, c) => (byPts(c, x) < 0 ? c : x));
    }
    const winner = gameLogic.determineTrickWinner(sim.plays, sim.leadSuit, sim.trumpSuit);
    const mySide = playerName === sim.bidderName;
    const winnerSide = winner.playerName === sim.bidderName;
    const amLast = sim.plays.length === sim.n - 1;
    if (mySide === winnerSide) {
        if (amLast || (isBossIn(winner.card, sim.playedSet) && gameLogic.getSuit(winner.card) === sim.trumpSuit)) {
            const fat = legal.reduce((x, c) => (byPts(c, x) > 0 ? c : x));
            if (pointValue(fat) > 0) return fat;
        }
        return legal.reduce((x, c) => (byPts(c, x) < 0 ? c : x));
    }
    const beats = legal.filter(card => gameLogic.determineTrickWinner(
        [...sim.plays, { playerName, card }], sim.leadSuit, sim.trumpSuit,
    ).playerName === playerName);
    if (beats.length) return beats.reduce((x, c) => (rankValue(c) < rankValue(x) ? c : x));
    return legal.reduce((x, c) => (byPts(c, x) < 0 ? c : x));
};

// Play one sampled world to the end of the round, with the deciding seat's
// first move forced to `forcedCard`. Returns the bidder's final points.
const playoutForced = (view, world, forcedCard) => {
    const sim = {
        n: view.n,
        activeNames: view.activeNames,
        bidderName: view.bidderName,
        trumpSuit: view.trumpSuit,
        trumpBroken: view.trumpBroken,
        hands: {},
        playedSet: new Set(view.playedSet),
        plays: view.partialTrick.map(p => ({ ...p })),
        leadSuit: view.partialLeadSuit,
        leaderIdx: view.activeNames.indexOf(view.trickLeaderName),
        tricksPlayed: view.tricksPlayed,
        bidderPts: view.bidderCardPoints,
        defenderPts: view.defenderCardPoints,
        lastTrickWinner: null,
    };
    for (const name of view.activeNames) sim.hands[name] = [...world.hands[name]];

    let forcedPending = true;
    while (sim.tricksPlayed < 11) {
        // Malformed state (short hands from an inconsistent snapshot): score
        // what has been played rather than crash the playout.
        if (sim.activeNames.some(name => (sim.hands[name] || []).length === 0)) break;
        while (sim.plays.length < sim.n) {
            const playerName = sim.activeNames[(sim.leaderIdx + sim.plays.length) % sim.n];
            let card;
            if (forcedPending && playerName === view.botName) {
                card = forcedCard;
                forcedPending = false;
            } else {
                card = policyChoose(sim, playerName);
            }
            sim.hands[playerName] = sim.hands[playerName].filter(c => c !== card);
            sim.plays.push({ playerName, card });
            sim.playedSet.add(card);
            if (sim.plays.length === 1) sim.leadSuit = gameLogic.getSuit(card);
            if (gameLogic.getSuit(card) === sim.trumpSuit) sim.trumpBroken = true;
        }
        const winner = gameLogic.determineTrickWinner(sim.plays, sim.leadSuit, sim.trumpSuit);
        const trickPoints = gameLogic.calculateCardPoints(sim.plays.map(p => p.card));
        if (winner.playerName === sim.bidderName) sim.bidderPts += trickPoints;
        else sim.defenderPts += trickPoints;
        sim.lastTrickWinner = winner.playerName;
        sim.leaderIdx = sim.activeNames.indexOf(winner.playerName);
        sim.plays = [];
        sim.leadSuit = null;
        sim.tricksPlayed += 1;
    }

    if (view.bidType === 'Frog') {
        sim.bidderPts += gameLogic.calculateCardPoints(world.frogDiscards);
    } else if (view.bidType === 'Solo') {
        sim.bidderPts += gameLogic.calculateCardPoints(world.widow);
    } else if (view.bidType === 'Heart Solo') {
        const widowPts = gameLogic.calculateCardPoints(world.widow);
        if (sim.lastTrickWinner === view.bidderName) sim.bidderPts += widowPts;
        else sim.defenderPts += widowPts;
    }
    return sim.bidderPts;
};

// Collapse the legal set to genuinely distinct choices: one representative
// per (suit, wins-now, boss, point-class) signature keeps the search tiny
// without losing any strategically different option.
const pruneCandidates = (view, legal, engine, bot) => {
    const plays = engine.currentTrickCards;
    const leadSuit = engine.leadSuitCurrentTrick;
    const winsNow = (card) => plays.length > 0 && gameLogic.determineTrickWinner(
        [...plays, { card, userId: bot.userId, playerName: bot.playerName }],
        leadSuit, view.trumpSuit,
    )?.userId === bot.userId;
    const pointClass = (card) => (pointValue(card) >= 10 ? 'hi' : pointValue(card) > 0 ? 'mid' : 'lo');
    const seen = new Map();
    for (const card of [...legal].sort((a, b) => rankValue(a) - rankValue(b))) {
        const signature = [
            gameLogic.getSuit(card), winsNow(card), isBossIn(card, view.playedSet), pointClass(card),
        ].join('|');
        if (!seen.has(signature)) seen.set(signature, card);
    }
    return [...seen.values()];
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

    const candidates = pruneCandidates(view, legal, engine, bot);
    if (candidates.length === 1) return candidates[0];

    const rng = makeRng(Math.floor(Math.random() * 0xFFFFFFFF));
    // Shared worlds across candidates: comparing futures on the SAME deals
    // removes sampling luck from the comparison itself.
    const worlds = [];
    for (let i = 0; i < WORLDS_PER_CANDIDATE; i += 1) worlds.push(sampleWorld(view, rng));

    let best = candidates[0];
    let bestScore = -Infinity;
    for (const card of candidates) {
        let total = 0;
        for (const world of worlds) total += playoutForced(view, world, card);
        const meanBidderPts = total / worlds.length;
        const score = view.botIsBidder ? meanBidderPts : -meanBidderPts;
        if (score > bestScore) { bestScore = score; best = card; }
    }
    return best;
};

module.exports = { playCard };
