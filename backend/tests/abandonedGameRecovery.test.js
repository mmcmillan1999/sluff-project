'use strict';

const assert = require('node:assert/strict');
const createDbTables = require('../src/data/createTables');
const {
    DEFAULT_BATCH_LIMIT,
    DEFAULT_GRACE_MS,
    MANUAL_REVIEW_OUTCOME,
    MANUAL_REVIEW_STATUS,
    MIN_GRACE_HEARTBEAT_INTERVALS,
    RECOVERED_OUTCOME,
    RECOVERED_STATUS,
    RECOVERY_LOCK_TIMEOUT_MS,
    createAbandonedGameRecoveryMonitor,
    heartbeatLiveGames,
    liveGameIdsFromService,
    reconcileAbandonedGame,
    reconcileAbandonedGames,
    validateRecoveryTiming,
} = require('../src/maintenance/abandonedGameRecovery');
const { parseArgs, runCli } = require('../scripts/reconcile-abandoned-games');
const {
    initializeThenListen,
    recoveryTimingFromEnvironment,
    server: applicationServer,
} = require('../src/server');

const HOUR = 60 * 60 * 1000;

function createRecoveryPool({
    now = new Date('2026-07-10T12:00:00.000Z'),
    games = [],
    users = [],
    transactions = [],
    failOnRefundInsertNumber = null,
    commitThenThrowOnce = false,
    prelockedGameIds = [],
    lockedLedgerGameIds = [],
    lockedUserIds = [],
} = {}) {
    const state = {
        now: new Date(now),
        games: new Map(games.map(game => [game.gameId, {
            gameId: game.gameId,
            tableId: game.tableId || `table-${game.gameId}`,
            theme: game.theme || 'fort-creek',
            playerCount: game.playerCount || 3,
            startTime: new Date(game.startTime || new Date(now).getTime() - (12 * HOUR)),
            lastActivityAt: new Date(game.lastActivityAt || game.startTime || new Date(now).getTime() - (12 * HOUR)),
            heartbeatOwnerId: game.heartbeatOwnerId || null,
            recoveryEligible: game.recoveryEligible !== false && game.recoveryEligible !== null,
            endTime: game.endTime || null,
            outcome: game.outcome || 'In Progress',
            reconciliationStatus: game.reconciliationStatus || null,
            reconciledAt: game.reconciledAt || null,
            reconciledBy: game.reconciledBy || null,
        }])),
        users: new Set(users),
        transactions: transactions.map((transaction, index) => ({
            transactionId: transaction.transactionId || index + 1,
            userId: transaction.userId,
            gameId: transaction.gameId,
            type: transaction.type,
            amount: Number(transaction.amount),
            description: transaction.description || transaction.type,
        })),
        calls: [],
        commits: 0,
        rollbacks: 0,
    };
    const lockedGames = new Set(prelockedGameIds.map(Number));
    const lockedLedgers = new Set(lockedLedgerGameIds.map(Number));
    const lockedUsers = new Set(lockedUserIds.map(Number));
    const waiters = new Map();
    let refundInsertAttempt = 0;
    let commitFaultUsed = false;

    async function acquireGameLock(gameId) {
        if (!lockedGames.has(gameId)) {
            lockedGames.add(gameId);
            return;
        }
        await new Promise(resolve => {
            const queue = waiters.get(gameId) || [];
            queue.push(resolve);
            waiters.set(gameId, queue);
        });
    }

    function releaseGameLock(gameId) {
        if (gameId === null) return;
        const queue = waiters.get(gameId) || [];
        const next = queue.shift();
        if (queue.length === 0) waiters.delete(gameId);
        if (next) next();
        else lockedGames.delete(gameId);
    }

    function stale(game, graceMs) {
        return game.lastActivityAt.getTime() <= state.now.getTime() - Number(graceMs);
    }

    const pool = {
        state,
        async query(text, params = []) {
            const sql = normalizeSql(text);
            state.calls.push({ scope: 'pool', sql, params });
            if (sql.startsWith('WITH unlocked_stale_games AS')) {
                assert.match(sql, /NOW\(\).*INTERVAL '1 millisecond'/i, 'eligibility must use database time');
                assert.match(
                    sql,
                    /FOR UPDATE SKIP LOCKED LIMIT \$3/,
                    'unavailable rows must be skipped before the candidate limit is filled',
                );
                const [graceMs, excluded, limit] = params;
                const excludedIds = new Set(excluded || []);
                const rows = [...state.games.values()]
                    .filter(game => (
                        game.outcome === 'In Progress'
                        && game.recoveryEligible === true
                        && stale(game, graceMs)
                        && !excludedIds.has(game.gameId)
                        && !lockedGames.has(game.gameId)
                    ))
                    .sort((left, right) => left.lastActivityAt - right.lastActivityAt || left.gameId - right.gameId)
                    .slice(0, limit)
                    .map(game => {
                        const buyIns = state.transactions.filter(transaction => (
                            transaction.gameId === game.gameId
                            && transaction.type === 'buy_in'
                            && transaction.amount < 0
                            && transaction.userId !== null
                        ));
                        return {
                            game_id: game.gameId,
                            table_id: game.tableId,
                            theme: game.theme,
                            player_count: game.playerCount,
                            start_time: game.startTime,
                            last_activity_at: game.lastActivityAt,
                            heartbeat_owner_id: game.heartbeatOwnerId,
                            funded_human_count: new Set(buyIns.map(row => row.userId)).size,
                            refund_total: buyIns.reduce((sum, row) => sum - row.amount, 0),
                        };
                    });
                return { rows, rowCount: rows.length };
            }
            if (sql.startsWith('UPDATE game_history SET last_activity_at = NOW()')) {
                let count = 0;
                for (const gameId of params[0] || []) {
                    const game = state.games.get(gameId);
                    if (game?.outcome === 'In Progress') {
                        game.lastActivityAt = new Date(state.now);
                        game.heartbeatOwnerId = params[1];
                        count += 1;
                    }
                }
                return { rows: [], rowCount: count };
            }
            throw new Error(`Unexpected pool query: ${sql}`);
        },
        async connect() {
            let transactionOpen = false;
            let lockedGameId = null;
            let pendingRefunds = [];
            let pendingGameUpdate = null;

            const clearPending = () => {
                pendingRefunds = [];
                pendingGameUpdate = null;
            };

            return {
                async query(text, params = []) {
                    const sql = normalizeSql(text);
                    state.calls.push({ scope: 'client', sql, params });
                    if (sql === 'BEGIN') {
                        transactionOpen = true;
                        clearPending();
                        return { rows: [] };
                    }
                    if (sql.startsWith('SET LOCAL lock_timeout =')
                        || sql.startsWith('SET LOCAL statement_timeout =')) {
                        return { rows: [] };
                    }
                    if (sql.startsWith('SELECT game_id, outcome, start_time')) {
                        const requestedGameId = Number(params[0]);
                        if (sql.includes('SKIP LOCKED') && lockedGames.has(requestedGameId)) {
                            return { rows: [], rowCount: 0 };
                        }
                        lockedGameId = requestedGameId;
                        await acquireGameLock(lockedGameId);
                        const game = state.games.get(lockedGameId);
                        if (!game) return { rows: [], rowCount: 0 };
                        return {
                            rows: [{
                                game_id: game.gameId,
                                outcome: game.outcome,
                                start_time: game.startTime,
                                last_activity_at: game.lastActivityAt,
                                end_time: game.endTime,
                                player_count: game.playerCount,
                                heartbeat_owner_id: game.heartbeatOwnerId,
                                recovery_eligible: game.recoveryEligible,
                                reconciliation_status: game.reconciliationStatus,
                                reconciled_at: game.reconciledAt,
                                is_stale: stale(game, params[1]),
                            }],
                            rowCount: 1,
                        };
                    }
                    if (sql === 'SELECT 1 FROM game_history WHERE game_id = $1') {
                        const game = state.games.get(Number(params[0]));
                        return game ? { rows: [{ '?column?': 1 }], rowCount: 1 } : { rows: [], rowCount: 0 };
                    }
                    if (sql.startsWith('SELECT transaction_id, user_id')) {
                        if (lockedLedgers.has(Number(params[0]))) throwLockTimeout();
                        const rows = state.transactions
                            .filter(transaction => transaction.gameId === Number(params[0]))
                            .sort((left, right) => left.transactionId - right.transactionId)
                            .map(transaction => ({
                                transaction_id: transaction.transactionId,
                                user_id: transaction.userId,
                                transaction_type: transaction.type,
                                amount: transaction.amount.toFixed(2),
                            }));
                        return { rows, rowCount: rows.length };
                    }
                    if (sql.startsWith('SELECT id FROM users')) {
                        if ((params[0] || []).some(userId => lockedUsers.has(Number(userId)))) throwLockTimeout();
                        const ids = (params[0] || []).filter(userId => state.users.has(userId));
                        return { rows: ids.map(id => ({ id })), rowCount: ids.length };
                    }
                    if (sql.startsWith('INSERT INTO transactions')) {
                        refundInsertAttempt += 1;
                        if (refundInsertAttempt === failOnRefundInsertNumber) {
                            throw new Error('injected recovery refund failure');
                        }
                        pendingRefunds.push({
                            transactionId: state.transactions.length + pendingRefunds.length + 1,
                            userId: Number(params[0]),
                            gameId: Number(params[1]),
                            type: 'abandoned_refund',
                            amount: Number(params[2]),
                            description: params[3],
                            idempotencyKey: params[4],
                        });
                        return { rows: [], rowCount: 1 };
                    }
                    if (sql.startsWith('UPDATE game_history SET outcome =')) {
                        const isRecovery = params.length === 5;
                        const gameId = Number(params[3]);
                        const game = state.games.get(gameId);
                        const eligible = game?.outcome === 'In Progress'
                            && (!isRecovery || stale(game, params[4]));
                        if (!eligible) return { rows: [], rowCount: 0 };
                        pendingGameUpdate = {
                            gameId,
                            outcome: params[0],
                            reconciliationStatus: params[1],
                            reconciledBy: params[2],
                        };
                        return { rows: [], rowCount: 1 };
                    }
                    if (sql === 'COMMIT') {
                        state.transactions.push(...pendingRefunds);
                        if (pendingGameUpdate) {
                            const game = state.games.get(pendingGameUpdate.gameId);
                            game.outcome = pendingGameUpdate.outcome;
                            game.reconciliationStatus = pendingGameUpdate.reconciliationStatus;
                            game.reconciledBy = pendingGameUpdate.reconciledBy;
                            game.endTime = new Date(state.now);
                            game.reconciledAt = new Date(state.now);
                        }
                        state.commits += 1;
                        transactionOpen = false;
                        clearPending();
                        releaseGameLock(lockedGameId);
                        lockedGameId = null;
                        if (commitThenThrowOnce && !commitFaultUsed) {
                            commitFaultUsed = true;
                            const error = new Error('recovery commit reply was lost');
                            error.code = '08006';
                            throw error;
                        }
                        return { rows: [] };
                    }
                    if (sql === 'ROLLBACK') {
                        if (transactionOpen) state.rollbacks += 1;
                        transactionOpen = false;
                        clearPending();
                        releaseGameLock(lockedGameId);
                        lockedGameId = null;
                        return { rows: [] };
                    }
                    throw new Error(`Unexpected recovery query: ${sql}`);
                },
                release() {
                    if (transactionOpen) throw new Error('Recovery client released with an open transaction');
                },
            };
        },
    };
    return pool;
}

