// backend/src/core/handlers/scoringHandler.js

const gameLogic = require('../logic');

/**
 * Calculates the scores at the end of a round and prepares the summary.
 * @param {GameEngine} engine - The instance of the game engine.
 * @returns {Array} An array of effects to be executed.
 */
function calculateRoundScores(engine) {
    const effects = [];
    
    // --- THIS IS THE CRITICAL LOGIC ---
    // Calculate the total points including the widow before calling the details function.
    const bidType = engine.bidWinnerInfo.bid;
    let widowPoints = 0;
    if (bidType === "Frog") {
        widowPoints = gameLogic.calculateCardPoints(engine.widowDiscardsForFrogBidder);
    } else if (bidType === "Solo" || bidType === "Heart Solo") {
        widowPoints = gameLogic.calculateCardPoints(engine.originalDealtWidow);
    }
    const bidderTotalCardPoints = engine.bidderCardPoints + widowPoints;
    // --- END CRITICAL LOGIC ---

    // Now, we pass the complete engine state, INCLUDING the calculated total, to the logic function.
        const roundData = gameLogic.calculateRoundScoreDetails({
        ...engine,
        bidderTotalCardPoints,
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
                playerOrderActive: engine.playerOrder.turnOrder,
                scores: engine.scores,
                theme: engine.theme,
                gameId: engine.gameId,
                players: engine.players
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