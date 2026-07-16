'use strict';

const crypto = require('crypto');

// Game starts and season rollovers must take the same transaction-scoped lock.
// The value is stable application infrastructure, not a database row id.
const SEASON_ROLLOVER_LOCK_ID = 53485546;
const CANONICAL_GAME_TRANSACTION_TYPES = Object.freeze([
    'buy_in',
    'win_payout',
    'wash_payout',
    'forfeit_loss',
    'forfeit_payout',
    'abandoned_refund',
]);

class SeasonConflictError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'SeasonConflictError';
        this.code = code;
    }
}

function canonicalMoney(value) {
    const number = Number(value || 0);
    if (!Number.isFinite(number)) throw new TypeError(`Invalid token value: ${value}`);
    return number.toFixed(2);
}

function publicSeason(row) {
    return {
        id: Number(row.season_id),
        number: Number(row.season_number),
        slug: row.slug,
        name: row.display_name,
        status: row.status,
        rankingMethod: row.ranking_method,
        rules: row.rules || {},
        startsAt: row.starts_at,
        endsAt: row.ends_at || null,
        finalizedAt: row.finalized_at || null,
        finalStandingsHash: row.final_standings_hash?.trim?.() || null,
        finalPlayerCount: row.final_player_count === null || row.final_player_count === undefined
            ? null
            : Number(row.final_player_count),
    };
}

async function acquireSeasonLock(client) {
    await client.query('SELECT pg_advisory_xact_lock($1)', [SEASON_ROLLOVER_LOCK_ID]);
}

async function acquireSeasonReadLock(client) {
    await client.query('SELECT pg_advisory_xact_lock_shared($1)', [SEASON_ROLLOVER_LOCK_ID]);
}

async function loadActiveSeason(client, { forUpdate = false } = {}) {
    const result = await client.query(
        `SELECT season_id, season_number, slug, display_name, status,
                ranking_method, rules, starts_at, ends_at, finalized_at,
                final_standings_hash, final_player_count
         FROM seasons
         WHERE status = 'active'
         ${forUpdate ? 'FOR UPDATE' : ''}`,
    );
    if (result.rows.length !== 1) {
        const error = new Error(`Expected one active season, found ${result.rows.length}.`);
        error.code = 'ACTIVE_SEASON_INVARIANT';
        throw error;
    }
    return result.rows[0];
}

const CURRENT_STANDINGS_QUERY = `
    SELECT
        u.id AS source_user_id,
        u.username AS display_name,
        CASE WHEN s.season_number = 1 THEN COALESCE(u.wins, 0)
             ELSE COALESCE(stats.wins, 0) END AS wins,
        CASE WHEN s.season_number = 1 THEN COALESCE(u.losses, 0)
             ELSE COALESCE(stats.losses, 0) END AS losses,
        CASE WHEN s.season_number = 1 THEN COALESCE(u.washes, 0)
             ELSE COALESCE(stats.washes, 0) END AS washes,
        CASE WHEN s.season_number = 1
             THEN COALESCE(u.wins, 0) + COALESCE(u.losses, 0) + COALESCE(u.washes, 0)
             ELSE COALESCE(stats.wins, 0) + COALESCE(stats.losses, 0) + COALESCE(stats.washes, 0)
        END AS games_played,
        COALESCE(wallet.wallet_tokens, 0) AS wallet_tokens,
        CASE WHEN s.ranking_method = 'wallet_balance'
             THEN COALESCE(wallet.wallet_tokens, 0)
             ELSE COALESCE(game_net.ranking_tokens, 0)
        END AS ranking_tokens,
        CASE WHEN s.ranking_method = 'wallet_balance' THEN TRUE
             ELSE (
                 COALESCE(stats.wins, 0) + COALESCE(stats.losses, 0) + COALESCE(stats.washes, 0)
             ) >= COALESCE((s.rules->>'minimumSettledGames')::integer, 1)
        END AS eligible
    FROM users u
    CROSS JOIN seasons s
    LEFT JOIN season_player_stats stats
      ON stats.season_id = s.season_id AND stats.user_id = u.id
    LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(t.amount), 0) AS wallet_tokens
        FROM transactions t
        WHERE t.user_id = u.id
    ) wallet ON TRUE
    LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(t.amount), 0) AS ranking_tokens
        FROM transactions t
        JOIN game_history game ON game.game_id = t.game_id
        WHERE t.user_id = u.id
          AND game.season_id = s.season_id
          AND t.transaction_type::text = ANY($2::text[])
          AND game.end_time IS NOT NULL
          AND game.outcome LIKE 'Game Over!%'
          AND game.reconciliation_status IS NULL
    ) game_net ON TRUE
    WHERE s.season_id = $1
    ORDER BY eligible DESC, ranking_tokens DESC, u.username ASC
`;

