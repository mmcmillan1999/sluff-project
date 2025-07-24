// backend/src/api/feedback.js

const express = require('express');

const checkAuth = (jwt) => (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).send('Authentication required.');
    }
    const token = authHeader.split(' ')[1];
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).send('Invalid or expired token.');
        }
        req.user = user;
        next();
    });
};

const isAdmin = (req, res, next) => {
    if (req.user && req.user.is_admin) {
        return next();
    }
    res.status(403).send('Access Forbidden: Requires admin privileges.');
};

const createFeedbackRoutes = (pool, jwt) => {
    const router = express.Router();
    
    // POST /api/feedback - Submit new feedback (existing functionality)
    router.post('/', checkAuth(jwt), async (req, res) => {
        const { id: userId, username } = req.user;
        const { feedback_text, game_state_json } = req.body;

        if (!feedback_text) {
            return res.status(400).json({ message: 'Feedback text is required.' });
        }

        try {
            const tableId = game_state_json?.tableId || null;
            const query = `
                INSERT INTO feedback (user_id, username, feedback_text, table_id, game_state_json)
                VALUES ($1, $2, $3, $4, $5)
            `;
            const values = [userId, username, feedback_text, tableId, game_state_json];
            await pool.query(query, values);
            res.status(201).json({ message: 'Feedback submitted successfully. Thank you!' });

        } catch (error) {
            console.error('Error submitting feedback:', error);
            res.status(500).json({ message: 'An internal error occurred while submitting your feedback.' });
        }
    });

    // --- NEW: GET /api/feedback - Fetch the feedback repository ---
    router.get('/', checkAuth(jwt), async (req, res) => {
        try {
            const userIsAdmin = req.user.is_admin;
            let query;
            
            if (userIsAdmin) {
                // Admins see everything
                query = `
                    SELECT feedback_id, user_id, username, submitted_at, feedback_text, 
                           table_id, status, admin_response, admin_notes, last_updated_by_admin_at
                    FROM feedback
                    ORDER BY submitted_at DESC;
                `;
            } else {
                // Regular users see non-hidden feedback, without admin notes
                query = `
                    SELECT feedback_id, user_id, username, submitted_at, feedback_text, 
                           table_id, status, admin_response, last_updated_by_admin_at
                    FROM feedback
                    WHERE status != 'hidden'
                    ORDER BY submitted_at DESC;
                `;
            }
            const { rows } = await pool.query(query);
            res.json(rows);

        } catch (error) {
            console.error('Error fetching feedback:', error);
            res.status(500).json({ message: 'An internal error occurred while fetching feedback.' });
        }
    });

    // --- NEW: PUT /api/feedback/:id - Update a feedback item (Admins only) ---
    router.put('/:id', checkAuth(jwt), isAdmin, async (req, res) => {
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
    });

    return router;
};

module.exports = createFeedbackRoutes;