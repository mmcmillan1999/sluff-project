'use strict';

const assert = require('node:assert/strict');
const GameEngine = require('../src/core/GameEngine');
const GameService = require('../src/services/GameService');
const registerGameHandlers = require('../src/events/gameEvents');
const { createGameServiceWithoutHeartbeat } = require('./test-helpers');

function createIo() {
    return {
        emitted: [],
        sockets: { sockets: new Map() },
        to() { return { emit() {} }; },
        emit(event, payload) { this.emitted.push({ event, payload }); },
    };
}

function createService() {
    const io = createIo();
    const pool = { query: async () => ({ rows: [{ tokens: '100.00' }], rowCount: 1 }) };
    const service = createGameServiceWithoutHeartbeat(GameService, io, pool);
    const scheduled = [];
    let now = 1_000_000;
    service.nowOverride = () => now;
    service.timerOverride = (callback, duration) => {
        const timer = { callback, duration };
        scheduled.push(timer);
        return timer;
    };
    return {
        service,
        io,
        scheduled,
        setNow(value) { now = value; },
        advanceNow(value) { now += value; },
    };
}

function seatHuman(engine, id, name = `Player ${id}`) {
    engine.joinTable({ id, username: name }, `socket-${id}`, '100.00');
}

function seedDecisionTable(service, theme = 'fort-creek', humanIds = [101]) {
    const engine = service.findQuickPlayTable(theme);
    humanIds.forEach(id => seatHuman(engine, id));
    while (engine.playerOrder.count < 3) engine.addBotPlayer();
    service.evaluateQuickPlayTable(engine.tableId, { restartFill: true });
    assert.equal(engine.qpPhase, 'decision_pending');
    return engine;
}

async function flushAsyncStart() {
    await Promise.resolve();
    await Promise.resolve();
}

function installPendingStartSpy(service) {
    const calls = [];
    service.startGame = (tableId, userId, options) => {
        const engine = service.getEngineById(tableId);
        calls.push({
            tableId,
            userId,
            options,
            roster: [...engine.playerOrder.allIds],
        });
        engine.gameStartPending = true;
        return new Promise(() => {});
    };
    return calls;
}

async function testFillStopsForDecisionAndSerializesContract() {
    const { service } = createService();
    const engine = service.findQuickPlayTable('fort-creek');
    seatHuman(engine, 1, 'Solo');
    service.evaluateQuickPlayTable(engine.tableId, { restartFill: true });
    const initialGeneration = engine.qpGeneration;
    assert.equal(engine.qpPhase, 'filling');

    let fillRecord = service.qpTimers[engine.tableId].fill;
    assert.ok(fillRecord.handle.duration >= 5000 && fillRecord.handle.duration < 10000);
    await fillRecord.handle.callback();
    assert.equal(engine.playerOrder.count, 2);
    fillRecord = service.qpTimers[engine.tableId].fill;
    await fillRecord.handle.callback();

    assert.equal(engine.playerOrder.count, 3);
    assert.equal(engine.qpPhase, 'decision_pending', 'three seats stop for a player decision');
    assert.equal(engine.qpWindowEndsAt, null, 'the fourth-player clock does not start implicitly');
    assert.equal(service.qpTimers[engine.tableId].window || null, null);
    assert.ok(engine.qpGeneration > initialGeneration);

    const state = engine.getStateForClient({ userId: 1 });
    assert.equal(state.qpPhase, 'decision_pending');
    assert.equal(state.qpGeneration, engine.qpGeneration);
    assert.equal(state.qpWindowEndsAt, null);
}

