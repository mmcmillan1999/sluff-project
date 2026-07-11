'use strict';

const assert = require('node:assert/strict');
const GameEngine = require('../src/core/GameEngine');
const GameService = require('../src/services/GameService');
const {
    TERMINAL_EMPTY_CLEANUP_DELAY_MS,
    TERMINAL_DISCONNECTED_CLEANUP_DELAY_MS,
} = GameService;
const transactionManager = require('../src/data/transactionManager');
const { validators } = require('../src/events/socketActionGuard');
const {
    buildForfeitSettlement,
    buildNormalGameSettlement,
} = require('../src/settlement/gameSettlement');

function makeTable(gameId, humanScores = [], botScores = [], theme = 'fort-creek') {
    const players = {};
    const scores = {};
    const seatingOrderIds = [];
    humanScores.forEach(([playerName, score], index) => {
        const userId = index + 1;
        players[userId] = { userId, playerName, isBot: false, isSpectator: false };
        scores[playerName] = score;
        seatingOrderIds.push(userId);
    });
    botScores.forEach(([playerName, score], index) => {
        const userId = -(index + 1);
        players[userId] = { userId, playerName, isBot: true, isSpectator: false };
        scores[playerName] = score;
        seatingOrderIds.push(userId);
    });
    return { gameId, theme, players, scores, seatingOrderIds };
}

function sumPayoutCents(plan) {
    return plan.payouts.reduce((sum, payout) => sum + payout.amountCents, 0);
}

function payoutByUser(plan, userId) {
    return plan.payouts.find(payout => payout.userId === userId)?.amountCents || 0;
}

function statByUser(plan, userId) {
    return plan.stats.find(stat => stat.userId === userId)?.column;
}

function testBotNeutralExactCentPlans() {
    const botsOnly = buildNormalGameSettlement(makeTable(
        1,
        [],
        [['Bot A', 50], ['Bot B', 100], ['Bot C', 20]],
    ));
    assert.equal(botsOnly.result.gameWinnerName, 'Bot B');
    assert.equal(botsOnly.payouts.length, 0);
    assert.equal(botsOnly.stats.length, 0);

    const oneHuman = buildNormalGameSettlement(makeTable(
        2,
        [['Alice', 10]],
        [['Bot Winner', 200], ['Bot Other', 50]],
    ));
    assert.equal(oneHuman.result.gameWinnerName, 'Bot Winner', 'visible winner includes bot results');
    assert.equal(sumPayoutCents(oneHuman), 100, 'one funded human receives exactly one buy-in');
    assert.equal(statByUser(oneHuman, 1), 'washes', 'practice against bots cannot farm wins/losses');

    const twoHumans = buildNormalGameSettlement(makeTable(
        3,
        [['Alice', 90], ['Bob', 40]],
        [['Bot Winner', 200]],
    ));
    assert.equal(sumPayoutCents(twoHumans), 200);
    assert.equal(payoutByUser(twoHumans, 1), 200);
    assert.equal(payoutByUser(twoHumans, 2), 0);
    assert.equal(statByUser(twoHumans, 1), 'wins');
    assert.equal(statByUser(twoHumans, 2), 'losses');

    const twoHumanTie = buildNormalGameSettlement(makeTable(
        4,
        [['Alice', 90], ['Bob', 90]],
        [['Bot', 10]],
    ));
    assert.equal(payoutByUser(twoHumanTie, 1), 100);
    assert.equal(payoutByUser(twoHumanTie, 2), 100);
    assert.ok(twoHumanTie.stats.every(stat => stat.column === 'washes'));

    const threeHumanStrict = buildNormalGameSettlement(makeTable(
        5,
        [['Alice', 120], ['Bob', 80], ['Cara', 20]],
    ));
    assert.deepEqual([1, 2, 3].map(id => payoutByUser(threeHumanStrict, id)), [200, 100, 0]);
    assert.deepEqual([1, 2, 3].map(id => statByUser(threeHumanStrict, id)), ['wins', 'washes', 'losses']);

    const threeHumanBottomTie = buildNormalGameSettlement(makeTable(
        6,
        [['Alice', 120], ['Bob', 30], ['Cara', 30]],
    ));
    assert.deepEqual([1, 2, 3].map(id => payoutByUser(threeHumanBottomTie, id)), [300, 0, 0]);

    const remainderTie = buildNormalGameSettlement(makeTable(
        7,
        [['Alice', 100], ['Bob', 100], ['Cara', 100], ['Drew', 0]],
        [],
        'miss-pauls-academy',
    ));
    assert.equal(sumPayoutCents(remainderTie), 40, 'the four-human Academy pot remains exactly 40 cents');
    assert.deepEqual(
        [1, 2, 3, 4].map(id => payoutByUser(remainderTie, id)),
        [14, 13, 13, 0],
        'indivisible tie cents use deterministic user-id remainder order',
    );

    const botForfeit = buildForfeitSettlement({
        ...makeTable(8, [['Alice', 100], ['Bob', 80]], [['Bot', 50]]),
        forfeitingPlayerName: 'Bot',
        reason: 'test bot forfeit',
    });
    assert.equal(sumPayoutCents(botForfeit), 200);
    assert.ok(botForfeit.stats.every(stat => stat.column === 'washes'));
}

