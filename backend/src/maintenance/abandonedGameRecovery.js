'use strict';

const { randomUUID } = require('crypto');

const DEFAULT_GRACE_MS = 6 * 60 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_BATCH_LIMIT = 25;
const RECOVERY_LOCK_TIMEOUT_MS = 1000;
const RECOVERY_STATEMENT_TIMEOUT_MS = 5000;
// A live game may miss two scheduled heartbeats without becoming eligible for
// recovery; the third missed interval is the earliest safe recovery boundary.
const MIN_GRACE_HEARTBEAT_INTERVALS = 3;
const RECOVERED_OUTCOME = 'Abandoned after server interruption - funded player buy-ins refunded';
const MANUAL_REVIEW_OUTCOME = 'Abandoned after server interruption - manual ledger review required';
const RECOVERED_STATUS = 'abandoned_refunded';
const MANUAL_REVIEW_STATUS = 'manual_review';
const RETRYABLE_RECOVERY_CODES = new Set(['55P03', '57014', '40P01', '40001']);

// Rolling-deploy safety is layered: schema upgrades backfill missing activity
// at migration-end database time, each process persists its boot owner, the
// current process excludes its live game ids, and recovery waits six hours by
// default. Once recovery terminalizes a row, outcome='In Progress' becomes the
// fencing condition: a resumed old owner can neither heartbeat nor settle it.

const candidateQuery = `
    WITH unlocked_stale_games AS (
        SELECT candidate.game_id
        FROM game_history candidate
        WHERE candidate.outcome = 'In Progress'
          AND candidate.recovery_eligible IS TRUE
          AND COALESCE(candidate.last_activity_at, candidate.start_time)
              <= NOW() - ($1::bigint * INTERVAL '1 millisecond')
          AND NOT (candidate.game_id = ANY($2::int[]))
        ORDER BY COALESCE(candidate.last_activity_at, candidate.start_time) ASC,
                 candidate.game_id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT $3
    )
    SELECT
        gh.game_id,
        gh.table_id,
        gh.theme,
        gh.player_count,
        gh.start_time,
        COALESCE(gh.last_activity_at, gh.start_time) AS last_activity_at,
        gh.heartbeat_owner_id,
        COUNT(DISTINCT t.user_id) FILTER (
            WHERE t.transaction_type = 'buy_in' AND t.amount < 0 AND t.user_id IS NOT NULL
        )::integer AS funded_human_count,
        COALESCE(SUM(-t.amount) FILTER (
            WHERE t.transaction_type = 'buy_in' AND t.amount < 0 AND t.user_id IS NOT NULL
        ), 0) AS refund_total
    FROM unlocked_stale_games unlocked
    JOIN game_history gh ON gh.game_id = unlocked.game_id
    LEFT JOIN transactions t ON t.game_id = gh.game_id
    GROUP BY gh.game_id
    ORDER BY COALESCE(gh.last_activity_at, gh.start_time) ASC, gh.game_id ASC
`;

async function findAbandonedGameCandidates(pool, {
    graceMs = DEFAULT_GRACE_MS,
    excludeGameIds = [],
    limit = DEFAULT_BATCH_LIMIT,
} = {}) {
    const normalizedGraceMs = requirePositiveInteger(graceMs, 'graceMs');
    const excluded = normalizeGameIds(excludeGameIds);
    const batchLimit = requirePositiveInteger(limit, 'limit');
    const result = await pool.query(candidateQuery, [normalizedGraceMs, excluded, batchLimit]);
    return (result.rows || []).map(row => ({
        gameId: Number(row.game_id),
        tableId: row.table_id,
        theme: row.theme,
        playerCount: Number(row.player_count || 0),
        startTime: row.start_time,
        lastActivityAt: row.last_activity_at,
        heartbeatOwnerId: row.heartbeat_owner_id || null,
        // fundedHumanCount is retained for response compatibility with older
        // maintenance tooling; persistent bot principals are now included.
        fundedPlayerCount: Number(row.funded_human_count || 0),
        fundedHumanCount: Number(row.funded_human_count || 0),
        refundTotal: Number(row.refund_total || 0),
    }));
}

async function heartbeatLiveGames(pool, gameIds, { ownerId } = {}) {
    const activeGameIds = normalizeGameIds(gameIds);
    if (activeGameIds.length === 0) return 0;
    const heartbeatOwnerId = requireOwnerId(ownerId, 'ownerId');
    const result = await pool.query(
        `UPDATE game_history
         SET last_activity_at = NOW(), heartbeat_owner_id = $2
         WHERE game_id = ANY($1::int[]) AND outcome = 'In Progress'`,
        [activeGameIds, heartbeatOwnerId],
    );
    return result.rowCount || 0;
}

