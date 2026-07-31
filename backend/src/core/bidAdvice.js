// backend/src/core/bidAdvice.js
// The bidding brain, shared verbatim between the bots (BotPlayer.decideBid)
// and the player-facing bid hint. One evaluator means the advice a player
// taps for can never drift from how the table actually plays — retune the
// thresholds here and both learn it together.
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

// What the hand itself is worth, ignoring the table. Thresholds tuned July
// 2026 (simulated single-bot rates ~9% HS / 28% Solo / 12% Frog / 52% Pass):
// four hearts only justifies Heart Solo on a premium hand, and a long side
// suit alone doesn't justify Solo on a below-average one. Demoted 4-heart
// hands fall through to Frog.
function evaluateHandBid({ points, suits }) {
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

// The full recommendation: what the hand is worth (handBid), and what to
// actually do given the highest bid already on the table (bid) — a hand
// worth Frog must pass once Solo is taken.
function recommendBid(hand, currentHighestBid = null) {
    const { points, suits } = analyzeHandForBid(hand);
    const handBid = evaluateHandBid({ points, suits });
    const currentLevel = currentHighestBid ? BID_HIERARCHY.indexOf(currentHighestBid) : -1;
    const outbid = handBid !== 'Pass' && BID_HIERARCHY.indexOf(handBid) <= currentLevel;
    return {
        bid: outbid ? 'Pass' : handBid,
        handBid,
        points,
        suits,
        outbid,
    };
}

module.exports = { analyzeHandForBid, evaluateHandBid, recommendBid };