function throwLockTimeout() {
    const error = new Error('canceling statement due to lock timeout');
    error.code = '55P03';
    throw error;
}

function normalizeSql(text) {
    return String(text).replace(/\s+/g, ' ').trim();
}

function buyIn(gameId, userId, amount) {
    return { gameId, userId, type: 'buy_in', amount };
}

function oldGame(gameId, overrides = {}) {
    return {
        gameId,
        startTime: '2026-07-09T20:00:00.000Z',
        lastActivityAt: '2026-07-09T22:00:00.000Z',
        ...overrides,
    };
}

async function testDryRunUsesDatabaseTimeAndProtectsLiveGames() {
    const pool = createRecoveryPool({
        games: [
            oldGame(1),
            oldGame(2, { lastActivityAt: '2026-07-10T10:00:00.000Z' }),
            oldGame(3, { outcome: 'Game Over! Winner: Alice' }),
            oldGame(4),
        ],
        users: [1, 2],
        transactions: [buyIn(1, 1, -1), buyIn(4, 2, -1)],
    });

    const dryRun = await reconcileAbandonedGames(pool, {
        execute: false,
        graceMs: DEFAULT_GRACE_MS,
        excludeGameIds: [4],
    });
    assert.deepEqual(dryRun.candidates.map(candidate => candidate.gameId), [1]);
    assert.deepEqual(dryRun.deferred, []);
    assert.equal(dryRun.candidates[0].refundTotal, 1);
    assert.equal(pool.state.transactions.length, 2, 'dry run never writes refund rows');
    assert.equal(pool.state.games.get(1).outcome, 'In Progress');
    const candidateCall = pool.state.calls.find(call => call.sql.startsWith('WITH unlocked_stale_games AS'));
    assert.equal(candidateCall.params[0], DEFAULT_GRACE_MS, 'grace duration, not an app-clock cutoff, is sent to PostgreSQL');
    assert.match(candidateCall.sql, /NOW\(\)/);

    await heartbeatLiveGames(pool, [4], { ownerId: 'test-server' });
    assert.equal(pool.state.games.get(4).lastActivityAt.toISOString(), pool.state.now.toISOString());
    assert.equal(pool.state.games.get(4).heartbeatOwnerId, 'test-server');
    assert.deepEqual(
        liveGameIdsFromService({
            getAllEngines: () => ({
                active: { gameStarted: true, gameId: 4 },
                waiting: { gameStarted: false, gameId: null },
                duplicate: { gameStarted: true, gameId: 4 },
            }),
        }),
        [4],
    );
}

