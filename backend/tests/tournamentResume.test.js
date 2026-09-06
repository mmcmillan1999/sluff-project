'use strict';

// Deploy survival for tournaments: the dying instance snapshots every
// running tournament, the replacement claims and rebuilds it — mid-round
// with each live table restored mid-trick, or between rounds on the board —
// and a tournament whose snapshot never arrives is voided and refunded
// only after the resume grace period.

const assert = require('node:assert/strict');

const GameService = require('../src/services/GameService');
const BotPlayer = require('../src/core/BotPlayer');
const { getLegalMoves } = require('../src/core/legalMoves');
const { TournamentDirector, RESUME_GRACE_MS } = require('../src/tournament/TournamentDirector');
const { createMemoryStore } = require('../src/tournament/tournamentStore');
const { registerBrainProfile } = require('../src/core/bot-brains');
const { createGameServiceWithoutHeartbeat } = require('./test-helpers');

const pass = message => console.log(`  ✓ ${message}`);

const mockIo = { to: () => ({ emit: () => {} }), emit: () => {}, sockets: { sockets: new Map() } };
const mockPool = { query: () => Promise.resolve({ rows: [], rowCount: 0 }), async connect() { return { query: this.query, release() {} }; } };
const BOTS = [911, 912, 913, 914, 915, 916].map((id, index) => ({ id, username: `Resume Bot ${index + 1}`, tokens: 100 }));
for (const bot of BOTS) registerBrainProfile(bot.username, 'counting');

function harness(store, { now } = {}) {
    const timers = [];
    const gameService = createGameServiceWithoutHeartbeat(GameService, mockIo, mockPool, { botAccounts: BOTS });
    gameService.timerOverride = (cb, duration) => { timers.push({ cb, duration }); };
    const queue = [];
    const clock = now || { value: 1_800_000_000_000 };
    const director = new TournamentDirector({
        gameService, store, io: mockIo, now: () => clock.value,
        schedule: fn => { queue.push(fn); return queue.length; }, cancelSchedule: () => {},
        random: () => 0, presentationHoldMs: 0, boardDelayMs: 0,
    });
    gameService.attachTournamentDirector(director);
    const drain = async () => { while (queue.length) await queue.shift()(); };
    return { gameService, director, timers, queue, clock, drain };
}

const brainFor = (engine, id) => engine.bots[id] || new BotPlayer(id, engine.players[id].playerName, engine);

async function step(h, tableId) {
    const { gameService, timers } = h;
    const engine = gameService.getEngineById(tableId);
    if (!engine || engine.state === 'Awaiting Next Round Trigger') return false;
    if (timers.length > 0) { await timers.shift().cb(); return true; }
    const state = engine.state;
    if (state === 'Dealing Pending') { await gameService.dealCards(tableId, engine.dealer); return true; }
    if (state === 'Bidding Phase' || state === 'Awaiting Frog Upgrade Decision') {
        const id = engine.biddingTurnPlayerId;
        const brain = brainFor(engine, id);
        await gameService.placeBid(tableId, id, state === 'Bidding Phase' ? brain.decideBid() : brain.decideFrogUpgrade());
        return true;
    }
    if (state === 'Trump Selection') { const id = engine.bidWinnerInfo.userId; await gameService.chooseTrump(tableId, id, brainFor(engine, id).chooseTrump()); return true; }
    if (state === 'Frog Widow Exchange') { const id = engine.bidWinnerInfo.userId; await gameService.submitFrogDiscards(tableId, id, brainFor(engine, id).submitFrogDiscards()); return true; }
    if (state === 'Playing Phase') {
        const id = engine.trickTurnPlayerId;
        const hand = engine.hands[engine.players[id].playerName];
        const legal = getLegalMoves(hand, engine.currentTrickCards.length === 0, engine.leadSuitCurrentTrick, engine.trumpSuit, engine.trumpBroken);
        const card = brainFor(engine, id).playCard();
        await gameService.playCard(tableId, id, legal.includes(card) ? card : legal[0]);
        return true;
    }
    throw new Error(`unexpected state ${state}`);
}

async function playToEnd(h, tableId) {
    for (let guard = 0; guard < 4000; guard += 1) {
        if (!(await step(h, tableId))) return;
    }
    throw new Error(`${tableId} did not finish`);
}

async function playUntilMidTrick(h, tableId) {
    for (let guard = 0; guard < 4000; guard += 1) {
        const engine = h.gameService.getEngineById(tableId);
        if (engine.state === 'Playing Phase' && engine.tricksPlayedCount >= 3 && h.timers.length === 0) return;
        if (!(await step(h, tableId))) throw new Error('finished before mid-trick');
    }
}