function createSettlementPool({
    gameId,
    userIds,
    failOnInsertNumber = null,
    commitThenThrowOnce = false,
    transientLockFailures = 0,
} = {}) {
    const state = {
        outcomes: new Map([[gameId, 'In Progress']]),
        transactions: [],
        stats: new Map(userIds.map(id => [id, { wins: 0, losses: 0, washes: 0 }])),
        commits: 0,
        rollbacks: 0,
        connectCount: 0,
    };
    const locked = new Set();
    const waiters = new Map();
    let insertAttempt = 0;
    let commitFaultUsed = false;
    let remainingTransientLockFailures = transientLockFailures;

    async function acquireLock(id) {
        if (!locked.has(id)) {
            locked.add(id);
            return;
        }
        await new Promise(resolve => {
            const queue = waiters.get(id) || [];
            queue.push(resolve);
            waiters.set(id, queue);
        });
    }

    function releaseLock(id) {
        if (id === null) return;
        const queue = waiters.get(id) || [];
        const next = queue.shift();
        if (queue.length === 0) waiters.delete(id);
        if (next) next();
        else locked.delete(id);
    }

    const pool = {
        state,
        async connect() {
            state.connectCount += 1;
            let transactionActive = false;
            let lockedGameId = null;
            let pendingTransactions = [];
            let pendingStats = [];
            let pendingOutcome = null;

            const clearPending = () => {
                pendingTransactions = [];
                pendingStats = [];
                pendingOutcome = null;
            };

            return {
                async query(text, params = []) {
                    const sql = String(text).replace(/\s+/g, ' ').trim();
                    if (sql === 'BEGIN') {
                        transactionActive = true;
                        clearPending();
                        return { rows: [] };
                    }
                    if (sql.includes('SELECT outcome FROM game_history')) {
                        if (remainingTransientLockFailures > 0) {
                            remainingTransientLockFailures -= 1;
                            const error = new Error('injected transient lock failure');
                            error.code = '40001';
                            throw error;
                        }
                        lockedGameId = params[0];
                        await acquireLock(lockedGameId);
                        const outcome = state.outcomes.get(lockedGameId);
                        return { rows: outcome === undefined ? [] : [{ outcome }], rowCount: outcome === undefined ? 0 : 1 };
                    }
                    if (sql.includes('SELECT id FROM users') && sql.includes('FOR UPDATE')) {
                        const ids = (params[0] || []).filter(id => state.stats.has(id));
                        return { rows: ids.map(id => ({ id })), rowCount: ids.length };
                    }
                    if (sql.startsWith('INSERT INTO transactions')) {
                        insertAttempt += 1;
                        if (insertAttempt === failOnInsertNumber) throw new Error('injected payout insert failure');
                        pendingTransactions.push({
                            userId: params[0],
                            gameId: params[1],
                            type: params[2],
                            amount: params[3],
                            description: params[4],
                        });
                        return { rows: [], rowCount: 1 };
                    }
                    if (sql.startsWith('UPDATE users SET')) {
                        const column = sql.match(/UPDATE users SET (wins|losses|washes)/)?.[1];
                        pendingStats.push({ userId: params[0], column });
                        return { rows: [], rowCount: 1 };
                    }
                    if (sql.startsWith('UPDATE game_history')) {
                        if (state.outcomes.get(params[1]) !== 'In Progress') return { rows: [], rowCount: 0 };
                        pendingOutcome = params[0];
                        return { rows: [], rowCount: 1 };
                    }
                    if (sql === 'COMMIT') {
                        state.transactions.push(...pendingTransactions);
                        for (const stat of pendingStats) {
                            state.stats.get(stat.userId)[stat.column] += 1;
                        }
                        if (pendingOutcome !== null) state.outcomes.set(lockedGameId, pendingOutcome);
                        state.commits += 1;
                        transactionActive = false;
                        clearPending();
                        releaseLock(lockedGameId);
                        lockedGameId = null;
                        if (commitThenThrowOnce && !commitFaultUsed) {
                            commitFaultUsed = true;
                            const error = new Error('commit reply was lost');
                            error.code = '08006';
                            throw error;
                        }
                        return { rows: [] };
                    }
                    if (sql === 'ROLLBACK') {
                        if (transactionActive) state.rollbacks += 1;
                        transactionActive = false;
                        clearPending();
                        releaseLock(lockedGameId);
                        lockedGameId = null;
                        return { rows: [] };
                    }
                    throw new Error(`Unexpected settlement query: ${sql}`);
                },
                release() {
                    if (transactionActive) throw new Error('Settlement client released with an open transaction');
                },
            };
        },
    };
    return pool;
}