async function testConcurrentExactlyOnceLedgerRefunds() {
    const pool = createRecoveryPool({
        games: [oldGame(10)],
        users: [1, 2],
        transactions: [
            buyIn(10, 1, -0.4),
            buyIn(10, 2, -0.4),
        ],
    });
    const results = await Promise.all([
        reconcileAbandonedGame(pool, 10, { graceMs: DEFAULT_GRACE_MS }),
        reconcileAbandonedGame(pool, 10, { graceMs: DEFAULT_GRACE_MS }),
    ]);

    const refunds = pool.state.transactions.filter(transaction => transaction.type === 'abandoned_refund');
    assert.equal(refunds.length, 2, 'one aggregated refund is written per funded player');
    assert.deepEqual(
        refunds.map(refund => [refund.userId, refund.amount]).sort((a, b) => a[0] - b[0]),
        [[1, 0.4], [2, 0.4]],
        'refund amounts come from persisted buy-ins, not current theme cost',
    );
    assert.equal(pool.state.games.get(10).outcome, RECOVERED_OUTCOME);
    assert.equal(pool.state.games.get(10).reconciliationStatus, RECOVERED_STATUS);
    assert.ok(refunds.every(refund => refund.idempotencyKey === `abandoned-refund:10:${refund.userId}`));
    assert.ok(!pool.state.calls.some(call => call.sql.startsWith('UPDATE users')), 'recovery never invents gameplay stats');
    assert.ok(pool.state.calls.some(call => call.sql.includes('FROM game_history') && call.sql.includes('FOR UPDATE')));
    assert.ok(pool.state.calls.some(call => call.sql.includes('FROM transactions') && call.sql.includes('FOR UPDATE')));
    assert.ok(pool.state.calls.some(call => call.sql.includes('FROM users') && call.sql.includes('ORDER BY id FOR UPDATE')));
    assert.equal(results.filter(result => result.status === RECOVERED_STATUS).length, 1);
    assert.equal(results.filter(result => result.status === 'retry_later' && result.reason === 'game_locked').length, 1);
}