function testFirstValidDecisionWinsSynchronously() {
    {
        const { service } = createService();
        const engine = seedDecisionTable(service, 'shirecliff-road', [11, 12]);
        const starts = installPendingStartSpy(service);
        const generation = engine.qpGeneration;

        const first = service.quickPlayDecision(engine.tableId, 11, 'start3', generation);
        const loser = service.quickPlayDecision(engine.tableId, 12, 'seek4', generation);
        assert.equal(first.accepted, true);
        assert.equal(loser.accepted, false);
        assert.equal(engine.qpPhase, 'starting_3');
        assert.equal(engine.gameStartPending, true, 'roster freezes before the event handler can yield');
        assert.deepEqual(starts[0].roster, engine.playerOrder.allIds);
        assert.equal(starts[0].roster.length, 3);
    }

    {
        const { service } = createService();
        const engine = seedDecisionTable(service, 'dans-deck', [21, 22]);
        installPendingStartSpy(service);
        const generation = engine.qpGeneration;

        const first = service.quickPlayDecision(engine.tableId, 22, 'seek4', generation);
        const loser = service.quickPlayDecision(engine.tableId, 21, 'start3', generation);
        assert.equal(first.accepted, true);
        assert.equal(loser.accepted, false);
        assert.equal(engine.qpPhase, 'seeking_fourth');
        assert.equal(engine.gameStartPending, false);
        assert.equal(engine.qpWindowEndsAt, 1_020_000);
        assert.equal(service.qpTimers[engine.tableId].window.handle.duration, 20000);
    }
}

async function testSearchTimeoutReturnsToDecisionAndGuardsDeadline() {
    const harness = createService();
    const { service } = harness;
    const engine = seedDecisionTable(service, 'miss-pauls-academy', [31]);
    const decisionGeneration = engine.qpGeneration;
    service.quickPlayDecision(engine.tableId, 31, 'seek4', decisionGeneration);
    const searchGeneration = engine.qpGeneration;
    const earlyTimer = service.qpTimers[engine.tableId].window.handle;

    harness.advanceNow(19_000);
    await earlyTimer.callback();
    assert.equal(engine.qpPhase, 'seeking_fourth', 'an early timer cannot close the search');
    assert.equal(service.qpTimers[engine.tableId].window.handle.duration, 1000, 'early wake is re-armed to the deadline');

    harness.advanceNow(1_000);
    await service.qpTimers[engine.tableId].window.handle.callback();
    assert.equal(engine.qpPhase, 'decision_pending');
    assert.equal(engine.qpWindowEndsAt, null);
    assert.ok(engine.qpGeneration > searchGeneration);
    assert.equal(engine.gameStarted, false, 'timeout never silently starts three-player mode');

    const currentGeneration = engine.qpGeneration;
    await earlyTimer.callback();
    assert.equal(engine.qpGeneration, currentGeneration, 'stale search timers cannot mutate a new decision');
}

function testSearchDeadlineIsEnforcedBeforeDelayedTimerRuns() {
    const harness = createService();
    const { service } = harness;
    const engine = seedDecisionTable(service, 'shirecliff-road', [35, 36]);
    service.quickPlayDecision(engine.tableId, 35, 'seek4', engine.qpGeneration);
    const deadline = engine.qpWindowEndsAt;

    harness.setNow(deadline - 1);
    assert.equal(service.canAcceptQuickPlayHuman(engine), true, 'the fourth seat remains open before the deadline');
    harness.setNow(deadline);
    assert.equal(service.canAcceptQuickPlayHuman(engine), false, 'the deadline itself is closed even before its timer runs');

    for (const candidate of Object.values(service.engines)) {
        if (candidate.tableType === 'quickplay' && candidate.theme === engine.theme && candidate !== engine) {
            candidate.gameStartPending = true;
        }
    }
    const claim = service.claimQuickPlaySeat(
        engine.theme,
        { id: 37, username: 'Too Late' },
        'socket-37',
        '100.00',
    );
    assert.equal(claim, null, 'a delayed timer cannot leave an expired fourth seat claimable');
    assert.equal(engine.playerOrder.count, 3);
    assert.equal(engine.players[37], undefined);
}

function testFourthHumanStartsExactRosterAndBotsCannotTakeSeatFour() {
    const { service } = createService();
    const engine = seedDecisionTable(service, 'fort-creek', [41, 42]);
    const starts = installPendingStartSpy(service);
    service.quickPlayDecision(engine.tableId, 41, 'seek4', engine.qpGeneration);

    engine.addBotPlayer();
    assert.equal(engine.playerOrder.count, 3, 'Quick Play never adds a bot in seat four');

    const claimed = service.claimQuickPlaySeat(
        engine.theme,
        { id: 43, username: 'Fourth' },
        'socket-43',
        '100.00',
    );
    assert.equal(claimed.tableId, engine.tableId);
    assert.equal(engine.qpPhase, 'starting_4');
    assert.equal(engine.gameStartPending, true);
    assert.equal(engine.playerOrder.count, 4);
    assert.deepEqual(starts[0].roster, engine.playerOrder.allIds);
    assert.equal(starts[0].roster[3], 43);
    assert.equal(engine.players[43].isSpectator, false);
}

