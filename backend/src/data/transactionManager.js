// backend/src/data/transactionManager.js

const { TABLE_COSTS } = require('../core/constants');
const gameLogic = require('../core/logic'); // Need this for payout calculations

const createGameRecord = async (pool, table) => { /* ... (no change) ... */ };
const postTransaction = async (pool, { userId, gameId, type, amount, description }) => { /* ... (no change) ... */ };
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
        
        // Provide more specific error messages based on the error type
        if (error.message.includes('insufficient tokens')) {
            throw error; // Re-throw the specific insufficient tokens error
        } else if (error.code === '23505') { // PostgreSQL unique constraint violation
            throw new Error('A duplicate transaction was detected. Please try again.');
        } else if (error.code === '40001') { // PostgreSQL serialization failure
            throw new Error('Transaction conflict detected. Please try again.');
        } else {
            throw new Error('Failed to process game start transaction. Please contact support if this persists.');
        }
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
};