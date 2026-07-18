'use strict';

const { createHash } = require('crypto');
const {
    DEFAULT_HEARTBEAT_INTERVAL_MS,
    RECOVERED_OUTCOME,
    RECOVERED_STATUS,
    RECOVERY_LOCK_TIMEOUT_MS,
    RECOVERY_STATEMENT_TIMEOUT_MS,
} = require('../maintenance/abandonedGameRecovery');

const ADMIN_RECOVERY_GRACE_MS = 10 * 60 * 1000;
const ADMIN_RECOVERY_MIN_SEASON_NUMBER = 2;
const ADMIN_RECOVERY_LIMIT = 100;
const ADMIN_RECOVERY_MAX_SELECTION = 100;

const SAFE_RECOVERY_CANDIDATES_QUERY = `
    WITH safe_games AS (
        SELECT game.game_id
        FROM game_history game
        JOIN seasons season ON season.season_id = game.season_id
        JOIN transactions ledger ON ledger.game_id = game.game_id
        LEFT JOIN users funded_user ON funded_user.id = ledger.user_id
        WHERE game.outcome = 'In Progress'
          AND game.end_time IS NULL
          AND game.reconciliation_status IS NULL
          AND game.recovery_eligible IS TRUE
          AND season.season_number >= $3
          AND COALESCE(game.last_activity_at, game.start_time)
              < NOW() - ($1::bigint * INTERVAL '1 millisecond')
          AND NOT (game.game_id = ANY($2::int[]))
        GROUP BY game.game_id,
                 COALESCE(game.last_activity_at, game.start_time)
        HAVING COUNT(*) > 0
           AND BOOL_AND(
               ledger.transaction_type::text = 'buy_in'
               AND ledger.amount < 0
               AND ledger.user_id IS NOT NULL
               AND ledger.reverses_transaction_id IS NULL
           )
           AND COUNT(*) = COUNT(funded_user.id)
        ORDER BY COALESCE(game.last_activity_at, game.start_time) ASC,
                 game.game_id ASC
        LIMIT $4
    )
    SELECT
        game.game_id,
        game.table_id,
        game.theme,
        game.player_count,
        game.start_time,
        COALESCE(game.last_activity_at, game.start_time) AS last_activity_at,
        season.season_id,
        season.season_number,
        season.display_name AS season_name,
        ledger.transaction_id AS buy_in_transaction_id,
        ledger.user_id,
        funded_user.username,
        ledger.amount AS buy_in_amount,
        ledger.reverses_transaction_id
    FROM safe_games safe
    JOIN game_history game ON game.game_id = safe.game_id
    JOIN seasons season ON season.season_id = game.season_id
    JOIN transactions ledger ON ledger.game_id = game.game_id
    JOIN users funded_user ON funded_user.id = ledger.user_id
    ORDER BY COALESCE(game.last_activity_at, game.start_time) ASC,
             game.game_id ASC,
             ledger.transaction_id ASC
`;

class AdminGameRecoveryConflictError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'AdminGameRecoveryConflictError';
        this.code = code;
    }
}

function normalizePositiveId(value, label) {
    let normalized;
    if (typeof value === 'number') {
        normalized = value;
    } else if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) {
        normalized = Number(value);
    } else {
        throw new TypeError(`${label} must contain positive integer game ids.`);
    }
    if (!Number.isSafeInteger(normalized) || normalized <= 0) {
        throw new TypeError(`${label} must contain positive integer game ids.`);
    }
    return normalized;
}

function normalizeGameIds(gameIds, {
    allowEmpty = true,
    maximum = ADMIN_RECOVERY_MAX_SELECTION,
    label = 'gameIds',
} = {}) {
    if (!Array.isArray(gameIds)) throw new TypeError(`${label} must be an array.`);
    const normalized = [...new Set(gameIds.map(value => normalizePositiveId(value, label)))];
    if (!allowEmpty && normalized.length === 0) {
        throw new TypeError('Select at least one game to refund.');
    }
    if (normalized.length > maximum) {
        throw new RangeError(`No more than ${maximum} games may be refunded at once.`);
    }
    return normalized.sort((left, right) => left - right);
}

function databaseInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number)) throw new RangeError(`Invalid ${label} returned by the database.`);
    return number;
}

function amountToRefundCents(value) {
    const number = Number(value);
    const cents = Math.round(-number * 100);
    if (!Number.isFinite(number) || !Number.isSafeInteger(cents) || cents <= 0) {
        throw new RangeError('Invalid buy-in amount returned by the database.');
    }
    return cents;
}

function amountFromCents(cents) {
    return (cents / 100).toFixed(2);
}

function normalizedTimestamp(value, label) {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) throw new RangeError(`Invalid ${label} returned by the database.`);
    return date.toISOString();
}

function candidateFingerprint(candidate) {
    const reviewed = {
        gameId: candidate.gameId,
        seasonId: candidate.seasonId,
        seasonNumber: candidate.seasonNumber,
        playerCount: candidate.playerCount,
        lastActivityAt: candidate.lastActivityAt,
        sourceBuyIns: candidate.sourceBuyIns.map(source => ({
            sourceTransactionId: source.sourceTransactionId,
            userId: source.userId,
            buyInCents: source.buyInCents,
        })),
    };
    return createHash('sha256').update(JSON.stringify(reviewed)).digest('hex');
}

function candidatesFromRows(rows, limit) {
    const candidatesById = new Map();
    for (const row of rows || []) {
        const gameId = databaseInteger(row.game_id, 'game id');
        if (!candidatesById.has(gameId)) {
            candidatesById.set(gameId, {
                gameId,
                tableId: row.table_id || null,
                theme: row.theme || null,
                playerCount: databaseInteger(row.player_count, 'player count'),
                startTime: normalizedTimestamp(row.start_time, 'game start time'),
                lastActivityAt: normalizedTimestamp(row.last_activity_at, 'last activity time'),
                seasonId: databaseInteger(row.season_id, 'season id'),
                seasonNumber: databaseInteger(row.season_number, 'season number'),
                seasonName: row.season_name || `Season ${row.season_number}`,
                fundedPlayers: [],
                sourceBuyIns: [],
                refundTotalCents: 0,
                _playersById: new Map(),
            });
        }

        if (row.reverses_transaction_id !== null && row.reverses_transaction_id !== undefined) {
            throw new RangeError('A reviewed buy-in is already linked to another transaction.');
        }
        const candidate = candidatesById.get(gameId);
        const userId = databaseInteger(row.user_id, 'user id');
        const buyInCents = amountToRefundCents(row.buy_in_amount);
        const sourceTransactionId = databaseInteger(
            row.buy_in_transaction_id,
            'buy-in transaction id',
        );
        const username = row.username || 'Unknown player';
        candidate.sourceBuyIns.push({
            sourceTransactionId,
            userId,
            username,
            buyInCents,
        });
        if (!candidate._playersById.has(userId)) {
            const fundedPlayer = {
                userId,
                username,
                buyInCents: 0,
                sourceTransactionIds: [],
            };
            candidate._playersById.set(userId, fundedPlayer);
            candidate.fundedPlayers.push(fundedPlayer);
        }
        const fundedPlayer = candidate._playersById.get(userId);
        fundedPlayer.buyInCents += buyInCents;
        fundedPlayer.sourceTransactionIds.push(sourceTransactionId);
        candidate.refundTotalCents += buyInCents;
    }

    const allCandidates = [...candidatesById.values()];
    for (const candidate of allCandidates) {
        delete candidate._playersById;
        candidate.fingerprint = candidateFingerprint(candidate);
    }
    return {
        candidates: allCandidates.slice(0, limit),
        truncated: allCandidates.length > limit,
    };
}

function hashCandidates(candidates) {
    return createHash('sha256').update(JSON.stringify(
        candidates.map(candidate => [candidate.gameId, candidate.fingerprint]),
    )).digest('hex');
}

