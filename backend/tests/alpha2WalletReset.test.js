'use strict';

const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const createAdminRoutes = require('../src/api/admin');
const createDbTables = require('../src/data/createTables');
const {
    ALPHA_TWO_WALLET_RESET_KEY,
    Alpha2WalletResetConflictError,
    applyAlpha2WalletReset,
    previewAlpha2WalletReset,
    summaryFromAccounts,
} = require('../src/services/alpha2WalletResetService');
const {
    parseArgs,
    runCli,
} = require('../scripts/reset-alpha2-wallets');

function alphaTwo(overrides = {}) {
    return {
        season_id: 2,
        season_number: 2,
        slug: 'alpha-season-2',
        display_name: 'Alpha Season 2',
        status: 'active',
        ranking_method: 'game_token_net',
        rules: { minimumSettledGames: 1, ranking: 'game_token_net' },
        starts_at: '2026-07-16T12:00:00.000Z',
        ends_at: null,
        finalized_at: null,
        final_standings_hash: null,
        final_player_count: null,
        ...overrides,
    };
}

function clone(value) {
    return value === null || value === undefined
        ? value
        : JSON.parse(JSON.stringify(value));
}

function makePool({
    active = alphaTwo(),
    accounts = [
        { id: 7, username: 'Below', currentCents: 250 },
        { id: 11, username: 'Exact', currentCents: 800 },
        { id: 19, username: 'Above', currentCents: 1275 },
    ],
    currentSeasonGameCount = 0,
    failAdjustmentAt = null,
    verificationFails = false,
} = {}) {
    const state = {
        active: clone(active),
        accounts: new Map(accounts.map(row => [row.id, clone(row)])),
        currentSeasonGameCount,
        operation: null,
        calls: [],
        adjustmentCalls: 0,
        failAdjustmentAt,
        verificationFails,
        authUsers: new Map([
            [1, { id: 1, username: 'Player', is_admin: false }],
            [2, { id: 2, username: 'Admin', is_admin: true }],
        ]),
        released: 0,
    };

    function accountRows() {
        return [...state.accounts.values()]
            .sort((left, right) => left.id - right.id)
            .map(row => ({
                source_user_id: row.id,
                username: row.username,
                current_tokens: (row.currentCents / 100).toFixed(2),
            }));
    }

    const pool = {
        state,
        async query(text, params = []) {
            const sql = String(text).replace(/\s+/g, ' ').trim();
            state.calls.push({ sql, params, direct: true });
            if (sql.includes('SELECT id, username, is_admin') && sql.includes('FROM users')) {
                const row = state.authUsers.get(Number(params[0]));
                return { rows: row ? [clone(row)] : [] };
            }
            throw new Error(`Unexpected direct wallet reset query: ${sql}`);
        },
        async connect() {
            let snapshot = null;
            return {
                async query(text, params = []) {
                    const sql = String(text).replace(/\s+/g, ' ').trim();
                    state.calls.push({ sql, params, direct: false });
                    if (sql.startsWith('BEGIN')) {
                        snapshot = {
                            accounts: clone([...state.accounts.entries()]),
                            operation: clone(state.operation),
                        };
                        return { rows: [] };
                    }
                    if (sql === 'COMMIT') {
                        snapshot = null;
                        return { rows: [] };
                    }
                    if (sql === 'ROLLBACK') {
                        if (snapshot) {
                            state.accounts = new Map(snapshot.accounts);
                            state.operation = snapshot.operation;
                        }
                        snapshot = null;
                        return { rows: [] };
                    }
                    if (sql.startsWith('SELECT pg_advisory_xact_lock')) return { rows: [] };
                    if (sql.startsWith('LOCK TABLE')) return { rows: [] };
                    if (sql === 'SELECT id FROM users ORDER BY id ASC FOR UPDATE') {
                        return { rows: [...state.accounts.keys()].sort((left, right) => left - right).map(id => ({ id })) };
                    }
                    if (sql.includes("FROM seasons") && sql.includes("WHERE status = 'active'")) {
                        return { rows: state.active ? [clone(state.active)] : [] };
                    }
                    if (sql.includes('FROM season_wallet_reset_operations')) {
                        return { rows: state.operation ? [clone(state.operation)] : [] };
                    }
                    if (sql.includes('FROM game_history') && sql.includes('WHERE season_id = $1')) {
                        return { rows: [{ count: state.currentSeasonGameCount }] };
                    }
                    if (sql.includes('FROM users u') && sql.includes('GROUP BY u.id, u.username')) {
                        return { rows: accountRows() };
                    }
                    if (sql.startsWith('INSERT INTO transactions')) {
                        state.adjustmentCalls += 1;
                        if (state.failAdjustmentAt === state.adjustmentCalls) {
                            throw new Error('injected adjustment failure');
                        }
                        const account = state.accounts.get(Number(params[0]));
                        assert(account, 'adjustment references a known account');
                        assert.equal(params[2], 'Alpha Season 2 opening wallet reset to 8 tokens');
                        assert.equal(params[3], `${ALPHA_TWO_WALLET_RESET_KEY}:${account.id}`);
                        account.currentCents += Math.round(Number(params[1]) * 100);
                        return { rows: [], rowCount: 1 };
                    }
                    if (sql.includes('HAVING COALESCE(SUM(t.amount), 0)')) {
                        const bad = state.verificationFails
                            || [...state.accounts.values()].some(row => row.currentCents !== 800);
                        return { rows: bad ? [{ id: 999 }] : [] };
                    }
                    if (sql.startsWith('INSERT INTO season_wallet_reset_operations')) {
                        state.operation = {
                            operation_key: params[0],
                            season_id: params[1],
                            target_tokens: params[2],
                            preview_hash: params[3],
                            account_count: params[4],
                            changed_account_count: params[5],
                            old_supply: params[6],
                            new_supply: params[7],
                            minted: params[8],
                            burned: params[9],
                            net_change: params[10],
                            applied_by_user_id: params[11],
                            applied_by_username: params[12],
                            applied_at: '2026-07-16T12:30:00.000Z',
                        };
                        return { rows: [clone(state.operation)], rowCount: 1 };
                    }
                    if (sql.includes('FROM seasons') && sql.includes('WHERE season_id = $1')) {
                        return { rows: [clone(state.active)] };
                    }
                    throw new Error(`Unexpected wallet reset test query: ${sql}`);
                },
                release() { state.released += 1; },
            };
        },
    };
    return pool;
}