function testConcurrentFourthsRematchWithoutSpectatorFallback() {
    const { service } = createService();
    const target = seedDecisionTable(service, 'shirecliff-road', [51, 52]);
    const starts = installPendingStartSpy(service);
    service.quickPlayDecision(target.tableId, 51, 'seek4', target.qpGeneration);

    // These calls represent two balance reads resolving together. Each claim
    // itself is synchronous, so only the first can take the sought fourth seat.
    const first = service.claimQuickPlaySeat(target.theme, { id: 53, username: 'Winner' }, 's53', '100.00');
    const second = service.claimQuickPlaySeat(target.theme, { id: 54, username: 'Rematched' }, 's54', '100.00');
    assert.equal(first.tableId, target.tableId);
    assert.notEqual(second.tableId, target.tableId);
    assert.equal(target.playerOrder.count, 4);
    assert.equal(starts[0].roster.length, 4);
    assert.equal(second.players[54].isSpectator, false);
    assert.equal(second.playerOrder.includes(54), true);
}

async function testStaleFillTimerAndLeaveRefillCycle() {
    const { service } = createService();
    const engine = service.findQuickPlayTable('dans-deck');
    service.claimQuickPlaySeat(engine.theme, { id: 61, username: 'One' }, 's61', '100.00');
    const staleFill = service.qpTimers[engine.tableId].fill.handle;
    service.claimQuickPlaySeat(engine.theme, { id: 62, username: 'Two' }, 's62', '100.00');
    const freshGeneration = engine.qpGeneration;

    await staleFill.callback();
    assert.equal(engine.playerOrder.count, 2);
    assert.equal(engine.qpGeneration, freshGeneration, 'stale fill timer cannot add a bot or change generation');
    await service.qpTimers[engine.tableId].fill.handle.callback();
    assert.equal(engine.playerOrder.count, 3);
    assert.equal(engine.qpPhase, 'decision_pending');

    engine.leaveTable(62);
    service.evaluateQuickPlayTable(engine.tableId);
    assert.equal(engine.qpPhase, 'filling');
    assert.equal(engine.playerOrder.count, 2);
    assert.ok(service.qpTimers[engine.tableId].fill, 'leaving a decision table re-arms fill');

    engine.leaveTable(61);
    service.evaluateQuickPlayTable(engine.tableId);
    assert.equal(engine.playerOrder.count, 0, 'last human leaving sweeps matchmaking bots');
    assert.equal(engine.qpPhase, 'filling');
}

async function testHardResetGenerationRejectsOldTableTimers() {
    const { service } = createService();
    const original = service.findQuickPlayTable('fort-creek');
    service.claimQuickPlaySeat(original.theme, { id: 65, username: 'Before Reset' }, 's65', '100.00');
    const staleTimer = service.qpTimers[original.tableId].fill.handle;
    const oldGeneration = original.qpGeneration;

    service.resetAllEngines();
    const replacement = service.getEngineById(original.tableId);
    service.claimQuickPlaySeat(replacement.theme, { id: 66, username: 'After Reset' }, 's66', '100.00');
    assert.ok(replacement.qpGeneration > oldGeneration);
    const replacementGeneration = replacement.qpGeneration;
    await staleTimer.callback();
    assert.equal(replacement.playerOrder.count, 1);
    assert.equal(replacement.qpGeneration, replacementGeneration);
}

