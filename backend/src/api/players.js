'use strict';

const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const {
    acquireSeasonReadLock,
    loadActiveSeason,
} = require('../services/seasonService');

const PUBLIC_PROFILE_QUERY = `
    SELECT
        u.id,
        u.username,
        u.wins,
        u.losses,
        u.washes,
        COALESCE(SUM(t.amount), 0) AS tokens
    FROM users u
    LEFT JOIN transactions t ON t.user_id = u.id
    WHERE u.username = $1
    GROUP BY u.id, u.username, u.wins, u.losses, u.washes
`;

// Per-season records live in season_player_stats from season 2 onward; the
// leaderboard treats season 1 as the lifetime users counters, and the profile
// endpoint mirrors that fallback so the two surfaces never disagree.
const CURRENT_SEASON_RECORD_QUERY = `
    SELECT
        COALESCE(wins, 0) AS wins,
        COALESCE(losses, 0) AS losses,
        COALESCE(washes, 0) AS washes
    FROM season_player_stats
    WHERE season_id = $1 AND user_id = $2
`;

// Game participants were historically recorded through their buy-in ledger
// entries rather than in a separate roster table. Comparing canonical gameplay
// returns preserves that history without parsing player names out of outcomes.
// Only fully settled Game Over rows count; crash recoveries and manual-review
// games are intentionally excluded from social stats.
const HEAD_TO_HEAD_QUERY = `
    WITH per_player_game AS (
        SELECT
            ledger.game_id,
            ledger.user_id,
            game.season_id,
            game.outcome AS game_outcome,
            (SUM(ledger.amount) * 100)::bigint AS game_net_cents,
            BOOL_OR(ledger.transaction_type::text = 'forfeit_payout') AS received_forfeit_payout
        FROM transactions ledger
        JOIN game_history game ON game.game_id = ledger.game_id
        WHERE ledger.user_id = ANY($1::int[])
          AND ledger.transaction_type::text IN (
              'buy_in', 'win_payout', 'wash_payout', 'forfeit_payout'
          )
          AND game.end_time IS NOT NULL
          AND game.outcome LIKE 'Game Over!%'
          AND game.reconciliation_status IS NULL
        GROUP BY ledger.game_id, ledger.user_id, game.season_id, game.outcome
        HAVING COUNT(*) FILTER (
            WHERE ledger.transaction_type::text = 'buy_in'
        ) = 1
           AND COUNT(*) FILTER (
               WHERE ledger.transaction_type::text = 'buy_in'
                 AND ledger.amount < 0
           ) = 1
           AND COUNT(*) FILTER (
               WHERE ledger.transaction_type::text IN (
                   'win_payout', 'wash_payout', 'forfeit_payout'
               )
           ) <= 1
           AND COUNT(*) FILTER (
               WHERE ledger.transaction_type::text IN (
                   'win_payout', 'wash_payout', 'forfeit_payout'
               )
                 AND ledger.amount <= 0
           ) = 0
    ), shared_games AS (
        SELECT
            game_id,
            MAX(season_id) AS season_id,
            MAX(game_outcome) AS game_outcome,
            MAX(game_net_cents) FILTER (WHERE user_id = $2) AS requester_net_cents,
            MAX(game_net_cents) FILTER (WHERE user_id = $3) AS target_net_cents,
            BOOL_OR(received_forfeit_payout) FILTER (
                WHERE user_id = $2
            ) AS requester_received_forfeit_payout,
            BOOL_OR(received_forfeit_payout) FILTER (
                WHERE user_id = $3
            ) AS target_received_forfeit_payout
        FROM per_player_game
        GROUP BY game_id
        HAVING COUNT(*) = 2
           AND COUNT(*) FILTER (WHERE user_id = $2) = 1
           AND COUNT(*) FILTER (WHERE user_id = $3) = 1
    ), comparisons AS (
        SELECT
            game_id,
            season_id,
            CASE
                WHEN game_outcome LIKE 'Game Over! Draw (%' THEN 0
                WHEN requester_received_forfeit_payout
                 AND target_received_forfeit_payout THEN 0
                WHEN requester_received_forfeit_payout THEN 1
                WHEN target_received_forfeit_payout THEN -1
                WHEN requester_net_cents > target_net_cents + 1 THEN 1
                WHEN requester_net_cents < target_net_cents - 1 THEN -1
                ELSE 0
            END AS result
        FROM shared_games
    )
    SELECT
        COUNT(*)::integer AS games_played,
        COUNT(*) FILTER (WHERE result = 1)::integer AS wins,
        COUNT(*) FILTER (WHERE result = -1)::integer AS losses,
        COUNT(*) FILTER (WHERE result = 0)::integer AS ties,
        COUNT(*) FILTER (WHERE season_id = $4)::integer AS current_season_games_played,
        COUNT(*) FILTER (WHERE season_id = $4 AND result = 1)::integer AS current_season_wins,
        COUNT(*) FILTER (WHERE season_id = $4 AND result = -1)::integer AS current_season_losses,
        COUNT(*) FILTER (WHERE season_id = $4 AND result = 0)::integer AS current_season_ties
    FROM comparisons
`;

