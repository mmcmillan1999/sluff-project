// backend/src/api/auth.js

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const { sendEmail } = require('../services/emailService');
const requireAuth = require('../middleware/requireAuth');
const {
    applyTutorialAction,
    playerProgressFields,
} = require('../services/tutorialProgress');
const {
    parseLedgerPageOptions,
    readTokenLedgerPage,
} = require('../data/tokenLedger');

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

// Per-IP limits on the abuse-prone auth routes. Registration mints starting
// tokens and burns a bcrypt hash per call; the email routes trigger real
// sends via Resend, so they get the tightest budget.
const limiterDefaults = {
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many attempts. Please wait a bit and try again.' },
};
const loginLimiter = rateLimit({ ...limiterDefaults, windowMs: 15 * 60 * 1000, limit: 10 });
const registerLimiter = rateLimit({ ...limiterDefaults, windowMs: 60 * 60 * 1000, limit: 5 });
const emailSendLimiter = rateLimit({ ...limiterDefaults, windowMs: 60 * 60 * 1000, limit: 3 });
const tokenCheckLimiter = rateLimit({ ...limiterDefaults, windowMs: 15 * 60 * 1000, limit: 30 });

const MIN_PASSWORD_LENGTH = 8;

module.exports = function(pool, bcrypt, jwt, io) {
    const router = express.Router();
    const checkAuth = requireAuth(pool, jwt);

    // REGISTRATION ROUTE
    router.post('/register', registerLimiter, async (req, res) => {
        const client = await pool.connect();
        let newUserId = null;
        let committed = false;
        try {
            await client.query('BEGIN');

            const { username, email, password, acceptedTerms } = req.body;
            if (!username || !email || !password) {
                return res.status(400).json({ message: "Username, email, and password are required." });
            }
            if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
                return res.status(400).json({ message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
            }
            if (acceptedTerms !== true) {
                return res.status(400).json({ message: "You must accept the Terms of Service and Privacy Policy to create an account." });
            }
            const hashedPassword = await bcrypt.hash(password, 10);
            
            const insertUserQuery = 'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id';
            const userResult = await client.query(insertUserQuery, [username, email, hashedPassword]);
            newUserId = userResult.rows[0].id;

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

            // Commit the account BEFORE attempting email delivery. A transient
            // email-provider failure must not destroy the registration — the
            // user can request a resend from the login screen instead.
            await client.query('COMMIT');
            committed = true;

            try {
                await sendEmail({
                    to: email,
                    subject: emailSubject,
                    text: emailText,
                    html: emailHtml,
                });
                res.status(201).json({
                    message: "Registration successful! Please check your email to verify your account.",
                    emailSent: true,
                });
            } catch (emailError) {
                console.error(`Registration email failed for user ${newUserId}:`, emailError);
                res.status(201).json({
                    message: "Your account was created, but we couldn't send the verification email. "
                        + "Try signing in — you'll be able to resend it from there.",
                    emailSent: false,
                });
            }

        } catch (error) {
            if (!committed) {
                await client.query('ROLLBACK');
            }
            console.error("Registration error:", error);
            if (error.code === '23505') {
                const field = error.constraint === 'users_email_key' ? 'email' : 'username';
                const message = field === 'email'
                    ? "An account with that email already exists. Try signing in or resetting your password."
                    : "That username is taken. Pick another one.";
                return res.status(409).json({ message, field });
            }
            res.status(500).json({ message: error.message || "An unknown error occurred." });
        } finally {
            client.release();
        }
    });

    // LOGIN ROUTE
    router.post('/login', loginLimiter, async (req, res) => {
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
                  AND COALESCE(is_bot, FALSE) = FALSE
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

    // Account owners can inspect the exact entries used to calculate their
    // token balance. User ids from the request are intentionally ignored: the
    // freshly hydrated authenticated account is the only ledger in scope.
    router.get('/token-ledger', checkAuth, async (req, res) => {
        try {
            const options = parseLedgerPageOptions(req.query);
            const page = await readTokenLedgerPage(pool, Number(req.user.id), options);
            res.set('Cache-Control', 'private, no-store');
            return res.json(page);
        } catch (error) {
            if (error.statusCode === 400) {
                return res.status(400).json({ message: error.message });
            }
            console.error('Token-ledger load error:', error);
            return res.status(500).json({ message: 'Unable to load token history.' });
        }
    });

    for (const action of ['start', 'complete', 'skip', 'reset']) {
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
    router.post('/verify-email', tokenCheckLimiter, async (req, res) => {
        const { token } = req.body;
        if (!token) {
            return res.status(400).json({ message: "Verification token is required." });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            const findUserQuery = `
                SELECT * FROM users
                WHERE verification_token = $1
                  AND COALESCE(is_bot, FALSE) = FALSE
            `;
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
    router.post('/request-password-reset', emailSendLimiter, async (req, res) => {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ message: "Email is required." });
        }
        
        const client = await pool.connect();
        try {
            const userResult = await client.query(
                `SELECT * FROM users
                 WHERE email = $1
                   AND COALESCE(is_bot, FALSE) = FALSE`,
                [email],
            );

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
    router.post('/reset-password', tokenCheckLimiter, async (req, res) => {
        const { token, password } = req.body;
        if (!token || !password) {
            return res.status(400).json({ message: "Token and new password are required." });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            const userResult = await client.query(
                `SELECT * FROM users
                 WHERE password_reset_token = $1
                   AND COALESCE(is_bot, FALSE) = FALSE`,
                [token],
            );
            
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
    router.post('/resend-verification', emailSendLimiter, async (req, res) => {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ message: "Email is required." });
        }

        const client = await pool.connect();
        try {
            const userResult = await client.query(
                `SELECT * FROM users
                 WHERE email = $1
                   AND COALESCE(is_bot, FALSE) = FALSE`,
                [email],
            );

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
