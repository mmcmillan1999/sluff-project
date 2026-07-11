'use strict';

const assert = require('node:assert/strict');
const GameEngine = require('../src/core/GameEngine');
const GameService = require('../src/services/GameService');
const transactionManager = require('../src/data/transactionManager');
const { createGameServiceWithoutHeartbeat } = require('./test-helpers');
const {
    buildDrawSettlement,
    buildForfeitSettlement,
    buildNormalGameSettlement,
} = require('../src/settlement/gameSettlement');

function makeFundedTable(gameId, scores = { Alice: 200, Bob: 100, 'Mike Knight': 0 }) {
    return {
        gameId,
        theme: 'fort-creek',
        seatingOrderIds: [1, 2, 100],
        players: {
            1: { userId: 1, playerName: 'Alice', isBot: false, isSpectator: false },
            2: { userId: 2, playerName: 'Bob', isBot: false, isSpectator: false },
            100: { userId: 100, playerName: 'Mike Knight', isBot: true, isSpectator: false },
        },
        scores,
    };
}

function createLedgerPool({ balances = { 1: 10, 2: 10, 100: 4 }, recentBotMercy = 0 } = {}) {
    const state = {
        balances: new Map(Object.entries(balances).map(([id, amount]) => [Number(id), Number(amount)])),
        accounts: new Map([
            [1, { id: 1, username: 'Alice', is_bot: false }],
            [2, { id: 2, username: 'Bob', is_bot: false }],
            [100, { id: 100, username: 'Mike Knight', is_bot: true }],
        ]),
        mercyCount: new Map([[100, recentBotMercy]]),
        transactions: [],
        stats: new Map(),
        statUpdateCount: 0,
        gameOutcome: 'In Progress',
        gameId: 900,
        commits: 0,
        rollbacks: 0,
    };

    const client = {
        async query(query, params = []) {
            const sql = String(query).replace(/\s+/g, ' ').trim();
            if (sql === 'BEGIN') return { rows: [] };
            if (sql === 'COMMIT') {
                state.commits += 1;
                return { rows: [] };
            }
            if (sql === 'ROLLBACK') {
                state.rollbacks += 1;
                return { rows: [] };
            }
            if (sql.includes('INSERT INTO game_history')) {
                state.gameOutcome = 'In Progress';
                return { rows: [{ game_id: state.gameId }] };
            }
            if (sql.startsWith('SELECT outcome FROM game_history')) {
                return { rows: [{ outcome: state.gameOutcome }] };
            }
            if (sql.includes('FROM users') && sql.includes('id = ANY')) {
                const requested = params[0].map(Number);
                if (sql.includes('is_bot')) {
                    return { rows: requested.map(id => state.accounts.get(id)).filter(Boolean) };
                }
                return { rows: requested.filter(id => state.accounts.has(id)).map(id => ({ id })) };
            }
            if (sql.includes('FROM users') && sql.includes('id = $1')) {
                const account = state.accounts.get(Number(params[0]));
                return { rows: account ? [account] : [] };
            }
            if (sql.includes('SUM(amount)') && sql.includes('user_id = ANY')) {
                return {
                    rows: params[0].map(Number).map(userId => ({
                        user_id: userId,
                        current_tokens: String(state.balances.get(userId) || 0),
                    })),
                };
            }
            if (sql.includes('SUM(amount)') && sql.includes('user_id = $1')) {
                return { rows: [{ current_tokens: String(state.balances.get(Number(params[0])) || 0) }] };
            }
            if (sql.includes('mercy_count')) {
                const userId = Number(params[0]);
                const count = state.mercyCount.get(userId) || 0;
                return {
                    rows: [{
                        mercy_count: String(count),
                        last_mercy_time: count ? new Date() : null,
                    }],
                };
            }
            if (sql.includes('INSERT INTO transactions')) {
                if (sql.includes("'free_token_mercy'")) {
                    const userId = Number(params[0]);
                    state.balances.set(userId, (state.balances.get(userId) || 0) + 1);
                    state.mercyCount.set(userId, (state.mercyCount.get(userId) || 0) + 1);
                    state.transactions.push({ userId, type: 'free_token_mercy', amount: 1 });
                    return { rows: [] };
                }
                if (sql.includes("'buy_in'")) {
                    const [userId, gameId, amount] = params;
                    state.balances.set(Number(userId), (state.balances.get(Number(userId)) || 0) + Number(amount));
                    state.transactions.push({ userId: Number(userId), gameId, type: 'buy_in', amount: Number(amount) });
                    return { rows: [] };
                }
                const [userId, gameId, type, amount] = params;
                state.balances.set(Number(userId), (state.balances.get(Number(userId)) || 0) + Number(amount));
                state.transactions.push({ userId: Number(userId), gameId, type, amount: Number(amount) });
                return { rows: [] };
            }
            if (sql.startsWith('UPDATE users SET')) {
                const userId = Number(params[0]);
                const column = /UPDATE users SET (wins|losses|washes)/.exec(sql)?.[1];
                state.stats.set(userId, column);
                state.statUpdateCount += 1;
                return { rows: [], rowCount: 1 };
            }
            if (sql.startsWith('UPDATE game_history SET outcome')) {
                state.gameOutcome = params[0];
                return { rows: [], rowCount: 1 };
            }
            throw new Error(`Unexpected funded-bot query: ${sql}`);
        },
        release() {},
    };
    return { state, async connect() { return client; } };
}

