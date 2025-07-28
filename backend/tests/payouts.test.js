// backend/tests/payouts.test.js

const assert = require('assert');
const GameEngine = require('../src/core/GameEngine');
const GameService = require('../src/services/GameService');

// --- Mocks and Helpers ---
const mockIo = { to: () => ({ emit: () => {} }), emit: () => {}, sockets: { sockets: new Map() } };

class MockPool {
    constructor() {
        this.queries = [];
    }
    async connect() {
        return {
            query: (text, params) => this.query(text, params),
            release: () => {}
        };
    }
    query(text, params) {
        this.queries.push({ text, params });
        if (text.includes('INSERT INTO transactions')) {
            return Promise.resolve({ rows: [{ transaction_id: 1 }], rowCount: 1 });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
    }
    reset() {
        this.queries = [];
    }
}

async function testGameOverPayouts() {
    console.log("Running Test Suite: testGameOverPayouts...");

    const mockPool = new MockPool();
    const gameService = new GameService(mockIo, mockPool);
    
    const createGameOverPayload = (humanScores, botCount = 0) => {
        const engine = new GameEngine('payout-test', 'fort-creek', 'Payout Test');
        let userId = 101;
        for (const [name, score] of Object.entries(humanScores)) {
            engine.joinTable({ id: userId, username: name }, `s${userId}`);
            engine.scores[name] = score;
            userId++;
        }
        for (let i = 0; i < botCount; i++) {
            engine.addBotPlayer();
            // Set bot score to 0 (they lost)
            const botNames = Object.values(engine.players).filter(p => p.isBot).map(p => p.playerName);
            if (botNames[i]) {
                engine.scores[botNames[i]] = 0;
            }
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
        
        if (statUpdates.length !== expected.stats) {
            console.log(`  - Debug: ${description}`);
            console.log(`    Expected ${expected.stats} stat updates, but found ${statUpdates.length}`);
            console.log(`    Stat update queries:`);
            statUpdates.forEach((q, i) => console.log(`      ${i+1}: ${q.text.substring(0, 100)}...`));
        }
        
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
    let payload2H1B_Win = createGameOverPayload({ 'P1': 100, 'P2': 50 }, 1);
    await gameService.handleGameOver(payload2H1B_Win);
    verifyQueries("2 Humans, 1 Bot (Win/Loss)", { transactions: 2, stats: 2 });

    mockPool.reset();
    let payload2H1B_Tie = createGameOverPayload({ 'P1': 100, 'P2': 100 }, 1);
    console.log("  - Testing 2 Humans, 1 Bot (Tie) scenario...");
    await gameService.handleGameOver(payload2H1B_Tie);
    verifyQueries("2 Humans, 1 Bot (Tie)", { transactions: 2, stats: 2 });

    // --- SCENARIO: 1 HUMAN, 2 BOTS ---
    mockPool.reset();
    let payload1H2B_Win = createGameOverPayload({ 'P1': 100 }, 2);
    await gameService.handleGameOver(payload1H2B_Win);
    verifyQueries("1 Human, 2 Bots (Win)", { transactions: 1, stats: 1 });
    
    console.log("...Success! All payout scenarios are correctly handled.\n");
}

if (require.main === module) {
    testGameOverPayouts().catch(e => {
        console.error(e);
        process.exit(1);
    });
}

module.exports = testGameOverPayouts;