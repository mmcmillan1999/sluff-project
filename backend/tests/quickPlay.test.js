'use strict';

const assert = require('node:assert/strict');
const GameEngine = require('../src/core/GameEngine');
const GameService = require('../src/services/GameService');
const transactionManager = require('../src/data/transactionManager');
const {
    TERMINAL_QUICKPLAY_DISCONNECTED_CLEANUP_DELAY_MS,
    QUICKPLAY_FOURTH_FALLBACK_MIN_DELAY_MS,
    QUICKPLAY_FOURTH_FALLBACK_MAX_DELAY_MS,
} = GameService;
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
    service.quickPlayRandomOverride = () => 0;
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
        assert.equal(engine.qpWindowEndsAt, 1_008_000);
        assert.equal(service.qpTimers[engine.tableId].window.handle.duration, 8000);
        assert.equal(engine.getStateForClient({ userId: 21 }).qpWindowEndsAt, null,
            'the randomized deadline remains private to the server');
    }
}

async function testSearchTimeoutSeatsFallbackAndGuardsDeadline() {
    const harness = createService();
    const { service } = harness;
    const engine = seedDecisionTable(service, 'miss-pauls-academy', [31]);
    const starts = installPendingStartSpy(service);
    const decisionGeneration = engine.qpGeneration;
    service.quickPlayDecision(engine.tableId, 31, 'seek4', decisionGeneration);
    const searchGeneration = engine.qpGeneration;
    const earlyTimer = service.qpTimers[engine.tableId].window.handle;

    harness.advanceNow(7_000);
    await earlyTimer.callback();
    assert.equal(engine.qpPhase, 'seeking_fourth', 'an early timer cannot close the search');
    assert.equal(service.qpTimers[engine.tableId].window.handle.duration, 1000, 'early wake is re-armed to the deadline');

    harness.advanceNow(1_000);
    await service.qpTimers[engine.tableId].window.handle.callback();
    assert.equal(engine.qpPhase, 'starting_4');
    assert.equal(engine.qpWindowEndsAt, null);
    assert.ok(engine.qpGeneration > searchGeneration);
    assert.equal(engine.playerOrder.count, 4);
    const fallbackId = engine.playerOrder.allIds[3];
    assert.equal(engine.players[fallbackId].isBot, true);
    assert.equal(engine.qpFallbackBot.userId, fallbackId);
    assert.equal(engine.gameStartPending, true, 'the four-player roster freezes synchronously');
    assert.equal(starts.length, 1);
    assert.equal(starts[0].options.quickPlayStart.playerMode, 4);
    assert.equal(starts[0].options.quickPlayStart.fallbackBotId, fallbackId);

    const currentGeneration = engine.qpGeneration;
    await earlyTimer.callback();
    assert.equal(engine.qpGeneration, currentGeneration, 'stale search timers cannot add a fifth seat or restart');
    assert.equal(engine.playerOrder.count, 4);
    assert.equal(starts.length, 1);
}

async function testEarlyWakeKeepsTheOriginalRandomDeadline() {
    const harness = createService();
    const { service } = harness;
    let randomCalls = 0;
    service.quickPlayRandomOverride = () => {
        randomCalls += 1;
        return 0.5;
    };
    const engine = seedDecisionTable(service, 'fort-creek', [32]);
    service.quickPlayDecision(engine.tableId, 32, 'seek4', engine.qpGeneration);
    const record = service.qpTimers[engine.tableId].window;
    const originalDeadline = engine.qpWindowEndsAt;
    assert.equal(randomCalls, 1);

    harness.setNow(originalDeadline - 1234);
    await record.handle.callback();
    assert.equal(randomCalls, 1, 'an early timer rearm does not choose a second random delay');
    assert.equal(engine.qpWindowEndsAt, originalDeadline);
    assert.equal(service.qpTimers[engine.tableId].window, record);
    assert.equal(record.handle.duration, 1234);
}

async function testHumanBeforeDeadlineWinsAndStaleTimerCannotReplaceThem() {
    const harness = createService();
    const { service } = harness;
    const engine = seedDecisionTable(service, 'dans-deck', [33, 34]);
    const starts = installPendingStartSpy(service);
    service.quickPlayDecision(engine.tableId, 33, 'seek4', engine.qpGeneration);
    const staleTimer = service.qpTimers[engine.tableId].window.handle;
    harness.setNow(engine.qpWindowEndsAt - 1);

    const claimed = service.claimQuickPlaySeat(
        engine.theme,
        { id: 330, username: 'Human Fourth' },
        'socket-330',
        '100.00',
    );
    assert.equal(claimed, engine);
    assert.equal(engine.playerOrder.allIds[3], 330);
    assert.notEqual(engine.players[330].isBot, true);
    assert.equal(starts.length, 1);

    harness.setNow(harness.service._quickPlayNow() + 1);
    await staleTimer.callback();
    assert.equal(engine.playerOrder.count, 4);
    assert.equal(engine.playerOrder.allIds[3], 330);
    assert.equal(starts.length, 1);
}

