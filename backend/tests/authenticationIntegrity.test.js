'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const jsonwebtoken = require('jsonwebtoken');
const createLeaderboardRoutes = require('../src/api/leaderboard');
const createChatRoutes = require('../src/api/chat');
const createFeedbackRoutes = require('../src/api/feedback');
const createAdminRoutes = require('../src/api/admin');
const registerGameHandlers = require('../src/events/gameEvents');

async function listen(server) {
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
}

async function close(server) {
    await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
    });
}

function createJwtStub(payloads) {
    return {
        verify(token, _secret, callback) {
            const payload = payloads[token];
            if (!payload) return callback(new Error('invalid token'));
            return callback(null, { ...payload });
        },
    };
}

function createHttpPool() {
    const users = new Map([
        [1, { id: 1, username: 'CurrentName', is_admin: false }],
        [2, { id: 2, username: 'CurrentAdmin', is_admin: true }],
    ]);
    const state = {
        users,
        queries: [],
        chatInserts: [],
        feedbackReads: [],
        feedbackUpdates: 0,
        leaderboardReads: 0,
    };

    const pool = {
        async query(text, params = []) {
            const sql = String(text);
            state.queries.push({ text: sql, params });

            if (/SELECT\s+id,\s*username,\s*is_admin\s+FROM\s+users\s+WHERE\s+id\s*=\s*\$1/i.test(sql)) {
                const user = users.get(Number(params[0]));
                return { rows: user ? [{ ...user }] : [] };
            }
            if (/FROM\s+users\s+u/i.test(sql)) {
                state.leaderboardReads += 1;
                return { rows: [{ username: 'CurrentName', wins: 1, losses: 2, washes: 3, tokens: '4.00' }] };
            }
            if (/INSERT\s+INTO\s+lobby_chat_messages/i.test(sql)) {
                state.chatInserts.push([...params]);
                return {
                    rows: [{ id: 10, username: params[1], message: params[2], created_at: new Date(0).toISOString() }],
                };
            }
            if (/FROM\s+lobby_chat_messages/i.test(sql)) return { rows: [] };
            if (/FROM\s+feedback/i.test(sql)) {
                state.feedbackReads.push(sql);
                const row = {
                    feedback_id: 20,
                    user_id: 1,
                    username: 'CurrentName',
                    feedback_text: 'test',
                    status: 'new',
                };
                if (/admin_notes/i.test(sql)) row.admin_notes = 'private';
                return { rows: [row] };
            }
            if (/UPDATE\s+feedback/i.test(sql)) {
                state.feedbackUpdates += 1;
                return { rows: [{ feedback_id: Number(params.at(-1)), status: params[0] }] };
            }

            throw new Error(`Unexpected authentication HTTP test query: ${sql}`);
        },
    };

    return { pool, state };
}

