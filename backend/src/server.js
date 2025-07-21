// backend/src/server.js

require("dotenv").config();
const http = require("http");
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");
const bcrypt = require('bcrypt');

// --- Refactored Imports ---
const GameService = require('./services/GameService');
const registerGameHandlers = require('./events/gameEvents');
const createAuthRoutes = require('./api/auth');
const createLeaderboardRoutes = require('./api/leaderboard');
const createAdminRoutes = require('./api/admin');
const createFeedbackRoutes = require('./api/feedback');
const createChatRoutes = require('./api/chat');
const createDbTables = require('./data/createTables');
const createAiRoutes = require('./api/ai'); // Added import
const createPingRoutes = require('./api/ping');

// --- Basic Server Setup ---
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.CLIENT_ORIGIN, methods: ["GET", "POST"] },
});

let pool;

app.use(cors({ origin: process.env.CLIENT_ORIGIN }));
app.use(express.json());

// --- SERVER STARTUP ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
  console.log(`Sluff Game Server running on port ${PORT}`);
  try {
    // 1. Connect to Database
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    await pool.connect();
    console.log("✅ Database connection successful.");
    await createDbTables(pool);
    
    // 2. Initialize Services
    const gameService = new GameService(io, pool);

    // 3. Register Network Handlers
    registerGameHandlers(io, gameService);
    
    // 4. Register API Routes
    app.use('/api/auth', createAuthRoutes(pool, bcrypt, jwt, io));
    app.use('/api/leaderboard', createLeaderboardRoutes(pool));
    app.use('/api/admin', createAdminRoutes(pool, jwt));
    app.use('/api/feedback', createFeedbackRoutes(pool, jwt));
    app.use('/api/chat', createChatRoutes(pool, io, jwt));
    
    // --- MODIFICATION: Initialize and use the AI router ---
    const aiRouter = createAiRoutes(pool, gameService);
    app.use('/api/ai', aiRouter);

        // --- NEW ROUTE: Simple ping endpoint ---
    const pingRouter = createPingRoutes();
    app.use('/api/ping', pingRouter);

  } catch (err) {
    console.error("❌ DATABASE CONNECTION FAILED:", err);
    process.exit(1);
  }
});