async function reconcileAbandonedGame(pool, gameId, {
    graceMs = DEFAULT_GRACE_MS,
    recoveryOwnerId = `recovery:${randomUUID()}`,
} = {}) {
    const normalizedGameId = requirePositiveInteger(gameId, 'gameId');
    const normalizedGraceMs = requirePositiveInteger(graceMs, 'graceMs');
    const normalizedOwnerId = requireOwnerId(recoveryOwnerId, 'recoveryOwnerId');
    const client = await pool.connect();
    let transactionOpen = false;

    try {
        await client.query('BEGIN');
        transactionOpen = true;
        await client.query(`SET LOCAL lock_timeout = '${RECOVERY_LOCK_TIMEOUT_MS}ms'`);
        await client.query(`SET LOCAL statement_timeout = '${RECOVERY_STATEMENT_TIMEOUT_MS}ms'`);

        const gameResult = await client.query(
            `SELECT game_id,
                    outcome,
                    start_time,
                    last_activity_at,
                    end_time,
                    player_count,
                    heartbeat_owner_id,
                    recovery_eligible,
                    reconciliation_status,
                    reconciled_at,
                    COALESCE(last_activity_at, start_time)
                        <= NOW() - ($2::bigint * INTERVAL '1 millisecond') AS is_stale
             FROM game_history
             WHERE game_id = $1
             FOR UPDATE SKIP LOCKED`,
            [normalizedGameId, normalizedGraceMs],
        );
        if (!gameResult.rows?.length) {
            const existenceResult = await client.query(
                'SELECT 1 FROM game_history WHERE game_id = $1',
                [normalizedGameId],
            );
            await client.query('COMMIT');
            transactionOpen = false;
            if (existenceResult.rows?.length) {
                return retryLaterResult(normalizedGameId, 'game_locked');
            }
            return { gameId: normalizedGameId, status: 'not_found', refunds: [] };
        }

        const game = gameResult.rows[0];
        if (game.outcome === RECOVERED_OUTCOME) {
            await client.query('COMMIT');
            transactionOpen = false;
            return {
                gameId: normalizedGameId,
                status: RECOVERED_STATUS,
                alreadyReconciled: true,
                refunds: [],
            };
        }
        if (game.outcome !== 'In Progress') {
            await client.query('COMMIT');
            transactionOpen = false;
            return { gameId: normalizedGameId, status: 'already_terminal', refunds: [] };
        }

        // Rows predating the hardened lifecycle cannot safely be classified.
        // A completed historical loss and a genuinely abandoned game often
        // have the exact same old shape: outcome="In Progress" plus one or
        // more negative buy-ins. Never manufacture a refund from that
        // ambiguous evidence.
        if (game.recovery_eligible !== true) {
            await client.query('COMMIT');
            transactionOpen = false;
            return {
                gameId: normalizedGameId,
                status: 'legacy_quarantined',
                reason: 'pre_hardened_lifecycle',
                refunds: [],
            };
        }

        if (game.is_stale !== true) {
            await client.query('COMMIT');
            transactionOpen = false;
            return { gameId: normalizedGameId, status: 'recent', refunds: [] };
        }

        if (game.end_time !== null && game.end_time !== undefined) {
            await markManualReview(client, normalizedGameId, normalizedOwnerId);
            await client.query('COMMIT');
            transactionOpen = false;
            return {
                gameId: normalizedGameId,
                status: MANUAL_REVIEW_STATUS,
                reason: 'inconsistent_game_history',
                refunds: [],
            };
        }
        if (game.reconciliation_status) {
            await markManualReview(client, normalizedGameId, normalizedOwnerId);
            await client.query('COMMIT');
            transactionOpen = false;
            return {
                gameId: normalizedGameId,
                status: MANUAL_REVIEW_STATUS,
                reason: 'inconsistent_reconciliation_status',
                refunds: [],
            };
        }

        const ledgerResult = await client.query(
            `SELECT transaction_id, user_id, transaction_type::text AS transaction_type, amount
             FROM transactions
             WHERE game_id = $1
             ORDER BY transaction_id ASC
             FOR UPDATE`,
            [normalizedGameId],
        );
        const ledgerRows = ledgerResult.rows || [];
        const unsafeLedgerRow = ledgerRows.find(row => (
            row.transaction_type !== 'buy_in'
            || !Number.isInteger(Number(row.user_id))
            || Number(row.user_id) <= 0
            || parseCents(row.amount) === null
            || parseCents(row.amount) >= 0
        ));
        if (unsafeLedgerRow) {
            await markManualReview(client, normalizedGameId, normalizedOwnerId);
            await client.query('COMMIT');
            transactionOpen = false;
            return {
                gameId: normalizedGameId,
                status: MANUAL_REVIEW_STATUS,
                reason: 'unexpected_ledger_activity',
                refunds: [],
            };
        }

        const refundCentsByUser = new Map();
        let expectedBuyInCents = null;
        let inconsistentBuyIns = false;
        for (const row of ledgerRows) {
            const userId = Number(row.user_id);
            const fundedCents = -toCents(row.amount);
            if (refundCentsByUser.has(userId)) inconsistentBuyIns = true;
            if (expectedBuyInCents === null) expectedBuyInCents = fundedCents;
            else if (fundedCents !== expectedBuyInCents) inconsistentBuyIns = true;
            refundCentsByUser.set(userId, fundedCents);
        }
        const recordedPlayerCount = Number(game.player_count);
        if (!Number.isInteger(recordedPlayerCount) || recordedPlayerCount < 1 || recordedPlayerCount > 4) {
            inconsistentBuyIns = true;
        } else if (refundCentsByUser.size > recordedPlayerCount) {
            inconsistentBuyIns = true;
        }
        if (inconsistentBuyIns) {
            await markManualReview(client, normalizedGameId, normalizedOwnerId);
            await client.query('COMMIT');
            transactionOpen = false;
            return {
                gameId: normalizedGameId,
                status: MANUAL_REVIEW_STATUS,
                reason: 'inconsistent_buy_ins',
                refunds: [],
            };
        }
        const userIds = [...refundCentsByUser.keys()].sort((left, right) => left - right);

        if (userIds.length > 0) {
            const lockedUsers = await client.query(
                `SELECT id FROM users
                 WHERE id = ANY($1::int[])
                 ORDER BY id
                 FOR UPDATE`,
                [userIds],
            );
            if ((lockedUsers.rows || []).length !== userIds.length) {
                await markManualReview(client, normalizedGameId, normalizedOwnerId);
                await client.query('COMMIT');
                transactionOpen = false;
                return {
                    gameId: normalizedGameId,
                    status: MANUAL_REVIEW_STATUS,
                    reason: 'funded_user_missing',
                    refunds: [],
                };
            }
        }

        const refunds = [];
        for (const userId of userIds) {
            const amountCents = refundCentsByUser.get(userId);
            await client.query(
                `INSERT INTO transactions
                    (user_id, game_id, transaction_type, amount, description, idempotency_key)
                 VALUES ($1, $2, 'abandoned_refund', $3, $4, $5)`,
                [
                    userId,
                    normalizedGameId,
                    fromCents(amountCents),
                    `Crash-recovery refund of funded buy-in(s) for abandoned game #${normalizedGameId}`,
                    `abandoned-refund:${normalizedGameId}:${userId}`,
                ],
            );
            refunds.push({ userId, amountCents });
        }

        const updateResult = await client.query(
            `UPDATE game_history
             SET outcome = $1,
                 end_time = NOW(),
                 reconciliation_status = $2,
                 reconciled_at = NOW(),
                 reconciled_by = $3
             WHERE game_id = $4
               AND outcome = 'In Progress'
               AND COALESCE(last_activity_at, start_time)
                   <= NOW() - ($5::bigint * INTERVAL '1 millisecond')`,
            [RECOVERED_OUTCOME, RECOVERED_STATUS, normalizedOwnerId, normalizedGameId, normalizedGraceMs],
        );
        if (updateResult.rowCount !== 1) {
            const error = new Error(`Game ${normalizedGameId} changed before abandoned-game recovery committed.`);
            error.code = 'RECOVERY_GAME_CHANGED';
            throw error;
        }

        await client.query('COMMIT');
        transactionOpen = false;
        return {
            gameId: normalizedGameId,
            status: RECOVERED_STATUS,
            alreadyReconciled: false,
            refunds,
            refundTotalCents: refunds.reduce((sum, refund) => sum + refund.amountCents, 0),
        };
    } catch (error) {
        if (transactionOpen) {
            try {
                await client.query('ROLLBACK');
                transactionOpen = false;
            } catch (rollbackError) {
                console.error(`[RECOVERY] Failed to roll back game ${normalizedGameId}:`, rollbackError);
            }
        }
        if (RETRYABLE_RECOVERY_CODES.has(error.code)) {
            return retryLaterResult(normalizedGameId, retryReason(error.code), error.code);
        }
        throw error;
    } finally {
        client.release();
    }
}

