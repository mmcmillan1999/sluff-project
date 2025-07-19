// NEW FILE: backend/src/core/handlers/playHandler.js

const gameLogic = require('../logic');
const { SUITS } = require('../constants');
const scoringHandler = require('./scoringHandler');

/**
 * Validates and processes a card play action.
 * @param {GameEngine} engine The game engine instance.
 * @param {number} userId The ID of the user playing the card.
 * @param {string} card The card being played.
 * @returns {Array} An array of effects to be executed.
 */
function playCard(engine, userId, card) {
    if (userId !== engine.trickTurnPlayerId) return [];
    const player = engine.players[userId];
    if (!player) return [];

    const hand = engine.hands[player.playerName];
    if (!hand || !hand.includes(card)) return [];
    
    // --- Card Play Validation ---
    const isLeading = engine.currentTrickCards.length === 0;
    const playedSuit = gameLogic.getSuit(card);
    if (isLeading) {
        if (playedSuit === engine.trumpSuit && !engine.trumpBroken && !hand.every(c => gameLogic.getSuit(c) === engine.trumpSuit)) {
            // TODO: Return an error effect to the specific player
            return [];
        }
    } else {
        const leadCardSuit = engine.leadSuitCurrentTrick;
        const hasLeadSuit = hand.some(c => gameLogic.getSuit(c) === leadCardSuit);
        if (hasLeadSuit && playedSuit !== leadCardSuit) {
             // TODO: Return an error effect
            return [];
        }
        if (!hasLeadSuit && hand.some(c => gameLogic.getSuit(c) === engine.trumpSuit) && playedSuit !== engine.trumpSuit) {
             // TODO: Return an error effect
            return [];
        }
    }
    
    // --- Update Engine State ---
    engine.hands[player.playerName] = hand.filter(c => c !== card);
    engine.currentTrickCards.push({ userId, playerName: player.playerName, card });
    if (isLeading) engine.leadSuitCurrentTrick = playedSuit;
    if (playedSuit === engine.trumpSuit) engine.trumpBroken = true;
    
    const expectedCardsInTrick = engine.playerOrderActive.length;
    if (engine.currentTrickCards.length === expectedCardsInTrick) {
        // If trick is complete, resolve it and return its effects.
        return resolveTrick(engine);
    } else {
        // Otherwise, advance the turn and broadcast the new state.
        const currentTurnPlayerIndex = engine.playerOrderActive.indexOf(userId);
        engine.trickTurnPlayerId = engine.playerOrderActive[(currentTurnPlayerIndex + 1) % expectedCardsInTrick];
        return [{ type: 'BROADCAST_STATE' }];
    }
}


/**
 * Resolves a completed trick, assigning points and determining the next leader.
 * @param {GameEngine} engine The game engine instance.
 * @returns {Array} An array of effects to be executed.
 */
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
                    onTimeout: (engineRef) => { // The service will pass the engine instance back
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