async function testAtomicRollbackAndConcurrentIdempotency() {
    const botOnlyPool = createSettlementPool({ gameId: 19, userIds: [] });
    const botOnlyTable = makeTable(19, [], [['Bot A', 100], ['Bot B', 50], ['Bot C', 0]]);
    await transactionManager.handleNormalGameTransactions(botOnlyPool, botOnlyTable);
    assert.equal(botOnlyPool.state.transactions.length, 0, 'bot-only games write history but no ledger rows');
    assert.equal(botOnlyPool.state.stats.size, 0);
    assert.equal(botOnlyPool.state.outcomes.get(19), 'Game Over! Winner: Bot A');

    const table = makeTable(20, [['Alice', 120], ['Bob', 80], ['Cara', 20]]);
    const failingPool = createSettlementPool({
        gameId: 20,
        userIds: [1, 2, 3],
        failOnInsertNumber: 2,
    });
    await assert.rejects(
        transactionManager.handleNormalGameTransactions(failingPool, table),
        /injected payout insert failure/,
    );
    assert.equal(failingPool.state.outcomes.get(20), 'In Progress');
    assert.equal(failingPool.state.transactions.length, 0, 'a failed payout leaves no earlier payout committed');
    assert.deepEqual([...failingPool.state.stats.values()], [
        { wins: 0, losses: 0, washes: 0 },
        { wins: 0, losses: 0, washes: 0 },
        { wins: 0, losses: 0, washes: 0 },
    ]);
    assert.equal(failingPool.state.rollbacks, 1);

    const duplicatePool = createSettlementPool({ gameId: 21, userIds: [1, 2] });
    const duplicateTable = makeTable(21, [['Alice', 100], ['Bob', 50]], [['Bot', 200]]);
    const results = await Promise.all([
        transactionManager.handleNormalGameTransactions(duplicatePool, duplicateTable),
        transactionManager.handleNormalGameTransactions(duplicatePool, duplicateTable),
    ]);
    assert.equal(duplicatePool.state.transactions.length, 1, 'concurrent duplicate settlement inserts one payout set');
    assert.equal(duplicatePool.state.stats.get(1).wins, 1);
    assert.equal(duplicatePool.state.stats.get(2).losses, 1);
    assert.equal(results.filter(result => result.alreadySettled).length, 1);

    const drawPool = createSettlementPool({ gameId: 22, userIds: [1, 2, 3] });
    const drawTable = makeTable(22, [['Alice', 120], ['Bob', 100], ['Cara', 80]]);
    await Promise.all([
        transactionManager.handleDrawTransactions(drawPool, drawTable, 'wash'),
        transactionManager.handleDrawTransactions(drawPool, drawTable, 'wash'),
    ]);
    assert.equal(drawPool.state.transactions.length, 3);
    assert.ok([...drawPool.state.stats.values()].every(stat => stat.washes === 1));

    const forfeitPool = createSettlementPool({ gameId: 23, userIds: [1, 2] });
    const forfeitTable = {
        ...makeTable(23, [['Alice', 120], ['Bob', 80]], [['Bot', 20]]),
        forfeitingPlayerName: 'Alice',
        reason: 'voluntary forfeit',
    };
    await Promise.all([
        transactionManager.handleForfeitTransactions(forfeitPool, forfeitTable),
        transactionManager.handleForfeitTransactions(forfeitPool, forfeitTable),
    ]);
    assert.equal(forfeitPool.state.transactions.length, 1);
    assert.equal(Number(forfeitPool.state.transactions[0].amount), 2);
    assert.equal(forfeitPool.state.stats.get(1).losses, 1);
    assert.equal(forfeitPool.state.stats.get(2).wins, 1);
}

