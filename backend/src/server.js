'use strict';

require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const GameService = require('./services/GameService');
const registerGameHandlers = require('./events/gameEvents');
const createAuthRoutes = require('./api/auth');
const createLeaderboardRoutes = require('./api/leaderboard');
const createPlayerRoutes = require('./api/players');
const createSeasonRoutes = require('./api/seasons');
const createAdminRoutes = require('./api/admin');
const createFeedbackRoutes = require('./api/feedback');
const createChatRoutes = require('./api/chat');
const createDbTables = require('./data/createTables');
const { ensureBotAccounts } = require('./data/botAccounts');
const createPingRoutes = require('./api/ping');
const createMetricsRoutes = require('./api/metrics');
const createBotInsuranceStatsRoutes = require('./api/botInsuranceStats');
const {
    DEFAULT_GRACE_MS,
    DEFAULT_HEARTBEAT_INTERVAL_MS,
    DEFAULT_INTERVAL_MS,
    createAbandonedGameRecoveryMonitor,
    liveGameIdsFromService,
    validateRecoveryTiming,
} = require('./maintenance/abandonedGameRecovery');
const {
    validateAdminRecoveryHeartbeatCadence,
} = require('./services/adminGameRecoveryService');

const app = express();
const server = http.createServer(app);

const allowedOrigins = [
    'https://playsluff.com',
    'https://www.playsluff.com',
    'https://playsluff.netlify.app',
    'capacitor://localhost',
    'ionic://localhost',
    'http://localhost',
];
if (process.env.CLIENT_ORIGIN && !allowedOrigins.includes(process.env.CLIENT_ORIGIN)) {
    allowedOrigins.push(process.env.CLIENT_ORIGIN);
}
if (process.env.NODE_ENV !== 'production') {
    allowedOrigins.push(
        'http://localhost:3000',
        'http://localhost:3001',
        'http://localhost:3003',
        'http://10.0.0.40:3003',
    );
}

const corsOptions = {
    origin(origin, callback) {
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST'],
    credentials: true,
};

// Cap socket payloads well below the 1MB default; game events are tiny.
const io = new Server(server, { cors: corsOptions, maxHttpBufferSize: 1e5 });
const PORT = process.env.PORT || 3000;
const MINIMUM_RECOVERY_GRACE_MS = 60 * 60 * 1000;

let pool;
let recoveryMonitor;

// One proxy hop (Render) — required so rate limiting sees real client IPs.
app.set('trust proxy', 1);
app.use(cors(corsOptions));
app.use(express.json({ limit: '100kb' }));

function recoveryTimingFromEnvironment() {
    const graceHours = process.env.ABANDONED_GAME_GRACE_HOURS === undefined
        ? DEFAULT_GRACE_MS / 3600000
        : Number(process.env.ABANDONED_GAME_GRACE_HOURS);
    const intervalMinutes = process.env.ABANDONED_GAME_RECOVERY_INTERVAL_MINUTES === undefined
        ? DEFAULT_INTERVAL_MS / 60000
        : Number(process.env.ABANDONED_GAME_RECOVERY_INTERVAL_MINUTES);

    if (!Number.isFinite(graceHours) || graceHours * 3600000 < MINIMUM_RECOVERY_GRACE_MS) {
        throw new Error('ABANDONED_GAME_GRACE_HOURS must be at least 1.');
    }
    if (!Number.isFinite(intervalMinutes) || intervalMinutes < 1) {
        throw new Error('ABANDONED_GAME_RECOVERY_INTERVAL_MINUTES must be at least 1.');
    }
    return validateRecoveryTiming({
        graceMs: Math.round(graceHours * 3600000),
        intervalMs: Math.round(intervalMinutes * 60000),
    });
}

async function initializeApplication() {
    pool = new Pool({
        connectionString: process.env.POSTGRES_CONNECT_STRING,
        ssl: { rejectUnauthorized: false },
    });
    await pool.query('SELECT 1');
    console.log('Database connection successful.');
    await createDbTables(pool);

    const botAccounts = await ensureBotAccounts(pool);
    const gameService = new GameService(io, pool, { botAccounts });
    const recoveryTiming = recoveryTimingFromEnvironment();
    recoveryMonitor = createAbandonedGameRecoveryMonitor({
        pool,
        graceMs: recoveryTiming.graceMs,
        intervalMs: recoveryTiming.intervalMs,
        heartbeatIntervalMs: validateAdminRecoveryHeartbeatCadence(
            DEFAULT_HEARTBEAT_INTERVAL_MS,
        ),
        getLiveGameIds: () => liveGameIdsFromService(gameService),
    });

    // Startup repair and the first live-game heartbeat finish before listen().
    // No socket or HTTP request can race financial reconciliation.
    await recoveryMonitor.runNow();

    registerGameHandlers(io, gameService);
    app.use('/api/auth', createAuthRoutes(pool, bcrypt, jwt, io));
    app.use('/api/leaderboard', createLeaderboardRoutes(pool, jwt));
    app.use('/api/players', createPlayerRoutes(pool, jwt));
    app.use('/api/seasons', createSeasonRoutes(pool, jwt));
    app.use('/api/admin', createAdminRoutes(pool, jwt, io, {
        getLiveGameIds: () => liveGameIdsFromService(gameService),
    }));
    app.use('/api/feedback', createFeedbackRoutes(pool, jwt));
    app.use('/api/chat', createChatRoutes(pool, io, jwt));
    app.use('/api/ping', createPingRoutes());
    app.use('/api/metrics', createMetricsRoutes(pool, jwt));

    app.get('/health', async (req, res) => {
        try {
            await pool.query('SELECT 1');
            res.json({ status: 'ok', db: 'up', uptime: Math.floor(process.uptime()) });
        } catch (error) {
            res.status(503).json({ status: 'degraded', db: 'down', uptime: Math.floor(process.uptime()) });
        }
    });

    app.use('/api/bot-insurance', createBotInsuranceStatsRoutes(pool));
    recoveryMonitor.start();
    return { gameService, pool, recoveryMonitor };
}

async function initializeThenListen({
    initialize = initializeApplication,
    httpServer = server,
    port = PORT,
} = {}) {
    await initialize();
    await new Promise((resolve, reject) => {
        const onError = error => reject(error);
        httpServer.once('error', onError);
        httpServer.listen(port, () => {
            httpServer.off('error', onError);
            resolve();
        });
    });
}

async function startServer() {
    await initializeThenListen();
    console.log(`Sluff Game Server running on port ${PORT}`);
}

if (require.main === module) {
    startServer().catch(error => {
        console.error('Sluff server startup failed:', error);
        process.exit(1);
    });
}

module.exports = {
    app,
    initializeApplication,
    initializeThenListen,
    recoveryTimingFromEnvironment,
    server,
    startServer,
};