async function testMigrationCreatesImmutableMarker() {
    const calls = [];
    const client = {
        async query(text) {
            calls.push(String(text).replace(/\s+/g, ' ').trim());
            return { rows: [], rowCount: 0 };
        },
        release() {},
    };
    await createDbTables({ connect: async () => client });
    const create = calls.find(sql => sql.startsWith('CREATE TABLE IF NOT EXISTS season_wallet_reset_operations'));
    assert(create);
    assert.match(create, /operation_key VARCHAR\(100\) PRIMARY KEY/);
    assert.match(create, /season_id INTEGER NOT NULL UNIQUE REFERENCES seasons/);
    assert.match(create, /preview_hash CHAR\(64\) NOT NULL/);
    assert.match(create, /applied_by_username VARCHAR\(50\) NOT NULL/);
    assert(calls.some(sql => sql.includes('BEFORE UPDATE OR DELETE ON season_wallet_reset_operations')));
}

async function testReadOnlyPreviewAndExactSupplyMath() {
    const pool = makePool();
    const preview = await previewAlpha2WalletReset(pool);
    assert.equal(preview.season.number, 2);
    assert.equal(preview.targetTokens, '8.00');
    assert.deepEqual(preview.summary, {
        accountCount: 3,
        changedAccountCount: 2,
        oldSupply: '23.25',
        newSupply: '24.00',
        minted: '5.50',
        burned: '4.75',
        net: '0.75',
    });
    assert.equal(preview.canApply, true);
    assert.equal(preview.alreadyApplied, false);
    assert.match(preview.previewHash, /^[a-f0-9]{64}$/);
    assert.deepEqual(preview.accounts.map(row => [row.username, row.currentTokens, row.adjustmentTokens]), [
        ['Below', '2.50', '5.50'],
        ['Exact', '8.00', '0.00'],
        ['Above', '12.75', '-4.75'],
    ]);
    assert(preview.accounts.every(row => row.sourceUserId === undefined));
    assert.equal(pool.state.calls[0].sql, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    assert(pool.state.calls.some(call => call.sql.startsWith('SELECT pg_advisory_xact_lock_shared')));
    assert.equal(pool.state.calls.at(-1).sql, 'COMMIT');

    const helperSummary = summaryFromAccounts([
        { currentCents: -100, adjustmentCents: 900 },
        { currentCents: 900, adjustmentCents: -100 },
    ]);
    assert.deepEqual(helperSummary, {
        accountCount: 2,
        changedAccountCount: 2,
        oldSupply: '8.00',
        newSupply: '16.00',
        minted: '9.00',
        burned: '1.00',
        net: '8.00',
    });
}

async function testAtomicLedgerApplyAndDurableIdempotency() {
    const pool = makePool();
    const preview = await previewAlpha2WalletReset(pool);
    const result = await applyAlpha2WalletReset(pool, {
        expectedPreviewHash: preview.previewHash,
        expectedSeasonId: preview.season.id,
        appliedBy: { id: 2, username: 'Admin' },
    });
    assert.equal(result.alreadyApplied, false);
    assert.equal(result.summary.changedAccountCount, 2);
    assert.deepEqual(
        [...pool.state.accounts.values()].map(row => row.currentCents),
        [800, 800, 800],
    );
    assert.equal(pool.state.adjustmentCalls, 2, 'accounts already at 8 receive no zero-value ledger row');
    assert.equal(pool.state.operation.operation_key, ALPHA_TWO_WALLET_RESET_KEY);
    assert.equal(pool.state.operation.applied_by_user_id, 2);

    const applyCalls = pool.state.calls;
    const advisory = applyCalls.findIndex(call => call.sql === 'SELECT pg_advisory_xact_lock($1)');
    const gameLock = applyCalls.findIndex((call, index) => index > advisory && call.sql === 'LOCK TABLE game_history IN EXCLUSIVE MODE');
    const usersTableLock = applyCalls.findIndex((call, index) => index > gameLock && call.sql === 'LOCK TABLE users IN SHARE MODE');
    const usersRowLock = applyCalls.findIndex((call, index) => index > usersTableLock && call.sql === 'SELECT id FROM users ORDER BY id ASC FOR UPDATE');
    const transactionsLock = applyCalls.findIndex((call, index) => index > usersRowLock && call.sql === 'LOCK TABLE transactions IN SHARE MODE');
    const seasonRowLock = applyCalls.findIndex((call, index) => (
        index > transactionsLock
        && call.sql.includes("WHERE status = 'active'")
        && call.sql.endsWith('FOR UPDATE')
    ));
    const adjustment = applyCalls.findIndex((call, index) => index > seasonRowLock && call.sql.startsWith('INSERT INTO transactions'));
    const marker = applyCalls.findIndex((call, index) => index > adjustment && call.sql.startsWith('INSERT INTO season_wallet_reset_operations'));
    assert(advisory >= 0 && gameLock > advisory && usersTableLock > gameLock);
    assert(usersRowLock > usersTableLock && transactionsLock > usersRowLock);
    assert(seasonRowLock > transactionsLock && adjustment > seasonRowLock && marker > adjustment);

    const retry = await applyAlpha2WalletReset(pool, {
        expectedPreviewHash: preview.previewHash,
        expectedSeasonId: preview.season.id,
        appliedBy: { id: 2, username: 'Admin' },
    });
    assert.equal(retry.alreadyApplied, true);
    assert.equal(pool.state.adjustmentCalls, 2, 'idempotent retry cannot append ledger rows');
    assert.equal(retry.previewHash, preview.previewHash);

    await assert.rejects(
        applyAlpha2WalletReset(pool, {
            expectedPreviewHash: 'f'.repeat(64),
            expectedSeasonId: preview.season.id,
            appliedBy: { id: 2, username: 'Admin' },
        }),
        error => error instanceof Alpha2WalletResetConflictError && error.code === 'RESET_ALREADY_APPLIED',
    );
}

async function testSeasonAndFirstGameGates() {
    const withGame = makePool({ currentSeasonGameCount: 1 });
    const preview = await previewAlpha2WalletReset(withGame);
    assert.equal(preview.canApply, false);
    await assert.rejects(
        applyAlpha2WalletReset(withGame, {
            expectedPreviewHash: preview.previewHash,
            expectedSeasonId: preview.season.id,
            appliedBy: { id: 2, username: 'Admin' },
        }),
        error => error.code === 'CURRENT_SEASON_GAMES_EXIST',
    );
    assert.equal(withGame.state.adjustmentCalls, 0);
    assert.equal(withGame.state.calls.at(-1).sql, 'ROLLBACK');

    const seasonThree = makePool({
        active: alphaTwo({
            season_id: 3,
            season_number: 3,
            slug: 'alpha-season-3',
            display_name: 'Alpha Season 3',
        }),
    });
    await assert.rejects(
        previewAlpha2WalletReset(seasonThree),
        error => error.code === 'ALPHA2_NOT_ACTIVE',
    );
    assert.equal(seasonThree.state.calls.at(-1).sql, 'ROLLBACK');
}

async function testStalePreviewAndFailureRollBackEverything() {
    const stalePool = makePool();
    const stalePreview = await previewAlpha2WalletReset(stalePool);
    stalePool.state.accounts.get(7).currentCents += 100;
    await assert.rejects(
        applyAlpha2WalletReset(stalePool, {
            expectedPreviewHash: stalePreview.previewHash,
            expectedSeasonId: stalePreview.season.id,
            appliedBy: { username: 'maintenance-cli' },
        }),
        error => error.code === 'PREVIEW_STALE',
    );
    assert.equal(stalePool.state.adjustmentCalls, 0);

    const failurePool = makePool({ failAdjustmentAt: 2 });
    const failurePreview = await previewAlpha2WalletReset(failurePool);
    await assert.rejects(
        applyAlpha2WalletReset(failurePool, {
            expectedPreviewHash: failurePreview.previewHash,
            expectedSeasonId: failurePreview.season.id,
            appliedBy: { id: 2, username: 'Admin' },
        }),
        /injected adjustment failure/,
    );
    assert.deepEqual(
        [...failurePool.state.accounts.values()].map(row => row.currentCents),
        [250, 800, 1275],
        'a mid-loop failure rolls back earlier adjustments',
    );
    assert.equal(failurePool.state.operation, null);
    assert.equal(failurePool.state.calls.at(-1).sql, 'ROLLBACK');

    await assert.rejects(
        applyAlpha2WalletReset(failurePool, {
            expectedPreviewHash: 'bad',
            expectedSeasonId: 2,
        }),
        error => error.code === 'PREVIEW_HASH_REQUIRED',
    );
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

async function testAdminApiAuthorizationStatusAndBroadcast() {
    const pool = makePool();
    const emitted = [];
    const io = { emit: (event, payload) => emitted.push({ event, payload }) };
    const jwt = {
        verify(token, _secret, callback) {
            if (token === 'player') return callback(null, { id: 1 });
            if (token === 'admin') return callback(null, { id: 2 });
            return callback(new Error('invalid'));
        },
    };
    const app = express();
    app.use(express.json());
    app.use('/api/admin', createAdminRoutes(pool, jwt, io));
    const server = http.createServer(app);
    const previousSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'alpha2-wallet-reset-test';
    try {
        await listen(server);
        const base = `http://127.0.0.1:${server.address().port}/api/admin/seasons`;
        assert.equal((await fetch(`${base}/alpha-2-wallet-reset-preview`)).status, 401);
        assert.equal((await fetch(`${base}/alpha-2-wallet-reset-preview`, {
            headers: { Authorization: 'Bearer player' },
        })).status, 403);

        const previewResponse = await fetch(`${base}/alpha-2-wallet-reset-preview`, {
            headers: { Authorization: 'Bearer admin' },
        });
        assert.equal(previewResponse.status, 200);
        const preview = await previewResponse.json();

        const missingProof = await fetch(`${base}/alpha-2-wallet-reset`, {
            method: 'POST',
            headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
            body: '{}',
        });
        assert.equal(missingProof.status, 400);

        const applyBody = JSON.stringify({
            expectedPreviewHash: preview.previewHash,
            expectedSeasonId: preview.season.id,
        });
        const applied = await fetch(`${base}/alpha-2-wallet-reset`, {
            method: 'POST',
            headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
            body: applyBody,
        });
        assert.equal(applied.status, 201);
        assert.equal((await applied.json()).alreadyApplied, false);
        assert.deepEqual(emitted, [{
            event: 'tokenBalancesReset',
            payload: { seasonId: 2, targetTokens: '8.00' },
        }]);

        const retry = await fetch(`${base}/alpha-2-wallet-reset`, {
            method: 'POST',
            headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
            body: applyBody,
        });
        assert.equal(retry.status, 200);
        assert.equal((await retry.json()).alreadyApplied, true);
        assert.equal(emitted.length, 1, 'idempotent API retry does not rebroadcast');
    } finally {
        await close(server);
        if (previousSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = previousSecret;
    }
}

async function testMaintenanceCliDefaultsToPreviewAndRequiresProof() {
    assert.deepEqual(parseArgs([]), {
        execute: false,
        expectedPreviewHash: null,
        expectedSeasonId: null,
    });
    assert.throws(() => parseArgs(['--execute']), /requires --expected-hash/);
    assert.deepEqual(parseArgs([
        '--execute',
        `--expected-hash=${'a'.repeat(64)}`,
        '--expected-season-id=2',
    ]), {
        execute: true,
        expectedPreviewHash: 'a'.repeat(64),
        expectedSeasonId: 2,
    });

    const lines = [];
    let ended = false;
    let previewCalled = 0;
    let applyCalled = 0;
    class FakePool {
        constructor(config) {
            assert.equal(config.connectionString, 'postgres://wallet-reset-test');
        }
        async end() { ended = true; }
    }
    const result = {
        season: { id: 2, name: 'Alpha Season 2' },
        targetTokens: '8.00',
        summary: {
            accountCount: 3,
            changedAccountCount: 2,
            oldSupply: '21.25',
            newSupply: '24.00',
            minted: '5.50',
            burned: '4.75',
            net: '2.75',
        },
        currentSeasonGameCount: 0,
        canApply: true,
        alreadyApplied: false,
        previewHash: 'a'.repeat(64),
    };
    await runCli({
        argv: [],
        env: { POSTGRES_CONNECT_STRING: 'postgres://wallet-reset-test' },
        PoolClass: FakePool,
        preview: async () => { previewCalled += 1; return result; },
        apply: async () => { applyCalled += 1; },
        output: { log: line => lines.push(line) },
    });
    assert.equal(previewCalled, 1);
    assert.equal(applyCalled, 0);
    assert.equal(ended, true);
    assert.match(lines.join('\n'), /READ-ONLY PREVIEW/);
    assert.doesNotMatch(lines.join('\n'), /Below|Above|source_user_id/);
}

async function runAlpha2WalletResetTests() {
    await testMigrationCreatesImmutableMarker();
    await testReadOnlyPreviewAndExactSupplyMath();
    await testAtomicLedgerApplyAndDurableIdempotency();
    await testSeasonAndFirstGameGates();
    await testStalePreviewAndFailureRollBackEverything();
    await testAdminApiAuthorizationStatusAndBroadcast();
    await testMaintenanceCliDefaultsToPreviewAndRequiresProof();
    console.log('Alpha Season 2 one-time wallet reset tests passed.');
}

if (require.main === module) {
    runAlpha2WalletResetTests().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = runAlpha2WalletResetTests;
