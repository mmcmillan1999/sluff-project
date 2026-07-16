const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const { CANONICAL_GAME_TRANSACTION_TYPES, canonicalMoney } = require('../services/seasonService');

// This function will be called from server.js with the db (pool) and JWT implementation.
module.exports = function(pool, jwt) {
    const router = express.Router();

    router.get('/', requireAuth(pool, jwt), async (req, res) => {
        try {
            const query = `
                SELECT
                    u.username,
                    CASE WHEN s.season_number = 1 THEN COALESCE(u.wins, 0)
                         ELSE COALESCE(stats.wins, 0) END AS wins,
                    CASE WHEN s.season_number = 1 THEN COALESCE(u.losses, 0)
                         ELSE COALESCE(stats.losses, 0) END AS losses,
                    CASE WHEN s.season_number = 1 THEN COALESCE(u.washes, 0)
                         ELSE COALESCE(stats.washes, 0) END AS washes,
                    COALESCE(wallet.wallet_tokens, 0) AS wallet_tokens,
                    CASE WHEN s.ranking_method = 'wallet_balance'
                         THEN COALESCE(wallet.wallet_tokens, 0)
                         ELSE COALESCE(game_net.ranking_tokens, 0)
                    END AS ranking_tokens,
                    CASE WHEN s.ranking_method = 'wallet_balance'
                         THEN COALESCE(wallet.wallet_tokens, 0)
                         ELSE COALESCE(game_net.ranking_tokens, 0)
                    END AS tokens,
                    s.season_number,
                    s.ranking_method,
                    CASE WHEN s.ranking_method = 'wallet_balance' THEN TRUE
                         ELSE (
                             COALESCE(stats.wins, 0) + COALESCE(stats.losses, 0)
                             + COALESCE(stats.washes, 0)
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
                      AND t.transaction_type::text = ANY($1::text[])
                      AND game.end_time IS NOT NULL
                      AND game.outcome LIKE 'Game Over!%'
                      AND game.reconciliation_status IS NULL
                ) game_net ON TRUE
                WHERE s.status = 'active'
                ORDER BY eligible DESC, ranking_tokens DESC, u.username ASC;
            `;
            const { rows } = await pool.query(query, [CANONICAL_GAME_TRANSACTION_TYPES]);
            let rank = 0;
            const publicLeaderboard = rows.map((row) => {
                const seasonNumber = Number(row.season_number || 1);
                if (seasonNumber === 1) {
                    return {
                        username: row.username,
                        wins: row.wins,
                        losses: row.losses,
                        washes: row.washes,
                        // Keep the pre-season endpoint byte-shape/value format
                        // unchanged throughout the Alpha 1 rolling deploy.
                        tokens: row.wallet_tokens ?? row.tokens ?? '0',
                    };
                }

                const eligible = row.eligible === true;
                if (eligible) rank += 1;
                const rankingTokens = canonicalMoney(row.ranking_tokens);
                const walletTokens = canonicalMoney(row.wallet_tokens ?? row.tokens);
                return {
                    username: row.username,
                    wins: row.wins,
                    losses: row.losses,
                    washes: row.washes,
                    tokens: rankingTokens,
                    rank: eligible ? rank : null,
                    rankingTokens,
                    walletTokens,
                };
            });

            res.json(publicLeaderboard);
        } catch (error) {
            console.error("Error fetching leaderboard data:", error);
            res.status(500).json({ message: "Internal server error" });
        }
    });

    return router;
};
