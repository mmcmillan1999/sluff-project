'use strict';

const DEFAULT_LEDGER_PAGE_SIZE = 50;
const MAX_LEDGER_PAGE_SIZE = 100;

const TOKEN_LEDGER_CATEGORIES = Object.freeze({
    game: Object.freeze([
        'buy_in',
        'win_payout',
        'wash_payout',
        'forfeit_loss',
        'forfeit_payout',
    ]),
    mercy: Object.freeze(['free_token_mercy']),
    adjustment: Object.freeze(['admin_adjustment']),
    refund: Object.freeze(['abandoned_refund']),
});

const LEDGER_BALANCE_QUERY = `
    SELECT (COALESCE(SUM(amount), 0) * 100)::bigint AS current_balance_cents
    FROM transactions
    WHERE user_id = $1
`;

// Running balances and game nets are intentionally calculated in full_ledger,
// before either the category or cursor filter is applied. An older page must
// therefore show the same balance-after value as the unpaginated history.
const LEDGER_PAGE_QUERY = `
    WITH full_ledger AS (
        SELECT
            t.transaction_id,
            t.transaction_time,
            t.transaction_type::text AS transaction_type,
            t.description,
            t.game_id,
            (t.amount * 100)::bigint AS amount_cents,
            (
                SUM(t.amount) OVER (
                    PARTITION BY t.user_id
                    ORDER BY t.transaction_id
                    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                ) * 100
            )::bigint AS balance_after_cents,
            CASE
                WHEN t.game_id IS NULL THEN NULL
                ELSE (
                    SUM(t.amount) OVER (PARTITION BY t.user_id, t.game_id) * 100
                )::bigint
            END AS game_net_cents,
            CASE
                WHEN t.transaction_type::text IN (
                    'buy_in', 'win_payout', 'wash_payout', 'forfeit_loss', 'forfeit_payout'
                ) THEN 'game'
                WHEN t.transaction_type::text = 'free_token_mercy' THEN 'mercy'
                WHEN t.transaction_type::text = 'admin_adjustment' THEN 'adjustment'
                WHEN t.transaction_type::text = 'abandoned_refund' THEN 'refund'
                ELSE 'adjustment'
            END AS category
        FROM transactions t
        WHERE t.user_id = $1
    )
    SELECT
        ledger.transaction_id,
        ledger.transaction_time,
        ledger.transaction_type,
        ledger.description,
        ledger.game_id,
        ledger.amount_cents,
        ledger.balance_after_cents,
        ledger.game_net_cents,
        ledger.category,
        game.theme AS game_theme,
        game.outcome AS game_outcome,
        game.start_time AS game_started_at,
        game.end_time AS game_ended_at
    FROM full_ledger ledger
    LEFT JOIN game_history game ON game.game_id = ledger.game_id
    WHERE ($2::bigint IS NULL OR ledger.transaction_id < $2)
      AND ($3::text IS NULL OR ledger.category = $3)
    ORDER BY ledger.transaction_id DESC
    LIMIT $4
`;

function singleQueryValue(value, name) {
    if (Array.isArray(value)) {
        const error = new TypeError(`${name} must be supplied once.`);
        error.statusCode = 400;
        throw error;
    }
    return value;
}

