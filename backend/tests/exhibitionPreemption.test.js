'use strict';

// Ladder-gated quick play (rooms priced above the bot mercy floor) seats the
// richest affordable bots first, and a bot-only exhibition game holding those
// bots is washed — every buy-in refunded — so the human table gets them.
// Games with human players are never preempted.

const assert = require('node:assert/strict');
const GameService = require('../src/services/GameService');
const { createGameServiceWithoutHeartbeat } = require('./test-helpers');

function createIo() {
    return {
        emitted: [],
        sockets: { sockets: new Map() },
        to() { return { emit() {} }; },
        emit(event, payload) { this.emitted.push({ event, payload }); },
    };
}

function createHarness({ botAccounts, balances }) {
    const io = createIo();
    const rowsForCurrentBalances = () => botAccounts.map(profile => {
        const tokens = Number(balances[profile.id] ?? 0);
        return { id: profile.id, user_id: profile.id, tokens: String(tokens) };
    });
    const pool = {
        query: () => Promise.resolve({
            rows: rowsForCurrentBalances(),
            rowCount: botAccounts.length,
        }),
    };
    const service = createGameServiceWithoutHeartbeat(GameService, io, pool, { botAccounts });
    let now = 1_000_000;
    service.nowOverride = () => now;
    service.quickPlayRandomOverride = () => 0;
    service.timerOverride = (callback, duration) => ({ callback, duration });

    const washes = [];
    service.handleDrawOutcome = async (payload) => {
        washes.push(payload);
        return {
            isGameOver: true,
            drawOutcome: 'wash',
            gameWinner: 'Draw',
            payouts: {},
            tokenSettlement: {},
            finalScores: {},
            message: 'The game ended in a wash. Every funded buy-in was returned.',
        };
    };
    return { service, io, washes, balances };
}

function lobbyEngineForTheme(service, themeId) {
    return Object.values(service.getAllEngines()).find(engine => (
        engine.theme === themeId && engine.tableType !== 'quickplay'
    ));
}

// Seats the given bots in a fixed order by narrowing eligibility to one bot
// per call, so the tests control exactly who the exhibition holds.
function seatBotsInOrder(engine, balances, botIds) {
    for (const botId of botIds) {
        const bot = engine.addBotPlayer({
            eligibleBotBalances: new Map([[botId, Number(balances[botId])]]),
        });
        assert.equal(bot?.userId, botId, `test setup seated bot ${botId}`);
    }
}

function startBotGame(engine, gameId) {
    engine.gameStarted = true;
    engine.gameId = gameId;
    engine.state = 'Playing Phase';
}

function seatHuman(engine, id, name = `Player ${id}`) {
    engine.joinTable({ id, username: name }, `socket-${id}`, '100.00');
}

function seatedBotIds(engine) {
    return engine.playerOrder.allIds.filter(id => engine.players[id]?.isBot);
}

const BOT_ACCOUNTS = [
    { id: 9101, username: 'Ladder Leader', tokens: 0, isBot: true },
    { id: 9102, username: 'Second Stack', tokens: 0, isBot: true },
    { id: 9103, username: 'Mid Roller', tokens: 0, isBot: true },
    { id: 9104, username: 'Floor Dweller', tokens: 0, isBot: true },
];
const BALANCES = { 9101: 200, 9102: 150, 9103: 40, 9104: 2 };

async function testRichestFirstSeatingWithoutExhibitions() {
    const { service, washes } = createHarness({ botAccounts: BOT_ACCOUNTS, balances: BALANCES });
    const engine = service.findQuickPlayTable('shirecliff-road');
    seatHuman(engine, 801, 'Shirecliff Human');
    service.evaluateQuickPlayTable(engine.tableId, { restartFill: true });

    await service.qpTimers[engine.tableId].fill.handle.callback();
    assert.deepEqual(seatedBotIds(engine), [9101],
        'the first funded seat goes to the richest affordable bot');
    await service.qpTimers[engine.tableId].fill.handle.callback();
    assert.deepEqual(seatedBotIds(engine), [9101, 9102],
        'the second seat takes the next-richest, never the mid or floor stacks');
    assert.equal(engine.qpPhase, 'decision_pending');
    assert.equal(washes.length, 0, 'nothing to preempt when every bot is free');
}

