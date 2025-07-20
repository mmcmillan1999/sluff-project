// backend/src/server.js

require("dotenv").config();
const http = require("http");
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");
const bcrypt = require('bcrypt');

const GameService = require('./services/GameService');
const registerGameHandlers = require('./events/gameEvents');
const createAuthRoutes = require('./api/auth');
const createLeaderboardRoutes = require('./api/leaderboard');
const createAdminRoutes = require('./api/admin');
const createFeedbackRoutes = require('./api/feedback');
const createChatRoutes = require('./api/chat');
const createDbTables = require('./data/createTables');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  // --- THIS IS THE CRITICAL CHANGE ---
  cors: { origin: process.env.CLIENT_ORIGIN, methods: ["GET", "POST"] },
});

let pool;

// This cors setup is for Express API routes
app.use(cors({ origin: process.env.CLIENT_ORIGIN }));
app.use(express.json());

// --- SERVER STARTUP ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
  console.log(`Sluff Game Server running on port ${PORT}`);
  try {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    await pool.connect();
    console.log("✅ Database connection successful.");
    await createDbTables(pool);
    
    const gameService = new GameService(io, pool);

    registerGameHandlers(io, gameService);
    
    app.use('/api/auth', createAuthRoutes(pool, bcrypt, jwt, io));
    app.use('/api/leaderboard', createLeaderboardRoutes(pool));
    app.use('/api/admin', createAdminRoutes(pool, jwt));
    app.use('/api/feedback', createFeedbackRoutes(pool, jwt));
    app.use('/api/chat', createChatRoutes(pool, io, jwt));

  } catch (err) {
    console.error("❌ DATABASE CONNECTION FAILED:", err);
    process.exit(1);
  }
});