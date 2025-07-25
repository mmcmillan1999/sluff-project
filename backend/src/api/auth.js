const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { sendEmail } = require('../services/emailService');

module.exports = function(pool, bcrypt, jwt, io) {

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

            await sendEmail({
                to: email,
                subject: emailSubject,
                text: emailText,
                html: emailHtml,
            });

            await client.query('COMMIT');
            
            res.status(201).json({ message: "Registration successful! Please check your email to verify your account." });

        } catch (error) {
            await client.query('ROLLBACK');
            console.error("Registration error:", error);
            // --- MORE SPECIFIC ERROR HANDLING ---
            if (error.code === '23505') { // PostgreSQL unique violation error code
                 return res.status(409).json({ message: "Username or email already exists." });
            }
            // Check if it's a SendGrid error or a generic one
            const errorMessage = error.response ? "Error sending verification email." : (error.message || "An unknown error occurred.");
            res.status(500).json({ message: errorMessage });
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

            const userQuery = 'SELECT id, username, password_hash, is_admin, is_verified FROM users WHERE email = $1';
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

            const tokenQuery = "SELECT SUM(amount) AS tokens FROM transactions WHERE user_id = $1";
            const tokenResult = await pool.query(tokenQuery, [user.id]);
            const tokens = parseFloat(tokenResult.rows[0].tokens || 0).toFixed(2);

            const payload = { id: user.id, username: user.username, is_admin: user.is_admin };
            const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1d' });

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
                user: {
                    id: user.id,
                    username: user.username,
                    tokens: tokens,
                    is_admin: user.is_admin
                }
            });

        } catch (error) {
            console.error("Login error:", error);
            res.status(500).json({ message: "Internal server error during login." });
        }
    });

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

    return router;
};