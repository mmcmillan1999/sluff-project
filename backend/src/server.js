require("dotenv").config();
const http = require("http");
const express = require("express");
const cors =require("cors");
const { Server } = require("socket.io");
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");
const bcrypt = require('bcrypt');

const state = require('./core/gameState');
const createAuthRoutes = require('./api/auth');
const createLeaderboardRoutes = require('./api/leaderboard');
const createAdminRoutes = require('./api/admin');
const createFeedbackRoutes = require('./api/feedback'); 
const createChatRoutes = require('./api/chat');
const createDbTables = require('../data/createTables');
const transactionManager = require("../data/transactionManager");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

let pool;

app.use(cors({ origin: "*" }));
app.use(express.json());

// =================================================================
// AUTHENTICATION MIDDLEWARE
// =================================================================

io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) { 
        return next(new Error("Authentication error: No token provided."));
    }
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) { 
            return next(new Error("Authentication error: Invalid token."));
        }
        socket.user = user;
        next();
    });
});

// =================================================================
// SOCKET.IO CONNECTION HANDLER
// =================================================================

io.on("connection", (socket) => {
    console.log(`Socket connected: ${socket.user.username} (ID: ${socket.user.id}, Socket: ${socket.id})`);

    const table = Object.values(state.getAllTables()).find(t => t.players[socket.user.id]);
    if (table && table.players[socket.user.id].disconnected) {
        table.reconnectPlayer(socket.user.id, socket);
    }
    
    socket.emit("lobbyState", state.getLobbyState());

    // --- CORE EVENT LISTENERS (DELEGATION MODEL) ---
    // ... (All your game event listeners like joinTable, playCard, etc. remain here)
    socket.on("joinTable", async ({ tableId }) => {
        const tableToJoin = state.getTableById(tableId);
        if (!tableToJoin) return socket.emit("error", { message: "Table not found." });

        const previousTable = Object.values(state.getAllTables()).find(t => t.players[socket.user.id] && t.tableId !== tableId);
        if (previousTable) {
            await previousTable.leaveTable(socket.user.id);
            socket.leave(previousTable.tableId);
        }
        
        socket.join(tableId);
        await tableToJoin.joinTable(socket.user, socket.id);
    });

    socket.on("leaveTable", async ({ tableId }) => {
        const tableToLeave = state.getTableById(tableId);
        if (tableToLeave) {
            await tableToLeave.leaveTable(socket.user.id);
        }
        socket.leave(tableId);
        socket.emit("lobbyState", state.getLobbyState());
    });

    socket.on("addBot", ({ tableId, name }) => {
        const table = state.getTableById(tableId);
        if (table) table.addBotPlayer(name || 'Lee');
    });

    socket.on("startGame", ({ tableId }) => {
        const table = state.getTableById(tableId);
        if (table) table.startGame(socket.user.id);
    });
    
    socket.on("dealCards", ({ tableId }) => {
        const table = state.getTableById(tableId);
        if (table) table.dealCards(socket.user.id);
    });

    socket.on("placeBid", ({ tableId, bid }) => {
        const table = state.getTableById(tableId);
        if (table) table.placeBid(socket.user.id, bid);
    });

    socket.on("chooseTrump", ({ tableId, suit }) => {
        const table = state.getTableById(tableId);
        if (table) table.chooseTrump(socket.user.id, suit);
    });

    socket.on("submitFrogDiscards", ({ tableId, discards }) => {
        const table = state.getTableById(tableId);
        if (table) table.submitFrogDiscards(socket.user.id, discards);
    });

    socket.on("playCard", ({ tableId, card }) => {
        const table = state.getTableById(tableId);
        if (table) table.playCard(socket.user.id, card);
    });

    socket.on("requestNextRound", ({ tableId }) => {
        const table = state.getTableById(tableId);
        if (table) table.requestNextRound(socket.user.id);
    });
    
    socket.on("forfeitGame", ({ tableId }) => {
        const table = state.getTableById(tableId);
        if (table) table.forfeitGame(socket.user.id);
    });
    
    socket.on("resetGame", async ({ tableId }) => {
        const table = state.getTableById(tableId);
        if (table) await table.reset();
    });

    socket.on("updateInsuranceSetting", ({ tableId, settingType, value }) => {
        const table = state.getTableById(tableId);
        if (table) table.updateInsuranceSetting(socket.user.id, settingType, value);
    });

    socket.on("startTimeoutClock", ({ tableId, targetPlayerName }) => {
        const table = state.getTableById(tableId);
        if (table) table.startForfeitTimer(socket.user.id, targetPlayerName);
    });

    socket.on("requestDraw", ({ tableId }) => {
        const table = state.getTableById(tableId);
        if (table) table.requestDraw(socket.user.id);
    });
    
    socket.on("submitDrawVote", ({ tableId, vote }) => {
        const table = state.getTableById(tableId);
        if (table) table.submitDrawVote(socket.user.id, vote);
    });


    // --- USER-SPECIFIC & MISC LISTENERS ---

    socket.on("requestUserSync", async () => {
        try {
            const userQuery = "SELECT id, username, email, created_at, wins, losses, washes, is_admin FROM users WHERE id = $1";
            const userResult = await pool.query(userQuery, [socket.user.id]);
            const updatedUser = userResult.rows[0];

            if (updatedUser) {
                const tokenQuery = "SELECT SUM(amount) AS current_tokens FROM transactions WHERE user_id = $1";
                const tokenResult = await pool.query(tokenQuery, [socket.user.id]);
                updatedUser.tokens = parseFloat(tokenResult.rows[0]?.current_tokens || 0).toFixed(2);
                socket.emit("updateUser", updatedUser);
            }
        } catch(err) {
            console.error(`Error during user sync for user ${socket.user.id}:`, err);
        }
    });

    socket.on("requestFreeToken", async () => {
        try {
            const tokenQuery = "SELECT SUM(amount) AS current_tokens FROM transactions WHERE user_id = $1";
            const tokenResult = await pool.query(tokenQuery, [socket.user.id]);
            const currentTokens = parseFloat(tokenResult.rows[0]?.current_tokens || 0);

            if (currentTokens >= 5) {
                return socket.emit("error", { message: "Sorry, free tokens are only for players with fewer than 5 tokens." });
            }

            await transactionManager.postTransaction(pool, {
                userId: socket.user.id, gameId: null, type: 'free_token_mercy', amount: 1,
                description: 'Mercy token requested by user'
            });
            
            const userQuery = "SELECT id, username, email, created_at, wins, losses, washes, is_admin FROM users WHERE id = $1";
            const userResult = await pool.query(userQuery, [socket.user.id]);
            const updatedUser = userResult.rows[0];

            if (updatedUser) {
                const updatedTokenQuery = "SELECT SUM(amount) AS current_tokens FROM transactions WHERE user_id = $1";
                const updatedTokenResult = await pool.query(updatedTokenQuery, [socket.user.id]);
                updatedUser.tokens = parseFloat(updatedTokenResult.rows[0]?.current_tokens || 0).toFixed(2);
                socket.emit("updateUser", updatedUser);
            }

            socket.emit("notification", { message: "1 free token has been added to your account!" });

        } catch (err) {
            socket.emit("error", { message: "Could not grant token." });
        }
    });

    socket.on("disconnect", async () => { // --- MODIFIED: Mark as async ---
        console.log(`Socket disconnected: ${socket.user.username} (ID: ${socket.user.id}, Socket: ${socket.id})`);
        
        // --- NEW: Announce logout/disconnect to the lobby chat ---
        try {
            const logoutMsgQuery = `
                INSERT INTO lobby_chat_messages (user_id, username, message)
                VALUES ($1, $2, $3)
                RETURNING id, username, message, created_at;
            `;
            const msgValues = [socket.user.id, 'System', `${socket.user.username} has logged out.`];
            const { rows } = await pool.query(logoutMsgQuery, msgValues);
            io.emit('new_lobby_message', rows[0]);
        } catch (chatError) {
            console.error("Failed to post logout message to chat:", chatError);
        }
        // --- END NEW ---
        
        const tablePlayerIsOn = Object.values(state.getAllTables()).find(t => t.players[socket.user.id]);
        if (tablePlayerIsOn) {
            tablePlayerIsOn.disconnectPlayer(socket.user.id);
        }
    });
});

// =================================================================
// SERVER STARTUP
// =================================================================

const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
  console.log(`Sluff Game Server (v${require('./core/constants').SERVER_VERSION}) running on port ${PORT}`);
  try {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    await pool.connect();
    console.log("✅ Database connection successful.");
    await createDbTables(pool);
    
    // --- MODIFICATION: Pass 'io' to the auth routes ---
    const authRoutes = createAuthRoutes(pool, bcrypt, jwt, io);
    app.use('/api/auth', authRoutes);

    const leaderboardRoutes = createLeaderboardRoutes(pool);
    app.use('/api/leaderboard', leaderboardRoutes);

    const adminRouter = createAdminRoutes(pool, jwt);
    app.use('/api/admin', adminRouter);

    const feedbackRouter = createFeedbackRoutes(pool, jwt); 
    app.use('/api/feedback', feedbackRouter);              

    const chatRouter = createChatRoutes(pool, io, jwt);
    app.use('/api/chat', chatRouter);

    state.initializeGameTables(io, pool);

  } catch (err) {
    console.error("❌ DATABASE CONNECTION FAILED:", err);
    process.exit(1);
  }
});