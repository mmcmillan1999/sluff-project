// backend/tests/Table.integration.test.js

const assert = require('assert');
const GameEngine = require('../src/core/GameEngine');
const GameService = require('../src/services/GameService');
const gameLogic = require('../src/core/logic'); // Import gameLogic for the mock service
const PlayerList = require('../src/core/PlayerList');

// --- Mocks and Helpers ---
const mockIo = { to: () => ({ emit: () => {} }), emit: () => {}, sockets: { sockets: new Map() } };
const mockPool = { query: () => Promise.resolve() }; // A mock pool for stat updates

class MockTimer {
    constructor() {
        this.callbacks = [];
        this.duration = 0;
    }
    mockSetTimeout(callback, duration) {
        this.callbacks.push(callback);
        this.duration = duration;
    }
    async tick() {
        while(this.callbacks.length > 0) {
            const cb = this.callbacks.shift();
            await cb();
        }
    }
}

// --- NEW MOCK SERVICE TO HANDLE ASYNC EFFECTS ---
class MockEffectProcessor {
    constructor() {
        this.pool = mockPool;
    }

    async processEffects(engine, effects) {
        if (!effects || !effects.length) return;
        for (const effect of effects) {
            switch (effect.type) {
                case 'HANDLE_DRAW_OUTCOME':
                    const summary = await gameLogic.handleDrawGameOver(
                        {...effect.payload, pool: this.pool},
                        effect.payload.outcome,
                        () => Promise.resolve(), // Mock transaction function
                        () => Promise.resolve()  // Mock stat update function
                    );
                    if (effect.onComplete) {
                        effect.onComplete(summary);
                    }
                    break;
                // Add other effect types here if needed for future tests
            }
        }
    }
}
// --- END NEW MOCK SERVICE ---

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- Test Cases ---

async function testBotBiddingProcess() {
    console.log("Running Test: testBotBiddingProcess...");
    const gameService = new GameService(mockIo, null);
    const engine = gameService.getEngineById('table-1');
    const humanId = 101;
    engine.joinTable({ id: humanId, username: "HumanPlayer" }, "socket123");
    engine.addBotPlayer();
    engine.addBotPlayer();
    engine.gameStarted = true; engine.gameId = 1; engine.playerMode = 3;
    engine.dealer = humanId;
    engine.playerOrder.setTurnOrder(engine.dealer);
    engine.state = "Dealing Pending";
    const firstBidderId = engine.playerOrder.turnOrder[0];
    console.log(`  - Human (dealer) deals cards...`);
    await gameService.dealCards('table-1', humanId);
    assert.strictEqual(engine.state, "Bidding Phase");
    assert.strictEqual(engine.biddingTurnPlayerId, firstBidderId);
    console.log("  - Waiting for bot to make a bid...");
    await sleep(1500);
    const bidsMade = engine.playersWhoPassedThisRound.length + (engine.currentHighestBidDetails ? 1 : 0);
    assert.strictEqual(bidsMade, 1, "Expected exactly one bid to have been made by the bot.");
    console.log("...Success! Bot bidding was triggered correctly.\n");
}

async function testAllPlayersPass() {
    console.log("Running Test: testAllPlayersPass...");
    const mockTimer = new MockTimer();
    const gameService = new GameService(mockIo, null);
    gameService.timerOverride = mockTimer.mockSetTimeout.bind(mockTimer);
    const engine = gameService.getEngineById('table-1');
    engine.joinTable({ id: 1, username: "Player A" }, "s1");
    engine.joinTable({ id: 2, username: "Player B" }, "s2");
    engine.joinTable({ id: 3, username: "Player C" }, "s3");
    engine.gameStarted = true; engine.gameId = 1; engine.playerMode = 3;
    engine.dealer = 3;
    engine.playerOrder.setTurnOrder(engine.dealer);
    engine.state = "Dealing Pending";
    await gameService.dealCards('table-1', 3);
    console.log("  - All players pass...");
    await gameService.placeBid('table-1', 1, "Pass");
    await gameService.placeBid('table-1', 2, "Pass");
    await gameService.placeBid('table-1', 3, "Pass");
    assert.strictEqual(engine.state, "AllPassWidowReveal");
    assert.strictEqual(mockTimer.callbacks.length, 1);
    console.log(`  - Advancing mock timer by ${mockTimer.duration}ms...`);
    await mockTimer.tick();
    assert.strictEqual(engine.state, "Dealing Pending");
    assert.strictEqual(engine.dealer, 1);
    console.log("...Success! All-pass scenario works correctly.\n");
}

