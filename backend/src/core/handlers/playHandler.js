// backend/src/core/handlers/playHandler.js

const gameLogic = require('../logic');
const { SUITS } = require('../constants');
const scoringHandler = require('./scoringHandler');

function playCard(engine, userId, card) {
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
    
    const expectedCardsInTrick = engine.playerOrder.count;
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
    
    // --- NEW: Add the just-played cards to our round tracker ---
    engine.allCardsPlayedThisRound.push(...engine.currentTrickCards.map(p => p.card));
    
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
    if (winnerName) { engine.capturedTricks[winnerName].push(engine.currentTrickCards.map(p => p.card)); }
    
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
                    duration: 1000, 
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