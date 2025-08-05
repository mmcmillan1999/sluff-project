// backend/src/core/bot-strategies/AdaptiveInsuranceStrategy.js

const gameLogic = require('../logic');
const { BID_MULTIPLIERS } = require('../constants');

/**
 * Adaptive insurance strategy that learns from past games
 */
class AdaptiveInsuranceStrategy {
    constructor(pool, io = null) {
        this.pool = pool;
        this.io = io;
        this.strategyCache = new Map();
        this.lastCacheUpdate = 0;
        this.CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
    }

    /**
     * Get bot's performance history and current adjustments
     */
    async getBotHistory(botName) {
        const cacheKey = `${botName}_history`;
        const now = Date.now();
        
        // Check cache
        if (this.strategyCache.has(cacheKey) && (now - this.lastCacheUpdate) < this.CACHE_DURATION) {
            return this.strategyCache.get(cacheKey);
        }

        try {
            // Get last 50 insurance decisions
            const historyQuery = `
                SELECT 
                    is_bidder,
                    trick_number,
                    deal_executed,
                    saved_or_wasted,
                    bid_multiplier,
                    game_phase
                FROM bot_insurance_logs
                WHERE bot_name = $1
                ORDER BY created_at DESC
                LIMIT 50
            `;
            const historyResult = await this.pool.query(historyQuery, [botName]);

            // Get current strategy adjustments
            const adjustmentQuery = `
                SELECT 
                    strategy_type,
                    trick_range,
                    adjustment_factor
                FROM bot_strategy_adjustments
                WHERE bot_name = $1
                ORDER BY created_at DESC
            `;
            const adjustmentResult = await this.pool.query(adjustmentQuery, [botName]);

            const data = {
                history: historyResult.rows,
                adjustments: adjustmentResult.rows
            };

            this.strategyCache.set(cacheKey, data);
            this.lastCacheUpdate = now;
            
            return data;
        } catch (error) {
            console.error(`Error fetching bot history for ${botName}:`, error);
            return { history: [], adjustments: [] };
        }
    }

    /**
     * Analyze recent performance and create adjustments
     * Returns true if adjustments were made
     */
    async analyzeAndAdjust(botName) {
        let adjustmentsMade = false;
        try {
            const analysisQuery = `
                WITH recent_games AS (
                    SELECT 
                        trick_number,
                        is_bidder,
                        AVG(saved_or_wasted) as avg_outcome,
                        COUNT(*) as game_count,
                        SUM(CASE WHEN saved_or_wasted < -20 THEN 1 ELSE 0 END) as bad_outcomes
                    FROM bot_insurance_logs
                    WHERE bot_name = $1
                    AND created_at > NOW() - INTERVAL '24 hours'
                    GROUP BY trick_number, is_bidder
                )
                SELECT * FROM recent_games
                WHERE game_count >= 3
                ORDER BY avg_outcome ASC
            `;
            
            const results = await this.pool.query(analysisQuery, [botName]);
            
            for (const row of results.rows) {
                if (row.bad_outcomes >= 2 || row.avg_outcome < -15) {
                    // Bot is consistently losing money in this scenario
                    const adjustmentFactor = Math.min(0.3, Math.abs(row.avg_outcome) / 100);
                    const trickRange = row.trick_number <= 3 ? 'early' : 
                                      row.trick_number <= 7 ? 'mid' : 'late';
                    
                    await this.createAdjustment(
                        botName,
                        row.is_bidder ? 'bidder' : 'defender',
                        trickRange,
                        adjustmentFactor,
                        `Poor performance: avg ${row.avg_outcome.toFixed(1)} over ${row.game_count} games`
                    );
                    adjustmentsMade = true;
                }
            }
            return adjustmentsMade;
        } catch (error) {
            console.error(`Error analyzing bot performance for ${botName}:`, error);
            return false;
        }
    }

    /**
     * Create a new strategy adjustment
     */
    async createAdjustment(botName, strategyType, trickRange, adjustmentFactor, reason) {
        try {
            const query = `
                INSERT INTO bot_strategy_adjustments 
                (bot_name, strategy_type, trick_range, adjustment_factor, reason, expires_at)
                VALUES ($1, $2, $3, $4, $5, NULL)
            `;
            await this.pool.query(query, [botName, strategyType, trickRange, adjustmentFactor, reason]);
        } catch (error) {
            console.error('Error creating adjustment:', error);
        }
    }

