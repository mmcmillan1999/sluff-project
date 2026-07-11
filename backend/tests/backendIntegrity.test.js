'use strict';

const assert = require('node:assert/strict');
const GameEngine = require('../src/core/GameEngine');
const GameService = require('../src/services/GameService');
const gameLogic = require('../src/core/logic');
const transactionManager = require('../src/data/transactionManager');
const { deck } = require('../src/core/constants');
const { authorizeTableAction, validators } = require('../src/events/socketActionGuard');
const registerGameHandlers = require('../src/events/gameEvents');

function makeEngine(id = 'integrity-table') {
    const engine = new GameEngine(id, 'fort-creek', 'Integrity Table');
    engine.joinTable({ id: 1, username: 'Alice' }, 'socket-1', '10.00');
    engine.joinTable({ id: 2, username: 'Bob' }, 'socket-2', '20.00');
    engine.joinTable({ id: 3, username: 'Cara' }, 'socket-3', '30.00');
    engine.gameStarted = true;
    engine.gameId = 99;
    engine.playerMode = 3;
    engine.scores = { Alice: 120, Bob: 100, Cara: 80, ScoreAbsorber: 120 };
    engine.playerOrder.setTurnOrder(1);
    return engine;
}

function testPlayAndFrogGuards() {
    const engine = makeEngine();
    engine.state = 'TrickCompleteLinger';
    engine.trickTurnPlayerId = 1;
    engine.trumpSuit = 'H';
    engine.hands = { Alice: ['6S'], Bob: [], Cara: [] };
    engine.playCard(1, '6S');
    assert.deepEqual(engine.hands.Alice, ['6S'], 'trick-linger cannot consume a fourth card');
    assert.equal(engine.currentTrickCards.length, 0);

    engine.state = 'Frog Widow Exchange';
    engine.bidWinnerInfo = { userId: 1, playerName: 'Alice', bid: 'Frog' };
    const fourteenCards = deck.slice(0, 14);
    engine.hands.Alice = [...fourteenCards];
    const duplicateResult = engine.submitFrogDiscards(1, [fourteenCards[0], fourteenCards[0], fourteenCards[1]]);
    assert.equal(duplicateResult.effects.length, 0, 'duplicate Frog selections are rejected');
    assert.equal(engine.hands.Alice.length, 14);

    const accepted = engine.submitFrogDiscards(1, fourteenCards.slice(0, 3));
    assert.equal(engine.hands.Alice.length, 11, 'a valid Frog exchange leaves exactly eleven cards');
    assert.deepEqual(engine.widowDiscardsForFrogBidder, fourteenCards.slice(0, 3));
    assert.ok(accepted.effects.some(effect => effect.type === 'START_TIMER'));
}

function testBidAnnouncementTimerLifecycle() {
    const engine = makeEngine('bid-announcement-timer');
    engine.bidWinnerInfo = { userId: 1, playerName: 'Alice', bid: 'Solo' };

    const timer = engine._transitionToPlayingPhase();
    assert.equal(engine.state, 'Bid Announcement');
    assert.equal(timer.type, 'START_TIMER');
    assert.equal(timer.payload.duration, 6000, 'server hold leaves 1.3s beyond the condensed 4.7s client sequence');

    const effects = timer.payload.onTimeout(engine);
    assert.equal(engine.state, 'Playing Phase');
    assert.deepEqual(effects, [{ type: 'BROADCAST_STATE' }]);
    assert.deepEqual(timer.payload.onTimeout(engine), [], 'the announcement timer is single-use');

    const interrupted = makeEngine('interrupted-bid-announcement');
    interrupted.bidWinnerInfo = { userId: 1, playerName: 'Alice', bid: 'Frog' };
    const interruptedTimer = interrupted._transitionToPlayingPhase();
    interrupted.state = 'Game Over';
    assert.deepEqual(
        interruptedTimer.payload.onTimeout(interrupted),
        [],
        'a reset or forfeit cannot resurrect play after the splash'
    );
}

function testInsuranceOvershootIsZeroSum() {
    const engine = makeEngine();
    engine.state = 'Playing Phase';
    engine.bidWinnerInfo = { userId: 1, playerName: 'Alice', bid: 'Frog' };
    engine.insurance = {
        isActive: true,
        bidMultiplier: 1,
        bidderPlayerName: 'Alice',
        bidderRequirement: 50,
        defenderOffers: { Bob: 30, Cara: 0 },
        dealExecuted: false,
        executedDetails: null,
    };

    engine.updateInsuranceSetting(3, 'defenderOffer', 30);
    assert.equal(engine.insurance.dealExecuted, true);
    assert.equal(engine.insurance.executedDetails.agreement.bidderSettlement, 60);

    const round = gameLogic.calculateRoundScoreDetails({
        ...engine,
        bidderTotalCardPoints: 60,
        playerOrderActive: engine.playerOrder.turnOrder,
        capturedTricks: {},
        originalDealtWidow: [],
    });
    assert.deepEqual(
        { Alice: round.pointChanges.Alice, Bob: round.pointChanges.Bob, Cara: round.pointChanges.Cara },
        { Alice: 60, Bob: -30, Cara: -30 },
    );
    assert.equal(Object.values(round.pointChanges).reduce((sum, value) => sum + value, 0), 0);
}