async function testLockedRowsDoNotBlockStartupRecovery() {
    assert.equal(DEFAULT_BATCH_LIMIT, 25);
    assert.ok(
        DEFAULT_BATCH_LIMIT * RECOVERY_LOCK_TIMEOUT_MS <= 30000,
        'the default batch has a conservative aggregate row-lock wait bound',
    );
    const pool = createRecoveryPool({
        games: [oldGame(11), oldGame(12), oldGame(13), oldGame(14)],
        users: [1, 2, 3, 4],
        transactions: [
            buyIn(11, 1, -1),
            buyIn(12, 2, -1),
            buyIn(13, 3, -1),
            buyIn(14, 4, -1),
        ],
        prelockedGameIds: [11],
        lockedLedgerGameIds: [12],
        lockedUserIds: [3],
    });

    let deadline;
    const deadlineFailure = new Promise((_, reject) => {
        deadline = setTimeout(
            () => reject(new Error('startup recovery exceeded its configured lock-wait bound')),
            RECOVERY_LOCK_TIMEOUT_MS + 500,
        );
    });
    let batch;
    try {
        batch = await Promise.race([
            reconcileAbandonedGames(pool, { execute: true, graceMs: DEFAULT_GRACE_MS, limit: 3 }),
            deadlineFailure,
        ]);
    } finally {
        clearTimeout(deadline);
    }

    assert.equal(batch.errors.length, 0, 'retryable lock contention does not abort the startup batch');
    assert.deepEqual(
        batch.candidates.map(candidate => candidate.gameId),
        [12, 13, 14],
        'a locked oldest row does not consume the limit or starve later stale games',
    );
    assert.equal(batch.results.length, 1);
    assert.equal(batch.deferred.length, 2, 'retryable lock contention is counted separately');
    const byGameId = new Map([...batch.results, ...batch.deferred].map(result => [result.gameId, result]));
    assert.equal(byGameId.has(11), false, 'the candidate scan skips a held game row entirely');
    assert.deepEqual(
        [byGameId.get(12).status, byGameId.get(12).reason, byGameId.get(12).errorCode],
        ['retry_later', 'lock_timeout', '55P03'],
    );
    assert.deepEqual(
        [byGameId.get(13).status, byGameId.get(13).reason, byGameId.get(13).errorCode],
        ['retry_later', 'lock_timeout', '55P03'],
    );
    assert.equal(byGameId.get(14).status, RECOVERED_STATUS, 'unlocked games continue through the same batch');

    for (const lockedGameId of [11, 12, 13]) {
        assert.equal(pool.state.games.get(lockedGameId).outcome, 'In Progress');
        assert.equal(
            pool.state.transactions.some(row => row.gameId === lockedGameId && row.type === 'abandoned_refund'),
            false,
            `locked game ${lockedGameId} is neither terminalized nor refunded`,
        );
    }
    assert.equal(pool.state.games.get(14).outcome, RECOVERED_OUTCOME);
    assert.equal(pool.state.transactions.filter(row => row.gameId === 14 && row.type === 'abandoned_refund').length, 1);
    assert.ok(pool.state.calls.some(call => call.sql.includes('FOR UPDATE SKIP LOCKED')));
    assert.ok(pool.state.calls.some(call => call.sql.startsWith('SET LOCAL lock_timeout =')));
    assert.ok(pool.state.calls.some(call => call.sql.startsWith('SET LOCAL statement_timeout =')));
}

