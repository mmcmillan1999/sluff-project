'use strict';

const assert = require('node:assert/strict');
const GameService = require('../src/services/GameService');
const { createGameServiceWithoutHeartbeat } = require('./test-helpers');

// A settlement that missed its half-second in-line retry budget used to wedge
// the table for good: reset, rematch, and terminal cleanup all refuse while
// status is 'failed', the hard reset refused while any engine was started,
// and the game_history row stayed "In Progress" under a heartbeat so it was
// never refunded either. The heartbeat now replays the recorded snapshot with
// backoff; settleGameTransaction is idempotent against the persisted outcome,
// so a replay can never double-pay.

const mockIo = { to: () => ({ emit: () => {} }), emit: () => {}, sockets: { sockets: new Map() } };
const mockPool = {
    query() { return Promise.resolve({ rows: [], rowCount: 0 }); },
    async connect() { return { query: () => Promise.resolve({ rows: [], rowCount: 0 }), release() {} }; },
};

const TABLE_ID = 'table-1';
const SECOND = 1000;
const REVIEW_MESSAGE = 'Game settlement needs administrator review. No partial payout was committed.';

// A Postgres deadlock: transient, so the in-line loop spends its full budget.
const deadlock = () => Object.assign(new Error('boom'), { code: '40P01' });

function wedgedTable({ kind = 'normal', state = 'Game Over' } = {}) {
    const service = createGameServiceWithoutHeartbeat(GameService, mockIo, mockPool);
    // The in-line loop sleeps 100ms/400ms between attempts by default.
    service.settlementRetryDelayOverride = async () => {};
    // A committed settlement on an empty terminal table arms a real cleanup
    // timer; the runner must not sit on it.
    service.terminalCleanupTimerOverride = () => ({ testTimer: true });

    const engine = service.getEngineById(TABLE_ID);
    engine.joinTable({ id: 1, username: 'Alice' }, 'sock-1', '10.00');
    engine.addBotPlayer();
    engine.addBotPlayer();
    engine.gameStarted = true;
    engine.gameId = 900;
    engine.state = state;
    engine.settlement = { status: 'failed', kind, attempts: 3, lastErrorCode: '40P01' };
    engine.roundSummary = { isGameOver: true, message: REVIEW_MESSAGE };
    return { service, engine };
}

function assertDueIn(record, before, after, delayMs, label) {
    assert.ok(
        record.dueAt >= before + delayMs && record.dueAt <= after + delayMs,
        `${label}: due in ${delayMs / SECOND}s (recorded ${(record.dueAt - before) / SECOND}s)`,
    );
}

function testBackoffDoublesFromThirtySecondsAndCapsAtFiveMinutes() {
    const { service } = wedgedTable();
    const payload = Object.freeze({ gameId: 900 });
    const onComplete = () => {};
    const expectedDelays = [30, 60, 120, 240, 300, 300].map(seconds => seconds * SECOND);

    expectedDelays.forEach((delayMs, index) => {
        const before = Date.now();
        service._scheduleSettlementRetry(TABLE_ID, 'normal', payload, onComplete);
        const after = Date.now();
        const record = service.settlementRetries[TABLE_ID];
        assert.equal(record.attempt, index + 1, `attempt ${index + 1} is recorded`);
        assertDueIn(record, before, after, delayMs, `attempt ${index + 1}`);
        assert.equal(record.kind, 'normal');
        assert.equal(record.payload, payload, 'the frozen snapshot is replayed as-is');
        assert.equal(record.onComplete, onComplete);
        assert.equal(record.inFlight, false);
    });
    console.log('  retry backoff: 30s, 60s, 120s, 240s, then capped at five minutes');
}

function testTheHeartbeatWaitsForTheDueTime() {
    const { service } = wedgedTable();
    let replays = 0;
    service.retrySettlement = async () => { replays += 1; };

    service._retryDueSettlement(TABLE_ID);
    assert.equal(replays, 0, 'no record, nothing to do');

    service._scheduleSettlementRetry(TABLE_ID, 'normal', { gameId: 900 }, null);
    service._retryDueSettlement(TABLE_ID);
    assert.equal(replays, 0, 'not before the due time');

    service.settlementRetries[TABLE_ID].dueAt = Date.now() - 1;
    service._retryDueSettlement(TABLE_ID);
    assert.equal(replays, 1, 'fires once due');

    service.settlementRetries[TABLE_ID].inFlight = true;
    service._retryDueSettlement(TABLE_ID);
    assert.equal(replays, 1, 'never overlaps a replay already in flight');
    console.log('  the heartbeat replays only once the backoff has elapsed');
}

