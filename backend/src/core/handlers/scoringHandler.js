// backend/src/core/handlers/scoringHandler.js

const gameLogic = require('../logic');

/**
 * Calculates the scores at the end of a round and prepares the summary.
 * @param {GameEngine} engine - The instance of the game engine.
 * @returns {Array} An array of effects to be executed.
 */
function calculateRoundScores(engine) {
    const effects = [];
    
    // --- THIS IS THE FIX ---
    // The logic to assign widow points now correctly checks the winner of the last trick.
    
    const bidType = engine.bidWinnerInfo.bid;
    let widowPoints = 0;
    
    // First, determine the value of the widow based on the bid type.
    if (bidType === "Frog") {
        widowPoints = gameLogic.calculateCardPoints(engine.widowDiscardsForFrogBidder);
    } else if (bidType === "Solo" || bidType === "Heart Solo") {
        widowPoints = gameLogic.calculateCardPoints(engine.originalDealtWidow);
    }

    // Now, assign those points to the correct team.
    if (bidType === "Frog") {
        // In a Frog bid, the widow points always belong to the bidder.
        engine.bidderCardPoints += widowPoints;
    } else if (bidType === "Solo" || bidType === "Heart Solo") {
        // For Solo bids, the winner of the LAST trick gets the widow.
        const lastTrickWinnerName = engine.lastCompletedTrick?.winnerName;
        const bidderName = engine.bidWinnerInfo.playerName;
        
        if (lastTrickWinnerName === bidderName) {
            // If the bidder won the last trick, they get the widow points.
            engine.bidderCardPoints += widowPoints;
        } else {
            // If a defender won the last trick, the defenders get the widow points.
            engine.defenderCardPoints += widowPoints;
        }
    }

    // The rest of the function now receives the CORRECTLY assigned totals.
    const bidderTotalCardPoints = engine.bidderCardPoints;
    // --- END FIX ---

    const roundData = gameLogic.calculateRoundScoreDetails({
        ...engine,
        bidderTotalCardPoints, // This value is now correctly calculated
        playerOrderActive: engine.playerOrder.turnOrder
    });

    for (const playerName in roundData.pointChanges) {
        if (engine.scores[playerName] !== undefined) {
            engine.scores[playerName] += roundData.pointChanges[playerName];
        }
    }
    
    const isGameOver = Object.values(engine.scores).some(score => score <= 0);
    
    engine.state = isGameOver ? "Game Over" : "Awaiting Next Round Trigger";

    if (isGameOver) {
        effects.push({
            type: 'HANDLE_GAME_OVER',
            payload: {
                scores: engine.scores,
                theme: engine.theme,
                gameId: engine.gameId,
                players: engine.players,
                // Pass playerOrderActive to handleGameOver
                playerOrderActive: engine.playerOrder.turnOrder.map(id => engine.players[id]),
            },
            onComplete: (gameWinnerName) => {
                engine.roundSummary.gameWinner = gameWinnerName;
            }
        });
    }

    engine.roundSummary = {
        message: isGameOver ? "Game Over!" : roundData.roundMessage,
        finalScores: { ...engine.scores },
        isGameOver,
        gameWinner: null,
        dealerOfRoundId: engine.dealer,
        widowForReveal: roundData.widowForReveal,
        insuranceDealWasMade: engine.insurance.dealExecuted,
        insuranceDetails: engine.insurance.dealExecuted ? engine.insurance.executedDetails : null,
        insuranceHindsight: roundData.insuranceHindsight,
        allTricks: engine.capturedTricks,
        finalBidderPoints: roundData.finalBidderPoints,
        finalDefenderPoints: roundData.finalDefenderPoints,
        pointChanges: roundData.pointChanges,
        widowPointsValue: roundData.widowPointsValue,
        bidType: roundData.bidType,
    };

    effects.push({ type: 'SYNC_PLAYER_TOKENS', payload: { playerIds: Object.keys(engine.players) } });
    effects.push({ type: 'BROADCAST_STATE' });
    
    return effects;
}

module.exports = {
    calculateRoundScores,
};