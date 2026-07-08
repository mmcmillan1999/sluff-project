// Quick Play matchmaker smoke test.
// Run with: node tests/quickPlay.test.js
const assert = require('assert');
const GameService = require('../src/services/GameService');

const mockIo = { to: () => ({ emit: () => {} }), emit: () => {}, sockets: { sockets: new Map() } };
const mockPool = { query: () => Promise.resolve({ rows: [], rowCount: 0 }) };

(async () => {
    const timers = [];
    const gameService = new GameService(mockIo, mockPool);
    gameService.timerOverride = (cb, duration) => { timers.push({ cb, duration }); };
    const fireNext = async () => { const t = timers.shift(); await t.cb(); return t; };

    // Spy on startGame so the test exercises matchmaker orchestration without
    // the DB transaction plumbing (startGame itself is covered elsewhere).
    const startCalls = [];
    gameService.startGame = async (tableId, userId) => {
        startCalls.push({ tableId, userId });
        const eng = gameService.getEngineById(tableId);
        eng.gameStarted = true;
        eng.state = 'Dealing Pending';
    };

    const seatHuman = (engine, id, name) => {
        engine.joinTable({ id, username: name }, `s${id}`, '100.00');
    };

    // --- Scenario A: solo player -> two bots fill -> 20s window -> 3P start
    let table = gameService.findQuickPlayTable('fort-creek');
    assert.ok(table, 'quick-play table found for fort-creek');
    assert.strictEqual(table.tableType, 'quickplay');
    seatHuman(table, 201, 'Solo');
    gameService.evaluateQuickPlayTable(table.tableId, { restartFill: true });

    assert.strictEqual(timers.length, 1, 'one fill timer scheduled');
    assert.ok(timers[0].duration >= 5000 && timers[0].duration < 10000, `fill delay 5-10s (got ${timers[0].duration})`);
    await fireNext(); // bot #1
    assert.strictEqual(table.playerOrder.count, 2, 'bot filled seat 2');
    assert.strictEqual(timers.length, 1, 'second fill timer scheduled');
    await fireNext(); // bot #2
    assert.strictEqual(table.playerOrder.count, 3, 'bot filled seat 3');
    assert.strictEqual(timers.length, 1, 'window timer scheduled');
    assert.strictEqual(timers[0].duration, 20000, '4th-player window is 20s');
    assert.ok(table.qpWindowEndsAt > Date.now(), 'window deadline exposed to clients');
    await fireNext(); // window expires
    assert.strictEqual(startCalls.length, 1, 'game auto-started after window');
    assert.strictEqual(startCalls[0].userId, 201, 'started on behalf of the human');
    assert.strictEqual(table.qpWindowEndsAt, null, 'window deadline cleared');

    // --- Scenario B: second human joins the same filling table; a 4th human
    // during the window starts 4P immediately.
    const t2 = gameService.findQuickPlayTable('shirecliff-road');
    seatHuman(t2, 301, 'Ann');
    gameService.evaluateQuickPlayTable(t2.tableId, { restartFill: true });
    assert.strictEqual(timers.length, 1, 'fill timer for Ann');

    // Human #2 arrives before the timer fires -> routed to the SAME table, fill restarts
    const t2again = gameService.findQuickPlayTable('shirecliff-road');
    assert.strictEqual(t2again.tableId, t2.tableId, 'second human routed to the filling table');
    seatHuman(t2, 302, 'Ben');
    gameService.evaluateQuickPlayTable(t2.tableId, { restartFill: true });
    assert.strictEqual(timers.length, 2, 'old fill timer replaced by a fresh one');
    timers.shift(); // discard the stale (cleared) timer; only the fresh one is armed
    await fireNext(); // bot fills seat 3
    assert.strictEqual(t2.playerOrder.count, 3);
    assert.strictEqual(timers.length, 1, 'window open');
    // 4th human arrives during the window
    seatHuman(t2, 303, 'Cam');
    gameService.evaluateQuickPlayTable(t2.tableId, { restartFill: true });
    assert.strictEqual(startCalls.length, 2, '4 seated -> immediate start');
    assert.strictEqual(t2.playerOrder.count, 4, 'started as a 4-player game');
    const staleWindow = timers.shift(); // window timer was cleared; firing it must no-op
    await staleWindow.cb();
    assert.strictEqual(startCalls.length, 2, 'stale window timer no-ops after start');

    // --- Scenario C: everyone leaves mid-fill -> bots swept, table recycled
    const t3 = gameService.findQuickPlayTable('dans-deck');
    seatHuman(t3, 401, 'Dan');
    gameService.evaluateQuickPlayTable(t3.tableId, { restartFill: true });
    await fireNext(); // bot joins
    assert.strictEqual(t3.playerOrder.count, 2);
    t3.leaveTable(401);
    gameService.evaluateQuickPlayTable(t3.tableId);
    assert.strictEqual(t3.playerOrder.count, 0, 'bots swept after last human left');
    assert.strictEqual(t3.state, 'Waiting for Players', 'table back in the pool');
    while (timers.length) await fireNext(); // any stale fill timers must no-op
    assert.strictEqual(t3.playerOrder.count, 0, 'stale timers added no bots');

    // --- Scenario D: human presses Start during the window
    const t4 = gameService.findQuickPlayTable('miss-pauls-academy');
    seatHuman(t4, 501, 'Eve');
    gameService.evaluateQuickPlayTable(t4.tableId, { restartFill: true });
    await fireNext(); await fireNext(); // two bots
    assert.strictEqual(t4.playerOrder.count, 3);
    assert.ok(t4.qpWindowEndsAt, 'window open');
    // Human starts (as the startGame socket handler would)
    await gameService.startGame(t4.tableId, 501);
    gameService.evaluateQuickPlayTable(t4.tableId); // startGame wrapper hook
    assert.strictEqual(t4.qpWindowEndsAt, null, 'manual start clears the window');
    while (timers.length) await fireNext();
    assert.strictEqual(startCalls.filter(c => c.tableId === t4.tableId).length, 1, 'no double start');

    // --- Lobby never exposes quick-play tables
    const lobby = gameService.getLobbyState();
    const allListedIds = lobby.themes.flatMap(t => t.tables.map(x => x.tableId));
    assert.ok(allListedIds.every(id => !id.startsWith('qp-')), 'quick-play tables hidden from lobby');
    assert.strictEqual(allListedIds.length, 40, 'all 40 private tables listed');

    console.log('QUICK PLAY MATCHMAKER TEST PASSED');
    process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