function testDrawVotePausesPlayAndGuardsTransitions() {
    const engine = makeEngine();
    engine.state = 'Playing Phase';
    engine.trickTurnPlayerId = 1;
    engine.trumpSuit = 'H';
    engine.hands = { Alice: ['6S'], Bob: ['7S'], Cara: ['8S'] };

    engine.requestDraw(1);
    assert.equal(engine.drawRequest.isActive, true);
    engine.playCard(1, '6S');
    assert.deepEqual(engine.hands.Alice, ['6S'], 'play is paused while votes are outstanding');

    const declined = engine.submitDrawVote(2, 'no');
    assert.equal(engine.state, 'DrawDeclined');
    const declineTimer = declined.effects.find(effect => effect.type === 'START_TIMER');
    engine.state = 'Game Over';
    assert.deepEqual(declineTimer.payload.onTimeout(engine), [], 'a stale decline timer cannot resurrect play');

    const acceptedEngine = makeEngine('draw-accepted');
    acceptedEngine.state = 'Playing Phase';
    acceptedEngine.requestDraw(1);
    acceptedEngine.submitDrawVote(2, 'wash');
    const accepted = acceptedEngine.submitDrawVote(3, 'wash');
    assert.equal(acceptedEngine.state, 'Draw Resolving', 'accepted draw exits Playing Phase before settlement');
    assert.ok(accepted.effects.some(effect => effect.type === 'HANDLE_DRAW_OUTCOME'));
}

function makeSocket(user) {
    const emitted = [];
    return {
        id: `socket-${user.id}`,
        user,
        data: {},
        emitted,
        emit(event, payload) { emitted.push({ event, payload }); },
    };
}

function makeSocketServerHarness(gameService) {
    let connectionHandler;
    let disconnectCalls = 0;
    const emitted = [];
    const io = {
        sockets: { sockets: new Map() },
        use() {},
        on(event, handler) {
            if (event === 'connection') connectionHandler = handler;
        },
        emit(event, payload) { emitted.push({ event, payload }); },
        disconnectSockets() { disconnectCalls += 1; },
    };
    gameService.io = io;
    registerGameHandlers(io, gameService);

    return {
        io,
        emitted,
        get disconnectCalls() { return disconnectCalls; },
        connect(user, socketId) {
            const handlers = {};
            const socket = {
                id: socketId,
                user,
                data: {},
                emitted: [],
                rooms: new Set(),
                on(event, handler) { handlers[event] = handler; },
                emit(event, payload) { this.emitted.push({ event, payload }); },
                join(room) { this.rooms.add(room); },
                leave(room) { this.rooms.delete(room); },
            };
            io.sockets.sockets.set(socketId, socket);
            connectionHandler(socket);
            return {
                socket,
                trigger(event, payload) {
                    if (!handlers[event]) throw new Error(`No socket handler registered for ${event}`);
                    return handlers[event](payload);
                },
            };
        },
    };
}

function testSocketActionGuard() {
    const engine = makeEngine();
    const realLookup = Object.create(GameService.prototype);
    realLookup.engines = { [engine.tableId]: engine };
    assert.equal(realLookup.getEngineById('__proto__'), undefined, 'prototype keys are never treated as tables');
    const gameService = { getEngineById: tableId => tableId === engine.tableId ? engine : null };
    const member = makeSocket({ id: 1, username: 'Alice', is_admin: false });

    assert.equal(authorizeTableAction(member, gameService, null), null);
    assert.match(member.emitted.at(-1).payload.message, /payload/i);
    assert.equal(authorizeTableAction(member, gameService, { tableId: 'missing' }), null);
    assert.match(member.emitted.at(-1).payload.message, /not found/i);
    assert.equal(authorizeTableAction(member, gameService, { tableId: '__proto__' }), null);

    const outsider = makeSocket({ id: 50, username: 'Outside', is_admin: false });
    assert.equal(authorizeTableAction(outsider, gameService, { tableId: engine.tableId }), null);
    assert.match(outsider.emitted.at(-1).payload.message, /not at this table/i);

    engine.players[3].isSpectator = true;
    const spectator = makeSocket({ id: 3, username: 'Cara', is_admin: false });
    assert.equal(authorizeTableAction(spectator, gameService, { tableId: engine.tableId }), null);
    assert.match(spectator.emitted.at(-1).payload.message, /spectator/i);

    assert.equal(authorizeTableAction(member, gameService, { tableId: engine.tableId }, { adminOnly: true }), null);
    assert.match(member.emitted.at(-1).payload.message, /admin/i);

    const admin = makeSocket({ id: 3, username: 'Cara', is_admin: true });
    assert.ok(authorizeTableAction(admin, gameService, { tableId: engine.tableId }, { adminOnly: true, allowSpectator: true }));

    engine.state = 'Playing Phase';
    assert.equal(authorizeTableAction(member, gameService, { tableId: engine.tableId }, { validate: validators.terminalReset }), null);
    engine.state = 'Game Over';
    engine.settlement.status = 'complete';
    assert.ok(authorizeTableAction(member, gameService, { tableId: engine.tableId }, { validate: validators.terminalReset }));
    assert.equal(validators.frogDiscards({ discards: ['6H', '6H', '7H'] }), 'Choose three unique valid cards to discard.');

    const leftSeatEngine = makeEngine('left-seat-guard');
    const leftSeatService = { getEngineById: tableId => tableId === leftSeatEngine.tableId ? leftSeatEngine : null };
    const leavingSocket = makeSocket({ id: 1, username: 'Alice', is_admin: false });
    leftSeatEngine.leaveTable(1);
    assert.equal(authorizeTableAction(leavingSocket, leftSeatService, { tableId: leftSeatEngine.tableId }), null);
    assert.match(leavingSocket.emitted.at(-1).payload.message, /no longer controls/i);

    const supersededEngine = makeEngine('superseded-seat-guard');
    const supersededService = { getEngineById: tableId => tableId === supersededEngine.tableId ? supersededEngine : null };
    const oldSocket = makeSocket({ id: 1, username: 'Alice', is_admin: false });
    const replacementSocket = makeSocket({ id: 1, username: 'Alice', is_admin: false });
    replacementSocket.id = 'replacement-socket-1';
    supersededEngine.reconnectPlayer(1, replacementSocket);
    assert.equal(authorizeTableAction(oldSocket, supersededService, { tableId: supersededEngine.tableId }), null);
    assert.match(oldSocket.emitted.at(-1).payload.message, /no longer controls/i);
    assert.ok(authorizeTableAction(replacementSocket, supersededService, { tableId: supersededEngine.tableId }));
}

