'use strict';

// The tournament record's API (api/tournaments.js): the scoreboard ranked by
// winnings with shared ranks on level records, the recent events with their
// podiums, season selection, and the same authentication gate every other
// player-facing route uses.

const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const createTournamentRoutes = require('../src/api/tournaments');

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

function makePool() {
    const calls = [];
    const activeSeason = { season_id: 2, season_number: 2, slug: 'alpha-season-2', display_name: 'Alpha Season 2', status: 'active', ranking_method: 'wallet_balance', rules: {} };
    const archived = { season_id: 1, season_number: 1, slug: 'alpha-season-1', display_name: 'Alpha Season 1' };
    return {
        calls,
        async query(text, params = []) {
            calls.push({ text, params });
            if (/COALESCE\(is_bot, FALSE\) = FALSE/i.test(text)) {
                return { rows: [{ id: 42, username: 'safe-player', is_admin: false }] };
            }
            if (/FROM seasons\s+WHERE status = 'active'/i.test(text)) return { rows: [activeSeason] };
            if (text === createTournamentRoutes.SEASON_BY_KEY_QUERY) {
                return { rows: params[0] === 'alpha-season-1' || params[0] === '1' ? [archived] : [] };
            }
            if (text === createTournamentRoutes.SCOREBOARD_QUERY) {
                if (params[0] === 1) return { rows: [] };
                return {
                    rows: [
                        { user_id: 7, username: 'Anna', winnings_cents: '450', played: 3, podiums: 2, wins: 1, best_place: 1 },
                        { user_id: 8, username: 'Ben', winnings_cents: '450', played: 2, podiums: 2, wins: 1, best_place: 1 },
                        { user_id: 9, username: 'Cara', winnings_cents: '180', played: 3, podiums: 1, wins: 0, best_place: 3 },
                        { user_id: 10, username: 'Dee', winnings_cents: '0', played: 3, podiums: 0, wins: 0, best_place: 4 },
                    ],
                };
            }
            if (text === createTournamentRoutes.RECENT_TOURNAMENTS_QUERY) {
                return {
                    rows: [{
                        tournament_id: 5, name: 'Saturday Sluff', venue: 'tournament-stage', buy_in_cents: 100, starting_stack: 120,
                        current_round: 17, ended_at: '2026-09-06T03:00:00.000Z', field_size: 9,
                        podium: [
                            { place: 1, username: 'Anna', prizeCents: 450 },
                            { place: 2, username: 'Ben', prizeCents: 270 },
                            { place: 3, username: 'Cara', prizeCents: 180 },
                        ],
                    }],
                };
            }
            if (text === createTournamentRoutes.PREVIEW_QUERY) {
                if (params[0] !== 17) return { rows: [] };
                return {
                    rows: [{
                        tournament_id: 17, name: 'Labor Day', venue: 'tournament-stage', status: 'registering',
                        buy_in_cents: 100, starting_stack: 120, max_seats: 15, start_rule: 'creator', starts_at: null,
                        current_round: 0, ended_at: null, creator_name: 'Matt', seats_taken: 9, players_left: 0,
                    }],
                };
            }
            throw new Error(`Unexpected query: ${text}`);
        },
    };
}