function validateAdminRecoveryHeartbeatCadence(
    heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS,
) {
    if (!Number.isInteger(heartbeatIntervalMs) || heartbeatIntervalMs <= 0) {
        throw new RangeError('Live-game heartbeat interval must be a positive integer.');
    }
    if (heartbeatIntervalMs * 3 > ADMIN_RECOVERY_GRACE_MS) {
        throw new RangeError('Live-game heartbeat must run at least three times inside the admin recovery grace window.');
    }
    return heartbeatIntervalMs;
}

async function previewAdminGameRecovery(pool, {
    excludeGameIds = [],
    limit = ADMIN_RECOVERY_LIMIT,
} = {}) {
    if (!pool || typeof pool.query !== 'function') {
        throw new TypeError('A PostgreSQL pool is required.');
    }
    const excluded = normalizeGameIds(excludeGameIds, {
        maximum: Number.MAX_SAFE_INTEGER,
        label: 'excludeGameIds',
    });
    if (!Number.isInteger(limit) || limit < 1 || limit > ADMIN_RECOVERY_LIMIT) {
        throw new RangeError(`Recovery preview limit must be from 1 through ${ADMIN_RECOVERY_LIMIT}.`);
    }

    const result = await pool.query(SAFE_RECOVERY_CANDIDATES_QUERY, [
        ADMIN_RECOVERY_GRACE_MS,
        excluded,
        ADMIN_RECOVERY_MIN_SEASON_NUMBER,
        limit + 1,
    ]);
    const { candidates, truncated } = candidatesFromRows(result.rows, limit);
    return {
        generatedAt: new Date().toISOString(),
        criteria: {
            inactivityMinutes: ADMIN_RECOVERY_GRACE_MS / 60000,
            minimumSeasonNumber: ADMIN_RECOVERY_MIN_SEASON_NUMBER,
            requiresFundedBuyIn: true,
            requiresNoPayouts: true,
        },
        candidateCount: candidates.length,
        totalRefundCents: candidates.reduce((sum, candidate) => sum + candidate.refundTotalCents, 0),
        truncated,
        previewHash: hashCandidates(candidates),
        candidates,
    };
}

function recoveryOwner(appliedBy) {
    const userId = Number(appliedBy?.id);
    if (!Number.isSafeInteger(userId) || userId <= 0) {
        throw new TypeError('An authenticated admin is required.');
    }
    const username = typeof appliedBy?.username === 'string'
        ? appliedBy.username.trim().replace(/\s+/g, ' ')
        : 'Admin';
    return `admin-recovery:${userId}:${username || 'Admin'}`.slice(0, 128);
}

function conflict(code, message) {
    throw new AdminGameRecoveryConflictError(code, message);
}

function validateLockedGame(game, reviewedCandidate) {
    if (!game) conflict('RECOVERY_GAME_NOT_FOUND', 'The selected game no longer exists.');
    if (game.outcome !== 'In Progress'
        || game.end_time !== null && game.end_time !== undefined
        || game.reconciliation_status !== null && game.reconciliation_status !== undefined
        || game.recovery_eligible !== true
        || game.is_stale !== true) {
        conflict('RECOVERY_GAME_NOT_ELIGIBLE', 'The selected game is no longer eligible for a refund.');
    }
    if (Number(game.season_number) < ADMIN_RECOVERY_MIN_SEASON_NUMBER) {
        conflict('RECOVERY_SEASON_EXCLUDED', 'Alpha Season 1 games cannot be refunded by this tool.');
    }
    if (Number(game.season_id) !== reviewedCandidate.seasonId) {
        conflict('RECOVERY_GAME_CHANGED', 'The selected game changed after it was reviewed.');
    }
}

