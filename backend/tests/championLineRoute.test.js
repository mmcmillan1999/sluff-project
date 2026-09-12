'use strict';

// The champion-line route (api/sounds.js): the winner's line comes from the
// engine's own scores, only for a seated caller of a finished game, and is
// NEVER cacheable — the URL names the table, and the next game at that
// table has a different champion. (Sept 10 2026: a one-hour max-age let
// McSaddle's browser replay Grampa Blane's line on McSaddle's own win.)

const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const createSoundsRoutes = require('../src/api/sounds');

const pass = message => console.log(`  ✓ ${message}`);

async function listen(server) {
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
}

async function close(server) {
    await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
}

function makePool(audioByName) {
    return {
        async query(text, params = []) {
            if (/COALESCE\(is_bot, FALSE\) = FALSE/i.test(text)) {
                return { rows: [{ id: 42, username: 'Mcsaddle', is_admin: false }] };
            }
            if (/FROM champion_lines WHERE name_key/i.test(text)) {
                const audio = audioByName[params[0]];
                return { rows: audio ? [{ audio }] : [] };
            }
            throw new Error(`Unexpected query: ${text}`);
        },
    };
}

function makeEngine({ scores, state = 'Game Over', forfeit = null }) {
    return {
        state,
        scores,
        roundSummary: { isGameOver: state === 'Game Over', forfeit },
        players: { 42: { userId: 42, playerName: 'Mcsaddle' }, 7: { userId: 7, playerName: 'Grampa Blane' } },
    };
}

async function runChampionLineRouteTests() {
    const engines = {};
    const gameService = { getEngineById: id => engines[id] || null };
    const pool = makePool({
        mcsaddle: Buffer.from('MCSADDLE-LINE'),
        'grampa blane': Buffer.from('BLANE-LINE'),
    });
    const jwt = {
        verify(token, secret, callback) {
            if (token !== 'valid-token') return callback(new Error('invalid token'));
            return callback(null, { id: 42, username: 'Mcsaddle' });
        },
    };
    const originalSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'champion-line-route-test-secret';
    const app = express();
    app.use('/api/sounds', createSoundsRoutes(pool, jwt, gameService));
    const server = http.createServer(app);
    try {
        await listen(server);
        const base = `http://127.0.0.1:${server.address().port}/api/sounds/champion-line`;
        const get = (path) => fetch(`${base}/${path}`, { headers: { Authorization: 'Bearer valid-token' } });

        engines['qp-1'] = makeEngine({ scores: { Mcsaddle: 354, 'Grampa Blane': 14, 'Grandpa George': -17, ScoreAbsorber: 129 } });
        const win = await get('qp-1?game=qp-1:1000');
        assert.equal(win.status, 200);
        assert.equal(win.headers.get('content-type'), 'audio/mpeg');
        assert.equal(Buffer.from(await win.arrayBuffer()).toString(), 'MCSADDLE-LINE', 'the top score names the champion');
        assert.equal(win.headers.get('cache-control'), 'private, no-store', 'never cacheable: the URL names the table, not the game');
        pass('The champion line is the top scorer’s and is marked no-store.');

        // The next game at the same table, a different champion: the same
        // URL must yield the new line (nothing in the route ties it to a
        // previous answer).
        engines['qp-1'] = makeEngine({ scores: { Mcsaddle: 20, 'Grampa Blane': 210, 'Grandpa George': -5 } });
        const next = await get('qp-1?game=qp-1:2000');
        assert.equal(Buffer.from(await next.arrayBuffer()).toString(), 'BLANE-LINE');
        pass('A new game at the same table answers with the new champion.');

        engines['qp-1'] = makeEngine({ scores: { Mcsaddle: 200, 'Grampa Blane': 200, 'Grandpa George': -5 } });
        assert.equal((await get('qp-1')).status, 204, 'a shared top step has no single champion');
        engines['qp-1'] = makeEngine({ scores: { Mcsaddle: 200, 'Grampa Blane': 10 }, forfeit: { forfeitingPlayerName: 'Grampa Blane' } });
        assert.equal((await get('qp-1')).status, 204, 'no fanfare for a forfeit handover');
        engines['qp-1'] = makeEngine({ scores: { Mcsaddle: 200, 'Grampa Blane': 10 }, state: 'Playing Phase' });
        assert.equal((await get('qp-1')).status, 409, 'not before the game is over');
        assert.equal((await get('nope')).status, 404);
        pass('Ties, forfeits, unfinished games and unknown tables get no line.');
    } finally {
        await close(server);
        process.env.JWT_SECRET = originalSecret;
    }
    console.log('Champion line route tests passed.');
}

module.exports = runChampionLineRouteTests;

if (require.main === module) {
    runChampionLineRouteTests().catch(error => { console.error(error); process.exitCode = 1; });
}
