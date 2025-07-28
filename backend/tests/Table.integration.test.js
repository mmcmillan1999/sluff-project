// backend/tests/Table.integration.test.js

const assert = require('assert');
const GameEngine = require('../src/core/GameEngine');
const GameService = require('../src/services/GameService');
const gameLogic = require('../src/core/logic'); 
const PlayerList = require('../src/core/PlayerList');

// --- Mocks and Helpers ---
const mockIo = { to: () => ({ emit: () => {} }), emit: () => {}, sockets: { sockets: new Map() } };

class MockPool {
    constructor() { this.queries = []; }
    query(text, params) { this.queries.push({ text, params }); return Promise.resolve({ rows: [], rowCount: 0 }); }
    reset() { this.queries = []; }
}

class MockEffectProcessor {
    constructor(pool) { this.pool = pool || new MockPool(); }
    async processEffects(engine, effects) {
        if (!effects || !effects.length) return;
        for (const effect of effects) {
            if (effect.type === 'HANDLE_DRAW_OUTCOME') {
                const summary = await gameLogic.handleDrawGameOver(
                    {...effect.payload, pool: this.pool},
                    effect.payload.outcome,
                    () => Promise.resolve(),
                    () => Promise.resolve()
                );
                if (effect.onComplete) effect.onComplete(summary);
            }
        }
    }
}

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
    console.log(`  - Turn order: ${engine.playerOrder.turnOrder}`);
    console.log(`  - First bidder ID: ${firstBidderId}, is bot: ${firstBidderId < 0}`);
    console.log(`  - Human (dealer) deals cards...`);
    await gameService.dealCards('table-1', humanId);
    assert.strictEqual(engine.state, "Bidding Phase");
    assert.strictEqual(engine.biddingTurnPlayerId, firstBidderId);
    console.log(`  - Current bidding turn player: ${engine.biddingTurnPlayerId}`);
    console.log(`  - Bot IDs: ${Object.keys(engine.bots)}`);
    
    // Check bot's hand
    const botPlayer = engine.players[engine.biddingTurnPlayerId];
    const botHand = engine.hands[botPlayer.playerName];
    console.log(`  - Bot player name: ${botPlayer.playerName}`);
    console.log(`  - Bot hand length: ${botHand ? botHand.length : 'undefined'}`);
    
    console.log("  - Waiting for bot to make a bid...");
    
    // Manually trigger the bot action since the interval might not fire reliably in tests
    gameService._triggerBots('table-1');
    
    // Give the bot action time to complete (2000ms for Courtney Sr. + buffer)
    await sleep(2500);
    
    const bidsMade = engine.playersWhoPassedThisRound.length + (engine.currentHighestBidDetails ? 1 : 0);
    console.log(`  - Players who passed: ${engine.playersWhoPassedThisRound.length}`);
    console.log(`  - Current highest bid: ${engine.currentHighestBidDetails ? 'Yes' : 'No'}`);
    assert.strictEqual(bidsMade, 1, "Expected exactly one bid to have been made by the bot.");
    console.log("...Success! Bot bidding was triggered correctly.\n");
}

