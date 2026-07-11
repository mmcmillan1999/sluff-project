'use strict';

const { TABLE_COSTS } = require('../core/constants');

const PAYOUT_TYPES = [
    'win_payout',
    'wash_payout',
    'forfeit_payout',
    'abandoned_refund',
];

const ACCOUNT_SUMMARY_QUERY = `
    SELECT
        u.id AS user_id,
        u.username,
        COALESCE(SUM(t.amount), 0)::numeric(12, 2) AS balance,
        COUNT(t.transaction_id)::integer AS transaction_count,
        COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0)::numeric(12, 2) AS total_credits,
        COALESCE(SUM(t.amount) FILTER (WHERE t.amount < 0), 0)::numeric(12, 2) AS total_debits
    FROM users u
    LEFT JOIN transactions t ON t.user_id = u.id
    WHERE ($1::text IS NULL OR LOWER(u.username) = LOWER($1))
    GROUP BY u.id, u.username
    ORDER BY balance DESC, u.id ASC
`;

const TYPE_TOTALS_QUERY = `
    SELECT
        t.transaction_type::text AS transaction_type,
        COUNT(*)::integer AS transaction_count,
        SUM(t.amount)::numeric(12, 2) AS net_amount
    FROM transactions t
    JOIN users u ON u.id = t.user_id
    WHERE ($1::text IS NULL OR LOWER(u.username) = LOWER($1))
    GROUP BY t.transaction_type
    ORDER BY t.transaction_type
`;

// Refunds deserve their own trail even when they conserve the recorded game
// ledger. A refund issued for a historical game can be economically wrong
// while bringing that game's arithmetic net neatly back to zero, so the
// minted-games report alone cannot surface it. Reading recovery_eligible via
// to_jsonb keeps this operational query usable before and after that migration
// has been deployed.
const ABANDONED_REFUNDS_QUERY = `
    SELECT
        t.transaction_id,
        t.game_id,
        t.user_id,
        u.username,
        t.amount::numeric(12, 2) AS amount,
        t.description,
        t.idempotency_key,
        t.transaction_time,
        gh.theme,
        gh.start_time AS game_started_at,
        gh.end_time AS game_ended_at,
        gh.outcome AS game_outcome,
        gh.reconciliation_status,
        CASE
            WHEN to_jsonb(gh)->>'recovery_eligible' = 'true' THEN TRUE
            WHEN to_jsonb(gh)->>'recovery_eligible' = 'false' THEN FALSE
            ELSE NULL
        END AS recovery_eligible
    FROM transactions t
    JOIN users u ON u.id = t.user_id
    LEFT JOIN game_history gh ON gh.game_id = t.game_id
    WHERE t.transaction_type = 'abandoned_refund'
      AND ($1::text IS NULL OR LOWER(u.username) = LOWER($1))
    ORDER BY t.transaction_id DESC
    LIMIT $2
`;

// Automatic recovery deliberately excludes ambiguous historical games. Keep
// that safety decision visible to operators so quarantine does not become a
// silent black hole. The JSON field lookup also lets the audit run against a
// database immediately before the recovery_eligible migration is deployed.
const QUARANTINED_LEGACY_GAMES_QUERY = `
    SELECT
        gh.game_id,
        gh.table_id,
        gh.theme,
        gh.player_count,
        gh.start_time,
        gh.last_activity_at,
        gh.heartbeat_owner_id,
        COUNT(DISTINCT t.user_id) FILTER (
            WHERE t.transaction_type = 'buy_in' AND t.amount < 0
        )::integer AS funded_user_count,
        (-COALESCE(SUM(t.amount) FILTER (
            WHERE t.transaction_type = 'buy_in' AND t.amount < 0
        ), 0))::numeric(12, 2) AS funded_tokens,
        STRING_AGG(DISTINCT u.username, ', ' ORDER BY u.username) AS participants
    FROM game_history gh
    LEFT JOIN transactions t ON t.game_id = gh.game_id
    LEFT JOIN users u ON u.id = t.user_id
    WHERE gh.outcome = 'In Progress'
      AND to_jsonb(gh)->>'recovery_eligible' IS DISTINCT FROM 'true'
      AND (
          $1::text IS NULL
          OR EXISTS (
              SELECT 1
              FROM transactions selected_transaction
              JOIN users selected_user ON selected_user.id = selected_transaction.user_id
              WHERE selected_transaction.game_id = gh.game_id
                AND LOWER(selected_user.username) = LOWER($1)
          )
      )
    GROUP BY gh.game_id
    ORDER BY COALESCE(gh.last_activity_at, gh.start_time) ASC, gh.game_id ASC
    LIMIT $2
`;

