// One-time migration script to set all existing users as VIP
// Run this script with: node backend/src/data/setAllUsersVIP.js

const { Pool } = require('pg');
require('dotenv').config();

async function setAllUsersAsVIP() {
    const pool = new Pool({
        connectionString: process.env.POSTGRES_CONNECT_STRING,
        ssl: {
            rejectUnauthorized: false
        }
    });

    try {
        console.log('Connecting to database...');
        
        // First, ensure the column exists
        await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_vip BOOLEAN DEFAULT TRUE");
        console.log('✓ Ensured is_vip column exists');
        
        // Update all existing users to be VIP
        const result = await pool.query("UPDATE users SET is_vip = TRUE WHERE is_vip IS NULL OR is_vip = FALSE");
        console.log(`✓ Updated ${result.rowCount} users to VIP status`);
        
        // Verify the update
        const verifyResult = await pool.query("SELECT COUNT(*) as total_users, COUNT(CASE WHEN is_vip = TRUE THEN 1 END) as vip_users FROM users");
        const { total_users, vip_users } = verifyResult.rows[0];
        
        console.log(`\n=== VIP Migration Complete ===`);
        console.log(`Total users: ${total_users}`);
        console.log(`VIP users: ${vip_users}`);
        console.log(`Success rate: ${total_users > 0 ? (vip_users/total_users * 100).toFixed(2) : 0}%`);
        
        if (total_users === vip_users) {
            console.log('\n✅ All users successfully set as VIP!');
        } else {
            console.log(`\n⚠️  ${total_users - vip_users} users are not VIP. You may need to investigate.`);
        }
        
    } catch (error) {
        console.error('Error during VIP migration:', error);
        process.exit(1);
    } finally {
        await pool.end();
        console.log('\nDatabase connection closed.');
    }
}

// Run the migration
if (require.main === module) {
    setAllUsersAsVIP();
}

module.exports = setAllUsersAsVIP;