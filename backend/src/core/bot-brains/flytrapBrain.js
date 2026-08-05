// backend/src/core/bot-brains/flytrapBrain.js
//
// The counting brain plus one table-wise exception: the Venus flytrap of
// 10s. The classic human bait is to lead LOW in a fresh suit while holding
// its 10 — fishing the Ace out so the 10 comes home "safe" next time. This
// brain refuses the bait: the first time a non-trump suit hits the table,
// if it holds the Ace with at most two supporting cards King-and-under
// (note: "King and under" naturally excludes the 10 — holding A AND 10
// means there is nothing to fear), it answers with its LARGEST non-Ace and
// keeps the Ace loaded. When the baiter later cashes their "safe" 10, the
// trap closes.
//
// One stand-down: if the suit's 10 is already on the table this trick, the
// hunt is over — fall through and let the counting brain eat it with the
// Ace. Everything else — leads, trump play, schmears, discards — is the
// counting brain untouched.

'use strict';

const gameLogic = require('../logic');
const { RANKS_ORDER } = require('../constants');
const countingBrain = require('./countingBrain');

const rankValue = (card) => RANKS_ORDER.indexOf(gameLogic.getRank(card));

const flytrapException = (engine, bot) => {
    const leadSuit = engine.leadSuitCurrentTrick;
    if (!leadSuit || leadSuit === engine.trumpSuit) return null;
    if ((engine.currentTrickCards || []).length === 0) return null; // a response, not a lead

    // Only the FIRST time this suit is played: any earlier captured trick
    // containing the suit ends the exception forever.
    const capturedCards = Object.values(engine.capturedTricks || {})
        .flat()
        .flatMap(trick => trick.cards || []);
    if (capturedCards.some(card => gameLogic.getSuit(card) === leadSuit)) return null;

    // The 10 already showed itself — no trap needed, the Ace takes it now.
    if (engine.currentTrickCards.some(play => play.card === `10${leadSuit}`)) return null;

    const hand = engine.hands[bot.playerName] || [];
    const suitCards = hand.filter(card => gameLogic.getSuit(card) === leadSuit);
    const hasAce = suitCards.some(card => gameLogic.getRank(card) === 'A');
    if (!hasAce) return null;
    const support = suitCards.filter(card => gameLogic.getRank(card) !== 'A');
    // "Ace plus 2 or fewer cards, King and under": a bare Ace has nothing
    // else to play, more than two support cards means the suit is long
    // enough to fight normally, and holding the 10 disarms the bait.
    if (support.length === 0 || support.length > 2) return null;
    if (support.some(card => gameLogic.getRank(card) === '10')) return null;

    // Decline the bait with the largest non-Ace; the Ace waits for the 10.
    return [...support].sort((a, b) => rankValue(b) - rankValue(a))[0];
};

const playCard = (engine, bot) => (
    flytrapException(engine, bot) ?? countingBrain.playCard(engine, bot)
);

module.exports = { playCard };
