const crypto = require('crypto');

const BOT_NAMES = Object.freeze([
    'Mike Knight',
    'Grandma Joe',
    'Grampa Blane',
    'Kimba',
    'Courtney Sr.',
    'Cliff',
    'Ace McGraw',
    'Ruby Rook',
    'Lucky Lou',
    'Dolly Deal',
    'Jack Highwater',
    'Mabel Moon',
    'Buck Wilder',
    'Frankie Four',
    'Doc Shuffle',
    'Ginger Snap',
    'Otis Draw',
    'Vera Hearts',
    'Benny Bidwell',
    'Rosie Rounds',
]);

const BOT_STARTING_TOKENS = 8;
const BOT_SEED_ADVISORY_LOCK_ID = 739126441;

function botSlug(username) {
    return username
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

function botEmail(username) {
    return `${botSlug(username)}@bots.sluff.invalid`;
}

function botPasswordHash(username) {
    const digest = crypto
        .createHash('sha256')
        .update(`sluff:server-only-bot:${username}:v1`)
        .digest('hex');
    // Deliberately not a bcrypt credential. Public authentication excludes bot
    // accounts before password comparison, and this marker cannot be used to
    // sign in even if a reserved address is discovered.
    return `$server-only$sha256$${digest}`;
}

function botStartingBalanceKey(username) {
    return `bot-account:${botSlug(username)}:starting-balance:v1`;
}

async function loadBotAccounts(queryable) {
    const { rows } = await queryable.query(
        `SELECT
            u.id,
            u.username,
            COALESCE(SUM(t.amount), 0) AS tokens
         FROM users u
         LEFT JOIN transactions t ON t.user_id = u.id
         WHERE u.is_bot = TRUE
           AND u.username = ANY($1::text[])
         GROUP BY u.id, u.username
         ORDER BY array_position($1::text[], u.username)`,
        [BOT_NAMES],
    );

    const loadedNames = rows.map(row => row.username);
    const hasCanonicalOrder = loadedNames.every((username, index) => username === BOT_NAMES[index]);
    if (rows.length !== BOT_NAMES.length || !hasCanonicalOrder) {
        throw new Error(
            `Expected the ${BOT_NAMES.length} canonical bot accounts in canonical order.`,
        );
    }

    return rows.map(row => ({
        id: Number(row.id),
        username: row.username,
        tokens: Number.parseFloat(row.tokens || 0),
        isBot: true,
    }));
}

async function ensureBotAccounts(pool) {
    if (!pool || typeof pool.connect !== 'function') {
        throw new TypeError('A database pool with connect() is required.');
    }

    const client = await pool.connect();
    let transactionOpen = false;

    try {
        await client.query('BEGIN');
        transactionOpen = true;
        // Render can briefly run old and new instances together during a deploy.
        // Serialize the one-time seed across processes so both cannot observe a
        // missing username and race each other to the unique constraint.
        await client.query('SELECT pg_advisory_xact_lock($1)', [BOT_SEED_ADVISORY_LOCK_ID]);
        // Registration does not participate in the bot-specific advisory lock.
        // Briefly block concurrent user writes so a reserved-email absence check
        // cannot race a registration insert before this transaction commits.
        await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');

        for (const username of BOT_NAMES) {
            const reservedEmail = botEmail(username);
            const existingResult = await client.query(
                'SELECT id, is_bot FROM users WHERE username = $1 FOR UPDATE',
                [username],
            );
            const existing = existingResult.rows[0];

            if (existing && existing.is_bot !== true) {
                const error = new Error(
                    `Cannot seed bot "${username}": that username belongs to a player account.`,
                );
                error.code = 'BOT_USERNAME_CONFLICT';
                throw error;
            }

            const emailOwnerResult = await client.query(
                `SELECT id, username, is_bot
                 FROM users
                 WHERE email = $1
                 FOR UPDATE`,
                [reservedEmail],
            );
            const emailOwner = emailOwnerResult.rows[0];
            if (emailOwner && Number(emailOwner.id) !== Number(existing?.id)) {
                const error = new Error(
                    `Cannot seed bot "${username}": reserved email "${reservedEmail}" belongs to account "${emailOwner.username}".`,
                );
                error.code = 'BOT_EMAIL_CONFLICT';
                throw error;
            }

            let botId;
            if (existing) {
                botId = existing.id;
                await client.query(
                    `UPDATE users
                     SET email = $1,
                         password_hash = $2,
                         is_bot = TRUE,
                         is_admin = FALSE,
                         is_verified = TRUE,
                         verification_token = NULL,
                         verification_token_expires = NULL,
                         password_reset_token = NULL,
                         password_reset_token_expires = NULL,
                         tutorial_version = 0,
                         tutorial_active_version = 0
                     WHERE id = $3
                       AND is_bot = TRUE`,
                    [reservedEmail, botPasswordHash(username), botId],
                );
            } else {
                const insertResult = await client.query(
                    `INSERT INTO users (
                        username,
                        email,
                        password_hash,
                        is_bot,
                        is_admin,
                        is_verified,
                        tutorial_version,
                        tutorial_active_version
                     ) VALUES ($1, $2, $3, TRUE, FALSE, TRUE, 0, 0)
                     RETURNING id`,
                    [username, reservedEmail, botPasswordHash(username)],
                );
                botId = insertResult.rows[0].id;
            }

            await client.query(
                `INSERT INTO transactions (
                    user_id,
                    amount,
                    transaction_type,
                    description,
                    idempotency_key
                 ) VALUES ($1, $2, 'admin_adjustment', $3, $4)
                 ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL
                 DO NOTHING`,
                [
                    botId,
                    BOT_STARTING_TOKENS,
                    'New bot starting balance',
                    botStartingBalanceKey(username),
                ],
            );

            const startingGrantResult = await client.query(
                `SELECT user_id, amount, transaction_type
                 FROM transactions
                 WHERE idempotency_key = $1`,
                [botStartingBalanceKey(username)],
            );
            const startingGrant = startingGrantResult.rows[0];
            if (
                Number(startingGrant?.user_id) !== Number(botId)
                || Number(startingGrant?.amount) !== BOT_STARTING_TOKENS
                || startingGrant?.transaction_type !== 'admin_adjustment'
            ) {
                const error = new Error(`Bot starting-balance ledger conflict for "${username}".`);
                error.code = 'BOT_STARTING_BALANCE_CONFLICT';
                throw error;
            }
        }

        const accounts = await loadBotAccounts(client);
        await client.query('COMMIT');
        transactionOpen = false;
        return accounts;
    } catch (error) {
        if (transactionOpen) await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

module.exports = {
    BOT_NAMES,
    BOT_SEED_ADVISORY_LOCK_ID,
    BOT_STARTING_TOKENS,
    botEmail,
    botStartingBalanceKey,
    ensureBotAccounts,
    loadBotAccounts,
};
