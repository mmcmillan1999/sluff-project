// backend/src/data/transactionManager.js

const { TABLE_COSTS } = require('../core/constants');
const securityMonitor = require('../utils/securityMonitor');
const { acquireSeasonLock } = require('../services/seasonService');
const {
    buildDrawSettlement,
    buildForfeitSettlement,
    buildNormalGameSettlement,
} = require('../settlement/gameSettlement');

// The bot refill floor sits BELOW Shirecliff's 5-token buy-in on purpose
// (Matt, Aug 6 2026): a refilled bot can always afford Fort Creek (1), but
// must WIN at least two net tokens before the mid-stakes room will seat it
// — the table ladder becomes a fitness sort across the bot brains.
const BOT_MERCY_THRESHOLD = 3;

// Caller must hold the users row lock and an open transaction. This is kept
// server-internal: public mercy requests still use handleMercyTokenRequest
// (which keeps its one-per-hour human policy) and cannot assert that a
// principal is a bot. Bots get no wait period (Matt, Aug 6 2026 — "I see
// some broke bots out there"): a bot below the floor refills straight TO
// the floor, every time the funding gate finds it short. The inflow stays
// bounded — it only fires below the floor, only as fast as games start.
async function maybeGrantAutomaticBotMercyWithinTransaction(
    client,
    { userId, username, isBot, currentTokens },
) {
    const balance = Number(currentTokens) || 0;
    if (isBot !== true) return { granted: false, reason: 'not_bot', currentTokens: balance };
    if (balance >= BOT_MERCY_THRESHOLD) {
        return { granted: false, reason: 'balance_not_below_threshold', currentTokens: balance };
    }

    const grantAmount = Number((BOT_MERCY_THRESHOLD - balance).toFixed(2));
    await client.query(
        `INSERT INTO transactions (user_id, transaction_type, amount, description)
         VALUES ($1, 'free_token_mercy', $2, $3)`,
        [userId, grantAmount, `Automatic mercy refill for bot ${username || userId} back to ${BOT_MERCY_THRESHOLD} tokens`],
    );
    return {
        granted: true,
        reason: 'granted',
        previousBalance: balance,
        grantAmount,
        currentTokens: BOT_MERCY_THRESHOLD,
    };
}

