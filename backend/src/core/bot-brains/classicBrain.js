// backend/src/core/bot-brains/classicBrain.js
//
// The ORIGINAL card-play logic, extracted verbatim from BotPlayer.playCard
// and locked as the A/B control group. Do not "improve" this file: its known
// weaknesses (leads aces blind, wins with its biggest card, schmears only
// from the last seat, never overruffs) are the baseline the counting brain
// is measured against. bot.test.js pins this behavior.

'use strict';

const gameLogic = require('../logic');
const { RANKS_ORDER, CARD_POINT_VALUES } = require('../constants');
const { getLegalMoves } = require('../legalMoves');

const getRankValue = (card) => RANKS_ORDER.indexOf(gameLogic.getRank(card));

const chooseForcedTrump = (trumpCards) => {
    if (trumpCards.length === 2) {
        const trumpTen = trumpCards.find(card => gameLogic.getRank(card) === '10');
        if (trumpTen) return trumpTen;
    }
    return [...trumpCards].sort((a, b) => getRankValue(a) - getRankValue(b))[0];
};

// True only when it is certain the defense already owns this trick:
// the bot is a defender, last to act, and the current winner is the other
// defender.
const fellowDefenderHasTrickLocked = (engine, botName) => {
    const bidderName = engine.bidWinnerInfo?.playerName;
    if (!bidderName || bidderName === botName) return false;
    const trickCards = engine.currentTrickCards || [];
    const isLastToAct = trickCards.length === 2; // three active seats
    if (!isLastToAct) return false;
    const currentWinner = gameLogic.determineTrickWinner(
        trickCards,
        engine.leadSuitCurrentTrick,
        engine.trumpSuit,
    );
    const winnerName = currentWinner?.playerName;
    return Boolean(winnerName) && winnerName !== bidderName && winnerName !== botName;
};

const playCard = (engine, bot) => {
    const hand = engine.hands[bot.playerName];
    if (!hand || hand.length === 0) return null;

    const isLeading = engine.currentTrickCards.length === 0;
    const legalPlays = getLegalMoves(hand, isLeading, engine.leadSuitCurrentTrick, engine.trumpSuit, engine.trumpBroken);
    if (legalPlays.length === 0) return null;

    let cardToPlay;

    if (isLeading) {
        const allPastTricks = Object.values(engine.capturedTricks).flat();
        const allPlayedCards = allPastTricks.flatMap(trick => trick.cards);
        const isAceGone = (suit) => allPlayedCards.includes('A' + suit);

        const aces = legalPlays.filter(card => gameLogic.getRank(card) === 'A');
        if (aces.length > 0) {
            cardToPlay = aces[0];
        } else {
            const safeTens = legalPlays.filter(card => gameLogic.getRank(card) === '10' && isAceGone(gameLogic.getSuit(card)));
            if (safeTens.length > 0) {
                cardToPlay = safeTens[0];
            } else {
                const junkCards = legalPlays.filter(card => CARD_POINT_VALUES[gameLogic.getRank(card)] === 0);
                if (junkCards.length > 0) {
                    cardToPlay = junkCards.sort((a, b) => getRankValue(a) - getRankValue(b))[0];
                } else {
                    cardToPlay = legalPlays.sort((a, b) => CARD_POINT_VALUES[gameLogic.getRank(a)] - CARD_POINT_VALUES[gameLogic.getRank(b)])[0];
                }
            }
        }
    } else {
        const leadSuit = engine.leadSuitCurrentTrick;
        const trumpSuit = engine.trumpSuit;
        const isVoidInLeadSuit = !hand.some(card => gameLogic.getSuit(card) === leadSuit);
        const isForcedToTrumpNonTrumpLead = Boolean(
            leadSuit
            && trumpSuit
            && leadSuit !== trumpSuit
            && isVoidInLeadSuit
            && legalPlays.every(card => gameLogic.getSuit(card) === trumpSuit)
        );

        if (isForcedToTrumpNonTrumpLead) {
            const trumpCards = hand.filter(card => gameLogic.getSuit(card) === trumpSuit);
            cardToPlay = chooseForcedTrump(trumpCards);
        } else if (fellowDefenderHasTrickLocked(engine, bot.playerName)) {
            // Third-seat team play: the trick already belongs to my fellow
            // defender, so take the money — dump the highest-point legal
            // card onto it (Ace before 10).
            cardToPlay = [...legalPlays].sort((a, b) => {
                const pointsDiff = CARD_POINT_VALUES[gameLogic.getRank(b)] - CARD_POINT_VALUES[gameLogic.getRank(a)];
                if (pointsDiff !== 0) return pointsDiff;
                return getRankValue(a) - getRankValue(b);
            })[0];
        } else {
            const winningPlays = legalPlays.filter(myCard => {
                const potentialTrick = [...engine.currentTrickCards, { card: myCard, userId: bot.userId }];
                const winner = gameLogic.determineTrickWinner(potentialTrick, leadSuit, trumpSuit);
                return winner.userId === bot.userId;
            });

            if (winningPlays.length > 0) {
                cardToPlay = winningPlays.sort((a, b) => getRankValue(b) - getRankValue(a))[0];
            } else {
                cardToPlay = legalPlays.sort((a, b) => getRankValue(a) - getRankValue(b))[0];
            }
        }
    }
    return cardToPlay;
};

module.exports = { playCard };
