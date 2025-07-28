// backend/src/data/transactionManager.js

const { TABLE_COSTS } = require('../core/constants');
const gameLogic = require('../core/logic'); // Need this for payout calculations
const securityMonitor = require('../utils/securityMonitor');

const createGameRecord = async (pool, table) => { /* ... (no change) ... */ };

const postTransaction = async (pool, { userId, gameId, type, amount, description }) => {
    // Input validation
    if (!userId || typeof userId !== 'number') {
        throw new Error('Invalid userId provided');
    }
    if (!type || typeof type !== 'string') {
        throw new Error('Invalid transaction type provided');
    }
    if (amount === undefined || amount === null || isNaN(amount)) {
        throw new Error('Invalid amount provided');
    }
    if (!description || typeof description !== 'string') {
        throw new Error('Invalid description provided');
    }

    const client = await pool.connect();
    try {
        const insertQuery = gameId 
            ? 'INSERT INTO transactions (user_id, game_id, transaction_type, amount, description) VALUES ($1, $2, $3, $4, $5)'
            : 'INSERT INTO transactions (user_id, transaction_type, amount, description) VALUES ($1, $2, $3, $4)';
        
        const params = gameId 
            ? [userId, gameId, type, amount, description]
            : [userId, type, amount, description];
            
        await client.query(insertQuery, params);
        console.log(`✅ Transaction posted: User ${userId}, Type: ${type}, Amount: ${amount}`);
    } catch (error) {
        console.error(`❌ Failed to post transaction for user ${userId}:`, error);
        throw error;
    } finally {
        client.release();
    }
};

