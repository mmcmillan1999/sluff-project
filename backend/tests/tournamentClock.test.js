'use strict';

// The tournament shot clock (core/tournamentClock.js) and the pace rules in
// the director: free allowances per decision, the 45 s bank for card play,
// the absent-seat clock, pace pressure when most tables are done, the short
// deal-struck vote, and the early release of the round presentation.

const assert = require('node:assert/strict');

const GameService = require('../src/services/GameService');
const GameEngine = require('../src/core/GameEngine');
const afkTurnTimer = require('../src/core/afkTurnTimer');
const clock = require('../src/core/tournamentClock');
const { getLegalMoves } = require('../src/core/legalMoves');
const { TournamentDirector } = require('../src/tournament/TournamentDirector');
const { createMemoryStore } = require('../src/tournament/tournamentStore');
const { registerBrainProfile } = require('../src/core/bot-brains');
const { createGameServiceWithoutHeartbeat } = require('./test-helpers');

const pass = message => console.log(`  ✓ ${message}`);
const { TOURNAMENT_CLOCK } = clock;

const mockIo = { to: () => ({ emit: () => {} }), emit: () => {}, sockets: { sockets: new Map() } };
const mockPool = { query: () => Promise.resolve({ rows: [], rowCount: 0 }), async connect() { return { query: this.query, release() {} }; } };
const BOTS = [901, 902, 903, 904, 905, 906, 907, 908].map((id, index) => ({ id, username: `Clock Bot ${index + 1}`, tokens: 100 }));
for (const bot of BOTS) registerBrainProfile(bot.username, 'counting');

function tournamentEngine({ humanConnected = true, resumePending = false } = {}) {
    const engine = new GameEngine('tn-clock', 'fort-creek', 'Clock', () => {}, 'tournament', BOTS, null);
    engine.startTournamentRound({
        tournament: { tournamentId: 7, name: 'Clock', roundNumber: 1, tableIndex: 0 },
        seats: [
            { userId: 21, playerName: 'Ada', isBot: false, connected: humanConnected },
            { userId: 901, playerName: 'Clock Bot 1', isBot: true },
            { userId: 902, playerName: 'Clock Bot 2', isBot: true },
        ],
        stacks: { 21: 120, 901: 120, 902: 120 },
        dealerUserId: 901,
        playerMode: 3,
    });
    if (resumePending) engine.players[21].resumePending = true;
    engine.dealCards(engine.dealer);
    return engine;
}

function openPlayTurn(engine, userId = 21) {
    engine.state = 'Playing Phase';
    engine.trickTurnPlayerId = userId;
    engine.trumpSuit = 'S';
    engine.trumpBroken = true;
    engine.currentTrickCards = [];
    engine.leadSuitCurrentTrick = null;
    engine.afkWatch = null;
    engine.turnStartedAt = null;
}

