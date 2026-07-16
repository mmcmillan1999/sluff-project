'use strict';

const assert = require('assert');
const http = require('http');
const express = require('express');
const createDbTables = require('../src/data/createTables');
const createSeasonRoutes = require('../src/api/seasons');
const createAdminRoutes = require('../src/api/admin');
const transactionManager = require('../src/data/transactionManager');
const {
    CANONICAL_GAME_TRANSACTION_TYPES,
    CURRENT_STANDINGS_QUERY,
    SeasonConflictError,
    finalizeRollover,
    getFinalizedSeason,
    loadCurrentStandings,
    previewRollover,
} = require('../src/services/seasonService');

function seasonRow(number = 1, overrides = {}) {
    return {
        season_id: number,
        season_number: number,
        slug: `alpha-season-${number}`,
        display_name: `Alpha Season ${number}`,
        status: 'active',
        ranking_method: number === 1 ? 'wallet_balance' : 'game_token_net',
        rules: number === 1
            ? { minimumSettledGames: 0, ranking: 'wallet_balance' }
            : { minimumSettledGames: 1, ranking: 'game_token_net' },
        starts_at: `2026-07-${String(number).padStart(2, '0')}T00:00:00.000Z`,
        ends_at: null,
        finalized_at: null,
        final_standings_hash: null,
        final_player_count: null,
        ...overrides,
    };
}

function rawStanding(id, username, ranking, wallet, stats, eligible = true) {
    const [wins, losses, washes] = stats;
    return {
        source_user_id: id,
        display_name: username,
        wins,
        losses,
        washes,
        games_played: wins + losses + washes,
        eligible,
        ranking_tokens: ranking,
        wallet_tokens: wallet,
    };
}

function snapshotState(state) {
    return {
        active: state.active ? { ...state.active, rules: { ...state.active.rules } } : null,
        finalized: [...state.finalized.entries()].map(([id, row]) => [id, { ...row, rules: { ...row.rules } }]),
        snapshots: state.snapshots.map(row => ({ ...row })),
        zeroStatsSeasonId: state.zeroStatsSeasonId,
    };
}

function restoreState(state, backup) {
    state.active = backup.active;
    state.finalized = new Map(backup.finalized);
    state.snapshots = backup.snapshots;
    state.zeroStatsSeasonId = backup.zeroStatsSeasonId;
}

