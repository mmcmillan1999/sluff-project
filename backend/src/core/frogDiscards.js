// backend/src/core/frogDiscards.js
//
// Frog discard strategies. The three discards a Frog bidder buries COUNT
// FOR THE BIDDER at scoring — banked points no defender can touch — which
// turns the control philosophy's liabilities into assets:
//
//   - a hanging 10 (no ace over it, one flimsy guard at most) is bait in
//     the hand and ten banked points in the discard. Matt's zing: lead the
//     9 from 10-9 and one clever defender holds the ace to take the 10.
//   - a void is a ruff, and a ruff CAPTURES the points they lead into it —
//     short-suiting buys the chance to trump their ace or their 10.
//   - a suit stripped to its bare ace is an EFFECTIVE void (Matt's A-J-6
//     example: drop J and 6; the ace takes round one, trump takes their 10
//     when it finally appears).
//
// Registry mirrors bot-brains and bid strategies: sim candidates rotate via
// registerFrogDiscardProfile before a winner becomes the default.

'use strict';

const gameLogic = require('./logic');
const { RANKS_ORDER, CARD_POINT_VALUES } = require('./constants');
const { analyzeControl, controlScore } = require('./bidAdvice');

const rankValue = (card) => RANKS_ORDER.indexOf(gameLogic.getRank(card));
const cardPoints = (cards) => cards.reduce(
    (sum, card) => sum + (CARD_POINT_VALUES[gameLogic.getRank(card)] || 0), 0,
);

// Non-heart suits as ascending-sorted card lists with control facts.
function sideSuits(hand) {
    const suits = { S: [], C: [], D: [] };
    for (const card of hand) {
        const suit = gameLogic.getSuit(card);
        if (suit !== 'H') suits[suit].push(card);
    }
    const facts = {};
    for (const suit of Object.keys(suits)) {
        suits[suit].sort((a, b) => rankValue(a) - rankValue(b));
        const ranks = new Set(suits[suit].map(gameLogic.getRank));
        facts[suit] = {
            cards: suits[suit],
            length: suits[suit].length,
            hasA: ranks.has('A'),
            has10: ranks.has('10'),
        };
    }
    return facts;
}

// Pad to exactly three discards for the pathological nearly-all-hearts hand
// (the engine demands three; the old policy could come up short).
function padWithLowestHearts(hand, discards) {
    if (discards.length >= 3) return discards.slice(0, 3);
    const hearts = hand
        .filter(card => gameLogic.getSuit(card) === 'H' && !discards.includes(card))
        .sort((a, b) => rankValue(a) - rankValue(b));
    return discards.concat(hearts).slice(0, 3);
}

// --- lowest — the original one-liner, locked as the baseline: the three
// lowest-rank non-hearts, whatever they guard or bank.
const policyLowest = (hand) => {
    const sorted = hand
        .filter(card => gameLogic.getSuit(card) !== 'H')
        .sort((a, b) => rankValue(a) - rankValue(b));
    return padWithLowestHearts(hand, sorted.slice(0, 3));
};

