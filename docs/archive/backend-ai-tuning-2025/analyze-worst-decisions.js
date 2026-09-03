const { Pool } = require('pg');
require('dotenv').config();

async function analyzeWorstDecisions() {
    const pool = new Pool({
        connectionString: process.env.POSTGRES_CONNECT_STRING,
        ssl: { rejectUnauthorized: false }
    });

    try {
        console.log('🚨 WORST INSURANCE DECISIONS ANALYSIS\n');
        
        // Get worst decisions
        const worstQuery = `
            SELECT 
                bot_name,
                is_bidder,
                trick_number,
                bot_offer,
                bidder_requirement,
                deal_executed,
                saved_or_wasted,
                bid_multiplier,
                hand_strength
            FROM bot_insurance_logs 
            WHERE saved_or_wasted < -100
            ORDER BY saved_or_wasted ASC
            LIMIT 20
        `;
        
        const result = await pool.query(worstQuery);
        
        console.log('Top 20 Worst Decisions (Lost > 100 points):');
        console.log('Bot            | Role     | Trick | Requirement | Executed | Lost  | Hand');
        console.log('---------------|----------|-------|-------------|----------|-------|------');
        
        result.rows.forEach(row => {
            console.log(
                `${row.bot_name.padEnd(14)} | ${row.is_bidder ? 'Bidder  ' : 'Defender'} | ${
                    row.trick_number.toString().padStart(5)
                } | ${(row.bidder_requirement || 0).toString().padStart(11)} | ${
                    row.deal_executed ? 'Yes     ' : 'No      '
                } | ${Math.abs(row.saved_or_wasted).toString().padStart(5)} | ${
                    row.hand_strength?.toString().padStart(5) || '  ?'
                }`
            );
        });
        
        // Pattern analysis
        const patternQuery = `
            SELECT 
                is_bidder,
                deal_executed,
                AVG(ABS(saved_or_wasted)) as avg_loss,
                COUNT(*) as count
            FROM bot_insurance_logs 
            WHERE saved_or_wasted < -100
            GROUP BY is_bidder, deal_executed
            ORDER BY avg_loss DESC
        `;
        
        const patterns = await pool.query(patternQuery);
        
        console.log('\n\nPattern Analysis of Big Losses:');
        console.log('Role     | Deal Made | Avg Loss | Count');
        console.log('---------|-----------|----------|-------');
        
        patterns.rows.forEach(row => {
            console.log(
                `${row.is_bidder ? 'Bidder  ' : 'Defender'} | ${
                    row.deal_executed ? 'Yes      ' : 'No       '
                } | ${row.avg_loss.toFixed(0).padStart(8)} | ${row.count.toString().padStart(6)}`
            );
        });

        // Timing analysis
        const timingQuery = `
            SELECT 
                trick_number,
                AVG(ABS(saved_or_wasted)) as avg_loss,
                COUNT(*) as count
            FROM bot_insurance_logs 
            WHERE saved_or_wasted < -100
            GROUP BY trick_number
            ORDER BY trick_number
        `;
        
        const timing = await pool.query(timingQuery);
        
        console.log('\n\nBig Losses by Trick Number:');
        console.log('Trick | Avg Loss | Count');
        console.log('------|----------|-------');
        
        timing.rows.forEach(row => {
            console.log(
                `${row.trick_number.toString().padStart(5)} | ${
                    row.avg_loss.toFixed(0).padStart(8)
                } | ${row.count.toString().padStart(6)}`
            );
        });

    } catch (error) {
        console.error('Error analyzing worst decisions:', error);
    } finally {
        await pool.end();
    }
}

analyzeWorstDecisions();