async function runTournamentClockTests() {
    // ---------------------------------------------------------- allowances
    {
        const engine = tournamentEngine();
        assert.deepEqual(engine.tournamentClock.banks, { 21: 90_000, 901: 90_000, 902: 90_000 });
        const pending = kind => ({ kind, userId: 21 });
        assert.equal(clock.allowanceMs(engine, pending('bid')), 24_000);
        assert.equal(clock.allowanceMs(engine, pending('upgrade')), 24_000);
        assert.equal(clock.allowanceMs(engine, pending('trump')), 16_000);
        assert.equal(clock.allowanceMs(engine, pending('discards')), 40_000);
        assert.equal(clock.allowanceMs(engine, pending('play')), 102_000, 'card play: 12 s free plus the 90 s bank');
        clock.setOnTheClock(engine, true);
        assert.equal(clock.allowanceMs(engine, pending('play')), 8_000 + 45_000, 'on the clock: 8 s free and the bank drains twice as fast');
        assert.equal(clock.allowanceMs(engine, pending('bid')), 16_000);
        clock.setOnTheClock(engine, false);
        engine.players[21].disconnected = true;
        assert.equal(clock.allowanceMs(engine, pending('play')), 6_000, 'an absent seat gets six seconds');
        engine.players[21].resumePending = true;
        assert.equal(clock.allowanceMs(engine, pending('play')), 102_000, 'a seat restored from a deploy keeps its clock while its owner returns');
        pass('Allowances (doubled after the first live event): 24 s bid, 16 s trump, 40 s discards, 12 s + 90 s bank for a card; two-thirds and double drain on the clock; 6 s for an absent seat.');
    }

    // ------------------------------------------------------------- the bank
    {
        const engine = tournamentEngine();
        assert.equal(clock.chargeBank(engine, 21, 10_000), 0, 'inside the free allowance nothing is charged');
        assert.equal(clock.chargeBank(engine, 21, 16_000), 4_000);
        assert.equal(engine.tournamentClock.banks[21], 86_000);
        clock.setOnTheClock(engine, true);
        assert.equal(clock.chargeBank(engine, 21, 14_000), 12_000, 'on the clock the overage past 8 s is charged double');
        assert.equal(engine.tournamentClock.banks[21], 74_000);
        assert.equal(clock.chargeBank(engine, 21, 200_000), 74_000, 'the bank never goes below zero');
        assert.equal(clock.chargeBank(engine, 999, 100_000), 0, 'unknown seats are ignored');
        clock.setOnTheClock(engine, false);
        // A real card play charges the bank through the play handler.
        const fresh = tournamentEngine();
        openPlayTurn(fresh);
        fresh.turnStartedAt = Date.now() - 15_000;
        const hand = fresh.hands.Ada;
        const legal = getLegalMoves(hand, true, null, 'S', true);
        fresh.playCard(21, legal[0]);
        const charged = 90_000 - fresh.tournamentClock.banks[21];
        assert.ok(charged >= 3_000 && charged <= 3_100, `a fifteen-second play costs three seconds of bank (charged ${charged})`);
        const publicView = clock.publicClock(fresh);
        assert.equal(publicView.banks.Ada, 87);
        const onTurn = clock.publicClock(fresh, { kind: 'play', userId: 21 }).turn;
        assert.deepEqual(onTurn, { playerName: 'Ada', kind: 'play', freeSeconds: 12, bankSeconds: 87, allowanceSeconds: 99 });
        assert.equal(publicView.onTheClock, false);
        pass('The bank is charged for time past the free allowance, doubled on the clock, never negative.');
    }

    // ------------------------------------------- the backstop on the clock
    {
        const engine = tournamentEngine();
        openPlayTurn(engine);
        const t0 = 1_000_000;
        assert.equal(afkTurnTimer.evaluate(engine, { now: t0, timeoutMs: 51_750 }), null, 'first sight arms the clock');
        assert.equal(afkTurnTimer.evaluate(engine, { now: t0 + 100_000, timeoutMs: 51_750 }), null, 'inside free time plus bank');
        assert.equal(afkTurnTimer.refresh(engine, 21, { now: t0 + 40_000 }), false, 'activity pings buy nothing on the shot clock');
        assert.equal(afkTurnTimer.deadlineFor(engine, { timeoutMs: 51_750 }), t0 + 102_000, 'the published deadline is the seat allowance');
        const decision = afkTurnTimer.evaluate(engine, { now: t0 + 102_001, timeoutMs: 51_750 });
        assert.equal(decision?.action, 'play');
        assert.equal(engine.tournamentClock.banks[21], 0, 'the house played for the seat, so its bank is spent');
        const state = engine._getRawStateForClient();
        assert.equal(state.afkTimeoutSeconds, 12, 'with the bank gone the next card has twelve seconds');
        assert.equal(state.tournamentClock.banks.Ada, 0);
        // The next turn: only the free allowance is left.
        openPlayTurn(engine);
        assert.equal(afkTurnTimer.evaluate(engine, { now: t0 + 110_000, timeoutMs: 51_750 }), null);
        assert.equal(afkTurnTimer.evaluate(engine, { now: t0 + 121_000, timeoutMs: 51_750 }), null);
        assert.equal(afkTurnTimer.evaluate(engine, { now: t0 + 122_001, timeoutMs: 51_750 })?.action, 'play');
        pass('The backstop fires at free time plus bank, spends the bank, and then runs on free time alone.');
    }

    // ------------------------------------------------- deal-struck vote
    {
        const engine = tournamentEngine();
        engine.state = 'Playing Phase';
        engine._startPlayoutVote();
        assert.equal(engine.playoutVote.timer, TOURNAMENT_CLOCK.playoutVoteSeconds);
        assert.equal(engine.playoutVote.timer, 20);
        engine._clearPlayoutTimer();
        const cash = new GameEngine('t-cash', 'fort-creek', 'Cash', () => {});
        cash.joinTable({ id: 31, username: 'Cash Human' }, 'sock-31');
        cash.gameStarted = true;
        cash.state = 'Playing Phase';
        cash._startPlayoutVote();
        assert.equal(cash.playoutVote.timer, 30, 'cash tables keep the thirty-second vote');
        cash._clearPlayoutTimer();
        pass('The deal-struck vote is twenty seconds in a tournament, thirty at a cash table.');
    }

    // ------------------------------------------ pace pressure + release
    {
        const gameService = createGameServiceWithoutHeartbeat(GameService, mockIo, mockPool, { botAccounts: BOTS });
        gameService.timerOverride = () => {};
        const store = createMemoryStore({ balances: Object.fromEntries(BOTS.map(bot => [bot.id, 1000])) });
        const queue = [];
        const now = { value: 1_800_000_000_000 };
        const emitted = [];
        gameService.emitGameState = tableId => emitted.push(tableId);
        const director = new TournamentDirector({
            gameService, store, io: mockIo, now: () => now.value,
            schedule: fn => { queue.push(fn); return queue.length; }, cancelSchedule: () => {},
            random: () => 0, presentationHoldMs: 18_000, boardDelayMs: 0,
        });
        gameService.attachTournamentDirector(director);
        const matt = { id: 11, username: 'Matt', is_vip: true };
        const t = await director.create(matt, { buyInTokens: 1, startingStack: 120, maxSeats: 9, startRule: 'creator' });
        await director.register(t.id, matt);
        for (let i = 0; i < 8; i += 1) await director.findPlayer(t.id, 11);
        await director.start(t.id, 11);
        const live = director.get(t.id);
        const tables = [...live.tables.values()];
        assert.equal(tables.length, 3);
        while (queue.length) await queue.shift()(); // the delayed deals
        const resultFor = table => ({
            tournamentId: t.id, roundNumber: 1, tableIndex: table.index, tableId: table.tableId,
            scores: { ...gameService.getEngineById(table.tableId).scores }, pointChanges: {}, bidType: 'Solo', bidderName: null, dealExecuted: false, allPassRedeals: 0,
        });
        await director.onTableComplete(resultFor(tables[0]));
        assert.equal(gameService.getEngineById(tables[2].tableId).tournamentClock.onTheClock, false, 'one of three done: no pressure yet');
        emitted.length = 0;
        await director.onTableComplete(resultFor(tables[1]));
        const straggler = gameService.getEngineById(tables[2].tableId);
        assert.equal(straggler.tournamentClock.onTheClock, true, 'two of three done: the last table is on the clock');
        assert.ok(emitted.includes(tables[2].tableId), 'the table is told so the seat ring can show it');
        assert.equal(straggler._getRawStateForClient().tournamentClock.onTheClock, true);
        pass('Pace pressure: when two-thirds of the tables are done, the rest go on the clock.');

        // Presentation release: the fallback is the 18 s hold, but once
        // every finished table has been acknowledged the tick reseats now.
        await director.onTableComplete(resultFor(tables[2]));
        assert.equal(live.roundCompleteAt, now.value);
        assert.equal(queue.length, 1, 'the hold is scheduled');
        for (const table of tables) {
            const engine = gameService.getEngineById(table.tableId);
            engine.state = 'Awaiting Next Round Trigger';
            engine.roundSummary = { presentationReadyAt: now.value + 18_000, presentationForceReadyAt: now.value + 53_000, allConnectedHumansPresented: false };
        }
        await director.tick();
        assert.equal(live.round, 1, 'nobody has acknowledged: the round waits');
        for (const table of tables) gameService.getEngineById(table.tableId).roundSummary.allConnectedHumansPresented = true;
        await director.tick();
        assert.equal(live.tables.size, 0, 'every ceremony acknowledged: the round finished without waiting out the hold');
        assert.equal(live.roundCompleteAt, null);
        assert.equal(queue.length, 2, 'the stale hold and the next round are both queued');
        while (queue.length) await queue.shift()();
        assert.equal(live.round, 2, 'the next round is seated once, the stale hold is a no-op');
        pass('The round presentation releases early once every table has been acknowledged, and never twice.');

        // Two tables: pressure as soon as the other is done.
        await director.voidTournament(t.id, 'done');
        const t2 = await director.create(matt, { buyInTokens: 1, startingStack: 120, maxSeats: 6, startRule: 'creator' });
        await director.register(t2.id, matt);
        for (let i = 0; i < 5; i += 1) await director.findPlayer(t2.id, 11);
        await director.start(t2.id, 11);
        const two = [...director.get(t2.id).tables.values()];
        assert.equal(two.length, 2);
        while (queue.length) await queue.shift()();
        await director.onTableComplete({ ...resultFor(two[0]), tournamentId: t2.id, scores: { ...gameService.getEngineById(two[0].tableId).scores } });
        assert.equal(gameService.getEngineById(two[1].tableId).tournamentClock.onTheClock, true, 'with two tables, the other goes on the clock at once');
        await director.voidTournament(t2.id, 'done');
        pass('With two tables, pressure starts the moment the first one finishes.');
    }

    console.log('Tournament shot clock tests passed.');
}

module.exports = runTournamentClockTests;

if (require.main === module) {
    runTournamentClockTests().catch(error => { console.error(error); process.exitCode = 1; });
}
