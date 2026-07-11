// backend/src/api/auth.js

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { sendEmail } = require('../services/emailService');
const requireAuth = require('../middleware/requireAuth');
const {
    applyTutorialAction,
    playerProgressFields,
} = require('../services/tutorialProgress');

const PROFILE_COLUMNS = `
    id, username, email, created_at, wins, losses, washes,
    is_admin, is_vip, tutorial_version, tutorial_active_version
`;

async function tokenBalanceForUser(pool, userId) {
    const result = await pool.query(
        'SELECT COALESCE(SUM(amount), 0) AS tokens FROM transactions WHERE user_id = $1',
        [userId],
    );
    return parseFloat(result.rows?.[0]?.tokens || 0).toFixed(2);
}

function publicUserProfile(user, tokens) {
    return {
        id: user.id,
        username: user.username,
        ...(user.email !== undefined ? { email: user.email } : {}),
        ...(user.created_at !== undefined ? { created_at: user.created_at } : {}),
        tokens,
        is_admin: user.is_admin === true,
        is_vip: user.is_vip === true,
        ...playerProgressFields(user),
    };
}

module.exports = function(pool, bcrypt, jwt, io) {
    const checkAuth = requireAuth(pool, jwt);

    // REGISTRATION ROUTE
    router.post('/register', async (req, res) => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const { username, email, password } = req.body;
            if (!username || !email || !password) {
                return res.status(400).json({ message: "Username, email, and password are required." });
            }
            const hashedPassword = await bcrypt.hash(password, 10);
            
            const insertUserQuery = 'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id';
            const userResult = await client.query(insertUserQuery, [username, email, hashedPassword]);
            const newUserId = userResult.rows[0].id;

            const startingTokens = 8.00;
            const transactionType = 'admin_adjustment'; 
            const description = 'New user starting balance';
            const insertTransactionQuery = 'INSERT INTO transactions (user_id, amount, transaction_type, description) VALUES ($1, $2, $3, $4)';
            await client.query(insertTransactionQuery, [newUserId, startingTokens, transactionType, description]);
            
            const verificationToken = uuidv4();
            const expirationTime = new Date();
            expirationTime.setHours(expirationTime.getHours() + 24);

            const updateTokenQuery = `
                UPDATE users 
                SET verification_token = $1, verification_token_expires = $2 
                WHERE id = $3
            `;
            await client.query(updateTokenQuery, [verificationToken, expirationTime, newUserId]);

            const verificationUrl = `${process.env.CLIENT_ORIGIN}/verify-email?token=${verificationToken}`;
            const emailSubject = "Welcome to Sluff! Please Verify Your Email";
            const emailText = `Thank you for registering for Sluff! Please verify your email by clicking the following link: ${verificationUrl}`;
            const emailHtml = `
                <h1>Welcome to Sluff!</h1>
                <p>Thank you for registering. Please click the link below to verify your email address and activate your account:</p>
                <a href="${verificationUrl}" style="padding: 10px 15px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px;">Verify Email</a>
                <p>If you did not register for this account, you can safely ignore this email.</p>
            `;

            // Send the verification email as part of the registration transaction.
            // If delivery fails we roll the whole thing back so the user can retry,
            // rather than leaving them with an unverified account they can't activate.
            // (Email provider is Resend — see backend/src/services/emailService.js.)
            await sendEmail({
                to: email,
                subject: emailSubject,
                text: emailText,
                html: emailHtml,
            });

            await client.query('COMMIT');

            res.status(201).json({
                message: "Registration successful! Please check your email to verify your account."
            });

        } catch (error) {
            await client.query('ROLLBACK');
            console.error("Registration error:", error);
            if (error.code === '23505') {
                 return res.status(409).json({ message: "Username or email already exists." });
            }
            if (error.message === 'Failed to send email.') {
                return res.status(502).json({ message: "We couldn't send your verification email. Please try again in a moment." });
            }
            res.status(500).json({ message: error.message || "An unknown error occurred." });
        } finally {
            client.release();
        }
    });

    // LOGIN ROUTE
    router.post('/login', async (req, res) => {
        try {
            const { email, password } = req.body;
            if (!email || !password) {
                return res.status(400).json({ message: "Email and password are required." });
            }

            const userQuery = `
                SELECT id, username, password_hash, is_admin, is_verified, is_vip,
                       wins, losses, washes, tutorial_version, tutorial_active_version
                FROM users
                WHERE email = $1
            `;
            const userResult = await pool.query(userQuery, [email]);

            if (userResult.rows.length === 0) {
                return res.status(401).json({ message: "Invalid credentials." });
            }

            const user = userResult.rows[0];
            const isPasswordValid = await bcrypt.compare(password, user.password_hash);

            if (!isPasswordValid) {
                return res.status(401).json({ message: "Invalid credentials." });
            }
            
            if (!user.is_verified) {
                return res.status(403).json({ message: "Account not verified. Please check your email for a verification link." });
            }

            const tokens = await tokenBalanceForUser(pool, user.id);

            const payload = { id: user.id, username: user.username, is_admin: user.is_admin };
            // 90-day sessions: sign in once, stay signed in (chess.com-style).
            // Logout still works client-side; rotating JWT_SECRET force-logs-out everyone.
            const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '90d' });

            try {
                const loginMsgQuery = `
                    INSERT INTO lobby_chat_messages (user_id, username, message)
                    VALUES ($1, $2, $3)
                    RETURNING id, username, message, created_at;
                `;
                const msgValues = [user.id, 'System', `${user.username} has logged on.`];
                const { rows } = await pool.query(loginMsgQuery, msgValues);
                io.emit('new_lobby_message', rows[0]);
            } catch (chatError) {
                console.error("Failed to post login message to chat:", chatError);
            }

            res.json({
                token,
                user: publicUserProfile(user, tokens)
            });

        } catch (error) {
            console.error("Login error:", error);
            res.status(500).json({ message: "Internal server error during login." });
        }
    });

    // CURRENT PROFILE ENDPOINT
    // This is always scoped to the authenticated account. Query/body user ids
    // are intentionally ignored so tutorial state cannot be changed or read on
    // behalf of another player.
    router.get('/profile', checkAuth, async (req, res) => {
        try {
            const result = await pool.query(
                `SELECT ${PROFILE_COLUMNS} FROM users WHERE id = $1`,
                [req.user.id],
            );
            const user = result.rows?.[0];
            if (!user) return res.status(401).json({ message: 'Authentication required.' });

            const tokens = await tokenBalanceForUser(pool, req.user.id);
            return res.json({ user: publicUserProfile(user, tokens) });
        } catch (error) {
            console.error('Profile load error:', error);
            return res.status(500).json({ message: 'Unable to load profile.' });
        }
    });

    for (const action of ['start', 'complete', 'skip']) {
        router.post(`/tutorial/${action}`, checkAuth, async (req, res) => {
            try {
                const progress = await applyTutorialAction(pool, req.user.id, action);
                if (!progress) return res.status(401).json({ message: 'Authentication required.' });
                return res.json(progress);
            } catch (error) {
                console.error(`Tutorial ${action} error:`, error);
                return res.status(500).json({ message: 'Unable to save tutorial progress.' });
            }
        });
    }

    // EMAIL VERIFICATION ENDPOINT
    router.post('/verify-email', async (req, res) => {
        const { token } = req.body;
        if (!token) {
            return res.status(400).json({ message: "Verification token is required." });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            const findUserQuery = 'SELECT * FROM users WHERE verification_token = $1';
            const userResult = await client.query(findUserQuery, [token]);

            if (userResult.rows.length === 0) {
                return res.status(404).json({ message: "Invalid verification token." });
            }

            const user = userResult.rows[0];

            if (new Date() > new Date(user.verification_token_expires)) {
                return res.status(400).json({ message: "Verification token has expired. Please register again." });
            }

            const updateUserQuery = `
                UPDATE users 
                SET is_verified = TRUE, verification_token = NULL, verification_token_expires = NULL 
                WHERE id = $1
            `;
            await client.query(updateUserQuery, [user.id]);

            await client.query('COMMIT');

            res.status(200).json({ message: "Email verified successfully!" });

        } catch (error) {
            await client.query('ROLLBACK');
            console.error("Email verification error:", error);
            res.status(500).json({ message: "An internal error occurred during email verification." });
        } finally {
            client.release();
        }
    });

    // REQUEST PASSWORD RESET ENDPOINT
    router.post('/request-password-reset', async (req, res) => {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ message: "Email is required." });
        }
        
        const client = await pool.connect();
        try {
            const userResult = await client.query('SELECT * FROM users WHERE email = $1', [email]);

            if (userResult.rows.length > 0) {
                const user = userResult.rows[0];
                const resetToken = uuidv4();
                const expirationTime = new Date();
                expirationTime.setHours(expirationTime.getHours() + 1);

                await client.query(
                    'UPDATE users SET password_reset_token = $1, password_reset_token_expires = $2 WHERE id = $3',
                    [resetToken, expirationTime, user.id]
                );

                const resetUrl = `${process.env.CLIENT_ORIGIN}/reset-password?token=${resetToken}`;
                try {
                    await sendEmail({
                        to: user.email,
                        subject: "Sluff Password Reset Request",
                        text: `You requested a password reset. Click this link to reset your password: ${resetUrl}`,
                        html: `<h1>Password Reset Request</h1><p>You requested a password reset for your Sluff account. Please click the link below to set a new password. This link is valid for one hour.</p><a href="${resetUrl}" style="padding: 10px 15px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px;">Reset Password</a><p>If you did not request this, you can safely ignore this email.</p>`,
                    });
                } catch (emailError) {
                    // If the email provider is unavailable the reset token can't be
                    // delivered, so be honest about it instead of returning a generic
                    // internal error or a misleading "link sent" success message.
                    console.error(`⚠️ Password reset email failed for ${user.email}:`, emailError.message);
                    return res.status(503).json({ message: "Password reset emails are temporarily unavailable. Please try again in a moment or contact the site admin." });
                }
            }

            res.status(200).json({ message: "If an account with that email exists, a password reset link has been sent." });

        } catch (error) {
            console.error("Password reset request error:", error);
            res.status(500).json({ message: "An internal error occurred." });
        } finally {
            client.release();
        }
    });

    // RESET PASSWORD ENDPOINT
    router.post('/reset-password', async (req, res) => {
        const { token, password } = req.body;
        if (!token || !password) {
            return res.status(400).json({ message: "Token and new password are required." });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            const userResult = await client.query('SELECT * FROM users WHERE password_reset_token = $1', [token]);
            
            if (userResult.rows.length === 0) {
                return res.status(400).json({ message: "Invalid or expired password reset token." });
            }

            const user = userResult.rows[0];

            if (new Date() > new Date(user.password_reset_token_expires)) {
                return res.status(400).json({ message: "Invalid or expired password reset token." });
            }

            const hashedPassword = await bcrypt.hash(password, 10);

            // --- THE FIX: Also set is_verified to TRUE ---
            const updateUserQuery = `
                UPDATE users 
                SET 
                    password_hash = $1, 
                    password_reset_token = NULL, 
                    password_reset_token_expires = NULL,
                    is_verified = TRUE 
                WHERE id = $2
            `;
            await client.query(updateUserQuery, [hashedPassword, user.id]);

            await client.query('COMMIT');

            res.status(200).json({ message: "Password has been reset successfully. You can now log in." });

        } catch (error) {
            await client.query('ROLLBACK');
            console.error("Password reset error:", error);
            res.status(500).json({ message: "An internal error occurred." });
        } finally {
            client.release();
        }
    });

    // RESEND VERIFICATION EMAIL ENDPOINT
    router.post('/resend-verification', async (req, res) => {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ message: "Email is required." });
        }

        const client = await pool.connect();
        try {
            const userResult = await client.query('SELECT * FROM users WHERE email = $1', [email]);

            if (userResult.rows.length > 0) {
                const user = userResult.rows[0];
                
                if (!user.is_verified) {
                    const verificationToken = uuidv4();
                    const expirationTime = new Date();
                    expirationTime.setHours(expirationTime.getHours() + 24);

                    await client.query(
                        'UPDATE users SET verification_token = $1, verification_token_expires = $2 WHERE id = $3',
                        [verificationToken, expirationTime, user.id]
                    );

                    const verificationUrl = `${process.env.CLIENT_ORIGIN}/verify-email?token=${verificationToken}`;
                    await sendEmail({
                        to: user.email,
                        subject: "Resent: Please Verify Your Email for Sluff",
                        text: `We received a request to resend your verification email. Please verify your email by clicking the following link: ${verificationUrl}`,
                        html: `<h1>Verify Your Email</h1><p>We received a request to resend the verification email for your Sluff account. Please click the link below to activate your account.</p><a href="${verificationUrl}" style="padding: 10px 15px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px;">Verify Email</a><p>If you did not request this, you can safely ignore this email.</p>`,
                    });
                }
            }
            
            res.status(200).json({ message: "If your account exists and is unverified, a new verification email has been sent." });

        } catch (error) {
            console.error("Resend verification error:", error);
            res.status(500).json({ message: "An internal error occurred." });
        } finally {
            client.release();
        }
    });

    return router;
};
