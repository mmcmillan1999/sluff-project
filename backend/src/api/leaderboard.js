const express = require('express');
const requireAuth = require('../middleware/requireAuth');

// This function will be called from server.js with the db (pool) and JWT implementation.
module.exports = function(pool, jwt) {
    const router = express.Router();

    router.get('/', requireAuth(jwt), async (req, res) => {
        try {
            const query = `
                SELECT 
                    u.username, 
                    u.wins, 
                    u.losses, 
                    u.washes,
                    COALESCE(SUM(t.amount), 0) as tokens
                FROM 
                    users u
                LEFT JOIN 
                    transactions t ON u.id = t.user_id
                GROUP BY 
                    u.id, u.username, u.wins, u.losses, u.washes
                ORDER BY 
                    tokens DESC, u.username ASC;
            `;
            const { rows } = await pool.query(query);
            const publicLeaderboard = rows.map(({ username, wins, losses, washes, tokens }) => ({
                username,
                wins,
                losses,
                washes,
                tokens,
            }));

            res.json(publicLeaderboard);
        } catch (error) {
            console.error("Error fetching leaderboard data:", error);
            res.status(500).json({ message: "Internal server error" });
        }
    });

    return router;
};