async function testAllPlayersPass() {
    console.log("Running Test: testAllPlayersPass...");
    const mockTimer = new (class {
        constructor() { this.callbacks = []; this.duration = 0; }
        mockSetTimeout(callback, duration) { this.callbacks.push(callback); this.duration = duration; }
        async tick() { while(this.callbacks.length > 0) { const cb = this.callbacks.shift(); await cb(); } }
    })();
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
    const bot1Id = -1;
    const bot2Id = -2;
    engine.addBotPlayer();
    engine.joinTable({ id: humanId, username: "HumanPlayer" }, "socket123");
    engine.addBotPlayer();
    engine.gameStarted = true; engine.gameId = 1; engine.playerMode = 3;
    engine.dealer = bot2Id;
    engine.playerOrder.setTurnOrder(engine.dealer);
    engine.state = "Dealing Pending";
    await gameService.dealCards('table-1', -2);
    console.log("  - Bot 1 bids Frog, Human passes, Bot 2 bids Solo...");
    
    // Manually set up the desired bidding scenario
    // Bot1 bids Frog
    engine.currentHighestBidDetails = { userId: bot1Id, playerName: engine.players[bot1Id].playerName, bid: "Frog" };
    engine.originalFrogBidderId = bot1Id;
    
    // Human passes
    engine.playersWhoPassedThisRound.push(humanId);
    
    // Bot2 bids Solo (outbids the Frog)
    engine.currentHighestBidDetails = { userId: bot2Id, playerName: engine.players[bot2Id].playerName, bid: "Solo" };
    
    // Now only the Frog bidder (bot1) is left to decide on upgrade
    engine.state = "Awaiting Frog Upgrade Decision";
    engine.biddingTurnPlayerId = bot1Id;
    
    assert.strictEqual(engine.state, "Awaiting Frog Upgrade Decision");
    assert.strictEqual(engine.biddingTurnPlayerId, bot1Id);
    console.log("  - Simulating Bot 1's action on the upgrade...");
    
    // Trigger bot to make its decision
    gameService._triggerBots('table-1');
    await sleep(2500);
    
    console.log(`  - State after bot decision: ${engine.state}`);
    console.log(`  - Bid winner: ${engine.bidWinnerInfo?.userId}, bid: ${engine.bidWinnerInfo?.bid}`);
    
    // The bot might choose Heart Solo or Pass - both are valid
    if (engine.bidWinnerInfo?.bid === "Heart Solo") {
        // Bot upgraded to Heart Solo, so we should be in Playing Phase
        assert.strictEqual(engine.state, "Playing Phase");
        assert.strictEqual(engine.bidWinnerInfo.userId, bot1Id);
        assert.strictEqual(engine.bidWinnerInfo.bid, "Heart Solo");
    } else {
        // Bot passed, so Bot2's Solo wins
        assert.strictEqual(engine.state, "Trump Selection");
        assert.strictEqual(engine.bidWinnerInfo.userId, bot2Id);
        assert.strictEqual(engine.bidWinnerInfo.bid, "Solo");
    }
    console.log("...Success! Bot correctly handled the frog upgrade scenario.\n");
}

// --- NEW TEST SUITE FOR DRAW VOTING ---
async function testDrawRequestLifecycle() {
    console.log("Running Test: testDrawRequestLifecycle...");
    const effectProcessor = new MockEffectProcessor();

    const setupEngineForDraw = () => {
        const engine = new GameEngine('table-draw-test', 'fort-creek', 'Draw Test Table');
        engine.joinTable({ id: 1, username: "P1" }, "s1");
        engine.joinTable({ id: 2, username: "P2" }, "s2");
        engine.joinTable({ id: 3, username: "P3" }, "s3");
        engine.gameStarted = true; engine.gameId = 1;
        engine.playerMode = 3;
        engine.state = "Playing Phase";
        return engine;
    };

    let engine = setupEngineForDraw();
    engine.requestDraw(1);
    assert.strictEqual(engine.drawRequest.isActive, true, "Draw request should be active after initiation.");
    engine.submitDrawVote(2, 'no');
    assert.strictEqual(engine.drawRequest.isActive, false, "Draw request should be inactive after a 'no' vote.");
    assert.strictEqual(engine.state, "DrawDeclined", "Game state should be 'DrawDeclined' immediately after a 'no' vote.");
    console.log("  - Passed: 'No' vote correctly cancels draw.");

    engine = setupEngineForDraw();
    engine.requestDraw(1); // P1 requests draw (auto-votes 'wash')
    engine.submitDrawVote(2, 'wash');
    const finalVoteResult = engine.submitDrawVote(3, 'wash');
    await effectProcessor.processEffects(engine, finalVoteResult.effects); // Process the async effect
    assert.strictEqual(engine.drawRequest.isActive, false, "Draw request should be inactive after all votes.");
    assert.strictEqual(engine.state, "DrawComplete", "Game state should be 'DrawComplete' after unanimous vote.");
    console.log("  - Passed: Unanimous 'wash' vote ends the game.");

    engine = setupEngineForDraw();
    engine.requestDraw(1); // P1 requests draw (auto-votes 'wash')
    engine.submitDrawVote(2, 'split');
    const mixedVoteResult = engine.submitDrawVote(3, 'split');
    await effectProcessor.processEffects(engine, mixedVoteResult.effects); // Process the async effect
    assert.strictEqual(engine.state, "DrawComplete", "Game state should be 'DrawComplete' after mixed positive vote.");
    console.log("  - Passed: Mixed 'split'/'wash' vote ends the game.");
    console.log("...Success! Draw request lifecycle works correctly.\n");
}

