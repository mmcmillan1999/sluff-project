// backend/src/core/bidAdvice.js
// The bidding brain, shared verbatim between the bots (BotPlayer.decideBid)
// and the player-facing bid hint. One evaluator means the advice a player
// taps for can never drift from how the table actually plays — retune the
// thresholds here and both learn it together.
//
// Aug 2026: bidding became a STRATEGY REGISTRY (parallel to bot-brains) so
// bid philosophies can compete offline before any of them touches a live
// table. Two days of production data showed the original points-only tiers
// bleeding badly — 37% of Heart Solos lost, the worst scoring 20 card
// points at 3x — because raw points can't tell two kings and a queen from
// an ace, or a naked 10 from an ace-guarded one. The candidate strategies
// below price CONTROL: aces carry a premium, 10s are near-boss only when
// the same-suit ace clears the way, kings matter guarded or not at all.
//
// DEFAULT_BID_STRATEGY is what every bot (and the player hint) uses unless
// a profile overrides it; the simulator (scripts/simulate-bids.js) rotates
// candidates via registerBidProfile.
'use strict';

const gameLogic = require('./logic');
const { BID_HIERARCHY } = require('./constants');

function analyzeHandForBid(hand) {
    if (!hand || hand.length === 0) return { points: 0, suits: { H: 0, S: 0, C: 0, D: 0 } };
    const points = gameLogic.calculateCardPoints(hand);
    const suits = { H: 0, S: 0, C: 0, D: 0 };
    for (const card of hand) { suits[gameLogic.getSuit(card)]++; }
    return { points, suits };
}

// Per-suit control facts. Rank order is 6<7<8<9<J<Q<K<10<A — the ace is
// boss, the 10 second boss, the king only THIRD (both A and 10 beat it).
function analyzeControl(hand) {
    const bySuit = { H: [], S: [], C: [], D: [] };
    for (const card of hand || []) bySuit[gameLogic.getSuit(card)].push(gameLogic.getRank(card));
    const facts = {};
    for (const suit of Object.keys(bySuit)) {
        const ranks = new Set(bySuit[suit]);
        facts[suit] = {
            length: bySuit[suit].length,
            hasA: ranks.has('A'),
            has10: ranks.has('10'),
            hasK: ranks.has('K'),
        };
    }
    return facts;
}

// The control worth of a hand for a prospective trump suit. Aces are boss
// everywhere; a 10 is near-boss when its own ace clears the only card above
// it, merely guardable with support, and BAIT when short without the ace; a
// king counts only inside the A-10-K lock or lightly guarded. Long trump is
// control the honor count never sees. The weights are a tunable opinion —
// the simulator tournaments them (see the variants below).
const CONTROL_WEIGHTS = {
    ace: 3,
    tenWithAce: 2.5,
    tenGuarded: 1,
    tenNaked: -0.5,
    kingLocked: 1.5,
    kingGuarded: 0.5,
    trumpLength: 0.9,
};

function controlScoreWith(weights, facts, trumpSuit) {
    let score = 0;
    for (const suit of ['H', 'S', 'C', 'D']) {
        const f = facts[suit];
        if (f.hasA) score += weights.ace;
        if (f.has10) {
            score += f.hasA ? weights.tenWithAce
                : (f.length >= 3 ? weights.tenGuarded : weights.tenNaked);
        }
        if (f.hasK) {
            score += (f.hasA && f.has10) ? weights.kingLocked
                : (f.length >= 2 ? weights.kingGuarded : 0);
        }
    }
    score += Math.max(0, facts[trumpSuit].length - 3) * weights.trumpLength;
    return score;
}

const controlScore = (facts, trumpSuit) => controlScoreWith(CONTROL_WEIGHTS, facts, trumpSuit);

