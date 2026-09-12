'use strict';

// The call to the felt (tournament/tournamentWelcome.js + the audio route):
// Liam's script reads the field host-first through the same sanitizer as
// the champion line, names up to three favorites by podium rate, and the
// route hands the line only to an entrant while the opening is live.

const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { pickFavorites, buildWelcomeScript, spokenTitle, listWithAnd } = require('../src/tournament/tournamentWelcome');
const { createMemoryStore } = require('../src/tournament/tournamentStore');
const createSoundsRoutes = require('../src/api/sounds');

const pass = message => console.log(`  ✓ ${message}`);

const field = names => names.map((username, index) => ({ userId: index + 1, username }));

async function listen(server) {
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
}

async function close(server) {
    await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
}

async function runTournamentWelcomeTests() {
    // --- The script ---
    {
        const entries = field(['Mcsaddle', 'MrNoobCrusher', 'Zacattack', 'Grandpa George']);
        const script = buildWelcomeScript({ id: 31, name: "Mcsaddle's Tournament", entries, favorites: ['Grandpa George', 'Zacattack'] });
        assert.equal(
            script,
            "Welcome to Sluff Tournament number 31... Mcsaddle's Tournament. Tonight at the tables: Mcsaddle, Mr Noob Crusher, Zacattack, and Grandpa George. Tonight's favorites... Grandpa George and Zacattack. Four players. One champion. Take your seats.",
        );
        pass('The script names the event, reads the field in order, calls the favorites, and counts the players.');
    }
    {
        const entries = field(['Solo']);
        assert.equal(
            buildWelcomeScript({ id: 7, name: '', entries, favorites: ['Solo'] }),
            "Welcome to Sluff Tournament number 7... Tonight at the tables: Solo. Tonight's favorite... Solo. One player. One champion. Take your seats.",
        );
        assert.equal(
            buildWelcomeScript({ id: 8, name: 'Quiet Night', entries: field(['A', 'B', 'C']), favorites: [] }),
            'Welcome to Sluff Tournament number 8... Quiet Night. Tonight at the tables: A, B, and C. Three players. One champion. Take your seats.',
        );
        pass('No favorites means no favorites clause; one favorite is singular.');
    }
    {
        const eleven = field(['Host', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10', 'P11']);
        const script = buildWelcomeScript({ id: 30, name: 'Big One', entries: eleven, favorites: [] });
        assert.match(script, /Tonight at the tables: Host, P 2, P 3, P 4, P 5, P 6, P 7, P 8, and 3 more\. Eleven players\./);
        const nine = field(['Host', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9']);
        assert.match(buildWelcomeScript({ id: 30, name: 'Nine', entries: nine, favorites: [] }), /P 8, and P 9\. Nine players\./);
        pass('Nine names are read in full; past nine the line reads eight and counts the rest.');
    }
    {
        const entries = field(['[laughs] evil', 'cool_dude99', '<script>alert(1)</script>']);
        const script = buildWelcomeScript({ id: 3, name: 'Nice [whispers] name <b>x</b>', entries, favorites: ['[laughs] evil'] });
        assert.equal(script.includes('['), false, 'no brackets survive into the prompt');
        assert.equal(script.includes('<'), false, 'no markup survives into the prompt');
        assert.match(script, /Tonight at the tables: laughs evil, cool dude 99, and scriptalert1script\./);
        assert.match(script, /Tonight's favorite\.\.\. laughs evil\./);
        assert.equal(spokenTitle('Nice [whispers] name <b>x</b>'), 'Nice whispers name bxb');
        assert.equal(spokenTitle('   '), null);
        assert.equal(spokenTitle('x'.repeat(80)).length, 60, 'the title is capped');
        assert.equal(listWithAnd([]), '');
        assert.equal(listWithAnd(['a']), 'a');
        assert.equal(listWithAnd(['a', 'b']), 'a and b');
        pass('Player names and the event name are reduced to speakable text before they reach the voice.');
    }

    // --- The favorites ---
    {
        const entries = field(['A', 'B', 'C', 'D', 'E']);
        const records = new Map([
            [1, { played: 4, podiums: 2 }],   // A: .50
            [2, { played: 1, podiums: 1 }],   // B: 1.00
            [3, { played: 10, podiums: 6 }],  // C: .60
            [4, { played: 3, podiums: 0 }],   // D: played, never placed
            [5, { played: 2, podiums: 1 }],   // E: .50, fewer podiums than A
        ]);
        assert.deepEqual(pickFavorites(entries, records), ['B', 'C', 'A'], 'podium rate ranks; ties go to more podiums');
        assert.deepEqual(pickFavorites(entries, records, { count: 2 }), ['B', 'C']);
        assert.deepEqual(pickFavorites(entries, new Map()), [], 'no record, no favorites');
        assert.deepEqual(pickFavorites(entries, new Map([[4, { played: 5, podiums: 0 }]])), [], 'a podium is required');
        const tie = new Map([[1, { played: 2, podiums: 1 }], [2, { played: 2, podiums: 1 }]]);
        assert.deepEqual(pickFavorites(field(['Zed', 'Amy']), tie), ['Amy', 'Zed'], 'a dead heat reads alphabetically');
        pass('Favorites are the three best podium rates among players who have placed.');
    }

    // --- The record, from the in-memory store ---
    {
        const store = createMemoryStore();
        store.state.results.push(
            { tournamentId: 1, userId: 7, place: 1 },
            { tournamentId: 2, userId: 7, place: 4 },
            { tournamentId: 2, userId: 8, place: 3 },
            { tournamentId: 3, userId: 9, place: 2 },
        );
        const records = await store.loadTournamentRecords([7, 8, 42]);
        assert.deepEqual([...records.entries()], [[7, { played: 2, podiums: 1 }], [8, { played: 1, podiums: 1 }]]);
        pass('The store counts tournaments played and podiums per entrant.');
    }

    // --- The route ---
    {
        const audioByViewer = {};
        const gameService = {
            getEngineById: () => null,
            tournamentDirector: {
                welcomeAudioFor: (tournamentId, userId) => (String(tournamentId) === '31' ? audioByViewer[userId] || null : null),
            },
        };
        const pool = {
            async query(text) {
                if (/COALESCE\(is_bot, FALSE\) = FALSE/i.test(text)) {
                    return { rows: [{ id: 42, username: 'Mcsaddle', is_admin: false }] };
                }
                throw new Error(`Unexpected query: ${text}`);
            },
        };
        const jwt = {
            verify(token, secret, callback) {
                if (token !== 'valid-token') return callback(new Error('invalid token'));
                return callback(null, { id: 42, username: 'Mcsaddle' });
            },
        };
        const originalSecret = process.env.JWT_SECRET;
        process.env.JWT_SECRET = 'tournament-welcome-route-test-secret';
        const app = express();
        app.use('/api/sounds', createSoundsRoutes(pool, jwt, gameService));
        const server = http.createServer(app);
        try {
            await listen(server);
            const base = `http://127.0.0.1:${server.address().port}/api/sounds/tournament-welcome`;
            const get = (path, token = 'valid-token') => fetch(`${base}/${path}`, { headers: { Authorization: `Bearer ${token}` } });

            assert.equal((await get('31')).status, 204, 'no line yet: the fanfare plays alone');
            audioByViewer[42] = Buffer.from('CALL-TO-THE-FELT');
            const line = await get('31');
            assert.equal(line.status, 200);
            assert.equal(line.headers.get('content-type'), 'audio/mpeg');
            assert.equal(line.headers.get('cache-control'), 'private, no-store', 'one event, one line — never cached');
            assert.equal(Buffer.from(await line.arrayBuffer()).toString(), 'CALL-TO-THE-FELT');
            assert.equal((await get('30')).status, 204, 'another event has no line for this caller');
            assert.equal((await get('31', 'bad-token')).status, 403, 'signed-in players only');
            pass('The route serves an entrant their event’s line, marked no-store, and nothing to anyone else.');
        } finally {
            await close(server);
            process.env.JWT_SECRET = originalSecret;
        }
    }

    console.log('Tournament welcome tests passed.');
}

module.exports = runTournamentWelcomeTests;

if (require.main === module) {
    runTournamentWelcomeTests().catch(error => { console.error(error); process.exitCode = 1; });
}
