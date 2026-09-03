const { Pool } = require('pg');
require('dotenv').config();

async function checkInsuranceLogs() {
    const pool = new Pool({
        connectionString: process.env.POSTGRES_CONNECT_STRING,
        ssl: { rejectUnauthorized: false }
    });

    try {
        console.log('Checking bot_insurance_logs table...\n');
        
        // Count total records
        const countResult = await pool.query('SELECT COUNT(*) as total FROM bot_insurance_logs');
        console.log(`Total records: ${countResult.rows[0].total}`);
        
        // Show recent records
        const recentResult = await pool.query(`
            SELECT bot_name, is_bidder, trick_number, deal_executed, saved_or_wasted, created_at 
            FROM bot_insurance_logs 
            ORDER BY created_at DESC 
            LIMIT 5
        `);
        
        if (recentResult.rows.length > 0) {
            console.log('\nRecent insurance decisions:');
            recentResult.rows.forEach(row => {
                console.log(`- ${row.bot_name} (${row.is_bidder ? 'Bidder' : 'Defender'}) at trick ${row.trick_number}: ${row.deal_executed ? 'Deal made' : 'No deal'}, Result: ${row.saved_or_wasted || 'pending'}`);
            });
        }
        
        // Check for any errors
        const errorResult = await pool.query(`
            SELECT COUNT(*) as error_count 
            FROM bot_insurance_logs 
            WHERE saved_or_wasted IS NULL
        `);
        console.log(`\nRecords without hindsight values: ${errorResult.rows[0].error_count}`);
        
    } catch (error) {
        console.error('Error checking database:', error);
    } finally {
        await pool.end();
    }
}

checkInsuranceLogs();