const handleAutomaticBotMercyToken = async (pool, userId) => {
    if (!Number.isInteger(userId) || userId <= 0) {
        throw new TypeError('Automatic bot mercy requires a positive integer user id');
    }

    const client = await pool.connect();
    let transactionOpen = false;
    try {
        await client.query('BEGIN');
        transactionOpen = true;
        const userResult = await client.query(
            `SELECT id, username, is_bot
             FROM users
             WHERE id = $1
             FOR UPDATE`,
            [userId],
        );
        const account = userResult.rows[0];
        if (!account) {
            const error = new Error(`Bot account ${userId} does not exist.`);
            error.code = 'BOT_ACCOUNT_NOT_FOUND';
            throw error;
        }
        if (account.is_bot !== true) {
            const error = new Error(`User ${userId} is not a bot account.`);
            error.code = 'BOT_ACCOUNT_REQUIRED';
            throw error;
        }
        const balanceResult = await client.query(
            `SELECT COALESCE(SUM(amount), 0) AS current_tokens
             FROM transactions
             WHERE user_id = $1`,
            [userId],
        );
        const result = await maybeGrantAutomaticBotMercyWithinTransaction(client, {
            userId,
            username: account.username,
            isBot: account.is_bot,
            currentTokens: balanceResult.rows[0]?.current_tokens,
        });
        await client.query('COMMIT');
        transactionOpen = false;
        return result;
    } catch (error) {
        if (transactionOpen) await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

// (createGameRecord, the non-atomic legacy start, lived here until Sept 2026.)
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

        // Serialize all balance/rate-limit decisions for this account. Without
        // the row lock, parallel requests can each observe zero recent grants
        // and all insert a mercy token before any sibling transaction commits.
        // Game starts lock the same row, so grants and buy-ins now coordinate.
        const lockedAccountResult = await client.query(
            'SELECT id, is_bot FROM users WHERE id = $1 FOR UPDATE',
            [userId],
        );
        if (lockedAccountResult.rows[0]?.is_bot === true) {
            await client.query('ROLLBACK');
            securityMonitor.logMercyTokenAttempt(
                userId,
                username,
                false,
                'Bot accounts use automatic mercy',
            );
            return {
                success: false,
                error: 'Bot accounts receive mercy tokens automatically.',
            };
        }

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
        const rateLimitQuery = `
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

        // Check for suspicious activity before granting token
        // Same connection as the row lock we hold: checking out a second pool
        // slot here let ten concurrent mercy requests starve a 10-slot pool.
        const suspiciousCheck = await securityMonitor.checkSuspiciousActivity(client, userId);
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

// (updateGameRecordOutcome and handleGameStartTransaction — an unconditional
// outcome overwrite and a lock-free balance read — were removed Sept 2026.)
// Creates the in-progress game and charges every funded player as one database
// unit.  The user row locks serialize overlapping starts before balances are
// read, while the surrounding transaction guarantees a failed charge cannot
// leave an orphaned game_history row.
const startGameTransaction = async (pool, table, playerIds) => {
    if (!Array.isArray(playerIds)) throw new TypeError('playerIds must be an array');
    const fundedPlayerIds = [...new Set(playerIds)];
    if (fundedPlayerIds.some(id => !Number.isInteger(id) || id <= 0)) {
        throw new TypeError('playerIds must contain positive integer user ids');
    }

    const cost = -(TABLE_COSTS[table.theme] ?? 1);
    const requiredBalance = Math.abs(cost);
    const client = await pool.connect();
    let transactionStarted = false;

    try {
        await client.query('BEGIN');
        transactionStarted = true;
        // This must be a separate statement. If the lock were inside the
        // INSERT, a statement snapshot taken before a blocked rollover could
        // still see the just-finalized season after the lock is released.
        await acquireSeasonLock(client);
        const gameResult = await client.query(
            `INSERT INTO game_history (table_id, theme, player_count, outcome, season_id)
             SELECT $1, $2, $3, 'In Progress', season_id
             FROM seasons
             WHERE status = 'active'
             RETURNING game_id, season_id`,
            [table.tableId, table.theme, table.playerMode],
        );
        if (gameResult.rows?.length !== 1) {
            const error = new Error('Unable to attach the game to an active season.');
            error.code = 'ACTIVE_SEASON_REQUIRED';
            throw error;
        }
        const gameId = gameResult.rows[0].game_id;

        let lockedUsers = [];
        let balanceRows = [];
        if (fundedPlayerIds.length > 0) {
            const lockedResult = await client.query(
                `SELECT id, username, is_bot
                 FROM users
                 WHERE id = ANY($1::int[])
                 ORDER BY id
                 FOR UPDATE`,
                [fundedPlayerIds],
            );
            lockedUsers = lockedResult.rows;

            const balanceResult = await client.query(
                `SELECT user_id, COALESCE(SUM(amount), 0) AS current_tokens
                 FROM transactions
                 WHERE user_id = ANY($1::int[])
                 GROUP BY user_id`,
                [fundedPlayerIds],
            );
            balanceRows = balanceResult.rows;
        }

        const usernames = Object.fromEntries(lockedUsers.map(row => [row.id, row.username]));
        const playerBalances = Object.fromEntries(
            balanceRows.map(row => [row.user_id, parseFloat(row.current_tokens || 0)]),
        );

        for (const account of lockedUsers) {
            const mercy = await maybeGrantAutomaticBotMercyWithinTransaction(client, {
                userId: account.id,
                username: account.username,
                isBot: account.is_bot,
                currentTokens: playerBalances[account.id] || 0,
            });
            if (mercy.granted) playerBalances[account.id] = mercy.currentTokens;
        }

        for (const userId of fundedPlayerIds) {
            const balance = playerBalances[userId] || 0;
            if (balance < requiredBalance) {
                const username = usernames[userId] || `Player ID ${userId}`;
                throw new Error(`${username} has insufficient tokens. Needs ${requiredBalance}, but has ${balance.toFixed(2)}.`);
            }
        }

        for (const userId of fundedPlayerIds) {
            await client.query(
                `INSERT INTO transactions
                    (user_id, game_id, transaction_type, amount, description)
                 VALUES ($1, $2, 'buy_in', $3, $4)`,
                [userId, gameId, cost, `Table buy-in for game #${gameId}`],
            );
        }

        await client.query('COMMIT');

        const updatedTokens = {};
        for (const userId of fundedPlayerIds) {
            updatedTokens[userId] = (playerBalances[userId] || 0) + cost;
        }
        console.log(`âœ… Atomic game start committed for game ${gameId}`);
        return { gameId, updatedTokens };
    } catch (error) {
        if (transactionStarted) await client.query('ROLLBACK');
        console.error('âŒ Atomic game start failed and was rolled back:', error.message);
        throw error;
    } finally {
        client.release();
    }
};