async function testDecisionGuardsGenericStartAndRecoversFromStartFailure() {
    const { service } = createService();
    const engine = seedDecisionTable(service, 'miss-pauls-academy', [71, 72]);
    const generation = engine.qpGeneration;
    assert.equal(service.quickPlayDecision(engine.tableId, 999, 'start3', generation).accepted, false);
    engine.players[71].isSpectator = true;
    assert.equal(service.quickPlayDecision(engine.tableId, 71, 'start3', generation).accepted, false);
    engine.players[71].isSpectator = false;
    assert.equal(service.quickPlayDecision(engine.tableId, 71, 'start3', generation + 1).accepted, false);

    const bypass = engine.startGame(71);
    assert.equal(engine.gameStartPending, false, 'generic start cannot bypass the Quick Play decision');
    assert.ok(bypass.effects.some(effect => effect.type === 'EMIT_TO_SOCKET'));

    service.startGame = async (tableId, userId, options) => {
        const current = service.getEngineById(tableId);
        const result = current.startGame(userId, options);
        const transaction = result.effects.find(effect => effect.type === 'START_GAME_TRANSACTIONS');
        assert.ok(transaction, 'valid decision creates the transaction effect');
        transaction.onFailure(new Error('temporary database failure'), null);
    };
    assert.equal(service.quickPlayDecision(engine.tableId, 72, 'start3', generation).accepted, true);
    await flushAsyncStart();
    assert.equal(engine.gameStartPending, false);
    assert.equal(engine.gameStarted, false);
    assert.equal(engine.qpPhase, 'decision_pending', 'failed starts return the intact roster to a decision');
    assert.ok(engine.qpGeneration > generation);
}

async function testFourPlayerStartFailureReturnsToExplicitDecision() {
    const { service } = createService();
    const engine = service.findQuickPlayTable('dans-deck');
    [73, 74, 75, 76].forEach(id => seatHuman(engine, id));
    service.evaluateQuickPlayTable(engine.tableId);
    assert.equal(engine.qpPhase, 'decision_pending');
    const decisionGeneration = engine.qpGeneration;

    service.startGame = async (tableId, userId, options) => {
        const current = service.getEngineById(tableId);
        const result = current.startGame(userId, options);
        const transaction = result.effects.find(effect => effect.type === 'START_GAME_TRANSACTIONS');
        assert.ok(transaction, 'a valid four-player decision creates the transaction effect');
        transaction.onFailure(new Error('temporary database failure'), null);
    };

    assert.equal(service.quickPlayDecision(engine.tableId, 73, 'start4', decisionGeneration).accepted, true);
    await flushAsyncStart();
    assert.equal(engine.gameStartPending, false);
    assert.equal(engine.gameStarted, false);
    assert.equal(engine.playerOrder.count, 4, 'the intact roster remains seated after rollback');
    assert.equal(engine.qpPhase, 'decision_pending', 'a failed four-player start returns to explicit consent');
    assert.ok(engine.qpGeneration > decisionGeneration);
}

async function testTerminalResetReentersAConsistentQuickPlayPhase() {
    {
        const { service } = createService();
        const engine = seedDecisionTable(service, 'fort-creek', [75, 76]);
        engine.gameStarted = true;
        engine.gameId = 5001;
        engine.state = 'Game Over';
        engine.settlement.status = 'complete';
        await service.resetGame(engine.tableId);
        assert.equal(engine.playerOrder.count, 3);
        assert.equal(engine.qpPhase, 'decision_pending', 'a retained three-seat rematch returns to the table choice');
        assert.equal(engine.qpWindowEndsAt, null);
    }

    {
        const { service } = createService();
        const engine = service.findQuickPlayTable('shirecliff-road');
        [77, 78, 79, 80].forEach(id => seatHuman(engine, id));
        engine.gameStarted = true;
        engine.gameId = 5002;
        engine.state = 'Game Over';
        engine.settlement.status = 'complete';
        const starts = installPendingStartSpy(service);
        const terminalGeneration = engine.qpGeneration;
        await service.resetGame(engine.tableId);
        assert.equal(engine.qpPhase, 'decision_pending', 'a retained four-seat roster requires fresh consent');
        assert.equal(engine.gameStartPending, false, 'reset never schedules another charge automatically');
        assert.equal(starts.length, 0);

        const genericBypass = engine.startGame(77);
        assert.equal(engine.gameStartPending, false, 'generic start remains blocked for a retained roster');
        assert.ok(genericBypass.effects.some(effect => effect.type === 'EMIT_TO_SOCKET'));
        assert.equal(service.quickPlayDecision(engine.tableId, 77, 'start4', terminalGeneration).accepted, false);

        const decisionGeneration = engine.qpGeneration;
        assert.equal(service.quickPlayDecision(engine.tableId, 77, 'start3', decisionGeneration).accepted, false);
        assert.equal(service.quickPlayDecision(engine.tableId, 78, 'start4', decisionGeneration).accepted, true);
        assert.equal(service.quickPlayDecision(engine.tableId, 79, 'start4', decisionGeneration).accepted, false,
            'first valid four-player start choice wins synchronously');
        assert.equal(engine.qpPhase, 'starting_4');
        assert.equal(engine.gameStartPending, true);
        assert.deepEqual(starts[0].roster, [77, 78, 79, 80]);
    }
}