function testPersonalizedServiceDelivery() {
    const engine = makeEngine();
    engine.state = 'Playing Phase';
    engine.hands = { Alice: ['AS'], Bob: ['KS'], Cara: ['QS'] };
    engine.widow = ['6D', '7D', '8D'];
    engine.originalDealtWidow = [...engine.widow];
    engine.joinTable({ id: 4, username: 'Admin' }, 'socket-4', '40.00', true);

    const sockets = [
        makeSocket({ id: 1, username: 'Alice', is_admin: false }),
        makeSocket({ id: 2, username: 'Bob', is_admin: false }),
        makeSocket({ id: 3, username: 'Cara', is_admin: false }),
        makeSocket({ id: 4, username: 'Admin', is_admin: true }),
    ];
    sockets[3].data.trustedAdminObserver = true;

    const service = Object.create(GameService.prototype);
    service.engines = { [engine.tableId]: engine };
    service.io = { sockets: { sockets: new Map(sockets.map(socket => [socket.id, socket])) } };
    service.emitGameState(engine.tableId);

    const aliceState = sockets[0].emitted[0].payload;
    const bobState = sockets[1].emitted[0].payload;
    const adminState = sockets[3].emitted[0].payload;
    assert.deepEqual(aliceState.hands, { Alice: ['AS'] });
    assert.deepEqual(bobState.hands, { Bob: ['KS'] });
    assert.equal(aliceState.players[2].tokens, undefined, 'another player token is never delivered');
    assert.equal(aliceState.players[1].tokens, '10.00');
    assert.deepEqual(aliceState.widow, []);
    assert.deepEqual(adminState.hands, engine.hands, 'explicit server-trusted admin observer receives diagnostic hands');
    assert.equal(adminState.players[1].socketId, undefined, 'even trusted observers never receive socket ids');

    sockets.forEach(socket => { socket.emitted.length = 0; });
    engine.leaveTable(2);
    service.emitGameState(engine.tableId);
    assert.equal(engine.players[2].disconnected, true, 'an active leaver keeps a reserved disconnected seat');
    assert.equal(engine.players[2].socketId, null, 'an active leaver is detached from personalized delivery');
    assert.equal(sockets[1].emitted.length, 0, 'the leaving socket receives no state that could reopen the table');
    assert.equal(sockets[0].emitted.length, 1, 'remaining players still receive the disconnect state');
    assert.equal(sockets[2].emitted.length, 1, 'all other active players still receive state');

    const replacementSocket = makeSocket({ id: 2, username: 'Bob', is_admin: false });
    replacementSocket.id = 'socket-2-reconnected';
    service.io.sockets.sockets.set(replacementSocket.id, replacementSocket);
    assert.equal(engine.reconnectPlayer(2, replacementSocket), true);
    service.emitGameState(engine.tableId);
    assert.deepEqual(replacementSocket.emitted[0].payload.hands, { Bob: ['KS'] }, 'a legitimate reconnect regains its personalized hand');
}