function parseLedgerPageOptions(query = {}) {
    const rawLimit = singleQueryValue(query.limit, 'limit');
    const rawCursor = singleQueryValue(query.cursor, 'cursor');
    const rawCategory = singleQueryValue(query.category, 'category');

    const limit = rawLimit === undefined || rawLimit === ''
        ? DEFAULT_LEDGER_PAGE_SIZE
        : Number(rawLimit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LEDGER_PAGE_SIZE) {
        const error = new TypeError(`limit must be an integer from 1 through ${MAX_LEDGER_PAGE_SIZE}.`);
        error.statusCode = 400;
        throw error;
    }

    const cursor = rawCursor === undefined || rawCursor === ''
        ? null
        : Number(rawCursor);
    if (cursor !== null && (!Number.isSafeInteger(cursor) || cursor <= 0)) {
        const error = new TypeError('cursor must be a positive transaction id.');
        error.statusCode = 400;
        throw error;
    }

    const normalizedCategory = rawCategory === undefined || rawCategory === '' || rawCategory === 'all'
        ? null
        : String(rawCategory).toLowerCase();
    if (normalizedCategory !== null
        && !Object.prototype.hasOwnProperty.call(TOKEN_LEDGER_CATEGORIES, normalizedCategory)) {
        const error = new TypeError('category must be game, mercy, adjustment, or refund.');
        error.statusCode = 400;
        throw error;
    }

    return { category: normalizedCategory, cursor, limit };
}

function databaseInteger(value, fieldName) {
    const number = typeof value === 'number' ? value : Number(value);
    if (!Number.isSafeInteger(number)) {
        throw new RangeError(`Database returned an invalid ${fieldName}.`);
    }
    return number;
}

function publicLedgerEntry(row) {
    const gameId = row.game_id === null || row.game_id === undefined
        ? null
        : databaseInteger(row.game_id, 'game id');
    return {
        id: databaseInteger(row.transaction_id, 'transaction id'),
        occurredAt: row.transaction_time,
        type: row.transaction_type,
        category: row.category,
        amountCents: databaseInteger(row.amount_cents, 'transaction amount'),
        balanceAfterCents: databaseInteger(row.balance_after_cents, 'running balance'),
        description: row.description ?? null,
        gameId,
        gameNetCents: gameId === null
            ? null
            : databaseInteger(row.game_net_cents, 'game net'),
        gameTheme: gameId === null ? null : (row.game_theme ?? null),
        gameOutcome: gameId === null ? null : (row.game_outcome ?? null),
        gameStartedAt: gameId === null ? null : (row.game_started_at ?? null),
        gameEndedAt: gameId === null ? null : (row.game_ended_at ?? null),
    };
}

async function readTokenLedgerPage(pool, userId, options) {
    if (!pool || typeof pool.connect !== 'function') {
        throw new TypeError('A database pool with connect() is required.');
    }
    if (!Number.isSafeInteger(userId) || userId <= 0) {
        throw new TypeError('A positive authenticated user id is required.');
    }

    const { category, cursor, limit } = options;
    const client = await pool.connect();
    let transactionOpen = false;
    try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        transactionOpen = true;

        const balanceResult = await client.query(LEDGER_BALANCE_QUERY, [userId]);
        const currentBalanceCents = databaseInteger(
            balanceResult.rows?.[0]?.current_balance_cents ?? 0,
            'current balance',
        );
        const pageResult = await client.query(
            LEDGER_PAGE_QUERY,
            [userId, cursor, category, limit + 1],
        );

        await client.query('COMMIT');
        transactionOpen = false;

        const hasMore = pageResult.rows.length > limit;
        const visibleRows = hasMore ? pageResult.rows.slice(0, limit) : pageResult.rows;
        const entries = visibleRows.map(publicLedgerEntry);
        return {
            currentBalanceCents,
            entries,
            nextCursor: hasMore ? entries.at(-1).id : null,
            hasMore,
        };
    } catch (error) {
        if (transactionOpen) {
            try {
                await client.query('ROLLBACK');
            } catch (rollbackError) {
                console.error('Token-ledger rollback failed:', rollbackError);
            }
        }
        throw error;
    } finally {
        client.release();
    }
}

module.exports = {
    DEFAULT_LEDGER_PAGE_SIZE,
    LEDGER_BALANCE_QUERY,
    LEDGER_PAGE_QUERY,
    MAX_LEDGER_PAGE_SIZE,
    TOKEN_LEDGER_CATEGORIES,
    databaseInteger,
    parseLedgerPageOptions,
    publicLedgerEntry,
    readTokenLedgerPage,
};
