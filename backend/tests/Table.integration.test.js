const assert = require('assert');
const Table = require('../src/core/Table');

// --- Mocks and Helpers ---

// A mock socket.io server object to capture emissions
const mockIo = {
    lastEmit: null,
    to: function(tableId) {
        return {
            emit: (event, data) => {
                this.lastEmit = { event, data };
                // console.log(`Mock IO emitted to ${tableId}: ${event}`);
            }
        };
    }
};

// A helper to pause execution, allowing async bot actions to complete
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- The Test Case ---

async function testFrogUpgradeScenario() {
    console.log("Running: testFrogUpgradeScenario...");

    // 1. ARRANGE: Set up the game state
    const table = new Table('test-table-1', 'fort-creek', 'Test Table', mockIo, null, () => {});
    
    // Add players: one bot, one human
    table.addBotPlayer(); // Bot gets ID -1, Name "Mike Knight"
    await table.joinTable({ id: 101, username: "HumanPlayer" }, "socket123");
    
    // Ensure we have exactly two players for this test
    assert.strictEqual(Object.keys(table.players).length, 2, "Should have 2 players");
    
    // Start the game. Since it's random, we find out who the dealer is.
    await table.startGame(101); // Human starts the game
    table.dealCards(table.dealer);

    // Identify who is who in the turn order
    const botId = table.playerOrderActive.find(id => id < 0);
    const humanId = table.playerOrderActive.find(id => id > 0);
    const botPlayer = table.players[botId];
    const humanPlayer = table.players[humanId];

    // Make sure the bidding starts with the first player in order
    assert.strictEqual(table.state, "Bidding Phase", "Game should be in Bidding Phase");
    const firstBidderId = table.biddingTurnPlayerId;
    const secondBidderId = table.playerOrderActive.find(id => id !== firstBidderId);

    // 2. ACT: Perform the sequence of bids that causes the bug
    console.log(`  - ${table.players[firstBidderId].playerName} bids Frog...`);
    table.placeBid(firstBidderId, "Frog"); // First player bids Frog

    console.log(`  - ${table.players[secondBidderId].playerName} bids Solo...`);
    table.placeBid(secondBidderId, "Solo"); // Second player bids Solo
    
    // The game state should now be waiting for the original Frog bidder
    assert.strictEqual(table.state, "Awaiting Frog Upgrade Decision", "State should be Awaiting Frog Upgrade Decision");
    assert.strictEqual(table.biddingTurnPlayerId, firstBidderId, "Turn should return to the original Frog bidder");

    console.log(`  - Waiting for ${botPlayer.playerName} to automatically pass...`);
    await sleep(1200); // Wait for the bot's timeout to fire

    // 3. ASSERT: Check the final state
    assert.strictEqual(table.state, "Trump Selection", "Game should have proceeded to Trump Selection");
    assert.strictEqual(table.bidWinnerInfo.userId, secondBidderId, "The Solo bidder should be the winner");
    assert.strictEqual(table.bidWinnerInfo.bid, "Solo", "The winning bid should be Solo");
    
    console.log("...Success!\n");
}


// --- Test Runner ---
async function runAllTests() {
    try {
        await testFrogUpgradeScenario();
        console.log("✅ All Table integration tests passed!");
    } catch (error) {
        console.error("❌ A test failed:", error);
        process.exit(1); // Exit with an error code
    }
}

runAllTests();