async function runTournamentResumeTests() {
    const balances = { 11: 500, ...Object.fromEntries(BOTS.map(bot => [bot.id, 1000])) };
    const matt = { id: 11, username: 'Matt', is_vip: true };

    // ------------------------------------------ mid-round snapshot/restore
    {
        const store = createMemoryStore({ balances });
        const first = harness(store);
        const t = await first.director.create(matt, { buyInTokens: 1, startingStack: 120, maxSeats: 6, startRule: 'creator' });
        await first.director.register(t.id, matt);
        for (let i = 0; i < 5; i += 1) await first.director.findPlayer(t.id, 11);
        await first.director.start(t.id, 11);
        const live = first.director.get(t.id);
        const [tableA, tableB] = [...live.tables.keys()];
        await playToEnd(first, tableA);
        assert.ok(live.tables.get(tableA).result, 'table A finished its round');
        await playUntilMidTrick(first, tableB);
        const engineB = first.gameService.getEngineById(tableB);
        const frozen = {
            state: engineB.state, tricks: engineB.tricksPlayedCount, hands: JSON.stringify(engineB.hands),
            trick: JSON.stringify(engineB.currentTrickCards), scores: { ...engineB.scores }, turn: engineB.trickTurnPlayerId,
            banks: { ...engineB.tournamentClock.banks },
        };
        const saved = await first.director.snapshotForShutdown();
        assert.equal(saved.saved, 1);
        assert.equal(store.state.snapshots.size, 1);

        // The replacement instance: a fresh service and director on the same database.
        const second = harness(store);
        const restored = await second.director.restore();
        assert.equal(restored.restored, 1);
        assert.equal(store.state.snapshots.size, 0, 'the snapshot is claimed once');
        const back = second.director.get(t.id);
        assert.equal(back.status, 'running');
        assert.equal(back.round, 1);
        assert.deepEqual([...back.tables.keys()], [tableA, tableB]);
        assert.ok(back.tables.get(tableA).result, 'the finished table keeps its result');
        assert.equal(second.gameService.getEngineById(tableA), undefined, 'a finished table needs no engine');
        const engineB2 = second.gameService.getEngineById(tableB);
        assert.ok(engineB2, 'the live table is back');
        assert.equal(engineB2.state, frozen.state);
        assert.equal(engineB2.tricksPlayedCount, frozen.tricks);
        assert.equal(JSON.stringify(engineB2.hands), frozen.hands);
        assert.equal(JSON.stringify(engineB2.currentTrickCards), frozen.trick);
        assert.deepEqual(engineB2.scores, frozen.scores);
        assert.equal(engineB2.trickTurnPlayerId, frozen.turn);
        assert.deepEqual(engineB2.tournamentClock.banks, frozen.banks, 'the shot clock banks survive');
        assert.equal(engineB2.tournament.tournamentId, t.id);
        assert.equal(engineB2.tableType, 'tournament');
        for (const entry of back.entries.values()) {
            assert.equal(second.gameService.botSeatLeases.get(entry.userId)?.tableId, entry.isBot ? `tn-${t.id}` : undefined);
        }
        const human = engineB2.players[11] || second.gameService.getEngineById(tableB).players[11];
        if (human) assert.equal(human.resumePending, true, 'a restored human seat waits for its owner');
        pass('A mid-round snapshot brings back the room, the finished table, and the live table mid-trick.');

        await playToEnd(second, tableB);
        await second.drain();
        assert.equal(back.round, 2, 'the restored round finished and the next one was seated');
        const stacks = [...back.entries.values()].map(entry => entry.stack);
        assert.ok(stacks.some(stack => stack !== 120), 'chips moved in round one');
        pass('The restored round plays to its end and the room reseats.');

        // Between rounds: the board delay was pending.
        const between = harness(store);
        // Freeze the second harness mid-board by snapshotting right after a round finishes.
        for (const tableId of [...back.tables.keys()]) await playToEnd(second, tableId);
        // Finish the round but do not run the scheduled next-round step.
        const finish = second.queue.shift();
        await finish();
        assert.equal(back.tables.size, 0, 'between rounds: no tables');
        assert.equal(second.queue.length, 1, 'the next round is scheduled');
        await second.director.snapshotForShutdown();
        const restoredBetween = await between.director.restoreSnapshots();
        assert.equal(restoredBetween.restored, 1);
        const third = between.director.get(t.id);
        assert.equal(third.tables.size, 0);
        assert.equal(third.round, back.round);
        await between.drain();
        assert.equal(third.round, back.round + 1, 'the board delay resumes and the next round is seated');
        assert.ok(third.tables.size >= 1);
        await between.director.voidTournament(t.id, 'done');
        pass('A between-rounds snapshot resumes on the board and seats the next round.');
    }

    // ------------------------------------------- no snapshot: grace then void
    {
        const store = createMemoryStore({ balances });
        const origin = harness(store);
        const t = await origin.director.create(matt, { buyInTokens: 1, startingStack: 120, maxSeats: 6, startRule: 'creator' });
        await origin.director.register(t.id, matt);
        for (let i = 0; i < 5; i += 1) await origin.director.findPlayer(t.id, 11);
        await origin.director.start(t.id, 11);
        assert.equal(store.state.tournaments.get(t.id).status, 'running');
        const clock = { value: 1_800_000_000_000 };
        const replacement = harness(store, { now: clock });
        await replacement.director.restore();
        assert.equal(replacement.director.get(t.id), null, 'nothing to restore yet');
        assert.equal(store.state.tournaments.get(t.id).status, 'running', 'not voided at boot: the snapshot may still be on its way');
        await replacement.director.tick();
        assert.equal(store.state.tournaments.get(t.id).status, 'running');
        clock.value += RESUME_GRACE_MS;
        await replacement.director.tick();
        assert.equal(store.state.tournaments.get(t.id).status, 'voided', 'after the grace period it is voided');
        assert.equal(store.balanceOf(11), 500, 'and every buy-in is back');
        assert.equal(store.state.transactions.filter(tx => tx.type === 'tournament_refund').length, 6);
        pass('A running tournament without a snapshot survives the grace period, then is voided and refunded.');
    }

    console.log('Tournament deploy survival tests passed.');
}

module.exports = runTournamentResumeTests;

if (require.main === module) {
    runTournamentResumeTests().catch(error => { console.error(error); process.exitCode = 1; });
}