async function testGameOverPayouts() { /* ... unchanged, but should be uncommented in runAllTests ... */ }

async function testWidowAssignmentLogic() {
    console.log("Running Test Suite: testWidowAssignmentLogic...");

    // This is a mock GameService that allows us to intercept and manually process effects.
    const mockGameService = {
        _executeEffects: async (engine, effects) => {
            // A simplified effect processor for this test
            for (const effect of effects) {
                if (effect.type === 'HANDLE_GAME_OVER') {
                    if (effect.onComplete) effect.onComplete("Test Winner");
                }
            }
        },
        playCard: async function(engine, userId, card) {
            const effects = engine.playCard(userId, card).effects;
            await this._executeEffects(engine, effects);
        }
    };

    const setupEngineForLastTrick = (bidType) => {
        const engine = new GameEngine('widow-test', 'fort-creek', 'Widow Test');
        engine.joinTable({ id: 101, username: "Bidder" }, "s1");
        engine.joinTable({ id: 102, username: "Defender1" }, "s2");
        engine.joinTable({ id: 103, username: "Defender2" }, "s3");
        
        engine.gameStarted = true; engine.playerMode = 3;
        engine.state = "Playing Phase"; engine.tricksPlayedCount = 10;
        engine.trumpSuit = 'H';
        engine.originalDealtWidow = ['AH', '10H']; // 21 points
        engine.bidderCardPoints = 50;
        engine.defenderCardPoints = 30;
        engine.bidWinnerInfo = { userId: 101, playerName: "Bidder", bid: bidType };
        engine.playerOrder.setTurnOrder(102);
        
        // Setup the last trick so only the bidder has a card left
        engine.leadSuitCurrentTrick = 'S';
        engine.currentTrickCards = [
            { userId: 102, playerName: "Defender1", card: '6S' }, // Worth 0 pts
            { userId: 103, playerName: "Defender2", card: '7S' }, // Worth 0 pts
        ];
        engine.hands = { "Bidder": ['AS'], "Defender1": [], "Defender2": [] }; // Ace of Spades is worth 11 pts
        engine.trickTurnPlayerId = 101;

        return engine;
    };

    // Test Case 1: Bidder wins last trick
    let engine1 = setupEngineForLastTrick("Solo");
    await mockGameService.playCard(engine1, 101, 'AS');
    assert.strictEqual(engine1.bidderCardPoints, 50 + 11 + 21, "Bidder should get trick points (11) AND widow points (21)");
    assert.strictEqual(engine1.defenderCardPoints, 30, "Defender points should not change");
    console.log("  - Passed: Bidder wins last trick, gets widow.");

    // Test Case 2: Defender wins last trick
    let engine2 = setupEngineForLastTrick("Heart Solo");
    // Change the last trick so the defender wins
    engine2.currentTrickCards = [
        { userId: 102, playerName: "Defender1", card: 'KS' }, // King of Spades, worth 4
        { userId: 103, playerName: "Defender2", card: '7S' }, // Worth 0
    ];
    engine2.hands['Bidder'] = ['6S']; // Low spade, worth 0
    engine2.leadSuitCurrentTrick = 'S';
    
    await mockGameService.playCard(engine2, 101, '6S');
    assert.strictEqual(engine2.bidderCardPoints, 50, "Bidder points should not change after losing trick");
    assert.strictEqual(engine2.defenderCardPoints, 30 + 4 + 21, "Defender should get trick points (4) AND widow points (21)");
    console.log("  - Passed: Defender wins last trick, gets widow.");

    console.log("...Success! Widow point assignment is correct.\n");
}


// --- Test Runner ---
async function runAllTests() {
    try {
        await testBotBiddingProcess();
        await testAllPlayersPass();
        await testBotHandlesFrogUpgrade();
        await testDrawRequestLifecycle();
    } catch (error) {
        console.error("â Œ A test failed:", error);
        throw error;
    }
}

if (require.main === module) {
    runAllTests().catch(() => process.exit(1));
}

module.exports = runAllTests;
