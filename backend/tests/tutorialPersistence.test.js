'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const createAuthRoutes = require('../src/api/auth');
const createDbTables = require('../src/data/createTables');
const {
    CURRENT_TUTORIAL_VERSION,
    applyTutorialAction,
    playerProgressFields,
} = require('../src/services/tutorialProgress');

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
    const users = new Map([
        [1, {
            id: 1,
            username: 'Tutorial One',
            email: 'one@example.test',
            password_hash: 'stored-hash',
            created_at: '2026-01-01T00:00:00.000Z',
            is_admin: false,
            is_verified: true,
            is_vip: true,
            wins: 2,
            losses: 3,
            washes: 4,
            tutorial_version: 0,
            tutorial_active_version: 0,
            tokens: '7.25',
        }],
        [2, {
            id: 2,
            username: 'Tutorial Two',
            email: 'two@example.test',
            password_hash: 'stored-hash',
            created_at: '2026-01-02T00:00:00.000Z',
            is_admin: false,
            is_verified: true,
            is_vip: false,
            wins: 0,
            losses: 0,
            washes: 0,
            tutorial_version: 0,
            tutorial_active_version: 0,
            tokens: '8.00',
        }],
    ]);
    const state = { users, tutorialWrites: [], queries: [] };

    const pool = {
        async query(text, params = []) {
            const sql = String(text);
            state.queries.push({ sql, params: [...params] });

            if (/SELECT\s+id,\s*username,\s*is_admin\s+FROM\s+users\s+WHERE\s+id\s*=\s*\$1/i.test(sql)) {
                const user = users.get(Number(params[0]));
                return { rows: user ? [{ id: user.id, username: user.username, is_admin: user.is_admin }] : [] };
            }
            if (/password_hash/i.test(sql) && /WHERE\s+email\s*=\s*\$1/i.test(sql)) {
                const user = [...users.values()].find(candidate => candidate.email === params[0]);
                return { rows: user ? [{ ...user }] : [] };
            }
            if (/tutorial_version/i.test(sql) && /FROM\s+users/i.test(sql) && /WHERE\s+id\s*=\s*\$1/i.test(sql)) {
                const user = users.get(Number(params[0]));
                return { rows: user ? [{ ...user }] : [] };
            }
            if (/COALESCE\(SUM\(amount\),\s*0\)\s+AS\s+tokens/i.test(sql)) {
                const user = users.get(Number(params[0]));
                return { rows: [{ tokens: user?.tokens || '0.00' }] };
            }
            if (/INSERT\s+INTO\s+lobby_chat_messages/i.test(sql)) {
                return { rows: [{ id: 99, username: params[1], message: params[2] }] };
            }
            if (/UPDATE\s+users/i.test(sql) && /tutorial_active_version/i.test(sql)) {
                const userId = Number(params[0]);
                const version = Number(params[1]);
                const user = users.get(userId);
                state.tutorialWrites.push({ userId, version, sql });
                if (!user) return { rows: [] };

                if (!/SET\s+tutorial_version/i.test(sql)) {
                    user.tutorial_active_version = version;
                } else {
                    user.tutorial_version = Math.max(user.tutorial_version, version);
                    user.tutorial_active_version = 0;
                }
                return {
                    rows: [{
                        tutorial_version: user.tutorial_version,
                        tutorial_active_version: user.tutorial_active_version,
                    }],
                };
            }

            throw new Error(`Unexpected tutorial persistence query: ${sql}`);
        },
    };

    return { pool, state };
}

function createJwt() {
    return {
        verify(token, _secret, callback) {
            if (token === 'one-token') return callback(null, { id: 1, username: 'Stale One', is_admin: true });
            if (token === 'two-token') return callback(null, { id: 2, username: 'Stale Two', is_admin: true });
            return callback(new Error('invalid token'));
        },
        sign() {
            return 'signed-login-token';
        },
    };
}

function tutorialRequest(url, token, body = {}) {
    return fetch(url, {
        method: 'POST',
        headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });
}

async function testProgressHelpers() {
    assert.equal(CURRENT_TUTORIAL_VERSION, 1);
    assert.deepEqual(playerProgressFields({
        wins: '2', losses: 3, washes: null,
        tutorial_version: '1', tutorial_active_version: -4,
    }), {
        wins: 2,
        losses: 3,
        washes: 0,
        games_played: 5,
        tutorial_version: 1,
        tutorial_active_version: 0,
    });

    await assert.rejects(
        applyTutorialAction({ query() {} }, 1, 'reset'),
        /Unsupported tutorial action/,
    );
    await assert.rejects(
        applyTutorialAction({ query() {} }, 0, 'start'),
        /positive authenticated user id/,
    );
}