function testEngineSettlementSnapshots() {
    const forfeitEngine = new GameEngine('snapshot-forfeit', 'fort-creek', 'Snapshot Forfeit');
    forfeitEngine.joinTable({ id: 1, username: 'Alice' }, 'snapshot-1', '10.00');
    forfeitEngine.joinTable({ id: 2, username: 'Bob' }, 'snapshot-2', '10.00');
    forfeitEngine.addBotPlayer();
    forfeitEngine.gameStarted = true;
    forfeitEngine.gameId = 24;
    forfeitEngine.state = 'Playing Phase';
    forfeitEngine.scores.Alice = 120;
    forfeitEngine.scores.Bob = 80;
    const forfeit = forfeitEngine.forfeitGame(1);
    const forfeitPayload = forfeit.effects.find(effect => effect.type === 'HANDLE_FORFEIT').payload;
    assert.equal(forfeitEngine.settlement.status, 'pending');
    assert.ok(Object.isFrozen(forfeitPayload.players[1]));
    forfeitEngine.scores.Bob = -500;
    delete forfeitEngine.players[2];
    assert.equal(forfeitPayload.scores.Bob, 80);
    assert.equal(forfeitPayload.players[2].playerName, 'Bob');

    const drawEngine = new GameEngine('snapshot-draw', 'fort-creek', 'Snapshot Draw');
    drawEngine.joinTable({ id: 1, username: 'Alice' }, 'draw-1', '10.00');
    drawEngine.joinTable({ id: 2, username: 'Bob' }, 'draw-2', '10.00');
    drawEngine.joinTable({ id: 3, username: 'Cara' }, 'draw-3', '10.00');
    drawEngine.gameStarted = true;
    drawEngine.gameId = 25;
    drawEngine.state = 'Playing Phase';
    drawEngine.requestDraw(1);
    drawEngine.submitDrawVote(2, 'wash');
    const draw = drawEngine.submitDrawVote(3, 'wash');
    const drawPayload = draw.effects.find(effect => effect.type === 'HANDLE_DRAW_OUTCOME').payload;
    assert.equal(drawEngine.settlement.status, 'pending');
    assert.ok(Object.isFrozen(drawPayload));
    assert.ok(Object.isFrozen(drawPayload.scores));
    drawEngine.scores.Alice = -999;
    assert.notEqual(drawPayload.scores.Alice, -999);
}

function makeService(engine, pool) {
    const service = Object.create(GameService.prototype);
    service.engines = { [engine.tableId]: engine };
    service.pool = pool;
    service.settlementRetryDelayOverride = async () => {};
    service.io = {
        sockets: { sockets: new Map() },
        emit() {},
        to() { return { emit() {} }; },
    };
    return service;
}

async function testImmutableLifecycleRetryAndSummary() {
    const engine = new GameEngine('settlement-service', 'fort-creek', 'Settlement Service');
    engine.joinTable({ id: 1, username: 'Alice' }, 'socket-1', '10.00');
    engine.addBotPlayer();
    engine.addBotPlayer();
    const bots = Object.values(engine.players).filter(player => player.isBot);
    engine.gameStarted = true;
    engine.gameId = 30;
    engine.playerMode = 3;
    engine.scores = { Alice: 50, [bots[0].playerName]: 200, [bots[1].playerName]: 10, ScoreAbsorber: 120 };
    engine.state = 'Game Over';
    engine.beginSettlement('normal');
    engine.roundSummary = { isGameOver: true, gameWinner: null, payoutDetails: {} };
    const payload = engine._createSettlementSnapshot();

    assert.ok(Object.isFrozen(payload));
    assert.ok(Object.isFrozen(payload.players));
    assert.ok(Object.isFrozen(payload.players[1]));
    engine.scores.Alice = -999;
    delete engine.players[bots[0].userId];
    assert.equal(payload.scores.Alice, 50, 'snapshot scores cannot drift while the database awaits');
    assert.equal(Object.values(payload.players).filter(player => player.isBot).length, 2);

    const pool = createSettlementPool({
        gameId: 30,
        userIds: [1],
        commitThenThrowOnce: true,
    });
    const service = makeService(engine, pool);
    await service._executeEffects(engine.tableId, [{ type: 'HANDLE_GAME_OVER', payload }]);

    assert.equal(engine.settlement.status, 'complete');
    assert.equal(engine.settlement.attempts, 2, 'a lost commit response retries through the idempotent row lock');
    assert.equal(pool.state.transactions.length, 1, 'retry after committed response loss cannot duplicate payout');
    assert.equal(pool.state.stats.get(1).washes, 1);
    assert.equal(engine.roundSummary.gameWinner, bots[0].playerName, 'summary always receives actual visible winner');
    assert.match(engine.roundSummary.payoutDetails[1], /buy-in was returned/i);

    const failedEngine = new GameEngine('failed-settlement', 'fort-creek', 'Failed Settlement');
    failedEngine.joinTable({ id: 1, username: 'Alice' }, 'failed-socket', '10.00');
    failedEngine.addBotPlayer();
    failedEngine.addBotPlayer();
    failedEngine.gameStarted = true;
    failedEngine.gameId = 31;
    failedEngine.state = 'Game Over';
    failedEngine.scores.Alice = 100;
    failedEngine.beginSettlement('normal');
    failedEngine.roundSummary = { isGameOver: true, gameWinner: null, payoutDetails: {} };
    const failedPool = createSettlementPool({
        gameId: 31,
        userIds: [1],
        transientLockFailures: 3,
    });
    const failedService = makeService(failedEngine, failedPool);
    await failedService._executeEffects(failedEngine.tableId, [{
        type: 'HANDLE_GAME_OVER',
        payload: failedEngine._createSettlementSnapshot(),
    }]);
    assert.equal(failedEngine.settlement.status, 'failed');
    assert.equal(failedEngine.settlement.attempts, 3, 'automatic retries are bounded');
    assert.equal(failedEngine.reset().effects.length, 0, 'failed settlement blocks reset and preserves recovery state');
    assert.equal(
        validators.terminalReset({}, { engine: failedEngine }),
        'The table cannot reset until settlement commits.',
    );

    const scheduled = [];
    const originalSetTimeout = global.setTimeout;
    global.setTimeout = callback => {
        scheduled.push(callback);
        return { testTimer: true };
    };
    try {
        failedService._triggerBots(failedEngine.tableId);
    } finally {
        global.setTimeout = originalSetTimeout;
    }
    assert.equal(scheduled.length, 0, 'terminal cleanup is not scheduled for a failed settlement');
}

