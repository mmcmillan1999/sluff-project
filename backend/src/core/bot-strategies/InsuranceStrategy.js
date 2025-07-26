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

    // --- BIDDER LOGIC ---
    if (isBidder) {
        // These constants define the bot's personality.
        const GREED_FACTOR = 20; // How many extra points to ask for when winning.
        const HEDGE_FACTOR = 0.5; // Ask for a deal that cuts projected losses by this percent (e.g., 0.5 = 50%).

        // 1. Project the final outcome of the hand.
        const myHand = hands[bot.playerName] || [];
        const pointsInMyHand = gameLogic.calculateCardPoints(myHand);
        const projectedFinalScore = bidderCardPoints + pointsInMyHand;
        const projectedSurplus = projectedFinalScore - GOAL;

        let strategicAsk;

        if (projectedSurplus > 0) {
            // --- WINNING SCENARIO ---
            // The bot is projected to win. It should make a GREEDY offer.
            const projectedPointExchange = projectedSurplus * bidMultiplier * numberOfOpponents;
            // Ask for the projected winnings PLUS the greed factor.
            strategicAsk = projectedPointExchange + GREED_FACTOR;

        } else {
            // --- LOSING SCENARIO ---
            // The bot is projected to lose. It should HEDGE its bets to mitigate losses.
            const projectedPointExchange = projectedSurplus * bidMultiplier * numberOfOpponents; // This will be negative.
            // Ask for a POSITIVE value that is a fraction of the projected loss.
            // Example: If projected to lose 80, ask for a payment of 40 (-(-80) * 0.5).
            strategicAsk = -projectedPointExchange * HEDGE_FACTOR;
        }

        // Round the final ask to the nearest 5 for a more human-like number.
        const finalAsk = Math.round(strategicAsk / 5) * 5;

        // Only emit an update if the new decision is different from the current one.
        if (finalAsk !== insurance.bidderRequirement) {
            return { settingType: 'bidderRequirement', value: finalAsk };
        }

    } else {
        // --- DEFENDER LOGIC (UNCHANGED, AS REQUESTED) ---
        const STATIC_STINGYNESS = 10;
        const myHand = hands[bot.playerName] || [];
        const pointsInMyHand = gameLogic.calculateCardPoints(myHand);
        const numberOfDefenders = numberOfOpponents;

        const projectedFinalScore = defenderCardPoints + (pointsInMyHand * numberOfDefenders);
        const projectedSurplus = projectedFinalScore - GOAL;

        const baseOffer = -projectedSurplus * bidMultiplier;
        
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