async function testTimerAtDeadlineWinsAndLateHumanIsRematched() {
    const harness = createService();
    const { service } = harness;
    const engine = seedDecisionTable(service, 'shirecliff-road', [38, 39]);
    const starts = installPendingStartSpy(service);
    service.quickPlayDecision(engine.tableId, 38, 'seek4', engine.qpGeneration);
    const timer = service.qpTimers[engine.tableId].window.handle;
    harness.setNow(engine.qpWindowEndsAt);
    await timer.callback();

    const fallbackId = engine.playerOrder.allIds[3];
    assert.equal(engine.players[fallbackId].isBot, true);
    assert.equal(starts.length, 1);
    const lateMatch = service.claimQuickPlaySeat(
        engine.theme,
        { id: 390, username: 'Late Human' },
        'socket-390',
        '100.00',
    );
    assert.ok(lateMatch);
    assert.notEqual(lateMatch, engine);
    assert.equal(engine.players[390], undefined);
    assert.equal(lateMatch.players[390].isSpectator, false);
}

function testSearchDeadlineIsEnforcedBeforeDelayedTimerRuns() {
    const harness = createService();
    const { service } = harness;
    const engine = seedDecisionTable(service, 'shirecliff-road', [35, 36]);
    service.quickPlayDecision(engine.tableId, 35, 'seek4', engine.qpGeneration);
    const deadline = engine.qpWindowEndsAt;

    harness.setNow(deadline - 1);
    assert.equal(service.canAcceptQuickPlayHuman(engine), true, 'the fourth seat remains open before the deadline');
    assert.equal(engine.addQuickPlayFallbackBot({
        generation: engine.qpGeneration,
        deadline,
        now: deadline - 1,
    }), null, 'even the dedicated fallback method is deadline-bound');
    assert.equal(engine.playerOrder.count, 3);
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

async function testFallbackCreationFailureReturnsToFreshDecision() {
    for (const failure of ['null', 'throw']) {
        const harness = createService();
        const { service } = harness;
        const engine = seedDecisionTable(service, 'miss-pauls-academy', [371, 372]);
        const starts = installPendingStartSpy(service);
        service.quickPlayDecision(engine.tableId, 371, 'seek4', engine.qpGeneration);
        const searchGeneration = engine.qpGeneration;
        const timer = service.qpTimers[engine.tableId].window.handle;
        engine.addQuickPlayFallbackBot = () => {
            if (failure === 'throw') throw new Error('synthetic bot construction failure');
            return null;
        };
        harness.setNow(engine.qpWindowEndsAt);

        const originalError = console.error;
        console.error = () => {};
        try {
            await timer.callback();
        } finally {
            console.error = originalError;
        }
        assert.equal(engine.playerOrder.count, 3);
        assert.equal(engine.qpPhase, 'decision_pending');
        assert.ok(engine.qpGeneration > searchGeneration);
        assert.equal(engine.qpWindowEndsAt, null);
        assert.equal(starts.length, 0);
    }
}

async function testDisconnectBeforeDeadlineCancelsFallback() {
    const harness = createService();
    const { service } = harness;
    const engine = seedDecisionTable(service, 'fort-creek', [373]);
    service.quickPlayDecision(engine.tableId, 373, 'seek4', engine.qpGeneration);
    const staleTimer = service.qpTimers[engine.tableId].window.handle;

    engine.disconnectPlayer(373);
    service.evaluateQuickPlayTable(engine.tableId);
    assert.equal(engine.qpPhase, 'filling');
    assert.equal(engine.playerOrder.count, 0, 'the abandoned table sweeps its matchmaking bots');
    await staleTimer.callback();
    assert.equal(engine.playerOrder.count, 0);
    assert.equal(engine.qpFallbackBot, null);
}

async function testTimerBeforeDisconnectFreezesOneFallbackRoster() {
    const harness = createService();
    const { service } = harness;
    const engine = seedDecisionTable(service, 'dans-deck', [374]);
    const starts = installPendingStartSpy(service);
    service.quickPlayDecision(engine.tableId, 374, 'seek4', engine.qpGeneration);
    const timer = service.qpTimers[engine.tableId].window.handle;
    harness.setNow(engine.qpWindowEndsAt);
    await timer.callback();
    const frozenRoster = [...engine.playerOrder.allIds];

    engine.disconnectPlayer(374);
    service.evaluateQuickPlayTable(engine.tableId);
    assert.deepEqual(engine.playerOrder.allIds, frozenRoster,
        'a disconnect after the funded start is pending cannot reshape its roster');
    assert.equal(engine.players[374].disconnected, true);
    assert.equal(starts.length, 1);
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

async function prepareBoundFallbackStart(harness, theme, humanIds) {
    const { service } = harness;
    const engine = seedDecisionTable(service, theme, humanIds);
    const existingBotIds = engine.playerOrder.allIds.filter(id => engine.players[id]?.isBot);
    service._startQuickPlayGame = () => {};
    service.quickPlayDecision(engine.tableId, humanIds[0], 'seek4', engine.qpGeneration);
    const timer = service.qpTimers[engine.tableId].window.handle;
    harness.setNow(engine.qpWindowEndsAt);
    await timer.callback();
    assert.equal(engine.qpPhase, 'starting_4');
    const fallbackBotId = engine.playerOrder.allIds[3];
    assert.equal(engine.qpFallbackBot?.userId, fallbackBotId);
    assert.equal(engine.qpFallbackBot?.startGeneration, engine.qpGeneration);
    return { engine, fallbackBotId, existingBotIds };
}

async function testFallbackAuthorizationTransactionAndRollbackRecovery() {
    const harness = createService();
    const { service } = harness;
    const { engine, fallbackBotId, existingBotIds } = await prepareBoundFallbackStart(
        harness,
        'fort-creek',
        [44, 45],
    );
    const generation = engine.qpGeneration;

    const staleAuthorization = engine.startGame(44, {
        quickPlayStart: {
            generation: generation + 1,
            playerMode: 4,
            fallbackBotId,
        },
    });
    assert.equal(engine.gameStartPending, false);
    assert.equal(staleAuthorization.effects.some(effect => effect.type === 'START_GAME_TRANSACTIONS'), false,
        'a fallback marker never authorizes another generation');

    const authorizedStart = engine.startGame(44, {
        quickPlayStart: { generation, playerMode: 4, fallbackBotId },
    });
    const transaction = authorizedStart.effects.find(effect => effect.type === 'START_GAME_TRANSACTIONS');
    assert.ok(transaction, 'the exact server-marked fallback generation can start');
    assert.equal(transaction.payload.table.playerMode, 4);
    assert.deepEqual(transaction.payload.playerIds, [44, 45],
        'the fallback bot and existing matchmaking bot are excluded from charges');

    transaction.onFailure(new Error('synthetic transaction rollback'), null);
    service.evaluateQuickPlayTable(engine.tableId);
    assert.equal(engine.playerOrder.count, 3);
    assert.equal(engine.players[fallbackBotId], undefined, 'rollback removes the exact fourth fallback bot');
    assert.equal(engine.qpFallbackBot, null);
    for (const botId of existingBotIds) {
        assert.equal(engine.players[botId]?.isBot, true, 'ordinary fill bots remain after fallback rollback');
    }
    assert.equal(engine.qpPhase, 'decision_pending');
    assert.ok(engine.qpGeneration > generation);
}

async function testThreeHumanFallbackChargesExactHumanRoster() {
    const harness = createService();
    const { engine, fallbackBotId } = await prepareBoundFallbackStart(
        harness,
        'miss-pauls-academy',
        [441, 442, 443],
    );
    const generation = engine.qpGeneration;
    const start = engine.startGame(441, {
        quickPlayStart: { generation, playerMode: 4, fallbackBotId },
    });
    const transaction = start.effects.find(effect => effect.type === 'START_GAME_TRANSACTIONS');
    assert.ok(transaction);
    assert.equal(transaction.payload.table.playerMode, 4);
    assert.deepEqual(transaction.payload.playerIds, [441, 442, 443]);
    assert.equal(transaction.payload.playerIds.includes(fallbackBotId), false);
    transaction.onFailure(new Error('test cleanup'), null);
}

async function testRejectedFallbackLaunchRecoversWithoutRetry() {
    const harness = createService();
    const { service } = harness;
    const engine = seedDecisionTable(service, 'shirecliff-road', [46, 47]);
    let attempts = 0;
    service.startGame = async () => {
        attempts += 1;
        throw new Error('synthetic launch rejection');
    };
    service.quickPlayDecision(engine.tableId, 46, 'seek4', engine.qpGeneration);
    const timer = service.qpTimers[engine.tableId].window.handle;
    harness.setNow(engine.qpWindowEndsAt);
    const originalError = console.error;
    console.error = () => {};
    try {
        await timer.callback();
        await flushAsyncStart();
    } finally {
        console.error = originalError;
    }

    assert.equal(attempts, 1, 'a rejected fire-and-forget start is never automatically retried');
    assert.equal(engine.playerOrder.count, 3);
    assert.equal(engine.qpFallbackBot, null);
    assert.equal(engine.qpPhase, 'decision_pending');
}

async function testNoopFallbackLaunchAlsoRecoversWithoutRetry() {
    const harness = createService();
    const { service } = harness;
    const engine = seedDecisionTable(service, 'fort-creek', [461, 462]);
    let attempts = 0;
    service.startGame = async () => { attempts += 1; };
    service.quickPlayDecision(engine.tableId, 461, 'seek4', engine.qpGeneration);
    const timer = service.qpTimers[engine.tableId].window.handle;
    harness.setNow(engine.qpWindowEndsAt);
    await timer.callback();
    await flushAsyncStart();

    assert.equal(attempts, 1);
    assert.equal(engine.playerOrder.count, 3);
    assert.equal(engine.qpFallbackBot, null);
    assert.equal(engine.qpPhase, 'decision_pending');
}

async function testTerminalResetRemovesOnlyMarkedFallbackBot() {
    const harness = createService();
    const { service } = harness;
    const { engine, fallbackBotId, existingBotIds } = await prepareBoundFallbackStart(
        harness,
        'dans-deck',
        [48, 49],
    );
    const generation = engine.qpGeneration;
    const start = engine.startGame(48, {
        quickPlayStart: { generation, playerMode: 4, fallbackBotId },
    });
    const transaction = start.effects.find(effect => effect.type === 'START_GAME_TRANSACTIONS');
    transaction.onSuccess(5048, {});
    engine.state = 'Game Over';
    engine.settlement = { status: 'complete', kind: 'normal', attempts: 1, lastErrorCode: null };

    await service.resetGame(engine.tableId);
    assert.equal(engine.players[fallbackBotId], undefined);
    assert.equal(engine.qpFallbackBot, null);
    assert.equal(engine.playerOrder.count, 3);
    for (const botId of existingBotIds) assert.equal(engine.players[botId]?.isBot, true);
    assert.equal(engine.qpPhase, 'decision_pending', 'the retained three seats require fresh rematch consent');
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

async function testHardResetRejectsStaleFourthFallbackTimer() {
    const harness = createService();
    const { service } = harness;
    const original = seedDecisionTable(service, 'shirecliff-road', [67, 68]);
    service.quickPlayDecision(original.tableId, 67, 'seek4', original.qpGeneration);
    const staleWindow = service.qpTimers[original.tableId].window.handle;
    const staleDeadline = original.qpWindowEndsAt;

    service.resetAllEngines();
    const replacement = service.getEngineById(original.tableId);
    const replacementGeneration = replacement.qpGeneration;
    harness.setNow(staleDeadline);
    await staleWindow.callback();

    assert.notEqual(replacement, original);
    assert.equal(replacement.playerOrder.count, 0);
    assert.equal(replacement.qpGeneration, replacementGeneration);
    assert.equal(replacement.qpFallbackBot, null);
    assert.equal(replacement.gameStartPending, false);
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

function testFourthFallbackDelayIsInclusiveAndInjectable() {
    const { service } = createService();
    service.quickPlayRandomOverride = () => 0;
    assert.equal(service._quickPlayFourthFallbackDelay(), QUICKPLAY_FOURTH_FALLBACK_MIN_DELAY_MS);

    service.quickPlayRandomOverride = () => 1 - Number.EPSILON;
    assert.equal(service._quickPlayFourthFallbackDelay(), QUICKPLAY_FOURTH_FALLBACK_MAX_DELAY_MS);

    service.quickPlayRandomOverride = () => 0.5;
    const midpoint = service._quickPlayFourthFallbackDelay();
    assert.ok(midpoint >= QUICKPLAY_FOURTH_FALLBACK_MIN_DELAY_MS);
    assert.ok(midpoint <= QUICKPLAY_FOURTH_FALLBACK_MAX_DELAY_MS);
}

async function testAbandonedTerminalQuickPlayRecyclesAfterReconnectGrace() {
    const { service } = createService();
    const engine = seedDecisionTable(service, 'miss-pauls-academy', [85, 86]);
    engine.gameStarted = true;
    engine.gameId = 5085;
    engine.state = 'Game Over';
    engine.settlement = { status: 'complete', kind: 'normal', attempts: 1, lastErrorCode: null };

    const scheduled = [];
    service.terminalCleanupTimerOverride = (callback, duration) => {
        const timer = { callback, duration, unref() {} };
        scheduled.push(timer);
        return timer;
    };

    const lifecycle = service.evaluateTerminalCleanup(engine.tableId);
    assert.equal(lifecycle.kind, 'disconnected');
    assert.equal(scheduled[0].duration, TERMINAL_QUICKPLAY_DISCONNECTED_CLEANUP_DELAY_MS);
    await scheduled[0].callback();

    assert.equal(engine.gameStarted, false);
    assert.equal(engine.gameId, null);
    assert.equal(engine.qpPhase, 'filling');
    assert.equal(engine.playerOrder.count, 0, 'abandoned human seats and matchmaking bots are fully recycled');
    assert.equal(Object.keys(engine.players).length, 0);
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

function createFundedQuickPlayHarness({
    botAccounts,
    balances = {},
    queryOverride = null,
} = {}) {
    const io = createIo();
    let balanceQueryCount = 0;
    const rowsForCurrentBalances = () => botAccounts.map(profile => {
        const tokens = Number(balances[profile.id] ?? 0);
        const cents = Math.round(tokens * 100);
        return {
            id: profile.id,
            user_id: profile.id,
            tokens: String(tokens),
            current_tokens: String(tokens),
            balance_cents: String(cents),
            current_balance_cents: String(cents),
        };
    });
    const pool = {
        query(sql, params) {
            balanceQueryCount += 1;
            if (queryOverride) return queryOverride(sql, params, rowsForCurrentBalances);
            return Promise.resolve({ rows: rowsForCurrentBalances(), rowCount: botAccounts.length });
        },
    };
    const service = createGameServiceWithoutHeartbeat(
        GameService,
        io,
        pool,
        { botAccounts },
    );
    const scheduled = [];
    let now = 1_000_000;
    service.nowOverride = () => now;
    service.quickPlayRandomOverride = () => 0;
    service.timerOverride = (callback, duration) => {
        const timer = { callback, duration };
        scheduled.push(timer);
        return timer;
    };
    return {
        service,
        io,
        scheduled,
        getBalanceQueryCount() { return balanceQueryCount; },
        setNow(value) { now = value; },
        advanceNow(value) { now += value; },
    };
}

const EAGLEWOOD_POOL_THIN_NOTICE = Object.freeze({
    code: 'HIGH_STAKES_POOL_THIN',
    recommendedThemeId: 'shirecliff-road',
    recommendedTableName: 'Shirecliff',
});

async function testQuickPlaySeatsOnlyBotsWithFreshAffordableBalances() {
    const botAccounts = [
        { id: 9001, username: 'Under Funded', tokens: 100, isBot: true },
        { id: 9002, username: 'Exact Change', tokens: 0, isBot: true },
        { id: 9003, username: 'High Roller', tokens: 0, isBot: true },
    ];
    const harness = createFundedQuickPlayHarness({
        botAccounts,
        balances: { 9001: 19.99, 9002: 20, 9003: 60 },
    });
    const { service } = harness;
    const engine = service.findQuickPlayTable('dans-deck');
    seatHuman(engine, 900, 'Eaglewood Human');
    service.evaluateQuickPlayTable(engine.tableId, { restartFill: true });

    let fillRecord = service.qpTimers[engine.tableId].fill;
    await fillRecord.handle.callback();
    fillRecord = service.qpTimers[engine.tableId].fill;
    await fillRecord.handle.callback();

    const seatedBotIds = engine.playerOrder.allIds
        .filter(id => engine.players[id]?.isBot)
        .sort((left, right) => left - right);
    assert.deepEqual(seatedBotIds, [9002, 9003],
        'the stale 100-token snapshot cannot admit a 19.99-token bot to a 20-token table');
    assert.equal(engine.players[9002].tokens, 20,
        'a bot with exactly the buy-in remains eligible using integer-cent comparison');
    assert.equal(engine.players[9003].tokens, 60);
    assert.equal(engine.players[9001], undefined);
    assert.equal(engine.qpPhase, 'decision_pending');
    assert.equal(engine.qpMatchmakingNotice, null);
    assert.equal(harness.getBalanceQueryCount(), 2,
        'each delayed bot seat uses a fresh ledger lookup');
}

async function testQuickPlayStartPreflightRemovesBotWhoseBalanceDropped() {
    const balances = { 9004: 20 };
    const harness = createFundedQuickPlayHarness({
        botAccounts: [
            { id: 9004, username: 'Fallen High Roller', tokens: 100, isBot: true },
        ],
        balances,
    });
    const { service } = harness;
    const engine = service.findQuickPlayTable('dans-deck');
    seatHuman(engine, 907, 'First Starter');
    seatHuman(engine, 908, 'Second Starter');
    service.evaluateQuickPlayTable(engine.tableId, { restartFill: true });

    await service.qpTimers[engine.tableId].fill.handle.callback();
    assert.deepEqual(engine.playerOrder.allIds, [907, 908, 9004]);
    assert.equal(engine.qpPhase, 'decision_pending');
    assert.equal(engine.players[9004].tokens, 20,
        'the bot was affordable when matchmaking seated it');

    balances[9004] = 19.99;
    const starts = installPendingStartSpy(service);
    const decision = service.quickPlayDecision(engine.tableId, 907, 'start3', engine.qpGeneration);
    assert.equal(decision.accepted, true);
    assert.equal(engine.qpPhase, 'starting_3');
    await flushAsyncStart();
    await flushAsyncStart();

    assert.deepEqual(engine.playerOrder.allIds, [907, 908],
        'the start preflight removes the newly unaffordable bot');
    assert.equal(engine.players[9004], undefined);
    assert.equal(starts.length, 0, 'the stale funded roster never reaches startGame');
    assert.equal(engine.gameStartPending, false);
    assert.equal(engine.gameStarted, false);
    assert.equal(engine.qpPhase, 'filling');
    assert.deepEqual(engine.qpMatchmakingNotice, EAGLEWOOD_POOL_THIN_NOTICE);
    assert.ok(service.qpTimers[engine.tableId].fill,
        'the two-human roster resumes searching after the bot is removed');
    assert.equal(harness.getBalanceQueryCount(), 2,
        'matchmaking and start consent each use their own fresh ledger lookup');
}

async function testFallbackMarkerClearsWhenAffordableFourthSlidesIntoThreeSeatRoster() {
    const balances = { 9005: 20, 9006: 19.99 };
    const harness = createFundedQuickPlayHarness({
        botAccounts: [
            { id: 9005, username: 'Ordinary Funded Bot', tokens: 20, isBot: true },
            { id: 9006, username: 'Fallback Funded Bot', tokens: 20, isBot: true },
        ],
        balances,
    });
    const { service } = harness;
    const engine = service.findQuickPlayTable('dans-deck');
    seatHuman(engine, 909, 'Fallback Tester One');
    seatHuman(engine, 910, 'Fallback Tester Two');
    service.evaluateQuickPlayTable(engine.tableId, { restartFill: true });
    await service.qpTimers[engine.tableId].fill.handle.callback();
    assert.deepEqual(engine.playerOrder.allIds, [909, 910, 9005]);

    // The ordinary bot loses funding while a different bot becomes eligible
    // for the fourth seat. The fourth is still affordable at start preflight.
    balances[9005] = 19.99;
    balances[9006] = 20;
    const starts = installPendingStartSpy(service);
    assert.equal(
        service.quickPlayDecision(engine.tableId, 909, 'seek4', engine.qpGeneration).accepted,
        true,
    );
    let fallbackTimer = service.qpTimers[engine.tableId].window.handle;
    harness.setNow(engine.qpWindowEndsAt);
    await fallbackTimer.callback();
    await flushAsyncStart();
    await flushAsyncStart();

    assert.deepEqual(engine.playerOrder.allIds, [909, 910, 9006],
        'removing the ordinary bot slides the funded fourth into the first three seats');
    assert.equal(engine.players[9006]?.isBot, true);
    assert.equal(engine.qpFallbackBot, null,
        'a bot that is no longer fourth is demoted from the generation-bound fallback role');
    assert.equal(engine.qpPhase, 'decision_pending');
    assert.deepEqual(engine.qpMatchmakingNotice, EAGLEWOOD_POOL_THIN_NOTICE);
    assert.equal(starts.length, 0);

    // A fresh fourth-player search must be able to mark another fallback. A
    // stale marker for 9006 would make addQuickPlayFallbackBot reject this.
    balances[9005] = 20;
    assert.equal(
        service.quickPlayDecision(engine.tableId, 909, 'seek4', engine.qpGeneration).accepted,
        true,
    );
    fallbackTimer = service.qpTimers[engine.tableId].window.handle;
    harness.setNow(engine.qpWindowEndsAt);
    await fallbackTimer.callback();
    await flushAsyncStart();
    await flushAsyncStart();

    assert.deepEqual(engine.playerOrder.allIds, [909, 910, 9006, 9005]);
    assert.equal(engine.qpFallbackBot?.userId, 9005,
        'the later search binds a new fourth-seat fallback instead of being blocked');
    assert.equal(engine.qpFallbackBot?.startGeneration, engine.qpGeneration);
    assert.equal(engine.qpPhase, 'starting_4');
    assert.equal(starts.length, 1);
    assert.equal(starts[0].options.quickPlayStart.fallbackBotId, 9005);
}

async function testAtomicBotFundingRacePublishesRecoveredAuthoritativeState() {
    const balances = { 9007: 20 };
    const harness = createFundedQuickPlayHarness({
        botAccounts: [
            { id: 9007, username: 'Atomic Race Bot', tokens: 20, isBot: true },
        ],
        balances,
    });
    const { service, io } = harness;
    const engine = service.findQuickPlayTable('dans-deck');
    seatHuman(engine, 911, 'Atomic Human One');
    seatHuman(engine, 912, 'Atomic Human Two');
    service.evaluateQuickPlayTable(engine.tableId, { restartFill: true });
    await service.qpTimers[engine.tableId].fill.handle.callback();
    assert.deepEqual(engine.playerOrder.allIds, [911, 912, 9007]);

    const humanSocket = {
        id: 'socket-911',
        user: { id: 911, username: 'Atomic Human One', is_admin: false },
        data: {},
        emitted: [],
        emit(event, payload) { this.emitted.push({ event, payload }); },
    };
    io.sockets.sockets.set(humanSocket.id, humanSocket);
    humanSocket.emitted.length = 0;

    const originalMercy = transactionManager.handleAutomaticBotMercyToken;
    const originalStartTransaction = transactionManager.startGameTransaction;
    const originalEmitGameState = service.emitGameState.bind(service);
    let transactionAttempts = 0;
    let recoveredStateWasEmitted = false;
    transactionManager.handleAutomaticBotMercyToken = async () => ({
        granted: false,
        reason: 'balance_not_below_threshold',
        currentTokens: 20,
    });
    transactionManager.startGameTransaction = async () => {
        transactionAttempts += 1;
        throw new Error('Atomic Race Bot has insufficient tokens. Needs 20, but has 19.99.');
    };
    service.emitGameState = tableId => {
        originalEmitGameState(tableId);
        const current = service.getEngineById(tableId);
        if (current?.qpMatchmakingNotice
            && ['filling', 'decision_pending'].includes(current.qpPhase)) {
            recoveredStateWasEmitted = true;
        }
    };

    let decision;
    try {
        decision = service.quickPlayDecision(engine.tableId, 911, 'start3', engine.qpGeneration);
        // All mocked database operations settle immediately. Drain the complete
        // preflight -> atomic failure -> state-recovery promise chain.
        for (let turn = 0; turn < 24; turn += 1) await Promise.resolve();
    } finally {
        transactionManager.handleAutomaticBotMercyToken = originalMercy;
        transactionManager.startGameTransaction = originalStartTransaction;
        service.emitGameState = originalEmitGameState;
    }

    assert.equal(decision.accepted, true);
    assert.equal(transactionAttempts, 1,
        'the bot passed live preflight before losing the final atomic funding race');
    assert.deepEqual(engine.playerOrder.allIds, [911, 912]);
    assert.equal(engine.players[9007], undefined);
    assert.equal(engine.gameStartPending, false);
    assert.equal(engine.gameStarted, false);
    assert.equal(engine.qpFundingShortageRecovery, null);
    assert.equal(engine.qpPhase, 'filling');
    assert.deepEqual(engine.qpMatchmakingNotice, EAGLEWOOD_POOL_THIN_NOTICE);
    assert.equal(recoveredStateWasEmitted, true,
        'recovery broadcasts authoritative table state instead of relying on a transient error');

    const emittedStates = humanSocket.emitted.filter(item => item.event === 'gameState');
    assert.ok(emittedStates.length > 0);
    const finalClientState = emittedStates.at(-1).payload;
    assert.equal(finalClientState.qpPhase, 'filling');
    assert.notEqual(finalClientState.qpPhase, 'starting_3');
    assert.notEqual(finalClientState.qpPhase, 'starting_4');
    assert.deepEqual(finalClientState.qpMatchmakingNotice, EAGLEWOOD_POOL_THIN_NOTICE);
}

async function testQuickPlayFillShortageRecommendsLowerStakesAndKeepsSearching() {
    const harness = createFundedQuickPlayHarness({
        botAccounts: [
            { id: 9011, username: 'Almost Eaglewood', tokens: 100, isBot: true },
        ],
        balances: { 9011: 19.99 },
    });
    const { service } = harness;
    const engine = service.findQuickPlayTable('dans-deck');
    seatHuman(engine, 901, 'Waiting High Roller');
    service.evaluateQuickPlayTable(engine.tableId, { restartFill: true });
    const expiredFill = service.qpTimers[engine.tableId].fill;
    const starts = installPendingStartSpy(service);

    await expiredFill.handle.callback();

    assert.equal(engine.playerOrder.count, 1);
    assert.deepEqual(engine.playerOrder.allIds, [901]);
    assert.equal(engine.qpPhase, 'filling');
    assert.deepEqual(engine.qpMatchmakingNotice, EAGLEWOOD_POOL_THIN_NOTICE);
    assert.deepEqual(
        engine.getStateForClient({ userId: 901 }).qpMatchmakingNotice,
        EAGLEWOOD_POOL_THIN_NOTICE,
        'the lower-stakes recommendation is part of authoritative table state',
    );
    assert.equal(starts.length, 0, 'an unfunded bot shortage never starts a game');
    assert.ok(service.qpTimers[engine.tableId].fill,
        'matchmaking continues in case an affordable bot or human becomes available');
    assert.notEqual(service.qpTimers[engine.tableId].fill, expiredFill,
        'the expired fill attempt cannot be reused as the next search timer');
}

async function testQuickPlayFourthShortageReturnsToDecisionWithoutStarting() {
    const harness = createFundedQuickPlayHarness({
        botAccounts: [
            { id: 9021, username: 'Priced Out Fourth', tokens: 100, isBot: true },
        ],
        balances: { 9021: 19.99 },
    });
    const { service } = harness;
    const engine = seedDecisionTable(service, 'dans-deck', [902, 903, 904]);
    const starts = installPendingStartSpy(service);
    const decision = service.quickPlayDecision(engine.tableId, 902, 'seek4', engine.qpGeneration);
    assert.equal(decision.accepted, true);
    const searchTimer = service.qpTimers[engine.tableId].window.handle;
    harness.setNow(engine.qpWindowEndsAt);

    await searchTimer.callback();

    assert.deepEqual(engine.playerOrder.allIds, [902, 903, 904]);
    assert.equal(engine.qpPhase, 'decision_pending');
    assert.equal(engine.qpWindowEndsAt, null);
    assert.equal(engine.qpFallbackBot, null);
    assert.deepEqual(engine.qpMatchmakingNotice, EAGLEWOOD_POOL_THIN_NOTICE);
    assert.equal(starts.length, 0, 'a fourth-seat shortage does not launch a three- or four-player game');
}

async function testStaleAffordableBotLookupCannotBeatAHumanArrival() {
    let resolveBalanceLookup;
    const harness = createFundedQuickPlayHarness({
        botAccounts: [
            { id: 9031, username: 'Deferred Bot', tokens: 0, isBot: true },
        ],
        balances: { 9031: 60 },
        queryOverride(sql, params, rowsForCurrentBalances) {
            return new Promise(resolve => {
                resolveBalanceLookup = () => resolve({
                    rows: rowsForCurrentBalances(),
                    rowCount: 1,
                });
            });
        },
    });
    const { service } = harness;
    const engine = service.findQuickPlayTable('dans-deck');
    seatHuman(engine, 905, 'First Human');
    service.evaluateQuickPlayTable(engine.tableId, { restartFill: true });
    const staleFill = service.qpTimers[engine.tableId].fill;

    const pendingFill = staleFill.handle.callback();
    await Promise.resolve();
    assert.equal(typeof resolveBalanceLookup, 'function', 'the fresh bot balance lookup is in flight');

    const claimed = service.claimQuickPlaySeat(
        engine.theme,
        { id: 906, username: 'Second Human' },
        'socket-906',
        '100.00',
    );
    assert.equal(claimed, engine);
    const humanGeneration = engine.qpGeneration;
    resolveBalanceLookup();
    await pendingFill;
    await flushAsyncStart();

    assert.deepEqual(engine.playerOrder.allIds, [905, 906],
        'the stale continuation cannot add a bot after a human restarts the fill generation');
    assert.equal(engine.players[9031], undefined);
    assert.equal(engine.qpGeneration, humanGeneration);
    assert.equal(engine.qpMatchmakingNotice, null,
        'a stale lookup cannot publish a notice into the human-updated generation');
    const currentFill = service.qpTimers[engine.tableId].fill;
    assert.ok(currentFill);
    assert.notEqual(currentFill, staleFill);
    assert.equal(currentFill.generation, humanGeneration);
    assert.equal(currentFill.expectedSeats, 2);
}

async function testSeekingFourthMultiTabHandoffAndFinalDisconnectCancellation() {
    const harnessData = createService();
    const { service, io } = harnessData;
    const engine = seedDecisionTable(service, 'fort-creek', [806, 807]);
    service.quickPlayDecision(engine.tableId, 806, 'seek4', engine.qpGeneration);
    const searchGeneration = engine.qpGeneration;
    const deadline = engine.qpWindowEndsAt;
    const staleWindow = service.qpTimers[engine.tableId].window.handle;
    const socketHarness = createSocketHarness(service, io);
    const account = { id: 806, username: 'Seeking Two Tabs', is_admin: false };
    const older = socketHarness.connect(account, 'seeking-older');
    const latest = socketHarness.connect(account, 'seeking-latest');
    assert.equal(engine.players[806].socketId, 'seeking-latest');

    await older.disconnect();
    assert.equal(engine.players[806].socketId, 'seeking-latest');
    assert.equal(engine.qpPhase, 'seeking_fourth');
    assert.equal(engine.qpGeneration, searchGeneration);
    assert.equal(engine.qpWindowEndsAt, deadline);
    assert.equal(service.qpTimers[engine.tableId].window.handle, staleWindow,
        'disconnecting a superseded tab leaves the active search intact');

    await latest.disconnect();
    assert.equal(engine.players[806], undefined);
    assert.equal(engine.qpPhase, 'filling');
    assert.notEqual(engine.qpGeneration, searchGeneration);
    harnessData.setNow(deadline);
    await staleWindow.callback();
    assert.equal(engine.playerOrder.count, 2);
    assert.equal(engine.qpFallbackBot, null,
        'the cancelled search callback cannot create a fourth bot after the final tab leaves');
}

async function testTerminalSocketReconnectCancelsAndDisconnectRearmsCleanup() {
    const io = createIo();
    const pool = { query: async () => ({ rows: [{ tokens: '100.00' }] }) };
    const service = createGameServiceWithoutHeartbeat(GameService, io, pool);
    const engine = service.findQuickPlayTable('fort-creek');
    seatHuman(engine, 805, 'Terminal Returner');
    engine.gameStarted = true;
    engine.gameId = 5805;
    engine.state = 'Game Over';
    engine.settlement = { status: 'complete', kind: 'normal', attempts: 1, lastErrorCode: null };

    const scheduled = [];
    service.terminalCleanupTimerOverride = (callback, duration) => {
        const timer = { callback, duration, unref() {} };
        scheduled.push(timer);
        return timer;
    };
    service.evaluateTerminalCleanup(engine.tableId);
    assert.equal(scheduled.length, 1);

    const harness = createSocketHarness(service, io);
    const older = harness.connect(
        { id: 805, username: 'Terminal Returner', is_admin: false },
        'terminal-older',
    );
    assert.equal(engine.players[805].socketId, 'terminal-older');
    assert.equal(engine.players[805].disconnected, false);
    assert.equal(service.terminalCleanupTimers[engine.tableId], undefined,
        'reconnect cancels terminal reclamation while the human views results');

    const latest = harness.connect(
        { id: 805, username: 'Terminal Returner', is_admin: false },
        'terminal-latest',
    );
    assert.equal(engine.players[805].socketId, 'terminal-latest');
    await latest.disconnect();
    assert.equal(engine.players[805].socketId, 'terminal-older',
        'the newest remaining live socket adopts the terminal seat');
    assert.equal(engine.players[805].disconnected, false);
    assert.equal(service.terminalCleanupTimers[engine.tableId], undefined,
        'promoting a live fallback must not arm abandoned cleanup');

    await older.disconnect();
    assert.equal(engine.players[805].disconnected, true);
    assert.equal(engine.players[805].socketId, null);
    assert.equal(scheduled.length, 2, 'disconnect after reconnect arms a fresh cleanup grace');
    assert.equal(scheduled[1].duration, TERMINAL_QUICKPLAY_DISCONNECTED_CLEANUP_DELAY_MS);
    assert.equal(service.terminalCleanupTimers[engine.tableId]?.handle, scheduled[1]);
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
    testFourthFallbackDelayIsInclusiveAndInjectable();
    await testQuickPlaySeatsOnlyBotsWithFreshAffordableBalances();
    await testQuickPlayStartPreflightRemovesBotWhoseBalanceDropped();
    await testFallbackMarkerClearsWhenAffordableFourthSlidesIntoThreeSeatRoster();
    await testAtomicBotFundingRacePublishesRecoveredAuthoritativeState();
    await testQuickPlayFillShortageRecommendsLowerStakesAndKeepsSearching();
    await testQuickPlayFourthShortageReturnsToDecisionWithoutStarting();
    await testStaleAffordableBotLookupCannotBeatAHumanArrival();
    await testFillStopsForDecisionAndSerializesContract();
    testFirstValidDecisionWinsSynchronously();
    await testSearchTimeoutSeatsFallbackAndGuardsDeadline();
    await testEarlyWakeKeepsTheOriginalRandomDeadline();
    await testHumanBeforeDeadlineWinsAndStaleTimerCannotReplaceThem();
    await testTimerAtDeadlineWinsAndLateHumanIsRematched();
    testSearchDeadlineIsEnforcedBeforeDelayedTimerRuns();
    await testFallbackCreationFailureReturnsToFreshDecision();
    await testDisconnectBeforeDeadlineCancelsFallback();
    await testTimerBeforeDisconnectFreezesOneFallbackRoster();
    testFourthHumanStartsExactRosterAndBotsCannotTakeSeatFour();
    await testFallbackAuthorizationTransactionAndRollbackRecovery();
    await testThreeHumanFallbackChargesExactHumanRoster();
    await testRejectedFallbackLaunchRecoversWithoutRetry();
    await testNoopFallbackLaunchAlsoRecoversWithoutRetry();
    await testTerminalResetRemovesOnlyMarkedFallbackBot();
    testConcurrentFourthsRematchWithoutSpectatorFallback();
    await testStaleFillTimerAndLeaveRefillCycle();
    await testHardResetGenerationRejectsOldTableTimers();
    await testHardResetRejectsStaleFourthFallbackTimer();
    await testDecisionGuardsGenericStartAndRecoversFromStartFailure();
    await testFourPlayerStartFailureReturnsToExplicitDecision();
    await testTerminalResetReentersAConsistentQuickPlayPhase();
    await testAbandonedTerminalQuickPlayRecyclesAfterReconnectGrace();
    await testDeferredBalanceCannotSeatDisconnectedSocket();
    await testReplacementSocketRevokesDeferredJoinBeforeAnySeatExists();
    await testReplacementControllerKeepsAdoptedSeatDuringDeferredJoin();
    await testOlderLiveSocketRecoversWhenLatestDisconnects();
    await testSeekingFourthMultiTabHandoffAndFinalDisconnectCancellation();
    await testTerminalSocketReconnectCancelsAndDisconnectRearmsCleanup();
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
