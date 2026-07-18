'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const createAuthRoutes = require('../src/api/auth');
const createDbTables = require('../src/data/createTables');
const {
    LEDGER_PAGE_QUERY,
    parseLedgerPageOptions,
} = require('../src/data/tokenLedger');

async function listen(server) {
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
}

async function close(server) {
    await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
    });
}

function createLedgerPool() {
    const state = {
        authQueries: [],
        clientQueries: [],
        connectCount: 0,
        releaseCount: 0,
        mode: 'page',
        pageParams: null,
    };

    const pageRows = [
        {
            transaction_id: 98,
            transaction_time: '2026-07-11T12:30:00.000Z',
            transaction_type: 'win_payout',
            category: 'game',
            amount_cents: '200',
            balance_after_cents: '1250',
            description: 'Final 1st payout for game #44',
            game_id: 44,
            game_net_cents: '100',
            game_theme: 'fort-creek',
            game_outcome: 'Game Over! Winner: Safe Player',
            game_started_at: '2026-07-11T12:00:00.000Z',
            game_ended_at: '2026-07-11T12:30:00.000Z',
            game_can_void: true,
            game_void_status: null,
            game_voided_at: null,
        },
        {
            transaction_id: 91,
            transaction_time: '2026-07-11T12:00:00.000Z',
            transaction_type: 'buy_in',
            category: 'game',
            amount_cents: '-100',
            balance_after_cents: '1050',
            description: 'Table buy-in for game #44',
            game_id: 44,
            game_net_cents: '100',
            game_theme: 'fort-creek',
            game_outcome: 'Game Over! Winner: Safe Player',
            game_started_at: '2026-07-11T12:00:00.000Z',
            game_ended_at: '2026-07-11T12:30:00.000Z',
        },
        {
            transaction_id: 80,
            transaction_time: '2026-07-10T20:00:00.000Z',
            transaction_type: 'wash_payout',
            category: 'game',
            amount_cents: '100',
            balance_after_cents: '1150',
            description: 'Older page sentinel',
            game_id: 40,
            game_net_cents: '0',
            game_theme: 'fort-creek',
            game_outcome: 'Game Over! Winner: Other Player',
            game_started_at: '2026-07-10T19:30:00.000Z',
            game_ended_at: '2026-07-10T20:00:00.000Z',
        },
    ];

    const pool = {
        state,
        async query(text, params) {
            state.authQueries.push({ text: String(text), params });
            if (/FROM\s+users\s+WHERE\s+id\s*=\s*\$1/i.test(text)) {
                return { rows: [{ id: 42, username: 'safe-player', is_admin: false }] };
            }
            throw new Error(`Unexpected pool query: ${text}`);
        },
        async connect() {
            state.connectCount += 1;
            return {
                async query(text, params) {
                    const sql = String(text);
                    state.clientQueries.push({ text: sql, params });
                    if (sql === 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY') return { rows: [] };
                    if (sql.includes('current_balance_cents')) {
                        return { rows: [{ current_balance_cents: '1250' }] };
                    }
                    if (sql.includes('WITH full_ledger AS')) {
                        state.pageParams = params;
                        if (state.mode === 'failure') throw new Error('injected ledger read failure');
                        return { rows: state.mode === 'empty' ? [] : pageRows };
                    }
                    if (sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
                    throw new Error(`Unexpected client query: ${sql}`);
                },
                release() { state.releaseCount += 1; },
            };
        },
    };
    return pool;
}

async function testAuthenticatedLedgerEndpoint() {
    const pool = createLedgerPool();
    const jwt = {
        verify(token, _secret, callback) {
            if (token === 'valid-token') return callback(null, { id: 42, username: 'stale-name' });
            return callback(new Error('invalid token'));
        },
    };
    const app = express();
    app.use('/api/auth', createAuthRoutes(
        pool,
        { hash() {}, compare() {} },
        jwt,
        { emit() {} },
    ));
    const server = http.createServer(app);
    const previousSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'token-ledger-test-secret';

    try {
        await listen(server);
        const { port } = server.address();
        const endpoint = `http://127.0.0.1:${port}/api/auth/token-ledger`;

        let response = await fetch(endpoint);
        assert.equal(response.status, 401);
        assert.equal(pool.state.authQueries.length, 0);
        assert.equal(pool.state.connectCount, 0);

        response = await fetch(endpoint, { headers: { Authorization: 'Bearer invalid-token' } });
        assert.equal(response.status, 403);
        assert.equal(pool.state.authQueries.length, 0);
        assert.equal(pool.state.connectCount, 0);

        response = await fetch(
            `${endpoint}?limit=2&cursor=99&category=game&userId=999`,
            { headers: { Authorization: 'Bearer valid-token' } },
        );
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'private, no-store');
        assert.deepEqual(await response.json(), {
            currentBalanceCents: 1250,
            entries: [
                {
                    id: 98,
                    occurredAt: '2026-07-11T12:30:00.000Z',
                    type: 'win_payout',
                    category: 'game',
                    amountCents: 200,
                    balanceAfterCents: 1250,
                    description: 'Final 1st payout for game #44',
                    gameId: 44,
                    gameNetCents: 100,
                    gameTheme: 'fort-creek',
                    gameOutcome: 'Game Over! Winner: Safe Player',
                    gameStartedAt: '2026-07-11T12:00:00.000Z',
                    gameEndedAt: '2026-07-11T12:30:00.000Z',
                    gameCanVoid: true,
                    gameVoidStatus: null,
                    gameVoidedAt: null,
                },
                {
                    id: 91,
                    occurredAt: '2026-07-11T12:00:00.000Z',
                    type: 'buy_in',
                    category: 'game',
                    amountCents: -100,
                    balanceAfterCents: 1050,
                    description: 'Table buy-in for game #44',
                    gameId: 44,
                    gameNetCents: 100,
                    gameTheme: 'fort-creek',
                    gameOutcome: 'Game Over! Winner: Safe Player',
                    gameStartedAt: '2026-07-11T12:00:00.000Z',
                    gameEndedAt: '2026-07-11T12:30:00.000Z',
                    gameCanVoid: false,
                    gameVoidStatus: null,
                    gameVoidedAt: null,
                },
            ],
            nextCursor: 91,
            hasMore: true,
        });
        assert.deepEqual(pool.state.pageParams, [42, 99, 'game', 3]);
        assert.equal(pool.state.connectCount, 1);
        assert.equal(pool.state.releaseCount, 1);
        assert.ok(pool.state.clientQueries.some(({ text }) => text === 'COMMIT'));

        const connectsBeforeInvalidRequest = pool.state.connectCount;
        response = await fetch(`${endpoint}?category=private`, {
            headers: { Authorization: 'Bearer valid-token' },
        });
        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), {
            message: 'category must be game, mercy, adjustment, or refund.',
        });
        assert.equal(pool.state.connectCount, connectsBeforeInvalidRequest);

        pool.state.mode = 'empty';
        response = await fetch(`${endpoint}?cursor=1`, {
            headers: { Authorization: 'Bearer valid-token' },
        });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
            currentBalanceCents: 1250,
            entries: [],
            nextCursor: null,
            hasMore: false,
        });

        pool.state.mode = 'failure';
        const expectedErrors = [];
        const originalConsoleError = console.error;
        try {
            console.error = (...parts) => expectedErrors.push(parts);
            response = await fetch(endpoint, {
                headers: { Authorization: 'Bearer valid-token' },
            });
        } finally {
            console.error = originalConsoleError;
        }
        assert.equal(response.status, 500);
        assert.deepEqual(await response.json(), { message: 'Unable to load token history.' });
        assert.equal(expectedErrors.length, 1);
        assert.equal(expectedErrors[0][0], 'Token-ledger load error:');
        assert.ok(pool.state.clientQueries.some(({ text }) => text === 'ROLLBACK'));
        assert.equal(pool.state.connectCount, pool.state.releaseCount);
    } finally {
        await close(server);
        if (previousSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = previousSecret;
    }
}

