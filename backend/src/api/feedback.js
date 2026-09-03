// backend/src/api/feedback.js

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const requireAuth = require('../middleware/requireAuth');
const { filterMessage } = require('../data/chatModeration');

// Keyed by account like chat (mobile carriers share IPs); runs after checkAuth.
const byUser = (req) => (req.user?.id != null ? `u:${req.user.id}` : 'anonymous');
const submitLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: byUser,
    message: { message: 'You have sent a lot of feedback recently. Wait a few minutes.' },
});

const isAdmin = (req, res, next) => {
    if (req.user?.is_admin === true) {
        return next();
    }
    res.status(403).send('Access Forbidden: Requires admin privileges.');
};

const MAX_FEEDBACK_CHARS = 5000;
const FEEDBACK_PAGE_LIMIT = 500;

const createFeedbackRoutes = (pool, jwt) => {
    const router = express.Router();
    const checkAuth = requireAuth(pool, jwt);
    
    // POST /api/feedback - Submit new feedback (existing functionality)
    router.post('/', checkAuth, submitLimiter, async (req, res) => {
        const { id: userId, username } = req.user;
        const { feedback_text, game_state_json } = req.body;

        if (!feedback_text || typeof feedback_text !== 'string' || !feedback_text.trim()) {
            return res.status(400).json({ message: 'Feedback text is required.' });
        }
        if (feedback_text.length > MAX_FEEDBACK_CHARS) {
            return res.status(400).json({ message: `Feedback must be ${MAX_FEEDBACK_CHARS} characters or fewer.` });
        }

        try {
            const tableId = game_state_json?.tableId || null;
            // The board is public UGC; run chat's word filter over it (the
            // length rule differs, so the filter rather than reviewMessage).
            const { clean } = filterMessage(feedback_text.trim());
            const query = `
                INSERT INTO feedback (user_id, username, feedback_text, table_id, game_state_json)
                VALUES ($1, $2, $3, $4, $5)
            `;
            const values = [userId, username, clean, tableId, game_state_json];
            await pool.query(query, values);
            res.status(201).json({ message: 'Feedback submitted successfully. Thank you!' });

        } catch (error) {
            console.error('Error submitting feedback:', error);
            res.status(500).json({ message: 'An internal error occurred while submitting your feedback.' });
        }
    });

    // --- NEW: GET /api/feedback - Fetch the feedback repository ---
    router.get('/', checkAuth, async (req, res) => {
        try {
            const userIsAdmin = req.user.is_admin === true;
            let query;
            
            if (userIsAdmin) {
                // Admins see everything
                query = `
                    SELECT feedback_id, user_id, username, submitted_at, feedback_text, 
                           table_id, status, admin_response, admin_notes, last_updated_by_admin_at
                    FROM feedback
                    ORDER BY submitted_at DESC
                    LIMIT ${FEEDBACK_PAGE_LIMIT};
                `;
            } else {
                // Regular users see non-hidden feedback, without admin notes or
                // the id-to-username map (chat refuses to leak that too).
                query = `
                    SELECT feedback_id, username, submitted_at, feedback_text, 
                           table_id, status, admin_response, last_updated_by_admin_at
                    FROM feedback
                    WHERE status != 'hidden'
                    ORDER BY submitted_at DESC
                    LIMIT ${FEEDBACK_PAGE_LIMIT};
                `;
            }
            const { rows } = await pool.query(query);
            res.json(rows);

        } catch (error) {
            console.error('Error fetching feedback:', error);
            res.status(500).json({ message: 'An internal error occurred while fetching feedback.' });
        }
    });

    // --- Update a feedback item (Admins only) ---
    const updateFeedbackItem = async (req, res) => {
        const { id } = req.params;
        const { status, admin_response, admin_notes } = req.body;

        try {
            // Build the query dynamically to only update fields that are provided
            const fieldsToUpdate = [];
            const values = [];
            let queryIndex = 1;

            if (status) {
                fieldsToUpdate.push(`status = $${queryIndex++}`);
                values.push(status);
            }
            if (admin_response !== undefined) { // Allow empty string
                fieldsToUpdate.push(`admin_response = $${queryIndex++}`);
                values.push(admin_response);
            }
            if (admin_notes !== undefined) {
                fieldsToUpdate.push(`admin_notes = $${queryIndex++}`);
                values.push(admin_notes);
            }
            
            if (fieldsToUpdate.length === 0) {
                return res.status(400).json({ message: "No valid fields to update were provided." });
            }

            // Always update the timestamp when an admin makes a change
            fieldsToUpdate.push(`last_updated_by_admin_at = NOW()`);
            values.push(id);

            const query = `
                UPDATE feedback
                SET ${fieldsToUpdate.join(', ')}
                WHERE feedback_id = $${queryIndex}
                RETURNING *;
            `;

            const { rows } = await pool.query(query, values);
            if (rows.length === 0) {
                return res.status(404).json({ message: "Feedback item not found." });
            }
            res.json(rows[0]);

        } catch (error) {
            console.error(`Error updating feedback ID ${id}:`, error);
            res.status(500).json({ message: 'An internal error occurred while updating the feedback item.' });
        }
    };
    // CORS pins methods to GET and POST (server.js), so a browser can only reach
    // the POST form; PUT stays for same-origin and script callers.
    router.put('/:id', checkAuth, isAdmin, updateFeedbackItem);
    router.post('/:id/update', checkAuth, isAdmin, updateFeedbackItem);

    return router;
};

module.exports = createFeedbackRoutes;
