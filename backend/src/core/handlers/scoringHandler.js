// backend/src/core/handlers/scoringHandler.js

const gameLogic = require('../logic');

function calculateRoundScores(engine) {
    const effects = [];
    
    const bidType = engine.bidWinnerInfo.bid;
    let widowPoints = 0;
    
    // --- THIS LOGIC IS NOW CORRECTED ---
    if (bidType === "Frog") {
        widowPoints = gameLogic.calculateCardPoints(engine.widowDiscardsForFrogBidder);
        // Frog points from discards are added directly to the bidder's captured tricks.
        engine.bidderCardPoints += widowPoints;
    } else if (bidType === "Solo") {
        widowPoints = gameLogic.calculateCardPoints(engine.originalDealtWidow);
        // On a Solo, the widow points ALWAYS go to the bidder, unconditionally.
        engine.bidderCardPoints += widowPoints;
    } else if (bidType === "Heart Solo") {
        widowPoints = gameLogic.calculateCardPoints(engine.originalDealtWidow);
        // ONLY on a Heart Solo does the winner of the last trick get the widow.
        const lastTrickWinnerName = engine.lastCompletedTrick?.winnerName;
        const bidderName = engine.bidWinnerInfo.playerName;
        
        if (lastTrickWinnerName === bidderName) {
            engine.bidderCardPoints += widowPoints;
        } else {
            engine.defenderCardPoints += widowPoints;
        }
    }

    const bidderTotalCardPoints = engine.bidderCardPoints;

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
                scores: engine.scores,
                theme: engine.theme,
                gameId: engine.gameId,
                players: engine.players,
                playerOrderActive: engine.playerOrder.turnOrder.map(id => engine.players[id]),
            },
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
        lastCompletedTrick: engine.lastCompletedTrick 
    };

    effects.push({ type: 'SYNC_PLAYER_TOKENS', payload: { playerIds: Object.keys(engine.players) } });
    effects.push({ type: 'BROADCAST_STATE' });
    
    return effects;
}

module.exports = {
    calculateRoundScores,
};