// backend/src/api/errors.js
//
// First-party crash reports. Until now a crash on a player's phone was
// invisible: the only diagnostics were a React ErrorBoundary (which the player
// sees and we never do) and Render's server logs, which say nothing about the
// client. This is the smallest thing that fixes that — no SDK, no tracking, no
// identity: message, stack, URL, build, user agent. Deliberately NOT the
// account id, so the privacy label's "not linked to identity" stays true.
//
// The endpoint is public because crashes do not wait for login. That makes it
// a spam target, so everything about it is bounded: field sizes are truncated
// server-side, requests are rate limited, invalid bodies get the same 204 as
// valid ones (nothing to probe), and the table is trimmed at boot.

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const requireAuth = require('../middleware/requireAuth');

const LIMITS = {
    message: 500,
    stack: 4000,
    url: 300,
    buildId: 64,
    userAgent: 300,
};

const reportLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many reports.' },
});

const clip = (value, max) => (typeof value === 'string' ? value.slice(0, max) : null);

const createErrorRoutes = (pool, jwt) => {
    const router = express.Router();
    const checkAuth = requireAuth(pool, jwt);

    const isAdmin = (req, res, next) => {
        if (req.user?.is_admin === true) return next();
        return res.status(403).send('Access Forbidden: Requires admin privileges.');
    };

    // POST /api/errors — public, anonymous, fire-and-forget.
    router.post('/', reportLimiter, async (req, res) => {
        try {
            const message = clip(req.body?.message, LIMITS.message);
            if (!message || !message.trim()) return res.status(204).end();

            await pool.query(
                `INSERT INTO client_errors (message, stack, url, build_id, user_agent)
                 VALUES ($1, $2, $3, $4, $5)`,
                [
                    message.trim(),
                    clip(req.body?.stack, LIMITS.stack),
                    clip(req.body?.url, LIMITS.url),
                    clip(req.body?.buildId, LIMITS.buildId),
                    clip(req.get('user-agent'), LIMITS.userAgent),
                ],
            );
            return res.status(204).end();
        } catch (error) {
            // Crash reporting must never cause a second failure on a client
            // that is already broken.
            console.error('Client error insert failed:', error.message);
            return res.status(204).end();
        }
    });

    // GET /api/errors — admin-only review queue, newest first.
    router.get('/', checkAuth, isAdmin, async (req, res) => {
        try {
            const { rows } = await pool.query(
                `SELECT id, created_at, message, stack, url, build_id, user_agent
                 FROM client_errors ORDER BY id DESC LIMIT 100`,
            );
            res.set('Cache-Control', 'private, no-store');
            return res.json({ errors: rows });
        } catch (error) {
            console.error('Client error list failed:', error.message);
            return res.status(500).json({ message: 'Internal Server Error' });
        }
    });

    return router;
};

module.exports = createErrorRoutes;
module.exports.LIMITS = LIMITS;