async function testSocketSeatingAndResetRaces() {
    const tableA = new GameEngine('join-race-a', 'fort-creek', 'Join Race A');
    const tableB = new GameEngine('join-race-b', 'fort-creek', 'Join Race B');
    const engines = { [tableA.tableId]: tableA, [tableB.tableId]: tableB };
    const tokenResolvers = [];
    const joinService = {
        pool: {
            query(text) {
                assert.match(String(text), /SUM\(amount\)/);
                return new Promise(resolve => tokenResolvers.push(resolve));
            },
        },
        getAllEngines: () => engines,
        getEngineById: tableId => engines[tableId],
        getLobbyState: () => ({ themes: [] }),
        getStateForSocket: (engine, socket) => engine.getStateForClient({ userId: socket.user.id }),
        emitGameState() {},
        evaluateQuickPlayTable() {},
        evaluateTerminalCleanup() {},
        hasActiveOrPendingGame: () => false,
    };
    const joinHarness = makeSocketServerHarness(joinService);
    const account = { id: 77, username: 'Parallel', is_admin: false };
    const firstSocket = joinHarness.connect(account, 'parallel-socket-a');
    const secondSocket = joinHarness.connect(account, 'parallel-socket-b');
    const firstJoin = firstSocket.trigger('joinTable', { tableId: tableA.tableId });
    const secondJoin = secondSocket.trigger('joinTable', { tableId: tableB.tableId });
    assert.equal(tokenResolvers.length, 2, 'both joins reach the asynchronous balance read before either seats');
    tokenResolvers.forEach(resolve => resolve({ rows: [{ tokens: '10.00' }] }));
    await Promise.all([firstJoin, secondJoin]);

    const occupiedTables = Object.values(engines).filter(engine => engine.players[account.id]);
    assert.equal(occupiedTables.length, 1, 'fresh post-await lookup leaves one authoritative table seat');
    assert.equal(
        Object.values(engines).reduce((count, engine) => count + (engine.playerOrder.includes(account.id) ? 1 : 0), 0),
        1,
        'parallel sockets cannot create two active playerOrder entries',
    );

    const gateService = Object.create(GameService.prototype);
    const gateEngine = new GameEngine('reset-gate-state', 'fort-creek', 'Reset Gate State');
    gateService.engines = { [gateEngine.tableId]: gateEngine };
    gateEngine.gameStartPending = true;
    assert.equal(gateService.hasActiveOrPendingGame(), true, 'a committing start blocks hard reset');
    gateEngine.gameStartPending = false;
    gateEngine.gameStarted = true;
    gateEngine.state = 'Playing Phase';
    assert.equal(gateService.hasActiveOrPendingGame(), true, 'an active funded game blocks hard reset');
    gateEngine.state = 'Game Over';
    assert.equal(gateService.hasActiveOrPendingGame(), true, 'terminal tables remain protected until normal reset');
    gateEngine.gameStarted = false;
    assert.equal(gateService.hasActiveOrPendingGame(), false, 'a normally reset table permits hard reset');

    const timerService = Object.create(GameService.prototype);
    const fillTimer = { id: 'fill' };
    const windowTimer = { id: 'window' };
    const terminalTimer = { id: 'terminal-cleanup' };
    timerService.qpTimers = { 'qp-reset': { fill: fillTimer, window: windowTimer } };
    timerService.terminalCleanupTimers = { 'terminal-reset': { handle: terminalTimer } };
    timerService.engines = { old: gateEngine };
    timerService.io = { emit() {} };
    let initializeSawClearedTimers = false;
    timerService._initializeEngines = function initializeFreshEngines() {
        initializeSawClearedTimers = Object.keys(this.qpTimers).length === 0
            && Object.keys(this.terminalCleanupTimers).length === 0;
        this.engines = { fresh: {} };
        this.qpTimers = {};
    };
    const clearedTimers = [];
    const originalClearTimeout = global.clearTimeout;
    global.clearTimeout = timer => { clearedTimers.push(timer); };
    try {
        timerService.resetAllEngines();
    } finally {
        global.clearTimeout = originalClearTimeout;
    }
    assert.deepEqual(clearedTimers, [fillTimer, windowTimer, terminalTimer],
        'hard reset cancels Quick Play and terminal lifecycle timers');
    assert.equal(initializeSawClearedTimers, true, 'old timers are cleared before fresh engines replace the generation');

    const makeResetHarness = pendingSequence => {
        const pendingEngine = new GameEngine('reset-race', 'fort-creek', 'Reset Race');
        let pendingCheck = 0;
        let resetCalls = 0;
        let chatQueries = 0;
        const resetService = {
            pool: {
                async query(text) {
                    if (/SELECT\s+id,\s*username,\s*is_admin\s+FROM\s+users/i.test(String(text))) {
                        return { rows: [{ id: 90, username: 'Admin', is_admin: true }] };
                    }
                    if (/INSERT\s+INTO\s+lobby_chat_messages/i.test(String(text))) chatQueries += 1;
                    return { rows: [] };
                },
            },
            getAllEngines: () => ({ [pendingEngine.tableId]: pendingEngine }),
            getLobbyState: () => ({ themes: [] }),
            hasActiveOrPendingGame() {
                const value = pendingSequence[Math.min(pendingCheck, pendingSequence.length - 1)];
                pendingCheck += 1;
                return value;
            },
            resetAllEngines() { resetCalls += 1; },
        };
        const harness = makeSocketServerHarness(resetService);
        const admin = harness.connect({ id: 90, username: 'Admin', is_admin: true }, `reset-admin-${pendingSequence.join('-')}`);
        return {
            admin,
            harness,
            get resetCalls() { return resetCalls; },
            get chatQueries() { return chatQueries; },
        };
    };

    const alreadyPending = makeResetHarness([true]);
    await alreadyPending.admin.trigger('hardResetServer');
    assert.equal(alreadyPending.resetCalls, 0);
    assert.equal(alreadyPending.chatQueries, 0);
    assert.match(alreadyPending.admin.socket.emitted.at(-1).payload.message, /start or settlement|still active/i);

    const pendingAtFinalCheck = makeResetHarness([false, true]);
    await pendingAtFinalCheck.admin.trigger('hardResetServer');
    assert.equal(pendingAtFinalCheck.resetCalls, 0, 'the immediately-pre-reset recheck closes the commit race');
    assert.equal(pendingAtFinalCheck.chatQueries, 0);
    assert.match(pendingAtFinalCheck.admin.socket.emitted.at(-1).payload.message, /start or settlement|still active/i);

    const acceptedReset = makeResetHarness([false, false]);
    await acceptedReset.admin.trigger('hardResetServer');
    assert.equal(acceptedReset.resetCalls, 1);
    assert.equal(acceptedReset.harness.disconnectCalls, 1, 'accepted reset disconnects sockets immediately');
    assert.ok(acceptedReset.harness.emitted.some(item => item.event === 'forceDisconnectAndReset'));
}

