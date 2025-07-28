// backend/tests/bot-insurance.test.js

const assert = require('assert');
const { calculateInsuranceMove, getBotPersonality, BOT_PERSONALITIES } = require('../src/core/bot-strategies/InsuranceStrategy');

// Mock classes and objects
class MockEngine {
    constructor(config = {}) {
        this.insurance = {
            isActive: true,
            bidMultiplier: config.bidMultiplier || 1,
            bidderPlayerName: config.bidderPlayerName || 'TestBidder',
            bidderRequirement: config.bidderRequirement || 120,
            defenderOffers: config.defenderOffers || { 'TestDefender': -60 },
            dealExecuted: false
        };
        this.bidWinnerInfo = {
            bid: config.bid || 'Frog',
            playerName: config.bidderPlayerName || 'TestBidder'
        };
        this.hands = config.hands || {
            'TestBidder': ['AH', 'KH', 'QH', 'JH', '10H'],
            'TestDefender': ['AS', 'KS', 'QS', 'JS', '10S']
        };
        this.bidderCardPoints = config.bidderCardPoints || 50;
        this.defenderCardPoints = config.defenderCardPoints || 70;
        this.playerOrder = { count: 3 };
        this.capturedTricks = {};
    }
}

class MockBot {
    constructor(playerName) {
        this.playerName = playerName;
        this.userId = playerName + '_id';
    }
}

function runBotInsuranceTests() {
    console.log('Running Bot Insurance Strategy tests...');
    let testCounter = 1;
    const pass = (testName) => console.log(`  ✔ Test ${testCounter++}: ${testName}`);

    // Test 1: Bot personality assignment is consistent
    const bot1 = new MockBot('TestBot1');
    const bot2 = new MockBot('TestBot2');
    const personality1a = getBotPersonality(bot1);
    const personality1b = getBotPersonality(bot1);
    const personality2 = getBotPersonality(bot2);
    
    assert.strictEqual(personality1a.name, personality1b.name, 'Same bot should get same personality');
    assert(Object.values(BOT_PERSONALITIES).some(p => p.name === personality1a.name), 'Personality should be valid');
    pass('Bot personality assignment is consistent and valid');

    // Test 2: Bidder makes winning decision
    const winningEngine = new MockEngine({
        bidderPlayerName: 'TestBidder',
        bidderCardPoints: 80, // Strong position
        hands: {
            'TestBidder': ['AH', 'KH', 'QH', 'JH', '10H', 'AS'], // 41 points
            'TestDefender': ['6C', '7C', '8C', '9C', '6D']
        }
    });
    const bidderBot = new MockBot('TestBidder');
    const bidderDecision = calculateInsuranceMove(winningEngine, bidderBot);
    
    assert(bidderDecision, 'Bidder should make a decision');
    assert.strictEqual(bidderDecision.settingType, 'bidderRequirement');
    assert(bidderDecision.value > 120, 'Bidder should ask for more than base when winning');
    pass('Bidder makes greedy decision when in winning position');

    // Test 3: Bidder makes losing decision (hedging)
    const losingEngine = new MockEngine({
        bidderPlayerName: 'TestBidder',
        bidderCardPoints: 30, // Weak position
        hands: {
            'TestBidder': ['6H', '7H', '8H', '9H', '6C'], // 0 points
            'TestDefender': ['AH', 'KH', 'QH', 'JH', '10H']
        }
    });
    const losingBidderBot = new MockBot('TestBidder');
    const losingDecision = calculateInsuranceMove(losingEngine, losingBidderBot);
    
    assert(losingDecision, 'Losing bidder should make a decision');
    assert.strictEqual(losingDecision.settingType, 'bidderRequirement');
    assert(losingDecision.value >= 0, 'Bidder should ask for positive value when hedging');
    pass('Bidder makes hedging decision when in losing position');

    // Test 4: Defender responds to bidder requirement
    const defenderEngine = new MockEngine({
        bidderPlayerName: 'TestBidder',
        bidderRequirement: 150, // Greedy bidder
        defenderOffers: { 'TestDefender': -60 }
    });
    const defenderBot = new MockBot('TestDefender');
    const defenderDecision = calculateInsuranceMove(defenderEngine, defenderBot);
    
    assert(defenderDecision, 'Defender should make a decision');
    assert.strictEqual(defenderDecision.settingType, 'defenderOffer');
    assert(typeof defenderDecision.value === 'number', 'Defender should offer a number');
    pass('Defender responds to bidder requirement');

    // Test 5: Different personalities make different decisions
    const testEngine = new MockEngine({
        bidderPlayerName: 'AggressiveBot',
        bidderCardPoints: 70
    });
    
    const aggressiveBot = new MockBot('AggressiveBot');
    const conservativeBot = new MockBot('ConservativeBot');
    
    // Force different personalities (this is a bit hacky but works for testing)
    const originalGetPersonality = getBotPersonality;
    const mockGetPersonality = (bot) => {
        if (bot.playerName === 'AggressiveBot') return BOT_PERSONALITIES.AGGRESSIVE;
        if (bot.playerName === 'ConservativeBot') return BOT_PERSONALITIES.CONSERVATIVE;
        return originalGetPersonality(bot);
    };
    
    // Temporarily replace the function
    require('../src/core/bot-strategies/InsuranceStrategy').getBotPersonality = mockGetPersonality;
    
    const aggressiveDecision = calculateInsuranceMove(testEngine, aggressiveBot);
    
    testEngine.bidderPlayerName = 'ConservativeBot';
    const conservativeDecision = calculateInsuranceMove(testEngine, conservativeBot);
    
    // Restore original function
    require('../src/core/bot-strategies/InsuranceStrategy').getBotPersonality = originalGetPersonality;
    
    if (aggressiveDecision && conservativeDecision) {
        // Aggressive bots should generally ask for more than conservative ones
        assert(aggressiveDecision.value !== conservativeDecision.value, 
               'Different personalities should make different decisions');
    }
    pass('Different bot personalities make different decisions');

    // Test 6: No decision when no change needed
    const unchangedEngine = new MockEngine({
        bidderPlayerName: 'TestBidder',
        bidderRequirement: 120, // Already at calculated value
        bidderCardPoints: 50
    });
    const unchangedBot = new MockBot('TestBidder');
    
    // First call should return a decision
    const firstDecision = calculateInsuranceMove(unchangedEngine, unchangedBot);
    
    // If there was a decision, update the engine and call again
    if (firstDecision) {
        unchangedEngine.insurance.bidderRequirement = firstDecision.value;
        const secondDecision = calculateInsuranceMove(unchangedEngine, unchangedBot);
        assert.strictEqual(secondDecision, null, 'Should return null when no change needed');
    }
    pass('Returns null when no change is needed');

    console.log('  ✔ All Bot Insurance Strategy tests passed!');
}

if (require.main === module) {
    runBotInsuranceTests();
}

module.exports = runBotInsuranceTests;