async function testResetGateAndTerminalGameIdentity() {
    const engine = new GameEngine('reset-settlement', 'fort-creek', 'Reset Settlement');
    engine.gameStarted = true;
    engine.gameId = 40;
    engine.state = 'Game Over';
    engine.beginSettlement('normal');
    assert.equal(engine.reset().effects.length, 0);
    assert.equal(engine.gameId, 40);
    engine.completeSettlement();

    const service = makeService(engine, createSettlementPool({ gameId: 40, userIds: [] }));
    const scheduled = [];
    service.terminalCleanupTimerOverride = (callback, duration) => {
        const timer = { callback, duration, unref() {} };
        scheduled.push(timer);
        return timer;
    };
    service._triggerBots(engine.tableId);
    assert.equal(scheduled.length, 1);
    assert.equal(scheduled[0].duration, TERMINAL_EMPTY_CLEANUP_DELAY_MS);

    engine.gameId = 41;
    engine.state = 'Game Over';
    engine.settlement = { status: 'complete', kind: 'normal', attempts: 1, lastErrorCode: null };
    let resetCalled = false;
    const originalReset = engine.reset.bind(engine);
    engine.reset = () => {
        resetCalled = true;
        return originalReset();
    };
    await scheduled[0].callback();
    assert.equal(resetCalled, false, 'an old terminal timer cannot reset a newer game with the same state');
}

async function testDrawSettlementFailureCompletesForExit() {
    const engine = new GameEngine('failed-draw-settlement', 'fort-creek', 'Failed Draw Settlement');
    engine.joinTable({ id: 1, username: 'Alice' }, 'failed-draw-alice', '10.00');
    engine.gameStarted = true;
    engine.gameId = 56;
    engine.state = 'Draw Resolving';
    engine.beginSettlement('draw');

    const service = makeService(engine, createSettlementPool({ gameId: 56, userIds: [1] }));
    service.handleDrawOutcome = async () => {
        const error = new Error('injected permanent draw settlement failure');
        error.code = 'DRAW_SETTLEMENT_FAILED';
        throw error;
    };
    await service._executeEffects(engine.tableId, [{
        type: 'HANDLE_DRAW_OUTCOME',
        payload: { gameId: 56, outcome: 'wash' },
    }]);

    assert.equal(engine.state, 'DrawComplete', 'a failed draw leaves the in-flight resolving state');
    assert.equal(engine.settlement.status, 'failed');
    assert.equal(engine.roundSummary.settlementFailed, true);
    assert.equal(engine.roundSummary.drawOutcome, 'Settlement Failed');
    assert.match(engine.roundSummary.message, /administrator review/i);
    assert.equal(
        service.getStateForSocket(engine, { id: 'failed-draw-alice', user: { id: 1 }, data: {} })
            .viewerRoundPresentationAcknowledged,
        false,
        'a summary without a current presentation never reports a viewer acknowledgement',
    );
    assert.equal(
        validators.terminalReset({}, { engine }),
        'The table cannot reset until settlement commits.',
    );
    assert.equal(await service.resetGame(engine.tableId), false, 'public reset stays blocked after failed draw settlement');
    assert.equal(engine.state, 'DrawComplete');
    assert.equal(service.evaluateTerminalCleanup(engine.tableId).status, 'inactive');
}

