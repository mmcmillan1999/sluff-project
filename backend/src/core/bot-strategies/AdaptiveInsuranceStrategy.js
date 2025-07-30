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
                AND (expires_at IS NULL OR expires_at > NOW())
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
                VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '7 days')
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
        const { insurance, bidWinnerInfo, hands, bidderCardPoints, defenderCardPoints, tricksPlayedCount } = engine;
        const bidMultiplier = BID_MULTIPLIERS[bidWinnerInfo.bid] || 1;
        const isBidder = bot.playerName === bidWinnerInfo.playerName;
        const numberOfOpponents = engine.playerOrder.count - 1;
        const GOAL = 60;

        // Get bot's historical performance
        const botData = await this.getBotHistory(bot.playerName);
        
        // Determine trick phase
        const trickPhase = tricksPlayedCount <= 3 ? 'early' : 
                          tricksPlayedCount <= 7 ? 'mid' : 'late';

        // Base personality values
        let greedFactor = 20;
        let hedgeFactor = 0.5;
        let stinginessFactor = 10;
        
        // Add some randomness based on bot name
        const nameHash = bot.playerName.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
        const personalityOffset = (nameHash % 20) - 10;
        
        greedFactor += personalityOffset;
        stinginessFactor += personalityOffset / 2;

        // Apply learned adjustments
        for (const adj of botData.adjustments) {
            if (adj.strategy_type === (isBidder ? 'bidder' : 'defender') && 
                adj.trick_range === trickPhase) {
                if (isBidder) {
                    greedFactor *= (1 - adj.adjustment_factor);
                    hedgeFactor *= (1 + adj.adjustment_factor);
                } else {
                    stinginessFactor *= (1 + adj.adjustment_factor);
                }
            }
        }

        // Add trick-based variance
        const trickVariance = tricksPlayedCount * (Math.random() * 4 - 2);

        if (isBidder) {
            const myHand = hands[bot.playerName] || [];
            const pointsInMyHand = gameLogic.calculateCardPoints(myHand);
            const projectedFinalScore = bidderCardPoints + pointsInMyHand;
            const projectedSurplus = projectedFinalScore - GOAL;

            let strategicAsk;

            if (projectedSurplus > 0) {
                // Winning scenario
                const projectedPointExchange = projectedSurplus * bidMultiplier * numberOfOpponents;
                strategicAsk = projectedPointExchange + greedFactor + trickVariance;
            } else {
                // Losing scenario
                const projectedPointExchange = projectedSurplus * bidMultiplier * numberOfOpponents;
                strategicAsk = -projectedPointExchange * hedgeFactor + trickVariance;
            }

            const finalAsk = Math.round(strategicAsk / 5) * 5;

            if (finalAsk !== insurance.bidderRequirement) {
                return { settingType: 'bidderRequirement', value: finalAsk };
            }

        } else {
            // Defender logic
            const myHand = hands[bot.playerName] || [];
            const pointsInMyHand = gameLogic.calculateCardPoints(myHand);
            const numberOfDefenders = numberOfOpponents;

            const projectedFinalScore = defenderCardPoints + (pointsInMyHand * numberOfDefenders);
            const projectedSurplus = projectedFinalScore - GOAL;

            const baseOffer = -projectedSurplus * bidMultiplier;
            
            // Add variance to prevent predictability
            const offerVariance = Math.random() * 10 - 5;
            const strategicOffer = Math.round((baseOffer - stinginessFactor + trickVariance + offerVariance) / 5) * 5;

            if (strategicOffer !== insurance.defenderOffers[bot.playerName]) {
                return { settingType: 'defenderOffer', value: strategicOffer };
            }
        }
        
        return null;
    }

    /**
     * Log insurance decision for learning
     */
    async logInsuranceDecision(gameId, botName, engine, dealExecuted, hindsightValue) {
        try {
            const { insurance, bidWinnerInfo, tricksPlayedCount, scores } = engine;
            const isBidder = botName === bidWinnerInfo.playerName;
            const botOffer = isBidder ? insurance.bidderRequirement : insurance.defenderOffers[botName];
            const savedOrWasted = hindsightValue || 0;
            
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
            
            await this.pool.query(query, [
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
                            this.io.to(engine.tableId).emit('tableChat', {
                                playerName: botName,
                                message: message,
                                timestamp: Date.now()
                            });
                        }
                    }, 1000);
                }
            }
        } catch (error) {
            console.error('Error logging insurance decision:', error);
        }
    }
}

module.exports = AdaptiveInsuranceStrategy;