function testQueryValidationAndWindowOrder() {
    assert.deepEqual(parseLedgerPageOptions({}), { category: null, cursor: null, limit: 50 });
    assert.deepEqual(
        parseLedgerPageOptions({ limit: '100', cursor: '91', category: 'refund' }),
        { category: 'refund', cursor: 91, limit: 100 },
    );
    assert.deepEqual(
        parseLedgerPageOptions({ category: 'all' }),
        { category: null, cursor: null, limit: 50 },
    );
    assert.throws(() => parseLedgerPageOptions({ limit: '101' }), /1 through 100/);
    assert.throws(() => parseLedgerPageOptions({ cursor: '1.5' }), /positive transaction id/);
    assert.throws(() => parseLedgerPageOptions({ limit: ['5', '6'] }), /supplied once/);

    const runningBalanceIndex = LEDGER_PAGE_QUERY.indexOf('SUM(t.amount) OVER');
    const fullLedgerConsumerIndex = LEDGER_PAGE_QUERY.indexOf('FROM full_ledger ledger');
    const cursorFilterIndex = LEDGER_PAGE_QUERY.indexOf('ledger.transaction_id < $2');
    const categoryFilterIndex = LEDGER_PAGE_QUERY.indexOf('ledger.category = $3');
    assert.ok(runningBalanceIndex >= 0);
    assert.ok(fullLedgerConsumerIndex > runningBalanceIndex);
    assert.ok(cursorFilterIndex > fullLedgerConsumerIndex);
    assert.ok(categoryFilterIndex > fullLedgerConsumerIndex);
    assert.match(LEDGER_PAGE_QUERY, /ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW/);
    assert.match(LEDGER_PAGE_QUERY, /PARTITION BY t\.user_id, t\.game_id/);
    assert.match(LEDGER_PAGE_QUERY, /ROW_NUMBER\(\) OVER/);
    assert.match(LEDGER_PAGE_QUERY, /game\.reconciliation_status = 'player_voided'/);
    assert.match(LEDGER_PAGE_QUERY, /game_season\.status = 'active'/);
}