function initialLedgerUserIds(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
        conflict('RECOVERY_GAME_NOT_ELIGIBLE', 'The selected game no longer has funded buy-ins.');
    }
    const userIds = new Set();
    for (const row of rows) {
        const userId = Number(row.user_id);
        let refundCents = null;
        try {
            refundCents = amountToRefundCents(row.amount);
        } catch (error) {
            // The conflict below deliberately avoids leaking malformed ledger
            // values through the admin API.
        }
        if (String(row.transaction_type) !== 'buy_in'
            || !Number.isSafeInteger(userId)
            || userId <= 0
            || refundCents === null
            || (row.reverses_transaction_id !== null
                && row.reverses_transaction_id !== undefined)) {
            conflict('RECOVERY_LEDGER_CHANGED', 'The selected game ledger changed after it was reviewed.');
        }
        userIds.add(userId);
    }
    return [...userIds].sort((left, right) => left - right);
}

function rowsForLockedCandidate(game, ledgerRows, userRows) {
    const usernames = new Map((userRows || []).map(row => [Number(row.id), row.username]));
    return ledgerRows.map(row => ({
        game_id: game.game_id,
        table_id: game.table_id,
        theme: game.theme,
        player_count: game.player_count,
        start_time: game.start_time,
        last_activity_at: game.last_activity_at,
        season_id: game.season_id,
        season_number: game.season_number,
        season_name: game.season_name,
        buy_in_transaction_id: row.transaction_id,
        user_id: row.user_id,
        username: usernames.get(Number(row.user_id)),
        buy_in_amount: row.amount,
        reverses_transaction_id: row.reverses_transaction_id,
    }));
}