async function testRecentTerminalAndSuspiciousLedgersAreSafe() {
    const recentPool = createRecoveryPool({
        games: [oldGame(20, { lastActivityAt: '2026-07-10T11:00:00.000Z' })],
        users: [1],
        transactions: [buyIn(20, 1, -1)],
    });
    const recent = await reconcileAbandonedGame(recentPool, 20, { graceMs: DEFAULT_GRACE_MS });
    assert.equal(recent.status, 'recent');
    assert.equal(recentPool.state.transactions.length, 1);

    const payoutPool = createRecoveryPool({
        games: [oldGame(21)],
        users: [1, 2],
        transactions: [
            buyIn(21, 1, -1),
            buyIn(21, 2, -1),
            { gameId: 21, userId: 1, type: 'win_payout', amount: 2 },
        ],
    });
    const quarantined = await reconcileAbandonedGame(payoutPool, 21, { graceMs: DEFAULT_GRACE_MS });
    assert.equal(quarantined.status, MANUAL_REVIEW_STATUS);
    assert.equal(quarantined.reason, 'unexpected_ledger_activity');
    assert.equal(payoutPool.state.games.get(21).outcome, MANUAL_REVIEW_OUTCOME);
    assert.equal(payoutPool.state.transactions.filter(row => row.type === 'abandoned_refund').length, 0);

    const malformedPool = createRecoveryPool({
        games: [oldGame(22)],
        users: [1],
        transactions: [buyIn(22, 1, 0)],
    });
    const malformed = await reconcileAbandonedGame(malformedPool, 22, { graceMs: DEFAULT_GRACE_MS });
    assert.equal(malformed.status, MANUAL_REVIEW_STATUS);
    assert.equal(malformedPool.state.transactions.filter(row => row.type === 'abandoned_refund').length, 0);

    const duplicateBuyInPool = createRecoveryPool({
        games: [oldGame(24)],
        users: [1],
        transactions: [buyIn(24, 1, -0.5), buyIn(24, 1, -0.5)],
    });
    const duplicateBuyIn = await reconcileAbandonedGame(duplicateBuyInPool, 24, { graceMs: DEFAULT_GRACE_MS });
    assert.equal(duplicateBuyIn.status, MANUAL_REVIEW_STATUS);
    assert.equal(duplicateBuyIn.reason, 'inconsistent_buy_ins');
    assert.equal(duplicateBuyInPool.state.transactions.filter(row => row.type === 'abandoned_refund').length, 0);

    const endedInProgressPool = createRecoveryPool({
        games: [oldGame(25, { endTime: '2026-07-10T01:00:00.000Z' })],
        users: [1],
        transactions: [buyIn(25, 1, -1)],
    });
    const endedInProgress = await reconcileAbandonedGame(endedInProgressPool, 25, { graceMs: DEFAULT_GRACE_MS });
    assert.equal(endedInProgress.status, MANUAL_REVIEW_STATUS);
    assert.equal(endedInProgress.reason, 'inconsistent_game_history');

    const missingUserPool = createRecoveryPool({
        games: [oldGame(23)],
        users: [],
        transactions: [buyIn(23, 99, -1)],
    });
    const missingUser = await reconcileAbandonedGame(missingUserPool, 23, { graceMs: DEFAULT_GRACE_MS });
    assert.equal(missingUser.status, MANUAL_REVIEW_STATUS);
    assert.equal(missingUser.reason, 'funded_user_missing');
}

async function testLegacyGamesAreQuarantinedWithoutRefunds() {
    const pool = createRecoveryPool({
        games: [oldGame(26, { recoveryEligible: null })],
        users: [1],
        transactions: [buyIn(26, 1, -20)],
    });

    const dryRun = await reconcileAbandonedGames(pool, {
        execute: false,
        graceMs: DEFAULT_GRACE_MS,
    });
    assert.deepEqual(dryRun.candidates, [], 'legacy rows never enter automatic recovery batches');

    const directAttempt = await reconcileAbandonedGame(pool, 26, { graceMs: DEFAULT_GRACE_MS });
    assert.equal(directAttempt.status, 'legacy_quarantined');
    assert.equal(directAttempt.reason, 'pre_hardened_lifecycle');
    assert.equal(pool.state.games.get(26).outcome, 'In Progress');
    assert.equal(
        pool.state.transactions.some(row => row.gameId === 26 && row.type === 'abandoned_refund'),
        false,
        'an ambiguous historical loss is never converted into a refund',
    );
}