// A game-linked ledger must never finish with more credits than debits. A
// positive net means the game created tokens. Negative nets can be legitimate
// (for example, a lone funded player forfeiting with no funded recipients), so this report is
// deliberately one-sided.
const MINTED_GAMES_QUERY = `
    SELECT
        gh.game_id,
        gh.theme,
        gh.player_count,
        gh.outcome,
        gh.start_time,
        gh.end_time,
        COUNT(t.transaction_id)::integer AS transaction_count,
        COUNT(DISTINCT t.user_id) FILTER (
            WHERE t.transaction_type = 'buy_in' AND t.amount < 0
        )::integer AS funded_user_count,
        (-COALESCE(SUM(t.amount) FILTER (WHERE t.amount < 0), 0))::numeric(12, 2) AS total_debits,
        COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0)::numeric(12, 2) AS total_credits,
        SUM(t.amount)::numeric(12, 2) AS net_created,
        CASE
            WHEN $1::text IS NULL THEN NULL
            ELSE COALESCE(
                SUM(t.amount) FILTER (WHERE LOWER(u.username) = LOWER($1)),
                0
            )::numeric(12, 2)
        END AS selected_user_net,
        STRING_AGG(DISTINCT u.username, ', ' ORDER BY u.username) AS participants
    FROM game_history gh
    JOIN transactions t ON t.game_id = gh.game_id
    JOIN users u ON u.id = t.user_id
    WHERE (
        $1::text IS NULL
        OR EXISTS (
            SELECT 1
            FROM transactions selected_transaction
            JOIN users selected_user ON selected_user.id = selected_transaction.user_id
            WHERE selected_transaction.game_id = gh.game_id
              AND LOWER(selected_user.username) = LOWER($1)
        )
    )
    GROUP BY gh.game_id
    HAVING SUM(t.amount) > 0.005
    ORDER BY net_created DESC, gh.game_id DESC
    LIMIT $2
`;

const DUPLICATE_ENTRIES_QUERY = `
    SELECT
        t.game_id,
        t.user_id,
        u.username,
        t.transaction_type::text AS transaction_type,
        COUNT(*)::integer AS duplicate_count,
        SUM(t.amount)::numeric(12, 2) AS total_amount,
        ARRAY_AGG(t.transaction_id ORDER BY t.transaction_id) AS transaction_ids
    FROM transactions t
    JOIN users u ON u.id = t.user_id
    WHERE t.game_id IS NOT NULL
      AND ($1::text IS NULL OR LOWER(u.username) = LOWER($1))
    GROUP BY t.game_id, t.user_id, u.username, t.transaction_type
    HAVING COUNT(*) > 1
    ORDER BY duplicate_count DESC, t.game_id DESC
    LIMIT $2
`;

const UNPAIRED_PAYOUTS_QUERY = `
    SELECT
        t.transaction_id,
        t.game_id,
        t.user_id,
        u.username,
        t.transaction_type::text AS transaction_type,
        t.amount::numeric(12, 2) AS amount,
        t.transaction_time
    FROM transactions t
    JOIN users u ON u.id = t.user_id
    WHERE t.game_id IS NOT NULL
      AND t.transaction_type::text = ANY($3::text[])
      AND t.amount > 0
      AND ($1::text IS NULL OR LOWER(u.username) = LOWER($1))
      AND NOT EXISTS (
          SELECT 1
          FROM transactions buy_in
          WHERE buy_in.game_id = t.game_id
            AND buy_in.user_id = t.user_id
            AND buy_in.transaction_type = 'buy_in'
            AND buy_in.amount < 0
      )
    ORDER BY t.transaction_id DESC
    LIMIT $2
`;

const INVALID_AMOUNTS_QUERY = `
    SELECT
        t.transaction_id,
        t.game_id,
        t.user_id,
        u.username,
        t.transaction_type::text AS transaction_type,
        t.amount::numeric(12, 2) AS amount,
        t.transaction_time
    FROM transactions t
    JOIN users u ON u.id = t.user_id
    WHERE ($1::text IS NULL OR LOWER(u.username) = LOWER($1))
      AND (
          t.amount = 0
          OR (t.transaction_type::text = ANY($3::text[]) AND t.amount <= 0)
          OR (t.transaction_type IN ('buy_in', 'forfeit_loss') AND t.amount >= 0)
          OR (t.transaction_type = 'free_token_mercy' AND t.amount <> 1)
      )
    ORDER BY t.transaction_id DESC
    LIMIT $2
`;

function buildThemeCostValuesSql(tableCosts = TABLE_COSTS) {
    const entries = Object.entries(tableCosts || {});
    if (entries.length === 0) {
        throw new TypeError('At least one canonical table cost is required.');
    }
    return entries.map(([theme, rawCost]) => {
        const cost = Number(rawCost);
        if (!Number.isFinite(cost) || cost < 0) {
            throw new TypeError(`Invalid table cost for ${theme}.`);
        }
        const escapedTheme = String(theme).replaceAll("'", "''");
        return `('${escapedTheme}'::text, ${cost}::numeric)`;
    }).join(',\n            ');
}

