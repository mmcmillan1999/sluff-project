'use strict';

const assert = require('node:assert/strict');
const GameService = require('../src/services/GameService');
const { createGameServiceWithoutHeartbeat } = require('./test-helpers');

// A human who dropped out of a table where only bots remained used to freeze
// it forever: the AFK backstop skips disconnected seats, the forfeit clock
// needed a connected human to start it, and bots never did. The house now
// starts the same two-minute clock a fellow human would — and, just as
// importantly, stays out of every situation that already has an owner.

const mockIo = { to: () => ({ emit: () => {} }), emit: () => {}, sockets: { sockets: new Map() } };
const mockPool = {
    query() { return Promise.resolve({ rows: [], rowCount: 0 }); },
    async connect() { return { query: () => Promise.resolve({ rows: [], rowCount: 0 }), release() {} }; },
};

const TABLE_ID = 'table-1';
const TEN_MINUTES_MS = 10 * 60 * 1000;

// _enforceLoneHumanForfeit fires _performAction without awaiting it; the
// engine flags flip synchronously, the countdown effect lands a tick later.
const settle = () => new Promise(resolve => setImmediate(resolve));

function seatTable({ humans = ['Alice'], bots = 2, state = 'Playing Phase', started = true } = {}) {
    const service = createGameServiceWithoutHeartbeat(GameService, mockIo, mockPool);
    const engine = service.getEngineById(TABLE_ID);
    humans.forEach((username, index) => engine.joinTable({ id: index + 1, username }, `sock-${index + 1}`));
    for (let i = 0; i < bots; i += 1) engine.addBotPlayer();
    engine.gameStarted = started;
    engine.gameId = 700;
    engine.state = state;

    // Count clock starts at the service boundary so the negative cases prove
    // the house never even asked, not merely that the engine refused.
    let clockStarts = 0;
    const performAction = service._performAction.bind(service);
    service._performAction = (tableId, actionFn) => {
        clockStarts += 1;
        return performAction(tableId, actionFn);
    };
    return { service, engine, clockStarts: () => clockStarts };
}

async function enforce(service) {
    service._enforceLoneHumanForfeit(TABLE_ID);
    await settle();
}

function assertNoClock(engine, clockStarts, why) {
    assert.equal(clockStarts(), 0, `${why}: the house did not ask for a clock`);
    assert.equal(engine.forfeiture.targetPlayerName, null, `${why}: nobody is on the clock`);
    assert.equal(engine.internalTimers.forfeit, undefined, `${why}: no countdown is running`);
}

async function testTheHouseStartsTheClockForALoneDisconnectedHuman() {
    const { service, engine, clockStarts } = seatTable();
    engine.disconnectPlayer(1);
    assert.equal(engine.players[1].disconnected, true);
    assert.equal(engine.players[1].socketId, null);

    try {
        await enforce(service);
        assert.equal(clockStarts(), 1, 'the house asked for the clock once');
        assert.equal(engine.forfeiture.targetPlayerName, 'Alice', 'the missing human is on the clock');
        assert.equal(engine.forfeiture.timeLeft, 120, 'the same two minutes a fellow human would start');
        assert.ok(engine.internalTimers.forfeit, 'the countdown is actually running');

        // The 1.5s heartbeat re-enters constantly; a running clock must not
        // be restarted or its countdown reset.
        await enforce(service);
        assert.equal(clockStarts(), 1, 'a running clock is left alone');
        assert.equal(engine.forfeiture.timeLeft, 120);
    } finally {
        engine._clearForfeitTimer();
    }
    console.log('  the house starts the two-minute clock for a lone disconnected human');
}

async function testASeatFlaggedDisconnectedDirectlyCountsToo() {
    // The resume path and the socket layer mark seats without going through
    // disconnectPlayer(); the sweep reads the flags, not the history.
    const { service, engine, clockStarts } = seatTable();
    engine.players[1].disconnected = true;
    engine.players[1].socketId = null;
    try {
        await enforce(service);
        assert.equal(clockStarts(), 1);
        assert.equal(engine.forfeiture.targetPlayerName, 'Alice');
    } finally {
        engine._clearForfeitTimer();
    }
    console.log('  a seat flagged disconnected directly is treated the same way');
}

async function testAConnectedHumanKeepsTheDecision() {
    const { service, engine, clockStarts } = seatTable({ humans: ['Alice', 'Bob'], bots: 1 });
    engine.disconnectPlayer(1);
    await enforce(service);
    assertNoClock(engine, clockStarts, 'Bob is still here to decide');
    console.log('  a connected human keeps the decision to start the clock');
}