function makeSeasonPool({ active = seasonRow(1), standings, inProgressGames = 0, failSnapshotAt = null } = {}) {
    const state = {
        active,
        finalized: new Map(),
        standings: standings || [
            rawStanding(1, 'McSaddle', '25.00', '25.00', [8, 2, 1]),
            rawStanding(2, 'Ada', '10.00', '10.00', [5, 4, 0]),
            rawStanding(3, 'Zero Account', '0.00', '0.00', [0, 0, 0]),
        ],
        snapshots: [],
        inProgressGames,
        zeroStatsSeasonId: null,
        calls: [],
        users: new Map([
            [1, { id: 1, username: 'Player', is_admin: false }],
            [2, { id: 2, username: 'Admin', is_admin: true }],
        ]),
    };

    let backup = null;
    const client = {
        async query(text, params = []) {
            const sql = String(text).replace(/\s+/g, ' ').trim();
            state.calls.push({ sql, params });
            if (sql.startsWith('BEGIN')) {
                backup = snapshotState(state);
                return { rows: [] };
            }
            if (sql === 'COMMIT') {
                backup = null;
                return { rows: [] };
            }
            if (sql === 'ROLLBACK') {
                if (backup) restoreState(state, backup);
                backup = null;
                return { rows: [] };
            }
            if (sql.startsWith('SELECT pg_advisory_xact_lock')) return { rows: [{}] };
            if (sql.startsWith('LOCK TABLE')) return { rows: [] };
            if (sql.includes('SELECT id, username, is_admin') && sql.includes('FROM users')) {
                const user = state.users.get(Number(params[0]));
                return { rows: user ? [user] : [] };
            }
            if (sql.includes('FROM seasons') && sql.includes("WHERE status = 'active'")) {
                return { rows: state.active ? [{ ...state.active }] : [] };
            }
            if (sql.includes('COUNT(*)::integer AS count') && sql.includes('FROM game_history')) {
                return { rows: [{ count: state.inProgressGames }] };
            }
            if (sql.includes('u.id AS source_user_id')) {
                return { rows: state.standings.map(row => ({ ...row })) };
            }
            if (sql.startsWith('INSERT INTO season_standings_snapshots')) {
                const position = Number(params[1]);
                if (failSnapshotAt === position) throw new Error('injected snapshot failure');
                state.snapshots.push({
                    season_id: params[0], position, rank: params[2], source_user_id: params[3],
                    display_name: params[4], wins: params[5], losses: params[6], washes: params[7],
                    games_played: params[8], eligible: params[9], ranking_tokens: params[10],
                    wallet_tokens: params[11],
                });
                return { rows: [], rowCount: 1 };
            }
            if (sql.startsWith('UPDATE seasons') && sql.includes("status = 'finalized'")) {
                if (!state.active || Number(params[0]) !== Number(state.active.season_id)) {
                    return { rows: [], rowCount: 0 };
                }
                const finalized = {
                    ...state.active,
                    status: 'finalized',
                    ends_at: '2026-07-16T12:00:00.000Z',
                    finalized_at: '2026-07-16T12:00:00.000Z',
                    final_standings_hash: params[1],
                    final_player_count: params[2],
                };
                state.finalized.set(Number(finalized.season_id), finalized);
                state.active = null;
                return { rows: [finalized], rowCount: 1 };
            }
            if (sql.startsWith('INSERT INTO seasons')) {
                const created = seasonRow(Number(params[0]), {
                    season_id: Number(params[0]),
                    slug: params[1],
                    display_name: params[2],
                    ranking_method: params[3],
                    rules: JSON.parse(params[4]),
                });
                state.active = created;
                return { rows: [created], rowCount: 1 };
            }
            if (sql.startsWith('INSERT INTO season_player_stats')) {
                state.zeroStatsSeasonId = Number(params[0]);
                return { rows: [], rowCount: state.users.size };
            }
            if (sql.includes('FROM seasons') && sql.includes("status = 'finalized'") && sql.includes('TRIM(final_standings_hash)')) {
                const row = state.finalized.get(Number(params[0]));
                return { rows: row && row.final_standings_hash === params[1] ? [row] : [] };
            }
            if (sql.includes('FROM seasons s') && sql.includes("WHERE s.status = 'finalized'") && sql.includes('player_count')) {
                return {
                    rows: [...state.finalized.values()].map(row => ({
                        ...row,
                        player_count: state.snapshots.filter(snapshot => (
                            Number(snapshot.season_id) === Number(row.season_id)
                        )).length,
                    })),
                };
            }
            if (sql.includes('FROM seasons') && sql.includes("status = 'finalized'") && sql.includes('(slug = $1 OR season_id = $2)')) {
                const row = [...state.finalized.values()].find(candidate => (
                    candidate.slug === params[0] || Number(candidate.season_id) === Number(params[1])
                ));
                return { rows: row ? [row] : [] };
            }
            if (sql.includes('FROM season_standings_snapshots')) {
                return {
                    rows: state.snapshots
                        .filter(row => Number(row.season_id) === Number(params[0]))
                        .sort((a, b) => a.position - b.position),
                };
            }
            throw new Error(`Unexpected season test query: ${sql}`);
        },
        release() {},
    };

    return {
        state,
        async connect() { return client; },
        query(text, params) { return client.query(text, params); },
    };
}

async function testSchemaMigrationContract() {
    const queries = [];
    const client = {
        async query(text) {
            queries.push(String(text).replace(/\s+/g, ' ').trim());
            return { rows: [] };
        },
        release() {},
    };
    await createDbTables({ async connect() { return client; } });

    const seed = queries.findIndex(sql => sql.startsWith('INSERT INTO seasons'));
    const backfill = queries.findIndex(sql => sql.startsWith('UPDATE game_history SET season_id'));
    const notNull = queries.findIndex(sql => sql.includes('ALTER COLUMN season_id SET NOT NULL'));
    assert(seed >= 0 && seed < backfill && backfill < notNull, 'Alpha 1 must be seeded before history backfill/NOT NULL');
    assert(queries.some(sql => sql.includes('BEFORE INSERT ON game_history') && sql.includes('assign_active_season_to_game')));
    assert(queries.some(sql => sql.includes('BEFORE INSERT OR UPDATE OR DELETE ON season_standings_snapshots')));
    const snapshotTable = queries.find(sql => sql.startsWith('CREATE TABLE IF NOT EXISTS season_standings_snapshots'));
    assert(snapshotTable.includes('source_user_id INTEGER'));
    assert(!snapshotTable.includes('source_user_id INTEGER REFERENCES'), 'snapshot identity cannot block account deletion');
    assert(queries.some(sql => sql.includes('final_standings_hash CHAR(64)')));
}

