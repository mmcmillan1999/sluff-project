// Test API routing and response handling
// Simulates responses from each API provider

const { CARD_POINT_VALUES, RANKS_ORDER } = require('./src/core/constants');

// Mock responses that each API should return
const MOCK_API_RESPONSES = {
    'gpt-4o-mini': {
        bid: { bid: 'Solo', reasoning: 'Strong spades with AS, KS, QS' },
        card: { card: 'AS', reasoning: 'Lead high to establish control' },
        insurance: { offer: 60, requirement: 0, reasoning: 'Bidder looks strong, need protection' }
    },
    'gpt-3.5-turbo': {
        bid: { bid: 'Pass', reasoning: 'Weak hand, no long suits' },
        card: { card: '10H', reasoning: 'Must follow suit with high card' },
        insurance: { offer: 40, requirement: 0, reasoning: 'Moderate protection needed' }
    },
    'claude-3.5-haiku': {
        bid: { bid: 'Frog', reasoning: 'Good cards, widow helps' },
        card: { card: 'KH', reasoning: 'Following suit strategically' },
        insurance: { offer: 80, requirement: 0, reasoning: 'High risk, maximum protection' }
    },
    'gemini-2.0-flash': {
        bid: { bid: 'Heart Solo', reasoning: 'Five hearts including AH, 10H' },
        card: { card: 'QH', reasoning: 'Save king for later' },
        insurance: { offer: 30, requirement: 0, reasoning: 'Bidder might fail' }
    },
    'llama-3.3-70b': {
        bid: { bid: 'Solo', reasoning: 'Balanced hand with aces' },
        card: { card: 'AS', reasoning: 'Trump to win trick' },
        insurance: { offer: 50, requirement: 0, reasoning: 'Average protection' }
    },
    'mixtral-8x7b': {
        bid: { bid: 'Pass', reasoning: 'Too risky to bid' },
        card: { card: '10H', reasoning: 'High heart to win' },
        insurance: { offer: 45, requirement: 0, reasoning: 'Calculated risk' }
    }
};

// Simulate SuperBot processing
class MockSuperBot {
    constructor(model) {
        this.model = model;
        this.playerName = `Bot-${model}`;
    }
    
    processBidDecision(apiResponse) {
        if (!apiResponse || !apiResponse.bid) {
            return { valid: false, error: 'Missing bid field' };
        }
        
        const validBids = ['Pass', 'Solo', 'Frog', 'Heart Solo'];
        if (!validBids.includes(apiResponse.bid)) {
            return { valid: false, error: `Invalid bid: ${apiResponse.bid}` };
        }
        
        // This is what gets logged
        const logOutput = `🎰 ${this.playerName}: Bid ${apiResponse.bid}`;
        
        return {
            valid: true,
            decision: apiResponse.bid,
            logOutput: logOutput,
            apiResponse: apiResponse
        };
    }
    
    processCardDecision(apiResponse, legalPlays) {
        if (!apiResponse || !apiResponse.card) {
            return { valid: false, error: 'Missing card field' };
        }
        
        if (!legalPlays.includes(apiResponse.card)) {
            return { valid: false, error: `Illegal card: ${apiResponse.card} not in ${legalPlays}` };
        }
        
        // This is what gets logged
        const logOutput = `🤖 ${this.playerName}: ${apiResponse.card} - "${apiResponse.reasoning}"`;
        
        return {
            valid: true,
            decision: apiResponse.card,
            logOutput: logOutput,
            apiResponse: apiResponse
        };
    }
    
    processInsuranceDecision(apiResponse, isBidder) {
        if (!apiResponse || typeof apiResponse.offer !== 'number' || typeof apiResponse.requirement !== 'number') {
            return { valid: false, error: 'Missing or invalid offer/requirement fields' };
        }
        
        let finalDecision, logOutput;
        
        if (isBidder) {
            // Bidder uses requirement
            const requirement = Math.max(0, Math.min(360, apiResponse.requirement));
            finalDecision = { 
                settingType: 'bidderRequirement', 
                value: requirement 
            };
            logOutput = `🎯 ${this.playerName} (BIDDER) Insurance Requirement: ${requirement} points`;
        } else {
            // Defender uses offer
            const offer = Math.max(0, Math.min(120, apiResponse.offer));
            finalDecision = { 
                settingType: 'defenderOffer', 
                value: -offer  // Convert to negative for game engine
            };
            logOutput = `🎯 ${this.playerName} (DEFENDER) Insurance Offer: ${offer} points\n   → Will receive ${offer} points if bidder wins (protects against loss)`;
        }
        
        return {
            valid: true,
            decision: finalDecision,
            logOutput: logOutput,
            apiResponse: apiResponse
        };
    }
}

// Run tests
console.log('=== Testing API Response Routing ===\n');

for (const [model, responses] of Object.entries(MOCK_API_RESPONSES)) {
    console.log(`\n━━━ ${model} ━━━`);
    const bot = new MockSuperBot(model);
    
    // Test bid
    console.log('\nBid Decision:');
    const bidResult = bot.processBidDecision(responses.bid);
    if (bidResult.valid) {
        console.log(`  ✓ API Response: ${JSON.stringify(responses.bid)}`);
        console.log(`  ✓ Processed to: ${bidResult.decision}`);
        console.log(`  ✓ Log output: ${bidResult.logOutput}`);
    } else {
        console.log(`  ✗ Error: ${bidResult.error}`);
    }
    
    // Test card
    console.log('\nCard Decision:');
    const legalPlays = ['AS', '10H', 'KH', 'QH']; // Example legal plays
    const cardResult = bot.processCardDecision(responses.card, legalPlays);
    if (cardResult.valid) {
        console.log(`  ✓ API Response: ${JSON.stringify(responses.card)}`);
        console.log(`  ✓ Processed to: ${cardResult.decision}`);
        console.log(`  ✓ Log output: ${cardResult.logOutput}`);
    } else {
        console.log(`  ✗ Error: ${cardResult.error}`);
    }
    
    // Test insurance (as defender)
    console.log('\nInsurance Decision (as Defender):');
    const insResult = bot.processInsuranceDecision(responses.insurance, false);
    if (insResult.valid) {
        console.log(`  ✓ API Response: ${JSON.stringify(responses.insurance)}`);
        console.log(`  ✓ Processed to: ${JSON.stringify(insResult.decision)}`);
        console.log(`  ✓ Log output: ${insResult.logOutput}`);
    } else {
        console.log(`  ✗ Error: ${insResult.error}`);
    }
}

console.log('\n\n=== Routing Summary ===\n');
console.log('1. All APIs must return JSON with specific field names:');
console.log('   - Bid: {bid, reasoning}');
console.log('   - Card: {card, reasoning}');
console.log('   - Insurance: {offer, requirement, reasoning}\n');

console.log('2. Our code validates and processes responses:');
console.log('   - Validates bid is in ["Pass", "Solo", "Frog", "Heart Solo"]');
console.log('   - Validates card is in legal plays array');
console.log('   - Converts insurance offers to negative for defenders\n');

console.log('3. Logging is done by our code, not the APIs:');
console.log('   - Bid: Shows bid choice only');
console.log('   - Card: Shows card + reasoning');
console.log('   - Insurance: Shows role-specific message\n');

console.log('4. Error handling:');
console.log('   - Falls back to parent BotPlayer class if API fails');
console.log('   - Validates all responses before using them');
console.log('   - Logs errors for debugging');