// Expected tricks for a prospective trump suit — the bridge-player's read.
// Side suits: aces win now, ace-cleared 10s right behind, guarded 10s
// sometimes, the A-10-K lock adds the king. Trump: the boss chain plus a
// ruff per trump past three, sweetened by voids when trump is long.
function expectedTricks(facts, trumpSuit) {
    let tricks = 0;
    let voids = 0;
    for (const suit of ['H', 'S', 'C', 'D']) {
        if (suit === trumpSuit) continue;
        const f = facts[suit];
        if (f.length === 0) { voids += 1; continue; }
        if (f.hasA) tricks += 1;
        if (f.has10) tricks += f.hasA ? 0.9 : (f.length >= 3 ? 0.4 : 0);
        if (f.hasK && f.hasA && f.has10) tricks += 0.8;
    }
    const t = facts[trumpSuit];
    if (t.hasA) tricks += 1;
    if (t.hasA && t.has10) tricks += 0.95;
    if (t.hasA && t.has10 && t.hasK) tricks += 0.9;
    if (t.has10 && !t.hasA) tricks += t.length >= 3 ? 0.5 : 0;
    tricks += Math.max(0, t.length - 3) * 0.7;
    if (t.length >= 5) tricks += voids * 0.4;
    return tricks;
}

const bestSideSuit = (facts) => ['S', 'C', 'D']
    .reduce((best, suit) => (facts[suit].length > facts[best].length ? suit : best), 'S');

// --- The strategies -----------------------------------------------------
// Each takes the raw hand and answers what it is worth, table unseen.

// points — the original July 2026 tiers (raw card points + suit length),
// kept as the baseline and current production default.
function evaluateHandBidPoints({ points, suits }) {
    if ((points > 30 && suits.H >= 5) || (points > 46 && suits.H >= 4)) {
        return 'Heart Solo';
    }
    if ((points > 34 && (suits.S >= 5 || suits.C >= 5 || suits.D >= 5))
        || (points > 40 && (suits.S >= 4 || suits.C >= 4 || suits.D >= 4))) {
        return 'Solo';
    }
    if ((points > 30 && suits.H >= 4) || (points > 40 && suits.H >= 3)) {
        return 'Frog';
    }
    return 'Pass';
}

const strategyPoints = (hand) => evaluateHandBidPoints(analyzeHandForBid(hand));

// control — bid on the control score alone: the hand must OWN enough of the
// deck for its trump, whatever the honor arithmetic says. Parameterized so
// the simulator can tune the bars; `control` is the tournament-tuned set.
const makeControlStrategy = ({ weights = CONTROL_WEIGHTS, hs, solo5, solo4, frog4, frog3 }) => (hand) => {
    const facts = analyzeControl(hand);
    const heartScore = controlScoreWith(weights, facts, 'H');
    if (facts.H.length >= 5 && heartScore >= hs) return 'Heart Solo';
    const side = bestSideSuit(facts);
    const sideScore = controlScoreWith(weights, facts, side);
    if ((facts[side].length >= 5 && sideScore >= solo5)
        || (facts[side].length === 4 && sideScore >= solo4)) {
        return 'Solo';
    }
    if ((facts.H.length >= 4 && heartScore >= frog4)
        || (facts.H.length === 3 && heartScore >= frog3)) {
        return 'Frog';
    }
    return 'Pass';
};

const strategyControl = makeControlStrategy({ hs: 8.5, solo5: 8, solo4: 9.5, frog4: 6, frog3: 7.5 });
// Tuning variants for the offline tournament only — looser and tighter
// bars around the same scoring.
const strategyControlLoose = makeControlStrategy({ hs: 7.5, solo5: 7, solo4: 8.5, frog4: 5.25, frog3: 6.75 });
const strategyControlTight = makeControlStrategy({ hs: 9.5, solo5: 9, solo4: 10.5, frog4: 6.75, frog3: 8.25 });

