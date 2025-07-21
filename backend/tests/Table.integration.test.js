// backend/tests/Table.integration.test.js

const assert = require('assert');
const GameEngine = require('../src/core/GameEngine');
const GameService = require('../src/services/GameService');
const PlayerList = require('../src/core/PlayerList'); // We need this for one of the tests

// --- Mocks and Helpers ---
const mockIo = { to: () => ({ emit: () => {} }), emit: () => {}, sockets: { sockets: new Map() } };

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

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- Test Cases ---

async function testBotBiddingProcess() {
    console.log("Running Test: testBotBiddingProcess...");

    // 1. ARRANGE
    const gameService = new GameService(mockIo, null);
    const engine = gameService.getEngineById('table-1');
    const humanId = 101;
    
    engine.joinTable({ id: humanId, username: "HumanPlayer" }, "socket123");
    engine.addBotPlayer(); // Bot 1 (ID: -1)
    engine.addBotPlayer(); // Bot 2 (ID: -2)
    
    // Manually set the game state for a predictable test
    engine.gameStarted = true;
    engine.gameId = 1;
    engine.playerMode = 3;
    engine.dealer = humanId;
    engine.playerOrder.setTurnOrder(engine.dealer); // This sets turn order to [-1, -2, 101]
    engine.state = "Dealing Pending";
    
    const firstBidderId = engine.playerOrder.turnOrder[0];
    
    // 2. ACT
    console.log(`  - Human (dealer) deals cards...`);
    await gameService.dealCards('table-1', humanId);
    
    assert.strictEqual(engine.state, "Bidding Phase", "After dealing, state should be Bidding Phase.");
    assert.strictEqual(engine.biddingTurnPlayerId, firstBidderId, `Turn should belong to the first bidder (ID: ${firstBidderId}).`);

    console.log("  - Waiting for bot to make a bid...");
    await sleep(1500);

    // 3. ASSERT
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

    assert.strictEqual(engine.state, "AllPassWidowReveal", "State should be AllPassWidowReveal after all players pass.");
    assert.strictEqual(mockTimer.callbacks.length, 1, "A timer should have been set for the widow reveal.");
    assert.ok(mockTimer.duration >= 1000 && mockTimer.duration <= 6000, `Widow reveal duration (${mockTimer.duration}ms) is out of bounds (1-6s).`);

    console.log(`  - Advancing mock timer by ${mockTimer.duration}ms...`);
    await mockTimer.tick();

    assert.strictEqual(engine.state, "Dealing Pending", "State should be Dealing Pending after the widow reveal timer.");
    assert.strictEqual(engine.dealer, 1, "The dealer should have advanced to the next player (Player A).");

    console.log("...Success! All-pass scenario works correctly.\n");
}

async function testBotHandlesFrogUpgrade() {
    console.log("Running Test: testBotHandlesFrogUpgrade...");

    const gameService = new GameService(mockIo, null);
    const engine = gameService.getEngineById('table-1');
    const humanId = 101;
    
    engine.addBotPlayer(); // Bot 1 (ID: -1, will bid Frog)
    engine.joinTable({ id: humanId, username: "HumanPlayer" }, "socket123");
    engine.addBotPlayer(); // Bot 2 (ID: -2, will bid Solo)

    engine.gameStarted = true; engine.gameId = 1; engine.playerMode = 3;
    engine.dealer = -2;
    engine.playerOrder.setTurnOrder(engine.dealer);
    engine.state = "Dealing Pending";
    await gameService.dealCards('table-1', -2);

    console.log("  - Bot 1 bids Frog, Human passes, Bot 2 bids Solo...");
    await gameService.placeBid('table-1', -1, "Frog");
    await gameService.placeBid('table-1', humanId, "Pass");
    await gameService.placeBid('table-1', -2, "Solo");

    assert.strictEqual(engine.state, "Awaiting Frog Upgrade Decision", "State should be waiting for the original frog bidder.");
    assert.strictEqual(engine.biddingTurnPlayerId, -1, "Turn should return to Bot 1 to decide on upgrading.");

    console.log("  - Waiting for Bot 1 to pass on the upgrade...");
    await sleep(1500);

    assert.strictEqual(engine.state, "Trump Selection", "State should advance to Trump Selection after the bot passes.");
    assert.strictEqual(engine.bidWinnerInfo.userId, -2, "The final bid winner should be Bot 2.");
    assert.strictEqual(engine.bidWinnerInfo.bid, "Solo", "The winning bid should be Solo.");

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