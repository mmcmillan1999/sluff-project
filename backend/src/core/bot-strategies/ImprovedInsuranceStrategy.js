// backend/src/core/bot-strategies/ImprovedInsuranceStrategy.js

const gameLogic = require('../logic');
const { BID_MULTIPLIERS } = require('../constants');

/**
 * Improved insurance strategy based on actual game state and realistic projections
 */
function calculateInsuranceMove(engine, bot) {
    const { insurance, bidWinnerInfo, hands, bidderCardPoints, defenderCardPoints, tricksPlayedCount, capturedTricks } = engine;
    const bidMultiplier = BID_MULTIPLIERS[bidWinnerInfo.bid] || 1;
    const isBidder = bot.playerName === bidWinnerInfo.playerName;
    const numberOfOpponents = engine.playerOrder.count - 1;
    const GOAL = 60;
    const TOTAL_POINTS = 120; // Total points in deck

    // CRITICAL: No insurance changes after trick 8
    // By trick 9-11, there's too little uncertainty left
    if (tricksPlayedCount >= 8) {
        return null; // DO NOT CHANGE INSURANCE THIS LATE
    }

    // Calculate remaining points in play
    const pointsCapturedSoFar = bidderCardPoints + defenderCardPoints;
    const pointsRemaining = TOTAL_POINTS - pointsCapturedSoFar;
    const tricksRemaining = 11 - tricksPlayedCount;
    
    // Analyze hand strength (high cards, trump, etc.)
    const myHand = hands[bot.playerName] || [];
    const pointsInMyHand = gameLogic.calculateCardPoints(myHand);
    
    // Count high cards (Aces and 10s) and trump in hand
    const highCards = myHand.filter(card => {
        const rank = card.slice(0, -1);
        return rank === 'A' || rank === '10';
    }).length;
    
    const trumpCards = myHand.filter(card => {
        const suit = card.slice(-1);
        return suit === engine.trumpSuit;
    }).length;
    
    // Estimate capture rate based on hand strength
    let myCaptureRate;
    if (isBidder) {
        // Bidder advantages: leads tricks, chose trump
        const baseRate = 0.5; // Base 50% of remaining points
        const highCardBonus = highCards * 0.05; // +5% per high card
        const trumpBonus = trumpCards * 0.03; // +3% per trump
        const positionBonus = tricksRemaining > 0 ? 0.1 : 0; // +10% for leading
        myCaptureRate = Math.min(0.85, baseRate + highCardBonus + trumpBonus + positionBonus);
    } else {
        // Defenders share the remaining points
        const baseRate = 0.5 / numberOfOpponents; // Split evenly among defenders
        const highCardBonus = highCards * 0.03; // Less impact as defender
        const trumpBonus = trumpCards * 0.02;
        myCaptureRate = Math.min(0.4, baseRate + highCardBonus + trumpBonus);
    }
    
    // Project final score based on current trajectory and hand strength
    const projectedRemainingCapture = pointsRemaining * myCaptureRate;
    const projectedFinalScore = isBidder ? 
        (bidderCardPoints + projectedRemainingCapture) :
        (defenderCardPoints + projectedRemainingCapture * numberOfOpponents);
    
    // Calculate current trajectory (are we on track?)
    const progressPercent = tricksPlayedCount / 11;
    const currentTrajectory = isBidder ? 
        (bidderCardPoints / Math.max(0.1, progressPercent)) : 
        (defenderCardPoints / Math.max(0.1, progressPercent));
    
    if (isBidder) {
        const projectedSurplus = projectedFinalScore - GOAL;
        const trajectoryIndicatesWin = currentTrajectory > GOAL;
        let strategicAsk;

        if (projectedSurplus > 15 && trajectoryIndicatesWin) {
            // Winning comfortably - modest greed
            const projectedPointExchange = projectedSurplus * bidMultiplier * numberOfOpponents;
            strategicAsk = Math.round(projectedPointExchange * 0.8); // Take 80% of projected win
        } else if (projectedSurplus < -10 || !trajectoryIndicatesWin) {
            // Losing or risky - reasonable hedge based on actual risk
            const projectedLoss = Math.abs(GOAL - projectedFinalScore);
            const riskFactor = Math.min(0.4, 0.2 + (tricksPlayedCount * 0.02)); // More confident later
            strategicAsk = Math.round(projectedLoss * bidMultiplier * numberOfOpponents * riskFactor);
            strategicAsk = Math.min(strategicAsk, 40); // Cap at 40
        } else {
            // Close game - minimal insurance
            strategicAsk = 5;
        }

        const finalAsk = Math.round(strategicAsk / 5) * 5;
        
        // Only update if different by 5+ points
        if (Math.abs(finalAsk - (insurance.bidderRequirement || 0)) >= 5) {
            return { settingType: 'bidderRequirement', value: finalAsk };
        }

    } else {
        // Defender logic
        const projectedBidderScore = TOTAL_POINTS - projectedFinalScore;
        const bidderSurplus = projectedBidderScore - GOAL;
        
        let strategicOffer;
        if (bidderSurplus > 10) {
            // Bidder likely to win big - don't offer much
            strategicOffer = -5;
        } else if (bidderSurplus < -10) {
            // Bidder likely to lose - offer to pay for insurance
            const defenderBenefit = Math.abs(bidderSurplus) * bidMultiplier / numberOfOpponents;
            strategicOffer = Math.round(defenderBenefit * 0.6); // Offer 60% of benefit
            strategicOffer = Math.min(strategicOffer, 25); // Cap at 25
        } else {
            // Close game
            strategicOffer = 0;
        }

        const finalOffer = Math.round(strategicOffer / 5) * 5;
        
        // Only update if different by 5+ points
        if (Math.abs(finalOffer - (insurance.defenderOffers[bot.playerName] || 0)) >= 5) {
            return { settingType: 'defenderOffer', value: finalOffer };
        }
    }
    
    return null;
}

module.exports = {
    calculateInsuranceMove
};