async function testTerminalConnectivityAwareCleanupLifecycle() {
    const engine = new GameEngine('terminal-connectivity', 'fort-creek', 'Terminal Connectivity');
    engine.joinTable({ id: 1, username: 'Alice' }, 'alice-live', '10.00');
    engine.gameStarted = true;
    engine.gameId = 55;
    engine.state = 'DrawComplete';
    engine.settlement = { status: 'complete', kind: 'draw', attempts: 1, lastErrorCode: null };

    const service = makeService(engine, createSettlementPool({ gameId: 55, userIds: [1] }));
    const scheduled = [];
    service.terminalCleanupTimerOverride = (callback, duration) => {
        const timer = { callback, duration, unref() {} };
        scheduled.push(timer);
        return timer;
    };
    service.io.sockets.sockets.set('alice-live', { id: 'alice-live', connected: true });

    service._triggerBots(engine.tableId);
    assert.equal(scheduled.length, 0, 'a connected human keeps the settled table available indefinitely');
    assert.equal(engine.state, 'DrawComplete');

    const alice = engine.players[1];
    alice.disconnected = true;
    alice.socketId = null;
    service.io.sockets.sockets.delete('alice-live');
    let lifecycle = service.evaluateTerminalCleanup(engine.tableId);
    assert.equal(lifecycle.kind, 'disconnected');
    assert.equal(scheduled.at(-1).duration, TERMINAL_DISCONNECTED_CLEANUP_DELAY_MS);
    const firstGraceTimer = scheduled.at(-1);

    service._triggerBots(engine.tableId);
    assert.equal(scheduled.length, 1, 'heartbeats do not extend or duplicate the reconnect grace');

    alice.disconnected = false;
    alice.socketId = 'alice-returned';
    service.io.sockets.sockets.set('alice-returned', { id: 'alice-returned', connected: true });
    lifecycle = service.evaluateTerminalCleanup(engine.tableId);
    assert.equal(lifecycle.status, 'held', 'reconnect cancels abandoned cleanup');
    await firstGraceTimer.callback();
    assert.equal(engine.state, 'DrawComplete', 'a cancelled stale grace timer cannot reset after reconnect');

    alice.disconnected = true;
    alice.socketId = null;
    service.io.sockets.sockets.delete('alice-returned');
    service.evaluateTerminalCleanup(engine.tableId);
    const secondGraceTimer = scheduled.at(-1);
    assert.notEqual(secondGraceTimer, firstGraceTimer, 'disconnect after reconnect receives a fresh grace period');
    assert.equal(secondGraceTimer.duration, TERMINAL_DISCONNECTED_CLEANUP_DELAY_MS);

    engine.joinTable({ id: 99, username: 'Watcher' }, 'watcher-live', '10.00');
    service.io.sockets.sockets.set('watcher-live', { id: 'watcher-live', connected: true, emit() {} });
    assert.equal(engine.players[99].isSpectator, true);
    assert.equal(engine.scores.Watcher, undefined, 'late spectators never enter the score roster');

    engine.leaveTable(1);
    lifecycle = service.evaluateTerminalCleanup(engine.tableId);
    assert.equal(lifecycle.kind, 'empty');
    assert.equal(lifecycle.status, 'scheduled', 'a connected spectator cannot pin a table after funded players leave');
    const emptyTimer = scheduled.at(-1);
    assert.equal(emptyTimer.duration, TERMINAL_EMPTY_CLEANUP_DELAY_MS);
    await secondGraceTimer.callback();
    assert.equal(engine.state, 'DrawComplete', 'the superseded disconnected timer cannot beat the shorter empty-table timer');

    await emptyTimer.callback();
    assert.equal(engine.state, 'Waiting for Players');
    assert.equal(engine.gameStarted, false);
    assert.equal(engine.gameId, null);
    assert.equal(engine.players[99].isSpectator, true, 'a rematch reset cannot silently promote a spectator');
    assert.equal(engine.playerOrder.includes(99), false);
    assert.equal(engine.scores.Watcher, undefined);
}