function makeTransactionPool({ failOn } = {}) {
    const queries = [];
    let released = false;
    let openTransactions = 0;
    let releasedWithOpenTransaction = false;
    let connectCount = 0;
    const client = {
        async query(text, params) {
            const sql = String(text);
            queries.push({ text: sql, params });
            if (failOn && sql.includes(failOn)) throw new Error('forced transaction failure');
            if (sql === 'BEGIN') openTransactions += 1;
            if (sql === 'COMMIT' || sql === 'ROLLBACK') openTransactions -= 1;
            if (sql.includes('SELECT outcome FROM game_history')) {
                return { rows: [{ outcome: 'In Progress' }], rowCount: 1 };
            }
            if (sql.includes('SELECT id FROM users') && sql.includes('FOR UPDATE')) {
                return { rows: (params[0] || []).map(id => ({ id })), rowCount: params[0]?.length || 0 };
            }
            if (sql.includes('UPDATE game_history')) return { rows: [], rowCount: 1 };
            return { rows: [], rowCount: 0 };
        },
        release() {
            released = true;
            releasedWithOpenTransaction = openTransactions !== 0;
        },
    };
    return {
        queries,
        get released() { return released; },
        get connectCount() { return connectCount; },
        get openTransactions() { return openTransactions; },
        get releasedWithOpenTransaction() { return releasedWithOpenTransaction; },
        async connect() {
            connectCount += 1;
            return client;
        },
    };
}

async function testDrawTransactionFallback() {
    const fourPlayerDraw = {
        gameId: 808,
        theme: 'fort-creek',
        scores: { Alice: 120, Bob: 100, Cara: 80, Drew: 60 },
        players: {
            1: { userId: 1, playerName: 'Alice', isBot: false, isSpectator: false },
            2: { userId: 2, playerName: 'Bob', isBot: false, isSpectator: false },
            3: { userId: 3, playerName: 'Cara', isBot: false, isSpectator: false },
            4: { userId: 4, playerName: 'Drew', isBot: false, isSpectator: false },
        },
    };

    const pool = makeTransactionPool();
    const summary = await transactionManager.handleDrawTransactions(pool, fourPlayerDraw, 'split');
    assert.equal(summary.drawOutcome, 'wash', 'a four-player split vote resolves to the canonical wash');
    assert.equal(pool.connectCount, 1, 'the fallback uses exactly one database client');
    assert.equal(pool.queries.filter(query => query.text === 'BEGIN').length, 1);
    assert.equal(pool.queries.filter(query => query.text === 'COMMIT').length, 1);
    assert.equal(pool.queries.filter(query => query.text === 'ROLLBACK').length, 0);
    assert.equal(pool.openTransactions, 0);
    assert.equal(pool.releasedWithOpenTransaction, false, 'the client is never released inside an open transaction');
    assert.equal(Object.keys(summary.payouts).length, 4, 'all four funded humans receive wash returns');

    const failingPool = makeTransactionPool({ failOn: 'UPDATE game_history' });
    await assert.rejects(
        transactionManager.handleDrawTransactions(failingPool, fourPlayerDraw, 'split'),
        /forced transaction failure/,
    );
    assert.equal(failingPool.connectCount, 1);
    assert.equal(failingPool.queries.filter(query => query.text === 'ROLLBACK').length, 1);
    assert.equal(failingPool.queries.filter(query => query.text === 'COMMIT').length, 0);
    assert.equal(failingPool.openTransactions, 0);
    assert.equal(failingPool.releasedWithOpenTransaction, false, 'rollback closes the transaction before release');
}

