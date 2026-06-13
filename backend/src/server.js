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
const createAiRoutes = require('./api/ai');
const createPingRoutes = require('./api/ping');
const createBotInsuranceStatsRoutes = require('./api/botInsuranceStats');
const insuranceHandler = require('./core/handlers/insuranceHandler');


const app = express();
const server = http.createServer(app);

// --- CORS SETUP ---
// All known production origins, plus whatever CLIENT_ORIGIN adds.
const allowedOrigins = [
    "https://playsluff.com",
    "https://www.playsluff.com",
    "https://playsluff.netlify.app",
];
if (process.env.CLIENT_ORIGIN && !allowedOrigins.includes(process.env.CLIENT_ORIGIN)) {
    allowedOrigins.push(process.env.CLIENT_ORIGIN);
}

// Add local development origins
if (process.env.NODE_ENV !== 'production') {
    allowedOrigins.push(
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:3003",
        "http://10.0.0.40:3003"
    );
}

const corsOptions = {
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or Postman)
        if (!origin) return callback(null, true);
        
        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ["GET", "POST"],
    credentials: true
};

const io = new Server(server, {
  cors: corsOptions,
});

let pool;

app.use(cors(corsOptions)); // Use the same options for Express
app.use(express.json());

const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
  console.log(`Sluff Game Server running on port ${PORT}`);
  try {
    pool = new Pool({
      connectionString: process.env.POSTGRES_CONNECT_STRING,
      ssl: { rejectUnauthorized: false }
    });
    await pool.connect();
    console.log("✅ Database connection successful.");
    await createDbTables(pool);
    
    const gameService = new GameService(io, pool);

    registerGameHandlers(io, gameService);

    io.on('connection', (socket) => {
      socket.on('updateInsuranceSetting', ({ tableId, settingType, value }) => {
        const engine = gameService.getEngineById(tableId);
        insuranceHandler.updateInsuranceSetting(engine, socket.user.id, settingType, value);
        io.to(tableId).emit('gameState', engine.getStateForClient());
        io.emit('lobbyState', gameService.getLobbyState());
      });
    });
    
    app.use('/api/auth', createAuthRoutes(pool, bcrypt, jwt, io));
    app.use('/api/leaderboard', createLeaderboardRoutes(pool));
    app.use('/api/admin', createAdminRoutes(pool, jwt));
    app.use('/api/feedback', createFeedbackRoutes(pool, jwt));
    app.use('/api/chat', createChatRoutes(pool, io, jwt));
    
    const aiRouter = createAiRoutes(pool, gameService);
    app.use('/api/ai', aiRouter);

    const pingRouter = createPingRoutes();
    app.use('/api/ping', pingRouter);

    app.get('/health', async (req, res) => {
        try {
            await pool.query('SELECT 1');
            res.json({ status: 'ok', db: 'up', uptime: Math.floor(process.uptime()) });
        } catch (err) {
            res.status(503).json({ status: 'degraded', db: 'down', uptime: Math.floor(process.uptime()) });
        }
    });
    
    const botStatsRouter = createBotInsuranceStatsRoutes(pool);
    app.use('/api/bot-insurance', botStatsRouter);

  } catch (err) {
    console.error("❌ DATABASE CONNECTION FAILED:", err);
    process.exit(1);
  }
});