async function testRankingContracts() {
    assert(CURRENT_STANDINGS_QUERY.includes("game.end_time IS NOT NULL"));
    assert(CURRENT_STANDINGS_QUERY.includes("game.outcome LIKE 'Game Over!%'"));
    assert(CURRENT_STANDINGS_QUERY.includes('game.reconciliation_status IS NULL'));
    assert(CURRENT_STANDINGS_QUERY.includes('ORDER BY eligible DESC, ranking_tokens DESC, u.username ASC'));
    assert.deepStrictEqual(CANONICAL_GAME_TRANSACTION_TYPES, [
        'buy_in', 'win_payout', 'wash_payout', 'forfeit_loss',
        'forfeit_payout', 'abandoned_refund',
    ]);

    const alphaOne = seasonRow(1);
    const alphaOneRows = [
        rawStanding(1, 'Rich', '50.00', '50.00', [10, 3, 0]),
        rawStanding(2, 'Zero', '0.00', '0.00', [0, 0, 0]),
    ];
    const alphaResult = await loadCurrentStandings({ query: async () => ({ rows: alphaOneRows }) }, alphaOne);
    assert.deepStrictEqual(alphaResult.map(row => [row.username, row.rank, row.rankingTokens]), [
        ['Rich', 1, '50.00'], ['Zero', 2, '0.00'],
    ]);

    const seasonTwoRows = [
        rawStanding(3, 'Winner', '2.00', '20.00', [1, 0, 0], true),
        rawStanding(4, 'Active Negative', '-5.00', '4.00', [0, 1, 0], true),
        rawStanding(5, 'Inactive Zero', '0.00', '99.00', [0, 0, 0], false),
    ];
    const seasonTwo = await loadCurrentStandings(
        { query: async () => ({ rows: seasonTwoRows }) },
        seasonRow(2),
    );
    assert.deepStrictEqual(seasonTwo.map(row => [row.username, row.rank, row.eligible]), [
        ['Winner', 1, true], ['Active Negative', 2, true], ['Inactive Zero', null, false],
    ]);
}

async function testPreviewAndFinalize() {
    const pool = makeSeasonPool();
    const preview = await previewRollover(pool);
    assert.strictEqual(preview.canFinalize, true);
    assert.match(preview.previewHash, /^[a-f0-9]{64}$/);
    assert.strictEqual(preview.season.name, 'Alpha Season 1');
    assert.strictEqual(preview.podium[0].username, 'McSaddle');
    assert(!('sourceUserId' in preview.standings[0]));
    assert(pool.state.calls.some(call => call.sql === 'BEGIN READ ONLY'));
    assert.strictEqual(pool.state.snapshots.length, 0, 'preview is read-only');

    await assert.rejects(
        finalizeRollover(pool, { expectedSeasonId: 1, expectedPreviewHash: '0'.repeat(64) }),
        error => error instanceof SeasonConflictError && error.code === 'PREVIEW_STALE',
    );
    assert.strictEqual(pool.state.active.season_number, 1);
    assert.strictEqual(pool.state.snapshots.length, 0);

    pool.state.inProgressGames = 1;
    await assert.rejects(
        finalizeRollover(pool, { expectedSeasonId: 1, expectedPreviewHash: preview.previewHash }),
        error => error instanceof SeasonConflictError && error.code === 'GAMES_IN_PROGRESS',
    );
    pool.state.inProgressGames = 0;

    const result = await finalizeRollover(pool, {
        expectedSeasonId: preview.season.id,
        expectedPreviewHash: preview.previewHash,
    });
    assert.strictEqual(result.finalizedSeason.name, 'Alpha Season 1');
    assert.strictEqual(result.activeSeason.name, 'Alpha Season 2');
    assert.strictEqual(pool.state.active.season_number, 2);
    assert.strictEqual(pool.state.zeroStatsSeasonId, 2);
    assert.strictEqual(pool.state.snapshots.length, 3);
    const finalized = pool.state.finalized.get(1);
    assert.strictEqual(finalized.final_standings_hash, preview.previewHash);
    assert.strictEqual(finalized.final_player_count, 3);

    const lockIndex = pool.state.calls.findIndex(call => call.sql.startsWith('SELECT pg_advisory_xact_lock'));
    const tableLockIndex = pool.state.calls.findIndex(call => call.sql.startsWith('LOCK TABLE'));
    const snapshotIndex = pool.state.calls.findIndex(call => call.sql.startsWith('INSERT INTO season_standings_snapshots'));
    assert(lockIndex >= 0 && tableLockIndex > lockIndex && snapshotIndex > tableLockIndex);
    assert(pool.state.calls.some(call => (
        call.sql === 'LOCK TABLE users, transactions, season_player_stats IN SHARE MODE'
    )), 'writer-compatible user-before-transaction lock order is required');

    const archive = await getFinalizedSeason(pool, 'alpha-season-1');
    assert.strictEqual(archive.podium.length, 3);
    assert.strictEqual(archive.standings[0].username, 'McSaddle');
    assert(!('sourceUserId' in archive.standings[0]));
    assert(!('isBot' in archive.standings[0]));

    pool.state.inProgressGames = 1;
    const retry = await finalizeRollover(pool, {
        expectedSeasonId: preview.season.id,
        expectedPreviewHash: preview.previewHash,
    });
    assert.strictEqual(retry.alreadyFinalized, true);
    assert.strictEqual(pool.state.snapshots.length, 3, 'idempotent retry cannot duplicate snapshot rows');
    assert.strictEqual(pool.state.active.season_number, 2, 'idempotent retry cannot create another season');
}

