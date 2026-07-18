'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const createAuthRoutes = require('../src/api/auth');
const {
    GAME_VOID_ATTESTATION_VERSION,
    GAME_VOID_STATUS,
    GAME_VOID_TRANSACTION_TYPE,
    GameVoidError,
    validateOutcomeIdentity,
    validateSourceLedger,
    voidGame,
} = require('../src/data/gameVoid');

function player(id, stats) {
    return { id, username: `Player${id}`, wins: 0, losses: 0, washes: 0, ...stats };
}

function transaction(transactionId, userId, type, amount, gameId = 44) {
    return {
        transactionId,
        userId,
        gameId,
        type,
        amount,
        reversesTransactionId: null,
        idempotencyKey: null,
        description: `${type} fixture`,
    };
}

function baseState(overrides = {}) {
    const users = new Map([
        [1, player(1, { wins: 1 })],
        [2, player(2, { washes: 1 })],
        [3, player(3, { losses: 1 })],
        [4, player(4, {})],
    ]);
    const seasonStats = new Map([...users.entries()].map(([id, user]) => [id, {
        userId: id,
        wins: user.wins,
        losses: user.losses,
        washes: user.washes,
    }]));
    return {
        game: {
            gameId: 44,
            theme: 'fort-creek',
            playerCount: 3,
            outcome: 'Game Over! Winner: Player1',
            endTime: '2026-07-17T10:30:00.000Z',
            reconciliationStatus: null,
            reconciledAt: null,
            reconciledBy: null,
            seasonId: 2,
            seasonStatus: 'active',
            ...overrides.game,
        },
        users,
        seasonStats,
        transactions: [
            transaction(1, 1, 'admin_adjustment', 10, null),
            transaction(2, 2, 'admin_adjustment', 10, null),
            transaction(3, 3, 'admin_adjustment', 10, null),
            transaction(10, 1, 'buy_in', -1),
            transaction(11, 2, 'buy_in', -1),
            transaction(12, 3, 'buy_in', -1),
            transaction(20, 1, 'win_payout', 2),
            transaction(21, 2, 'wash_payout', 1),
            ...(overrides.transactions || []),
        ],
        voidRecord: null,
        manifestRows: [],
        nextTransactionId: 100,
        failOnReversalInsert: overrides.failOnReversalInsert || null,
        changeLedgerBeforeLock: overrides.changeLedgerBeforeLock === true,
    };
}

function cloneState(state) {
    return structuredClone(state);
}

function restoreState(target, snapshot) {
    for (const key of Object.keys(target)) delete target[key];
    Object.assign(target, snapshot);
}

