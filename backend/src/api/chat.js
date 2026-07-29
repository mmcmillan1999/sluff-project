// backend/src/api/chat.js
//
// Lobby chat, with the moderation App Store guideline 1.2 requires of any app
// carrying user-generated content: messages are filtered on the way in, any
// player can report a message or block its author, and an admin can hide a
// message or mute an account.

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const requireAuth = require('../middleware/requireAuth');
const { reviewMessage } = require('../data/chatModeration');

const REPORT_REASONS = new Set(['abuse', 'harassment', 'spam', 'cheating', 'other']);

// Keyed by account, not IP. Mobile carriers put thousands of subscribers behind
// one CGNAT address, and on a mobile-first game an IP-keyed cap lets one chatty
// player silence a whole carrier block. These run after checkAuth, so req.user
// is always present.
// Never falls back to req.ip: express-rate-limit rightly warns that a raw IP
// key lets IPv6 clients hop addresses to reset their bucket, and checkAuth has
// already guaranteed req.user. An id-less request shares one conservative
// bucket rather than getting a free pass.
const byUser = (req) => (req.user?.id != null ? `u:${req.user.id}` : 'anonymous');

const limiterDefaults = {
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: byUser,
};

// Chat is the one authenticated write a bored player can hold down. The cap is
// generous for conversation and useless for flooding.
const postLimiter = rateLimit({
    ...limiterDefaults,
    windowMs: 60 * 1000,
    limit: 20,
    message: { message: 'You are sending messages too quickly. Wait a moment.' },
});

// Report and block are cheap per call but unbounded without this, and each
// still costs an auth round trip plus a write.
const moderationLimiter = rateLimit({
    ...limiterDefaults,
    windowMs: 60 * 1000,
    limit: 30,
    message: { message: 'Too many requests. Wait a moment and try again.' },
});