    /**
     * Calculate insurance move with adaptive strategy
     */
    async calculateInsuranceMove(engine, bot, gameService = null) {
        const { insurance, bidWinnerInfo, hands, bidderCardPoints, defenderCardPoints, tricksPlayedCount, trumpSuit } = engine;
        const bidMultiplier = BID_MULTIPLIERS[bidWinnerInfo.bid] || 1;
        const isBidder = bot.playerName === bidWinnerInfo.playerName;
        const numberOfOpponents = engine.playerOrder.count - 1;
        const GOAL = 60;
        const TOTAL_POINTS = 120;

        // CRITICAL: No insurance changes after trick 8
        if (tricksPlayedCount >= 8) {
            return null;
        }

        // Get bot's historical performance and personality
        const botData = await this.getBotHistory(bot.playerName);
        
        // Determine trick phase
        const trickPhase = tricksPlayedCount <= 3 ? 'early' : 
                          tricksPlayedCount <= 7 ? 'mid' : 'late';

        // Calculate remaining points in play
        const pointsCapturedSoFar = bidderCardPoints + defenderCardPoints;
        const pointsRemaining = TOTAL_POINTS - pointsCapturedSoFar;
        const tricksRemaining = 11 - tricksPlayedCount;
        
        // Analyze hand strength
        const myHand = hands[bot.playerName] || [];
        const pointsInMyHand = gameLogic.calculateCardPoints(myHand);
        
        // Count high cards and trump
        const highCards = myHand.filter(card => {
            const rank = card.slice(0, -1);
            return rank === 'A' || rank === '10';
        }).length;
        
        const trumpCards = myHand.filter(card => {
            const suit = card.slice(-1);
            return suit === trumpSuit;
        }).length;

        // Base personality values with bot-specific offset
        const nameHash = bot.playerName.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
        const personalityOffset = (nameHash % 20) - 10;
        
        let aggressiveness = 1.0 + (personalityOffset * 0.02); // 0.8 to 1.2
        let riskTolerance = 0.3 + (personalityOffset * 0.01);  // 0.2 to 0.4
        
        // Apply learned adjustments (PERMANENT)
        for (const adj of botData.adjustments) {
            if (adj.strategy_type === (isBidder ? 'bidder' : 'defender') && 
                adj.trick_range === trickPhase) {
                // Adjustments modify personality permanently
                aggressiveness *= (1 - adj.adjustment_factor);
                riskTolerance *= (1 + adj.adjustment_factor);
            }
        }

        // Estimate capture rate based on hand strength
        let myCaptureRate;
        if (isBidder) {
            const baseRate = 0.5;
            const highCardBonus = highCards * 0.05;
            const trumpBonus = trumpCards * 0.03;
            const positionBonus = tricksRemaining > 0 ? 0.1 : 0;
            myCaptureRate = Math.min(0.85, baseRate + highCardBonus + trumpBonus + positionBonus);
        } else {
            const baseRate = 0.5 / numberOfOpponents;
            const highCardBonus = highCards * 0.03;
            const trumpBonus = trumpCards * 0.02;
            myCaptureRate = Math.min(0.4, baseRate + highCardBonus + trumpBonus);
        }
        
        // Project final score
        const projectedRemainingCapture = pointsRemaining * myCaptureRate;
        const projectedFinalScore = isBidder ? 
            (bidderCardPoints + projectedRemainingCapture) :
            (defenderCardPoints + projectedRemainingCapture * numberOfOpponents);
        
        // Calculate current trajectory
        const progressPercent = tricksPlayedCount / 11;
        const currentTrajectory = isBidder ? 
            (bidderCardPoints / Math.max(0.1, progressPercent)) : 
            (defenderCardPoints / Math.max(0.1, progressPercent));

        if (isBidder) {
            const projectedSurplus = projectedFinalScore - GOAL;
            const trajectoryIndicatesWin = currentTrajectory > GOAL;
            let strategicAsk;

            if (projectedSurplus > 15 && trajectoryIndicatesWin) {
                // Winning comfortably
                const projectedPointExchange = projectedSurplus * bidMultiplier * numberOfOpponents;
                strategicAsk = Math.round(projectedPointExchange * 0.8 * aggressiveness);
            } else if (projectedSurplus < -10 || !trajectoryIndicatesWin) {
                // Losing or risky
                const projectedLoss = Math.abs(GOAL - projectedFinalScore);
                const riskFactor = Math.min(0.4, riskTolerance + (tricksPlayedCount * 0.02));
                strategicAsk = Math.round(projectedLoss * bidMultiplier * numberOfOpponents * riskFactor);
                strategicAsk = Math.min(strategicAsk, 40 + (personalityOffset * 2)); // Cap varies by personality
            } else {
                // Close game
                strategicAsk = 5 * aggressiveness;
            }

            const finalAsk = Math.max(0, Math.round(strategicAsk / 5) * 5);
            
            if (Math.abs(finalAsk - (insurance.bidderRequirement || 0)) >= 5) {
                return { settingType: 'bidderRequirement', value: finalAsk };
            }

        } else {
            // Defender logic
            const projectedBidderScore = TOTAL_POINTS - projectedFinalScore;
            const bidderSurplus = projectedBidderScore - GOAL;
            
            let strategicOffer;
            if (bidderSurplus > 10) {
                // Bidder likely to win big
                strategicOffer = -5 * aggressiveness;
            } else if (bidderSurplus < -10) {
                // Bidder likely to lose
                const defenderBenefit = Math.abs(bidderSurplus) * bidMultiplier / numberOfOpponents;
                strategicOffer = Math.round(defenderBenefit * 0.6 * (2 - aggressiveness)); // Less aggressive = more generous
                strategicOffer = Math.min(strategicOffer, 25 + (personalityOffset));
            } else {
                // Close game
                strategicOffer = 0;
            }

            const finalOffer = Math.round(strategicOffer / 5) * 5;
            
            if (Math.abs(finalOffer - (insurance.defenderOffers[bot.playerName] || 0)) >= 5) {
                return { settingType: 'defenderOffer', value: finalOffer };
            }
        }
        
        return null;
    }