function createVoidPool(state = baseState()) {
    const calls = [];
    let releaseCount = 0;
    let reversalInsertCount = 0;
    let ledgerChangeInjected = false;

    const pool = {
        state,
        calls,
        get releaseCount() { return releaseCount; },
        async query(text, params) {
            calls.push({ sql: String(text).replace(/\s+/g, ' ').trim(), params, scope: 'pool' });
            if (/SELECT\s+id,\s*username,\s*is_admin\s+FROM\s+users/i.test(String(text))) {
                const user = state.users.get(Number(params[0]));
                return { rows: user ? [{ id: user.id, username: user.username, is_admin: false }] : [] };
            }
            throw new Error(`Unexpected pool query: ${text}`);
        },
        async connect() {
            let snapshot = null;
            return {
                async query(text, params = []) {
                    const sql = String(text).replace(/\s+/g, ' ').trim();
                    calls.push({ sql, params, scope: 'client' });
                    if (sql === 'BEGIN') {
                        snapshot = cloneState(state);
                        return { rows: [] };
                    }
                    if (sql === 'COMMIT') {
                        snapshot = null;
                        return { rows: [] };
                    }
                    if (sql === 'ROLLBACK') {
                        if (snapshot) restoreState(state, snapshot);
                        snapshot = null;
                        return { rows: [] };
                    }
                    if (sql.startsWith('SELECT pg_advisory_xact_lock_shared')) return { rows: [{}] };

                    if (sql.includes('FROM game_history game') && sql.includes('FOR UPDATE OF game')) {
                        if (Number(params[0]) !== state.game.gameId) return { rows: [] };
                        return { rows: [{
                            game_id: state.game.gameId,
                            theme: state.game.theme,
                            player_count: state.game.playerCount,
                            outcome: state.game.outcome,
                            end_time: state.game.endTime,
                            reconciliation_status: state.game.reconciliationStatus,
                            season_id: state.game.seasonId,
                            season_status: state.game.seasonStatus,
                            requested_by_user_id: state.voidRecord?.requestedByUserId ?? null,
                            voided_at: state.voidRecord?.voidedAt ?? null,
                            affected_player_count: state.voidRecord?.affectedPlayerCount ?? null,
                            source_transaction_count: state.voidRecord?.sourceTransactionCount ?? null,
                            reversal_transaction_count: state.voidRecord?.reversalTransactionCount ?? null,
                        }] };
                    }

                    if (sql.includes('FROM transactions') && sql.includes('WHERE game_id = $1')
                        && sql.includes('ORDER BY transaction_id DESC')) {
                        if (sql.includes('FOR UPDATE')
                            && state.changeLedgerBeforeLock && !ledgerChangeInjected) {
                            ledgerChangeInjected = true;
                            const replaced = state.transactions.find(row => row.transactionId === 21);
                            replaced.transactionId = 22;
                        }
                        return { rows: state.transactions
                            .filter(row => row.gameId === Number(params[0]))
                            .sort((left, right) => right.transactionId - left.transactionId)
                            .map(row => ({
                                transaction_id: row.transactionId,
                                user_id: row.userId,
                                transaction_type: row.type,
                                amount: row.amount,
                                reverses_transaction_id: row.reversesTransactionId,
                                idempotency_key: row.idempotencyKey,
                            })) };
                    }

                    if (sql.startsWith('SELECT id, username FROM users') && sql.includes('FOR UPDATE')) {
                        const ids = params[0];
                        return { rows: ids.filter(id => state.users.has(id)).map(id => ({
                            id,
                            username: state.users.get(id).username,
                        })) };
                    }
                    if (sql.startsWith('SELECT user_id, wins, losses, washes FROM season_player_stats')) {
                        const ids = params[1];
                        return { rows: ids.filter(id => state.seasonStats.has(id)).map(id => ({
                            ...state.seasonStats.get(id),
                            user_id: id,
                        })) };
                    }
                    if (sql.startsWith('SELECT game_id, voided_at, affected_player_count,')
                        && sql.includes('FROM game_voids')) {
                        return { rows: state.voidRecord ? [{
                            game_id: state.voidRecord.gameId,
                            voided_at: state.voidRecord.voidedAt,
                            affected_player_count: state.voidRecord.affectedPlayerCount,
                            source_transaction_count: state.voidRecord.sourceTransactionCount,
                            reversal_transaction_count: state.voidRecord.reversalTransactionCount,
                        }] : [] };
                    }
                    if (sql.startsWith('SELECT source_transaction_id_snapshot,')
                        && sql.includes('FROM game_void_ledger_manifest')) {
                        return { rows: [...state.manifestRows]
                            .sort((left, right) => (
                                right.source_transaction_id_snapshot
                                - left.source_transaction_id_snapshot
                            )) };
                    }

                    if (sql.startsWith('INSERT INTO transactions') && sql.includes('reverses_transaction_id')) {
                        reversalInsertCount += 1;
                        if (state.failOnReversalInsert === reversalInsertCount) {
                            throw new Error('injected reversal insert failure');
                        }
                        const id = state.nextTransactionId++;
                        state.transactions.push({
                            transactionId: id,
                            userId: Number(params[0]),
                            gameId: Number(params[1]),
                            type: params[2],
                            amount: Number(params[3]),
                            description: params[4],
                            idempotencyKey: params[5],
                            reversesTransactionId: Number(params[6]),
                        });
                        return { rows: [{ transaction_id: id }], rowCount: 1 };
                    }

                    const lifetimeMatch = sql.match(/^UPDATE users SET (wins|losses|washes) = \1 - 1/);
                    if (lifetimeMatch) {
                        const user = state.users.get(Number(params[0]));
                        const column = lifetimeMatch[1];
                        if (!user || user[column] <= 0) return { rows: [], rowCount: 0 };
                        user[column] -= 1;
                        return { rows: [], rowCount: 1 };
                    }
                    const seasonMatch = sql.match(/^UPDATE season_player_stats SET (wins|losses|washes) = \1 - 1/);
                    if (seasonMatch) {
                        const stat = state.seasonStats.get(Number(params[1]));
                        const column = seasonMatch[1];
                        if (!stat || stat[column] <= 0) return { rows: [], rowCount: 0 };
                        stat[column] -= 1;
                        return { rows: [], rowCount: 1 };
                    }

                    if (sql.startsWith('INSERT INTO game_voids')) {
                        if (state.voidRecord) {
                            const error = new Error('duplicate game void');
                            error.code = '23505';
                            throw error;
                        }
                        state.voidRecord = {
                            gameId: Number(params[0]),
                            requestedByUserId: Number(params[1]),
                            requestedByUsername: params[2],
                            attestationVersion: params[3],
                            originalOutcome: params[4],
                            affectedPlayerCount: Number(params[5]),
                            sourceTransactionCount: Number(params[6]),
                            reversalTransactionCount: Number(params[7]),
                            voidedAt: '2026-07-17T11:00:00.000Z',
                        };
                        return { rows: [{
                            game_id: state.voidRecord.gameId,
                            voided_at: state.voidRecord.voidedAt,
                            affected_player_count: state.voidRecord.affectedPlayerCount,
                            source_transaction_count: state.voidRecord.sourceTransactionCount,
                            reversal_transaction_count: state.voidRecord.reversalTransactionCount,
                        }], rowCount: 1 };
                    }
                    if (sql.startsWith('INSERT INTO game_void_ledger_manifest')) {
                        state.manifestRows.push({
                            game_id: Number(params[0]),
                            source_transaction_id_snapshot: Number(params[1]),
                            source_user_id_snapshot: Number(params[2]),
                            source_username_snapshot: params[3],
                            source_transaction_type: params[4],
                            source_amount: params[5],
                            reversal_transaction_id_snapshot: Number(params[6]),
                            reversal_amount: params[7],
                            reversal_idempotency_key: params[8],
                        });
                        return { rows: [], rowCount: 1 };
                    }
                    if (sql.startsWith('UPDATE game_history SET reconciliation_status')) {
                        if (state.game.reconciliationStatus !== null) return { rows: [], rowCount: 0 };
                        state.game.reconciliationStatus = params[0];
                        state.game.reconciledAt = params[1];
                        state.game.reconciledBy = params[2];
                        return { rows: [], rowCount: 1 };
                    }
                    if (sql.includes('current_balance_cents')) {
                        const userId = Number(params[0]);
                        const amount = state.transactions
                            .filter(row => row.userId === userId)
                            .reduce((sum, row) => sum + Number(row.amount), 0);
                        return { rows: [{ current_balance_cents: String(Math.round(amount * 100)) }] };
                    }
                    throw new Error(`Unexpected client query: ${sql}`);
                },
                release() { releaseCount += 1; },
            };
        },
    };
    return pool;
}