function makeService(engine, pool) {
    const service = Object.create(GameService.prototype);
    service.engines = { [engine.tableId]: engine };
    service.pool = pool;
    service.io = {
        sockets: { sockets: new Map() },
        to() { return { emit() {} }; },
        emit() {},
    };
    return service;
}

async function testPersistentBotRosterAndAtomicStart() {
    const profiles = [{ id: 100, username: 'Mike Knight', tokens: 4, isBot: true }];
    const engine = new GameEngine('funded-start', 'fort-creek', 'Funded Start', null, 'private', profiles);
    engine.joinTable({ id: 1, username: 'Alice' }, 'socket-1', 10);
    engine.joinTable({ id: 2, username: 'Bob' }, 'socket-2', 10);
    const bot = engine.addBotPlayer();
    assert.deepEqual(bot, {
        userId: 100,
        playerName: 'Mike Knight',
        socketId: null,
        isSpectator: false,
        disconnected: false,
        isBot: true,
        tokens: 4,
    });

    const start = engine.startGame(1);
    const effect = start.effects.find(candidate => candidate.type === 'START_GAME_TRANSACTIONS');
    assert.deepEqual(effect.payload.playerIds, [1, 2, 100]);
    assert.deepEqual(effect.payload.botPlayerIds, [100]);

    const pool = createLedgerPool();
    await makeService(engine, pool)._executeEffects(engine.tableId, [effect]);
    assert.equal(engine.gameStarted, true);
    assert.equal(engine.players[100].tokens, 4, 'the +1 mercy and -1 buy-in are reflected in memory');
    assert.equal(pool.state.transactions.filter(row => row.type === 'free_token_mercy').length, 1);
    assert.equal(pool.state.transactions.filter(row => row.type === 'buy_in').length, 3);

    const retryMercy = await transactionManager.handleAutomaticBotMercyToken(pool, 100);
    assert.equal(retryMercy.granted, false);
    assert.equal(retryMercy.reason, 'hourly_limit');
    assert.equal(pool.state.transactions.filter(row => row.type === 'free_token_mercy').length, 1,
        'the separate pre-start and in-transaction checks can never double-grant within an hour');
}

function testProcessLocalBotSeatLeases() {
    const profiles = [{ id: 100, username: 'Mike Knight', tokens: 8, isBot: true }];
    const io = {
        sockets: { sockets: new Map() },
        to() { return { emit() {} }; },
        emit() {},
    };
    const service = createGameServiceWithoutHeartbeat(
        GameService,
        io,
        null,
        { botAccounts: profiles },
    );
    const first = service.engines['table-1'];
    const second = service.engines['table-2'];
    const third = service.engines['table-3'];
    const fourth = service.engines['table-4'];

    assert.equal(first.addBotPlayer().userId, 100);
    assert.equal(second.addBotPlayer(), undefined,
        'one persistent profile cannot occupy two live engines');
    assert.equal(service.botSeatLeases.size, 1);

    first.removeBotPlayer(100);
    assert.equal(second.addBotPlayer().userId, 100,
        'removeBotPlayer releases the profile for immediate reuse');
    second.leaveTable(100);
    assert.equal(service.botSeatLeases.size, 0,
        'a direct safe-state leave also releases its persistent lease');
    assert.equal(third.addBotPlayer().userId, 100);

    third.gameStarted = true;
    third.gameId = 777;
    third.state = 'Game Over';
    third.settlement = { status: 'complete', kind: 'normal' };
    third.reset();
    assert.equal(third.players[100]?.isBot, true,
        'ordinary rematches retain the bot seat and its lease');
    assert.equal(fourth.addBotPlayer(), undefined);

    const staleEngine = third;
    service.resetAllEngines();
    const replacementFirst = service.engines['table-1'];
    const replacementSecond = service.engines['table-2'];
    assert.equal(replacementFirst.addBotPlayer().userId, 100,
        'a full engine reset starts a clean lease generation');
    staleEngine.leaveTable(100);
    assert.equal(service.botSeatLeases.size, 1,
        'a stale discarded engine cannot release a replacement lease');
    assert.equal(replacementSecond.addBotPlayer(), undefined);
}

