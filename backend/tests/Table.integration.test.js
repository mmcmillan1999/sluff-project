// backend/tests/Table.integration.test.js

const assert = require('assert');
const GameEngine = require('../src/core/GameEngine');
const GameService = require('../src/services/GameService');

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
    
    assert.deepStrictEqual(engine.playerOrder.allIds, [humanId, -1, -2], "Initial join order is incorrect");

    engine.gameStarted = true;
    engine.gameId = 1;
    engine.playerMode = 3;
    engine.dealer = humanId;
    engine.playerOrder.setTurnOrder(engine.dealer);
    engine.state = "Dealing Pending";
    
    const firstBidderId = engine.playerOrder.turnOrder[0];
    assert.strictEqual(firstBidderId, -1, "The first bidder after the dealer should be Bot 1 (ID: -1)");
    
    // 2. ACT
    console.log(`  - Human (dealer) deals cards...`);
    await gameService.dealCards('table-1', humanId);
    
    // 3. ASSERT (Immediate)
    assert.strictEqual(engine.state, "Bidding Phase", "After dealing, state should be Bidding Phase.");
    assert.strictEqual(engine.biddingTurnPlayerId, firstBidderId, `Turn should belong to the first bidder (ID: ${firstBidderId}).`);

    console.log("  - Waiting for bot to make a bid...");
    await sleep(1500);

    // 4. ASSERT (After Delay)
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

// --- Test Runner ---
async function runAllTests() {
    try {
        await testBotBiddingProcess();
        await testAllPlayersPass();
        await testBotHandlesFrogUpgrade();
    } catch (error) {
        console.error("❌ A test failed:", error);
        throw error;
    }
}

if (require.main === module) {
    runAllTests().catch(() => process.exit(1));
}

module.exports = runAllTests;