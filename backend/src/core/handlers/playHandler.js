// backend/src/core/handlers/playHandler.js

const gameLogic = require('../logic');
const { SUITS } = require('../constants');
const scoringHandler = require('./scoringHandler');

function playCard(engine, userId, card) {
    // Playing Phase is the only state in which a card may leave a hand.  This
    // also protects the completed-trick linger and an active draw vote from a
    // late or replayed socket action.
    if (engine.state !== "Playing Phase" || engine.drawRequest?.isActive) return [];
    if (userId !== engine.trickTurnPlayerId) return [];
    const player = engine.players[userId];
    if (!player) return [];
    const hand = engine.hands[player.playerName];
    if (!hand || !hand.includes(card)) return [];
    
    const isLeading = engine.currentTrickCards.length === 0;
    const playedSuit = gameLogic.getSuit(card);
    if (isLeading) {
        if (playedSuit === engine.trumpSuit && !engine.trumpBroken && !hand.every(c => gameLogic.getSuit(c) === engine.trumpSuit)) {
            return [];
        }
    } else {
        const leadCardSuit = engine.leadSuitCurrentTrick;
        const hasLeadSuit = hand.some(c => gameLogic.getSuit(c) === leadCardSuit);
        if (hasLeadSuit && playedSuit !== leadCardSuit) {
            return [];
        }
        if (!hasLeadSuit && hand.some(c => gameLogic.getSuit(c) === engine.trumpSuit) && playedSuit !== engine.trumpSuit) {
            return [];
        }
    }
    
    engine.hands[player.playerName] = hand.filter(c => c !== card);
    engine.currentTrickCards.push({ userId, playerName: player.playerName, card });
    if (isLeading) engine.leadSuitCurrentTrick = playedSuit;
    if (playedSuit === engine.trumpSuit) engine.trumpBroken = true;
    
    // Cards per trick = active players this round (3 in a 4-player game,
    // where the dealer sits out) — NOT total seated players.
    const expectedCardsInTrick = engine.playerOrder.turnOrder.length;
    if (engine.currentTrickCards.length === expectedCardsInTrick) {
        return resolveTrick(engine);
    } else {
        const turnOrder = engine.playerOrder.turnOrder;
        const currentTurnPlayerIndex = turnOrder.indexOf(userId);
        engine.trickTurnPlayerId = turnOrder[(currentTurnPlayerIndex + 1) % expectedCardsInTrick];
        return [{ type: 'BROADCAST_STATE' }];
    }
}

function resolveTrick(engine) {
    const winnerInfo = gameLogic.determineTrickWinner(engine.currentTrickCards, engine.leadSuitCurrentTrick, engine.trumpSuit);
    engine.lastCompletedTrick = { cards: [...engine.currentTrickCards], winnerName: winnerInfo.playerName };
    
    const trickPoints = gameLogic.calculateCardPoints(engine.lastCompletedTrick.cards.map(p => p.card));
    const winnerIsBidder = winnerInfo.playerName === engine.bidWinnerInfo.playerName;
    if (winnerIsBidder) {
        engine.bidderCardPoints += trickPoints;
    } else {
        engine.defenderCardPoints += trickPoints;
    }

    engine.tricksPlayedCount++;
    engine.trickLeaderId = winnerInfo.userId;
    const winnerName = winnerInfo.playerName;
    if (winnerName && !engine.capturedTricks[winnerName]) { engine.capturedTricks[winnerName] = []; }
    if (winnerName) {
        // --- THIS IS THE FIX: Add winnerName to the trick object ---
        engine.capturedTricks[winnerName].push({
            trickNumber: engine.tricksPlayedCount,
            cards: engine.currentTrickCards.map(p => p.card),
            winnerName: winnerName 
        });
    }
    
    if (engine.tricksPlayedCount === 11) {
        return scoringHandler.calculateRoundScores(engine);
    } else {
        engine.state = "TrickCompleteLinger";
        const winnerId = winnerInfo.userId;
        const effects = [
            { type: 'BROADCAST_STATE' },
            { 
                type: 'START_TIMER',
                payload: {
                    duration: 2200, // hold the completed trick so the cards can animate onto the winning pile
                    onTimeout: (engineRef) => {
                        if (engineRef.state === "TrickCompleteLinger") {
                            engineRef.currentTrickCards = [];
                            engineRef.leadSuitCurrentTrick = null;
                            engineRef.trickTurnPlayerId = winnerId;
                            engineRef.state = "Playing Phase";
                            return [{ type: 'BROADCAST_STATE' }];
                        }
                        return [];
                    }
                } 
            }
        ];
        return effects;
    }
}

module.exports = {
    playCard,
};
