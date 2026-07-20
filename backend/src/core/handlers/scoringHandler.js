// backend/src/core/handlers/scoringHandler.js

const gameLogic = require('../logic');
const { ROUND_PRESENTATION_LOCK_MS } = require('../constants');

// Snapshot the whole negotiation for the round recap. neverNegotiated means
// everyone was still on the server's round defaults (ask 120xM, offers -60xM)
// — the recap soft-suppresses hindsight rather than judging positions nobody
// actually took.
function buildInsuranceDetails(insurance) {
    if (!insurance?.isActive || !insurance.bidMultiplier) return null;
    const defenderOffers = { ...insurance.defenderOffers };
    const offerValues = Object.values(defenderOffers).map(offer => Number(offer) || 0);
    const sumOfOffers = offerValues.reduce((sum, offer) => sum + offer, 0);
    const untouchedAsk = insurance.bidderRequirement === 120 * insurance.bidMultiplier;
    const untouchedOffers = offerValues.length > 0
        && offerValues.every(offer => offer === -60 * insurance.bidMultiplier);
    return {
        bidMultiplier: insurance.bidMultiplier,
        bidderPlayerName: insurance.bidderPlayerName,
        bidderRequirement: insurance.bidderRequirement,
        defenderOffers,
        sumOfOffers,
        gapToDeal: insurance.bidderRequirement - sumOfOffers,
        neverNegotiated: untouchedAsk && untouchedOffers,
        agreement: insurance.dealExecuted ? (insurance.executedDetails?.agreement ?? null) : null,
    };
}

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

    engine.roundSummary = {
        message: isGameOver ? "Game Over!" : roundData.roundMessage,
        finalScores: { ...engine.scores },
        isGameOver,
        gameWinner: null,
        dealerOfRoundId: engine.dealer,
        widowForReveal: roundData.widowForReveal,
        insuranceDealWasMade: engine.insurance.dealExecuted,
        // Full negotiation snapshot: the recap must not depend on the live
        // insurance state surviving a reconnect or the next round's reset.
        insuranceDetails: buildInsuranceDetails(engine.insurance),
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
