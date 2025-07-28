// backend/src/core/bot-strategies/InsuranceStrategy.js

const gameLogic = require('../logic');
const { BID_MULTIPLIERS } = require('../constants');

/**
 * Bot personality types that affect insurance decision making
 */
const BOT_PERSONALITIES = {
    AGGRESSIVE: {
        name: 'Aggressive',
        bidderGreedFactor: 30,      // Higher greed when winning
        bidderHedgeFactor: 0.3,     // Less hedging when losing (more risky)
        defenderStingyness: 15,     // More stingy as defender
        riskTolerance: 0.8,         // Higher risk tolerance
        adaptiveness: 0.7           // Moderately adaptive to opponents
    },
    CONSERVATIVE: {
        name: 'Conservative', 
        bidderGreedFactor: 10,      // Lower greed when winning
        bidderHedgeFactor: 0.7,     // More hedging when losing (less risky)
        defenderStingyness: 5,      // Less stingy as defender
        riskTolerance: 0.3,         // Lower risk tolerance
        adaptiveness: 0.9           // Highly adaptive to opponents
    },
    BALANCED: {
        name: 'Balanced',
        bidderGreedFactor: 20,      // Moderate greed
        bidderHedgeFactor: 0.5,     // Moderate hedging
        defenderStingyness: 10,     // Moderate stinginess
        riskTolerance: 0.5,         // Moderate risk tolerance
        adaptiveness: 0.6           // Moderately adaptive
    }
};

/**
 * Assigns a personality to a bot based on their name/ID
 */
function getBotPersonality(bot) {
    const hash = bot.playerName.split('').reduce((a, b) => {
        a = ((a << 5) - a) + b.charCodeAt(0);
        return a & a;
    }, 0);
    
    const personalities = Object.values(BOT_PERSONALITIES);
    return personalities[Math.abs(hash) % personalities.length];
}

/**
 * Analyzes the current game state for strategic insights
 */
function analyzeGameState(engine, bot) {
    const { hands, capturedTricks, playerOrder } = engine;
    const myHand = hands[bot.playerName] || [];
    
    // Calculate remaining cards and tricks
    const totalCardsDealt = Object.values(hands).reduce((sum, hand) => sum + hand.length, 0);
    const tricksPlayed = Object.values(capturedTricks).reduce((sum, tricks) => sum + tricks.length, 0);
    const gameProgress = tricksPlayed / 11; // 11 total tricks in a round
    
    // Analyze hand strength
    const handPoints = gameLogic.calculateCardPoints(myHand);
    const suits = { H: 0, S: 0, C: 0, D: 0 };
    for (const card of myHand) {
        suits[gameLogic.getSuit(card)]++;
    }
    
    // Count high-value cards (Aces, 10s, Kings)
    const highValueCards = myHand.filter(card => {
        const rank = gameLogic.getRank(card);
        return ['A', '10', 'K'].includes(rank);
    }).length;
    
    return {
        gameProgress,
        handPoints,
        handSize: myHand.length,
        suits,
        highValueCards,
        averageHandStrength: handPoints / Math.max(myHand.length, 1)
    };
}

/**
 * Analyzes opponent behavior patterns (simplified version)
 */
function analyzeOpponentBehavior(engine, bot) {
    // In a full implementation, this would track historical decisions
    // For now, we'll use current insurance state as a proxy
    const { insurance } = engine;
    
    let opponentAggression = 0.5; // Default neutral
    
    if (insurance.bidderPlayerName !== bot.playerName) {
        // We're a defender, analyze the bidder's requirement
        const bidMultiplier = insurance.bidMultiplier;
        const baseRequirement = 120 * bidMultiplier;
        const actualRequirement = insurance.bidderRequirement;
        
        // Higher than base = more aggressive, lower = more conservative
        opponentAggression = Math.max(0, Math.min(1, 
            0.5 + (actualRequirement - baseRequirement) / (240 * bidMultiplier)
        ));
    } else {
        // We're the bidder, analyze defender offers
        const offers = Object.values(insurance.defenderOffers);
        if (offers.length > 0) {
            const avgOffer = offers.reduce((sum, offer) => sum + offer, 0) / offers.length;
            const baseOffer = -60 * insurance.bidMultiplier;
            
            // Higher offers (less negative) = more generous, lower = more stingy
            opponentAggression = Math.max(0, Math.min(1,
                0.5 - (avgOffer - baseOffer) / (120 * insurance.bidMultiplier)
            ));
        }
    }
    
    return { opponentAggression };
}

/**
 * Enhanced insurance decision making with personality and game state analysis
 */
