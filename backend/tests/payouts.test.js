// backend/tests/payouts.test.js

const assert = require('assert');
const GameEngine = require('../src/core/GameEngine');
const GameService = require('../src/services/GameService');
const { createGameServiceWithoutHeartbeat } = require('./test-helpers');

// --- Mocks and Helpers ---
const mockIo = { to: () => ({ emit: () => {} }), emit: () => {}, sockets: { sockets: new Map() } };

class MockPool {
    constructor() {
        this.queries = [];
    }
    query(text, params) {
        this.queries.push({ text, params });
        if (text.includes('SELECT outcome FROM game_history')) {
            return Promise.resolve({ rows: [{ outcome: 'In Progress' }], rowCount: 1 });
        }
        if (text.includes('SELECT id FROM users') && text.includes('FOR UPDATE')) {
            return Promise.resolve({ rows: (params[0] || []).map(id => ({ id })), rowCount: params[0]?.length || 0 });
        }
        if (text.includes('INSERT INTO transactions')) {
            return Promise.resolve({ rows: [{ transaction_id: 1 }], rowCount: 1 });
        }
        if (text.includes('UPDATE game_history')) {
            return Promise.resolve({ rows: [], rowCount: 1 });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
    }
    async connect() {
        return {
            query: this.query.bind(this),
            release() {},
        };
    }
    reset() {
        this.queries = [];
    }
}

async function testGameOverPayouts() {
    console.log("Running Test Suite: testGameOverPayouts...");

    const mockPool = new MockPool();
    const gameService = createGameServiceWithoutHeartbeat(GameService, mockIo, mockPool);
    
    const createGameOverPayload = (humanScores, botScores = []) => {
        const engine = new GameEngine('payout-test', 'fort-creek', 'Payout Test');
        let userId = 101;
        for (const [name, score] of Object.entries(humanScores)) {
            engine.joinTable({ id: userId, username: name }, `s${userId}`);
            engine.scores[name] = score;
            userId++;
        }
        for (const score of botScores) {
            const existingPlayerIds = new Set(Object.keys(engine.players));
            engine.addBotPlayer();
            const bot = Object.entries(engine.players)
                .find(([id, player]) => player.isBot && !existingPlayerIds.has(id))?.[1];
            assert.ok(bot, 'Expected addBotPlayer to add a bot.');
            engine.scores[bot.playerName] = score;
        }
        engine.gameId = 123;
        engine.playerOrder.setTurnOrder(Object.values(engine.players)[0].userId);
        
        return {
            scores: engine.scores,
            theme: engine.theme,
            gameId: engine.gameId,
            players: engine.players,
            playerOrderActive: engine.playerOrder.allIds,
        };
    };

    const verifyQueries = (description, expected) => {
        const transactions = mockPool.queries.filter(q => q.text.includes('INSERT INTO transactions'));
        const statUpdates = mockPool.queries.filter(q => q.text.includes('UPDATE users'));
        
        assert.strictEqual(transactions.length, expected.transactions, `${description}: Expected ${expected.transactions} transaction(s), but found ${transactions.length}`);
        assert.strictEqual(statUpdates.length, expected.stats, `${description}: Expected ${expected.stats} stat update(s), but found ${statUpdates.length}`);
        console.log(`  - Passed: ${description}`);
    };

    // --- SCENARIO: 3 HUMANS ---
    mockPool.reset();
    let payload3H_Win = createGameOverPayload({ 'P1': 100, 'P2': 50, 'P3': 0 });
    await gameService.handleGameOver(payload3H_Win);
    verifyQueries("3 Humans (Win/Wash/Loss)", { transactions: 2, stats: 3 });

    mockPool.reset();
    let payload3H_Tie1st = createGameOverPayload({ 'P1': 100, 'P2': 100, 'P3': 0 });
    await gameService.handleGameOver(payload3H_Tie1st);
    verifyQueries("3 Humans (Tie for 1st)", { transactions: 2, stats: 3 });
    
    // --- THIS IS THE FAILING TEST ---
    // Re-enabled to prove the logic is missing for bot games.
    
    // --- SCENARIO: 2 HUMANS, 1 BOT ---
    mockPool.reset();
    let payload2H1B_Win = createGameOverPayload({ 'P1': 100, 'P2': 50 }, [120]);
    await gameService.handleGameOver(payload2H1B_Win);
    verifyQueries("2 Humans, 1 Bot (Bot win / Human wash-loss)", { transactions: 1, stats: 2 });

    mockPool.reset();
    let payload2H1B_Tie = createGameOverPayload({ 'P1': 100, 'P2': 100 }, [50]);
    await gameService.handleGameOver(payload2H1B_Tie);
    verifyQueries("2 Humans, 1 Bot (Humans tie for first)", { transactions: 2, stats: 2 });

    // --- SCENARIO: 1 HUMAN, 2 BOTS ---
    mockPool.reset();
    let payload1H2B_Win = createGameOverPayload({ 'P1': 100 }, [50, 0]);
    await gameService.handleGameOver(payload1H2B_Win);
    verifyQueries("1 Human, 2 Bots (Win)", { transactions: 1, stats: 1 });
    
    console.log("...Success! All payout scenarios are correctly handled.\n");
}

if (require.main === module) {
    testGameOverPayouts().catch(e => {
        console.error(e);
        process.exitCode = 1;
    });
}

module.exports = testGameOverPayouts;
