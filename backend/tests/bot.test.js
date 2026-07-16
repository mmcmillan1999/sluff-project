// backend/tests/bot.test.js

const assert = require('assert');
// --- PATH CORRECTION ---
const BotPlayer = require('../src/core/BotPlayer');

// Mock the engine object the bot needs to read from
class MockEngine {
    constructor(hand, overrides = {}) {
        this.hands = { 'TestBot': hand };
        this.currentHighestBidDetails = null;
        this.currentTrickCards = [];
        this.leadSuitCurrentTrick = null;
        this.trumpSuit = 'H';
        this.trumpBroken = true;
        this.capturedTricks = {};
        Object.assign(this, overrides);
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
    const bid1 = bot1.decideBid();
    assert.strictEqual(bid1, 'Heart Solo');
    pass('Correctly decides to bid Heart Solo.');

    // Test: Bot should decide to bid Solo
    let hand2 = ['AC', 'KC', 'QC', 'JC', '10C', 'AD', 'KD', 'QD', 'JD', '10D', '6H'];
    let mockEngine2 = new MockEngine(hand2);
    let bot2 = new BotPlayer(-1, 'TestBot', mockEngine2);
    const bid2 = bot2.decideBid();
    assert.strictEqual(bid2, 'Solo');
    pass('Correctly decides to bid Solo.');
    
    // Test: Bot should decide to bid Frog
    let hand3 = ['AH', 'KH', 'QH', 'JH', 'AC', '6D', '7D', '8C', '9C', '6S', '7S'];
    let mockEngine3 = new MockEngine(hand3);
    let bot3 = new BotPlayer(-1, 'TestBot', mockEngine3);
    const bid3 = bot3.decideBid();
    assert.strictEqual(bid3, 'Frog');
    pass('Correctly decides to bid Frog.');
    
    // Test: Bot should decide to Pass
    let hand4 = ['6H', '7H', '8H', '9H', '6D', '7D', '8D', '9D', '6C', '7C', '8C'];
    let mockEngine4 = new MockEngine(hand4);
    let bot4 = new BotPlayer(-1, 'TestBot', mockEngine4);
    const bid4 = bot4.decideBid();
    assert.strictEqual(bid4, 'Pass');
    pass('Correctly decides to pass with a weak hand.');

    const makeFollowingBot = (hand, currentTrickCards, leadSuit = 'D') => new BotPlayer(
        -1,
        'TestBot',
        new MockEngine(hand, { currentTrickCards, leadSuitCurrentTrick: leadSuit })
    );

    let playBot = makeFollowingBot(
        ['9H', '6H', '7H', 'AS'],
        [{ userId: 1, playerName: 'Leader', card: 'KD' }]
    );
    assert.strictEqual(playBot.playCard(), '6H');
    pass('Uses rank order to choose the lowest trump when void in a non-trump lead suit.');

    playBot = makeFollowingBot(
        ['AH', 'AS'],
        [{ userId: 1, playerName: 'Leader', card: 'KD' }]
    );
    assert.strictEqual(playBot.playCard(), 'AH');
    pass('Uses its only trump when void in a non-trump lead suit.');

    playBot = makeFollowingBot(
        ['10H', '6H', 'AS'],
        [{ userId: 1, playerName: 'Leader', card: 'KD' }]
    );
    assert.strictEqual(playBot.playCard(), '10H');
    pass('Sheds the trump 10 when it is one of exactly two trumps in hand.');

    playBot = makeFollowingBot(
        ['10H', '6H', 'AH', 'AS'],
        [{ userId: 1, playerName: 'Leader', card: 'KD' }]
    );
    assert.strictEqual(playBot.playCard(), '6H');
    pass('Does not shed the trump 10 when more than two trumps are in hand.');

    playBot = makeFollowingBot(
        ['AH', 'KH', 'AS'],
        [{ userId: 1, playerName: 'Leader', card: 'KD' }]
    );
    assert.strictEqual(playBot.playCard(), 'KH');
    pass('Uses the lower trump when exactly two trumps in hand do not include a 10.');

    playBot = makeFollowingBot(
        ['AH', '6H', 'AS'],
        [
            { userId: 1, playerName: 'Leader', card: '6D' },
            { userId: 2, playerName: 'Second', card: 'QH' }
        ]
    );
    assert.strictEqual(playBot.playCard(), '6H');
    pass('Uses the lowest trump even when a previous player has already trumped.');

    playBot = makeFollowingBot(
        ['AD', '6D', '6H'],
        [{ userId: 1, playerName: 'Leader', card: 'KD' }]
    );
    assert.strictEqual(playBot.playCard(), 'AD');
    pass('Keeps existing winning-card behavior when following the led suit.');

    playBot = makeFollowingBot(
        ['AH', '6H', '6S'],
        [{ userId: 1, playerName: 'Leader', card: '10H' }],
        'H'
    );
    assert.strictEqual(playBot.playCard(), 'AH');
    pass('Keeps existing winning-card behavior when trump itself is led.');

    console.log('  ✔ All BotPlayer.js tests passed!');
}

if (require.main === module) {
    runBotTests();
}

module.exports = runBotTests;
