const { Pool } = require('pg');
require('dotenv').config();

async function checkBotGames() {
    const pool = new Pool({
        connectionString: process.env.POSTGRES_CONNECT_STRING,
        ssl: { rejectUnauthorized: false }
    });

    try {
        // Count games per bot
        const result = await pool.query(`
            SELECT 
                bot_name, 
                COUNT(DISTINCT game_id) as unique_games,
                COUNT(*) as total_decisions,
                MAX(created_at) as last_seen
            FROM bot_insurance_logs 
            GROUP BY bot_name 
            ORDER BY unique_games DESC
        `);
        
        console.log('🎮 Bot Game Statistics:\n');
        console.log('Bot Name         | Games | Decisions | Last Active');
        console.log('-----------------|-------|-----------|------------------------');
        
        const THRESHOLD = 50; // From AdaptiveInsuranceStrategy
        
        result.rows.forEach(row => {
            const status = row.unique_games >= THRESHOLD ? '✅' : '⏳';
            console.log(
                `${status} ${row.bot_name.padEnd(14)} | ${
                    row.unique_games.toString().padStart(5)
                } | ${row.total_decisions.toString().padStart(9)} | ${
                    new Date(row.last_seen).toLocaleString()
                }`
            );
        });
        
        console.log(`\n📊 Summary:`);
        console.log(`   Adjustment threshold: ${THRESHOLD} games`);
        console.log(`   Bots ready for adjustment: ${result.rows.filter(r => r.unique_games >= THRESHOLD).length}/${result.rows.length}`);
        
        // Check if adjustments have been triggered
        const adjustmentCheck = await pool.query(`
            SELECT COUNT(*) as count FROM bot_strategy_adjustments
        `);
        
        console.log(`   Total adjustments made: ${adjustmentCheck.rows[0].count}`);
        
        // Check bot_params for any stored parameters
        const paramsCheck = await pool.query(`
            SELECT COUNT(DISTINCT bot_name) as bots_with_params FROM bot_params
        `);
        
        console.log(`   Bots with custom parameters: ${paramsCheck.rows[0].bots_with_params}`);

    } catch (error) {
        console.error('Error checking bot games:', error);
    } finally {
        await pool.end();
    }
}

checkBotGames();