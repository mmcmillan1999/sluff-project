'use strict';

const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const createAdminRoutes = require('../src/api/admin');
const { DEFAULT_HEARTBEAT_INTERVAL_MS } = require('../src/maintenance/abandonedGameRecovery');
const {
    ADMIN_RECOVERY_GRACE_MS,
    ADMIN_RECOVERY_MIN_SEASON_NUMBER,
    AdminGameRecoveryConflictError,
    SAFE_RECOVERY_CANDIDATES_QUERY,
    applyAdminGameRecovery,
    candidatesFromRows,
    normalizeGameIds,
    previewAdminGameRecovery,
    refundReviewedAdminGame,
    validateAdminRecoveryHeartbeatCadence,
} = require('../src/services/adminGameRecoveryService');

function candidateRows() {
    const common = {
        table_id: 'qp-fort-creek-1',
        theme: 'fort-creek',
        player_count: 3,
        start_time: new Date('2026-07-18T01:00:00.000Z'),
        last_activity_at: new Date('2026-07-18T01:05:00.000Z'),
        season_id: 2,
        season_number: 2,
        season_name: 'Alpha Season 2',
    };
    return [
        {
            ...common,
            game_id: 42,
            buy_in_transaction_id: 101,
            user_id: 7,
            username: 'Alice',
            buy_in_amount: '-1.00',
            reverses_transaction_id: null,
        },
        {
            ...common,
            game_id: 42,
            buy_in_transaction_id: 102,
            user_id: 8,
            username: 'Bob',
            buy_in_amount: '-1.00',
            reverses_transaction_id: null,
        },
    ];
}