async function testFinalizeRollback() {
    const pool = makeSeasonPool({ failSnapshotAt: 2 });
    const preview = await previewRollover(pool);
    await assert.rejects(
        finalizeRollover(pool, { expectedSeasonId: 1, expectedPreviewHash: preview.previewHash }),
        /injected snapshot failure/,
    );
    assert.strictEqual(pool.state.active.season_number, 1);
    assert.strictEqual(pool.state.finalized.size, 0);
    assert.strictEqual(pool.state.snapshots.length, 0);
    assert(pool.state.calls.some(call => call.sql === 'ROLLBACK'));
}

async function testGameTransactionsCarrySeason() {
    const calls = [];
    const startClient = {
        async query(text, params = []) {
            const sql = String(text).replace(/\s+/g, ' ').trim();
            calls.push({ sql, params });
            if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
            if (sql.startsWith('SELECT pg_advisory_xact_lock')) return { rows: [{}] };
            if (sql.startsWith('INSERT INTO game_history')) return { rows: [{ game_id: 77, season_id: 2 }] };
            if (sql.includes('FROM users') && sql.includes('FOR UPDATE')) {
                return { rows: [{ id: 1, username: 'One', is_bot: false }] };
            }
            if (sql.includes('FROM transactions') && sql.includes('current_tokens')) {
                return { rows: [{ user_id: 1, current_tokens: '5.00' }] };
            }
            if (sql.startsWith('INSERT INTO transactions')) return { rows: [] };
            throw new Error(`Unexpected start query: ${sql}`);
        },
        release() {},
    };
    const start = await transactionManager.startGameTransaction(
        { async connect() { return startClient; } },
        { tableId: 'season-start', theme: 'fort-creek', playerMode: 3 },
        [1],
    );
    assert.strictEqual(start.gameId, 77);
    const advisoryIndex = calls.findIndex(call => call.sql.startsWith('SELECT pg_advisory_xact_lock'));
    const insertIndex = calls.findIndex(call => call.sql.startsWith('INSERT INTO game_history'));
    assert(advisoryIndex >= 0 && insertIndex > advisoryIndex, 'lock must be its own pre-insert statement');
    assert(calls[insertIndex].sql.includes("WHERE status = 'active'"));

    const settlementCalls = [];
    const settlementClient = {
        async query(text, params = []) {
            const sql = String(text).replace(/\s+/g, ' ').trim();
            settlementCalls.push({ sql, params });
            if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
            if (sql.startsWith('SELECT outcome')) {
                return { rows: [{ outcome: 'In Progress', season_id: 2 }] };
            }
            if (sql.includes('SELECT id FROM users') && sql.includes('FOR UPDATE')) return { rows: [{ id: 1 }] };
            if (sql.startsWith('UPDATE users SET wins')) return { rows: [], rowCount: 1 };
            if (sql.startsWith('INSERT INTO season_player_stats')) return { rows: [], rowCount: 1 };
            if (sql.startsWith('UPDATE game_history')) return { rows: [], rowCount: 1 };
            throw new Error(`Unexpected settlement query: ${sql}`);
        },
        release() {},
    };
    await transactionManager.settleGameTransaction(
        { async connect() { return settlementClient; } },
        {
            gameId: 77,
            outcome: 'Game Over! Winner: One',
            payouts: [],
            stats: [{ userId: 1, column: 'wins' }],
            botUserIds: [],
            result: {},
        },
    );
    const seasonalStat = settlementCalls.find(call => call.sql.startsWith('INSERT INTO season_player_stats'));
    assert.deepStrictEqual(seasonalStat.params, [2, 1]);
    assert(seasonalStat.sql.includes('season_player_stats.wins + 1'));
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

async function testApiContractsAndAuthorization() {
    const pool = makeSeasonPool();
    const jwt = {
        verify(token, secret, callback) {
            if (token === 'player') return callback(null, { id: 1 });
            if (token === 'admin') return callback(null, { id: 2 });
            return callback(new Error('invalid'));
        },
    };
    const previousSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'season-test';
    const app = express();
    app.use(express.json());
    app.use('/api/seasons', createSeasonRoutes(pool, jwt));
    app.use('/api/admin', createAdminRoutes(pool, jwt));
    const server = http.createServer(app);
    try {
        await listen(server);
        const base = `http://127.0.0.1:${server.address().port}`;
        assert.strictEqual((await fetch(`${base}/api/seasons/current`)).status, 401);
        const currentResponse = await fetch(`${base}/api/seasons/current`, {
            headers: { Authorization: 'Bearer player' },
        });
        assert.strictEqual(currentResponse.status, 200);
        const current = await currentResponse.json();
        assert.strictEqual(current.season.name, 'Alpha Season 1');
        assert(Array.isArray(current.standings));
        assert(!('sourceUserId' in current.standings[0]));
        const currentBegin = pool.state.calls.findIndex(call => call.sql === 'BEGIN READ ONLY');
        const currentLock = pool.state.calls.findIndex((call, index) => (
            index > currentBegin && call.sql.startsWith('SELECT pg_advisory_xact_lock')
        ));
        const currentMetadata = pool.state.calls.findIndex((call, index) => (
            index > currentLock && call.sql.includes("WHERE status = 'active'")
        ));
        assert(currentBegin >= 0 && currentLock > currentBegin && currentMetadata > currentLock);

        const forbidden = await fetch(`${base}/api/admin/seasons/rollover-preview`, {
            headers: { Authorization: 'Bearer player' },
        });
        assert.strictEqual(forbidden.status, 403);
        const adminPreview = await fetch(`${base}/api/admin/seasons/rollover-preview`, {
            headers: { Authorization: 'Bearer admin' },
        });
        assert.strictEqual(adminPreview.status, 200);
        const previewPayload = await adminPreview.json();
        assert.match(previewPayload.previewHash, /^[a-f0-9]{64}$/);

        const missingProof = await fetch(`${base}/api/admin/seasons/rollover`, {
            method: 'POST',
            headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
            body: '{}',
        });
        assert.strictEqual(missingProof.status, 400);

        const rollover = await fetch(`${base}/api/admin/seasons/rollover`, {
            method: 'POST',
            headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
            body: JSON.stringify({
                expectedPreviewHash: previewPayload.previewHash,
                expectedSeasonId: previewPayload.season.id,
            }),
        });
        assert.strictEqual(rollover.status, 201);

        const archiveList = await fetch(`${base}/api/seasons`, {
            headers: { Authorization: 'Bearer player' },
        });
        assert.strictEqual(archiveList.status, 200);
        const archiveListPayload = await archiveList.json();
        assert.strictEqual(archiveListPayload.seasons[0].slug, 'alpha-season-1');
        assert.strictEqual(archiveListPayload.seasons[0].playerCount, 3);

        const archiveResponse = await fetch(`${base}/api/seasons/alpha-season-1`, {
            headers: { Authorization: 'Bearer player' },
        });
        assert.strictEqual(archiveResponse.status, 200);
        const archivePayload = await archiveResponse.json();
        assert.strictEqual(archivePayload.podium[0].username, 'McSaddle');
        assert.strictEqual(archivePayload.standings.length, 3);
        assert(!('isBot' in archivePayload.standings[0]));
    } finally {
        await close(server);
        if (previousSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = previousSecret;
    }
}

async function runSeasonTests() {
    await testSchemaMigrationContract();
    await testRankingContracts();
    await testPreviewAndFinalize();
    await testFinalizeRollback();
    await testGameTransactionsCarrySeason();
    await testApiContractsAndAuthorization();
    console.log('Season lifecycle, archive, ranking, and rollover tests passed.');
}

if (require.main === module) {
    runSeasonTests().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = runSeasonTests;