async function testHttpAuthenticationHydration() {
    const { pool, state } = createHttpPool();
    const jwt = createJwtStub({
        'deleted-token': { id: 999, username: 'DeletedName', is_admin: true },
        'stale-user-token': { id: 1, username: 'TokenName', is_admin: true },
        'stale-non-admin-token': { id: 2, username: 'OldAdminName', is_admin: false },
    });
    const io = { emit() {} };
    const app = express();
    app.use(express.json());
    app.use('/api/leaderboard', createLeaderboardRoutes(pool, jwt));
    app.use('/api/chat', createChatRoutes(pool, io, jwt));
    app.use('/api/feedback', createFeedbackRoutes(pool, jwt));
    app.use('/api/admin', createAdminRoutes(pool, jwt));
    const server = http.createServer(app);

    await listen(server);
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}/api`;

    try {
        const deletedResponse = await fetch(`${baseUrl}/leaderboard`, {
            headers: { Authorization: 'Bearer deleted-token' },
        });
        assert.equal(deletedResponse.status, 401, 'a valid token cannot outlive its deleted account');
        assert.equal(state.leaderboardReads, 0, 'deleted accounts are rejected before protected data is read');

        const chatResponse = await fetch(`${baseUrl}/chat`, {
            method: 'POST',
            headers: {
                Authorization: 'Bearer stale-user-token',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ message: 'hello' }),
        });
        assert.equal(chatResponse.status, 201);
        assert.deepEqual(
            state.chatInserts.at(-1).slice(0, 3),
            [1, 'CurrentName', 'hello'],
            'chat authorship comes from the current database username, not JWT claims',
        );

        const regularFeedbackResponse = await fetch(`${baseUrl}/feedback`, {
            headers: { Authorization: 'Bearer stale-user-token' },
        });
        assert.equal(regularFeedbackResponse.status, 200);
        assert.match(state.feedbackReads.at(-1), /WHERE\s+status\s*!=\s*'hidden'/i);
        assert.doesNotMatch(state.feedbackReads.at(-1), /admin_notes/i);
        assert.equal((await regularFeedbackResponse.json())[0].admin_notes, undefined);

        const staleAdminUpdate = await fetch(`${baseUrl}/feedback/20`, {
            method: 'PUT',
            headers: {
                Authorization: 'Bearer stale-user-token',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ status: 'resolved', admin_notes: 'should not write' }),
        });
        assert.equal(staleAdminUpdate.status, 403, 'a stale admin claim cannot update feedback');
        assert.equal(state.feedbackUpdates, 0);

        const staleAdminRoute = await fetch(`${baseUrl}/admin/mercy-token-report`, {
            headers: { Authorization: 'Bearer stale-user-token' },
        });
        assert.equal(staleAdminRoute.status, 403, 'admin routes use current database privileges');

        const currentAdminFeedback = await fetch(`${baseUrl}/feedback`, {
            headers: { Authorization: 'Bearer stale-non-admin-token' },
        });
        assert.equal(currentAdminFeedback.status, 200);
        assert.match(state.feedbackReads.at(-1), /admin_notes/i, 'a current DB admin is authoritative over stale JWT claims');
        assert.equal((await currentAdminFeedback.json())[0].admin_notes, 'private');
    } finally {
        await close(server);
    }
}

function createSocketHarness(gameService, handlerOptions = {}) {
    let authMiddleware;
    let connectionHandler;
    let disconnectCalls = 0;
    const io = {
        sockets: { sockets: new Map() },
        use(handler) { authMiddleware = handler; },
        on(event, handler) {
            if (event === 'connection') connectionHandler = handler;
        },
        emit() {},
        disconnectSockets() { disconnectCalls += 1; },
    };
    gameService.io = io;
    registerGameHandlers(io, gameService, handlerOptions);

    return {
        io,
        get disconnectCalls() { return disconnectCalls; },
        async authenticate(socket) {
            return new Promise(resolve => authMiddleware(socket, error => resolve(error)));
        },
        connect(socket) {
            const handlers = {};
            socket.data = socket.data || {};
            socket.emitted = socket.emitted || [];
            socket.rooms = socket.rooms || new Set();
            socket.on = (event, handler) => { handlers[event] = handler; };
            socket.emit = (event, payload) => { socket.emitted.push({ event, payload }); };
            socket.join = room => socket.rooms.add(room);
            socket.leave = room => socket.rooms.delete(room);
            socket.disconnect = force => {
                socket.disconnected = true;
                socket.forcedDisconnect = force === true;
            };
            io.sockets.sockets.set(socket.id, socket);
            connectionHandler(socket);
            return {
                socket,
                async trigger(event, payload) {
                    if (!handlers[event]) throw new Error(`No socket handler registered for ${event}`);
                    return handlers[event](payload);
                },
            };
        },
    };
}

function createIntervalController() {
    const timers = [];
    return {
        timers,
        setIntervalFn(callback, delay) {
            const timer = {
                callback,
                delay,
                cleared: false,
                unrefCalled: false,
                unref() { this.unrefCalled = true; },
            };
            timers.push(timer);
            return timer;
        },
        clearIntervalFn(timer) {
            timer.cleared = true;
        },
        async tick(timer) {
            assert.equal(timer.cleared, false, 'cannot tick a cleared identity refresh timer');
            await timer.callback();
        },
    };
}

function createSocketPool() {
    const users = new Map([[7, {
        id: 7,
        username: 'DatabaseName',
        email: 'database@example.test',
        created_at: '2026-01-01T00:00:00.000Z',
        wins: 4,
        losses: 2,
        washes: 1,
        is_admin: true,
        is_vip: false,
        tutorial_version: 0,
        tutorial_active_version: 1,
    }]]);
    const state = { users, identityReads: 0, profileReads: 0, tokenReads: 0, failIdentityReads: false };
    const pool = {
        async query(text, params = []) {
            const sql = String(text);
            if (/tutorial_version/i.test(sql) && /FROM\s+users/i.test(sql)) {
                state.profileReads += 1;
                const user = users.get(Number(params[0]));
                return { rows: user ? [{ ...user }] : [] };
            }
            if (/SELECT\s+id,\s*username,\s*is_admin\s+FROM\s+users/i.test(sql)) {
                state.identityReads += 1;
                if (state.failIdentityReads) throw new Error('forced identity refresh failure');
                const user = users.get(Number(params[0]));
                return { rows: user ? [{ id: user.id, username: user.username, is_admin: user.is_admin }] : [] };
            }
            if (/SUM\(amount\)/i.test(sql)) {
                state.tokenReads += 1;
                return { rows: [{ tokens: '10.00', current_tokens: '10.00' }] };
            }
            if (/INSERT\s+INTO\s+lobby_chat_messages/i.test(sql)) return { rows: [{}] };
            throw new Error(`Unexpected authentication socket test query: ${sql}`);
        },
    };
    return { pool, state };
}

function makeSocket(id, token) {
    return {
        id,
        handshake: { auth: { token } },
        data: {},
    };
}

async function testSocketAuthenticationAndAdminRevocation() {
    const originalSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'authentication-integrity-secret';
    assert.equal(registerGameHandlers.DEFAULT_SOCKET_AUTH_REFRESH_INTERVAL_MS, 60_000);
    const { pool, state } = createSocketPool();
    const intervalController = createIntervalController();
    let engines = {};
    const counters = {
        reset: 0,
        addBot: 0,
        removeBot: 0,
        startGame: 0,
        join: 0,
    };
    const gameService = {
        pool,
        getAllEngines: () => engines,
        getEngineById: tableId => engines[tableId],
        getLobbyState: () => ({ themes: [] }),
        getStateForSocket: (_engine, currentSocket) => ({
            players: {},
            playerOrderActive: [],
            hands: currentSocket.user?.is_admin === true
                && currentSocket.data?.trustedAdminObserver === true
                ? { Secret: ['AS'] }
                : {},
        }),
        emitGameState() {},
        evaluateQuickPlayTable() {},
        evaluateTerminalCleanup() {},
        hasActiveOrPendingGame: () => false,
        resetAllEngines() { counters.reset += 1; },
        startGame() { counters.startGame += 1; },
        async _executeEffects() {},
    };
    const harness = createSocketHarness(gameService, {
        socketAuthRefreshIntervalMs: 1_234,
        setIntervalFn: intervalController.setIntervalFn,
        clearIntervalFn: intervalController.clearIntervalFn,
    });

    try {
        const staleToken = jsonwebtoken.sign(
            { id: 7, username: 'TokenName', is_admin: false },
            process.env.JWT_SECRET,
        );
        const socket = makeSocket('auth-socket', staleToken);
        const authError = await harness.authenticate(socket);
        assert.equal(authError, undefined);
        assert.deepEqual(socket.user, {
            id: 7,
            username: 'DatabaseName',
            is_admin: true,
        }, 'socket identity and privileges are hydrated from the database');

        const deletedToken = jsonwebtoken.sign(
            { id: 999, username: 'Deleted', is_admin: true },
            process.env.JWT_SECRET,
        );
        const deletedError = await harness.authenticate(makeSocket('deleted-socket', deletedToken));
        assert.match(deletedError.message, /account no longer exists/i);

        const connected = harness.connect(socket);
        const identityRefreshTimer = intervalController.timers[0];
        assert.equal(identityRefreshTimer.delay, 1_234, 'the refresh interval is test-overridable');
        assert.equal(identityRefreshTimer.unrefCalled, true, 'the refresh timer must not keep the process alive');
        const player = {
            userId: 7,
            playerName: 'DatabaseName',
            socketId: socket.id,
            isSpectator: false,
        };
        const bot = { userId: -1, playerName: 'Lee', socketId: null, isSpectator: false, isBot: true };
        const playerOrder = {
            count: 1,
            allIds: [7],
            includes(id) { return this.allIds.includes(Number(id)); },
            remove(id) {
                this.allIds = this.allIds.filter(value => value !== Number(id));
                this.count = this.allIds.length;
            },
        };
        const engine = {
            tableId: 'auth-table',
            tableType: 'private',
            state: 'Waiting for Players',
            gameStarted: false,
            gameStartPending: false,
            players: { 7: player, [-1]: bot },
            playerOrder,
            joinTable() { counters.join += 1; },
            leaveTable() {},
            addBotPlayer() { counters.addBot += 1; },
            removeBot() { counters.removeBot += 1; },
            startGame() { counters.startGame += 1; },
            disconnectPlayer() { player.socketId = null; },
        };
        engines = { [engine.tableId]: engine };

        await connected.trigger('requestUserSync');
        const synchronizedUser = socket.emitted.filter(item => item.event === 'updateUser').at(-1)?.payload;
        assert.deepEqual({
            wins: synchronizedUser?.wins,
            losses: synchronizedUser?.losses,
            washes: synchronizedUser?.washes,
            games_played: synchronizedUser?.games_played,
            tutorial_version: synchronizedUser?.tutorial_version,
            tutorial_active_version: synchronizedUser?.tutorial_active_version,
        }, {
            wins: 4,
            losses: 2,
            washes: 1,
            games_played: 7,
            tutorial_version: 0,
            tutorial_active_version: 1,
        }, 'socket profile sync returns aggregate stats and durable tutorial progress');
        assert.equal(state.profileReads, 1);
        assert.equal(state.tokenReads, 1);

        socket.data.trustedAdminObserver = true;
        state.users.set(7, { id: 7, username: 'RenamedAfterLogin', is_admin: false });
        const gameStatesBeforePassiveDemotion = socket.emitted.filter(item => item.event === 'gameState').length;
        await intervalController.tick(identityRefreshTimer);
        const passiveDemotionState = socket.emitted.filter(item => item.event === 'gameState').at(-1);
        assert.equal(socket.user.username, 'RenamedAfterLogin');
        assert.equal(socket.user.is_admin, false);
        assert.equal(socket.data.trustedAdminObserver, false);
        assert.deepEqual(passiveDemotionState.payload.hands, {}, 'periodic demotion immediately re-emits redacted state');
        assert.equal(
            socket.emitted.filter(item => item.event === 'gameState').length,
            gameStatesBeforePassiveDemotion + 1,
        );

        const privilegedActions = [
            ['hardResetServer', undefined],
            ['joinTable', { tableId: engine.tableId, asSpectator: true }],
            ['moveToSpectator', { tableId: engine.tableId }],
            ['addBot', { tableId: engine.tableId, name: 'Bot' }],
            ['removeBot', { tableId: engine.tableId }],
            ['startGameAsBot', { tableId: engine.tableId, botPlayerId: -1 }],
            ['startBotGame', { botCount: 3 }],
        ];
        for (const [eventName, payload] of privilegedActions) {
            const identityReadsBefore = state.identityReads;
            socket.data.trustedAdminObserver = true;
            await connected.trigger(eventName, payload);
            assert.equal(
                state.identityReads,
                identityReadsBefore + 1,
                `${eventName} must refresh admin status from the database`,
            );
            assert.equal(
                socket.data.trustedAdminObserver,
                false,
                `${eventName} must revoke trusted observer access after demotion`,
            );
        }

        assert.equal(socket.user.username, 'RenamedAfterLogin', 'action-time refresh also updates stale socket identity');
        assert.equal(socket.user.is_admin, false);
        assert.equal(socket.data.trustedAdminObserver, false, 'demotion revokes unredacted observer trust');
        assert.deepEqual(counters, {
            reset: 0,
            addBot: 0,
            removeBot: 0,
            startGame: 0,
            join: 0,
        }, 'a demoted admin cannot perform any privileged socket operation');
        assert.equal(player.isSpectator, false, 'demoted admins cannot move into observer mode');
        assert.ok(socket.emitted.filter(item => item.event === 'error').length >= 7);
        assert.equal(harness.disconnectCalls, 0);

        state.users.set(7, { id: 7, username: 'RestoredAdmin', is_admin: true });
        const readsBeforeAuthorizedAction = state.identityReads;
        await connected.trigger('addBot', { tableId: engine.tableId, name: 'Authorized Bot' });
        assert.equal(state.identityReads, readsBeforeAuthorizedAction + 1);
        assert.equal(socket.user.username, 'RestoredAdmin');
        assert.equal(socket.user.is_admin, true);
        assert.equal(counters.addBot, 1, 'a current database admin can still use privileged actions');

        socket.data.trustedAdminObserver = true;
        state.failIdentityReads = true;
        const statesBeforeRefreshFailure = socket.emitted.filter(item => item.event === 'gameState').length;
        const originalConsoleError = console.error;
        console.error = () => {};
        try {
            await intervalController.tick(identityRefreshTimer);
        } finally {
            console.error = originalConsoleError;
        }
        state.failIdentityReads = false;
        assert.equal(socket.user.is_admin, false, 'a refresh failure fails closed for cached admin status');
        assert.equal(socket.data.trustedAdminObserver, false);
        assert.equal(socket.disconnected, undefined, 'a transient DB failure redacts but does not disconnect the user');
        assert.equal(
            socket.emitted.filter(item => item.event === 'gameState').length,
            statesBeforeRefreshFailure + 1,
        );
        assert.deepEqual(
            socket.emitted.filter(item => item.event === 'gameState').at(-1).payload.hands,
            {},
        );

        state.users.set(7, { id: 7, username: 'AdminBeforeDeletion', is_admin: true });
        await connected.trigger('addBot', { tableId: engine.tableId, name: 'Second Authorized Bot' });
        assert.equal(socket.user.is_admin, true);
        assert.equal(counters.addBot, 2);

        socket.data.trustedAdminObserver = true;
        state.users.delete(7);
        const statesBeforeDeletion = socket.emitted.filter(item => item.event === 'gameState').length;
        await intervalController.tick(identityRefreshTimer);
        assert.equal(socket.data.trustedAdminObserver, false);
        assert.equal(socket.disconnected, true, 'a deleted live account is disconnected on the next refresh');
        assert.equal(socket.forcedDisconnect, true);
        assert.equal(
            socket.emitted.filter(item => item.event === 'gameState').length,
            statesBeforeDeletion + 1,
            'a trusted observer is redacted before deletion disconnects the socket',
        );
        assert.deepEqual(
            socket.emitted.filter(item => item.event === 'gameState').at(-1).payload.hands,
            {},
        );

        await connected.trigger('disconnect');
        assert.equal(identityRefreshTimer.cleared, true, 'disconnect clears the periodic identity refresh');
    } finally {
        if (originalSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = originalSecret;
    }
}

async function runAuthenticationIntegrityTests() {
    await testHttpAuthenticationHydration();
    await testSocketAuthenticationAndAdminRevocation();
    console.log('Authentication revocation and identity-integrity tests passed.');
}

if (require.main === module) {
    runAuthenticationIntegrityTests().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = runAuthenticationIntegrityTests;