// --- matt — the table lore as a rule chain:
//   1) bank hanging 10s (no ace over them, 0-1 guards); a lone guard goes
//      with its 10 when the budget allows (void bonus on top of the bank)
//   2) strip ace suits to their bare ace (effective void)
//   3) void the shortest ownerless suit outright
//   4) filler: keep shortening the same suits, lowest cards first — never
//      aces, never hearts, never the guards of a 10 that stays behind
const policyMatt = (hand) => {
    const discards = [];
    const budget = () => 3 - discards.length;
    const facts = sideSuits(hand);
    const suitsByLength = Object.keys(facts)
        .filter(s => facts[s].length > 0)
        .sort((a, b) => facts[a].length - facts[b].length);

    // 1) Hanging 10s, shortest suits first.
    for (const suit of suitsByLength) {
        const f = facts[suit];
        if (f.hasA || !f.has10 || f.length > 2) continue;
        const ten = f.cards.find(card => gameLogic.getRank(card) === '10');
        if (budget() > 0 && ten) discards.push(ten);
        const guard = f.cards.find(card => gameLogic.getRank(card) !== '10');
        if (budget() > 0 && guard) discards.push(guard);
    }

    // 2) Strip ace suits to the bare ace (or the A-10 core), junk lowest
    //    first — only when the WHOLE junk fits the budget, so the suit
    //    really ends stripped rather than half-plucked.
    for (const suit of suitsByLength) {
        const f = facts[suit];
        if (!f.hasA) continue;
        const junk = f.cards.filter(card => !['A', '10'].includes(gameLogic.getRank(card))
            && !discards.includes(card));
        if (junk.length > 0 && junk.length <= budget()) discards.push(...junk);
    }

    // 3) Void the shortest ownerless suit outright (highest points first
    //    among equals — voiding K-x banks the king too).
    const voidable = suitsByLength
        .filter(suit => !facts[suit].hasA && !facts[suit].has10)
        .filter(suit => {
            const left = facts[suit].cards.filter(card => !discards.includes(card));
            return left.length > 0 && left.length <= budget();
        })
        .sort((a, b) => {
            const la = facts[a].cards.filter(c => !discards.includes(c));
            const lb = facts[b].cards.filter(c => !discards.includes(c));
            return la.length - lb.length || cardPoints(lb) - cardPoints(la);
        });
    for (const suit of voidable) {
        const left = facts[suit].cards.filter(card => !discards.includes(card));
        if (left.length <= budget()) discards.push(...left);
    }

    // 4) Filler: lowest cards from suits without aces or kept 10s.
    if (budget() > 0) {
        const safe = Object.keys(facts)
            .filter(suit => !facts[suit].hasA
                && !(facts[suit].has10 && !discards.includes(
                    facts[suit].cards.find(c => gameLogic.getRank(c) === '10'),
                )))
            .flatMap(suit => facts[suit].cards)
            .filter(card => !discards.includes(card) && gameLogic.getRank(card) !== 'A')
            .sort((a, b) => rankValue(a) - rankValue(b));
        while (budget() > 0 && safe.length > 0) discards.push(safe.shift());
    }
    // Last resort before hearts: any non-heart non-ace.
    if (budget() > 0) {
        const rest = hand
            .filter(card => gameLogic.getSuit(card) !== 'H'
                && gameLogic.getRank(card) !== 'A'
                && !discards.includes(card))
            .sort((a, b) => rankValue(a) - rankValue(b));
        while (budget() > 0 && rest.length > 0) discards.push(rest.shift());
    }
    return padWithLowestHearts(hand, discards);
};

// --- scorer — enumerate every legal 3-card discard set (non-hearts, no
// aces) and score the OUTCOME: banked points, voids created (real and
// bare-ace effective), the control the kept hand retains, and a penalty
// for any 10 left hanging by its own discard.
const policyScorer = (hand) => {
    const candidates = hand.filter(card => gameLogic.getSuit(card) !== 'H'
        && gameLogic.getRank(card) !== 'A');
    if (candidates.length < 3) return policyMatt(hand); // rare degenerate hand
    let best = null;
    for (let i = 0; i < candidates.length - 2; i += 1) {
        for (let j = i + 1; j < candidates.length - 1; j += 1) {
            for (let k = j + 1; k < candidates.length; k += 1) {
                const set = [candidates[i], candidates[j], candidates[k]];
                const kept = hand.filter(card => !set.includes(card));
                const facts = sideSuits(kept);
                const original = sideSuits(hand);
                let voids = 0;
                let bareAces = 0;
                let hangingTens = 0;
                for (const suit of ['S', 'C', 'D']) {
                    const f = facts[suit];
                    if (original[suit].length > 0 && f.length === 0) voids += 1;
                    if (f.length === 1 && f.hasA) bareAces += 1;
                    if (f.has10 && !f.hasA && f.length <= 2) hangingTens += 1;
                }
                const score = cardPoints(set)
                    + 2.2 * voids
                    + 1.6 * bareAces
                    + controlScore(analyzeControl(kept), 'H')
                    - 3 * hangingTens;
                if (!best || score > best.score) best = { set, score };
            }
        }
    }
    return best.set;
};

const FROG_DISCARD_STRATEGIES = {
    lowest: policyLowest,
    matt: policyMatt,
    scorer: policyScorer,
};

// Crowned Aug 6 2026: Matt's rule chain took every brain's frog world from
// red to green (lowest -1.2..-4.4 per frog -> matt +17.8..+20.3, ~70-72%
// made vs ~50%), beating the enumerating scorer in all four. 'lowest'
// stays registered as the locked baseline.
const DEFAULT_FROG_DISCARDS = 'matt';

const FROG_DISCARD_PROFILES = {};

const frogDiscardStrategyFor = (botName) => (
    FROG_DISCARD_STRATEGIES[FROG_DISCARD_PROFILES[botName] || DEFAULT_FROG_DISCARDS]
);

const registerFrogDiscardProfile = (botName, strategyName) => {
    if (!FROG_DISCARD_STRATEGIES[strategyName]) {
        throw new Error(`Unknown frog discard strategy: ${strategyName}`);
    }
    FROG_DISCARD_PROFILES[botName] = strategyName;
};

module.exports = {
    FROG_DISCARD_STRATEGIES,
    DEFAULT_FROG_DISCARDS,
    FROG_DISCARD_PROFILES,
    frogDiscardStrategyFor,
    registerFrogDiscardProfile,
};