async function refundReviewedAdminGame(pool, reviewedCandidate, { recoveryOwnerId } = {}) {
    if (!pool || typeof pool.connect !== 'function') {
        throw new TypeError('A PostgreSQL pool with connect() is required.');
    }
    if (!reviewedCandidate || typeof reviewedCandidate.fingerprint !== 'string') {
        throw new TypeError('A reviewed game manifest is required.');
    }
    const client = await pool.connect();
    let transactionOpen = false;
    try {
        // SERIALIZABLE adds predicate protection against a transaction row
        // appearing after the locked manifest is read but before COMMIT.
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        transactionOpen = true;
        await client.query(`SET LOCAL lock_timeout = '${RECOVERY_LOCK_TIMEOUT_MS}ms'`);
        await client.query(`SET LOCAL statement_timeout = '${RECOVERY_STATEMENT_TIMEOUT_MS}ms'`);

        const gameResult = await client.query(
            `SELECT game.game_id,
                    game.table_id,
                    game.theme,
                    game.player_count,
                    game.start_time,
                    COALESCE(game.last_activity_at, game.start_time) AS last_activity_at,
                    game.end_time,
                    game.outcome,
                    game.recovery_eligible,
                    game.reconciliation_status,
                    game.season_id,
                    season.season_number,
                    season.display_name AS season_name,
                    COALESCE(game.last_activity_at, game.start_time)
                        < NOW() - ($2::bigint * INTERVAL '1 millisecond') AS is_stale
             FROM game_history game
             JOIN seasons season ON season.season_id = game.season_id
             WHERE game.game_id = $1
             FOR UPDATE OF game`,
            [reviewedCandidate.gameId, ADMIN_RECOVERY_GRACE_MS],
        );
        const game = gameResult.rows?.[0];
        validateLockedGame(game, reviewedCandidate);

        // Read the source identities before taking user locks. All game payout
        // writers already hold the game lock, and all wallet writers take user
        // locks before transaction writes, so this preserves the global order.
        const initialLedgerResult = await client.query(
            `SELECT transaction_id,
                    user_id,
                    transaction_type::text AS transaction_type,
                    amount,
                    reverses_transaction_id
             FROM transactions
             WHERE game_id = $1
             ORDER BY transaction_id ASC`,
            [reviewedCandidate.gameId],
        );
        const userIds = initialLedgerUserIds(initialLedgerResult.rows || []);
        const userResult = await client.query(
            `SELECT id, username
             FROM users
             WHERE id = ANY($1::int[])
             ORDER BY id
             FOR UPDATE`,
            [userIds],
        );
        if ((userResult.rows || []).length !== userIds.length) {
            conflict('RECOVERY_LEDGER_CHANGED', 'A funded player changed after this game was reviewed.');
        }

        const lockedLedgerResult = await client.query(
            `SELECT transaction_id,
                    user_id,
                    transaction_type::text AS transaction_type,
                    amount,
                    reverses_transaction_id
             FROM transactions
             WHERE game_id = $1
             ORDER BY transaction_id ASC
             FOR UPDATE`,
            [reviewedCandidate.gameId],
        );
        const lockedRows = lockedLedgerResult.rows || [];
        initialLedgerUserIds(lockedRows);
        const lockedCandidate = candidatesFromRows(
            rowsForLockedCandidate(game, lockedRows, userResult.rows || []),
            1,
        ).candidates[0];
        if (!lockedCandidate || lockedCandidate.fingerprint !== reviewedCandidate.fingerprint) {
            conflict('RECOVERY_LEDGER_CHANGED', 'The selected game ledger changed after it was reviewed.');
        }

        const refunds = [];
        for (const source of lockedCandidate.sourceBuyIns) {
            const refundResult = await client.query(
                `INSERT INTO transactions
                    (user_id, game_id, transaction_type, amount, description,
                     idempotency_key, reverses_transaction_id)
                 VALUES ($1, $2, 'abandoned_refund', $3, $4, $5, $6)
                 RETURNING transaction_id`,
                [
                    source.userId,
                    lockedCandidate.gameId,
                    amountFromCents(source.buyInCents),
                    `Admin recovery refund of buy-in transaction #${source.sourceTransactionId} for abandoned game #${lockedCandidate.gameId}`,
                    `abandoned-refund:${lockedCandidate.gameId}:source:${source.sourceTransactionId}`,
                    source.sourceTransactionId,
                ],
            );
            refunds.push({
                transactionId: Number(refundResult.rows?.[0]?.transaction_id),
                sourceTransactionId: source.sourceTransactionId,
                userId: source.userId,
                amountCents: source.buyInCents,
            });
        }

        const updateResult = await client.query(
            `UPDATE game_history
             SET outcome = $1,
                 end_time = NOW(),
                 reconciliation_status = $2,
                 reconciled_at = NOW(),
                 reconciled_by = $3
             WHERE game_id = $4
               AND season_id = $5
               AND outcome = 'In Progress'
               AND end_time IS NULL
               AND reconciliation_status IS NULL
               AND recovery_eligible IS TRUE
               AND COALESCE(last_activity_at, start_time)
                   < NOW() - ($6::bigint * INTERVAL '1 millisecond')`,
            [
                RECOVERED_OUTCOME,
                RECOVERED_STATUS,
                recoveryOwnerId,
                lockedCandidate.gameId,
                lockedCandidate.seasonId,
                ADMIN_RECOVERY_GRACE_MS,
            ],
        );
        if (updateResult.rowCount !== 1) {
            conflict('RECOVERY_GAME_CHANGED', 'The selected game changed before its refund committed.');
        }

        await client.query('COMMIT');
        transactionOpen = false;
        return {
            gameId: lockedCandidate.gameId,
            seasonId: lockedCandidate.seasonId,
            seasonNumber: lockedCandidate.seasonNumber,
            status: RECOVERED_STATUS,
            alreadyReconciled: false,
            players: lockedCandidate.fundedPlayers.map(player => ({
                userId: player.userId,
                username: player.username,
                refundCents: player.buyInCents,
            })),
            refunds,
            refundedSourceCount: refunds.length,
            refundTotalCents: refunds.reduce((sum, refund) => sum + refund.amountCents, 0),
        };
    } catch (error) {
        if (transactionOpen) {
            try {
                await client.query('ROLLBACK');
            } catch (rollbackError) {
                // Preserve the primary result. A lost COMMIT acknowledgement can
                // leave no transaction to roll back and must remain "unknown".
            }
        }
        throw error;
    } finally {
        client.release();
    }
}