function makeAtomicStartPool({ balances, usernames, failOnBuyInNumber = null }) {
    const queries = [];
    const persisted = { games: [], buyIns: [] };
    let pending = null;
    let released = false;
    let buyInAttempt = 0;
    const gameId = 701;

    const client = {
        async query(text, params) {
            const sql = String(text);
            queries.push({ text: sql, params });

            if (sql === 'BEGIN') {
                pending = { games: [], buyIns: [] };
                return { rows: [] };
            }
            if (sql === 'COMMIT') {
                persisted.games.push(...pending.games);
                persisted.buyIns.push(...pending.buyIns);
                pending = null;
                return { rows: [] };
            }
            if (sql === 'ROLLBACK') {
                pending = null;
                return { rows: [] };
            }
            if (sql.includes('INSERT INTO game_history')) {
                pending.games.push({ gameId, params });
                return { rows: [{ game_id: gameId }] };
            }
            if (sql.includes('FROM users') && sql.includes('FOR UPDATE')) {
                return {
                    rows: params[0].map(id => ({ id, username: usernames[id] || `User ${id}` })),
                };
            }
            if (sql.includes('FROM transactions') && sql.includes('current_tokens')) {
                return {
                    rows: Object.entries(balances).map(([userId, currentTokens]) => ({
                        user_id: Number(userId),
                        current_tokens: String(currentTokens),
                    })),
                };
            }
            if (sql.includes('INSERT INTO transactions') && sql.includes("'buy_in'")) {
                buyInAttempt += 1;
                if (failOnBuyInNumber === buyInAttempt) throw new Error('forced buy-in insert failure');
                pending.buyIns.push({ userId: params[0], gameId: params[1], amount: params[2] });
                return { rows: [] };
            }
            throw new Error(`Unexpected atomic-start query: ${sql}`);
        },
        release() { released = true; },
    };

    return {
        queries,
        persisted,
        get released() { return released; },
        async connect() { return client; },
    };
}

async function testAtomicGameStart() {
    const engine = new GameEngine('start-guard', 'fort-creek', 'Start Guard');
    engine.joinTable({ id: 1, username: 'Alice' }, 'start-socket-1', '10.00');
    engine.joinTable({ id: 2, username: 'Bob' }, 'start-socket-2', '5.50');
    engine.addBotPlayer();

    const first = engine.startGame(1);
    const startEffect = first.effects.find(effect => effect.type === 'START_GAME_TRANSACTIONS');
    assert.ok(startEffect, 'the first start schedules database work');
    assert.deepEqual(startEffect.payload.playerIds, [1, 2], 'bots are excluded from funded buy-ins');
    assert.equal(engine.gameStartPending, true);
    assert.equal(engine.startGame(2).effects.length, 0, 'a rapid duplicate start schedules no second charge');

    startEffect.onFailure(new Error('forced start failure'), null);
    assert.equal(engine.gameStartPending, false, 'failure releases the synchronous start guard');
    const retry = engine.startGame(2);
    const retryEffect = retry.effects.find(effect => effect.type === 'START_GAME_TRANSACTIONS');
    assert.ok(retryEffect, 'the table can retry after a failed transaction');
    retryEffect.onSuccess(701, { 1: 9, 2: 4.5 });
    assert.equal(engine.gameStartPending, false, 'success releases the synchronous start guard');
    assert.equal(engine.gameStarted, true);
    assert.equal(engine.gameId, 701);
    assert.equal(engine.players[1].tokens, 9);
    assert.equal(engine.players[2].tokens, 4.5);
    assert.equal(engine.players[-1].tokens, 'N/A');

    const successPool = makeAtomicStartPool({
        balances: { 1: 10, 2: 5.5 },
        usernames: { 1: 'Alice', 2: 'Bob' },
    });
    const success = await transactionManager.startGameTransaction(
        successPool,
        { tableId: 'atomic-success', theme: 'fort-creek', playerMode: 3 },
        [1, 2],
    );
    assert.deepEqual(success, { gameId: 701, updatedTokens: { 1: 9, 2: 4.5 } });
    assert.equal(successPool.persisted.games.length, 1, 'the committed start has one game record');
    assert.equal(successPool.persisted.buyIns.length, 2, 'only the two funded humans are charged');
    assert.ok(successPool.persisted.buyIns.every(row => row.gameId === 701 && row.amount === -1));
    assert.equal(successPool.released, true);

    const insufficientPool = makeAtomicStartPool({
        balances: { 1: 0.5, 2: 5.5 },
        usernames: { 1: 'Alice', 2: 'Bob' },
    });
    await assert.rejects(
        transactionManager.startGameTransaction(
            insufficientPool,
            { tableId: 'atomic-insufficient', theme: 'fort-creek', playerMode: 3 },
            [1, 2],
        ),
        /Alice has insufficient tokens/,
    );
    assert.equal(insufficientPool.persisted.games.length, 0, 'insufficient funds leave no game record');
    assert.equal(insufficientPool.persisted.buyIns.length, 0, 'insufficient funds charge nobody');
    assert.ok(insufficientPool.queries.some(query => query.text === 'ROLLBACK'));
    assert.ok(!insufficientPool.queries.some(query => query.text === 'COMMIT'));
    assert.equal(insufficientPool.released, true);

    const failedInsertPool = makeAtomicStartPool({
        balances: { 1: 10, 2: 5.5 },
        usernames: { 1: 'Alice', 2: 'Bob' },
        failOnBuyInNumber: 2,
    });
    await assert.rejects(
        transactionManager.startGameTransaction(
            failedInsertPool,
            { tableId: 'atomic-db-failure', theme: 'fort-creek', playerMode: 3 },
            [1, 2],
        ),
        /forced buy-in insert failure/,
    );
    assert.equal(failedInsertPool.persisted.games.length, 0, 'a DB failure rolls back the pending game row');
    assert.equal(failedInsertPool.persisted.buyIns.length, 0, 'a DB failure rolls back earlier buy-in inserts');
    assert.ok(failedInsertPool.queries.some(query => query.text === 'ROLLBACK'));
    assert.equal(failedInsertPool.released, true);
}