async function testRollbackAndLostCommitResponseAreIdempotent() {
    const failingPool = createRecoveryPool({
        games: [oldGame(30)],
        users: [1, 2],
        transactions: [buyIn(30, 1, -1), buyIn(30, 2, -1)],
        failOnRefundInsertNumber: 2,
    });
    await assert.rejects(
        reconcileAbandonedGame(failingPool, 30, { graceMs: DEFAULT_GRACE_MS }),
        /injected recovery refund failure/,
    );
    assert.equal(failingPool.state.games.get(30).outcome, 'In Progress');
    assert.equal(failingPool.state.transactions.filter(row => row.type === 'abandoned_refund').length, 0);
    assert.equal(failingPool.state.rollbacks, 1);

    const lostReplyPool = createRecoveryPool({
        games: [oldGame(31)],
        users: [1],
        transactions: [buyIn(31, 1, -1)],
        commitThenThrowOnce: true,
    });
    await assert.rejects(
        reconcileAbandonedGame(lostReplyPool, 31, { graceMs: DEFAULT_GRACE_MS }),
        /commit reply was lost/,
    );
    assert.equal(lostReplyPool.state.games.get(31).outcome, RECOVERED_OUTCOME);
    const retry = await reconcileAbandonedGame(lostReplyPool, 31, { graceMs: DEFAULT_GRACE_MS });
    assert.equal(retry.alreadyReconciled, true);
    assert.equal(lostReplyPool.state.transactions.filter(row => row.type === 'abandoned_refund').length, 1);
}

async function testMonitorHeartbeatsBeforeRecoveryAndHandlesBotsOnly() {
    const pool = createRecoveryPool({
        games: [oldGame(40), oldGame(41)],
        users: [1],
        transactions: [buyIn(40, 1, -1)],
    });
    const monitor = createAbandonedGameRecoveryMonitor({
        pool,
        graceMs: DEFAULT_GRACE_MS,
        intervalMs: 1000,
        getLiveGameIds: () => [40],
        logger: { info() {}, error() {} },
    });
    const result = await monitor.runNow();
    assert.equal(pool.state.games.get(40).outcome, 'In Progress', 'an old but live game is heartbeated and excluded');
    assert.equal(pool.state.games.get(41).outcome, RECOVERED_OUTCOME, 'a bot-only orphan is terminalized with no refund');
    assert.equal(result.results[0].refundTotalCents, 0);
    const heartbeatIndex = pool.state.calls.findIndex(call => call.sql.startsWith('UPDATE game_history SET last_activity_at'));
    const candidateIndex = pool.state.calls.findIndex(call => call.sql.startsWith('WITH unlocked_stale_games AS'));
    assert.ok(heartbeatIndex >= 0 && heartbeatIndex < candidateIndex, 'heartbeat runs before the abandoned scan');
    const rollingProcessScan = await reconcileAbandonedGames(pool, {
        execute: false,
        graceMs: DEFAULT_GRACE_MS,
        excludeGameIds: [],
    });
    assert.ok(
        !rollingProcessScan.candidates.some(candidate => candidate.gameId === 40),
        'the persisted heartbeat protects a live game even from another process without the in-memory exclusion',
    );

    let intervalCallback;
    let unrefCalled = false;
    let cleared = false;
    const originalSetInterval = global.setInterval;
    const originalClearInterval = global.clearInterval;
    global.setInterval = callback => {
        intervalCallback = callback;
        return { unref() { unrefCalled = true; } };
    };
    global.clearInterval = () => { cleared = true; };
    try {
        monitor.start();
        assert.equal(typeof intervalCallback, 'function');
        assert.equal(unrefCalled, true);
        monitor.stop();
        assert.equal(cleared, true);
    } finally {
        global.setInterval = originalSetInterval;
        global.clearInterval = originalClearInterval;
    }
}

function testMonitorRejectsUnsafeRecoveryTiming() {
    const intervalMs = 1000;
    assert.equal(MIN_GRACE_HEARTBEAT_INTERVALS, 3);
    assert.deepEqual(
        validateRecoveryTiming({ graceMs: 3 * intervalMs, intervalMs }),
        { graceMs: 3 * intervalMs, intervalMs },
        'the third missed heartbeat is the earliest accepted recovery boundary',
    );
    assert.throws(
        () => validateRecoveryTiming({ graceMs: (3 * intervalMs) - 1, intervalMs }),
        /at least 3 heartbeat intervals/,
    );
    assert.throws(
        () => createAbandonedGameRecoveryMonitor({
            pool: { query() {}, connect() {} },
            getLiveGameIds: () => [],
            graceMs: 2 * intervalMs,
            intervalMs,
        }),
        /at least 3 heartbeat intervals/,
        'monitor construction rejects a grace period that cannot tolerate two missed heartbeats',
    );
}