function standingsFromRows(rows) {
    let ranked = 0;
    return rows.map((row, index) => {
        const eligible = row.eligible === true;
        if (eligible) ranked += 1;
        return {
            position: index + 1,
            rank: eligible ? ranked : null,
            sourceUserId: Number(row.source_user_id),
            username: row.display_name,
            wins: Number(row.wins || 0),
            losses: Number(row.losses || 0),
            washes: Number(row.washes || 0),
            gamesPlayed: Number(row.games_played || 0),
            eligible,
            rankingTokens: canonicalMoney(row.ranking_tokens),
            walletTokens: canonicalMoney(row.wallet_tokens),
        };
    });
}

function publicStanding(row) {
    const { sourceUserId, position, ...safe } = row;
    return safe;
}

async function loadCurrentStandings(client, seasonRow) {
    const result = await client.query(CURRENT_STANDINGS_QUERY, [
        Number(seasonRow.season_id),
        CANONICAL_GAME_TRANSACTION_TYPES,
    ]);
    return standingsFromRows(result.rows);
}

async function getCurrentSeason(pool) {
    const client = await pool.connect();
    let open = false;
    try {
        await client.query('BEGIN READ ONLY');
        open = true;
        // Prevent a rollover between the metadata and standings reads. The
        // lock is taken before loadActiveSeason, so a blocked request reads the
        // newly active season after the rollover commits.
        await acquireSeasonReadLock(client);
        const seasonRow = await loadActiveSeason(client);
        const standings = await loadCurrentStandings(client, seasonRow);
        await client.query('COMMIT');
        open = false;
        return {
            season: publicSeason(seasonRow),
            standings: standings.map(publicStanding),
        };
    } catch (error) {
        if (open) await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function listFinalizedSeasons(pool) {
    const result = await pool.query(`
        SELECT s.season_id, s.season_number, s.slug, s.display_name, s.status,
               s.ranking_method, s.rules, s.starts_at, s.ends_at, s.finalized_at,
               s.final_standings_hash, s.final_player_count,
               COALESCE(COUNT(snapshot.position), 0)::integer AS player_count
        FROM seasons s
        LEFT JOIN season_standings_snapshots snapshot ON snapshot.season_id = s.season_id
        WHERE s.status = 'finalized'
        GROUP BY s.season_id
        ORDER BY s.season_number DESC
    `);
    return result.rows.map(row => ({
        ...publicSeason(row),
        playerCount: Number(row.player_count || 0),
    }));
}

async function getFinalizedSeason(pool, identifier) {
    const numericId = /^\d+$/.test(String(identifier)) ? Number(identifier) : null;
    const seasonResult = await pool.query(
        `SELECT season_id, season_number, slug, display_name, status,
                ranking_method, rules, starts_at, ends_at, finalized_at,
                final_standings_hash, final_player_count
         FROM seasons
         WHERE status = 'finalized'
           AND (slug = $1 OR season_id = $2)
         LIMIT 1`,
        [String(identifier), numericId],
    );
    if (!seasonResult.rows.length) return null;
    const seasonRow = seasonResult.rows[0];
    const standings = await loadSnapshotStandings(pool, seasonRow.season_id);
    return {
        season: publicSeason(seasonRow),
        podium: standings.filter(row => row.rank !== null && row.rank <= 3),
        standings,
    };
}

async function loadSnapshotStandings(client, seasonId) {
    const standingsResult = await client.query(
        `SELECT rank, display_name, wins, losses, washes, games_played,
                eligible, ranking_tokens, wallet_tokens
         FROM season_standings_snapshots
         WHERE season_id = $1
         ORDER BY position ASC`,
        [seasonId],
    );
    return standingsResult.rows.map(row => ({
        rank: row.rank === null ? null : Number(row.rank),
        username: row.display_name,
        wins: Number(row.wins),
        losses: Number(row.losses),
        washes: Number(row.washes),
        gamesPlayed: Number(row.games_played),
        eligible: row.eligible === true,
        rankingTokens: canonicalMoney(row.ranking_tokens),
        walletTokens: canonicalMoney(row.wallet_tokens),
    }));
}

function hashPreview(season, standings) {
    const canonical = {
        season: {
            id: Number(season.season_id),
            number: Number(season.season_number),
            slug: season.slug,
            name: season.display_name,
            rankingMethod: season.ranking_method,
            rules: season.rules || {},
        },
        standings: standings.map(row => ({
            position: row.position,
            rank: row.rank,
            sourceUserId: row.sourceUserId,
            username: row.username,
            wins: row.wins,
            losses: row.losses,
            washes: row.washes,
            gamesPlayed: row.gamesPlayed,
            eligible: row.eligible,
            rankingTokens: row.rankingTokens,
            walletTokens: row.walletTokens,
        })),
    };
    return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

async function countInProgressGames(client) {
    const result = await client.query(
        `SELECT COUNT(*)::integer AS count
         FROM game_history
         WHERE outcome = 'In Progress'`,
    );
    return Number(result.rows[0]?.count || 0);
}

function nextSeasonDescription(seasonRow) {
    const number = Number(seasonRow.season_number) + 1;
    return {
        number,
        slug: `alpha-season-${number}`,
        name: `Alpha Season ${number}`,
        rankingMethod: 'game_token_net',
        rules: { minimumSettledGames: 1, ranking: 'game_token_net' },
    };
}

async function previewRollover(pool) {
    const client = await pool.connect();
    let open = false;
    try {
        await client.query('BEGIN READ ONLY');
        open = true;
        await acquireSeasonLock(client);
        const seasonRow = await loadActiveSeason(client);
        const inProgressGames = await countInProgressGames(client);
        const standings = await loadCurrentStandings(client, seasonRow);
        const previewHash = hashPreview(seasonRow, standings);
        await client.query('COMMIT');
        open = false;
        return {
            season: publicSeason(seasonRow),
            standings: standings.map(publicStanding),
            podium: standings.filter(row => row.rank !== null && row.rank <= 3).map(publicStanding),
            nextSeason: nextSeasonDescription(seasonRow),
            inProgressGames,
            canFinalize: inProgressGames === 0,
            previewHash,
        };
    } catch (error) {
        if (open) await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function finalizeRollover(pool, { expectedPreviewHash, expectedSeasonId } = {}) {
    if (!/^[a-f0-9]{64}$/.test(String(expectedPreviewHash || ''))) {
        const error = new TypeError('A valid expectedPreviewHash from rollover preview is required.');
        error.code = 'PREVIEW_HASH_REQUIRED';
        throw error;
    }
    const requestedSeasonId = Number(expectedSeasonId);
    if (!Number.isSafeInteger(requestedSeasonId) || requestedSeasonId <= 0) {
        const error = new TypeError('A positive expectedSeasonId from rollover preview is required.');
        error.code = 'EXPECTED_SEASON_REQUIRED';
        throw error;
    }

    const client = await pool.connect();
    let open = false;
    try {
        await client.query('BEGIN');
        open = true;
        await acquireSeasonLock(client);
        // A retry of an already-committed rollover is a read of immutable
        // history, not a request to finalize today's active season. Resolve it
        // before checking current games so retries remain safe even after play
        // has begun in one or more later seasons.
        const completedResult = await client.query(
            `SELECT season_id, season_number, slug, display_name, status,
                    ranking_method, rules, starts_at, ends_at, finalized_at,
                    final_standings_hash, final_player_count
             FROM seasons
             WHERE season_id = $1
               AND status = 'finalized'
               AND TRIM(final_standings_hash) = $2`,
            [requestedSeasonId, expectedPreviewHash],
        );
        const completed = completedResult.rows[0];
        if (completed) {
            const activeSeason = await loadActiveSeason(client);
            const archivedStandings = await loadSnapshotStandings(client, completed.season_id);
            await client.query('COMMIT');
            open = false;
            return {
                finalizedSeason: publicSeason(completed),
                activeSeason: publicSeason(activeSeason),
                podium: archivedStandings.filter(row => row.rank !== null && row.rank <= 3),
                archivedPlayers: archivedStandings.length,
                previewHash: expectedPreviewHash,
                alreadyFinalized: true,
            };
        }
        // The advisory lock coordinates current deployments. Table locks also
        // wait out, and then block, older deployments that only rely on the
        // season-assignment trigger. Once acquired, the standings and active-
        // game check form one exact database cut through COMMIT.
        // Freeze game creation first. SHARE is compatible with the row-locking
        // read of an in-flight settlement, so we can observe it and fail closed
        // without deadlocking against its later transaction/user writes.
        await client.query('LOCK TABLE game_history IN SHARE MODE');
        const inProgressGames = await countInProgressGames(client);
        if (inProgressGames > 0) {
            throw new SeasonConflictError(
                'GAMES_IN_PROGRESS',
                `Cannot finalize a season while ${inProgressGames} game(s) are in progress.`,
            );
        }
        // With game_history frozen and no active game, no settlement can begin.
        // These locks wait out non-game wallet/stat writes and hold the exact
        // standings cut stable through snapshot and activation.
        await client.query('LOCK TABLE users, transactions, season_player_stats IN SHARE MODE');
        const seasonRow = await loadActiveSeason(client, { forUpdate: true });
        if (requestedSeasonId !== Number(seasonRow.season_id)) {
            throw new SeasonConflictError('SEASON_CHANGED', 'The active season changed after this rollover was previewed.');
        }

        const standings = await loadCurrentStandings(client, seasonRow);
        const actualPreviewHash = hashPreview(seasonRow, standings);
        if (actualPreviewHash !== expectedPreviewHash) {
            throw new SeasonConflictError(
                'PREVIEW_STALE',
                'The standings changed after this rollover was previewed. Preview again before finalizing.',
            );
        }

        for (const row of standings) {
            await client.query(
                `INSERT INTO season_standings_snapshots
                    (season_id, position, rank, source_user_id, display_name,
                     wins, losses, washes, games_played, eligible,
                     ranking_tokens, wallet_tokens)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
                [
                    seasonRow.season_id,
                    row.position,
                    row.rank,
                    row.sourceUserId,
                    row.username,
                    row.wins,
                    row.losses,
                    row.washes,
                    row.gamesPlayed,
                    row.eligible,
                    row.rankingTokens,
                    row.walletTokens,
                ],
            );
        }

        const finalizedResult = await client.query(
            `UPDATE seasons
             SET status = 'finalized',
                 ends_at = CURRENT_TIMESTAMP,
                 finalized_at = CURRENT_TIMESTAMP,
                 final_standings_hash = $2,
                 final_player_count = $3
             WHERE season_id = $1 AND status = 'active'
             RETURNING season_id, season_number, slug, display_name, status,
                       ranking_method, rules, starts_at, ends_at, finalized_at,
                       final_standings_hash, final_player_count`,
            [seasonRow.season_id, actualPreviewHash, standings.length],
        );
        if (finalizedResult.rowCount !== 1) {
            throw new SeasonConflictError('SEASON_CHANGED', 'The active season changed during rollover.');
        }

        const next = nextSeasonDescription(seasonRow);
        const nextResult = await client.query(
            `INSERT INTO seasons
                (season_number, slug, display_name, status, ranking_method, rules, starts_at)
             VALUES ($1, $2, $3, 'active', $4, $5::jsonb, CURRENT_TIMESTAMP)
             RETURNING season_id, season_number, slug, display_name, status,
                       ranking_method, rules, starts_at, ends_at, finalized_at`,
            [next.number, next.slug, next.name, next.rankingMethod, JSON.stringify(next.rules)],
        );
        await client.query(
            `INSERT INTO season_player_stats (season_id, user_id, wins, losses, washes)
             SELECT $1, id, 0, 0, 0 FROM users`,
            [nextResult.rows[0].season_id],
        );

        await client.query('COMMIT');
        open = false;
        return {
            finalizedSeason: publicSeason(finalizedResult.rows[0]),
            activeSeason: publicSeason(nextResult.rows[0]),
            podium: standings.filter(row => row.rank !== null && row.rank <= 3).map(publicStanding),
            archivedPlayers: standings.length,
            previewHash: actualPreviewHash,
        };
    } catch (error) {
        if (open) await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

module.exports = {
    CANONICAL_GAME_TRANSACTION_TYPES,
    CURRENT_STANDINGS_QUERY,
    SEASON_ROLLOVER_LOCK_ID,
    SeasonConflictError,
    acquireSeasonLock,
    acquireSeasonReadLock,
    canonicalMoney,
    finalizeRollover,
    getCurrentSeason,
    getFinalizedSeason,
    hashPreview,
    listFinalizedSeasons,
    loadSnapshotStandings,
    loadActiveSeason,
    loadCurrentStandings,
    previewRollover,
    publicSeason,
};