function calculateInsuranceMove(engine, bot) {
    const { insurance, bidWinnerInfo, hands, bidderCardPoints, defenderCardPoints } = engine;
    
    // Early exit if insurance is not active or deal is already executed
    if (!insurance.isActive || insurance.dealExecuted) {
        return null;
    }
    
    const bidMultiplier = BID_MULTIPLIERS[bidWinnerInfo.bid] || 1;
    const isBidder = bot.playerName === bidWinnerInfo.playerName;
    const numberOfOpponents = engine.playerOrder.count - 1;
    const GOAL = 60;

    // Get bot personality and analyze game state
    const personality = getBotPersonality(bot);
    const gameState = analyzeGameState(engine, bot);
    const opponentBehavior = analyzeOpponentBehavior(engine, bot);

    // --- ENHANCED BIDDER LOGIC ---
    if (isBidder) {
        const myHand = hands[bot.playerName] || [];
        const pointsInMyHand = gameLogic.calculateCardPoints(myHand);
        const projectedFinalScore = bidderCardPoints + pointsInMyHand;
        const projectedSurplus = projectedFinalScore - GOAL;

        let strategicAsk;

        if (projectedSurplus > 0) {
            // --- WINNING SCENARIO ---
            const projectedPointExchange = projectedSurplus * bidMultiplier * numberOfOpponents;
            
            // Base greed adjusted by personality and game state
            let adjustedGreed = personality.bidderGreedFactor;
            
            // Increase greed if hand is very strong
            if (gameState.averageHandStrength > 8) {
                adjustedGreed *= 1.3;
            }
            
            // Adjust based on opponent behavior
            if (opponentBehavior.opponentAggression > 0.7) {
                adjustedGreed *= 0.8; // Be less greedy against aggressive opponents
            } else if (opponentBehavior.opponentAggression < 0.3) {
                adjustedGreed *= 1.2; // Be more greedy against conservative opponents
            }
            
            // Game progress factor - be more aggressive early, more conservative late
            const progressFactor = 1 + (0.5 - gameState.gameProgress) * 0.3;
            adjustedGreed *= progressFactor;
            
            strategicAsk = projectedPointExchange + adjustedGreed;

        } else {
            // --- LOSING SCENARIO ---
            const projectedPointExchange = projectedSurplus * bidMultiplier * numberOfOpponents;
            
            // Hedge factor adjusted by personality and risk assessment
            let adjustedHedge = personality.bidderHedgeFactor;
            
            // Adjust hedging based on how badly we're losing
            const lossMargin = Math.abs(projectedSurplus);
            if (lossMargin > 20) {
                adjustedHedge *= 1.2; // Hedge more when losing badly
            }
            
            // Adjust based on hand potential
            if (gameState.highValueCards > 3) {
                adjustedHedge *= 0.9; // Hedge less if we have high-value cards
            }
            
            // Consider opponent behavior
            if (opponentBehavior.opponentAggression > 0.6) {
                adjustedHedge *= 1.1; // Hedge more against aggressive opponents
            }
            
            strategicAsk = -projectedPointExchange * adjustedHedge;
        }

        // Apply personality-based risk tolerance
        if (personality.riskTolerance > 0.7) {
            strategicAsk *= 1.1; // Risk-takers ask for more
        } else if (personality.riskTolerance < 0.4) {
            strategicAsk *= 0.9; // Risk-averse ask for less
        }

        // Round to nearest 5 with some personality-based variation
        const roundingFactor = personality.name === 'AGGRESSIVE' ? 10 : 5;
        const finalAsk = Math.round(strategicAsk / roundingFactor) * roundingFactor;

        if (finalAsk !== insurance.bidderRequirement) {
            return { settingType: 'bidderRequirement', value: finalAsk };
        }

    } else {
        // --- ENHANCED DEFENDER LOGIC ---
        const myHand = hands[bot.playerName] || [];
        const pointsInMyHand = gameLogic.calculateCardPoints(myHand);
        const numberOfDefenders = numberOfOpponents;

        const projectedFinalScore = defenderCardPoints + (pointsInMyHand * numberOfDefenders);
        const projectedSurplus = projectedFinalScore - GOAL;

        const baseOffer = -projectedSurplus * bidMultiplier;
        
        // Enhanced stinginess calculation
        let adjustedStinginess = personality.defenderStingyness;
        
        // Adjust based on hand strength
        if (gameState.handPoints > 25) {
            adjustedStinginess *= 0.8; // Be less stingy with strong hand
        } else if (gameState.handPoints < 15) {
            adjustedStinginess *= 1.2; // Be more stingy with weak hand
        }
        
        // Adjust based on bidder's requirement
        const bidderRequirement = insurance.bidderRequirement;
        const baseRequirement = 120 * bidMultiplier;
        
        if (bidderRequirement > baseRequirement * 1.2) {
            adjustedStinginess *= 1.3; // Be more stingy against greedy bidders
        } else if (bidderRequirement < baseRequirement * 0.8) {
            adjustedStinginess *= 0.8; // Be less stingy against modest bidders
        }
        
        // Consider other defenders' offers for competitive positioning
        const otherOffers = Object.entries(insurance.defenderOffers)
            .filter(([name, _]) => name !== bot.playerName)
            .map(([_, offer]) => offer);
            
        if (otherOffers.length > 0) {
            const avgOtherOffer = otherOffers.reduce((sum, offer) => sum + offer, 0) / otherOffers.length;
            const competitiveFactor = personality.adaptiveness;
            
            // Adjust offer to be competitive but maintain personality
            if (avgOtherOffer > baseOffer) {
                adjustedStinginess *= (1 - competitiveFactor * 0.3); // Be less stingy to compete
            }
        }
        
        // Apply game progress factor
        if (gameState.gameProgress > 0.7) {
            adjustedStinginess *= 0.9; // Be slightly less stingy late in game
        }
        
        const strategicOffer = Math.round((baseOffer - adjustedStinginess) / 5) * 5;

        if (strategicOffer !== insurance.defenderOffers[bot.playerName]) {
            return { settingType: 'defenderOffer', value: strategicOffer };
        }
    }
    
    return null; // No change needed
}

module.exports = {
    calculateInsuranceMove,
    getBotPersonality,
    BOT_PERSONALITIES
};