async function testAtomicStartRosterFreezeAndCommitBoundary() {
    const engine = new GameEngine('pending-roster', 'fort-creek', 'Pending Roster');
    engine.joinTable({ id: 1, username: 'Alice' }, 'pending-socket-1', '10.00');
    engine.joinTable({ id: 2, username: 'Bob' }, 'pending-socket-2', '10.00');
    engine.addBotPlayer();
    const capturedRoster = engine.playerOrder.allIds;

    const start = engine.startGame(1);
    assert.equal(engine.gameStartPending, true);

    engine.leaveTable(2);
    engine.disconnectPlayer(1);
    assert.equal(engine.players[1].disconnected, true);
    assert.equal(engine.players[1].socketId, null);
    assert.equal(engine.players[2].disconnected, true);
    assert.equal(engine.players[2].socketId, null);

    engine.addBotPlayer();
    engine.removeBot();
    engine.joinTable({ id: 4, username: 'Drew' }, 'pending-socket-4', '10.00');
    engine.joinTable({ id: 1, username: 'Alice' }, 'replacement-socket-1', '10.00', true);
    assert.deepEqual(engine.playerOrder.allIds, capturedRoster, 'pending start freezes the charged active roster');
    assert.equal(engine.players[4].isSpectator, true, 'a late join cannot enter the charged roster');
    assert.equal(engine.players[1].isSpectator, false, 'an existing active seat cannot change roles while commit is pending');

    const pool = makeAtomicStartPool({
        balances: { 1: 10, 2: 10 },
        usernames: { 1: 'Alice', 2: 'Bob' },
    });
    const roomEvents = [];
    const service = Object.create(GameService.prototype);
    service.engines = { [engine.tableId]: engine };
    service.pool = pool;
    service.io = {
        sockets: { sockets: new Map() },
        emit(event, payload) { roomEvents.push({ scope: 'all', event, payload }); },
        to(tableId) {
            return { emit(event, payload) { roomEvents.push({ scope: tableId, event, payload }); } };
        },
    };

    await service._executeEffects(engine.tableId, start.effects);
    assert.equal(engine.gameStarted, true, 'the committed captured roster enters a started game');
    assert.equal(engine.gameStartPending, false);
    assert.equal(engine.gameId, 701);
    assert.equal(engine.state, 'Dealing Pending');
    assert.equal(engine.players[2].disconnected, true, 'the leaver remains a reserved disconnected seat');
    assert.deepEqual(engine.playerOrder.allIds, capturedRoster);
    assert.equal(pool.persisted.games.length, 1);
    assert.equal(pool.persisted.buyIns.length, 2, 'each funded human is charged once');
    assert.deepEqual(
        pool.persisted.buyIns.map(row => row.userId).sort((a, b) => a - b),
        [1, 2],
    );
    assert.equal(roomEvents.some(item => item.event === 'gameStartFailed'), false);

    const rollbackEngine = new GameEngine('pending-rollback', 'fort-creek', 'Pending Rollback');
    rollbackEngine.joinTable({ id: 11, username: 'Rae' }, 'rollback-socket-11', '10.00');
    rollbackEngine.joinTable({ id: 12, username: 'Sol' }, 'rollback-socket-12', '10.00');
    rollbackEngine.addBotPlayer();
    const rollbackStart = rollbackEngine.startGame(11);
    rollbackEngine.leaveTable(12);
    assert.equal(rollbackEngine.players[12].disconnected, true, 'pending leave is preserved while commit remains possible');
    rollbackStart.effects.find(effect => effect.type === 'START_GAME_TRANSACTIONS')
        .onFailure(new Error('injected rollback'), null);
    assert.equal(rollbackEngine.gameStartPending, false);
    assert.equal(rollbackEngine.players[12], undefined, 'rollback removes the preserved pregame disconnect');
    assert.equal(rollbackEngine.playerOrder.includes(12), false, 'rollback cannot leave a chargeable ghost seat');
    assert.equal(rollbackEngine.playerOrder.count, 2);

    const committedPool = makeAtomicStartPool({
        balances: { 1: 10 },
        usernames: { 1: 'Alice' },
    });
    const committedEngine = new GameEngine('committed-transition-error', 'fort-creek', 'Committed Error');
    const committedEvents = [];
    const committedService = Object.create(GameService.prototype);
    committedService.engines = { [committedEngine.tableId]: committedEngine };
    committedService.pool = committedPool;
    committedService.io = {
        sockets: { sockets: new Map() },
        emit() {},
        to(tableId) {
            return { emit(event, payload) { committedEvents.push({ tableId, event, payload }); } };
        },
    };
    let onFailureCalled = false;
    const criticalLogs = [];
    const originalConsoleError = console.error;
    console.error = (...args) => { criticalLogs.push(args.map(String).join(' ')); };
    try {
        await committedService._executeEffects(committedEngine.tableId, [{
            type: 'START_GAME_TRANSACTIONS',
            payload: {
                table: { tableId: committedEngine.tableId, theme: 'fort-creek', playerMode: 3 },
                playerIds: [1],
            },
            onSuccess() { throw new Error('injected post-commit transition failure'); },
            onFailure() { onFailureCalled = true; },
        }]);
    } finally {
        console.error = originalConsoleError;
    }

    assert.equal(committedPool.persisted.games.length, 1);
    assert.equal(committedPool.persisted.buyIns.length, 1);
    assert.equal(onFailureCalled, false, 'a post-commit transition error is not reported as transaction failure');
    assert.equal(committedEvents.some(item => item.event === 'gameStartFailed'), false);
    assert.ok(criticalLogs.some(message => message.includes('[CRITICAL]') && message.includes('committed')));
}