// New atomic mercy token handler with rate limiting and proper validation
const handleMercyTokenRequest = async (pool, userId, username = null) => {
    // Input validation
    if (!userId || typeof userId !== 'number') {
        throw new Error('Invalid userId provided');
    }

    // Get username for logging if not provided
    if (!username) {
        try {
            const userResult = await pool.query('SELECT username FROM users WHERE id = $1', [userId]);
            username = userResult.rows[0]?.username || `User_${userId}`;
        } catch (err) {
            username = `User_${userId}`;
        }
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Check current token balance
        const tokenQuery = "SELECT SUM(amount) AS current_tokens FROM transactions WHERE user_id = $1";
        const tokenResult = await client.query(tokenQuery, [userId]);
        const currentTokens = parseFloat(tokenResult.rows[0]?.current_tokens || 0);
        
        if (currentTokens >= 5) {
            await client.query('ROLLBACK');
            securityMonitor.logMercyTokenAttempt(userId, username, false, 'Token limit exceeded', { currentTokens });
            return {
                success: false,
                error: "Sorry, free tokens are only for players with fewer than 5 tokens.",
                currentTokens
            };
        }

        // Check rate limiting - only allow one mercy token per hour
        // First, check if transaction_time column exists
        let rateLimitQuery;
        let hasTransactionTimeColumn = true;
        
        try {
            // Try to query with transaction_time column
            rateLimitQuery = `
                SELECT COUNT(*) as mercy_count, MAX(transaction_time) as last_mercy_time
                FROM transactions 
                WHERE user_id = $1 
                AND transaction_type = 'free_token_mercy' 
                AND transaction_time > NOW() - INTERVAL '1 hour'
            `;
            const rateLimitResult = await client.query(rateLimitQuery, [userId]);
            const mercyCount = parseInt(rateLimitResult.rows[0]?.mercy_count || 0);
            const lastMercyTime = rateLimitResult.rows[0]?.last_mercy_time;

            if (mercyCount > 0) {
                await client.query('ROLLBACK');
                const timeLeft = Math.ceil((new Date(lastMercyTime).getTime() + 3600000 - Date.now()) / 60000);
                securityMonitor.logMercyTokenAttempt(userId, username, false, 'Rate limit exceeded', { timeLeft, lastMercyTime });
                return {
                    success: false,
                    error: `You can only request one mercy token per hour. Please wait ${timeLeft} more minutes.`,
                    currentTokens,
                    timeLeft
                };
            }
        } catch (error) {
            // If transaction_time column doesn't exist, fall back to simpler rate limiting
            if (error.code === '42703') { // Column does not exist error
                console.warn('⚠️ transaction_time column not found, using fallback rate limiting');
                hasTransactionTimeColumn = false;
                
                // Simple fallback: just check if user has gotten any mercy tokens recently
                // This is less precise but will work until the database is migrated
                const fallbackQuery = `
                    SELECT COUNT(*) as mercy_count
                    FROM transactions 
                    WHERE user_id = $1 
                    AND transaction_type = 'free_token_mercy'
                `;
                const fallbackResult = await client.query(fallbackQuery, [userId]);
                const totalMercyTokens = parseInt(fallbackResult.rows[0]?.mercy_count || 0);
                
                // For fallback, allow mercy token if user has fewer than 3 total mercy tokens
                // This is a temporary measure until the column is added
                if (totalMercyTokens >= 3) {
                    await client.query('ROLLBACK');
                    securityMonitor.logMercyTokenAttempt(userId, username, false, 'Fallback rate limit exceeded', { totalMercyTokens });
                    return {
                        success: false,
                        error: `You have reached the maximum number of mercy tokens. Please contact an administrator if you need assistance.`,
                        currentTokens
                    };
                }
            } else {
                // Re-throw other errors
                throw error;
            }
        }

        // Check for suspicious activity before granting token
        const suspiciousCheck = await securityMonitor.checkSuspiciousActivity(pool, userId);
        if (suspiciousCheck.suspicious) {
            // Still grant the token but flag for admin review
            console.warn(`🚨 Granting mercy token to flagged user ${username} (${userId}): ${suspiciousCheck.flags.join(', ')}`);
        }

        // Insert the mercy token transaction
        const insertQuery = `
            INSERT INTO transactions (user_id, transaction_type, amount, description) 
            VALUES ($1, 'free_token_mercy', 1, 'Mercy token requested by user')
        `;
        await client.query(insertQuery, [userId]);

        await client.query('COMMIT');
        
        // Log successful mercy token grant
        securityMonitor.logMercyTokenAttempt(userId, username, true, 'Mercy token granted', { 
            previousBalance: currentTokens, 
            newBalance: currentTokens + 1,
            suspicious: suspiciousCheck.suspicious
        });

        return {
            success: true,
            message: "1 free token has been added to your account!",
            previousBalance: currentTokens,
            newBalance: currentTokens + 1
        };

    } catch (error) {
        await client.query('ROLLBACK');
        securityMonitor.logMercyTokenAttempt(userId, username, false, 'Database error', { error: error.message });
        console.error(`❌ Mercy token request failed for user ${userId}:`, error);
        throw error;
    } finally {
        client.release();
    }
};

const updateGameRecordOutcome = async (pool, gameId, outcome) => { /* ... (no change) ... */ };

const handleGameStartTransaction = async (pool, table, playerIds, gameId) => {
    const cost = -(TABLE_COSTS[table.theme] || 1);
    const description = `Table buy-in for game #${gameId}`;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const balanceQuery = `
            SELECT user_id, SUM(amount) as current_tokens 
            FROM transactions 
            WHERE user_id = ANY($1::int[]) 
            GROUP BY user_id;
        `;
        const balanceResult = await client.query(balanceQuery, [playerIds]);
        
        const playerBalances = balanceResult.rows.reduce((acc, row) => {
            acc[row.user_id] = parseFloat(row.current_tokens);
            return acc;
        }, {});

        for (const userId of playerIds) {
            const balance = playerBalances[userId] || 0;
            if (balance < Math.abs(cost)) {
                const userRes = await client.query('SELECT username FROM users WHERE id = $1', [userId]);
                const username = userRes.rows[0]?.username || `Player ID ${userId}`;
                throw new Error(`${username} has insufficient tokens. Needs ${Math.abs(cost)}, but has ${balance.toFixed(2)}.`);
            }
        }

        const transactionPromises = playerIds.map(userId => {
            const insertQuery = `
                INSERT INTO transactions(user_id, game_id, transaction_type, amount, description) 
                VALUES($1, $2, 'buy_in', $3, $4);
            `;
            return client.query(insertQuery, [userId, gameId, cost, description]);
        });
        
        await Promise.all(transactionPromises);

        await client.query('COMMIT');
        console.log(`✅ Game start buy-in transaction successful for game ${gameId}`);
        
        // Return updated balances
        const updatedBalances = {};
        for (const userId of playerIds) {
            updatedBalances[userId] = (playerBalances[userId] || 0) + cost;
        }
        return updatedBalances;

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("❌ Game start transaction failed and was rolled back:", error.message);
        throw error; 
    } finally {
        client.release();
    }
};