function retryLaterResult(gameId, reason, errorCode) {
    return {
        gameId,
        status: 'retry_later',
        reason,
        retryable: true,
        ...(errorCode ? { errorCode } : {}),
        refunds: [],
    };
}

function retryReason(errorCode) {
    if (errorCode === '55P03') return 'lock_timeout';
    if (errorCode === '57014') return 'statement_timeout';
    if (errorCode === '40P01') return 'deadlock_retry';
    return 'serialization_retry';
}

async function markManualReview(client, gameId, recoveryOwnerId) {
    const result = await client.query(
        `UPDATE game_history
         SET outcome = $1,
             end_time = NOW(),
             reconciliation_status = $2,
             reconciled_at = NOW(),
             reconciled_by = $3
         WHERE game_id = $4 AND outcome = 'In Progress'`,
        [MANUAL_REVIEW_OUTCOME, MANUAL_REVIEW_STATUS, recoveryOwnerId, gameId],
    );
    if (result.rowCount !== 1) {
        const error = new Error(`Game ${gameId} changed before manual-review recovery committed.`);
        error.code = 'RECOVERY_GAME_CHANGED';
        throw error;
    }
}

async function reconcileAbandonedGames(pool, {
    execute = false,
    graceMs = DEFAULT_GRACE_MS,
    excludeGameIds = [],
    limit = DEFAULT_BATCH_LIMIT,
    recoveryOwnerId = `recovery-batch:${randomUUID()}`,
} = {}) {
    const normalizedGraceMs = requirePositiveInteger(graceMs, 'graceMs');
    const normalizedOwnerId = requireOwnerId(recoveryOwnerId, 'recoveryOwnerId');
    const candidates = await findAbandonedGameCandidates(pool, {
        graceMs: normalizedGraceMs,
        excludeGameIds,
        limit,
    });

    if (!execute) {
        return {
            executed: false,
            graceMs: normalizedGraceMs,
            candidates,
            results: [],
            deferred: [],
            errors: [],
        };
    }

    const results = [];
    const deferred = [];
    const errors = [];
    for (const candidate of candidates) {
        try {
            const result = await reconcileAbandonedGame(pool, candidate.gameId, {
                graceMs: normalizedGraceMs,
                recoveryOwnerId: normalizedOwnerId,
            });
            if (result.status === 'retry_later') deferred.push(result);
            else results.push(result);
        } catch (error) {
            errors.push({ gameId: candidate.gameId, code: error.code || 'RECOVERY_ERROR', message: error.message });
        }
    }
    return { executed: true, graceMs: normalizedGraceMs, candidates, results, deferred, errors };
}

