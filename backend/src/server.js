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
const createTipsRoutes = require('./api/tips');
const createDbTables = require('./data/createTables');
const { ensureBotAccounts } = require('./data/botAccounts');
const createPingRoutes = require('./api/ping');
const createMetricsRoutes = require('./api/metrics');
const createErrorRoutes = require('./api/errors');
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
const {
    createBotExhibitionManager,
    DEFAULT_EXHIBITION_INTERVAL_MS,
    MINIMUM_EXHIBITION_INTERVAL_MS,
    DEFAULT_EXHIBITION_TABLE_IDS,
} = require('./maintenance/botExhibition');

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

function botExhibitionConfigFromEnvironment() {
    const enabled = process.env.BOT_EXHIBITION_ENABLED !== 'false';
    // The comma-separated list wins; the legacy single-table variable is
    // still honored so an existing Render override keeps working.
    const rawTables = process.env.BOT_EXHIBITION_TABLE_IDS
        || process.env.BOT_EXHIBITION_TABLE_ID
        || DEFAULT_EXHIBITION_TABLE_IDS.join(',');
    const tableIds = rawTables.split(',').map(id => id.trim()).filter(Boolean);
    if (tableIds.length === 0) {
        throw new Error('BOT_EXHIBITION_TABLE_IDS must name at least one table.');
    }
    const intervalSeconds = process.env.BOT_EXHIBITION_INTERVAL_SECONDS === undefined
        ? DEFAULT_EXHIBITION_INTERVAL_MS / 1000
        : Number(process.env.BOT_EXHIBITION_INTERVAL_SECONDS);
    if (!Number.isFinite(intervalSeconds) || intervalSeconds * 1000 < MINIMUM_EXHIBITION_INTERVAL_MS) {
        throw new Error('BOT_EXHIBITION_INTERVAL_SECONDS must be at least 10.');
    }
    return { enabled, tableIds, intervalMs: Math.round(intervalSeconds * 1000) };
}

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
    app.use('/api/auth', createAuthRoutes(pool, bcrypt, jwt, io, gameService));
    app.use('/api/leaderboard', createLeaderboardRoutes(pool, jwt));
    app.use('/api/players', createPlayerRoutes(pool, jwt));
    app.use('/api/seasons', createSeasonRoutes(pool, jwt));
    app.use('/api/admin', createAdminRoutes(pool, jwt, io, {
        getLiveGameIds: () => liveGameIdsFromService(gameService),
        // Registered by gameEvents, which owns the voice rooms: a chat mute
        // must end a live voice session, not just block the next join.
        ejectFromVoice: (userId) => gameService.ejectUserFromVoiceRooms?.(userId) ?? 0,
    }));
    app.use('/api/feedback', createFeedbackRoutes(pool, jwt));
    app.use('/api/chat', createChatRoutes(pool, io, jwt));
    app.use('/api/tips', createTipsRoutes(pool, jwt));
    app.use('/api/ping', createPingRoutes());
    app.use('/api/metrics', createMetricsRoutes(pool, jwt));
    app.use('/api/errors', createErrorRoutes(pool, jwt));
    // The crash table is written by a public endpoint; boot-time trimming alone
    // leaves growth unbounded between deploys. Hourly keeps it at ~5000 rows no
    // matter how badly a bad build crash-loops in the field.
    setInterval(async () => {
        try {
            await pool.query("DELETE FROM client_errors WHERE created_at < NOW() - INTERVAL '30 days'");
            await pool.query(`DELETE FROM client_errors WHERE id NOT IN (
                SELECT id FROM client_errors ORDER BY id DESC LIMIT 5000
            )`);
        } catch (error) {
            console.error('client_errors trim failed:', error.message);
        }
    }, 60 * 60 * 1000).unref();

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

    // Continuous 3-bot exhibition games (analytics feed for round_results,
    // and — on the higher-stakes table — the slow mercy-driven token faucet).
    const exhibitionConfig = botExhibitionConfigFromEnvironment();
    let botExhibition = null;
    if (exhibitionConfig.enabled) {
        botExhibition = createBotExhibitionManager({
            gameService,
            tableIds: exhibitionConfig.tableIds,
            intervalMs: exhibitionConfig.intervalMs,
        });
        botExhibition.start();
    }

    return { gameService, pool, recoveryMonitor, botExhibition };
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

// Render sends SIGTERM before replacing the instance, and until now the
// process just died: sockets dropped mid-trick with no explanation, and the
// games surfaced later as "Abandoned after server interruption". In-memory
// engines cannot be saved on the way out, but the clients CAN be told what is
// happening, so the drop reads as an update instead of a mystery. The refunds
// stay abandonedGameRecovery's job on the next boot.
function registerShutdownNotice() {
    process.once('SIGTERM', () => {
        console.log('[SHUTDOWN] SIGTERM received — notifying clients, exiting shortly.');
        try {
            io.emit('serverRestarting');
        } catch (error) {
            console.error('[SHUTDOWN] Failed to notify clients:', error.message);
        }
        // Long enough for the emit to flush, short enough that Render's kill
        // window is never in play. Deliberately referenced: the timer IS the
        // reason the process stays alive to flush.
        setTimeout(() => process.exit(0), 1200);
    });
}

async function startServer() {
    await initializeThenListen();
    registerShutdownNotice();
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
