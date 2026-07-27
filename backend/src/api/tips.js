// backend/src/api/tips.js
// Quick-tips read receipts for the in-game "i" beacon. The tip catalogue
// (ids, copy, interactive widgets) lives in the frontend registry; this API
// only tracks which tip ids the authenticated user has dismissed so the
// unseen count follows them across devices.

const express = require('express');
const requireAuth = require('../middleware/requireAuth');

// Matches the frontend registry convention: kebab-case slug, optionally
// suffixed with a YYYY-MM stamp (e.g. 'fast-play-style-2026-07').
const TIP_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

// Hard bound on rows per account. Ids are client-supplied (the registry
// lives in the frontend, deliberately — no deploy coupling), so without a
// cap one hostile account could script unlimited distinct ids into the
// table. Far above any plausible real tip count.
const MAX_SEEN_TIPS_PER_USER = 200;

const createTipsRoutes = (pool, jwt) => {
    const router = express.Router();
    const checkAuth = requireAuth(pool, jwt);

    // GET /api/tips/seen - tip ids this user has already dismissed.
    router.get('/seen', checkAuth, async (req, res) => {
        try {
            const { rows } = await pool.query(
                'SELECT tip_id FROM user_tips_seen WHERE user_id = $1',
                [req.user.id]
            );
            res.json({ seenTipIds: rows.map(row => row.tip_id) });
        } catch (error) {
            console.error('Error fetching seen tips:', error);
            res.status(500).json({ message: 'Unable to load tip history.' });
        }
    });

    // POST /api/tips/seen - mark one tip dismissed. Idempotent: re-marking
    // an already-seen tip succeeds without complaint.
    router.post('/seen', checkAuth, async (req, res) => {
        const tipId = req.body?.tipId;
        if (typeof tipId !== 'string' || !TIP_ID_PATTERN.test(tipId)) {
            return res.status(400).json({ message: 'A valid tipId is required.' });
        }

        try {
            await pool.query(
                `INSERT INTO user_tips_seen (user_id, tip_id)
                 SELECT $1, $2
                 WHERE (SELECT COUNT(*) FROM user_tips_seen WHERE user_id = $1) < $3
                 ON CONFLICT (user_id, tip_id) DO NOTHING`,
                [req.user.id, tipId, MAX_SEEN_TIPS_PER_USER]
            );
            res.status(201).json({ tipId });
        } catch (error) {
            console.error('Error marking tip seen:', error);
            res.status(500).json({ message: 'Unable to save tip history.' });
        }
    });

    return router;
};

module.exports = createTipsRoutes;
module.exports.TIP_ID_PATTERN = TIP_ID_PATTERN;
module.exports.MAX_SEEN_TIPS_PER_USER = MAX_SEEN_TIPS_PER_USER;