function createSocketHarness(service, io) {
    let connectionHandler;
    io.use = () => {};
    io.on = (event, handler) => { if (event === 'connection') connectionHandler = handler; };
    io.disconnectSockets = () => {};
    registerGameHandlers(io, service, {
        setIntervalFn: () => ({ unref() {} }),
        clearIntervalFn: () => {},
    });
    return {
        connect(user, id = `socket-${user.id}`) {
            const handlers = {};
            const socket = {
                id,
                user,
                data: {},
                connected: true,
                emitted: [],
                rooms: new Set(),
                on(event, handler) { handlers[event] = handler; },
                emit(event, payload) { this.emitted.push({ event, payload }); },
                join(room) { this.rooms.add(room); },
                leave(room) { this.rooms.delete(room); },
            };
            io.sockets.sockets.set(id, socket);
            connectionHandler(socket);
            return {
                socket,
                trigger(event, payload) {
                    assert.ok(handlers[event], `handler exists for ${event}`);
                    return handlers[event](payload);
                },
                disconnect() {
                    socket.connected = false;
                    io.sockets.sockets.delete(socket.id);
                    assert.ok(handlers.disconnect, 'disconnect handler exists');
                    return handlers.disconnect();
                },
            };
        },
    };
}

async function testDeferredBalanceCannotSeatDisconnectedSocket() {
    const io = createIo();
    let resolveBalance;
    const pool = {
        query(sql) {
            if (!/SUM\(amount\)/i.test(String(sql))) return Promise.resolve({ rows: [{}] });
            return new Promise(resolve => { resolveBalance = resolve; });
        },
    };
    const service = createGameServiceWithoutHeartbeat(GameService, io, pool);
    const harness = createSocketHarness(service, io);
    const stale = harness.connect({ id: 801, username: 'Disconnected', is_admin: false }, 'stale-disconnected');

    const pendingJoin = stale.trigger('quickPlay', { theme: 'fort-creek' });
    assert.equal(typeof resolveBalance, 'function');
    await stale.disconnect();
    resolveBalance({ rows: [{ tokens: '100.00' }] });
    await pendingJoin;

    assert.equal(Object.values(service.engines).some(engine => engine.players[801]), false);
    assert.equal(stale.socket.emitted.some(item => item.event === 'joinedTable'), false);
}

async function testReplacementSocketRevokesDeferredJoinBeforeAnySeatExists() {
    const io = createIo();
    let resolveBalance;
    const pool = {
        query(sql) {
            assert.match(String(sql), /SUM\(amount\)/i);
            return new Promise(resolve => { resolveBalance = resolve; });
        },
    };
    const service = createGameServiceWithoutHeartbeat(GameService, io, pool);
    const harness = createSocketHarness(service, io);
    const oldConnection = harness.connect({ id: 802, username: 'Reloading', is_admin: false }, 'socket-old');

    const pendingJoin = oldConnection.trigger('quickPlay', { theme: 'fort-creek' });
    assert.equal(typeof resolveBalance, 'function');
    harness.connect({ id: 802, username: 'Reloading', is_admin: false }, 'socket-new');
    resolveBalance({ rows: [{ tokens: '100.00' }] });
    await pendingJoin;

    assert.equal(Object.values(service.engines).some(engine => engine.players[802]), false,
        'the superseded continuation cannot create a seat after a replacement connects');
    assert.equal(oldConnection.socket.emitted.some(item => item.event === 'joinedTable'), false);
}

