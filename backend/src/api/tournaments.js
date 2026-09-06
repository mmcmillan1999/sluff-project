'use strict';

// The tournament record (the Sluff Tournament whiteboard, Sept 2026).
//
// A tournament is much harder to win than a game, so it never feeds the
// season's wins, losses and washes. Every entry writes a tournament_results
// row (place, field, buy-in, prize), and from those rows come two things:
// the tournament scoreboard, ranked by winnings — the sum of prizes, wins
// only, never reduced by a buy-in or a loss — and the list of recent events
// with their podiums. Because every place is stored, the ranking can be
// retuned later without touching the data.

const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const { loadActiveSeason } = require('../services/seasonService');

const SCOREBOARD_QUERY = `
    SELECT
        u.id AS user_id,
        u.username,
        COALESCE(SUM(r.prize_cents), 0)::bigint AS winnings_cents,
        COUNT(*)::integer AS played,
        COUNT(*) FILTER (WHERE r.place <= 3)::integer AS podiums,
        COUNT(*) FILTER (WHERE r.place = 1)::integer AS wins,
        MIN(r.place)::integer AS best_place
    FROM tournament_results r
    JOIN users u ON u.id = r.user_id
    WHERE r.season_id = $1
    GROUP BY u.id, u.username
    ORDER BY winnings_cents DESC, wins DESC, podiums DESC, played DESC, u.username ASC
`;

const RECENT_TOURNAMENTS_QUERY = `
    SELECT
        t.tournament_id,
        t.name,
        t.venue,
        t.buy_in_cents,
        t.starting_stack,
        t.current_round,
        t.ended_at,
        (SELECT COUNT(*) FROM tournament_results r WHERE r.tournament_id = t.tournament_id)::integer AS field_size,
        COALESCE((
            SELECT json_agg(json_build_object('place', r.place, 'username', u.username, 'prizeCents', r.prize_cents) ORDER BY r.place, u.username)
            FROM tournament_results r
            JOIN users u ON u.id = r.user_id
            WHERE r.tournament_id = t.tournament_id AND r.place <= 3
        ), '[]'::json) AS podium
    FROM tournaments t
    WHERE t.season_id = $1 AND t.status = 'complete'
    ORDER BY t.ended_at DESC NULLS LAST, t.tournament_id DESC
    LIMIT $2
`;

const SEASON_BY_KEY_QUERY = `
    SELECT season_id, season_number, slug, display_name
    FROM seasons
    WHERE slug = $1 OR season_id::text = $1
    LIMIT 1
`;

const MAX_RECENT = 50;
const DEFAULT_RECENT = 10;

function tokens(cents) {
    return (Number(cents || 0) / 100).toFixed(2);
}

function publicSeason(row) {
    return {
        id: Number(row.season_id),
        number: Number(row.season_number),
        slug: row.slug,
        displayName: row.display_name,
    };
}

// Rank by winnings; players level on winnings, wins and podiums share a rank.
function rankRows(rows) {
    let rank = 0;
    let previousKey = null;
    return rows.map((row, index) => {
        const key = `${row.winnings_cents}|${row.wins}|${row.podiums}`;
        if (key !== previousKey) {
            rank = index + 1;
            previousKey = key;
        }
        return {
            rank,
            username: row.username,
            winningsTokens: tokens(row.winnings_cents),
            played: Number(row.played) || 0,
            podiums: Number(row.podiums) || 0,
            wins: Number(row.wins) || 0,
            bestPlace: row.best_place == null ? null : Number(row.best_place),
        };
    });
}

function publicTournament(row) {
    const podium = (typeof row.podium === 'string' ? JSON.parse(row.podium) : row.podium) || [];
    return {
        id: Number(row.tournament_id),
        name: row.name,
        venue: row.venue,
        buyInTokens: tokens(row.buy_in_cents),
        startingStack: Number(row.starting_stack),
        rounds: Number(row.current_round) || 0,
        fieldSize: Number(row.field_size) || 0,
        endedAt: row.ended_at ?? null,
        podium: podium.map(entry => ({
            place: Number(entry.place),
            username: entry.username,
            prizeTokens: tokens(entry.prizeCents),
        })),
    };
}

function seasonKey(query) {
    const raw = query?.season;
    if (raw === undefined || raw === '' || raw === null) return null;
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,60}$/.test(value)) {
        const error = new TypeError('season must be a season slug or id.');
        error.statusCode = 400;
        throw error;
    }
    return value;
}

async function resolveSeason(pool, query) {
    const key = seasonKey(query);
    if (key === null) return publicSeason(await loadActiveSeason(pool));
    const { rows } = await pool.query(SEASON_BY_KEY_QUERY, [key]);
    if (!rows || rows.length !== 1) {
        const error = new Error('Season not found.');
        error.statusCode = 404;
        throw error;
    }
    return publicSeason(rows[0]);
}

function failure(res, error, fallback) {
    if (error?.statusCode) return res.status(error.statusCode).json({ message: error.message });
    console.error(fallback, error);
    return res.status(500).json({ message: fallback });
}

module.exports = function createTournamentRoutes(pool, jwt) {
    const router = express.Router();
    const checkAuth = requireAuth(pool, jwt);

    router.get('/scoreboard', checkAuth, async (req, res) => {
        res.set('Cache-Control', 'private, no-store');
        try {
            const season = await resolveSeason(pool, req.query);
            const { rows } = await pool.query(SCOREBOARD_QUERY, [season.id]);
            return res.json({ season, rows: rankRows(rows || []) });
        } catch (error) {
            return failure(res, error, 'Unable to load the tournament scoreboard.');
        }
    });

    router.get('/recent', checkAuth, async (req, res) => {
        res.set('Cache-Control', 'private, no-store');
        try {
            const rawLimit = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
            const limit = rawLimit === undefined || rawLimit === '' ? DEFAULT_RECENT : Number(rawLimit);
            if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_RECENT) {
                return res.status(400).json({ message: `limit must be an integer from 1 through ${MAX_RECENT}.` });
            }
            const season = await resolveSeason(pool, req.query);
            const { rows } = await pool.query(RECENT_TOURNAMENTS_QUERY, [season.id, limit]);
            return res.json({ season, tournaments: (rows || []).map(publicTournament) });
        } catch (error) {
            return failure(res, error, 'Unable to load recent tournaments.');
        }
    });

    return router;
};

module.exports.SCOREBOARD_QUERY = SCOREBOARD_QUERY;
module.exports.RECENT_TOURNAMENTS_QUERY = RECENT_TOURNAMENTS_QUERY;
module.exports.SEASON_BY_KEY_QUERY = SEASON_BY_KEY_QUERY;
module.exports.rankRows = rankRows;
module.exports.publicTournament = publicTournament;
