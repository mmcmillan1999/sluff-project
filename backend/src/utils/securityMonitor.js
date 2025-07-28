// backend/src/utils/securityMonitor.js
// Security monitoring utilities for mercy token abuse detection

const logMercyTokenAttempt = (userId, username, success, reason, additionalData = {}) => {
    const timestamp = new Date().toISOString();
    const logEntry = {
        timestamp,
        userId,
        username,
        action: 'mercy_token_request',
        success,
        reason,
        ...additionalData
    };
    
    // Log to console with appropriate emoji and formatting
    const status = success ? '✅' : '❌';
    const logMessage = `${status} [MERCY_TOKEN] ${username} (${userId}): ${reason}`;
    
    if (success) {
        console.log(logMessage);
    } else {
        console.warn(logMessage);
    }
    
    // TODO: In production, also log to a security monitoring system
    // This could be sent to a logging service like DataDog, Splunk, etc.
    
    return logEntry;
};

const checkSuspiciousActivity = async (pool, userId) => {
    try {
        // Check for suspicious patterns in the last 24 hours
        let suspiciousActivityQuery = `
            SELECT 
                COUNT(*) as total_attempts,
                COUNT(CASE WHEN transaction_type = 'free_token_mercy' THEN 1 END) as successful_mercy,
                MIN(transaction_time) as first_attempt,
                MAX(transaction_time) as last_attempt
            FROM transactions 
            WHERE user_id = $1 
            AND transaction_time > NOW() - INTERVAL '24 hours'
            AND (transaction_type = 'free_token_mercy' OR description LIKE '%mercy%')
        `;
        
        let result;
        try {
            result = await pool.query(suspiciousActivityQuery, [userId]);
        } catch (error) {
            // If transaction_time column doesn't exist, use fallback query
            if (error.code === '42703') {
                console.warn('⚠️ transaction_time column not found in suspicious activity check, using fallback');
                const fallbackQuery = `
                    SELECT 
                        COUNT(*) as total_attempts,
                        COUNT(CASE WHEN transaction_type = 'free_token_mercy' THEN 1 END) as successful_mercy
                    FROM transactions 
                    WHERE user_id = $1 
                    AND (transaction_type = 'free_token_mercy' OR description LIKE '%mercy%')
                `;
                result = await pool.query(fallbackQuery, [userId]);
                // Set default values for missing time fields
                result.rows[0].first_attempt = null;
                result.rows[0].last_attempt = null;
            } else {
                throw error;
            }
        }
        
        const stats = result.rows[0];
        
        const flags = [];
        
        // Flag if user has gotten multiple mercy tokens
        if (parseInt(stats.successful_mercy) > 3) {
            flags.push(`Multiple mercy tokens: ${stats.successful_mercy}`);
        }
        
        // Only check time-based flags if we have time data
        if (stats.first_attempt && stats.last_attempt) {
            const timeSpan = new Date(stats.last_attempt) - new Date(stats.first_attempt);
            if (parseInt(stats.total_attempts) > 5 && timeSpan < 3600000) { // 5 attempts in 1 hour
                flags.push(`Rapid attempts: ${stats.total_attempts} in ${Math.round(timeSpan/60000)} minutes`);
            }
        }
        
        if (flags.length > 0) {
            console.warn(`🚨 [SECURITY] Suspicious mercy token activity for user ${userId}: ${flags.join(', ')}`);
            return { suspicious: true, flags, stats };
        }
        
        return { suspicious: false, flags: [], stats };
        
    } catch (error) {
        console.error('Error checking suspicious activity:', error);
        return { suspicious: false, flags: [], stats: null, error: error.message };
    }
};

const generateSecurityReport = async (pool, hours = 24) => {
    try {
        let reportQuery = `
            SELECT 
                u.id,
                u.username,
                COUNT(*) as mercy_tokens_granted,
                SUM(t.amount) as total_mercy_amount,
                MIN(t.transaction_time) as first_mercy,
                MAX(t.transaction_time) as last_mercy
            FROM transactions t
            JOIN users u ON t.user_id = u.id
            WHERE t.transaction_type = 'free_token_mercy'
            AND t.transaction_time > NOW() - INTERVAL '${hours} hours'
            GROUP BY u.id, u.username
            ORDER BY mercy_tokens_granted DESC, total_mercy_amount DESC
        `;
        
        let result;
        try {
            result = await pool.query(reportQuery);
        } catch (error) {
            // If transaction_time column doesn't exist, use fallback query
            if (error.code === '42703') {
                console.warn('⚠️ transaction_time column not found in security report, using fallback');
                const fallbackQuery = `
                    SELECT 
                        u.id,
                        u.username,
                        COUNT(*) as mercy_tokens_granted,
                        SUM(t.amount) as total_mercy_amount
                    FROM transactions t
                    JOIN users u ON t.user_id = u.id
                    WHERE t.transaction_type = 'free_token_mercy'
                    GROUP BY u.id, u.username
                    ORDER BY mercy_tokens_granted DESC, total_mercy_amount DESC
                `;
                result = await pool.query(fallbackQuery);
                // Set default values for missing time fields
                result.rows.forEach(row => {
                    row.first_mercy = null;
                    row.last_mercy = null;
                });
            } else {
                throw error;
            }
        }
        
        console.log(`\n📊 [SECURITY REPORT] Mercy Token Activity (Last ${hours} hours)`);
        console.log('='.repeat(70));
        
        if (result.rows.length === 0) {
            console.log('No mercy token activity in the specified period.');
            return { period: `${hours}h`, users: [] };
        }
        
        result.rows.forEach((row, index) => {
            console.log(`${index + 1}. ${row.username} (ID: ${row.id})`);
            console.log(`   Mercy tokens: ${row.mercy_tokens_granted}`);
            console.log(`   Total amount: ${row.total_mercy_amount}`);
            
            if (row.first_mercy && row.last_mercy) {
                const timeSpan = new Date(row.last_mercy) - new Date(row.first_mercy);
                const timeSpanHours = Math.round(timeSpan / 3600000 * 10) / 10;
                console.log(`   Time span: ${timeSpanHours}h`);
            } else {
                console.log(`   Time span: N/A (no timestamp data)`);
            }
            console.log('');
        });
        
        return { 
            period: `${hours}h`, 
            users: result.rows,
            totalUsers: result.rows.length,
            totalTokensGranted: result.rows.reduce((sum, row) => sum + parseInt(row.mercy_tokens_granted), 0)
        };
        
    } catch (error) {
        console.error('Error generating security report:', error);
        return { error: error.message };
    }
};

module.exports = {
    logMercyTokenAttempt,
    checkSuspiciousActivity,
    generateSecurityReport
};