async function testLedgerIndexesAreMigrated() {
    const queries = [];
    const client = {
        async query(text) {
            queries.push(String(text).replace(/\s+/g, ' ').trim());
            return { rows: [], rowCount: 0 };
        },
        release() {},
    };
    await createDbTables({ connect: async () => client });
    const legacyTimeRepair = queries.find(query => (
        query.includes("column_name = 'timestamp'")
        && query.includes('UPDATE transactions AS target')
    ));
    assert.ok(legacyTimeRepair, 'legacy transaction timestamps receive an idempotent repair path');
    assert.match(legacyTimeRepair, /target\.transaction_time > target\."timestamp"/);
    assert.match(legacyTimeRepair, /cohort\.transaction_time = target\.transaction_time/);
    assert.match(legacyTimeRepair, /cohort\.transaction_id <> target\.transaction_id/);
    assert.ok(queries.some(query => query.includes('idx_transactions_user_history')));
    assert.ok(queries.some(query => query.includes('idx_transactions_game_history')));
    assert.ok(queries.some(query => query.includes('idx_transactions_mercy_history')));
    const reversalReference = queries.find(query => query.includes('reverses_transaction_id INTEGER'));
    assert.ok(reversalReference);
    assert.match(reversalReference, /ON DELETE CASCADE/);
    assert.ok(queries.some(query => query.includes('idx_transactions_one_reversal_per_source')));
    assert.ok(queries.some(query => query.includes('CREATE TABLE IF NOT EXISTS game_voids')));
    assert.ok(queries.some(query => query.includes('trg_game_voids_immutable')));
    const manifestTable = queries.find(query => (
        query.includes('CREATE TABLE IF NOT EXISTS game_void_ledger_manifest')
    ));
    assert.ok(manifestTable);
    assert.match(manifestTable, /UNIQUE \(source_transaction_id_snapshot\)/);
    assert.match(manifestTable, /UNIQUE \(reversal_transaction_id_snapshot\)/);
    assert.ok(queries.some(query => query.includes('idx_game_void_manifest_source_snapshot')));
    assert.ok(queries.some(query => query.includes('idx_game_void_manifest_reversal_snapshot')));
    const manifestInsertGuard = queries.find(query => (
        query.includes('CREATE OR REPLACE FUNCTION reject_late_game_void_manifest_insert')
    ));
    assert.ok(manifestInsertGuard);
    assert.match(manifestInsertGuard, /reconciliation_status IS NULL/);
    assert.ok(queries.some(query => query.includes('trg_game_void_manifest_insert_guard')));
    assert.ok(queries.some(query => query.includes('trg_game_void_manifest_immutable')));
    assert.ok(queries.some(query => query.includes("ADD VALUE IF NOT EXISTS 'game_void_reversal'")));
}

async function runTokenLedgerTests() {
    testQueryValidationAndWindowOrder();
    await testAuthenticatedLedgerEndpoint();
    await testLedgerIndexesAreMigrated();
    console.log('Token-ledger API and migration tests passed.');
}

if (require.main === module) {
    runTokenLedgerTests().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = runTokenLedgerTests;
