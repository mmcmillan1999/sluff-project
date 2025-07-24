// backend/src/core/bot-strategies/InsuranceStrategy.js

const gameLogic = require('../logic');
const { BID_MULTIPLIERS } = require('../constants');

/**
 * The "brain" for a bot's insurance decisions.
 * @param {object} engine - The entire game engine instance.
 * @param {object} bot - The bot player instance making the decision.
 * @returns {object|null} A decision object { settingType, value } or null if no change is needed.
 */
function calculateInsuranceMove(engine, bot) {
    const { insurance, bidWinnerInfo, hands, bidderCardPoints, defenderCardPoints } = engine;
    const bidMultiplier = BID_MULTIPLIERS[bidWinnerInfo.bid] || 1;
    const isBidder = bot.playerName === bidWinnerInfo.playerName;
    const numberOfOpponents = engine.playerOrder.count - 1;
    const GOAL = 60;
    const STATIC_STINGYNESS = 10;

    if (isBidder) {
        // --- BIDDER LOGIC ---
        const myHand = hands[bot.playerName] || [];
        const pointsInMyHand = gameLogic.calculateCardPoints(myHand);
        
        // Projected score is what's captured plus what's in hand.
        const projectedFinalScore = bidderCardPoints + pointsInMyHand;
        const projectedSurplus = projectedFinalScore - GOAL;

        // Bidder expects to win/lose this many points from the pot.
        const projectedPointExchange = projectedSurplus * bidMultiplier * numberOfOpponents;
        const strategicAsk = Math.round(projectedPointExchange / 5) * 5;

        if (strategicAsk !== insurance.bidderRequirement) {
            return { settingType: 'bidderRequirement', value: strategicAsk };
        }

    } else {
        // --- DEFENDER LOGIC ---
        const myHand = hands[bot.playerName] || [];
        const pointsInMyHand = gameLogic.calculateCardPoints(myHand);
        const numberOfDefenders = numberOfOpponents; // In 3-player, this is 2.

        // Projected score is what's captured plus what's in my hand, multiplied by the number of defenders.
        const projectedFinalScore = defenderCardPoints + (pointsInMyHand * numberOfDefenders);
        const projectedSurplus = projectedFinalScore - GOAL; // How many points defenders expect to win by.

        // The offer is the inverse of what they expect to win.
        const baseOffer = -projectedSurplus * bidMultiplier;
        
        // Apply the stinginess factor.
        const strategicOffer = Math.round((baseOffer - STATIC_STINGYNESS) / 5) * 5;

        if (strategicOffer !== insurance.defenderOffers[bot.playerName]) {
            return { settingType: 'defenderOffer', value: strategicOffer };
        }
    }
    
    return null; // No change needed
}

module.exports = {
    calculateInsuranceMove
};