'use strict';

const assert = require('assert');
const http = require('http');
const express = require('express');
const createPlayerRoutes = require('../src/api/players');

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

function makePool() {
    const calls = [];
    const profiles = new Map([
        ['Target Bot', {
            id: 77,
            username: 'Target Bot',
            wins: 7,
            losses: 2,
            washes: 1,
            tokens: '12.5',
        }],
        ['safe-player', {
            id: 42,
            username: 'safe-player',
            wins: 3,
            losses: 1,
            washes: 0,
            tokens: '8.00',
        }],
        ['new-player', {
            id: 88,
            username: 'new-player',
            wins: 0,
            losses: 0,
            washes: 0,
            tokens: null,
        }],
    ]);

    return {
        calls,
        async query(text, params) {
            calls.push({ text, params });
            if (/COALESCE\(is_bot, FALSE\) = FALSE/i.test(text)) {
                return { rows: [{ id: 42, username: 'safe-player', is_admin: false }] };
            }
            if (text === createPlayerRoutes.PUBLIC_PROFILE_QUERY) {
                const profile = profiles.get(params[0]);
                return { rows: profile ? [profile] : [] };
            }
            if (text === createPlayerRoutes.HEAD_TO_HEAD_QUERY) {
                if (params[2] === 88) {
                    return {
                        rows: [{ games_played: 0, wins: 0, losses: 0, ties: 0 }],
                    };
                }
                return {
                    rows: [{ games_played: 4, wins: 2, losses: 1, ties: 1 }],
                };
            }
            throw new Error(`Unexpected query: ${text}`);
        },
    };
}

async function getJson(url, token) {
    const response = await fetch(url, token ? {
        headers: { Authorization: `Bearer ${token}` },
    } : undefined);
    return { response, body: await response.json() };
}