async function testSharedResultPresentationGate() {
    const engine = new GameEngine('presentation-gate', 'fort-creek', 'Presentation Gate');
    engine.joinTable({ id: 1, username: 'Alice' }, 'alice', '10.00');
    engine.joinTable({ id: 2, username: 'Bob' }, 'bob', '10.00');
    engine.addBotPlayer();
    const dealerBot = Object.values(engine.players).find(player => player.isBot);
    engine.gameStarted = true;
    engine.playerMode = 3;
    engine.dealer = dealerBot.userId;
    engine.state = 'Awaiting Next Round Trigger';
    engine.roundSummary = { dealerOfRoundId: dealerBot.userId };
    engine.startRoundPresentationWindow(10_000);

    const service = makeService(engine, createSettlementPool({ gameId: 70, userIds: [1, 2] }));
    const makeSocket = (id, userId) => ({ id, user: { id: userId }, connected: true, emit() {} });
    const aliceSocket = makeSocket('alice', 1);
    const bobSocket = makeSocket('bob', 2);
    service.io.sockets.sockets.set(aliceSocket.id, aliceSocket);
    service.io.sockets.sockets.set(bobSocket.id, bobSocket);

    let result = service.ackRoundPresentation(
        engine.tableId,
        1,
        engine.roundSummary.presentationReadyAt,
        aliceSocket.id,
    );
    assert.equal(result.accepted, true);
    assert.equal(service.getStateForSocket(engine, aliceSocket).viewerRoundPresentationAcknowledged, true);
    assert.equal(service.getStateForSocket(engine, bobSocket).viewerRoundPresentationAcknowledged, false);
    result = service.ackRoundPresentation(
        engine.tableId,
        2,
        engine.roundSummary.presentationReadyAt,
        bobSocket.id,
    );
    assert.equal(result.allConnectedHumansPresented, true);

    engine.requestNextRound(dealerBot.userId);
    assert.equal(engine.state, 'Awaiting Next Round Trigger', 'acknowledgements cannot bypass the base presentation lock');

    // Begin a ready presentation generation. Starting a new generation clears
    // every prior acknowledgement, and a stale generation cannot restore one.
    engine.startRoundPresentationWindow(0, Date.now() - 1);
    service.emitGameState(engine.tableId);
    result = service.ackRoundPresentation(
        engine.tableId,
        1,
        engine.roundSummary.presentationReadyAt - 1,
        aliceSocket.id,
    );
    assert.deepEqual(result, { accepted: false, reason: 'stale_presentation' });

    engine.joinTable({ id: 99, username: 'Watcher' }, 'watcher', '10.00');
    const watcherSocket = makeSocket('watcher', 99);
    service.io.sockets.sockets.set(watcherSocket.id, watcherSocket);
    result = service.ackRoundPresentation(
        engine.tableId,
        99,
        engine.roundSummary.presentationReadyAt,
        watcherSocket.id,
    );
    assert.deepEqual(result, { accepted: false, reason: 'ineligible_player' }, 'spectator acks are ignored');

    let acknowledgementBroadcasts = 0;
    const originalEmitGameState = service.emitGameState.bind(service);
    service.emitGameState = tableId => {
        acknowledgementBroadcasts += 1;
        return originalEmitGameState(tableId);
    };
    result = service.ackRoundPresentation(
        engine.tableId,
        1,
        engine.roundSummary.presentationReadyAt,
        aliceSocket.id,
    );
    assert.equal(result.allConnectedHumansPresented, false, 'one acknowledgement cannot satisfy two connected humans');
    const broadcastsAfterFirstAck = acknowledgementBroadcasts;
    result = service.ackRoundPresentation(
        engine.tableId,
        1,
        engine.roundSummary.presentationReadyAt,
        aliceSocket.id,
    );
    assert.equal(result.alreadyAcknowledged, true);
    assert.equal(acknowledgementBroadcasts, broadcastsAfterFirstAck, 'duplicate acknowledgement does not amplify broadcasts');

    engine.disconnectPlayer(2);
    service.io.sockets.sockets.delete(bobSocket.id);
    service.emitGameState(engine.tableId);
    assert.equal(
        engine.roundSummary.allConnectedHumansPresented,
        true,
        'an unacknowledged disconnect leaves the connected blocking set immediately',
    );

    const returnedBobSocket = makeSocket('bob-returned', 2);
    engine.reconnectPlayer(2, returnedBobSocket);
    service.io.sockets.sockets.set(returnedBobSocket.id, returnedBobSocket);
    service.emitGameState(engine.tableId);
    assert.equal(engine.roundSummary.allConnectedHumansPresented, false, 'a reconnected human must acknowledge the current generation');
    result = service.ackRoundPresentation(
        engine.tableId,
        2,
        engine.roundSummary.presentationReadyAt,
        returnedBobSocket.id,
    );
    assert.equal(result.allConnectedHumansPresented, true, 'both connected humans acknowledged');

    const returnedAliceSocket = makeSocket('alice-returned', 1);
    engine.reconnectPlayer(1, returnedAliceSocket);
    service.io.sockets.sockets.delete(aliceSocket.id);
    service.io.sockets.sockets.set(returnedAliceSocket.id, returnedAliceSocket);
    service.emitGameState(engine.tableId);
    assert.equal(engine.roundSummary.allConnectedHumansPresented, false, 'reconnect invalidates that user\'s prior acknowledgement');
    assert.equal(
        service.getStateForSocket(engine, returnedAliceSocket).viewerRoundPresentationAcknowledged,
        false,
        'the replacement socket cannot inherit the prior socket\'s personalized acknowledgement',
    );

    const forceReadyAt = engine.roundSummary.presentationForceReadyAt;
    assert.equal(engine.isRoundPresentationAdvanceReady(forceReadyAt - 1), false);
    assert.equal(engine.isRoundPresentationAdvanceReady(forceReadyAt), true, 'the bounded fallback eventually releases an absent acknowledgement');

    // Exercise the actual bot schedule: its first dealer request is rejected by
    // the engine gate, then the existing retry loop advances once the final
    // connected human acknowledges.
    const scheduled = [];
    const originalSetTimeout = global.setTimeout;
    global.setTimeout = (callback, duration) => {
        const timer = { callback, duration };
        scheduled.push(timer);
        return timer;
    };
    try {
        service._triggerBots(engine.tableId);
        assert.equal(scheduled.length, 1);
        await scheduled.shift().callback();
        assert.equal(engine.state, 'Awaiting Next Round Trigger', 'bot dealer waits while a connected human is unacknowledged');

        const retryBotCheck = scheduled.shift();
        result = service.ackRoundPresentation(
            engine.tableId,
            1,
            engine.roundSummary.presentationReadyAt,
            returnedAliceSocket.id,
        );
        assert.equal(result.allConnectedHumansPresented, true);
        await retryBotCheck.callback();
        assert.equal(scheduled.length, 1, 'the bot queues another dealer request after its blocked attempt');
        await scheduled.shift().callback();
        assert.equal(engine.state, 'Dealing Pending', 'the bot retry advances after all connected humans acknowledge');
    } finally {
        global.setTimeout = originalSetTimeout;
        engine.pendingBotAction = null;
    }

    const terminalEngine = new GameEngine('terminal-presentation-gate', 'fort-creek', 'Terminal Presentation Gate');
    terminalEngine.joinTable({ id: 1, username: 'Alice' }, 'terminal-alice', '10.00');
    terminalEngine.addBotPlayer();
    terminalEngine.addBotPlayer();
    terminalEngine.gameStarted = true;
    terminalEngine.state = 'Game Over';
    terminalEngine.beginSettlement('normal');
    terminalEngine.roundSummary = { isGameOver: true };
    terminalEngine.startRoundPresentationWindow(0, Date.now() - 1);
    const terminalService = makeService(terminalEngine, createSettlementPool({ gameId: 71, userIds: [1] }));
    const terminalSocket = makeSocket('terminal-alice', 1);
    terminalService.io.sockets.sockets.set(terminalSocket.id, terminalSocket);
    result = terminalService.ackRoundPresentation(
        terminalEngine.tableId,
        1,
        terminalEngine.roundSummary.presentationReadyAt,
        terminalSocket.id,
    );
    assert.equal(result.accepted, false, 'terminal acknowledgement waits for atomic settlement completion');
    terminalEngine.completeSettlement();
    result = terminalService.ackRoundPresentation(
        terminalEngine.tableId,
        1,
        terminalEngine.roundSummary.presentationReadyAt,
        terminalSocket.id,
    );
    assert.equal(result.accepted, true);
    assert.equal(validators.terminalReset({}, { engine: terminalEngine }), null);

    terminalEngine.reconnectPlayer(1, terminalSocket);
    terminalService.emitGameState(terminalEngine.tableId);
    assert.match(
        validators.terminalReset({}, { engine: terminalEngine }),
        /presentation is still finishing/i,
        'socket rematches wait for the replacement connection acknowledgement',
    );
    const terminalStateBeforeBlockedReset = terminalEngine.state;
    assert.equal(
        await terminalService.resetGame(terminalEngine.tableId),
        false,
        'the public service boundary cannot bypass presentation readiness',
    );
    assert.equal(terminalEngine.state, terminalStateBeforeBlockedReset);
    terminalEngine.roundSummary.presentationForceReadyAt = Date.now() - 1;
    assert.equal(validators.terminalReset({}, { engine: terminalEngine }), null, 'terminal reset honors the bounded fallback');

    const drawEngine = new GameEngine('legacy-draw-presentation', 'fort-creek', 'Legacy Draw');
    drawEngine.state = 'DrawComplete';
    drawEngine.settlement = { status: 'complete' };
    drawEngine.roundSummary = { drawOutcome: 'wash' };
    assert.equal(validators.terminalReset({}, { engine: drawEngine }), null, 'DrawComplete without presentation fields is unaffected');
}

async function runGameSettlementIntegrityTests() {
    testBotNeutralExactCentPlans();
    testEngineSettlementSnapshots();
    await testAtomicRollbackAndConcurrentIdempotency();
    await testImmutableLifecycleRetryAndSummary();
    await testResetGateAndTerminalGameIdentity();
    await testDrawSettlementFailureCompletesForExit();
    await testTerminalConnectivityAwareCleanupLifecycle();
    await testSharedResultPresentationGate();
    console.log('Atomic game-settlement integrity tests passed.');
}

if (require.main === module) {
    runGameSettlementIntegrityTests().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = runGameSettlementIntegrityTests;