// Weight-opinion variants for the tournament. Each re-prices what control
// IS; their thresholds are recalibrated (scripts/calibrate-control.js) so
// every variant bids at the incumbent's volume — the weights alone differ.
const CONTROL_WEIGHTS_A = { // ace-heavy: the ace premium Matt called for
    ace: 3.75, tenWithAce: 2.25, tenGuarded: 0.75, tenNaked: -0.75,
    kingLocked: 1.25, kingGuarded: 0.4, trumpLength: 0.8,
};
const CONTROL_WEIGHTS_B = { // length-heavy: long trump is the real power
    ace: 2.75, tenWithAce: 2.25, tenGuarded: 1, tenNaked: -0.5,
    kingLocked: 1.5, kingGuarded: 0.5, trumpLength: 1.3,
};
const CONTROL_WEIGHTS_C = { // ten-respect: protected 10s near-aces, naked ones punished
    ace: 3, tenWithAce: 2.9, tenGuarded: 1.25, tenNaked: -1,
    kingLocked: 1.75, kingGuarded: 0.5, trumpLength: 0.9,
};
// Bars from scripts/calibrate-control.js (60k hands): each variant bids at
// the incumbent's per-tier volume, so the weights alone differ.
const strategyControlA = makeControlStrategy({ weights: CONTROL_WEIGHTS_A, hs: 9, solo5: 8.25, solo4: 10.5, frog4: 6, frog3: 8.25 });
const strategyControlB = makeControlStrategy({ weights: CONTROL_WEIGHTS_B, hs: 9, solo5: 8.5, solo4: 9.5, frog4: 6.25, frog3: 6.75 });
const strategyControlC = makeControlStrategy({ weights: CONTROL_WEIGHTS_C, hs: 8.75, solo5: 8.25, solo4: 10, frog4: 6.25, frog3: 7.75 });

// tricks — count expected tricks and bid when the hand can plausibly carry
// 60 points on its own (~5.5-6 tricks with points in them). The Frog bar
// sits lower: 1x stakes and the widow adds material.
const strategyTricks = (hand) => {
    // Thresholds calibrated against the trick distribution of 30k random
    // hands: 4.3 sits near p75 of 5-card-trump hands (a real edge without
    // starving the auction), the 4-card Solo needs p90-class strength, and
    // Frog rides lower because the widow adds material at 1x stakes.
    const facts = analyzeControl(hand);
    const heartTricks = expectedTricks(facts, 'H');
    if (facts.H.length >= 5 && heartTricks >= 4.6) return 'Heart Solo';
    const side = bestSideSuit(facts);
    const sideTricks = expectedTricks(facts, side);
    if ((facts[side].length >= 5 && sideTricks >= 4.3)
        || (facts[side].length === 4 && sideTricks >= 5.3)) {
        return 'Solo';
    }
    if (facts.H.length >= 3 && heartTricks >= 3.4) return 'Frog';
    return 'Pass';
};

// guarded — the points tiers with control tripwires: no aces means no bid,
// a Heart Solo needs real heart control and two aces for its 3x stakes, a
// Solo needs its trump owned, and a hand full of naked 10s (bait for the
// ace holders) drops a level.
const strategyGuarded = (hand) => {
    const stats = analyzeHandForBid(hand);
    const facts = analyzeControl(hand);
    const aces = ['H', 'S', 'C', 'D'].filter(s => facts[s].hasA).length;
    if (aces === 0) return 'Pass';
    let bid = evaluateHandBidPoints(stats);
    const nakedTens = ['H', 'S', 'C', 'D']
        .filter(s => facts[s].has10 && !facts[s].hasA && facts[s].length <= 2).length;
    if (bid === 'Heart Solo'
        && !(facts.H.hasA || (facts.H.has10 && facts.H.hasK))) {
        bid = 'Frog';
    }
    if (bid === 'Heart Solo' && aces < 2) bid = 'Frog';
    if (bid === 'Solo') {
        const side = bestSideSuit(facts);
        if (!(facts[side].hasA || (facts[side].has10 && facts[side].hasK))) bid = 'Pass';
    }
    if (nakedTens >= 2) {
        bid = { 'Heart Solo': 'Frog', 'Solo': 'Pass', 'Frog': 'Pass', 'Pass': 'Pass' }[bid];
    }
    return bid;
};