    /**
     * Log insurance decision for learning
     */
    async logInsuranceDecision(gameId, botName, engine, dealExecuted, hindsightValue) {
        console.log(`[INSURANCE-LOG] Starting log for ${botName} in game ${gameId}`);
        try {
            const { insurance, bidWinnerInfo, tricksPlayedCount, scores } = engine;
            const isBidder = botName === bidWinnerInfo.playerName;
            const botOffer = isBidder ? insurance.bidderRequirement : insurance.defenderOffers[botName];
            const savedOrWasted = hindsightValue || 0;
            
            console.log(`[INSURANCE-LOG] Data:`, {
                botName,
                gameId,
                isBidder,
                dealExecuted,
                hindsightValue,
                savedOrWasted,
                tricksPlayedCount
            });
            
            // Calculate hand strength (simple metric)
            const hand = engine.hands[botName] || [];
            const handStrength = gameLogic.calculateCardPoints(hand);
            
            const query = `
                INSERT INTO bot_insurance_logs 
                (game_id, bot_name, is_bidder, bid_multiplier, trick_number, 
                 deal_executed, bot_offer, bidder_requirement, actual_outcome, 
                 hindsight_value, saved_or_wasted, game_phase, hand_strength, current_score)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            `;
            
            const result = await this.pool.query(query, [
                gameId,
                botName,
                isBidder,
                BID_MULTIPLIERS[bidWinnerInfo.bid] || 1,
                tricksPlayedCount,
                dealExecuted,
                botOffer || 0,
                insurance.bidderRequirement,
                0, // Will be updated after game ends
                hindsightValue,
                savedOrWasted,
                tricksPlayedCount <= 3 ? 'early' : tricksPlayedCount <= 7 ? 'mid' : 'late',
                handStrength,
                scores[botName] || 120
            ]);
            
            console.log(`[INSURANCE-LOG] Database insert successful for ${botName}`);

            // Periodically analyze and adjust (10% chance)
            if (Math.random() < 0.1) {
                const adjustmentMade = await this.analyzeAndAdjust(botName);
                
                // Announce learning if adjustment was made and gameService is available
                if (adjustmentMade && engine.tableId && this.pool) {
                    setTimeout(() => {
                        const messages = [
                            `I've been analyzing my last few games... Time to adjust my insurance strategy!`,
                            `My pattern recognition shows I've been too predictable. Updating my algorithms...`,
                            `Learning from ${botName === 'Kimba' ? 'my wild' : botName === 'Grandma Joe' ? 'years of' : 'recent'} experience!`,
                            `Recalibrating insurance parameters based on recent performance data...`
                        ];
                        const message = messages[Math.floor(Math.random() * messages.length)];
                        
                        // Emit directly through the pool's io reference if available
                        if (this.io) {
                            // Use new_lobby_message event that frontend is listening for
                            this.io.emit('new_lobby_message', {
                                id: Date.now(),
                                username: botName,
                                message: message,
                                created_at: new Date().toISOString()
                            });
                        }
                    }, 1000);
                }
            }
        } catch (error) {
            console.error('[INSURANCE-LOG] ERROR logging insurance decision:', error);
            console.error('[INSURANCE-LOG] Error details:', error.message);
            console.error('[INSURANCE-LOG] Stack:', error.stack);
        }
    }
}

module.exports = AdaptiveInsuranceStrategy;