async function testReplacementControllerKeepsAdoptedSeatDuringDeferredJoin() {
    const io = createIo();
    let balanceCalls = 0;
    let resolveDeferredBalance;
    const pool = {
        query(sql) {
            assert.match(String(sql), /SUM\(amount\)/i);
            balanceCalls += 1;
            if (balanceCalls === 2) {
                return new Promise(resolve => { resolveDeferredBalance = resolve; });
            }
            return Promise.resolve({ rows: [{ tokens: '100.00' }] });
        },
    };
    const service = createGameServiceWithoutHeartbeat(GameService, io, pool);
    const privateTable = Object.values(service.engines).find(engine => (
        engine.tableType === 'private' && engine.theme === 'fort-creek'
    ));
    seatHuman(privateTable, 803, 'Seat Owner');
    const harness = createSocketHarness(service, io);
    const oldConnection = harness.connect({ id: 803, username: 'Seat Owner', is_admin: false }, 'controller-old');

    const pendingJoin = oldConnection.trigger('quickPlay', { theme: 'fort-creek' });
    assert.equal(typeof resolveDeferredBalance, 'function');
    harness.connect({ id: 803, username: 'Seat Owner', is_admin: false }, 'controller-new');
    assert.equal(privateTable.players[803].socketId, 'controller-new');
    resolveDeferredBalance({ rows: [{ tokens: '100.00' }] });
    await pendingJoin;

    assert.equal(privateTable.players[803].socketId, 'controller-new');
    assert.equal(privateTable.playerOrder.includes(803), true);
    assert.equal(
        Object.values(service.engines).some(engine => engine.tableType === 'quickplay' && engine.players[803]),
        false,
        'the old continuation cannot move or duplicate a seat controlled by the replacement',
    );
    assert.equal(oldConnection.socket.emitted.some(item => item.event === 'joinedTable'), false);
}

async function testOlderLiveSocketRecoversWhenLatestDisconnects() {
    const io = createIo();
    const pool = { query: async () => ({ rows: [{ tokens: '100.00' }] }) };
    const service = createGameServiceWithoutHeartbeat(GameService, io, pool);
    const harness = createSocketHarness(service, io);
    const account = { id: 804, username: 'Two Tabs', is_admin: false };
    const olderConnection = harness.connect(account, 'tab-older');
    const latestConnection = harness.connect(account, 'tab-latest');

    await latestConnection.disconnect();
    await olderConnection.trigger('quickPlay', { theme: 'fort-creek' });

    const claimedEngine = Object.values(service.engines).find(engine => engine.players[804]);
    assert.ok(claimedEngine, 'the newest remaining live socket can match again');
    assert.equal(claimedEngine.players[804].socketId, 'tab-older');
    assert.equal(olderConnection.socket.emitted.some(item => item.event === 'joinedTable'), true);
}

async function testDelayedBalanceRaceAndSocketDecisionValidation() {
    const io = createIo();
    let resolveBalance;
    const pool = {
        query(sql) {
            assert.match(String(sql), /SUM\(amount\)/i);
            return new Promise(resolve => { resolveBalance = resolve; });
        },
    };
    const service = createGameServiceWithoutHeartbeat(GameService, io, pool);
    service.timerOverride = (callback, duration) => ({ callback, duration });
    const target = seedDecisionTable(service, 'fort-creek', [81, 82]);
    installPendingStartSpy(service);
    service.quickPlayDecision(target.tableId, 81, 'seek4', target.qpGeneration);
    const harness = createSocketHarness(service, io);
    const late = harness.connect({ id: 83, username: 'Late Fourth', is_admin: false }, 'late-fourth');

    const pendingJoin = late.trigger('quickPlay', { theme: target.theme });
    assert.equal(typeof resolveBalance, 'function', 'balance I/O is pending before a target is selected');
    const winningFourth = service.claimQuickPlaySeat(
        target.theme,
        { id: 84, username: 'Winning Fourth' },
        'winning-fourth',
        '100.00',
    );
    assert.equal(winningFourth.tableId, target.tableId);
    assert.equal(target.gameStartPending, true);
    resolveBalance({ rows: [{ tokens: '100.00' }] });
    await pendingJoin;

    const lateEngine = Object.values(service.engines).find(engine => engine.players[83]);
    assert.ok(lateEngine);
    assert.notEqual(lateEngine.tableId, target.tableId, 'late continuation reselects instead of using a stale target');
    assert.equal(lateEngine.players[83].isSpectator, false);
    assert.equal(target.players[83], undefined);

    const originalTableErrors = late.socket.emitted.filter(item => item.event === 'error').length;
    await late.trigger('quickPlayDecision', {
        tableId: target.tableId,
        choice: 'start3',
        generation: target.qpGeneration,
    });
    assert.equal(
        late.socket.emitted.filter(item => item.event === 'error').length,
        originalTableErrors + 1,
        'a nonmember cannot decide another table through the socket event',
    );

    const malformedErrors = late.socket.emitted.filter(item => item.event === 'error').length;
    await late.trigger('quickPlayDecision', {
        tableId: lateEngine.tableId,
        choice: 'start3',
        generation: 'not-an-integer',
    });
    assert.equal(
        late.socket.emitted.filter(item => item.event === 'error').length,
        malformedErrors + 1,
        'malformed socket decisions are rejected by the action guard',
    );
}

