const assert = require('assert');
const http = require('http');
const express = require('express');
const createLeaderboardRoutes = require('../src/api/leaderboard');

async function listen(server) {
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
}

async function close(server) {
    await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
    });
}

async function runLeaderboardTests() {
    const queries = [];
    const pool = {
        query: async (text, params) => {
            queries.push({ text, params });
            if (/FROM\s+users\s+WHERE\s+id\s*=\s*\$1/i.test(text)) {
                return {
                    rows: [{ id: 42, username: 'safe-player', is_admin: false }],
                };
            }
            return {
                rows: [{
                    user_id: 42,
                    username: 'safe-player',
                    email: 'private@example.com',
                    wins: 8,
                    losses: 3,
                    washes: 1,
                    is_admin: true,
                    is_bot: true,
                    tokens: '12.50',
                }],
            };
        },
    };

    const verifyCalls = [];
    const jwt = {
        verify: (token, secret, callback) => {
            verifyCalls.push({ token, secret });
            if (token === 'valid-token') {
                return callback(null, { id: 42, username: 'safe-player' });
            }
            return callback(new Error('invalid token'));
        },
    };

    const originalJwtSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'leaderboard-test-secret';

    const app = express();
    app.use('/api/leaderboard', createLeaderboardRoutes(pool, jwt));
    const server = http.createServer(app);

    try {
        await listen(server);
        const { port } = server.address();
        const url = `http://127.0.0.1:${port}/api/leaderboard`;

        const unauthenticatedResponse = await fetch(url);
        assert.strictEqual(unauthenticatedResponse.status, 401);
        assert.deepStrictEqual(
            await unauthenticatedResponse.json(),
            { message: 'Authentication required.' }
        );
        assert.strictEqual(queries.length, 0, 'Unauthenticated requests must not query the database.');

        const invalidTokenResponse = await fetch(url, {
            headers: { Authorization: 'Bearer invalid-token' },
        });
        assert.strictEqual(invalidTokenResponse.status, 403);
        assert.deepStrictEqual(
            await invalidTokenResponse.json(),
            { message: 'Invalid or expired token.' }
        );
        assert.strictEqual(queries.length, 0, 'Invalid tokens must not query the database.');

        const authenticatedResponse = await fetch(url, {
            headers: { Authorization: 'Bearer valid-token' },
        });
        assert.strictEqual(authenticatedResponse.status, 200);
        assert.deepStrictEqual(await authenticatedResponse.json(), [{
            username: 'safe-player',
            wins: 8,
            losses: 3,
            washes: 1,
            isBot: true,
            tokens: '12.50',
        }]);

        assert.strictEqual(queries.length, 2, 'An authenticated request should hydrate the user before reading the leaderboard.');
        assert.deepStrictEqual(queries[0].params, [42]);
        const leaderboardQuery = queries[1];
        const selectClause = leaderboardQuery.text.split(/\bFROM\b/i)[0];
        assert(!/\bemail\b/i.test(selectClause), 'The query must not select email addresses.');
        assert(!/\bis_admin\b/i.test(selectClause), 'The query must not select admin status.');
        assert(!/\buser_id\b/i.test(selectClause), 'The query must not select database user IDs.');
        assert(/u\.username/i.test(selectClause));
        assert(/u\.wins/i.test(selectClause));
        assert(/u\.losses/i.test(selectClause));
        assert(/u\.washes/i.test(selectClause));
        assert(/u\.is_bot/i.test(selectClause));
        assert(/\btokens\b/i.test(selectClause));

        assert.deepStrictEqual(verifyCalls, [
            { token: 'invalid-token', secret: 'leaderboard-test-secret' },
            { token: 'valid-token', secret: 'leaderboard-test-secret' },
        ]);

        console.log('Leaderboard authentication and response-safety tests passed.');
    } finally {
        await close(server);
        if (originalJwtSecret === undefined) {
            delete process.env.JWT_SECRET;
        } else {
            process.env.JWT_SECRET = originalJwtSecret;
        }
    }
}

if (require.main === module) {
    runLeaderboardTests().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = runLeaderboardTests;