const createChatRoutes = (pool, io, jwt) => {
    const router = express.Router();
    const checkAuth = requireAuth(pool, jwt);

    // GET /api/chat - recent messages, minus hidden ones and anyone the
    // caller has blocked. Blocking is applied server-side here and again on
    // the client for live broadcasts, which go out to everyone at once.
    router.get('/', checkAuth, async (req, res) => {
        try {
            const requested = parseInt(req.query.limit, 10);
            const limit = Number.isInteger(requested) && requested > 0
                ? Math.min(requested, 200)
                : 50;
            const query = `
                SELECT id, user_id, username, message, created_at
                FROM (
                    SELECT m.id, m.user_id, m.username, m.message, m.created_at
                    FROM lobby_chat_messages m
                    WHERE m.hidden = FALSE
                      AND NOT EXISTS (
                          SELECT 1 FROM chat_blocks b
                          WHERE b.blocker_user_id = $2
                            AND b.blocked_user_id = m.user_id
                      )
                    ORDER BY m.created_at DESC
                    LIMIT $1
                ) AS recent_messages
                ORDER BY created_at ASC;
            `;
            const { rows } = await pool.query(query, [limit, req.user.id]);
            res.json(rows);
        } catch (error) {
            console.error('Failed to fetch chat history:', error);
            res.status(500).json({ message: 'Internal Server Error' });
        }
    });

    // GET /api/chat/blocks - the caller's own block list, so the client can
    // filter live broadcasts without a round trip per message.
    router.get('/blocks', checkAuth, async (req, res) => {
        try {
            const { rows } = await pool.query(
                `SELECT b.blocked_user_id AS user_id, u.username
                 FROM chat_blocks b
                 LEFT JOIN users u ON u.id = b.blocked_user_id
                 WHERE b.blocker_user_id = $1
                 ORDER BY b.created_at DESC`,
                [req.user.id],
            );
            res.set('Cache-Control', 'private, no-store');
            res.json(rows);
        } catch (error) {
            console.error('Failed to fetch block list:', error);
            res.status(500).json({ message: 'Internal Server Error' });
        }
    });

    router.post('/', checkAuth, postLimiter, async (req, res) => {
        const { id: userId, username } = req.user;

        const review = reviewMessage(req.body?.message);
        if (!review.ok) {
            return res.status(400).json({ message: review.reason });
        }

        try {
            const muteCheck = await pool.query(
                'SELECT chat_muted_until FROM users WHERE id = $1',
                [userId],
            );
            const mutedUntil = muteCheck.rows?.[0]?.chat_muted_until;
            if (mutedUntil && new Date(mutedUntil).getTime() > Date.now()) {
                return res.status(403).json({
                    code: 'CHAT_MUTED',
                    message: 'Your chat access is temporarily suspended.',
                });
            }

            const { rows } = await pool.query(
                `INSERT INTO lobby_chat_messages (user_id, username, message)
                 VALUES ($1, $2, $3)
                 RETURNING id, user_id, username, message, created_at;`,
                [userId, username, review.message],
            );
            const newMessage = rows[0];

            if (review.matched.length > 0) {
                // The words are logged, never echoed back — telling a player
                // exactly which token tripped the filter is a tuning guide.
                console.log(`[CHAT] filtered ${review.matched.length} term(s) from user ${userId}`);
            }

            // Broadcast carries user_id so each client can drop it if the
            // author is on their block list.
            io.emit('new_lobby_message', newMessage);
            res.status(201).json(newMessage);
        } catch (error) {
            console.error('Failed to post chat message:', error);
            res.status(500).json({ message: 'Internal Server Error' });
        }
    });

    // POST /api/chat/report - flag a message for an admin.
    router.post('/report', checkAuth, moderationLimiter, async (req, res) => {
        const messageId = Number(req.body?.messageId);
        const reason = String(req.body?.reason || 'other');
        if (!Number.isSafeInteger(messageId) || messageId <= 0) {
            return res.status(400).json({ message: 'A message is required.' });
        }
        if (!REPORT_REASONS.has(reason)) {
            return res.status(400).json({ message: 'Choose a reason for the report.' });
        }

        try {
            const target = await pool.query(
                'SELECT id, user_id, message FROM lobby_chat_messages WHERE id = $1',
                [messageId],
            );
            const message = target.rows?.[0];
            if (!message) return res.status(404).json({ message: 'That message no longer exists.' });
            if (Number(message.user_id) === Number(req.user.id)) {
                return res.status(400).json({ message: 'You cannot report your own message.' });
            }

            // The snapshot outlives an admin hiding the row or the author
            // deleting their account, so the report stays reviewable.
            await pool.query(
                `INSERT INTO chat_reports
                    (message_id, reporter_user_id, reported_user_id, reason, message_snapshot)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (message_id, reporter_user_id) DO NOTHING`,
                [messageId, req.user.id, message.user_id, reason, message.message],
            );
            console.log(`[CHAT] message ${messageId} reported (${reason}) by user ${req.user.id}`);
            // Reported twice or once, the player gets the same answer: it is in
            // hand. Anything else invites them to keep tapping.
            return res.status(202).json({ reported: true });
        } catch (error) {
            console.error('Failed to record chat report:', error);
            return res.status(500).json({ message: 'Internal Server Error' });
        }
    });

    // POST /api/chat/block  { userId, blocked: boolean }
    router.post('/block', checkAuth, moderationLimiter, async (req, res) => {
        const targetId = Number(req.body?.userId);
        const blocked = req.body?.blocked !== false;
        if (!Number.isSafeInteger(targetId) || targetId <= 0) {
            return res.status(400).json({ message: 'A player is required.' });
        }
        if (targetId === Number(req.user.id)) {
            return res.status(400).json({ message: 'You cannot block yourself.' });
        }

        try {
            if (blocked) {
                // Only someone who has actually posted can be blocked. Without
                // this, walking userId 1..N and reading /blocks back would dump
                // the whole id-to-username map for free.
                const seen = await pool.query(
                    'SELECT 1 FROM lobby_chat_messages WHERE user_id = $1 LIMIT 1',
                    [targetId],
                );
                if (seen.rowCount === 0) {
                    return res.status(404).json({ message: 'That player has not posted here.' });
                }
                await pool.query(
                    `INSERT INTO chat_blocks (blocker_user_id, blocked_user_id)
                     VALUES ($1, $2)
                     ON CONFLICT DO NOTHING`,
                    [req.user.id, targetId],
                );
            } else {
                await pool.query(
                    'DELETE FROM chat_blocks WHERE blocker_user_id = $1 AND blocked_user_id = $2',
                    [req.user.id, targetId],
                );
            }
            res.set('Cache-Control', 'private, no-store');
            return res.json({ userId: targetId, blocked });
        } catch (error) {
            if (error?.code === '23503') {
                return res.status(404).json({ message: 'That player no longer exists.' });
            }
            console.error('Failed to update block:', error);
            return res.status(500).json({ message: 'Internal Server Error' });
        }
    });

    return router;
};

module.exports = createChatRoutes;
module.exports.REPORT_REASONS = REPORT_REASONS;