const SETTLEMENT_STAT_COLUMNS = new Set(['wins', 'losses', 'washes']);

class SettlementConflictError extends Error {
    constructor(gameId, expectedOutcome, persistedOutcome) {
        super(`Game ${gameId} is already settled as "${persistedOutcome}", not "${expectedOutcome}".`);
        this.name = 'SettlementConflictError';
        this.code = 'SETTLEMENT_CONFLICT';
    }
}

async function settleGameTransaction(pool, settlement) {
    validateSettlement(settlement);
    const client = await pool.connect();
    let transactionOpen = false;

    try {
        await client.query('BEGIN');
        transactionOpen = true;

        const gameResult = await client.query(
            'SELECT outcome, season_id FROM game_history WHERE game_id = $1 FOR UPDATE',
            [settlement.gameId],
        );
        if (!gameResult.rows?.length) {
            const error = new Error(`Game history row ${settlement.gameId} does not exist.`);
            error.code = 'SETTLEMENT_GAME_NOT_FOUND';
            throw error;
        }

        const persistedOutcome = gameResult.rows[0].outcome;
        const seasonId = Number(gameResult.rows[0].season_id);
        if (persistedOutcome !== 'In Progress') {
            if (persistedOutcome !== settlement.outcome) {
                throw new SettlementConflictError(
                    settlement.gameId,
                    settlement.outcome,
                    persistedOutcome,
                );
            }
            await client.query('COMMIT');
            transactionOpen = false;
            return { ...settlement.result, alreadySettled: true };
        }

        const userIds = [...new Set([
            ...settlement.payouts.map(payout => payout.userId),
            ...settlement.stats.map(stat => stat.userId),
        ])].sort((left, right) => left - right);
        if (userIds.length > 0) {
            const lockedUsers = await client.query(
                `SELECT id FROM users
                 WHERE id = ANY($1::int[])
                 ORDER BY id
                 FOR UPDATE`,
                [userIds],
            );
            if ((lockedUsers.rows || []).length !== userIds.length) {
                const error = new Error(`One or more funded users for game ${settlement.gameId} no longer exist.`);
                error.code = 'SETTLEMENT_USER_NOT_FOUND';
                throw error;
            }
        }

        // The payouts were priced from live TABLE_COSTS at settlement time;
        // the buy-ins were charged at game start. Games survive deploys now,
        // so a table-cost edit mid-game would mint or burn the difference.
        // The ledger is the authority: refuse to pay out anything other than
        // exactly what was charged. (No buy-in rows at all — a free table, or
        // an older test double — leaves nothing to reconcile against.)
        const chargedResult = await client.query(
            `SELECT COALESCE(SUM(-amount), 0) AS charged
             FROM transactions
             WHERE game_id = $1
               AND transaction_type = 'buy_in'
               AND reverses_transaction_id IS NULL`,
            [settlement.gameId],
        );
        const chargedCents = Math.round(Number(chargedResult.rows?.[0]?.charged || 0) * 100);
        const payoutCents = settlement.payouts.reduce((sum, payout) => sum + Number(payout.amountCents || 0), 0);
        if (chargedCents > 0 && payoutCents !== chargedCents) {
            const error = new Error(
                `Settlement for game ${settlement.gameId} would pay out ${payoutCents} cents against ${chargedCents} cents of buy-ins.`,
            );
            error.code = 'SETTLEMENT_POT_MISMATCH';
            throw error;
        }

        for (const payout of settlement.payouts) {
            await client.query(
                `INSERT INTO transactions
                    (user_id, game_id, transaction_type, amount, description)
                 VALUES ($1, $2, $3, $4, $5)`,
                [
                    payout.userId,
                    settlement.gameId,
                    payout.type,
                    (payout.amountCents / 100).toFixed(2),
                    payout.description,
                ],
            );
        }

        for (const stat of settlement.stats) {
            await client.query(
                `UPDATE users SET ${stat.column} = ${stat.column} + 1 WHERE id = $1`,
                [stat.userId],
            );
            // game_history.season_id is NOT NULL in the real schema. The guard
            // keeps older test doubles that only return outcome compatible.
            if (Number.isInteger(seasonId) && seasonId > 0) {
                await client.query(
                    `INSERT INTO season_player_stats
                        (season_id, user_id, ${stat.column})
                     VALUES ($1, $2, 1)
                     ON CONFLICT (season_id, user_id) DO UPDATE
                     SET ${stat.column} = season_player_stats.${stat.column} + 1,
                         updated_at = CURRENT_TIMESTAMP`,
                    [seasonId, stat.userId],
                );
            }
        }

        // A funded bot that finishes below the floor refills right
        // here — no wait period for bots. This happens inside settlement so
        // a payout/stat failure cannot leave a detached grant.
        let botAccounts = [];
        if (settlement.botUserIds.length > 0) {
            const botResult = await client.query(
                `SELECT id, username, is_bot
                 FROM users
                 WHERE id = ANY($1::int[])
                 ORDER BY id`,
                [settlement.botUserIds],
            );
            botAccounts = (botResult.rows || []).filter(row => row.is_bot === true);
            if (botAccounts.length !== settlement.botUserIds.length) {
                const error = new Error(`One or more funded bots for game ${settlement.gameId} are not bot accounts.`);
                error.code = 'SETTLEMENT_BOT_IDENTITY_MISMATCH';
                throw error;
            }
        }
        if (botAccounts.length > 0) {
            const botIds = botAccounts.map(row => row.id);
            const balanceResult = await client.query(
                `SELECT user_id, COALESCE(SUM(amount), 0) AS current_tokens
                 FROM transactions
                 WHERE user_id = ANY($1::int[])
                 GROUP BY user_id`,
                [botIds],
            );
            const balances = Object.fromEntries(
                balanceResult.rows.map(row => [row.user_id, Number(row.current_tokens) || 0]),
            );
            for (const account of botAccounts) {
                await maybeGrantAutomaticBotMercyWithinTransaction(client, {
                    userId: account.id,
                    username: account.username,
                    isBot: account.is_bot,
                    currentTokens: balances[account.id] || 0,
                });
            }
        }

        const updateResult = await client.query(
            `UPDATE game_history
             SET outcome = $1, end_time = NOW()
             WHERE game_id = $2 AND outcome = 'In Progress'`,
            [settlement.outcome, settlement.gameId],
        );
        if (updateResult.rowCount === 0) {
            throw new Error(`Game ${settlement.gameId} changed while settlement was locked.`);
        }

        await client.query('COMMIT');
        transactionOpen = false;
        return { ...settlement.result, alreadySettled: false };
    } catch (error) {
        if (transactionOpen) {
            try {
                await client.query('ROLLBACK');
            } catch (rollbackError) {
                console.error(`[DB] Failed to roll back settlement for game ${settlement.gameId}:`, rollbackError);
            }
        }
        throw error;
    } finally {
        client.release();
    }
}