// --- NEW ROBUST FUNCTION WITH LOGGING ---
const handleDrawTransactions = async (pool, table, outcome) => {
    const client = await pool.connect();
    console.log(`[DB] Starting DRAW transaction for game_id ${table.gameId}, outcome: ${outcome}`);
    try {
        await client.query('BEGIN');

        const tableCost = TABLE_COSTS[table.theme] || 0;
        const gameId = table.gameId;
        const humanPlayers = Object.values(table.players).filter(p => !p.isBot && !p.isSpectator);
        const statPromises = [];
        const transactionPromises = [];
        const summaryData = {
            isGameOver: true,
            drawOutcome: outcome,
            gameWinner: "Draw",
            payouts: {},
            finalScores: table.scores,
        };

        if (outcome === 'wash') {
            console.log(`[DB] Processing WASH payouts for ${humanPlayers.length} players.`);
            for (const player of humanPlayers) {
                summaryData.payouts[player.playerName] = { totalReturn: tableCost };
                transactionPromises.push(client.query(
                    `INSERT INTO transactions (user_id, game_id, transaction_type, amount, description) VALUES ($1, $2, 'wash_payout', $3, $4)`,
                    [player.userId, gameId, tableCost, `Draw (Wash) - Buy-in returned`]
                ));
                statPromises.push(client.query("UPDATE users SET washes = washes + 1 WHERE id = $1", [player.userId]));
            }
        } else if (outcome === 'split') {
            console.log(`[DB] Calculating SPLIT payouts...`);
            const splitResult = gameLogic.calculateDrawSplitPayout(table);
            if (splitResult.wash) { // Fallback for 4-player games etc.
                console.log(`[DB] Split cannot be calculated, falling back to WASH.`);
                return await handleDrawTransactions(pool, table, 'wash'); // Recursive call with 'wash'
            }
            summaryData.payouts = splitResult.payouts;
            for (const playerName in splitResult.payouts) {
                const payoutInfo = splitResult.payouts[playerName];
                console.log(`[DB] Processing SPLIT payout for ${playerName}: ${payoutInfo.totalReturn.toFixed(2)} tokens.`);
                transactionPromises.push(client.query(
                    `INSERT INTO transactions (user_id, game_id, transaction_type, amount, description) VALUES ($1, $2, 'win_payout', $3, $4)`,
                    [payoutInfo.userId, gameId, payoutInfo.totalReturn, `Draw (Split) - Payout`]
                ));
                statPromises.push(client.query("UPDATE users SET washes = washes + 1 WHERE id = $1", [payoutInfo.userId]));
            }
        }

        await Promise.all(transactionPromises);
        console.log(`[DB] ${transactionPromises.length} transaction records posted.`);
        await Promise.all(statPromises);
        console.log(`[DB] ${statPromises.length} user stat records updated.`);
        
        await client.query(`UPDATE game_history SET outcome = $1, end_time = NOW() WHERE game_id = $2`, [`Game Over! Draw (${outcome})`, gameId]);
        console.log(`[DB] Finalized game_history for game_id ${gameId}.`);
        
        await client.query('COMMIT');
        console.log(`[DB] ✅ DRAW transaction for game_id ${gameId} committed successfully.`);
        return summaryData;

    } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[DB] ❌ DRAW transaction for game_id ${table.gameId} FAILED and was rolled back. Error:`, err);
        throw err; // Re-throw the error to be caught by the service
    } finally {
        client.release();
    }
};

module.exports = {
    createGameRecord,
    postTransaction,
    updateGameRecordOutcome,
    handleGameStartTransaction,
    handleDrawTransactions, // EXPORT NEW FUNCTION
    handleMercyTokenRequest, // EXPORT NEW FUNCTION
};