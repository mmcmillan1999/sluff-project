// backend/src/api/metrics.js
// First-party funnel metrics: anonymous, cookieless counters for the
// landing -> register -> signup funnel. No third-party analytics involved.

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const requireAuth = require('../middleware/requireAuth');

// Only these event names are accepted; anything else is dropped.
const ALLOWED_EVENTS = new Set([
    'landing_view',
    'landing_cta_click',
    'register_view',
    'signup',
]);

const eventLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many events.' },
});

const createMetricsRoutes = (pool, jwt) => {
    const router = express.Router();
    const checkAuth = requireAuth(pool, jwt);

    const isAdmin = (req, res, next) => {
        if (req.user?.is_admin === true) return next();
        return res.status(403).send('Access Forbidden: Requires admin privileges.');
    };

    // POST /api/metrics/event — public, anonymous, fire-and-forget.
    router.post('/event', eventLimiter, async (req, res) => {
        try {
            const { name, sessionId } = req.body || {};
            if (!ALLOWED_EVENTS.has(name)) {
                return res.status(204).end();
            }
            const session = typeof sessionId === 'string' ? sessionId.slice(0, 64) : null;
            await pool.query(
                'INSERT INTO funnel_events (name, session_id) VALUES ($1, $2)',
                [name, session],
            );
            return res.status(204).end();
        } catch (error) {
            // Metrics must never break the product; swallow and report success.
            console.error('Funnel event insert failed:', error.message);
            return res.status(204).end();
        }
    });

    // GET /api/metrics/funnel?days=30 — admin-only daily funnel summary.
    router.get('/funnel', checkAuth, isAdmin, async (req, res) => {
        try {
            const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 90);
            const eventsResult = await pool.query(
                `SELECT name,
                        DATE_TRUNC('day', created_at) AS day,
                        COUNT(*) AS events,
                        COUNT(DISTINCT session_id) AS sessions
                 FROM funnel_events
                 WHERE created_at > NOW() - ($1 || ' days')::interval
                 GROUP BY name, DATE_TRUNC('day', created_at)
                 ORDER BY day DESC, name`,
                [days],
            );
            const accountsResult = await pool.query(
                `SELECT DATE_TRUNC('day', created_at) AS day,
                        COUNT(*) AS signups,
                        COUNT(*) FILTER (WHERE is_verified) AS verified
                 FROM users
                 WHERE created_at > NOW() - ($1 || ' days')::interval
                   AND COALESCE(is_bot, FALSE) = FALSE
                 GROUP BY DATE_TRUNC('day', created_at)
                 ORDER BY day DESC`,
                [days],
            );
            return res.json({
                days,
                events: eventsResult.rows,
                accounts: accountsResult.rows,
            });
        } catch (error) {
            console.error('Funnel summary failed:', error);
            return res.status(500).json({ message: 'Unable to build funnel summary.' });
        }
    });

    return router;
};

module.exports = createMetricsRoutes;