const BID_STRATEGIES = {
    points: strategyPoints,
    control: strategyControl,
    controlLoose: strategyControlLoose,
    controlTight: strategyControlTight,
    controlA: strategyControlA,
    controlB: strategyControlB,
    controlC: strategyControlC,
    tricks: strategyTricks,
    guarded: strategyGuarded,
};

// Crowned by the Aug 6 offline tournament (4 rounds, ~16k games): control
// beat the July points tiers 34.0% vs 31.5% game-win with +25 vs +5 net per
// bid, and its own weight/threshold variants confirmed the incumbent
// settings. 'points' stays in the registry as the reference baseline.
const DEFAULT_BID_STRATEGY = 'control';

// Per-bot overrides, sim-driven for now (mirrors bot-brains BRAIN_PROFILES).
const BID_PROFILES = {};

const bidStrategyNameFor = (botName) => BID_PROFILES[botName] || DEFAULT_BID_STRATEGY;

const registerBidProfile = (botName, strategyName) => {
    if (!BID_STRATEGIES[strategyName]) throw new Error(`Unknown bid strategy: ${strategyName}`);
    BID_PROFILES[botName] = strategyName;
};

// Back-compat shim: the original single evaluator, used by tests and any
// caller that already has {points, suits}. Identical to the points tiers.
function evaluateHandBid(stats) {
    return evaluateHandBidPoints(stats);
}

// The full recommendation for a given strategy: what the hand is worth
// (handBid), and what to actually do given the highest bid already on the
// table (bid) — a hand worth Frog must pass once Solo is taken.
function recommendBidWith(strategyName, hand, currentHighestBid = null) {
    const { points, suits } = analyzeHandForBid(hand);
    const strategy = BID_STRATEGIES[strategyName] || BID_STRATEGIES[DEFAULT_BID_STRATEGY];
    const handBid = strategy(hand);
    const currentLevel = currentHighestBid ? BID_HIERARCHY.indexOf(currentHighestBid) : -1;
    const outbid = handBid !== 'Pass' && BID_HIERARCHY.indexOf(handBid) <= currentLevel;

    // Control facts for the player-facing hint: the copy explains bids the
    // way the evaluator actually reasons — ownership, not point arithmetic.
    const facts = analyzeControl(hand);
    const side = bestSideSuit(facts);
    const suitFacts = ({ length, hasA, has10, hasK }) => ({ length, hasA, has10, hasK });
    const control = {
        aces: ['H', 'S', 'C', 'D'].filter(s => facts[s].hasA).length,
        protectedTens: ['H', 'S', 'C', 'D'].filter(s => facts[s].has10 && facts[s].hasA).length,
        nakedTens: ['H', 'S', 'C', 'D']
            .filter(s => facts[s].has10 && !facts[s].hasA && facts[s].length <= 2).length,
        hearts: suitFacts(facts.H),
        side: { suit: side, ...suitFacts(facts[side]) },
    };

    return {
        bid: outbid ? 'Pass' : handBid,
        handBid,
        points,
        suits,
        control,
        outbid,
    };
}

// The default recommendation — the player-facing hint path (unchanged shape).
function recommendBid(hand, currentHighestBid = null) {
    return recommendBidWith(DEFAULT_BID_STRATEGY, hand, currentHighestBid);
}

// A bot's recommendation, honoring its registered strategy profile.
function recommendBidFor(botName, hand, currentHighestBid = null) {
    return recommendBidWith(bidStrategyNameFor(botName), hand, currentHighestBid);
}

module.exports = {
    analyzeHandForBid,
    analyzeControl,
    controlScore,
    controlScoreWith,
    CONTROL_WEIGHTS,
    CONTROL_WEIGHTS_A,
    CONTROL_WEIGHTS_B,
    CONTROL_WEIGHTS_C,
    makeControlStrategy,
    expectedTricks,
    evaluateHandBid,
    recommendBid,
    recommendBidWith,
    recommendBidFor,
    BID_STRATEGIES,
    DEFAULT_BID_STRATEGY,
    BID_PROFILES,
    bidStrategyNameFor,
    registerBidProfile,
};