async function testFillWashesExhibitionHoldingTheRichestBots() {
    const harness = createHarness({ botAccounts: BOT_ACCOUNTS, balances: BALANCES });
    const { service, washes } = harness;
    const exhibition = lobbyEngineForTheme(service, 'shirecliff-road');
    exhibition.isExhibitionTable = true;
    seatBotsInOrder(exhibition, BALANCES, [9101, 9102, 9103]);
    startBotGame(exhibition, 777);

    const qp = service.findQuickPlayTable('shirecliff-road');
    seatHuman(qp, 802, 'Waiting Human');
    service.evaluateQuickPlayTable(qp.tableId, { restartFill: true });
    await service.qpTimers[qp.tableId].fill.handle.callback();

    assert.equal(washes.length, 1, 'the exhibition game is settled exactly once');
    assert.equal(washes[0].gameId, 777);
    assert.equal(washes[0].outcome, 'wash', 'preemption refunds every buy-in');
    assert.equal(exhibition.gameStarted, false, 'the exhibition game is over');
    assert.deepEqual(seatedBotIds(exhibition), [],
        'the exhibition table is cleared for its manager to re-seat later');
    assert.deepEqual(seatedBotIds(qp), [9101],
        'the human table seats the richest bot freed from the exhibition');
    assert.equal(service.botSeatLeases.get(9101)?.tableId, qp.tableId,
        'the freed bot is leased to the human table');
    assert.equal(service.botSeatLeases.get(9102), undefined,
        'the other freed bots return to the pool');

    await service.qpTimers[qp.tableId].fill.handle.callback();
    assert.deepEqual(seatedBotIds(qp), [9101, 9102]);
    assert.equal(qp.qpPhase, 'decision_pending');
    assert.equal(washes.length, 1, 'freed bots seat without another preemption');
    assert.equal(qp.qpMatchmakingNotice, null,
        'no pool-thin notice when preemption satisfies the fill');
}

async function testIdleExhibitionRosterIsReclaimedWithoutASettlement() {
    const harness = createHarness({ botAccounts: BOT_ACCOUNTS, balances: BALANCES });
    const { service, washes } = harness;
    const exhibition = lobbyEngineForTheme(service, 'shirecliff-road');
    exhibition.isExhibitionTable = true;
    seatBotsInOrder(exhibition, BALANCES, [9101, 9102, 9103]);

    const qp = service.findQuickPlayTable('shirecliff-road');
    seatHuman(qp, 803, 'Prompt Human');
    service.evaluateQuickPlayTable(qp.tableId, { restartFill: true });
    await service.qpTimers[qp.tableId].fill.handle.callback();

    assert.equal(washes.length, 0, 'an unstarted roster has no buy-ins to refund');
    assert.deepEqual(seatedBotIds(exhibition), [], 'the idle roster is released');
    assert.deepEqual(seatedBotIds(qp), [9101]);
}

async function testHumanGamesAreNeverPreempted() {
    const harness = createHarness({ botAccounts: BOT_ACCOUNTS, balances: BALANCES });
    const { service, washes } = harness;
    // The richest bot is mid-game with a human on an ordinary lobby table.
    const humanTable = lobbyEngineForTheme(service, 'fort-creek');
    seatHuman(humanTable, 804, 'Table Owner');
    seatBotsInOrder(humanTable, BALANCES, [9101]);
    startBotGame(humanTable, 778);

    const qp = service.findQuickPlayTable('shirecliff-road');
    seatHuman(qp, 805, 'Shirecliff Human');
    service.evaluateQuickPlayTable(qp.tableId, { restartFill: true });
    await service.qpTimers[qp.tableId].fill.handle.callback();

    assert.equal(washes.length, 0, 'a game with a human is never killed');
    assert.equal(humanTable.gameStarted, true);
    assert.deepEqual(seatedBotIds(qp), [9102],
        'matchmaking passes over the locked bot and seats the next-richest');
}

async function testMercyPricedRoomKeepsTheRandomDrawAndNeverPreempts() {
    const harness = createHarness({ botAccounts: BOT_ACCOUNTS, balances: BALANCES });
    const { service, washes } = harness;
    assert.equal(service._quickPlaySeatsRichestFirst({ theme: 'fort-creek' }), false,
        'the mercy-priced room keeps the random draw');
    assert.equal(service._quickPlaySeatsRichestFirst({ theme: 'shirecliff-road' }), true);
    assert.equal(service._quickPlaySeatsRichestFirst({ theme: 'dans-deck' }), true);

    const exhibition = lobbyEngineForTheme(service, 'shirecliff-road');
    exhibition.isExhibitionTable = true;
    seatBotsInOrder(exhibition, BALANCES, [9101, 9102, 9103]);
    startBotGame(exhibition, 779);

    const qp = service.findQuickPlayTable('fort-creek');
    seatHuman(qp, 806, 'Fort Creek Human');
    service.evaluateQuickPlayTable(qp.tableId, { restartFill: true });
    await service.qpTimers[qp.tableId].fill.handle.callback();

    assert.equal(washes.length, 0, 'Fort Creek never kills an exhibition game');
    assert.equal(exhibition.gameStarted, true, 'the exhibition plays on');
    assert.deepEqual(seatedBotIds(qp), [9104],
        'the only unleased affordable bot takes the seat');
}