async function testAtomicNormalVoidAndIdempotentRetry() {
    const pool = createVoidPool();
    const result = await voidGame(pool, {
        gameId: 44,
        requester: { id: 3, username: 'Player3' },
        attestation: 'scouts_honor',
    });
    assert.deepEqual(result, {
        gameId: 44,
        status: GAME_VOID_STATUS,
        alreadyVoided: false,
        voidedAt: '2026-07-17T11:00:00.000Z',
        affectedPlayerCount: 3,
        reversalTransactionCount: 5,
        currentBalanceCents: 1000,
        affectedUserIds: [1, 2, 3],
    });
    assert.equal(pool.state.game.outcome, 'Game Over! Winner: Player1', 'original outcome remains intact');
    assert.equal(pool.state.game.reconciliationStatus, GAME_VOID_STATUS);
    assert.match(pool.state.game.reconciledBy, /^player:3:Player3$/);
    assert.deepEqual(pool.state.voidRecord, {
        gameId: 44,
        requestedByUserId: 3,
        requestedByUsername: 'Player3',
        attestationVersion: GAME_VOID_ATTESTATION_VERSION,
        originalOutcome: 'Game Over! Winner: Player1',
        affectedPlayerCount: 3,
        sourceTransactionCount: 5,
        reversalTransactionCount: 5,
        voidedAt: '2026-07-17T11:00:00.000Z',
    });
    assert.equal(pool.state.manifestRows.length, 5);
    assert.deepEqual(
        pool.state.manifestRows.map(row => row.source_transaction_id_snapshot),
        [21, 20, 12, 11, 10],
    );

    const reversals = pool.state.transactions.filter(row => row.type === GAME_VOID_TRANSACTION_TYPE);
    assert.deepEqual(reversals.map(row => row.reversesTransactionId), [21, 20, 12, 11, 10]);
    assert.deepEqual(reversals.map(row => row.amount), [-1, -2, 1, 1, 1]);
    assert.deepEqual(
        reversals.map(row => row.idempotencyKey),
        [21, 20, 12, 11, 10].map(id => `game-void:44:${id}`),
    );
    assert.deepEqual(
        [...pool.state.users.values()].slice(0, 3).map(user => [user.wins, user.losses, user.washes]),
        [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
    );
    assert.deepEqual(
        [...pool.state.seasonStats.values()].slice(0, 3).map(stat => [stat.wins, stat.losses, stat.washes]),
        [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
    );
    assert.ok(pool.calls.some(call => call.sql.startsWith('SELECT pg_advisory_xact_lock_shared')));
    assert.ok(pool.calls.some(call => call.sql.includes('ORDER BY transaction_id DESC') && call.sql.includes('FOR UPDATE')));
    const initialLedgerReadIndex = pool.calls.findIndex(call => (
        call.sql.includes('ORDER BY transaction_id DESC') && !call.sql.includes('FOR UPDATE')
    ));
    const userLockIndex = pool.calls.findIndex(call => (
        call.sql.startsWith('SELECT id, username FROM users') && call.sql.includes('FOR UPDATE')
    ));
    const transactionLockIndex = pool.calls.findIndex(call => (
        call.sql.includes('ORDER BY transaction_id DESC') && call.sql.includes('FOR UPDATE')
    ));
    assert.ok(initialLedgerReadIndex >= 0 && initialLedgerReadIndex < userLockIndex);
    assert.ok(userLockIndex >= 0 && userLockIndex < transactionLockIndex);

    const transactionCount = pool.state.transactions.length;
    const retry = await voidGame(pool, {
        gameId: 44,
        requester: { id: 2, username: 'Player2' },
        attestation: 'scouts_honor',
    });
    assert.equal(retry.alreadyVoided, true);
    assert.equal(retry.reversalTransactionCount, 5);
    assert.equal(pool.state.transactions.length, transactionCount, 'retry creates no new reversal');
    assert.equal(pool.releaseCount, 2);
}

async function testAuthorizationAndEligibilityFailures() {
    const unauthorizedPool = createVoidPool();
    await assert.rejects(
        voidGame(unauthorizedPool, {
            gameId: 44,
            requester: { id: 4, username: 'Player4' },
            attestation: 'scouts_honor',
        }),
        error => error instanceof GameVoidError
            && error.code === 'FUNDED_PARTICIPANT_REQUIRED'
            && error.statusCode === 403,
    );
    assert.equal(unauthorizedPool.state.voidRecord, null);

    for (const [game, code] of [
        [{ seasonStatus: 'finalized' }, 'GAME_SEASON_FINALIZED'],
        [{ outcome: 'In Progress', endTime: null }, 'GAME_NOT_SETTLED'],
        [{ reconciliationStatus: 'abandoned_refunded' }, 'GAME_NOT_VOIDABLE'],
    ]) {
        const pool = createVoidPool(baseState({ game }));
        await assert.rejects(
            voidGame(pool, {
                gameId: 44,
                requester: { id: 1, username: 'Player1' },
                attestation: 'scouts_honor',
            }),
            error => error instanceof GameVoidError && error.code === code,
        );
        assert.equal(pool.state.transactions.filter(row => row.type === GAME_VOID_TRANSACTION_TYPE).length, 0);
    }
}

function testStatDerivationAndAmbiguousLedgers() {
    const historicalPrice = validateSourceLedger([
        { transaction_id: 1, user_id: 1, transaction_type: 'buy_in', amount: -2.5 },
        { transaction_id: 2, user_id: 2, transaction_type: 'buy_in', amount: -2.5 },
        { transaction_id: 3, user_id: 1, transaction_type: 'win_payout', amount: 5 },
    ], {
        // No current theme/config lookup is allowed to rewrite history.
        theme: 'retired-table-theme',
        playerCount: 2,
        outcome: 'Game Over! Winner: Player1',
    });
    assert.equal(historicalPrice.buyInCents, 250);

    const draw = validateSourceLedger([
        { transaction_id: 1, user_id: 1, transaction_type: 'buy_in', amount: -1 },
        { transaction_id: 2, user_id: 2, transaction_type: 'buy_in', amount: -1 },
        { transaction_id: 3, user_id: 3, transaction_type: 'buy_in', amount: -1 },
        { transaction_id: 4, user_id: 1, transaction_type: 'win_payout', amount: 1.5 },
        { transaction_id: 5, user_id: 2, transaction_type: 'win_payout', amount: 1.5 },
    ], {
        theme: 'fort-creek',
        playerCount: 3,
        outcome: 'Game Over! Draw (split)',
    });
    assert.deepEqual(draw.participantResults.map(result => result.statColumn), ['washes', 'washes', 'washes']);

    const forfeit = validateSourceLedger([
        { transaction_id: 1, user_id: 1, transaction_type: 'buy_in', amount: -1 },
        { transaction_id: 2, user_id: 2, transaction_type: 'buy_in', amount: -1 },
        { transaction_id: 3, user_id: 1, transaction_type: 'forfeit_payout', amount: 2 },
    ], {
        theme: 'fort-creek',
        playerCount: 2,
        outcome: 'Game Over! Player2 forfeited (left)',
    });
    assert.deepEqual(forfeit.participantResults, [
        { userId: 1, statColumn: 'wins' },
        { userId: 2, statColumn: 'losses' },
    ]);

    assert.throws(() => validateSourceLedger([
        { transaction_id: 1, user_id: 1, transaction_type: 'buy_in', amount: -1 },
        { transaction_id: 2, user_id: 1, transaction_type: 'buy_in', amount: -1 },
    ], {
        theme: 'fort-creek', playerCount: 3, outcome: 'Game Over! Winner: Player1',
    }), error => error.code === 'GAME_LEDGER_AMBIGUOUS');
    assert.throws(() => validateSourceLedger([
        { transaction_id: 1, user_id: 1, transaction_type: 'buy_in', amount: -1 },
        { transaction_id: 2, user_id: 1, transaction_type: 'forfeit_loss', amount: -1 },
    ], {
        theme: 'fort-creek', playerCount: 3, outcome: 'Game Over! Player1 forfeited (left)',
    }), error => error.code === 'GAME_LEDGER_AMBIGUOUS');
    assert.throws(() => validateSourceLedger([
        { transaction_id: 1, user_id: 1, transaction_type: 'buy_in', amount: -1 },
        { transaction_id: 2, user_id: 2, transaction_type: 'buy_in', amount: -2 },
    ], {
        playerCount: 2, outcome: 'Game Over! Winner: Player1',
    }), error => error.code === 'GAME_LEDGER_AMBIGUOUS');
    assert.throws(() => validateSourceLedger([
        { transaction_id: 1, user_id: 1, transaction_type: 'buy_in', amount: -1 },
        { transaction_id: 2, user_id: 2, transaction_type: 'buy_in', amount: -1 },
        { transaction_id: 3, user_id: 3, transaction_type: 'buy_in', amount: -1 },
        // A missing winner/runner-up payout must not produce a partial void.
        { transaction_id: 4, user_id: 1, transaction_type: 'win_payout', amount: 2 },
    ], {
        playerCount: 3, outcome: 'Game Over! Winner: Player1',
    }), error => error.code === 'GAME_LEDGER_AMBIGUOUS');
    assert.throws(() => validateSourceLedger([
        { transaction_id: 1, user_id: 1, transaction_type: 'buy_in', amount: -1 },
        { transaction_id: 2, user_id: 2, transaction_type: 'buy_in', amount: -1 },
        // A forfeiting game must return the whole pot when a recipient exists.
        { transaction_id: 3, user_id: 1, transaction_type: 'forfeit_payout', amount: 1 },
    ], {
        playerCount: 2, outcome: 'Game Over! Player2 forfeited (left)',
    }), error => error.code === 'GAME_LEDGER_AMBIGUOUS');
    assert.throws(() => validateSourceLedger([
        { transaction_id: 1, user_id: 1, transaction_type: 'buy_in', amount: -1 },
        { transaction_id: 2, user_id: 2, transaction_type: 'buy_in', amount: -1 },
    ], {
        playerCount: 2, outcome: 'Game Over! Player2 forfeited (left)',
    }), error => error.code === 'GAME_LEDGER_AMBIGUOUS');

    const loneForfeiter = validateSourceLedger([
        { transaction_id: 1, user_id: 1, transaction_type: 'buy_in', amount: -1 },
    ], {
        playerCount: 3, outcome: 'Game Over! Player1 forfeited (left)',
    });
    assert.deepEqual(loneForfeiter.participantResults, [{ userId: 1, statColumn: 'losses' }]);

    const wrongWinnerLedger = validateSourceLedger([
        { transaction_id: 1, user_id: 1, transaction_type: 'buy_in', amount: -1 },
        { transaction_id: 2, user_id: 2, transaction_type: 'buy_in', amount: -1 },
        { transaction_id: 3, user_id: 3, transaction_type: 'buy_in', amount: -1 },
        { transaction_id: 4, user_id: 3, transaction_type: 'win_payout', amount: 3 },
    ], {
        playerCount: 3, outcome: 'Game Over! Winner: Player1',
    });
    assert.throws(() => validateOutcomeIdentity(
        wrongWinnerLedger,
        'Game Over! Winner: Player1',
        [
            { id: 1, username: 'Player1' },
            { id: 2, username: 'Player2' },
            { id: 3, username: 'Player3' },
        ],
    ), error => error.code === 'GAME_LEDGER_AMBIGUOUS');
    validateOutcomeIdentity(
        wrongWinnerLedger,
        'Game Over! Winner: Player3',
        [
            { id: 1, username: 'Player1' },
            { id: 2, username: 'Player2' },
            { id: 3, username: 'Player3' },
        ],
    );
    validateOutcomeIdentity(
        historicalPrice,
        'Game Over! Winner: Rock & Roll',
        [
            { id: 1, username: 'Rock & Roll' },
            { id: 2, username: 'Other Player' },
        ],
    );
    validateOutcomeIdentity(
        historicalPrice,
        'Game Over! Winner: Bob forfeited yesterday',
        [
            { id: 1, username: 'Bob forfeited yesterday' },
            { id: 2, username: 'Other Player' },
        ],
    );
}

async function testFailedWriteRollsBackEverything() {
    const state = baseState({ failOnReversalInsert: 2 });
    const pool = createVoidPool(state);
    await assert.rejects(
        voidGame(pool, {
            gameId: 44,
            requester: { id: 1, username: 'Player1' },
            attestation: 'scouts_honor',
        }),
        /injected reversal insert failure/,
    );
    assert.equal(pool.state.transactions.filter(row => row.type === GAME_VOID_TRANSACTION_TYPE).length, 0);
    assert.equal(pool.state.voidRecord, null);
    assert.equal(pool.state.game.reconciliationStatus, null);
    assert.equal(pool.state.users.get(1).wins, 1);
    assert.ok(pool.calls.some(call => call.sql === 'ROLLBACK'));
}

async function testLedgerMustMatchAfterUserLocks() {
    const pool = createVoidPool(baseState({ changeLedgerBeforeLock: true }));
    await assert.rejects(
        voidGame(pool, {
            gameId: 44,
            requester: { id: 1, username: 'Player1' },
            attestation: 'scouts_honor',
        }),
        error => error instanceof GameVoidError && error.code === 'GAME_VOID_LEDGER_CHANGED',
    );
    assert.equal(pool.state.transactions.filter(row => row.type === GAME_VOID_TRANSACTION_TYPE).length, 0);
    assert.equal(pool.state.voidRecord, null);
    assert.equal(pool.state.game.reconciliationStatus, null);
}

async function testPrunedParticipantKeepsVoidRetryAuditable() {
    const pool = createVoidPool();
    await voidGame(pool, {
        gameId: 44,
        requester: { id: 1, username: 'Player1' },
        attestation: 'scouts_honor',
    });

    // Inactive-user pruning intentionally deletes Player2 and their live
    // ledger. The independent immutable manifest must retain the complete
    // three-player proof and let a surviving participant retry safely.
    pool.state.transactions = pool.state.transactions.filter(row => row.userId !== 2);
    pool.state.users.delete(2);
    pool.state.seasonStats.delete(2);
    assert.equal(pool.state.manifestRows.some(row => row.source_user_id_snapshot === 2), true);

    const retry = await voidGame(pool, {
        gameId: 44,
        requester: { id: 3, username: 'Player3' },
        attestation: 'scouts_honor',
    });
    assert.equal(retry.alreadyVoided, true);
    assert.deepEqual(retry.affectedUserIds, [1, 2, 3]);
    assert.equal(retry.reversalTransactionCount, 5);
}

async function listen(server) {
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
}

async function close(server) {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

async function testAuthenticatedEndpointAndAttestation() {
    const pool = createVoidPool();
    const makeSocket = (id, userId, { connected = true, isBot = false } = {}) => ({
        id,
        connected,
        user: { id: userId, is_bot: isBot },
        events: [],
        emit(eventName) { this.events.push(eventName); },
    });
    const participantOne = makeSocket('participant-one', 1);
    const participantTwo = makeSocket('participant-two', 2);
    const requesterSocket = makeSocket('requester', 3);
    const requesterSecondTab = makeSocket('requester-tab-two', 3);
    const outsider = makeSocket('outsider', 4);
    const disconnectedParticipant = makeSocket('disconnected', 2, { connected: false });
    const botShapedSocket = makeSocket('bot-shaped', 1, { isBot: true });
    const io = {
        sockets: {
            sockets: new Map([
                [participantOne.id, participantOne],
                [participantTwo.id, participantTwo],
                [requesterSocket.id, requesterSocket],
                [requesterSecondTab.id, requesterSecondTab],
                [outsider.id, outsider],
                [disconnectedParticipant.id, disconnectedParticipant],
                [botShapedSocket.id, botShapedSocket],
            ]),
        },
        emit() {},
    };
    const jwt = {
        verify(token, _secret, callback) {
            if (token === 'valid') return callback(null, { id: 3 });
            return callback(new Error('invalid'));
        },
    };
    const app = express();
    app.use(express.json());
    app.use('/api/auth', createAuthRoutes(pool, {}, jwt, io));
    const server = http.createServer(app);
    const oldSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'game-void-test-secret';
    try {
        await listen(server);
        const url = `http://127.0.0.1:${server.address().port}/api/auth/token-ledger/games/44/void`;
        let response = await fetch(url, { method: 'POST' });
        assert.equal(response.status, 401);

        response = await fetch(url, {
            method: 'POST',
            headers: { Authorization: 'Bearer valid', 'Content-Type': 'application/json' },
            body: JSON.stringify({ attestation: 'almost' }),
        });
        assert.equal(response.status, 400);
        assert.equal((await response.json()).code, 'ATTESTATION_REQUIRED');

        response = await fetch(url, {
            method: 'POST',
            headers: { Authorization: 'Bearer valid', 'Content-Type': 'application/json' },
            body: JSON.stringify({ attestation: 'scouts_honor' }),
        });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'private, no-store');
        const body = await response.json();
        assert.equal(body.status, GAME_VOID_STATUS);
        assert.equal(body.alreadyVoided, false);
        assert.equal(Object.prototype.hasOwnProperty.call(body, 'affectedUserIds'), false);
        assert.deepEqual(participantOne.events, ['tokenBalanceChanged']);
        assert.deepEqual(participantTwo.events, ['tokenBalanceChanged']);
        assert.deepEqual(requesterSocket.events, ['tokenBalanceChanged']);
        assert.deepEqual(requesterSecondTab.events, ['tokenBalanceChanged']);
        assert.deepEqual(outsider.events, []);
        assert.deepEqual(disconnectedParticipant.events, []);
        assert.deepEqual(botShapedSocket.events, []);

        response = await fetch(url, {
            method: 'POST',
            headers: { Authorization: 'Bearer valid', 'Content-Type': 'application/json' },
            body: JSON.stringify({ attestation: 'scouts_honor' }),
        });
        assert.equal(response.status, 200);
        const retryBody = await response.json();
        assert.equal(retryBody.alreadyVoided, true);
        assert.equal(Object.prototype.hasOwnProperty.call(retryBody, 'affectedUserIds'), false);
        assert.deepEqual(participantOne.events, ['tokenBalanceChanged', 'tokenBalanceChanged']);
        assert.deepEqual(participantTwo.events, ['tokenBalanceChanged', 'tokenBalanceChanged']);
        assert.deepEqual(requesterSocket.events, ['tokenBalanceChanged', 'tokenBalanceChanged']);
        assert.deepEqual(requesterSecondTab.events, ['tokenBalanceChanged', 'tokenBalanceChanged']);
        assert.deepEqual(outsider.events, []);
    } finally {
        await close(server);
        if (oldSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = oldSecret;
    }
}

async function runGameVoidTests() {
    testStatDerivationAndAmbiguousLedgers();
    await testAtomicNormalVoidAndIdempotentRetry();
    await testAuthorizationAndEligibilityFailures();
    await testFailedWriteRollsBackEverything();
    await testLedgerMustMatchAfterUserLocks();
    await testPrunedParticipantKeepsVoidRetryAuditable();
    await testAuthenticatedEndpointAndAttestation();
    console.log('Game-void accounting, authorization, rollback, and API tests passed.');
}

if (require.main === module) {
    runGameVoidTests().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = runGameVoidTests;