function validateSettlement(settlement) {
    if (!settlement || !Number.isInteger(settlement.gameId) || settlement.gameId <= 0) {
        throw new TypeError('Settlement requires a positive integer gameId');
    }
    if (typeof settlement.outcome !== 'string' || !settlement.outcome) {
        throw new TypeError('Settlement requires a terminal outcome');
    }
    if (!Array.isArray(settlement.payouts) || !Array.isArray(settlement.stats)) {
        throw new TypeError('Settlement requires payout and stat arrays');
    }
    if (!Array.isArray(settlement.botUserIds)
        || settlement.botUserIds.some(id => !Number.isInteger(id) || id <= 0)) {
        throw new TypeError('Invalid settlement bot user ids');
    }
    for (const payout of settlement.payouts) {
        if (!Number.isInteger(payout.userId) || payout.userId <= 0
            || !Number.isInteger(payout.amountCents) || payout.amountCents < 0
            || typeof payout.type !== 'string' || typeof payout.description !== 'string') {
            throw new TypeError('Invalid settlement payout');
        }
    }
    for (const stat of settlement.stats) {
        if (!Number.isInteger(stat.userId) || stat.userId <= 0
            || !SETTLEMENT_STAT_COLUMNS.has(stat.column)) {
            throw new TypeError('Invalid settlement stat update');
        }
    }
}

const handleNormalGameTransactions = async (pool, table) => (
    settleGameTransaction(pool, buildNormalGameSettlement(table))
);

const handleDrawTransactions = async (pool, table, outcome) => (
    settleGameTransaction(pool, buildDrawSettlement(table, outcome))
);

const handleForfeitTransactions = async (pool, table) => (
    settleGameTransaction(pool, buildForfeitSettlement(table))
);

module.exports = {
    BOT_MERCY_THRESHOLD,
    postTransaction,
    startGameTransaction, // legacy exports removed Sept 2026: see notes above
    handleNormalGameTransactions,
    handleDrawTransactions,
    handleForfeitTransactions,
    handleMercyTokenRequest,
    handleAutomaticBotMercyToken,
    settleGameTransaction,
    SettlementConflictError,
};