function createAbandonedGameRecoveryMonitor({
    pool,
    getLiveGameIds,
    graceMs = DEFAULT_GRACE_MS,
    intervalMs = DEFAULT_INTERVAL_MS,
    limit = DEFAULT_BATCH_LIMIT,
    logger = console,
    ownerId = `server:${randomUUID()}`,
} = {}) {
    if (!pool || typeof pool.query !== 'function' || typeof pool.connect !== 'function') {
        throw new TypeError('Recovery monitor requires a PostgreSQL pool');
    }
    if (typeof getLiveGameIds !== 'function') {
        throw new TypeError('Recovery monitor requires getLiveGameIds');
    }
    const {
        graceMs: normalizedGraceMs,
        intervalMs: normalizedIntervalMs,
    } = validateRecoveryTiming({ graceMs, intervalMs });
    requirePositiveInteger(limit, 'limit');
    const normalizedOwnerId = requireOwnerId(ownerId, 'ownerId');

    let timer = null;
    let running = false;

    const runNow = async () => {
        if (running) return { skipped: true, reason: 'cycle_already_running' };
        running = true;
        try {
            const liveGameIds = normalizeGameIds(await getLiveGameIds());
            await heartbeatLiveGames(pool, liveGameIds, { ownerId: normalizedOwnerId });
            const result = await reconcileAbandonedGames(pool, {
                execute: true,
                graceMs: normalizedGraceMs,
                excludeGameIds: liveGameIds,
                limit,
                recoveryOwnerId: normalizedOwnerId,
            });
            if (result.results.length > 0 || result.deferred.length > 0 || result.errors.length > 0) {
                logger.info?.(
                    `[RECOVERY] Processed ${result.results.length} abandoned game(s); `
                    + `${result.deferred.length} deferred; ${result.errors.length} error(s).`,
                );
                for (const item of result.deferred) {
                    logger.warn?.(`[RECOVERY] Game ${item.gameId} deferred (${item.reason}).`);
                }
                for (const error of result.errors) {
                    logger.error?.(`[RECOVERY] Game ${error.gameId} failed (${error.code}): ${error.message}`);
                }
            }
            return result;
        } finally {
            running = false;
        }
    };

    const start = () => {
        if (timer) return timer;
        timer = setInterval(() => {
            runNow().catch(error => logger.error?.('[RECOVERY] Scheduled cycle failed:', error));
        }, normalizedIntervalMs);
        timer.unref?.();
        return timer;
    };

    const stop = () => {
        if (!timer) return;
        clearInterval(timer);
        timer = null;
    };

    return { runNow, start, stop };
}