const THEME_COST_VALUES_SQL = buildThemeCostValuesSql();

const BUY_IN_MISMATCHES_QUERY = `
    WITH theme_costs(theme, expected_cost) AS (
        VALUES
            ${THEME_COST_VALUES_SQL}
    )
    SELECT
        t.transaction_id,
        t.game_id,
        t.user_id,
        u.username,
        gh.theme,
        t.amount::numeric(12, 2) AS actual_amount,
        (-theme_costs.expected_cost)::numeric(12, 2) AS expected_amount,
        t.transaction_time
    FROM transactions t
    JOIN users u ON u.id = t.user_id
    JOIN game_history gh ON gh.game_id = t.game_id
    LEFT JOIN theme_costs ON theme_costs.theme = gh.theme
    WHERE t.transaction_type = 'buy_in'
      AND (
          theme_costs.expected_cost IS NULL
          OR ABS(t.amount + theme_costs.expected_cost) > 0.005
      )
      AND ($1::text IS NULL OR LOWER(u.username) = LOWER($1))
    ORDER BY t.transaction_id DESC
    LIMIT $2
`;

function parseLimit(value, fallback = 50) {
    if (value === undefined || value === null || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
        throw new RangeError('Audit limit must be an integer from 1 through 500.');
    }
    return parsed;
}

async function auditTokenAccounting(pool, { username = null, limit = 50 } = {}) {
    const normalizedUsername = typeof username === 'string' && username.trim()
        ? username.trim()
        : null;
    const normalizedLimit = parseLimit(limit);
    const client = await pool.connect();
    let transactionOpen = false;

    try {
        // This is an operational safety boundary, not just a convention: even
        // an accidental write added to this audit later will be rejected by
        // PostgreSQL.
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        transactionOpen = true;

        const commonParams = [normalizedUsername, normalizedLimit, PAYOUT_TYPES];
        const accountSummary = await client.query(ACCOUNT_SUMMARY_QUERY, [normalizedUsername]);
        const typeTotals = await client.query(TYPE_TOTALS_QUERY, [normalizedUsername]);
        const abandonedRefunds = await client.query(ABANDONED_REFUNDS_QUERY, commonParams.slice(0, 2));
        const quarantinedLegacyGames = await client.query(
            QUARANTINED_LEGACY_GAMES_QUERY,
            commonParams.slice(0, 2),
        );
        const mintedGames = await client.query(MINTED_GAMES_QUERY, commonParams.slice(0, 2));
        const duplicateEntries = await client.query(DUPLICATE_ENTRIES_QUERY, commonParams.slice(0, 2));
        const unpairedPayouts = await client.query(UNPAIRED_PAYOUTS_QUERY, commonParams);
        const invalidAmounts = await client.query(INVALID_AMOUNTS_QUERY, commonParams);
        const buyInMismatches = await client.query(BUY_IN_MISMATCHES_QUERY, commonParams.slice(0, 2));

        await client.query('COMMIT');
        transactionOpen = false;

        return {
            filter: { username: normalizedUsername, limit: normalizedLimit },
            accountSummary: accountSummary.rows,
            typeTotals: typeTotals.rows,
            abandonedRefunds: abandonedRefunds.rows,
            quarantinedLegacyGames: quarantinedLegacyGames.rows,
            mintedGames: mintedGames.rows,
            duplicateEntries: duplicateEntries.rows,
            unpairedPayouts: unpairedPayouts.rows,
            invalidAmounts: invalidAmounts.rows,
            buyInMismatches: buyInMismatches.rows,
        };
    } catch (error) {
        if (transactionOpen) {
            try {
                await client.query('ROLLBACK');
            } catch (rollbackError) {
                error.rollbackError = rollbackError;
            }
        }
        throw error;
    } finally {
        client.release();
    }
}

module.exports = {
    ABANDONED_REFUNDS_QUERY,
    ACCOUNT_SUMMARY_QUERY,
    BUY_IN_MISMATCHES_QUERY,
    DUPLICATE_ENTRIES_QUERY,
    INVALID_AMOUNTS_QUERY,
    MINTED_GAMES_QUERY,
    PAYOUT_TYPES,
    QUARANTINED_LEGACY_GAMES_QUERY,
    THEME_COST_VALUES_SQL,
    TYPE_TOTALS_QUERY,
    UNPAIRED_PAYOUTS_QUERY,
    auditTokenAccounting,
    buildThemeCostValuesSql,
    parseLimit,
};
