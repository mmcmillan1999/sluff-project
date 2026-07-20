// backend/src/core/handlers/scoringHandler.js

const gameLogic = require('../logic');
const { ROUND_PRESENTATION_LOCK_MS } = require('../constants');

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
        engine.beginSettlement('normal');
        effects.push({
            type: 'HANDLE_GAME_OVER',
            // Snapshot before the first database await. A reset, reconnect, or
            // socket action cannot mutate the roster used for money or stats.
            payload: engine._createSettlementSnapshot(),
        });
    }

    // Per-game recap entry (public: names and points only) + the durable
    // round_results analytics row. Both capture the insurance negotiation as
    // it stood when the round settled.
    const bidderName = engine.bidWinnerInfo?.playerName;
    const bidderPlayer = Object.values(engine.players).find(p => p.playerName === bidderName);
    const activePlayers = engine.playerOrder.turnOrder.map(id => engine.players[id]).filter(Boolean);
    engine.roundHistory = engine.roundHistory || [];
    const roundEntry = {
        roundNumber: engine.roundHistory.length + 1,
        bidType: roundData.bidType,
        bidderName,
        bidderCardPoints: roundData.finalBidderPoints,
        dealExecuted: Boolean(engine.insurance.dealExecuted),
        pointChanges: { ...roundData.pointChanges },
    };
    engine.roundHistory.push(roundEntry);
    if (engine.gameId) {
        effects.push({
            type: 'LOG_ROUND_RESULT',
            payload: {
                gameId: engine.gameId,
                roundNumber: roundEntry.roundNumber,
                playerMode: engine.playerMode,
                bidType: roundData.bidType,
                bidMultiplier: engine.insurance?.bidMultiplier
                    || { Frog: 1, Solo: 2, 'Heart Solo': 3 }[roundData.bidType] || 1,
                bidderUserId: Number.isInteger(bidderPlayer?.userId) ? bidderPlayer.userId : null,
                bidderIsBot: Boolean(bidderPlayer?.isBot),
                bidderCardPoints: roundData.finalBidderPoints,
                dealExecuted: roundEntry.dealExecuted,
                bidderRequirement: engine.insurance?.bidderRequirement ?? null,
                defenderOffers: { ...(engine.insurance?.defenderOffers || {}) },
                pointChanges: roundEntry.pointChanges,
                allHuman: activePlayers.length > 0 && activePlayers.every(p => !p.isBot),
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
        lastCompletedTrick: engine.lastCompletedTrick,
    };
    engine.startRoundPresentationWindow(ROUND_PRESENTATION_LOCK_MS);

    effects.push({ type: 'SYNC_PLAYER_TOKENS', payload: { playerIds: Object.keys(engine.players) } });
    effects.push({ type: 'BROADCAST_STATE' });
    
    return effects;
}

module.exports = {
    calculateRoundScores,
};