async function applyAdminGameRecovery(pool, {
    gameIds,
    expectedPreviewHash,
    excludeGameIds = [],
    appliedBy,
    preview = previewAdminGameRecovery,
    recover = refundReviewedAdminGame,
} = {}) {
    const selectedGameIds = normalizeGameIds(gameIds, { allowEmpty: false });
    if (typeof expectedPreviewHash !== 'string' || !/^[a-f0-9]{64}$/.test(expectedPreviewHash)) {
        throw new TypeError('Refresh the recovery preview before issuing refunds.');
    }
    const ownerId = recoveryOwner(appliedBy);
    const currentPreview = await preview(pool, { excludeGameIds });
    if (currentPreview.previewHash !== expectedPreviewHash) {
        throw new AdminGameRecoveryConflictError(
            'RECOVERY_PREVIEW_STALE',
            'The recovery candidates changed. Refresh and review them again before refunding.',
        );
    }

    const candidatesById = new Map(
        currentPreview.candidates.map(candidate => [candidate.gameId, candidate]),
    );
    const missingIds = selectedGameIds.filter(gameId => !candidatesById.has(gameId));
    if (missingIds.length > 0) {
        throw new AdminGameRecoveryConflictError(
            'RECOVERY_GAME_NOT_ELIGIBLE',
            'One or more selected games are no longer eligible. Refresh the preview.',
        );
    }

    const results = [];
    const errors = [];
    for (const gameId of selectedGameIds) {
        const candidate = candidatesById.get(gameId);
        try {
            results.push(await recover(pool, candidate, { recoveryOwnerId: ownerId }));
        } catch (error) {
            if (error instanceof AdminGameRecoveryConflictError) {
                results.push({
                    gameId,
                    status: 'not_refunded',
                    code: error.code,
                    reason: error.message,
                    refunds: [],
                });
            } else {
                errors.push({ gameId, code: error?.code || 'RECOVERY_RESULT_UNKNOWN' });
            }
        }
    }

    const refundedResults = results.filter(result => result.status === RECOVERED_STATUS);
    const notRefundedResults = results.filter(result => result.status !== RECOVERED_STATUS);
    const affectedUserIds = [...new Set(refundedResults.flatMap(result => (
        result.refunds.map(refund => refund.userId)
    )))].sort((left, right) => left - right);
    let outcome = 'complete';
    if (errors.length > 0) outcome = refundedResults.length > 0 ? 'partial_unknown' : 'unknown';
    else if (notRefundedResults.length > 0) outcome = refundedResults.length > 0 ? 'partial' : 'not_refunded';

    return {
        outcome,
        executedAt: new Date().toISOString(),
        executedBy: { id: Number(appliedBy.id), username: appliedBy.username || 'Admin' },
        requestedGameCount: selectedGameIds.length,
        refundedGameCount: refundedResults.length,
        notRefundedGameCount: notRefundedResults.length,
        unknownGameCount: errors.length,
        refundedPlayerCount: affectedUserIds.length,
        refundedSourceCount: refundedResults.reduce(
            (sum, result) => sum + Number(result.refundedSourceCount || 0),
            0,
        ),
        refundTotalCents: refundedResults.reduce(
            (sum, result) => sum + Number(result.refundTotalCents || 0),
            0,
        ),
        affectedUserIds,
        results,
        errors,
    };
}

module.exports = {
    ADMIN_RECOVERY_GRACE_MS,
    ADMIN_RECOVERY_LIMIT,
    ADMIN_RECOVERY_MAX_SELECTION,
    ADMIN_RECOVERY_MIN_SEASON_NUMBER,
    AdminGameRecoveryConflictError,
    SAFE_RECOVERY_CANDIDATES_QUERY,
    applyAdminGameRecovery,
    candidateFingerprint,
    candidatesFromRows,
    hashCandidates,
    normalizeGameIds,
    previewAdminGameRecovery,
    refundReviewedAdminGame,
    validateAdminRecoveryHeartbeatCadence,
};