async function testNothingToRetryAlreadySettledAndInFlightAreRefused() {
    const { service, engine } = wedgedTable();
    assert.deepEqual(await service.retrySettlement(TABLE_ID), { ok: false, reason: 'nothing_to_retry' });
    assert.deepEqual(await service.retrySettlement('no-such-table'), { ok: false, reason: 'nothing_to_retry' });

    let handled = 0;
    service.handleGameOver = async () => { handled += 1; return {}; };

    service._scheduleSettlementRetry(TABLE_ID, 'normal', { gameId: 900 }, null);
    engine.settlement.status = 'complete';
    assert.deepEqual(await service.retrySettlement(TABLE_ID), { ok: false, reason: 'not_failed' });
    assert.equal(service.settlementRetries[TABLE_ID], undefined, 'a stale record is dropped');
    assert.equal(handled, 0, 'a settled game is never replayed');

    service._scheduleSettlementRetry(TABLE_ID, 'normal', { gameId: 900 }, null);
    engine.settlement.status = 'failed';
    service.settlementRetries[TABLE_ID].inFlight = true;
    assert.deepEqual(await service.retrySettlement(TABLE_ID), { ok: false, reason: 'in_flight' });
    assert.equal(handled, 0, 'an admin click cannot double up on a replay in progress');
    console.log('  nothing-to-retry, already-settled, and in-flight are all refused');
}

async function testAWedgedTableRecoversOnceTheDatabaseCooperates() {
    const { service, engine } = wedgedTable();
    const payload = Object.freeze({ gameId: 900, scores: { Alice: 100 } });
    const completions = [];
    const replays = [];
    service.handleGameOver = async snapshot => { replays.push(snapshot); throw deadlock(); };
    service._scheduleSettlementRetry(TABLE_ID, 'normal', payload, result => completions.push(result));

    assert.equal(service.hasActiveOrPendingGame(), false, 'a wedged table does not count as an active game');

    // Still deadlocking: the full in-line budget is spent again, then the
    // table goes back on the heartbeat with a longer wait.
    const before = Date.now();
    assert.deepEqual(await service.retrySettlement(TABLE_ID), { ok: false, attempt: 1 });
    const after = Date.now();
    assert.equal(replays.length, 3, 'the in-line transient budget is spent on each replay');
    assert.ok(replays.every(snapshot => snapshot === payload), 'the recorded snapshot is what gets replayed');
    assert.equal(engine.settlement.status, 'failed');
    assert.equal(engine.settlement.attempts, 3);
    assert.equal(engine.settlement.lastErrorCode, '40P01');
    assert.equal(engine.roundSummary.message, REVIEW_MESSAGE, 'players still see the review notice');
    assert.equal(engine.roundSummary.gameWinner, undefined, 'no winner is published before a commit');
    const rescheduled = service.settlementRetries[TABLE_ID];
    assert.equal(rescheduled.attempt, 2);
    assert.equal(rescheduled.inFlight, false);
    assertDueIn(rescheduled, before, after, 60 * SECOND, 'second attempt');
    assert.equal(completions.length, 0, 'onComplete is withheld until the commit lands');
    assert.equal(service.hasActiveOrPendingGame(), false, 'still not active while it stays wedged');

    // The database comes back.
    const committed = { gameWinnerName: 'Alice', payoutDetails: {}, tokenSettlement: {} };
    service.handleGameOver = async snapshot => { replays.push(snapshot); return committed; };
    assert.deepEqual(await service.retrySettlement(TABLE_ID), { ok: true, attempt: 2 });
    assert.equal(replays.length, 4, 'one more replay was enough');
    assert.equal(replays[3], payload);
    assert.equal(service.settlementRetries[TABLE_ID], undefined, 'the record is cleared on success');
    assert.equal(engine.settlement.status, 'complete');
    assert.equal(engine.settlement.lastErrorCode, null);
    assert.equal(engine.roundSummary.gameWinner, 'Alice');
    assert.deepEqual(engine.roundSummary.payoutDetails, {});
    assert.deepEqual(engine.roundSummary.tokenSettlement, {});
    assert.equal('message' in engine.roundSummary, false, 'the review notice is withdrawn');
    assert.deepEqual(completions, [committed], 'onComplete fires exactly once, with the committed result');

    // Nothing left to replay; the heartbeat goes quiet.
    assert.deepEqual(await service.retrySettlement(TABLE_ID), { ok: false, reason: 'nothing_to_retry' });
    assert.equal(engine.settlement.status, 'complete');
    console.log('  a wedged table recovers once the database cooperates');
}

