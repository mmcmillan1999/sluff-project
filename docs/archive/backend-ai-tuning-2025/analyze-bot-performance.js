const { Pool } = require('pg');
require('dotenv').config();

async function analyzeBotPerformance() {
    const pool = new Pool({
        connectionString: process.env.POSTGRES_CONNECT_STRING,
        ssl: { rejectUnauthorized: false }
    });

    try {
        console.log('=== BOT INSURANCE PERFORMANCE ANALYSIS ===\n');
        
        // Overall performance by bot
        const overallResult = await pool.query(`
            SELECT 
                bot_name,
                is_bidder,
                COUNT(*) as total_decisions,
                AVG(saved_or_wasted) as avg_outcome,
                SUM(CASE WHEN saved_or_wasted > 0 THEN saved_or_wasted ELSE 0 END) as total_saved,
                SUM(CASE WHEN saved_or_wasted < 0 THEN ABS(saved_or_wasted) ELSE 0 END) as total_wasted,
                COUNT(CASE WHEN deal_executed THEN 1 END) as deals_made,
                COUNT(CASE WHEN NOT deal_executed THEN 1 END) as deals_passed
            FROM bot_insurance_logs
            WHERE saved_or_wasted IS NOT NULL
            GROUP BY bot_name, is_bidder
            ORDER BY bot_name, is_bidder DESC
        `);
        
        console.log('OVERALL PERFORMANCE BY BOT AND ROLE:');
        console.log('Bot Name         | Role     | Decisions | Avg Outcome | Saved | Wasted | Deals Made');
        console.log('-----------------|----------|-----------|-------------|-------|--------|------------');
        overallResult.rows.forEach(row => {
            console.log(
                `${row.bot_name.padEnd(16)} | ${row.is_bidder ? 'Bidder  ' : 'Defender'} | ${
                    row.total_decisions.toString().padStart(9)
                } | ${(parseFloat(row.avg_outcome) || 0).toFixed(1).padStart(11)} | ${
                    row.total_saved.toString().padStart(5)
                } | ${row.total_wasted.toString().padStart(6)} | ${
                    row.deals_made.toString().padStart(10)
                }`
            );
        });
        
        // Performance over time
        console.log('\n\nPERFORMANCE TREND (Last 10 Games per Bot):');
        const trendResult = await pool.query(`
            WITH ranked_games AS (
                SELECT 
                    bot_name,
                    is_bidder,
                    saved_or_wasted,
                    created_at,
                    ROW_NUMBER() OVER (PARTITION BY bot_name, is_bidder ORDER BY created_at DESC) as rn
                FROM bot_insurance_logs
                WHERE saved_or_wasted IS NOT NULL
            )
            SELECT 
                bot_name,
                is_bidder,
                AVG(CASE WHEN rn <= 5 THEN saved_or_wasted END) as last_5_avg,
                AVG(CASE WHEN rn > 5 AND rn <= 10 THEN saved_or_wasted END) as prev_5_avg
            FROM ranked_games
            WHERE rn <= 10
            GROUP BY bot_name, is_bidder
            HAVING COUNT(*) >= 5
            ORDER BY bot_name, is_bidder DESC
        `);
        
        console.log('Bot Name         | Role     | Last 5 Avg | Prev 5 Avg | Improvement');
        console.log('-----------------|----------|------------|------------|-------------');
        trendResult.rows.forEach(row => {
            const improvement = row.last_5_avg - (row.prev_5_avg || 0);
            console.log(
                `${row.bot_name.padEnd(16)} | ${row.is_bidder ? 'Bidder  ' : 'Defender'} | ${
                    (parseFloat(row.last_5_avg) || 0).toFixed(1).padStart(10)
                } | ${(parseFloat(row.prev_5_avg) || 0).toFixed(1).padStart(10)} | ${
                    improvement > 0 ? '+' : ''
                }${improvement.toFixed(1).padStart(10)}`
            );
        });
        
        // Check for active adjustments
        console.log('\n\nACTIVE STRATEGY ADJUSTMENTS:');
        const adjustmentResult = await pool.query(`
            SELECT 
                bot_name,
                strategy_type,
                trick_range,
                adjustment_factor,
                reason,
                created_at
            FROM bot_strategy_adjustments
            WHERE expires_at > NOW()
            ORDER BY bot_name, created_at DESC
        `);
        
        if (adjustmentResult.rows.length > 0) {
            console.log('Bot Name         | Type     | Trick Range | Factor | Reason');
            console.log('-----------------|----------|-------------|--------|---------------------------');
            adjustmentResult.rows.forEach(row => {
                console.log(
                    `${row.bot_name.padEnd(16)} | ${row.strategy_type.padEnd(8)} | ${
                        row.trick_range.padEnd(11)
                    } | ${row.adjustment_factor.toFixed(2).padStart(6)} | ${row.reason}`
                );
            });
        } else {
            console.log('No active adjustments found.');
        }
        
        // Best and worst decisions
        console.log('\n\nBEST INSURANCE DECISIONS (Top 5):');
        const bestResult = await pool.query(`
            SELECT 
                bot_name,
                is_bidder,
                trick_number,
                saved_or_wasted,
                deal_executed,
                created_at
            FROM bot_insurance_logs
            WHERE saved_or_wasted IS NOT NULL
            ORDER BY saved_or_wasted DESC
            LIMIT 5
        `);
        
        bestResult.rows.forEach(row => {
            console.log(
                `${row.bot_name} (${row.is_bidder ? 'Bidder' : 'Defender'}) saved ${
                    row.saved_or_wasted
                } points at trick ${row.trick_number} by ${
                    row.deal_executed ? 'making a deal' : 'not dealing'
                }`
            );
        });
        
        console.log('\n\nWORST INSURANCE DECISIONS (Bottom 5):');
        const worstResult = await pool.query(`
            SELECT 
                bot_name,
                is_bidder,
                trick_number,
                saved_or_wasted,
                deal_executed,
                created_at
            FROM bot_insurance_logs
            WHERE saved_or_wasted IS NOT NULL
            ORDER BY saved_or_wasted ASC
            LIMIT 5
        `);
        
        worstResult.rows.forEach(row => {
            console.log(
                `${row.bot_name} (${row.is_bidder ? 'Bidder' : 'Defender'}) wasted ${
                    Math.abs(row.saved_or_wasted)
                } points at trick ${row.trick_number} by ${
                    row.deal_executed ? 'making a deal' : 'not dealing'
                }`
            );
        });
        
    } catch (error) {
        console.error('Error analyzing bot performance:', error);
    } finally {
        await pool.end();
    }
}

analyzeBotPerformance();