async function testForfeitSettlement() {
    const engine = makeEngine();
    engine.state = 'Playing Phase';
    const first = engine.forfeitGame(1);
    assert.equal(engine.state, 'Game Over');
    assert.ok(first.effects.some(effect => effect.type === 'HANDLE_FORFEIT'));
    assert.equal(engine.forfeitGame(1).effects.length, 0, 'forfeit settlement is emitted only once');

    const disconnectEngine = makeEngine('disconnect-forfeit');
    disconnectEngine.state = 'Playing Phase';
    disconnectEngine.players[2].disconnected = true;
    const timerStart = disconnectEngine.startForfeitTimer(1, 'Bob');
    assert.ok(timerStart.effects.some(effect => effect.type === 'START_FORFEIT_TIMER'));

    const timerPool = makeTransactionPool();
    const timerService = Object.create(GameService.prototype);
    timerService.engines = { [disconnectEngine.tableId]: disconnectEngine };
    timerService.pool = timerPool;
    timerService.io = {
        sockets: { sockets: new Map() },
        emit() {},
        to() { return { emit() {} }; },
    };
    let intervalCallback;
    const originalSetInterval = global.setInterval;
    global.setInterval = callback => {
        intervalCallback = callback;
        return { testTimer: true };
    };
    try {
        await timerService._executeEffects(disconnectEngine.tableId, timerStart.effects);
    } finally {
        global.setInterval = originalSetInterval;
    }
    disconnectEngine.forfeiture.timeLeft = 1;
    await intervalCallback();
    assert.equal(disconnectEngine.state, 'Game Over', 'disconnect timeout settles through the service effect path');
    assert.ok(timerPool.queries.some(query => query.text === 'COMMIT'));

    const twoHumansAndBot = {
        gameId: 99,
        theme: 'fort-creek',
        forfeitingPlayerName: 'Alice',
        reason: 'voluntary forfeit',
        scores: { Alice: 120, Bob: 100, Bot: 80 },
        players: {
            1: { userId: 1, playerName: 'Alice', isBot: false, isSpectator: false },
            2: { userId: 2, playerName: 'Bob', isBot: false, isSpectator: false },
            '-1': { userId: -1, playerName: 'Bot', isBot: true, isSpectator: false },
        },
    };
    const pool = makeTransactionPool();
    const result = await transactionManager.handleForfeitTransactions(pool, twoHumansAndBot);
    const payoutInsert = pool.queries.find(query => (
        query.text.includes('INSERT INTO transactions') && query.params?.[2] === 'forfeit_payout'
    ));
    assert.equal(Number(payoutInsert.params[3]), 2, 'the remaining human receives exactly both funded buy-ins');
    assert.match(result.payoutDetails[2], /2\.00 tokens/);
    assert.ok(pool.queries.some(query => query.text === 'COMMIT'));
    assert.equal(pool.released, true);

    const fourPlayerTable = {
        ...twoHumansAndBot,
        scores: { Alice: 120, Bob: 120, Cara: 60, Drew: 20 },
        players: {
            1: twoHumansAndBot.players[1],
            2: twoHumansAndBot.players[2],
            3: { userId: 3, playerName: 'Cara', isBot: false, isSpectator: false },
            4: { userId: 4, playerName: 'Drew', isBot: false, isSpectator: false },
        },
    };
    const payouts = gameLogic.calculateForfeitPayout(fourPlayerTable, 'Alice');
    assert.equal(
        Object.values(payouts).reduce((sum, payout) => sum + payout.totalGain, 0),
        4,
        'four-player forfeit conserves the four funded buy-ins',
    );

    const failingPool = makeTransactionPool({ failOn: 'UPDATE users SET wins' });
    await assert.rejects(
        transactionManager.handleForfeitTransactions(failingPool, twoHumansAndBot),
        /forced transaction failure/,
    );
    assert.ok(failingPool.queries.some(query => query.text === 'ROLLBACK'));
    assert.ok(!failingPool.queries.some(query => query.text === 'COMMIT'));
    assert.equal(failingPool.released, true);
}

async function runBackendIntegrityTests() {
    testPlayAndFrogGuards();
    testBidAnnouncementTimerLifecycle();
    testInsuranceOvershootIsZeroSum();
    testDrawVotePausesPlayAndGuardsTransitions();
    testSocketActionGuard();
    testPersonalizedServiceDelivery();
    await testSocketSeatingAndResetRaces();
    await testAtomicGameStart();
    await testAtomicStartRosterFreezeAndCommitBoundary();
    await testDrawTransactionFallback();
    await testForfeitSettlement();
    console.log('Backend integrity tests passed.');
}

if (require.main === module) {
    runBackendIntegrityTests().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = runBackendIntegrityTests;