function validateRecoveryTiming({ graceMs, intervalMs } = {}) {
    const normalizedGraceMs = requirePositiveInteger(graceMs, 'graceMs');
    const normalizedIntervalMs = requirePositiveInteger(intervalMs, 'intervalMs');
    if (normalizedGraceMs < normalizedIntervalMs * MIN_GRACE_HEARTBEAT_INTERVALS) {
        throw new RangeError(
            `graceMs must be at least ${MIN_GRACE_HEARTBEAT_INTERVALS} heartbeat intervals `
            + 'so a live game can miss two heartbeats before recovery',
        );
    }
    return { graceMs: normalizedGraceMs, intervalMs: normalizedIntervalMs };
}

function liveGameIdsFromService(gameService) {
    if (!gameService || typeof gameService.getAllEngines !== 'function') return [];
    return normalizeGameIds(
        Object.values(gameService.getAllEngines())
            .filter(engine => engine?.gameStarted === true && Number.isInteger(engine.gameId))
            .map(engine => engine.gameId),
    );
}

function normalizeGameIds(gameIds) {
    if (!Array.isArray(gameIds)) throw new TypeError('game ids must be an array');
    const normalized = [...new Set(gameIds.map(Number))];
    if (normalized.some(gameId => !Number.isInteger(gameId) || gameId <= 0)) {
        throw new TypeError('game ids must contain positive integers');
    }
    return normalized.sort((left, right) => left - right);
}

function requirePositiveInteger(value, label) {
    const number = Number(value);
    if (!Number.isInteger(number) || number <= 0) throw new TypeError(`${label} must be a positive integer`);
    return number;
}

function requireOwnerId(value, label) {
    if (typeof value !== 'string' || value.length < 1 || value.length > 128) {
        throw new TypeError(`${label} must be a non-empty string no longer than 128 characters`);
    }
    return value;
}

function toCents(amount) {
    const cents = parseCents(amount);
    if (cents === null) throw new TypeError('Ledger amount must be a safe finite decimal');
    return cents;
}

function parseCents(amount) {
    const numeric = Number(amount);
    if (!Number.isFinite(numeric)) return null;
    const cents = Math.round(numeric * 100);
    return Number.isSafeInteger(cents) ? cents : null;
}

function fromCents(cents) {
    return (cents / 100).toFixed(2);
}

module.exports = {
    DEFAULT_BATCH_LIMIT,
    DEFAULT_GRACE_MS,
    DEFAULT_INTERVAL_MS,
    MIN_GRACE_HEARTBEAT_INTERVALS,
    RECOVERY_LOCK_TIMEOUT_MS,
    RECOVERY_STATEMENT_TIMEOUT_MS,
    MANUAL_REVIEW_OUTCOME,
    MANUAL_REVIEW_STATUS,
    RECOVERED_OUTCOME,
    RECOVERED_STATUS,
    candidateQuery,
    createAbandonedGameRecoveryMonitor,
    findAbandonedGameCandidates,
    heartbeatLiveGames,
    liveGameIdsFromService,
    reconcileAbandonedGame,
    reconcileAbandonedGames,
    validateRecoveryTiming,
};
