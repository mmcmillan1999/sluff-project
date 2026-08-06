// backend/src/core/midnightSpecial.js
//
// The Midnight Special: the moment a player's SECOND suit becomes the train
// nobody can stop. Decades-old table lore, now a checkable fact — we detect
// it as a proven claim: the player on lead wins every remaining trick no
// matter what the defense does. Defenders MAY still hold trump — the proof
// itself covers extraction: boss trumps pull their trumps by force, and any
// line where a defender could ever take a trick (a higher card in the led
// suit, a forced ruff of a side-suit lead) kills the claim on the spot.
// Strict by design: zero false celebrations.
//
// The proof search is tiny because of two dominance facts:
//   - The leader should always lead the TOP card of a suit (a lower card of
//     the same suit is never a better claim try), so at most one candidate
//     lead per suit.
//   - A defender's best resistance is mechanical: if any legal response
//     BEATS the led card (higher in-suit card, or the must-trump ruff of a
//     side-suit lead) the claim is dead on the spot; otherwise keeping
//     their highest cards is weakly optimal, so they shed the lowest of
//     the suit they must follow — and when discarding, only the CHOICE OF
//     SUIT matters (lowest within it, ≤4 branches).
//
// Fired once per round via engine.midnightSpecialFired.

'use strict';

const gameLogic = require('./logic');
const { RANKS_ORDER } = require('./constants');

const MIN_TRICKS_REMAINING = 3;   // a 2-trick "run" is just cashing out
const NODE_CAP = 200000;          // proof budget; overflow = no celebration

const rankValue = (card) => RANKS_ORDER.indexOf(gameLogic.getRank(card));
const bySuit = (hand) => {
    const suits = {};
    for (const card of hand) {
        const suit = gameLogic.getSuit(card);
        (suits[suit] = suits[suit] || []).push(card);
    }
    for (const suit of Object.keys(suits)) {
        suits[suit].sort((a, b) => rankValue(b) - rankValue(a)); // desc
    }
    return suits;
};

// Can `leaderHand` win every remaining trick against both defenders playing
// their best resistance? Exact within the dominance model above.
const provesClaim = (leaderHand, defenderHands, trumpSuit, budget) => {
    if (budget.nodes > NODE_CAP) { budget.overflow = true; return false; }
    budget.nodes += 1;
    if (leaderHand.length === 0) return true;

    const leaderSuits = bySuit(leaderHand);
    for (const suit of Object.keys(leaderSuits)) {
        const led = leaderSuits[suit][0]; // top of suit — dominant lead
        const ledRank = rankValue(led);

        // Each defender's forced response under best resistance.
        const responses = [];
        let beaten = false;
        for (const hand of defenderHands) {
            const suits = bySuit(hand);
            const following = suits[suit] || [];
            if (following.length > 0) {
                // Must follow. If their best card of the led suit beats the
                // led card (works for trump leads too — a higher trump takes
                // a trump lead), the claim dies here.
                if (rankValue(following[0]) > ledRank) {
                    beaten = true;
                    break;
                }
                responses.push([following[following.length - 1]]); // shed lowest
            } else if (suit !== trumpSuit && (suits[trumpSuit] || []).length > 0) {
                // Void in a side suit while holding trump: the must-trump
                // rule forces a ruff, and any trump beats a side-suit lead.
                beaten = true;
                break;
            } else {
                // Void with nothing forced (no trump, or trump itself was
                // led and they have none): they choose which suit to shed
                // from — every choice must still lose.
                const options = Object.values(suits)
                    .map(cards => cards[cards.length - 1]);
                responses.push(options.length > 0 ? options : [null]);
            }
        }
        if (beaten) continue; // this lead fails; try another suit

        const nextLeader = leaderHand.filter(card => card !== led);
        let allBranchesWin = true;
        for (const shedA of responses[0]) {
            for (const shedB of responses[1] ?? [null]) {
                const nextDefenders = [
                    defenderHands[0].filter(card => card !== shedA),
                    (defenderHands[1] || []).filter(card => card !== shedB),
                ];
                if (!provesClaim(nextLeader, nextDefenders, trumpSuit, budget)) {
                    allBranchesWin = false;
                    break;
                }
            }
            if (!allBranchesWin) break;
        }
        if (allBranchesWin) return true; // one winning lead line suffices
    }
    return false;
};

/**
 * Detect a Midnight Special for the player about to lead. Returns
 * { playerName, tricksRemaining } or null.
 */
const detectMidnightSpecial = (engine) => {
    if (engine.midnightSpecialFired) return null;
    if (engine.insurance?.dealExecuted) return null; // points already settled
    const tricksRemaining = 11 - (engine.tricksPlayedCount || 0);
    if (tricksRemaining < MIN_TRICKS_REMAINING) return null;

    const leaderName = engine.players[engine.trickLeaderId]?.playerName;
    if (!leaderName) return null;
    const leaderHand = engine.hands[leaderName];
    if (!leaderHand || leaderHand.length !== tricksRemaining) return null;

    const trumpSuit = engine.trumpSuit;
    const defenderNames = engine.playerOrder.turnOrder
        .map(id => engine.players[id]?.playerName)
        .filter(name => name && name !== leaderName);
    const defenderHands = defenderNames.map(name => engine.hands[name] || []);

    // The run must ride a second suit — at least two non-trump cards
    // still to play (pure trump cash-outs are not the Special). Defender
    // trump does NOT gate detection: the proof search covers extraction.
    const sideCards = leaderHand.filter(card => gameLogic.getSuit(card) !== trumpSuit);
    if (sideCards.length < 2) return null;

    const budget = { nodes: 0, overflow: false };
    if (!provesClaim(leaderHand, defenderHands, trumpSuit, budget)) return null;

    return { playerName: leaderName, tricksRemaining };
};

module.exports = { detectMidnightSpecial, MIN_TRICKS_REMAINING };