async function getJson(url, token) {
    const response = await fetch(url, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
    return { response, body: await response.json() };
}

async function runTournamentScoreboardTests() {
    const pool = makePool();
    const jwt = {
        verify(token, secret, callback) {
            if (token !== 'valid-token') return callback(new Error('invalid token'));
            return callback(null, { id: 42, username: 'safe-player' });
        },
    };
    const originalSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'tournament-scoreboard-test-secret';
    const app = express();
    app.use('/api/tournaments', createTournamentRoutes(pool, jwt));
    const server = http.createServer(app);
    try {
        await listen(server);
        const base = `http://127.0.0.1:${server.address().port}/api/tournaments`;

        const anonymous = await getJson(`${base}/scoreboard`);
        assert.equal(anonymous.response.status, 401);
        assert.equal(pool.calls.length, 0, 'no database work without a session');
        pass('The scoreboard needs a signed-in player.');

        const board = await getJson(`${base}/scoreboard`, 'valid-token');
        assert.equal(board.response.status, 200);
        assert.equal(board.response.headers.get('cache-control'), 'private, no-store');
        assert.deepEqual(board.body.season, { id: 2, number: 2, slug: 'alpha-season-2', displayName: 'Alpha Season 2' });
        assert.deepEqual(board.body.rows.map(row => [row.rank, row.username, row.winningsTokens, row.played, row.podiums, row.wins, row.bestPlace]), [
            [1, 'Anna', '4.50', 3, 2, 1, 1],
            [1, 'Ben', '4.50', 2, 2, 1, 1],
            [3, 'Cara', '1.80', 3, 1, 0, 3],
            [4, 'Dee', '0.00', 3, 0, 0, 4],
        ]);
        const scoreboardCall = pool.calls.find(call => call.text === createTournamentRoutes.SCOREBOARD_QUERY);
        assert.deepEqual(scoreboardCall.params, [2], 'scoped to the active season by default');
        pass('Winnings rank the board; a level record shares a rank; a winless player still shows their best place.');

        const archive = await getJson(`${base}/scoreboard?season=alpha-season-1`, 'valid-token');
        assert.equal(archive.response.status, 200);
        assert.equal(archive.body.season.slug, 'alpha-season-1');
        assert.deepEqual(archive.body.rows, []);
        const missing = await getJson(`${base}/scoreboard?season=nope`, 'valid-token');
        assert.equal(missing.response.status, 404);
        const bad = await getJson(`${base}/scoreboard?season=${encodeURIComponent('drop table')}`, 'valid-token');
        assert.equal(bad.response.status, 400);
        pass('A season slug or id selects an archive; unknown seasons are 404, bad keys are 400.');

        const recent = await getJson(`${base}/recent?limit=5`, 'valid-token');
        assert.equal(recent.response.status, 200);
        assert.equal(recent.body.tournaments.length, 1);
        assert.deepEqual(recent.body.tournaments[0], {
            id: 5, name: 'Saturday Sluff', venue: 'tournament-stage', buyInTokens: '1.00', startingStack: 120, rounds: 17, fieldSize: 9,
            endedAt: '2026-09-06T03:00:00.000Z',
            podium: [
                { place: 1, username: 'Anna', prizeTokens: '4.50' },
                { place: 2, username: 'Ben', prizeTokens: '2.70' },
                { place: 3, username: 'Cara', prizeTokens: '1.80' },
            ],
        });
        const recentCall = pool.calls.find(call => call.text === createTournamentRoutes.RECENT_TOURNAMENTS_QUERY);
        assert.deepEqual(recentCall.params, [2, 5]);
        const tooMany = await getJson(`${base}/recent?limit=500`, 'valid-token');
        assert.equal(tooMany.response.status, 400);
        pass('Recent tournaments carry their podium and prizes; the limit is bounded.');

        assert.deepEqual(createTournamentRoutes.rankRows([]), []);
        pass('An empty season is an empty board, not an error.');

        const preview = await getJson(`${base}/17/preview`);
        assert.equal(preview.response.status, 200, 'the preview needs no session');
        assert.equal(preview.response.headers.get('cache-control'), 'public, max-age=30');
        assert.deepEqual(preview.body, {
            id: 17, name: 'Labor Day', venue: 'tournament-stage', status: 'registering', buyInTokens: '1.00',
            startingStack: 120, maxSeats: 15, seatsTaken: 9, playersLeft: 0, startRule: 'creator', startsAt: null,
            round: 0, endedAt: null, creatorName: 'Matt',
        });
        const unknown = await getJson(`${base}/18/preview`);
        assert.equal(unknown.response.status, 404);
        const badId = await getJson(`${base}/abc/preview`);
        assert.equal(badId.response.status, 400);
        pass('A shared link can preview the event without signing in: name, host, stakes, seats; unknown ids are 404.');
    } finally {
        await close(server);
        process.env.JWT_SECRET = originalSecret;
    }
    console.log('Tournament scoreboard tests passed.');
}

module.exports = runTournamentScoreboardTests;

if (require.main === module) {
    runTournamentScoreboardTests().catch(error => { console.error(error); process.exitCode = 1; });
}