async function testFallbackFourthPreemptsForTheRichestBot() {
    const harness = createHarness({ botAccounts: BOT_ACCOUNTS, balances: BALANCES });
    const { service, washes } = harness;
    const qp = service.findQuickPlayTable('shirecliff-road');
    seatHuman(qp, 807, 'Fourth Seeker');
    service.evaluateQuickPlayTable(qp.tableId, { restartFill: true });
    await service.qpTimers[qp.tableId].fill.handle.callback();
    await service.qpTimers[qp.tableId].fill.handle.callback();
    assert.deepEqual(seatedBotIds(qp), [9101, 9102]);

    // The remaining funded bot sits in a started exhibition game.
    const exhibition = lobbyEngineForTheme(service, 'shirecliff-road');
    exhibition.isExhibitionTable = true;
    seatBotsInOrder(exhibition, BALANCES, [9103]);
    startBotGame(exhibition, 780);

    const starts = [];
    service.startGame = (tableId, userId, options) => {
        starts.push({ tableId, userId, options });
        const engine = service.getEngineById(tableId);
        engine.gameStartPending = true;
        return new Promise(() => {});
    };
    const decision = service.quickPlayDecision(qp.tableId, 807, 'seek4', qp.qpGeneration);
    assert.equal(decision.accepted, true);
    const windowTimer = service.qpTimers[qp.tableId].window.handle;
    service.nowOverride = () => qp.qpWindowEndsAt;
    await windowTimer.callback();
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(washes.length, 1, 'the fourth-seat search reclaims the exhibition bot');
    assert.equal(washes[0].gameId, 780);
    assert.deepEqual(seatedBotIds(qp), [9101, 9102, 9103]);
    assert.equal(qp.qpFallbackBot?.userId, 9103);
    assert.equal(starts.length, 1, 'the four-seat game start is requested');
}

async function testEngineGuardsRefuseToPreemptWithAHumanSeated() {
    const harness = createHarness({ botAccounts: BOT_ACCOUNTS, balances: BALANCES });
    const { service } = harness;
    const table = lobbyEngineForTheme(service, 'shirecliff-road');
    seatHuman(table, 808, 'Seated Human');
    seatBotsInOrder(table, BALANCES, [9101, 9102]);
    startBotGame(table, 781);

    const result = table.preemptBotGame();
    assert.deepEqual(result.effects, [], 'a table with a human seat cannot be washed');
    assert.equal(table.state, 'Playing Phase');
    assert.equal(table.gameStarted, true);

    table.gameStarted = false;
    table.state = 'Ready to Start';
    const idle = table.preemptBotGame();
    assert.deepEqual(idle.effects, [], 'an unstarted table has no game to settle');
}

async function runExhibitionPreemptionTests() {
    console.log('Running exhibition preemption tests...');
    let testCounter = 1;
    const pass = (testName) => console.log(`  ✔ Test ${testCounter++}: ${testName}`);

    await testRichestFirstSeatingWithoutExhibitions();
    pass('Ladder-gated rooms seat the richest affordable bots first.');
    await testFillWashesExhibitionHoldingTheRichestBots();
    pass('A filling table washes the exhibition game holding its bots.');
    await testIdleExhibitionRosterIsReclaimedWithoutASettlement();
    pass('An idle exhibition roster is reclaimed without a settlement.');
    await testHumanGamesAreNeverPreempted();
    pass('Games with human players are never preempted.');
    await testMercyPricedRoomKeepsTheRandomDrawAndNeverPreempts();
    pass('The mercy-priced room keeps the random draw and never preempts.');
    await testFallbackFourthPreemptsForTheRichestBot();
    pass('The fourth-seat fallback search also reclaims exhibition bots.');
    await testEngineGuardsRefuseToPreemptWithAHumanSeated();
    pass('Engine guards refuse to preempt human or unstarted tables.');

    console.log('All exhibition preemption tests passed!');
}

module.exports = runExhibitionPreemptionTests;