async function testNoMatchRetryPreservesPreviousWaitingSeat() {
    const io = createIo();
    const pool = { query: async () => ({ rows: [{ tokens: '100.00' }] }) };
    const service = createGameServiceWithoutHeartbeat(GameService, io, pool);
    for (const engine of Object.values(service.engines)) {
        if (engine.tableType === 'quickplay' && engine.theme === 'fort-creek') {
            engine.gameStartPending = true;
        }
    }
    const privateTable = Object.values(service.engines).find(engine => (
        engine.tableType === 'private' && engine.theme === 'fort-creek'
    ));
    seatHuman(privateTable, 91, 'Waiting Player');
    const harness = createSocketHarness(service, io);
    const waiting = harness.connect({ id: 91, username: 'Waiting Player', is_admin: false }, 'waiting-player');

    await waiting.trigger('quickPlay', { theme: 'fort-creek' });
    assert.ok(privateTable.players[91], 'a no-seat result preserves the previous waiting-table membership');
    assert.equal(privateTable.playerOrder.includes(91), true);
    assert.equal(waiting.socket.rooms.has(privateTable.tableId), true, 'the socket also remains in its previous room');
    assert.equal(
        Object.values(service.engines).some(engine => engine.tableType === 'quickplay' && engine.players[91]),
        false,
    );
    assert.ok(waiting.socket.emitted.some(item => (
        item.event === 'error' && /current seat is safe.*try again/i.test(item.payload.message)
    )), 'the preserved-seat retry is visible through the existing error UI');
}

async function runQuickPlayTests() {
    await testFillStopsForDecisionAndSerializesContract();
    testFirstValidDecisionWinsSynchronously();
    await testSearchTimeoutReturnsToDecisionAndGuardsDeadline();
    testSearchDeadlineIsEnforcedBeforeDelayedTimerRuns();
    testFourthHumanStartsExactRosterAndBotsCannotTakeSeatFour();
    testConcurrentFourthsRematchWithoutSpectatorFallback();
    await testStaleFillTimerAndLeaveRefillCycle();
    await testHardResetGenerationRejectsOldTableTimers();
    await testDecisionGuardsGenericStartAndRecoversFromStartFailure();
    await testFourPlayerStartFailureReturnsToExplicitDecision();
    await testTerminalResetReentersAConsistentQuickPlayPhase();
    await testDeferredBalanceCannotSeatDisconnectedSocket();
    await testReplacementSocketRevokesDeferredJoinBeforeAnySeatExists();
    await testReplacementControllerKeepsAdoptedSeatDuringDeferredJoin();
    await testOlderLiveSocketRecoversWhenLatestDisconnects();
    await testDelayedBalanceRaceAndSocketDecisionValidation();
    await testNoMatchRetryPreservesPreviousWaitingSeat();

    const { service } = createService();
    const listed = service.getLobbyState().themes.flatMap(theme => theme.tables.map(table => table.tableId));
    assert.equal(listed.length, 40);
    assert.ok(listed.every(tableId => !tableId.startsWith('qp-')), 'Quick Play remains hidden from the lobby');
    console.log('QUICK PLAY MATCHMAKER TEST PASSED');
}

if (require.main === module) {
    runQuickPlayTests().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = runQuickPlayTests;