async function testARunningOrPendingClockIsNotRestarted() {
    const { service, engine, clockStarts } = seatTable();
    engine.disconnectPlayer(1);

    engine.internalTimers.forfeit = { stub: true };
    await enforce(service);
    assert.equal(clockStarts(), 0, 'a countdown already running means someone else started it');
    delete engine.internalTimers.forfeit;

    engine.forfeiture.targetPlayerName = 'Alice';
    engine.forfeiture.timeLeft = 37;
    await enforce(service);
    assert.equal(clockStarts(), 0, 'a named target means the clock is already ticking down');
    assert.equal(engine.forfeiture.timeLeft, 37, 'the countdown was not reset');
    console.log('  a running or pending clock is never restarted');
}

async function testTerminalStatesAreLeftAlone() {
    for (const state of ['Game Over', 'DrawComplete', 'Draw Resolving']) {
        const { service, engine, clockStarts } = seatTable({ state });
        engine.disconnectPlayer(1);
        await enforce(service);
        assertNoClock(engine, clockStarts, `${state} has nothing left to forfeit`);
    }
    console.log('  Game Over, DrawComplete, and Draw Resolving are left alone');
}

async function testARestoredTableGetsTenMinutesToReconnect() {
    // Right after a deploy every human is "disconnected" until their app
    // reconnects; the restore marks the seat resumePending and stamps the
    // turn. Ten minutes, not two.
    const { service, engine, clockStarts } = seatTable();
    engine.disconnectPlayer(1);
    engine.players[1].resumePending = true;
    engine.turnStartedAt = Date.now() - TEN_MINUTES_MS + 5_000;
    await enforce(service);
    assertNoClock(engine, clockStarts, 'a freshly restored table');

    engine.turnStartedAt = Date.now() - TEN_MINUTES_MS - 1_000;
    try {
        await enforce(service);
        assert.equal(clockStarts(), 1, 'the grace ends after ten minutes');
        assert.equal(engine.forfeiture.targetPlayerName, 'Alice');
    } finally {
        engine._clearForfeitTimer();
    }
    console.log('  a restored table gets ten minutes before the clock');
}

async function testTablesWithNoBotOrNoMissingHumanAreIgnored() {
    const botsOnly = seatTable({ humans: [], bots: 3 });
    await enforce(botsOnly.service);
    assertNoClock(botsOnly.engine, botsOnly.clockStarts, 'a bot-only exhibition');

    const everyoneHere = seatTable();
    await enforce(everyoneHere.service);
    assertNoClock(everyoneHere.engine, everyoneHere.clockStarts, 'a human who is connected');

    // Humans-only tables have no bot to speak for the house; the recovery
    // monitor owns those.
    const humansOnly = seatTable({ humans: ['Alice', 'Bob', 'Cara'], bots: 0 });
    [1, 2, 3].forEach(id => humansOnly.engine.disconnectPlayer(id));
    await enforce(humansOnly.service);
    assertNoClock(humansOnly.engine, humansOnly.clockStarts, 'a humans-only table with everyone gone');

    // Before the deal there is nothing to forfeit (disconnectPlayer would
    // vacate the seat; the flag is set directly to mimic a half-torn-down one).
    const notStarted = seatTable({ started: false, state: 'Ready to Start' });
    notStarted.engine.players[1].disconnected = true;
    notStarted.engine.players[1].socketId = null;
    await enforce(notStarted.service);
    assertNoClock(notStarted.engine, notStarted.clockStarts, 'a game that has not started');
    console.log('  bot-only, humans-only, fully present, and unstarted tables are ignored');
}

async function testTheFirstMissingSeatIsTargetedNeverASpectator() {
    const { service, engine, clockStarts } = seatTable({ humans: ['Alice', 'Bob'], bots: 1 });
    // A late arrival after the deal is a spectator; their connection state
    // must neither hold the clock nor be the one put on it.
    engine.joinTable({ id: 9, username: 'Watcher' }, 'sock-9');
    assert.equal(engine.players[9].isSpectator, true);
    engine.players[9].disconnected = true;
    engine.players[9].socketId = null;
    engine.disconnectPlayer(1);
    engine.disconnectPlayer(2);

    try {
        await enforce(service);
        assert.equal(clockStarts(), 1, 'one clock, not one per missing seat');
        assert.equal(engine.forfeiture.targetPlayerName, 'Alice', 'the first missing seat goes on the clock');
    } finally {
        engine._clearForfeitTimer();
    }
    console.log('  the first missing seat is targeted; spectators never are');
}

async function run() {
    await testTheHouseStartsTheClockForALoneDisconnectedHuman();
    await testASeatFlaggedDisconnectedDirectlyCountsToo();
    await testAConnectedHumanKeepsTheDecision();
    await testARunningOrPendingClockIsNotRestarted();
    await testTerminalStatesAreLeftAlone();
    await testARestoredTableGetsTenMinutesToReconnect();
    await testTablesWithNoBotOrNoMissingHumanAreIgnored();
    await testTheFirstMissingSeatIsTargetedNeverASpectator();
    console.log('Lone-human forfeit tests passed.');
}

if (require.main === module) {
    run().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = run;