async function testBotHandlesFrogUpgrade() {
    console.log("Running Test: testBotHandlesFrogUpgrade...");
    const gameService = new GameService(mockIo, null);
    const engine = gameService.getEngineById('table-1');
    const humanId = 101;
    engine.addBotPlayer();
    engine.joinTable({ id: humanId, username: "HumanPlayer" }, "socket123");
    engine.addBotPlayer();
    engine.gameStarted = true; engine.gameId = 1; engine.playerMode = 3;
    engine.dealer = -2;
    engine.playerOrder.setTurnOrder(engine.dealer);
    engine.state = "Dealing Pending";
    await gameService.dealCards('table-1', -2);
    console.log("  - Bot 1 bids Frog, Human passes, Bot 2 bids Solo...");
    await gameService.placeBid('table-1', -1, "Frog");
    await gameService.placeBid('table-1', humanId, "Pass");
    await gameService.placeBid('table-1', -2, "Solo");
    assert.strictEqual(engine.state, "Awaiting Frog Upgrade Decision");
    assert.strictEqual(engine.biddingTurnPlayerId, -1);
    console.log("  - Waiting for Bot 1 to pass on the upgrade...");
    await sleep(1500);
    assert.strictEqual(engine.state, "Trump Selection");
    assert.strictEqual(engine.bidWinnerInfo.userId, -2);
    assert.strictEqual(engine.bidWinnerInfo.bid, "Solo");
    console.log("...Success! Bot correctly handled the frog upgrade scenario.\n");
}

// --- NEW TEST SUITE FOR DRAW VOTING ---
async function testDrawRequestLifecycle() {
    console.log("Running Test: testDrawRequestLifecycle...");

    const setupEngineForDraw = () => {
        const engine = new GameEngine('table-draw-test', 'fort-creek', 'Draw Test Table');
        engine.joinTable({ id: 1, username: "P1" }, "s1");
        engine.joinTable({ id: 2, username: "P2" }, "s2");
        engine.joinTable({ id: 3, username: "P3" }, "s3");
        engine.gameStarted = true;
        engine.playerMode = 3;
        engine.state = "Playing Phase";
        return engine;
    };

    // Test Case 1: A 'no' vote cancels the draw.
    let engine = setupEngineForDraw();
    engine.requestDraw(1); // P1 requests draw
    assert.strictEqual(engine.drawRequest.isActive, true, "Draw request should be active after initiation.");
    engine.submitDrawVote(2, 'no'); // P2 votes no
    assert.strictEqual(engine.drawRequest.isActive, false, "Draw request should be inactive after a 'no' vote.");
    assert.strictEqual(engine.state, "Playing Phase", "Game state should remain 'Playing Phase' after a 'no' vote.");
    console.log("  - Passed: 'No' vote correctly cancels draw.");

    // Test Case 2: A unanimous 'wash' vote ends the game.
    engine = setupEngineForDraw();
    engine.requestDraw(1); // P1 requests draw (auto-votes 'wash')
    engine.submitDrawVote(2, 'wash');
    engine.submitDrawVote(3, 'wash');
    assert.strictEqual(engine.drawRequest.isActive, false, "Draw request should be inactive after all votes.");
    assert.strictEqual(engine.state, "Game Over", "Game state should be 'Game Over' after unanimous vote.");
    console.log("  - Passed: Unanimous 'wash' vote ends the game.");

    // Test Case 3: A mixed 'split'/'wash' vote ends the game.
    engine = setupEngineForDraw();
    engine.requestDraw(1); // P1 requests draw (auto-votes 'wash')
    engine.submitDrawVote(2, 'split');
    engine.submitDrawVote(3, 'split');
    assert.strictEqual(engine.state, "Game Over", "Game state should be 'Game Over' after mixed positive vote.");
    console.log("  - Passed: Mixed 'split'/'wash' vote ends the game.");

    console.log("...Success! Draw request lifecycle works correctly.\n");
}

// --- Test Runner ---
async function runAllTests() {
    try {
        await testBotBiddingProcess();
        await testAllPlayersPass();
        await testBotHandlesFrogUpgrade();
        await testDrawRequestLifecycle(); // Added new test suite
    } catch (error) {
        console.error("â Œ A test failed:", error);
        throw error;
    }
}

if (require.main === module) {
    runAllTests().catch(() => process.exit(1));
}

module.exports = runAllTests;