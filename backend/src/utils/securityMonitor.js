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
        const suspiciousActivityQuery = `
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
        
        const result = await pool.query(suspiciousActivityQuery, [userId]);
        const stats = result.rows[0];
        
        const flags = [];
        
        // Flag if user has gotten multiple mercy tokens in 24 hours
        if (parseInt(stats.successful_mercy) > 3) {
            flags.push(`Multiple mercy tokens in 24h: ${stats.successful_mercy}`);
        }
        
        // Flag rapid-fire attempts (would need additional tracking for failed attempts)
        const timeSpan = new Date(stats.last_attempt) - new Date(stats.first_attempt);
        if (parseInt(stats.total_attempts) > 5 && timeSpan < 3600000) { // 5 attempts in 1 hour
            flags.push(`Rapid attempts: ${stats.total_attempts} in ${Math.round(timeSpan/60000)} minutes`);
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
        const reportQuery = `
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
        
        const result = await pool.query(reportQuery);
        
        console.log(`\n📊 [SECURITY REPORT] Mercy Token Activity (Last ${hours} hours)`);
        console.log('='.repeat(70));
        
        if (result.rows.length === 0) {
            console.log('No mercy token activity in the specified period.');
            return { period: `${hours}h`, users: [] };
        }
        
        result.rows.forEach((row, index) => {
            const timeSpan = new Date(row.last_mercy) - new Date(row.first_mercy);
            const timeSpanHours = Math.round(timeSpan / 3600000 * 10) / 10;
            
            console.log(`${index + 1}. ${row.username} (ID: ${row.id})`);
            console.log(`   Mercy tokens: ${row.mercy_tokens_granted}`);
            console.log(`   Total amount: ${row.total_mercy_amount}`);
            console.log(`   Time span: ${timeSpanHours}h`);
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