function nonnegativeInteger(value, fieldName) {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
        throw new RangeError(`Database returned an invalid ${fieldName}.`);
    }
    return parsed;
}

function percentage(numerator, denominator) {
    if (denominator === 0) return null;
    return Number(((numerator / denominator) * 100).toFixed(1));
}

function publicProfile(row) {
    const wins = nonnegativeInteger(row.wins, 'win count');
    const losses = nonnegativeInteger(row.losses, 'loss count');
    const washes = nonnegativeInteger(row.washes, 'wash count');
    const totalGames = wins + losses + washes;
    const tokenAmount = Number(row.tokens ?? 0);
    if (!Number.isFinite(tokenAmount)) {
        throw new RangeError('Database returned an invalid token balance.');
    }

    return {
        username: row.username,
        wins,
        losses,
        washes,
        totalGames,
        winRate: percentage(wins, totalGames),
        tokens: tokenAmount.toFixed(2),
    };
}

function publicHeadToHead(row, isSelf = false) {
    if (isSelf) {
        return {
            isSelf: true,
            gamesPlayed: 0,
            wins: 0,
            losses: 0,
            ties: 0,
            winRate: null,
        };
    }

    const gamesPlayed = nonnegativeInteger(row?.games_played ?? 0, 'head-to-head game count');
    const wins = nonnegativeInteger(row?.wins ?? 0, 'head-to-head win count');
    const losses = nonnegativeInteger(row?.losses ?? 0, 'head-to-head loss count');
    const ties = nonnegativeInteger(row?.ties ?? 0, 'head-to-head tie count');
    if (wins + losses + ties !== gamesPlayed) {
        throw new RangeError('Database returned inconsistent head-to-head counts.');
    }

    return {
        isSelf: false,
        gamesPlayed,
        wins,
        losses,
        ties,
        winRate: percentage(wins, gamesPlayed),
    };
}

function publicCurrentSeasonHeadToHead(row, seasonRow, isSelf = false) {
    const seasonId = nonnegativeInteger(seasonRow?.season_id, 'season id');
    const seasonNumber = nonnegativeInteger(seasonRow?.season_number, 'season number');
    if (seasonId === 0 || seasonNumber === 0) {
        throw new RangeError('Database returned an invalid active season.');
    }

    const record = isSelf
        ? publicHeadToHead(null, true)
        : publicHeadToHead({
            games_played: row?.current_season_games_played,
            wins: row?.current_season_wins,
            losses: row?.current_season_losses,
            ties: row?.current_season_ties,
        });
    if (!isSelf) {
        const lifetime = publicHeadToHead(row);
        if (record.gamesPlayed > lifetime.gamesPlayed
            || record.wins > lifetime.wins
            || record.losses > lifetime.losses
            || record.ties > lifetime.ties) {
            throw new RangeError('Current-season head-to-head counts exceed lifetime counts.');
        }
    }

    return {
        season: {
            id: seasonId,
            number: seasonNumber,
            slug: seasonRow.slug,
            displayName: seasonRow.display_name,
        },
        ...record,
    };
}