async function testDrawAndForfeitReplaysRouteToTheirOwnHandlers() {
    const draw = wedgedTable({ kind: 'draw', state: 'DrawComplete' });
    draw.service.handleGameOver = async () => { throw new Error('wrong handler'); };
    draw.service.handleForfeit = async () => { throw new Error('wrong handler'); };
    const drawResult = { drawOutcome: 'Split', payouts: {} };
    draw.service.handleDrawOutcome = async () => drawResult;
    const drawCompletions = [];
    draw.service._scheduleSettlementRetry(TABLE_ID, 'draw', { gameId: 900 }, result => drawCompletions.push(result));
    assert.deepEqual(await draw.service.retrySettlement(TABLE_ID), { ok: true, attempt: 1 });
    assert.equal(draw.engine.settlement.status, 'complete');
    assert.deepEqual(drawCompletions, [drawResult], 'a draw hands its result to onComplete');
    assert.equal(draw.engine.roundSummary.gameWinner, undefined, 'a draw has no winner to publish');
    assert.equal(draw.service.settlementRetries[TABLE_ID], undefined);

    const forfeit = wedgedTable({ kind: 'forfeit' });
    forfeit.service.handleGameOver = async () => { throw new Error('wrong handler'); };
    forfeit.service.handleDrawOutcome = async () => { throw new Error('wrong handler'); };
    forfeit.service.handleForfeit = async () => ({
        gameWinnerName: 'Bob', payoutDetails: { 1: 'returned' }, tokenSettlement: { entries: [] },
    });
    forfeit.service._scheduleSettlementRetry(TABLE_ID, 'forfeit', { gameId: 900 }, null);
    assert.deepEqual(await forfeit.service.retrySettlement(TABLE_ID), { ok: true, attempt: 1 });
    assert.equal(forfeit.engine.settlement.status, 'complete');
    assert.equal(forfeit.engine.roundSummary.gameWinner, 'Bob');
    assert.deepEqual(forfeit.engine.roundSummary.payoutDetails, { 1: 'returned' });
    assert.equal('message' in forfeit.engine.roundSummary, false);
    assert.equal(forfeit.service.settlementRetries[TABLE_ID], undefined);
    console.log('  draw and forfeit replays go through their own settlement handlers');
}

function testTheHardResetGuardIgnoresWedgedTablesButProtectsLiveOnes() {
    const { service, engine } = wedgedTable();
    assert.equal(service.hasActiveOrPendingGame(), false, 'Game Over with a failed settlement is not active');

    engine.state = 'DrawComplete';
    assert.equal(service.hasActiveOrPendingGame(), false, 'DrawComplete with a failed settlement is not active');

    const live = service.getEngineById('table-2');
    live.gameStarted = true;
    live.state = 'Playing Phase';
    assert.equal(service.hasActiveOrPendingGame(), true, 'a game in Playing Phase is active');
    console.log('  the hard-reset guard ignores wedged tables but still protects live games');
}

async function run() {
    testBackoffDoublesFromThirtySecondsAndCapsAtFiveMinutes();
    testTheHeartbeatWaitsForTheDueTime();
    await testNothingToRetryAlreadySettledAndInFlightAreRefused();
    await testAWedgedTableRecoversOnceTheDatabaseCooperates();
    await testDrawAndForfeitReplaysRouteToTheirOwnHandlers();
    testTheHardResetGuardIgnoresWedgedTablesButProtectsLiveOnes();
    console.log('Settlement retry tests passed.');
}

if (require.main === module) {
    run().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = run;
