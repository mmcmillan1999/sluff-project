'use strict';

const { TABLE_COSTS } = require('../core/constants');

const PAYOUT_TYPES = [
    'win_payout',
    'wash_payout',
    'forfeit_payout',
    'abandoned_refund',
];

const GAME_VOID_REVERSAL_TYPE = 'game_void_reversal';
const VOIDABLE_GAME_TRANSACTION_TYPES = [
    'buy_in',
    'win_payout',
    'wash_payout',
    'forfeit_payout',
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
      AND t.transaction_type::text <> '${GAME_VOID_REVERSAL_TYPE}'
      AND ($1::text IS NULL OR LOWER(u.username) = LOWER($1))
    GROUP BY t.game_id, t.user_id, u.username, t.transaction_type
    HAVING COUNT(*) > 1
    ORDER BY duplicate_count DESC, t.game_id DESC
    LIMIT $2
`;

// A completed void legitimately creates more than one reversal for the same
// player and game (for example, one payout clawback and one buy-in refund).
// Those rows are excluded from the generic duplicate report above and audited
// against the immutable manifest written with the void. Live ledger rows are
// account-owned and may disappear together when an inactive account is pruned;
// that is valid only when the manifest remains complete and exact. If the user
// still exists, both live rows must still exist and match their snapshots.
const GAME_VOID_REVERSAL_ISSUES_QUERY = `
    WITH manifest_rows AS (
        SELECT
            manifest.game_id,
            manifest.source_transaction_id_snapshot AS source_transaction_id,
            manifest.source_user_id_snapshot AS user_id,
            manifest.source_username_snapshot AS username,
            manifest.source_transaction_type,
            manifest.source_amount,
            manifest.reversal_transaction_id_snapshot AS reversal_transaction_id,
            manifest.reversal_amount,
            manifest.reversal_idempotency_key,
            gh.reconciliation_status,
            live_user.id AS live_user_id,
            live_source.transaction_id AS live_source_transaction_id,
            live_source.game_id AS live_source_game_id,
            live_source.user_id AS live_source_user_id,
            live_source.transaction_type::text AS live_source_transaction_type,
            live_source.amount AS live_source_amount,
            live_source.reverses_transaction_id AS live_source_reverses_transaction_id,
            live_reversal.transaction_id AS live_reversal_transaction_id,
            live_reversal.game_id AS live_reversal_game_id,
            live_reversal.user_id AS live_reversal_user_id,
            live_reversal.transaction_type::text AS live_reversal_transaction_type,
            live_reversal.amount AS live_reversal_amount,
            live_reversal.reverses_transaction_id AS live_reversal_source_id,
            live_reversal.idempotency_key AS live_reversal_idempotency_key
        FROM game_void_ledger_manifest manifest
        JOIN game_voids game_void ON game_void.game_id = manifest.game_id
        JOIN game_history gh ON gh.game_id = manifest.game_id
        LEFT JOIN users live_user ON live_user.id = manifest.source_user_id_snapshot
        LEFT JOIN transactions live_source
          ON live_source.transaction_id = manifest.source_transaction_id_snapshot
        LEFT JOIN transactions live_reversal
          ON live_reversal.transaction_id = manifest.reversal_transaction_id_snapshot
        WHERE ($1::text IS NULL
               OR LOWER(manifest.source_username_snapshot) = LOWER($1))
    ), manifest_integrity_checks AS (
        SELECT
            reversal_transaction_id,
            game_id,
            user_id,
            username,
            source_transaction_id,
            source_transaction_type,
            source_amount::numeric(12, 2) AS source_amount,
            reversal_amount::numeric(12, 2) AS reversal_amount,
            reconciliation_status,
            TRUE AS has_game_void,
            CASE
                WHEN NOT (source_transaction_type = ANY($3::text[])) THEN 'unsupported_source_type'
                WHEN ABS(reversal_amount + source_amount) > 0.005 THEN 'amount_not_exact_negation'
                WHEN reversal_idempotency_key IS DISTINCT FROM
                     ('game-void:' || game_id || ':' || source_transaction_id)
                    THEN 'manifest_idempotency_mismatch'
                WHEN reconciliation_status IS DISTINCT FROM 'player_voided' THEN 'game_not_marked_voided'
                WHEN live_user_id IS NULL
                 AND ((live_source_transaction_id IS NULL)
                      IS DISTINCT FROM (live_reversal_transaction_id IS NULL))
                    THEN 'pruned_live_pair_incomplete'
                ELSE NULL
            END AS issue
        FROM manifest_rows
    ), manifest_source_checks AS (
        SELECT
            reversal_transaction_id,
            game_id,
            user_id,
            username,
            source_transaction_id,
            source_transaction_type,
            source_amount::numeric(12, 2) AS source_amount,
            reversal_amount::numeric(12, 2) AS reversal_amount,
            reconciliation_status,
            TRUE AS has_game_void,
            CASE
                WHEN live_user_id IS NOT NULL AND live_source_transaction_id IS NULL
                    THEN 'missing_live_source'
                WHEN live_source_transaction_id IS NOT NULL AND (
                    live_source_game_id IS DISTINCT FROM game_id
                    OR live_source_user_id IS DISTINCT FROM user_id
                    OR live_source_transaction_type IS DISTINCT FROM source_transaction_type
                    OR live_source_amount IS DISTINCT FROM source_amount
                    OR live_source_reverses_transaction_id IS NOT NULL
                ) THEN 'source_manifest_mismatch'
                ELSE NULL
            END AS issue
        FROM manifest_rows
    ), manifest_reversal_checks AS (
        SELECT
            reversal_transaction_id,
            game_id,
            user_id,
            username,
            source_transaction_id,
            source_transaction_type,
            source_amount::numeric(12, 2) AS source_amount,
            reversal_amount::numeric(12, 2) AS reversal_amount,
            reconciliation_status,
            TRUE AS has_game_void,
            CASE
                WHEN live_user_id IS NOT NULL AND live_reversal_transaction_id IS NULL
                    THEN 'missing_live_reversal'
                WHEN live_reversal_transaction_id IS NOT NULL AND (
                    live_reversal_game_id IS DISTINCT FROM game_id
                    OR live_reversal_user_id IS DISTINCT FROM user_id
                    OR live_reversal_transaction_type IS DISTINCT FROM '${GAME_VOID_REVERSAL_TYPE}'
                    OR live_reversal_amount IS DISTINCT FROM reversal_amount
                    OR live_reversal_source_id IS DISTINCT FROM source_transaction_id
                    OR live_reversal_idempotency_key IS DISTINCT FROM reversal_idempotency_key
                ) THEN 'reversal_manifest_mismatch'
                ELSE NULL
            END AS issue
        FROM manifest_rows
    ), live_sources_without_manifest AS (
        SELECT
            NULL::integer AS reversal_transaction_id,
            source.game_id,
            source.user_id,
            u.username,
            source.transaction_id AS source_transaction_id,
            source.transaction_type::text AS source_transaction_type,
            source.amount::numeric(12, 2) AS source_amount,
            NULL::numeric(12, 2) AS reversal_amount,
            gh.reconciliation_status,
            TRUE AS has_game_void,
            'missing_manifest_source'::text AS issue
        FROM transactions source
        JOIN game_voids game_void ON game_void.game_id = source.game_id
        JOIN game_history gh ON gh.game_id = source.game_id
        JOIN users u ON u.id = source.user_id
        LEFT JOIN game_void_ledger_manifest manifest
          ON manifest.game_id = source.game_id
         AND manifest.source_transaction_id_snapshot = source.transaction_id
        WHERE source.transaction_type::text = ANY($3::text[])
          AND source.reverses_transaction_id IS NULL
          AND manifest.source_transaction_id_snapshot IS NULL
          AND ($1::text IS NULL OR LOWER(u.username) = LOWER($1))
    ), live_reversals_without_manifest AS (
        SELECT
            reversal.transaction_id AS reversal_transaction_id,
            reversal.game_id,
            reversal.user_id,
            u.username,
            reversal.reverses_transaction_id AS source_transaction_id,
            source.transaction_type::text AS source_transaction_type,
            source.amount::numeric(12, 2) AS source_amount,
            reversal.amount::numeric(12, 2) AS reversal_amount,
            gh.reconciliation_status,
            (game_void.game_id IS NOT NULL) AS has_game_void,
            CASE
                WHEN game_void.game_id IS NULL THEN 'missing_game_void'
                ELSE 'missing_manifest_reversal'
            END AS issue
        FROM transactions reversal
        LEFT JOIN transactions source
          ON source.transaction_id = reversal.reverses_transaction_id
        LEFT JOIN users u ON u.id = reversal.user_id
        LEFT JOIN game_history gh ON gh.game_id = reversal.game_id
        LEFT JOIN game_voids game_void ON game_void.game_id = reversal.game_id
        LEFT JOIN game_void_ledger_manifest manifest
          ON manifest.game_id = reversal.game_id
         AND manifest.reversal_transaction_id_snapshot = reversal.transaction_id
        WHERE reversal.transaction_type::text = '${GAME_VOID_REVERSAL_TYPE}'
          AND manifest.reversal_transaction_id_snapshot IS NULL
          AND ($1::text IS NULL OR LOWER(u.username) = LOWER($1))
    ), marker_rows AS (
        SELECT
            game_void.game_id,
            game_void.requested_by_user_id,
            game_void.requested_by_username,
            game_void.affected_player_count,
            game_void.source_transaction_count,
            game_void.reversal_transaction_count,
            gh.reconciliation_status,
            COUNT(manifest.source_transaction_id_snapshot)::integer AS manifest_count,
            COUNT(DISTINCT manifest.source_user_id_snapshot)::integer AS manifest_player_count
        FROM game_voids game_void
        JOIN game_history gh ON gh.game_id = game_void.game_id
        LEFT JOIN game_void_ledger_manifest manifest ON manifest.game_id = game_void.game_id
        WHERE $1::text IS NULL
           OR LOWER(game_void.requested_by_username) = LOWER($1)
           OR EXISTS (
                SELECT 1
                FROM game_void_ledger_manifest selected_manifest
                WHERE selected_manifest.game_id = game_void.game_id
                  AND LOWER(selected_manifest.source_username_snapshot) = LOWER($1)
           )
        GROUP BY game_void.game_id, game_void.requested_by_user_id,
                 game_void.requested_by_username, game_void.source_transaction_count,
                 game_void.reversal_transaction_count, game_void.affected_player_count,
                 gh.reconciliation_status
    ), marker_checks AS (
        SELECT
            NULL::integer AS reversal_transaction_id,
            game_id,
            requested_by_user_id AS user_id,
            requested_by_username AS username,
            NULL::integer AS source_transaction_id,
            NULL::text AS source_transaction_type,
            NULL::numeric(12, 2) AS source_amount,
            NULL::numeric(12, 2) AS reversal_amount,
            reconciliation_status,
            TRUE AS has_game_void,
            CASE
                WHEN reconciliation_status IS DISTINCT FROM 'player_voided'
                    THEN 'game_not_marked_voided'
                WHEN source_transaction_count IS DISTINCT FROM reversal_transaction_count
                    THEN 'marker_count_mismatch'
                WHEN source_transaction_count IS DISTINCT FROM manifest_count
                  OR reversal_transaction_count IS DISTINCT FROM manifest_count
                    THEN 'manifest_count_mismatch'
                WHEN affected_player_count IS DISTINCT FROM manifest_player_count
                    THEN 'manifest_player_count_mismatch'
                ELSE NULL
            END AS issue
        FROM marker_rows
    )
    SELECT *
    FROM (
        SELECT * FROM manifest_integrity_checks WHERE issue IS NOT NULL
        UNION ALL
        SELECT * FROM manifest_source_checks WHERE issue IS NOT NULL
        UNION ALL
        SELECT * FROM manifest_reversal_checks WHERE issue IS NOT NULL
        UNION ALL
        SELECT * FROM live_sources_without_manifest
        UNION ALL
        SELECT * FROM live_reversals_without_manifest
        UNION ALL
        SELECT * FROM marker_checks WHERE issue IS NOT NULL
    ) issues
    ORDER BY game_id DESC, source_transaction_id DESC NULLS LAST,
             reversal_transaction_id DESC NULLS LAST
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
        const gameVoidParams = [
            normalizedUsername,
            normalizedLimit,
            VOIDABLE_GAME_TRANSACTION_TYPES,
        ];
        const accountSummary = await client.query(ACCOUNT_SUMMARY_QUERY, [normalizedUsername]);
        const typeTotals = await client.query(TYPE_TOTALS_QUERY, [normalizedUsername]);
        const abandonedRefunds = await client.query(ABANDONED_REFUNDS_QUERY, commonParams.slice(0, 2));
        const quarantinedLegacyGames = await client.query(
            QUARANTINED_LEGACY_GAMES_QUERY,
            commonParams.slice(0, 2),
        );
        const mintedGames = await client.query(MINTED_GAMES_QUERY, commonParams.slice(0, 2));
        const duplicateEntries = await client.query(DUPLICATE_ENTRIES_QUERY, commonParams.slice(0, 2));
        const gameVoidReversalIssues = await client.query(
            GAME_VOID_REVERSAL_ISSUES_QUERY,
            gameVoidParams,
        );
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
            gameVoidReversalIssues: gameVoidReversalIssues.rows,
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
    GAME_VOID_REVERSAL_ISSUES_QUERY,
    GAME_VOID_REVERSAL_TYPE,
    INVALID_AMOUNTS_QUERY,
    MINTED_GAMES_QUERY,
    PAYOUT_TYPES,
    QUARANTINED_LEGACY_GAMES_QUERY,
    THEME_COST_VALUES_SQL,
    TYPE_TOTALS_QUERY,
    UNPAIRED_PAYOUTS_QUERY,
    VOIDABLE_GAME_TRANSACTION_TYPES,
    auditTokenAccounting,
    buildThemeCostValuesSql,
    parseLimit,
};
