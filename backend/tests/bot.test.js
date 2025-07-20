// backend/tests/bot.test.js

const assert = require('assert');
// --- PATH CORRECTION ---
const BotPlayer = require('../src/core/BotPlayer');

// Mock the engine object the bot needs to read from
class MockEngine {
    constructor(hand) {
        this.hands = { 'TestBot': hand };
        this.currentHighestBidDetails = null;
    }
}

function runBotTests() {
    console.log('Running BotPlayer.js tests...');
    let testCounter = 1;
    const pass = (testName) => console.log(`  ✔ Test ${testCounter++}: ${testName}`);

    // Test: Bot should decide to bid Heart Solo
    let hand1 = ['AH', 'KH', 'QH', 'JH', '10H', 'AS', 'KS', 'QS', 'JS', '10S', '6C'];
    let mockEngine1 = new MockEngine(hand1);
    let bot1 = new BotPlayer(-1, 'TestBot', mockEngine1);
    const bid1 = bot1.makeBid();
    assert.strictEqual(bid1, 'Heart Solo');
    pass('Correctly decides to bid Heart Solo.');

    // Test: Bot should decide to bid Solo
    let hand2 = ['AC', 'KC', 'QC', 'JC', '10C', 'AD', 'KD', 'QD', 'JD', '10D', '6H'];
    let mockEngine2 = new MockEngine(hand2);
    let bot2 = new BotPlayer(-1, 'TestBot', mockEngine2);
    const bid2 = bot2.makeBid();
    assert.strictEqual(bid2, 'Solo');
    pass('Correctly decides to bid Solo.');
    
    // Test: Bot should decide to bid Frog
    let hand3 = ['AH', 'KH', 'QH', 'JH', 'AC', '6D', '7D', '8C', '9C', '6S', '7S'];
    let mockEngine3 = new MockEngine(hand3);
    let bot3 = new BotPlayer(-1, 'TestBot', mockEngine3);
    const bid3 = bot3.makeBid();
    assert.strictEqual(bid3, 'Frog');
    pass('Correctly decides to bid Frog.');
    
    // Test: Bot should decide to Pass
    let hand4 = ['6H', '7H', '8H', '9H', '6D', '7D', '8D', '9D', '6C', '7C', '8C'];
    let mockEngine4 = new MockEngine(hand4);
    let bot4 = new BotPlayer(-1, 'TestBot', mockEngine4);
    const bid4 = bot4.makeBid();
    assert.strictEqual(bid4, 'Pass');
    pass('Correctly decides to pass with a weak hand.');

    console.log('  ✔ All BotPlayer.js tests passed!');
}

if (require.main === module) {
    runBotTests();
}

module.exports = runBotTests;