function publicCurrentSeasonRecord(seasonRow, statsRow) {
    const seasonId = nonnegativeInteger(seasonRow?.season_id, 'season id');
    const seasonNumber = nonnegativeInteger(seasonRow?.season_number, 'season number');
    if (seasonId === 0 || seasonNumber === 0) {
        throw new RangeError('Database returned an invalid active season.');
    }

    const wins = nonnegativeInteger(statsRow?.wins ?? 0, 'season win count');
    const losses = nonnegativeInteger(statsRow?.losses ?? 0, 'season loss count');
    const washes = nonnegativeInteger(statsRow?.washes ?? 0, 'season wash count');
    const totalGames = wins + losses + washes;

    return {
        season: {
            id: seasonId,
            number: seasonNumber,
            slug: seasonRow.slug,
            displayName: seasonRow.display_name,
        },
        wins,
        losses,
        washes,
        totalGames,
        winRate: percentage(wins, totalGames),
    };
}

module.exports = function createPlayerRoutes(pool, jwt) {
    const router = express.Router();
    const checkAuth = requireAuth(pool, jwt);

    router.get('/:username/profile', checkAuth, async (req, res) => {
        res.set('Cache-Control', 'private, no-store');
        let client;
        let transactionOpen = false;
        try {
            client = await pool.connect();
            await client.query('BEGIN READ ONLY');
            transactionOpen = true;
            // Keep the active-season label and its filtered comparison stable
            // if an administrator rolls the season over during this request.
            await acquireSeasonReadLock(client);

            const profileResult = await client.query(PUBLIC_PROFILE_QUERY, [req.params.username]);
            const target = profileResult.rows?.[0];
            if (!target) {
                await client.query('COMMIT');
                transactionOpen = false;
                return res.status(404).json({ message: 'Player not found.' });
            }

            const isSelf = Number(target.id) === Number(req.user.id);
            const activeSeason = await loadActiveSeason(client);

            // Season 1 predates season_player_stats; its "season" record is the
            // lifetime counters, exactly as the leaderboard reports it.
            let seasonStatsRow = target;
            if (Number(activeSeason.season_number) !== 1) {
                const seasonStatsResult = await client.query(
                    CURRENT_SEASON_RECORD_QUERY,
                    [activeSeason.season_id, target.id],
                );
                seasonStatsRow = seasonStatsResult.rows?.[0] ?? null;
            }
            const currentSeasonRecord = publicCurrentSeasonRecord(activeSeason, seasonStatsRow);

            let headToHead = publicHeadToHead(null, true);
            let currentSeasonHeadToHead = publicCurrentSeasonHeadToHead(null, activeSeason, true);
            if (!isSelf) {
                const recordResult = await client.query(
                    HEAD_TO_HEAD_QUERY,
                    [[req.user.id, target.id], req.user.id, target.id, activeSeason.season_id],
                );
                headToHead = publicHeadToHead(recordResult.rows?.[0]);
                currentSeasonHeadToHead = publicCurrentSeasonHeadToHead(
                    recordResult.rows?.[0],
                    activeSeason,
                );
            }

            await client.query('COMMIT');
            transactionOpen = false;

            return res.json({
                player: publicProfile(target),
                currentSeasonRecord,
                headToHead,
                currentSeasonHeadToHead,
            });
        } catch (error) {
            if (transactionOpen) {
                try {
                    await client.query('ROLLBACK');
                } catch (rollbackError) {
                    console.error('Player-profile rollback error:', rollbackError);
                }
            }
            console.error('Player-profile load error:', error);
            return res.status(500).json({ message: 'Unable to load player profile.' });
        } finally {
            client?.release();
        }
    });

    return router;
};

module.exports.CURRENT_SEASON_RECORD_QUERY = CURRENT_SEASON_RECORD_QUERY;
module.exports.HEAD_TO_HEAD_QUERY = HEAD_TO_HEAD_QUERY;
module.exports.PUBLIC_PROFILE_QUERY = PUBLIC_PROFILE_QUERY;
module.exports.nonnegativeInteger = nonnegativeInteger;
module.exports.percentage = percentage;
module.exports.publicCurrentSeasonHeadToHead = publicCurrentSeasonHeadToHead;
module.exports.publicCurrentSeasonRecord = publicCurrentSeasonRecord;
module.exports.publicHeadToHead = publicHeadToHead;
module.exports.publicProfile = publicProfile;
