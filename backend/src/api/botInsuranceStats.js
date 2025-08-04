// backend/src/api/botInsuranceStats.js
const express = require('express');
const router = express.Router();

module.exports = (pool) => {
    // Get bot insurance performance stats
    router.get('/stats', async (req, res) => {
        try {
            // Overall bot performance
            const overallQuery = `
                SELECT 
                    bot_name,
                    COUNT(*) as total_decisions,
                    COUNT(CASE WHEN deal_executed THEN 1 END) as deals_made,
                    COUNT(CASE WHEN NOT deal_executed THEN 1 END) as deals_passed,
                    AVG(saved_or_wasted) as avg_outcome,
                    SUM(CASE WHEN saved_or_wasted > 0 THEN saved_or_wasted ELSE 0 END) as total_saved,
                    SUM(CASE WHEN saved_or_wasted < 0 THEN ABS(saved_or_wasted) ELSE 0 END) as total_wasted,
                    AVG(CASE WHEN is_bidder THEN saved_or_wasted END) as avg_as_bidder,
                    AVG(CASE WHEN NOT is_bidder THEN saved_or_wasted END) as avg_as_non_bidder
                FROM bot_insurance_logs
                WHERE saved_or_wasted IS NOT NULL
                GROUP BY bot_name
                ORDER BY avg_outcome DESC
            `;
            
            const overallStats = await pool.query(overallQuery);
            
            // Performance by trick number
            const byTrickQuery = `
                SELECT 
                    bot_name,
                    trick_number,
                    COUNT(*) as decisions,
                    AVG(saved_or_wasted) as avg_outcome,
                    COUNT(CASE WHEN deal_executed THEN 1 END) as deals_made
                FROM bot_insurance_logs
                WHERE saved_or_wasted IS NOT NULL
                GROUP BY bot_name, trick_number
                ORDER BY bot_name, trick_number
            `;
            
            const byTrickStats = await pool.query(byTrickQuery);
            
            // Recent decisions with context
            const recentQuery = `
                SELECT 
                    bot_name,
                    is_bidder,
                    bid_multiplier,
                    trick_number,
                    deal_executed,
                    saved_or_wasted,
                    game_phase,
                    created_at
                FROM bot_insurance_logs
                WHERE saved_or_wasted IS NOT NULL
                ORDER BY created_at DESC
                LIMIT 50
            `;
            
            const recentDecisions = await pool.query(recentQuery);
            
            // Learning progress over time
            const learningQuery = `
                SELECT 
                    bot_name,
                    DATE(created_at) as decision_date,
                    COUNT(*) as daily_decisions,
                    AVG(saved_or_wasted) as daily_avg_outcome
                FROM bot_insurance_logs
                WHERE saved_or_wasted IS NOT NULL
                    AND created_at > NOW() - INTERVAL '7 days'
                GROUP BY bot_name, DATE(created_at)
                ORDER BY bot_name, decision_date
            `;
            
            const learningProgress = await pool.query(learningQuery);
            
            res.json({
                overall: overallStats.rows,
                byTrick: byTrickStats.rows,
                recent: recentDecisions.rows,
                learning: learningProgress.rows
            });
            
        } catch (error) {
            console.error('Error fetching bot insurance stats:', error);
            res.status(500).json({ error: 'Failed to fetch bot insurance statistics' });
        }
    });
    
    // Get detailed stats for a specific bot
    router.get('/stats/:botName', async (req, res) => {
        try {
            const { botName } = req.params;
            
            const detailQuery = `
                SELECT 
                    game_id,
                    is_bidder,
                    bid_multiplier,
                    trick_number,
                    bot_offer,
                    bidder_requirement,
                    deal_executed,
                    actual_outcome,
                    hindsight_value,
                    saved_or_wasted,
                    game_phase,
                    hand_strength,
                    current_score,
                    created_at
                FROM bot_insurance_logs
                WHERE bot_name = $1
                ORDER BY created_at DESC
                LIMIT 100
            `;
            
            const details = await pool.query(detailQuery, [botName]);
            
            res.json({
                botName,
                decisions: details.rows
            });
            
        } catch (error) {
            console.error('Error fetching bot details:', error);
            res.status(500).json({ error: 'Failed to fetch bot details' });
        }
    });
    
    return router;
};