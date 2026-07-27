'use strict';

// Quick-tips read receipts: the /api/tips routes remember which in-game
// tips a user has dismissed. Runs against an in-memory pool double.

const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const createTipsRoutes = require('../src/api/tips');
const { MAX_SEEN_TIPS_PER_USER } = require('../src/api/tips');
const createDbTables = require('../src/data/createTables');

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

function createPool() {
    const state = {
        // Map<userId, Set<tipId>>
        seen: new Map([[1, new Set(['old-tip'])]]),
        queries: [],
    };

    const pool = {
        async query(text, params = []) {
            const sql = String(text);
            state.queries.push({ sql, params: [...params] });

            if (/SELECT\s+id,\s*username,\s*is_admin\s+FROM\s+users\s+WHERE\s+id\s*=\s*\$1/i.test(sql)) {
                const id = Number(params[0]);
                if (id === 1) return { rows: [{ id: 1, username: 'Tipper', is_admin: false }] };
                if (id === 2) return { rows: [{ id: 2, username: 'Fresh', is_admin: false }] };
                return { rows: [] };
            }
            if (/SELECT\s+tip_id\s+FROM\s+user_tips_seen/i.test(sql)) {
                const ids = state.seen.get(Number(params[0])) || new Set();
                return { rows: [...ids].map(tip_id => ({ tip_id })) };
            }
            if (/INSERT\s+INTO\s+user_tips_seen/i.test(sql)) {
                const userId = Number(params[0]);
                if (!state.seen.has(userId)) state.seen.set(userId, new Set());
                const seenSet = state.seen.get(userId);
                // Emulate the guarded INSERT: no row lands once the account
                // holds $3 receipts (re-marks were already ON CONFLICT no-ops).
                const cap = params.length > 2 ? Number(params[2]) : Infinity;
                if (seenSet.size < cap) seenSet.add(params[1]);
                return { rows: [] };
            }

            throw new Error(`Unexpected tips query: ${sql}`);
        },
    };

    return { pool, state };
}

function createJwt() {
    return {
        verify(token, _secret, callback) {
            if (token === 'one-token') return callback(null, { id: 1 });
            if (token === 'two-token') return callback(null, { id: 2 });
            return callback(new Error('invalid token'));
        },
    };
}

function request(url, { method = 'GET', token = null, body } = {}) {
    return fetch(url, {
        method,
        headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
}

async function testTipsSchemaMigration() {
    const queries = [];
    const client = {
        async query(text) {
            queries.push(String(text));
            return { rows: [] };
        },
        release() {},
    };
    const originalLog = console.log;
    console.log = () => {};
    try {
        await createDbTables({ connect: async () => client });
    } finally {
        console.log = originalLog;
    }

    assert.ok(
        queries.some(sql => /CREATE TABLE IF NOT EXISTS user_tips_seen/i.test(sql)),
        'createTables must provision the user_tips_seen table'
    );
    assert.ok(
        queries.some(sql => /user_tips_seen[\s\S]*PRIMARY KEY \(user_id, tip_id\)/i.test(sql)),
        'seen rows must be unique per user and tip'
    );
}

async function testTipsRoutes() {
    const { pool, state } = createPool();
    const app = express();
    app.use(express.json());
    app.use('/api/tips', createTipsRoutes(pool, createJwt()));
    const server = http.createServer(app);

    await listen(server);
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}/api/tips`;

    try {
        // Unauthenticated requests are rejected outright.
        const anonymous = await request(`${baseUrl}/seen`);
        assert.equal(anonymous.status, 401);

        const badToken = await request(`${baseUrl}/seen`, { token: 'forged' });
        assert.equal(badToken.status, 403);

        // Users read only their own receipts.
        const one = await request(`${baseUrl}/seen`, { token: 'one-token' });
        assert.equal(one.status, 200);
        assert.deepEqual(await one.json(), { seenTipIds: ['old-tip'] });

        const two = await request(`${baseUrl}/seen`, { token: 'two-token' });
        assert.deepEqual(await two.json(), { seenTipIds: [] });

        // Marking a tip persists it; re-marking stays idempotent.
        const mark = await request(`${baseUrl}/seen`, {
            method: 'POST', token: 'two-token', body: { tipId: 'fast-play-style-2026-07' },
        });
        assert.equal(mark.status, 201);
        const remark = await request(`${baseUrl}/seen`, {
            method: 'POST', token: 'two-token', body: { tipId: 'fast-play-style-2026-07' },
        });
        assert.equal(remark.status, 201);
        assert.deepEqual([...state.seen.get(2)], ['fast-play-style-2026-07']);

        const twoAfter = await request(`${baseUrl}/seen`, { token: 'two-token' });
        assert.deepEqual(await twoAfter.json(), { seenTipIds: ['fast-play-style-2026-07'] });

        // Malformed ids never reach the database.
        for (const tipId of [undefined, 42, '', 'Bad Tip!', 'x'.repeat(65), "tip'; DROP TABLE users;--"]) {
            const bad = await request(`${baseUrl}/seen`, {
                method: 'POST', token: 'one-token', body: { tipId },
            });
            assert.equal(bad.status, 400, `tipId ${JSON.stringify(tipId)} must be rejected`);
        }
        assert.deepEqual([...state.seen.get(1)], ['old-tip']);

        // The per-account cap stops scripted id spam without changing the
        // response contract for legitimate use.
        state.seen.set(2, new Set(
            Array.from({ length: MAX_SEEN_TIPS_PER_USER }, (_, index) => `bulk-tip-${index}`)
        ));
        const overflow = await request(`${baseUrl}/seen`, {
            method: 'POST', token: 'two-token', body: { tipId: 'one-too-many' },
        });
        assert.equal(overflow.status, 201);
        assert.equal(state.seen.get(2).has('one-too-many'), false);
        assert.equal(state.seen.get(2).size, MAX_SEEN_TIPS_PER_USER);
    } finally {
        await close(server);
    }
}

async function runTipsTests() {
    await testTipsSchemaMigration();
    await testTipsRoutes();
    console.log('✅ tips read-receipt tests passed');
}

module.exports = runTipsTests;

if (require.main === module) {
    runTipsTests().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}