async function testSchemaUpgradeAndCliSafety() {
    const queries = [];
    let schemaClientReleased = false;
    const schemaClient = {
        async query(text) {
            queries.push(normalizeSql(text));
            return { rows: [], rowCount: 0 };
        },
        release() { schemaClientReleased = true; },
    };
    const schemaPool = {
        async connect() { return schemaClient; },
    };
    await createDbTables(schemaPool);
    const commitIndex = queries.indexOf('COMMIT');
    const enumUpgradeIndex = queries.findIndex(query => query.includes("ADD VALUE IF NOT EXISTS 'abandoned_refund'"));
    const activityAddIndex = queries.indexOf(
        'ALTER TABLE game_history ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMP WITH TIME ZONE',
    );
    const activityDefaultIndex = queries.indexOf(
        'ALTER TABLE game_history ALTER COLUMN last_activity_at SET DEFAULT CURRENT_TIMESTAMP',
    );
    const recoveryEligibilityAddIndex = queries.indexOf(
        'ALTER TABLE game_history ADD COLUMN IF NOT EXISTS recovery_eligible BOOLEAN',
    );
    const recoveryEligibilityDefaultIndex = queries.indexOf(
        'ALTER TABLE game_history ALTER COLUMN recovery_eligible SET DEFAULT TRUE',
    );
    const activityBackfillIndex = queries.indexOf(
        'UPDATE game_history SET last_activity_at = clock_timestamp() WHERE last_activity_at IS NULL',
    );
    assert.ok(queries.some(query => query.includes('last_activity_at TIMESTAMP WITH TIME ZONE')));
    assert.ok(queries.some(query => query.includes('heartbeat_owner_id VARCHAR(128)')));
    assert.ok(recoveryEligibilityAddIndex >= 0, 'legacy recovery eligibility starts nullable');
    assert.ok(
        recoveryEligibilityDefaultIndex > recoveryEligibilityAddIndex,
        'only games created after the migration inherit recovery eligibility',
    );
    assert.ok(queries.some(query => query.includes('reconciliation_status VARCHAR(50)')));
    assert.ok(queries.some(query => query.includes('idempotency_key TEXT')));
    assert.ok(queries.some(query => query.includes('idx_transactions_idempotency_key')));
    assert.ok(queries.some(query => query.includes('idx_game_history_recovery_candidates')));
    assert.ok(activityAddIndex >= 0, 'legacy column is added without eagerly backfilling at transaction start');
    assert.ok(activityDefaultIndex > activityAddIndex, 'new games retain an activity timestamp default');
    assert.equal(
        activityBackfillIndex,
        commitIndex - 1,
        'null legacy activity is backfilled from wall-clock time at the end of the migration',
    );
    assert.doesNotMatch(queries[activityAddIndex], /DEFAULT/);
    assert.match(queries[activityBackfillIndex], /WHERE last_activity_at IS NULL$/);
    assert.ok(enumUpgradeIndex > commitIndex, 'existing enum upgrade commits before recovery can use the value');
    assert.equal(schemaClientReleased, true);

    const failingQueries = [];
    let failingClientReleased = false;
    const failingSchemaPool = {
        async connect() {
            return {
                async query(text) {
                    const sql = normalizeSql(text);
                    failingQueries.push(sql);
                    if (sql.includes('CREATE TABLE IF NOT EXISTS transactions')) {
                        throw new Error('injected migration failure');
                    }
                    return { rows: [], rowCount: 0 };
                },
                release() { failingClientReleased = true; },
            };
        },
    };
    await assert.rejects(createDbTables(failingSchemaPool), /injected migration failure/);
    assert.ok(failingQueries.includes('ROLLBACK'));
    assert.equal(failingClientReleased, true);

    assert.deepEqual(parseArgs([]), {
        execute: false,
        graceMs: DEFAULT_GRACE_MS,
        limit: DEFAULT_BATCH_LIMIT,
    });
    assert.equal(parseArgs(['--execute', '--grace-hours=12', '--limit=25']).execute, true);
    assert.equal(parseArgs(['--grace-hours=12']).graceMs, 12 * HOUR);
    assert.throws(() => parseArgs(['--grace-hours=0.5']), /at least 1/);
    assert.throws(() => parseArgs(['--limit=0']), /1 through 1000/);
}