function testInsufficientPersistentBotCleanup() {
    const engine = new GameEngine(
        'funded-cleanup',
        'dans-deck',
        'Funded Cleanup',
        null,
        'private',
        [{ id: 100, username: 'Mike Knight', tokens: 0, isBot: true }],
    );
    engine.joinTable({ id: 1, username: 'Alice' }, 'socket-1', 30);
    engine.joinTable({ id: 2, username: 'Bob' }, 'socket-2', 30);
    engine.addBotPlayer();
    const effect = engine.startGame(1).effects.find(candidate => candidate.type === 'START_GAME_TRANSACTIONS');
    effect.onFailure(new Error('Mike Knight has insufficient tokens.'), 'Mike Knight');
    assert.equal(engine.players[100], undefined);
    assert.equal(engine.bots[100], undefined, 'failed starts cannot leave a stale acting bot');
    assert.equal(engine.playerOrder.includes(100), false);
}

function testPersistentBotsShareTheExactFundedPot() {
    const botWins = buildNormalGameSettlement(makeFundedTable(901, {
        Alice: 100,
        Bob: 50,
        'Mike Knight': 200,
    }));
    assert.equal(botWins.result.tokenSettlement.potCents, 300);
    assert.equal(botWins.payouts.reduce((sum, payout) => sum + payout.amountCents, 0), 300);
    assert.equal(botWins.payouts.find(payout => payout.userId === 100).amountCents, 200);
    assert.equal(botWins.stats.find(stat => stat.userId === 100).column, 'wins');
    assert.equal(
        botWins.result.tokenSettlement.entries.find(entry => entry.playerName === 'Mike Knight').funded,
        true,
    );
    assert.deepEqual(botWins.botUserIds, [100]);

    const draw = buildDrawSettlement(makeFundedTable(902), 'wash');
    assert.equal(draw.payouts.length, 3);
    assert.equal(draw.stats.find(stat => stat.userId === 100).column, 'washes');

    const forfeit = buildForfeitSettlement({
        ...makeFundedTable(903),
        forfeitingPlayerName: 'Mike Knight',
        reason: 'test',
    });
    assert.equal(forfeit.payouts.reduce((sum, payout) => sum + payout.amountCents, 0), 300);
    assert.equal(forfeit.stats.find(stat => stat.userId === 100).column, 'losses');
}

async function testPostSettlementBotMercy() {
    const pool = createLedgerPool({ balances: { 1: 9, 2: 9, 100: 4 }, recentBotMercy: 0 });
    const result = await transactionManager.handleNormalGameTransactions(
        pool,
        makeFundedTable(900),
    );
    assert.equal(result.alreadySettled, false);
    assert.equal(pool.state.balances.get(100), 5);
    assert.equal(pool.state.transactions.filter(row => row.type === 'free_token_mercy').length, 1);
    assert.equal(pool.state.stats.get(100), 'losses');

    const committedTransactionCount = pool.state.transactions.length;
    const committedStatUpdateCount = pool.state.statUpdateCount;
    const replay = await transactionManager.handleNormalGameTransactions(
        pool,
        makeFundedTable(900),
    );
    assert.equal(replay.alreadySettled, true);
    assert.equal(pool.state.transactions.length, committedTransactionCount,
        'settlement replay cannot duplicate a payout or bot mercy grant');
    assert.equal(pool.state.statUpdateCount, committedStatUpdateCount,
        'settlement replay cannot duplicate bot or human stats');
}

async function runFundedBotTests() {
    await testPersistentBotRosterAndAtomicStart();
    testProcessLocalBotSeatLeases();
    testInsufficientPersistentBotCleanup();
    testPersistentBotsShareTheExactFundedPot();
    await testPostSettlementBotMercy();
    console.log('Funded bot ledger and mercy tests passed.');
}

if (require.main === module) {
    runFundedBotTests().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = runFundedBotTests;