async function runPlayerProfileTests() {
    const pool = makePool();
    const jwt = {
        verify(token, secret, callback) {
            if (token !== 'valid-token') return callback(new Error('invalid token'));
            return callback(null, { id: 42, username: 'stale-token-name', is_admin: true });
        },
    };
    const originalJwtSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'player-profile-test-secret';

    const app = express();
    app.use('/api/players', createPlayerRoutes(pool, jwt));
    const server = http.createServer(app);

    try {
        await listen(server);
        const baseUrl = `http://127.0.0.1:${server.address().port}/api/players`;

        const unauthenticated = await getJson(`${baseUrl}/Target%20Bot/profile`);
        assert.strictEqual(unauthenticated.response.status, 401);
        assert.deepStrictEqual(unauthenticated.body, { message: 'Authentication required.' });
        assert.strictEqual(pool.calls.length, 0, 'Unauthenticated profile reads must not query the database.');

        const invalid = await getJson(`${baseUrl}/Target%20Bot/profile`, 'invalid-token');
        assert.strictEqual(invalid.response.status, 403);
        assert.deepStrictEqual(invalid.body, { message: 'Invalid or expired token.' });
        assert.strictEqual(pool.calls.length, 0, 'Invalid tokens must not query the database.');

        const target = await getJson(`${baseUrl}/Target%20Bot/profile`, 'valid-token');
        assert.strictEqual(target.response.status, 200);
        assert.strictEqual(target.response.headers.get('cache-control'), 'private, no-store');
        assert.deepStrictEqual(target.body, {
            player: {
                username: 'Target Bot',
                wins: 7,
                losses: 2,
                washes: 1,
                totalGames: 10,
                winRate: 70,
                tokens: '12.50',
            },
            headToHead: {
                isSelf: false,
                gamesPlayed: 4,
                wins: 2,
                losses: 1,
                ties: 1,
                winRate: 50,
            },
        });
        assert(!Object.prototype.hasOwnProperty.call(target.body.player, 'id'));
        assert(!Object.prototype.hasOwnProperty.call(target.body.player, 'isBot'));
        assert(!Object.prototype.hasOwnProperty.call(target.body.player, 'is_bot'));

        const targetCalls = pool.calls.splice(0);
        assert.strictEqual(targetCalls.length, 3, 'A target profile uses auth, profile, and comparison queries.');
        assert.deepStrictEqual(targetCalls[0].params, [42], 'The current DB identity, not JWT claims, authenticates the caller.');
        assert.deepStrictEqual(targetCalls[1].params, ['Target Bot']);
        assert.deepStrictEqual(targetCalls[2].params, [[42, 77], 42, 77]);

        const profileSelect = createPlayerRoutes.PUBLIC_PROFILE_QUERY.split(/\bFROM\b/i)[0];
        assert(!/\bemail\b/i.test(profileSelect));
        assert(!/\bis_admin\b/i.test(profileSelect));
        assert(!/\bis_bot\b/i.test(createPlayerRoutes.PUBLIC_PROFILE_QUERY));
        assert(!/\bpassword/i.test(createPlayerRoutes.PUBLIC_PROFILE_QUERY));

        const comparisonQuery = createPlayerRoutes.HEAD_TO_HEAD_QUERY;
        assert(/game\.end_time IS NOT NULL/i.test(comparisonQuery));
        assert(/game\.outcome LIKE 'Game Over!%'/i.test(comparisonQuery));
        assert(/game\.reconciliation_status IS NULL/i.test(comparisonQuery));
        assert(/ledger\.transaction_type::text = 'buy_in'/i.test(comparisonQuery));
        assert(/ledger\.transaction_type::text = 'buy_in'\s+AND ledger\.amount < 0/i.test(comparisonQuery), 'Each participant must have one genuine negative buy-in.');
        assert(/'win_payout', 'wash_payout', 'forfeit_payout'\s*\)\s*\) <= 1/i.test(comparisonQuery), 'Duplicate payouts must quarantine a game from social stats.');
        assert(/AND ledger\.amount <= 0/i.test(comparisonQuery), 'Non-positive payout rows must quarantine a game from social stats.');
        assert(/SUM\(ledger\.amount\)/i.test(comparisonQuery));
        assert(/WHEN game_outcome LIKE 'Game Over! Draw \(%' THEN 0/i.test(comparisonQuery), 'All rule-level draws must remain head-to-head ties.');
        assert(/requester_received_forfeit_payout\s+AND target_received_forfeit_payout THEN 0/i.test(comparisonQuery), 'Joint forfeit recipients must remain tied winners.');
        assert(/WHEN requester_net_cents > target_net_cents \+ 1 THEN 1/i.test(comparisonQuery));
        assert(/WHEN requester_net_cents < target_net_cents - 1 THEN -1/i.test(comparisonQuery));
        assert(/ELSE 0/i.test(comparisonQuery), 'Equal or penny-rounding economic finishes must be recorded as ties.');
        assert(/transaction_type::text IN \(\s*'buy_in', 'win_payout', 'wash_payout', 'forfeit_payout'/i.test(comparisonQuery), 'Only canonical settlement entries may affect the record.');

        const self = await getJson(`${baseUrl}/safe-player/profile`, 'valid-token');
        assert.strictEqual(self.response.status, 200);
        assert.deepStrictEqual(self.body.headToHead, {
            isSelf: true,
            gamesPlayed: 0,
            wins: 0,
            losses: 0,
            ties: 0,
            winRate: null,
        });
        const selfCalls = pool.calls.splice(0);
        assert.strictEqual(selfCalls.length, 2, 'Self profiles must not manufacture comparisons from lifetime games.');
        assert(!selfCalls.some(call => call.text === createPlayerRoutes.HEAD_TO_HEAD_QUERY));

        const zeroGames = await getJson(`${baseUrl}/new-player/profile`, 'valid-token');
        assert.strictEqual(zeroGames.response.status, 200);
        assert.deepStrictEqual(zeroGames.body, {
            player: {
                username: 'new-player',
                wins: 0,
                losses: 0,
                washes: 0,
                totalGames: 0,
                winRate: null,
                tokens: '0.00',
            },
            headToHead: {
                isSelf: false,
                gamesPlayed: 0,
                wins: 0,
                losses: 0,
                ties: 0,
                winRate: null,
            },
        });
        pool.calls.splice(0);

        const missing = await getJson(`${baseUrl}/missing-player/profile`, 'valid-token');
        assert.strictEqual(missing.response.status, 404);
        assert.deepStrictEqual(missing.body, { message: 'Player not found.' });
        const missingCalls = pool.calls.splice(0);
        assert.strictEqual(missingCalls.length, 2);
        assert(!missingCalls.some(call => call.text === createPlayerRoutes.HEAD_TO_HEAD_QUERY));

        assert.throws(
            () => createPlayerRoutes.publicHeadToHead({
                games_played: 2,
                wins: 2,
                losses: 1,
                ties: 0,
            }),
            /inconsistent head-to-head counts/,
        );
        assert.strictEqual(createPlayerRoutes.percentage(1, 3), 33.3);
        assert.strictEqual(createPlayerRoutes.percentage(0, 0), null);

        console.log('Player profile privacy and head-to-head tests passed.');
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
    runPlayerProfileTests().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = runPlayerProfileTests;