async function testTutorialSchemaMigration() {
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

    assert.ok(queries.some(sql => /ADD COLUMN IF NOT EXISTS tutorial_version INTEGER NOT NULL DEFAULT 0/i.test(sql)));
    assert.ok(queries.some(sql => /ADD COLUMN IF NOT EXISTS tutorial_active_version INTEGER NOT NULL DEFAULT 0/i.test(sql)));
}

async function testAuthenticatedTutorialRoutesAndProfiles() {
    const { pool, state } = createPool();
    const jwt = createJwt();
    const bcrypt = { compare: async password => password === 'correct-password' };
    const io = { emit() {} };
    const app = express();
    app.use(express.json());
    app.use('/api/auth', createAuthRoutes(pool, bcrypt, jwt, io));
    const server = http.createServer(app);

    await listen(server);
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}/api/auth`;

    try {
        const unauthenticated = await tutorialRequest(`${baseUrl}/tutorial/start`, null, { userId: 2 });
        assert.equal(unauthenticated.status, 401);
        assert.equal(state.tutorialWrites.length, 0);

        const profileResponse = await fetch(`${baseUrl}/profile?userId=2`, {
            headers: { Authorization: 'Bearer one-token' },
        });
        assert.equal(profileResponse.status, 200);
        const profile = (await profileResponse.json()).user;
        assert.equal(profile.id, 1, 'profile lookup ignores a caller-supplied user id');
        assert.deepEqual({
            wins: profile.wins,
            losses: profile.losses,
            washes: profile.washes,
            games_played: profile.games_played,
            tutorial_version: profile.tutorial_version,
            tutorial_active_version: profile.tutorial_active_version,
        }, {
            wins: 2,
            losses: 3,
            washes: 4,
            games_played: 9,
            tutorial_version: 0,
            tutorial_active_version: 0,
        });

        for (let attempt = 0; attempt < 2; attempt += 1) {
            const response = await tutorialRequest(
                `${baseUrl}/tutorial/start`,
                'one-token',
                { userId: 2, tutorial_version: 99 },
            );
            assert.equal(response.status, 200);
            assert.deepEqual(await response.json(), {
                tutorial_version: 0,
                tutorial_active_version: 1,
            });
        }
        assert.equal(state.users.get(2).tutorial_active_version, 0, 'malicious body userId is never used');
        assert.ok(state.tutorialWrites.every(write => write.userId === 1 && write.version === 1));

        for (let attempt = 0; attempt < 2; attempt += 1) {
            const response = await tutorialRequest(`${baseUrl}/tutorial/complete`, 'one-token', { userId: 2 });
            assert.equal(response.status, 200);
            assert.deepEqual(await response.json(), {
                tutorial_version: 1,
                tutorial_active_version: 0,
            });
        }

        const restartCompleted = await tutorialRequest(`${baseUrl}/tutorial/start`, 'one-token');
        assert.equal(restartCompleted.status, 200);
        assert.deepEqual(await restartCompleted.json(), {
            tutorial_version: 1,
            tutorial_active_version: 1,
        }, 'a completed tutorial can be replayed without erasing its completion record');

        const skipped = await tutorialRequest(`${baseUrl}/tutorial/skip`, 'two-token', { userId: 1 });
        assert.equal(skipped.status, 200);
        assert.deepEqual(await skipped.json(), {
            tutorial_version: 1,
            tutorial_active_version: 0,
        });
        assert.equal(state.users.get(1).tutorial_version, 1);
        assert.equal(state.users.get(2).tutorial_version, 1);

        const loginResponse = await fetch(`${baseUrl}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'one@example.test', password: 'correct-password' }),
        });
        assert.equal(loginResponse.status, 200);
        const login = await loginResponse.json();
        assert.equal(login.token, 'signed-login-token');
        assert.deepEqual({
            wins: login.user.wins,
            losses: login.user.losses,
            washes: login.user.washes,
            games_played: login.user.games_played,
            tutorial_version: login.user.tutorial_version,
            tutorial_active_version: login.user.tutorial_active_version,
        }, {
            wins: 2,
            losses: 3,
            washes: 4,
            games_played: 9,
            tutorial_version: 1,
            tutorial_active_version: 1,
        }, 'login preserves aggregate stats and an explicitly restarted guided game');
    } finally {
        await close(server);
    }
}

async function runTutorialPersistenceTests() {
    await testProgressHelpers();
    await testTutorialSchemaMigration();
    await testAuthenticatedTutorialRoutesAndProfiles();
    console.log('Tutorial persistence and self-only API tests passed.');
}

if (require.main === module) {
    runTutorialPersistenceTests().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = runTutorialPersistenceTests;