async function testStrictPreviewPolicyAndPlayerDetail() {
    const calls = [];
    const pool = {
        async query(text, params) {
            calls.push({ text, params });
            return { rows: candidateRows() };
        },
    };
    const preview = await previewAdminGameRecovery(pool, {
        excludeGameIds: [99],
        limit: 2,
    });

    assert.equal(ADMIN_RECOVERY_GRACE_MS, 10 * 60 * 1000);
    assert.equal(ADMIN_RECOVERY_MIN_SEASON_NUMBER, 2);
    assert.match(SAFE_RECOVERY_CANDIDATES_QUERY, /season\.season_number >= \$3/);
    assert.match(SAFE_RECOVERY_CANDIDATES_QUERY, /game\.outcome = 'In Progress'/);
    assert.match(SAFE_RECOVERY_CANDIDATES_QUERY, /game\.recovery_eligible IS TRUE/);
    assert.match(SAFE_RECOVERY_CANDIDATES_QUERY, /game\.end_time IS NULL/);
    assert.match(SAFE_RECOVERY_CANDIDATES_QUERY, /game\.reconciliation_status IS NULL/);
    assert.match(SAFE_RECOVERY_CANDIDATES_QUERY, /< NOW\(\) - \(\$1::bigint/);
    assert.match(SAFE_RECOVERY_CANDIDATES_QUERY, /BOOL_AND\([\s\S]*transaction_type::text = 'buy_in'/);
    assert.match(SAFE_RECOVERY_CANDIDATES_QUERY, /ledger\.amount < 0/);
    assert.doesNotMatch(
        SAFE_RECOVERY_CANDIDATES_QUERY,
        /COUNT\(\*\) = COUNT\(DISTINCT ledger\.user_id\)|MIN\(ledger\.amount\) = MAX/,
        'duplicate and unequal negative source buy-ins remain visible for exact refunds',
    );
    assert.deepEqual(calls[0].params, [ADMIN_RECOVERY_GRACE_MS, [99], 2, 3]);
    assert.deepEqual(preview.criteria, {
        inactivityMinutes: 10,
        minimumSeasonNumber: 2,
        requiresFundedBuyIn: true,
        requiresNoPayouts: true,
    });
    assert.equal(preview.candidateCount, 1);
    assert.equal(preview.totalRefundCents, 200);
    assert.equal(preview.candidates[0].gameId, 42);
    assert.deepEqual(
        preview.candidates[0].fundedPlayers.map(player => [player.username, player.buyInCents]),
        [['Alice', 100], ['Bob', 100]],
    );
    assert.match(preview.previewHash, /^[a-f0-9]{64}$/);
    assert.match(preview.candidates[0].fingerprint, /^[a-f0-9]{64}$/);

    const duplicateSourceRows = [
        candidateRows()[0],
        {
            ...candidateRows()[0],
            buy_in_transaction_id: 103,
            buy_in_amount: '-2.00',
        },
    ];
    const duplicateCandidate = candidatesFromRows(duplicateSourceRows, 1).candidates[0];
    assert.equal(duplicateCandidate.fundedPlayers.length, 1, 'player totals aggregate duplicate source charges');
    assert.equal(duplicateCandidate.fundedPlayers[0].buyInCents, 300);
    assert.deepEqual(duplicateCandidate.fundedPlayers[0].sourceTransactionIds, [101, 103]);
    assert.equal(duplicateCandidate.sourceBuyIns.length, 2, 'every source charge remains individually auditable');

    assert.equal(
        validateAdminRecoveryHeartbeatCadence(DEFAULT_HEARTBEAT_INTERVAL_MS),
        DEFAULT_HEARTBEAT_INTERVAL_MS,
    );
    assert.throws(
        () => validateAdminRecoveryHeartbeatCadence((ADMIN_RECOVERY_GRACE_MS / 3) + 1),
        /at least three times/,
    );
    assert.throws(() => normalizeGameIds([true]), /positive integer/);

    const changedPool = { query: async () => ({ rows: candidateRows().slice(0, 1) }) };
    const changed = await previewAdminGameRecovery(changedPool);
    assert.notEqual(changed.previewHash, preview.previewHash, 'player-level ledger changes invalidate review');
}

async function testApplyRevalidatesReviewedSelection() {
    const reviewedPreview = {
        previewHash: 'b'.repeat(64),
        candidates: [{
            gameId: 42,
            seasonId: 2,
            seasonNumber: 2,
            fingerprint: 'd'.repeat(64),
            fundedPlayers: [
                { userId: 7, username: 'Alice', buyInCents: 100 },
                { userId: 8, username: 'Bob', buyInCents: 100 },
            ],
        }],
    };
    const recoveryCalls = [];
    const result = await applyAdminGameRecovery({}, {
        gameIds: [42, 42],
        expectedPreviewHash: reviewedPreview.previewHash,
        excludeGameIds: [99],
        appliedBy: { id: 2, username: 'Admin' },
        preview: async (_pool, options) => {
            assert.deepEqual(options, { excludeGameIds: [99] });
            return reviewedPreview;
        },
        recover: async (_pool, candidate, options) => {
            recoveryCalls.push({ candidate, options });
            return {
                gameId: candidate.gameId,
                status: 'abandoned_refunded',
                alreadyReconciled: false,
                refunds: [{ userId: 7, amountCents: 100 }, { userId: 8, amountCents: 100 }],
                players: [
                    { userId: 7, username: 'Alice', refundCents: 100 },
                    { userId: 8, username: 'Bob', refundCents: 100 },
                ],
                refundedSourceCount: 2,
                refundTotalCents: 200,
            };
        },
    });

    assert.equal(recoveryCalls.length, 1, 'duplicate selected ids are safely deduplicated');
    assert.equal(recoveryCalls[0].candidate.gameId, 42);
    assert.deepEqual(recoveryCalls[0].options, {
        recoveryOwnerId: 'admin-recovery:2:Admin',
    });
    assert.equal(result.outcome, 'complete');
    assert.equal(result.requestedGameCount, 1);
    assert.equal(result.refundedGameCount, 1);
    assert.equal(result.refundedPlayerCount, 2);
    assert.equal(result.refundTotalCents, 200);
    assert.deepEqual(result.results[0].players, [
        { userId: 7, username: 'Alice', refundCents: 100 },
        { userId: 8, username: 'Bob', refundCents: 100 },
    ]);

    let reconciled = false;
    await assert.rejects(
        applyAdminGameRecovery({}, {
            gameIds: [42],
            expectedPreviewHash: 'a'.repeat(64),
            appliedBy: { id: 2, username: 'Admin' },
            preview: async () => reviewedPreview,
            recover: async () => { reconciled = true; },
        }),
        error => (
            error instanceof AdminGameRecoveryConflictError
            && error.code === 'RECOVERY_PREVIEW_STALE'
        ),
    );
    assert.equal(reconciled, false, 'a stale preview cannot write refunds');

    const twoGamePreview = {
        previewHash: 'e'.repeat(64),
        candidates: [
            { ...reviewedPreview.candidates[0], gameId: 42 },
            { ...reviewedPreview.candidates[0], gameId: 43, fingerprint: 'f'.repeat(64) },
        ],
    };
    const partial = await applyAdminGameRecovery({}, {
        gameIds: [42, 43],
        expectedPreviewHash: twoGamePreview.previewHash,
        appliedBy: { id: 2, username: 'Admin' },
        preview: async () => twoGamePreview,
        recover: async (_pool, candidate) => {
            if (candidate.gameId === 43) {
                throw new AdminGameRecoveryConflictError('RECOVERY_GAME_CHANGED', 'changed');
            }
            return {
                gameId: 42,
                status: 'abandoned_refunded',
                refunds: [{ userId: 7, amountCents: 100 }],
                refundedSourceCount: 1,
                refundTotalCents: 100,
                players: [{ userId: 7, username: 'Alice', refundCents: 100 }],
            };
        },
    });
    assert.equal(partial.outcome, 'partial');
    assert.equal(partial.refundedGameCount, 1);
    assert.equal(partial.notRefundedGameCount, 1);

    const unknown = await applyAdminGameRecovery({}, {
        gameIds: [42],
        expectedPreviewHash: reviewedPreview.previewHash,
        appliedBy: { id: 2, username: 'Admin' },
        preview: async () => reviewedPreview,
        recover: async () => {
            const error = new Error('lost commit reply');
            error.code = '08006';
            throw error;
        },
    });
    assert.equal(unknown.outcome, 'unknown');
    assert.deepEqual(unknown.errors, [{ gameId: 42, code: '08006' }]);
}

function normalizeSql(text) {
    return String(text).replace(/\s+/g, ' ').trim();
}

function createStatefulRecoveryPool({
    now = '2026-07-18T12:00:00.000Z',
    lastActivityAt = '2026-07-18T11:40:00.000Z',
    seasonNumber = 2,
    failOnRefundInsert = null,
    mutateBeforeLockedLedger = null,
} = {}) {
    const state = {
        now: new Date(now),
        game: {
            gameId: 42,
            tableId: 'qp-fort-creek-1',
            theme: 'fort-creek',
            playerCount: 3,
            startTime: new Date('2026-07-18T11:30:00.000Z'),
            lastActivityAt: new Date(lastActivityAt),
            endTime: null,
            outcome: 'In Progress',
            recoveryEligible: true,
            reconciliationStatus: null,
            reconciledBy: null,
            seasonId: seasonNumber,
            seasonNumber,
            seasonName: `Alpha Season ${seasonNumber}`,
        },
        users: new Map([
            [7, { id: 7, username: 'Alice' }],
            [8, { id: 8, username: 'Bob' }],
            [9, { id: 9, username: 'Cara' }],
        ]),
        transactions: [
            { transactionId: 101, userId: 7, gameId: 42, type: 'buy_in', amount: -1, reversesTransactionId: null },
            { transactionId: 102, userId: 7, gameId: 42, type: 'buy_in', amount: -2, reversesTransactionId: null },
            { transactionId: 103, userId: 8, gameId: 42, type: 'buy_in', amount: -1, reversesTransactionId: null },
        ],
        calls: [],
        rollbacks: 0,
    };
    let mutationUsed = false;
    let insertCount = 0;

    const ledgerRows = () => state.transactions
        .filter(row => row.gameId === state.game.gameId && row.type !== 'abandoned_refund')
        .sort((left, right) => left.transactionId - right.transactionId)
        .map(row => ({
            transaction_id: row.transactionId,
            user_id: row.userId,
            transaction_type: row.type,
            amount: Number(row.amount).toFixed(2),
            reverses_transaction_id: row.reversesTransactionId,
        }));

    const pool = {
        state,
        async connect() {
            let open = false;
            let pendingRefunds = [];
            let pendingGameUpdate = null;
            return {
                async query(text, params = []) {
                    const sql = normalizeSql(text);
                    state.calls.push({ sql, params });
                    if (sql === 'BEGIN ISOLATION LEVEL SERIALIZABLE') {
                        open = true;
                        return { rows: [] };
                    }
                    if (sql.startsWith('SET LOCAL ')) return { rows: [] };
                    if (sql.startsWith('SELECT game.game_id,')) {
                        const game = state.game;
                        if (Number(params[0]) !== game.gameId) return { rows: [] };
                        return { rows: [{
                            game_id: game.gameId,
                            table_id: game.tableId,
                            theme: game.theme,
                            player_count: game.playerCount,
                            start_time: game.startTime,
                            last_activity_at: game.lastActivityAt,
                            end_time: game.endTime,
                            outcome: game.outcome,
                            recovery_eligible: game.recoveryEligible,
                            reconciliation_status: game.reconciliationStatus,
                            season_id: game.seasonId,
                            season_number: game.seasonNumber,
                            season_name: game.seasonName,
                            is_stale: game.lastActivityAt.getTime()
                                < state.now.getTime() - Number(params[1]),
                        }] };
                    }
                    if (sql.startsWith('SELECT transaction_id, user_id,')) {
                        if (sql.endsWith('FOR UPDATE') && !mutationUsed && mutateBeforeLockedLedger) {
                            mutationUsed = true;
                            mutateBeforeLockedLedger(state);
                        }
                        const rows = ledgerRows();
                        return { rows, rowCount: rows.length };
                    }
                    if (sql.startsWith('SELECT id, username FROM users')) {
                        const rows = (params[0] || [])
                            .map(id => state.users.get(Number(id)))
                            .filter(Boolean);
                        return { rows, rowCount: rows.length };
                    }
                    if (sql.startsWith('INSERT INTO transactions')) {
                        insertCount += 1;
                        if (insertCount === failOnRefundInsert) {
                            throw new Error('injected admin refund failure');
                        }
                        const transactionId = 500 + insertCount;
                        pendingRefunds.push({
                            transactionId,
                            userId: Number(params[0]),
                            gameId: Number(params[1]),
                            type: 'abandoned_refund',
                            amount: Number(params[2]),
                            description: params[3],
                            idempotencyKey: params[4],
                            reversesTransactionId: Number(params[5]),
                        });
                        return { rows: [{ transaction_id: transactionId }], rowCount: 1 };
                    }
                    if (sql.startsWith('UPDATE game_history SET outcome =')) {
                        const game = state.game;
                        const eligible = game.outcome === 'In Progress'
                            && game.endTime === null
                            && game.reconciliationStatus === null
                            && game.recoveryEligible === true
                            && game.lastActivityAt.getTime()
                                < state.now.getTime() - Number(params[5]);
                        if (!eligible) return { rows: [], rowCount: 0 };
                        pendingGameUpdate = {
                            outcome: params[0],
                            reconciliationStatus: params[1],
                            reconciledBy: params[2],
                        };
                        return { rows: [], rowCount: 1 };
                    }
                    if (sql === 'COMMIT') {
                        state.transactions.push(...pendingRefunds);
                        if (pendingGameUpdate) {
                            state.game.outcome = pendingGameUpdate.outcome;
                            state.game.reconciliationStatus = pendingGameUpdate.reconciliationStatus;
                            state.game.reconciledBy = pendingGameUpdate.reconciledBy;
                            state.game.endTime = new Date(state.now);
                        }
                        pendingRefunds = [];
                        pendingGameUpdate = null;
                        open = false;
                        return { rows: [] };
                    }
                    if (sql === 'ROLLBACK') {
                        pendingRefunds = [];
                        pendingGameUpdate = null;
                        state.rollbacks += 1;
                        open = false;
                        return { rows: [] };
                    }
                    throw new Error(`Unexpected stateful recovery query: ${sql}`);
                },
                release() {
                    assert.equal(open, false, 'admin recovery releases no open transaction');
                },
            };
        },
    };
    return pool;
}

function candidateFromState(state) {
    const game = state.game;
    const rows = state.transactions
        .filter(row => row.gameId === game.gameId)
        .sort((left, right) => left.transactionId - right.transactionId)
        .map(row => ({
            game_id: game.gameId,
            table_id: game.tableId,
            theme: game.theme,
            player_count: game.playerCount,
            start_time: game.startTime,
            last_activity_at: game.lastActivityAt,
            season_id: game.seasonId,
            season_number: game.seasonNumber,
            season_name: game.seasonName,
            buy_in_transaction_id: row.transactionId,
            user_id: row.userId,
            username: state.users.get(row.userId)?.username,
            buy_in_amount: Number(row.amount).toFixed(2),
            reverses_transaction_id: row.reversesTransactionId,
        }));
    return candidatesFromRows(rows, 1).candidates[0];
}

async function testAtomicSourceLinkedRefundAndLockedManifest() {
    const pool = createStatefulRecoveryPool();
    const reviewed = candidateFromState(pool.state);
    assert.equal(reviewed.fundedPlayers.length, 2);
    assert.equal(reviewed.sourceBuyIns.length, 3);

    const result = await refundReviewedAdminGame(pool, reviewed, {
        recoveryOwnerId: 'admin-recovery:2:Admin',
    });
    assert.equal(result.refundedSourceCount, 3);
    assert.equal(result.players.length, 2);
    assert.equal(result.refundTotalCents, 400);
    assert.deepEqual(result.refunds.map(row => row.sourceTransactionId), [101, 102, 103]);
    const storedRefunds = pool.state.transactions.filter(row => row.type === 'abandoned_refund');
    assert.deepEqual(storedRefunds.map(row => row.reversesTransactionId), [101, 102, 103]);
    assert.deepEqual(
        storedRefunds.map(row => row.idempotencyKey),
        [101, 102, 103].map(id => `abandoned-refund:42:source:${id}`),
    );
    assert.equal(pool.state.game.reconciliationStatus, 'abandoned_refunded');
    assert.equal(pool.state.game.reconciledBy, 'admin-recovery:2:Admin');

    const gameLockIndex = pool.state.calls.findIndex(call => call.sql.startsWith('SELECT game.game_id,'));
    const initialLedgerIndex = pool.state.calls.findIndex(call => (
        call.sql.startsWith('SELECT transaction_id, user_id,') && !call.sql.endsWith('FOR UPDATE')
    ));
    const userLockIndex = pool.state.calls.findIndex(call => call.sql.startsWith('SELECT id, username FROM users'));
    const ledgerLockIndex = pool.state.calls.findIndex(call => (
        call.sql.startsWith('SELECT transaction_id, user_id,') && call.sql.endsWith('FOR UPDATE')
    ));
    assert.ok(gameLockIndex < initialLedgerIndex);
    assert.ok(initialLedgerIndex < userLockIndex);
    assert.ok(userLockIndex < ledgerLockIndex);
}

async function testLockedManifestRejectsMutationAndRollsBackFailures() {
    const changedPool = createStatefulRecoveryPool({
        mutateBeforeLockedLedger(state) {
            state.transactions.push({
                transactionId: 104,
                userId: 9,
                gameId: 42,
                type: 'buy_in',
                amount: -1,
                reversesTransactionId: null,
            });
        },
    });
    const reviewed = candidateFromState(changedPool.state);
    await assert.rejects(
        refundReviewedAdminGame(changedPool, reviewed, {
            recoveryOwnerId: 'admin-recovery:2:Admin',
        }),
        error => error instanceof AdminGameRecoveryConflictError
            && error.code === 'RECOVERY_LEDGER_CHANGED',
    );
    assert.equal(changedPool.state.transactions.some(row => row.type === 'abandoned_refund'), false);
    assert.equal(changedPool.state.game.outcome, 'In Progress');
    assert.equal(changedPool.state.rollbacks, 1);

    const failingPool = createStatefulRecoveryPool({ failOnRefundInsert: 2 });
    await assert.rejects(
        refundReviewedAdminGame(failingPool, candidateFromState(failingPool.state), {
            recoveryOwnerId: 'admin-recovery:2:Admin',
        }),
        /injected admin refund failure/,
    );
    assert.equal(failingPool.state.transactions.some(row => row.type === 'abandoned_refund'), false);
    assert.equal(failingPool.state.game.outcome, 'In Progress');
    assert.equal(failingPool.state.rollbacks, 1);
}

async function testLockedSeasonAndTenMinuteBoundary() {
    for (const [options, code] of [
        [{ seasonNumber: 1 }, 'RECOVERY_SEASON_EXCLUDED'],
        [{ lastActivityAt: '2026-07-18T11:50:00.000Z' }, 'RECOVERY_GAME_NOT_ELIGIBLE'],
    ]) {
        const pool = createStatefulRecoveryPool(options);
        await assert.rejects(
            refundReviewedAdminGame(pool, candidateFromState(pool.state), {
                recoveryOwnerId: 'admin-recovery:2:Admin',
            }),
            error => error instanceof AdminGameRecoveryConflictError && error.code === code,
        );
        assert.equal(pool.state.transactions.some(row => row.type === 'abandoned_refund'), false);
        assert.equal(pool.state.game.outcome, 'In Progress');
    }
}

function authPool() {
    const users = new Map([
        [1, { id: 1, username: 'Player', is_admin: false }],
        [2, { id: 2, username: 'Admin', is_admin: true }],
    ]);
    return {
        async query(text, params) {
            if (String(text).includes('SELECT id, username, is_admin')) {
                const user = users.get(Number(params[0]));
                return { rows: user ? [user] : [] };
            }
            throw new Error(`Unexpected admin recovery API query: ${text}`);
        },
    };
}

function listen(server) {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
}

function close(server) {
    return new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
}

async function testAdminApiAuthorizationLiveExclusionAndBroadcast() {
    const previewCalls = [];
    const applyCalls = [];
    const emitted = [];
    const previewResult = {
        previewHash: 'c'.repeat(64),
        candidateCount: 1,
        totalRefundCents: 100,
        candidates: [{ gameId: 42 }],
    };
    let applyResult = {
        outcome: 'complete',
        refundedGameCount: 1,
        refundedPlayerCount: 1,
        refundTotalCents: 100,
        results: [{ gameId: 42, status: 'abandoned_refunded', alreadyReconciled: false }],
        errors: [],
    };
    const jwt = {
        verify(token, _secret, callback) {
            if (token === 'player') return callback(null, { id: 1 });
            if (token === 'admin') return callback(null, { id: 2 });
            return callback(new Error('invalid'));
        },
    };
    const app = express();
    app.use(express.json());
    app.use('/api/admin', createAdminRoutes(authPool(), jwt, { emit: (...args) => emitted.push(args) }, {
        getLiveGameIds: () => [77],
        previewGameRecovery: async (_pool, options) => {
            previewCalls.push(options);
            return previewResult;
        },
        applyGameRecovery: async (_pool, options) => {
            applyCalls.push(options);
            if (options.gameIds?.some(value => typeof value === 'boolean')) {
                throw new TypeError('gameIds must contain positive integer game ids.');
            }
            return applyResult;
        },
    }));
    const server = http.createServer(app);
    const previousSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'admin-game-recovery-test';
    try {
        await listen(server);
        const base = `http://127.0.0.1:${server.address().port}/api/admin/game-recovery`;
        assert.equal((await fetch(`${base}/preview`)).status, 401);
        assert.equal((await fetch(`${base}/preview`, {
            headers: { Authorization: 'Bearer player' },
        })).status, 403);

        const previewResponse = await fetch(`${base}/preview`, {
            headers: { Authorization: 'Bearer admin' },
        });
        assert.equal(previewResponse.status, 200);
        assert.match(previewResponse.headers.get('cache-control'), /no-store/);
        assert.deepEqual(await previewResponse.json(), previewResult);
        assert.deepEqual(previewCalls, [{ excludeGameIds: [77] }]);

        assert.equal((await fetch(`${base}/refund`, {
            method: 'POST',
            headers: { Authorization: 'Bearer player', 'Content-Type': 'application/json' },
            body: JSON.stringify({ gameIds: [42], expectedPreviewHash: previewResult.previewHash }),
        })).status, 403);

        const malformedResponse = await fetch(`${base}/refund`, {
            method: 'POST',
            headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
            body: JSON.stringify({ gameIds: [true], expectedPreviewHash: previewResult.previewHash }),
        });
        assert.equal(malformedResponse.status, 400);
        assert.match(malformedResponse.headers.get('cache-control'), /no-store/);
        applyCalls.length = 0;

        const refundResponse = await fetch(`${base}/refund`, {
            method: 'POST',
            headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
            body: JSON.stringify({ gameIds: [42], expectedPreviewHash: previewResult.previewHash }),
        });
        assert.equal(refundResponse.status, 201);
        assert.match(refundResponse.headers.get('cache-control'), /no-store/);
        assert.deepEqual(await refundResponse.json(), applyResult);
        assert.deepEqual(applyCalls, [{
            gameIds: [42],
            expectedPreviewHash: previewResult.previewHash,
            excludeGameIds: [77],
            appliedBy: { id: 2, username: 'Admin', is_admin: true },
        }]);
        assert.deepEqual(emitted, [[
            'tokenBalancesReset',
            { reason: 'abandoned-game-refund', gameIds: [42] },
        ]]);

        applyResult = {
            outcome: 'partial',
            refundedGameCount: 1,
            refundedPlayerCount: 1,
            refundTotalCents: 100,
            results: [
                { gameId: 42, status: 'abandoned_refunded', alreadyReconciled: false },
                { gameId: 43, status: 'not_refunded' },
            ],
            errors: [],
        };
        assert.equal((await fetch(`${base}/refund`, {
            method: 'POST',
            headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
            body: JSON.stringify({ gameIds: [42, 43], expectedPreviewHash: previewResult.previewHash }),
        })).status, 207);

        applyResult = {
            outcome: 'unknown',
            refundedGameCount: 0,
            refundedPlayerCount: 0,
            refundTotalCents: 0,
            results: [],
            errors: [{ gameId: 42, code: '08006' }],
        };
        assert.equal((await fetch(`${base}/refund`, {
            method: 'POST',
            headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
            body: JSON.stringify({ gameIds: [42], expectedPreviewHash: previewResult.previewHash }),
        })).status, 503);
    } finally {
        await close(server);
        if (previousSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = previousSecret;
    }
}

async function runAdminGameRecoveryTests() {
    await testStrictPreviewPolicyAndPlayerDetail();
    await testApplyRevalidatesReviewedSelection();
    await testAtomicSourceLinkedRefundAndLockedManifest();
    await testLockedManifestRejectsMutationAndRollsBackFailures();
    await testLockedSeasonAndTenMinuteBoundary();
    await testAdminApiAuthorizationLiveExclusionAndBroadcast();
    console.log('Admin abandoned-game recovery tests passed.');
}

if (require.main === module) {
    runAdminGameRecoveryTests().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = runAdminGameRecoveryTests;
