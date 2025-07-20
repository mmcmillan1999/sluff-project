// backend/tests/Table.integration.test.js

const assert = require('assert');
const GameEngine = require('../src/core/GameEngine');
const GameService = require('../src/services/GameService');

// --- Mocks and Helpers ---
const mockIo = { to: () => ({ emit: () => {} }), emit: () => {}, sockets: { sockets: new Map() } };
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- The Test Case ---
async function testBotBiddingProcess() {
    console.log("Running Test: testBotBiddingProcess...");

    // 1. ARRANGE
    const gameService = new GameService(mockIo, null);
    const engine = gameService.getEngineById('table-1');
    const humanId = 101;
    
    // Players join in a specific, predictable order
    engine.joinTable({ id: humanId, username: "HumanPlayer" }, "socket123");
    engine.addBotPlayer(); // Bot 1 (ID: -1)
    engine.addBotPlayer(); // Bot 2 (ID: -2)
    
    // Verify the initial join order is preserved
    assert.deepStrictEqual(engine.playerOrder.allIds, [humanId, -1, -2], "Initial join order is incorrect");

    // Manually simulate a successful game start
    engine.gameStarted = true;
    engine.gameId = 1;
    engine.playerMode = 3;
    engine.dealer = humanId; // Human is the dealer
    engine.playerOrder.setTurnOrder(engine.dealer); // The engine now correctly calculates the turn order
    engine.state = "Dealing Pending";
    
    // After setting the dealer, the turn order should rotate
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

async function runAllTests() {
    try {
        await testBotBiddingProcess();
    } catch (error) {
        console.error("❌ A test failed:", error);
        process.exit(1);
    }
}

runAllTests();