async function testCliSignalsOutstandingWorkWithoutLeakingErrors() {
    const originalExitCode = process.exitCode;
    let poolsEnded = 0;
    class FakePool {
        constructor(options) {
            assert.equal(options.connectionString, 'use-a-local-test-database');
        }

        async end() { poolsEnded += 1; }
    }

    async function invoke(result) {
        const outputLines = [];
        process.exitCode = 0;
        await runCli({
            argv: ['--execute'],
            env: { POSTGRES_CONNECT_STRING: 'use-a-local-test-database' },
            PoolClass: FakePool,
            reconcile: async () => result,
            output: {
                log: (...parts) => outputLines.push(parts.join(' ')),
                error: (...parts) => outputLines.push(parts.join(' ')),
            },
        });
        return { exitCode: process.exitCode, output: outputLines.join('\n') };
    }

    try {
        const deferredOnly = await invoke({
            candidates: [],
            results: [],
            deferred: [{ gameId: 70, status: 'retry_later', reason: 'lock_timeout' }],
            errors: [],
        });
        assert.equal(deferredOnly.exitCode, 1, 'deferred execute work produces a retryable nonzero exit');
        assert.match(deferredOnly.output, /0 processed; 1 deferred; 0 error\(s\)/);

        const errorOnly = await invoke({
            candidates: [],
            results: [],
            deferred: [],
            errors: [{ gameId: 71, code: '55P03', message: 'SECRET_DATABASE_ROW_CONTENT' }],
        });
        assert.equal(errorOnly.exitCode, 1);
        assert.match(errorOnly.output, /game #71: failed \(55P03\)/);
        assert.doesNotMatch(errorOnly.output, /SECRET_DATABASE_ROW_CONTENT|use-a-local-test-database/);
        assert.equal(poolsEnded, 2);
    } finally {
        process.exitCode = originalExitCode;
    }
}

async function testReadinessWaitsForInitialRecoverySetup() {
    let releaseInitialization;
    let listenCalled = false;
    const initialization = new Promise(resolve => { releaseInitialization = resolve; });
    const fakeServer = {
        once() {},
        off() {},
        listen(port, callback) {
            listenCalled = true;
            assert.equal(port, 0);
            callback();
        },
    };
    const starting = initializeThenListen({
        initialize: () => initialization,
        httpServer: fakeServer,
        port: 0,
    });
    await Promise.resolve();
    assert.equal(listenCalled, false, 'network readiness remains closed during initial recovery');
    releaseInitialization();
    await starting;
    assert.equal(listenCalled, true);
    assert.equal(applicationServer.listening, false, 'importing the server module never exposes a port');

    const originalGrace = process.env.ABANDONED_GAME_GRACE_HOURS;
    const originalInterval = process.env.ABANDONED_GAME_RECOVERY_INTERVAL_MINUTES;
    try {
        delete process.env.ABANDONED_GAME_GRACE_HOURS;
        delete process.env.ABANDONED_GAME_RECOVERY_INTERVAL_MINUTES;
        assert.deepEqual(recoveryTimingFromEnvironment(), {
            graceMs: DEFAULT_GRACE_MS,
            intervalMs: 15 * 60 * 1000,
        });
        process.env.ABANDONED_GAME_GRACE_HOURS = '0.5';
        assert.throws(recoveryTimingFromEnvironment, /at least 1/);
        process.env.ABANDONED_GAME_GRACE_HOURS = '1';
        process.env.ABANDONED_GAME_RECOVERY_INTERVAL_MINUTES = '21';
        assert.throws(
            recoveryTimingFromEnvironment,
            /at least 3 heartbeat intervals/,
            'server environment parsing rejects a live-game-unsafe recovery cadence',
        );
    } finally {
        if (originalGrace === undefined) delete process.env.ABANDONED_GAME_GRACE_HOURS;
        else process.env.ABANDONED_GAME_GRACE_HOURS = originalGrace;
        if (originalInterval === undefined) delete process.env.ABANDONED_GAME_RECOVERY_INTERVAL_MINUTES;
        else process.env.ABANDONED_GAME_RECOVERY_INTERVAL_MINUTES = originalInterval;
    }
}

async function runAbandonedGameRecoveryTests() {
    await testDryRunUsesDatabaseTimeAndProtectsLiveGames();
    await testConcurrentExactlyOnceLedgerRefunds();
    await testLockedRowsDoNotBlockStartupRecovery();
    await testRecentTerminalAndSuspiciousLedgersAreSafe();
    await testLegacyGamesAreQuarantinedWithoutRefunds();
    await testRollbackAndLostCommitResponseAreIdempotent();
    await testMonitorHeartbeatsBeforeRecoveryAndHandlesBotsOnly();
    testMonitorRejectsUnsafeRecoveryTiming();
    await testSchemaUpgradeAndCliSafety();
    await testCliSignalsOutstandingWorkWithoutLeakingErrors();
    await testReadinessWaitsForInitialRecoverySetup();
    console.log('Abandoned-game crash recovery tests passed.');
}

if (require.main === module) {
    runAbandonedGameRecoveryTests().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = runAbandonedGameRecoveryTests;
