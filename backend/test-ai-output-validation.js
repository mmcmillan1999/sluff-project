// Comprehensive test to validate AI output formats
// Tests actual APIs if configured, or shows requirements

const aiService = require('./src/services/aiService');

// Initialize AI service
aiService.initialize();

// Test states that closely match real game scenarios
const TEST_SCENARIOS = {
    bid: {
        state: {
            myHand: ['AS', '10S', 'KS', 'QH', 'JH', '10H', '9D', '8D', '7C', '6C', '5C', '4C', '3C'],
            scores: { 'TestBot': 100, 'Player1': 95, 'Player2': 85 }
        },
        currentHighestBid: 'Pass',
        validateResponse: (response) => {
            const errors = [];
            
            // Check required fields exist
            if (!response.bid) errors.push('Missing "bid" field');
            if (!response.reasoning) errors.push('Missing "reasoning" field');
            
            // Check bid value is valid
            const validBids = ['Pass', 'Solo', 'Frog', 'Heart Solo'];
            if (response.bid && !validBids.includes(response.bid)) {
                errors.push(`Invalid bid "${response.bid}" - must be one of: ${validBids.join(', ')}`);
            }
            
            // Check reasoning is a string
            if (response.reasoning && typeof response.reasoning !== 'string') {
                errors.push('Reasoning must be a string');
            }
            
            return {
                valid: errors.length === 0,
                errors: errors,
                format: {
                    bid: response.bid || 'MISSING',
                    reasoning: response.reasoning ? response.reasoning.substring(0, 50) + '...' : 'MISSING'
                }
            };
        }
    },
    
    card: {
        state: {
            myHand: ['AS', '10S', 'KH', 'QH', '9D', '7C'],
            myName: 'TestBot',
            trumpSuit: 'S',
            leadSuit: 'H',
            currentTrick: [
                { card: 'JH', player: 'Player1' },
                { card: '10H', player: 'Player2' }
            ],
            trickNumber: 7,
            roundNumber: 3,
            playedCards: ['AH', 'KD', 'QD', 'JD', '10D'],
            capturedTricksCount: { 'TestBot': 2, 'Player1': 3, 'Player2': 2 },
            pointsCaptured: { 'TestBot': 20, 'Player1': 30, 'Player2': 10 },
            scores: { 'TestBot': 100, 'Player1': 95, 'Player2': 85 },
            insurance: { offers: {}, requirements: {}, dealActive: false },
            bidder: 'Player1',
            bidType: 'Solo',
            trumpBroken: true,
            playerOrder: ['TestBot', 'Player1', 'Player2'],
            seatPosition: 'left_of_bidder',
            cardPointValues: { 'A': 10, '10': 10, 'K': 0, 'Q': 0, 'J': 0 },
            ranksOrder: ['A', '10', 'K', 'Q', 'J', '9', '8', '7', '6', '5', '4', '3', '2'],
            suitTracking: {},
            remainingCards: { H: [], S: [], C: [], D: [] },
            remainingHighCards: { H: [], S: [], C: [], D: [] },
            cardHistory: []
        },
        legalPlays: ['KH', 'QH'], // Must follow hearts
        validateResponse: (response, legalPlays) => {
            const errors = [];
            
            // Check required fields exist
            if (!response.card) errors.push('Missing "card" field');
            if (!response.reasoning) errors.push('Missing "reasoning" field');
            
            // Check card format (rank + suit)
            const cardPattern = /^(A|K|Q|J|10|[2-9])[HSCD]$/;
            if (response.card && !cardPattern.test(response.card)) {
                errors.push(`Invalid card format "${response.card}" - must be like "AS", "10H", "9C"`);
            }
            
            // Check if card is legal
            if (response.card && legalPlays && !legalPlays.includes(response.card)) {
                errors.push(`Illegal card "${response.card}" - must be one of: ${legalPlays.join(', ')}`);
            }
            
            // Check reasoning is a string
            if (response.reasoning && typeof response.reasoning !== 'string') {
                errors.push('Reasoning must be a string');
            }
            
            return {
                valid: errors.length === 0,
                errors: errors,
                format: {
                    card: response.card || 'MISSING',
                    reasoning: response.reasoning ? response.reasoning.substring(0, 50) + '...' : 'MISSING'
                }
            };
        }
    },
    
    insurance: {
        state: {
            myHand: ['AS', '10S', 'KS', 'AH', '10H', 'KH'],
            myName: 'TestBot',
            scores: { 'TestBot': 100, 'Player1': 95, 'Player2': 85 },
            bidder: 'Player1',
            bidType: 'Frog',
            insurance: {
                offers: { 'Player2': -60 },
                requirements: {},
                currentCaptured: { 'Player1': 3, 'TestBot': 2, 'Player2': 1 },
                dealActive: false
            },
            capturedTricksCount: { 'Player1': 3, 'TestBot': 2, 'Player2': 1 },
            pointsCaptured: { 'Player1': 30, 'TestBot': 20, 'Player2': 10 },
            trickNumber: 6,
            seatPosition: 'left_of_bidder'
        },
        validateResponse: (response) => {
            const errors = [];
            
            // Check required fields exist
            if (typeof response.offer !== 'number') errors.push('Missing or non-numeric "offer" field');
            if (typeof response.requirement !== 'number') errors.push('Missing or non-numeric "requirement" field');
            if (!response.reasoning) errors.push('Missing "reasoning" field');
            
            // Check value ranges
            if (typeof response.offer === 'number') {
                if (response.offer < 0) errors.push(`Offer must be positive (got ${response.offer})`);
                if (response.offer > 180) errors.push(`Offer too high (${response.offer} > 180)`);
            }
            
            if (typeof response.requirement === 'number') {
                if (response.requirement < 0) errors.push(`Requirement must be positive (got ${response.requirement})`);
                if (response.requirement > 540) errors.push(`Requirement too high (${response.requirement} > 540)`);
            }
            
            // For this test, TestBot is a defender (Player1 is bidder)
            // So requirement should be 0 and offer should be > 0
            const isDefender = true;
            if (isDefender && response.requirement !== 0) {
                errors.push(`As defender, requirement should be 0 (got ${response.requirement})`);
            }
            
            // Check reasoning is a string
            if (response.reasoning && typeof response.reasoning !== 'string') {
                errors.push('Reasoning must be a string');
            }
            
            return {
                valid: errors.length === 0,
                errors: errors,
                format: {
                    offer: response.offer ?? 'MISSING',
                    requirement: response.requirement ?? 'MISSING',
                    reasoning: response.reasoning ? response.reasoning.substring(0, 50) + '...' : 'MISSING'
                }
            };
        }
    }
};

// Test a single model
async function testModel(modelId) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`Testing: ${modelId}`);
    console.log(`${'═'.repeat(60)}`);
    
    const results = {
        bid: null,
        card: null,
        insurance: null
    };
    
    // Test bid decision
    console.log('\n📋 BID DECISION TEST:');
    try {
        const start = Date.now();
        const response = await aiService.getBidDecision(
            modelId, 
            TEST_SCENARIOS.bid.state, 
            TEST_SCENARIOS.bid.currentHighestBid
        );
        const time = Date.now() - start;
        
        const validation = TEST_SCENARIOS.bid.validateResponse(response);
        results.bid = { response, validation, time };
        
        if (validation.valid) {
            console.log(`  ✅ Valid response in ${time}ms`);
            console.log(`  → Bid: ${validation.format.bid}`);
            console.log(`  → Reasoning: ${validation.format.reasoning}`);
        } else {
            console.log(`  ❌ Invalid response in ${time}ms`);
            validation.errors.forEach(err => console.log(`    - ${err}`));
            console.log(`  Raw response:`, response);
        }
    } catch (error) {
        console.log(`  ❌ Error: ${error.message}`);
        results.bid = { error: error.message };
    }
    
    // Test card decision
    console.log('\n🃏 CARD DECISION TEST:');
    try {
        const start = Date.now();
        const response = await aiService.getCardDecision(
            modelId,
            TEST_SCENARIOS.card.state,
            TEST_SCENARIOS.card.legalPlays
        );
        const time = Date.now() - start;
        
        const validation = TEST_SCENARIOS.card.validateResponse(response, TEST_SCENARIOS.card.legalPlays);
        results.card = { response, validation, time };
        
        if (validation.valid) {
            console.log(`  ✅ Valid response in ${time}ms`);
            console.log(`  → Card: ${validation.format.card}`);
            console.log(`  → Reasoning: ${validation.format.reasoning}`);
        } else {
            console.log(`  ❌ Invalid response in ${time}ms`);
            validation.errors.forEach(err => console.log(`    - ${err}`));
            console.log(`  Raw response:`, response);
        }
    } catch (error) {
        console.log(`  ❌ Error: ${error.message}`);
        results.card = { error: error.message };
    }
    
    // Test insurance decision
    console.log('\n🛡️ INSURANCE DECISION TEST:');
    try {
        const start = Date.now();
        const response = await aiService.getInsuranceDecision(
            modelId,
            TEST_SCENARIOS.insurance.state
        );
        const time = Date.now() - start;
        
        const validation = TEST_SCENARIOS.insurance.validateResponse(response);
        results.insurance = { response, validation, time };
        
        if (validation.valid) {
            console.log(`  ✅ Valid response in ${time}ms`);
            console.log(`  → Offer: ${validation.format.offer}`);
            console.log(`  → Requirement: ${validation.format.requirement}`);
            console.log(`  → Reasoning: ${validation.format.reasoning}`);
        } else {
            console.log(`  ❌ Invalid response in ${time}ms`);
            validation.errors.forEach(err => console.log(`    - ${err}`));
            console.log(`  Raw response:`, response);
        }
    } catch (error) {
        console.log(`  ❌ Error: ${error.message}`);
        results.insurance = { error: error.message };
    }
    
    return results;
}

// Main test runner
async function runTests() {
    console.log('🎮 SLUFF AI OUTPUT VALIDATION TEST');
    console.log('==================================\n');
    
    const models = aiService.getAvailableModels();
    
    if (models.length === 0) {
        console.log('⚠️  No AI models configured!');
        console.log('\nTo configure models, set these environment variables:');
        console.log('  - OPENAI_API_KEY for GPT models');
        console.log('  - ANTHROPIC_API_KEY for Claude models');
        console.log('  - GOOGLE_API_KEY for Gemini models');
        console.log('  - GROQ_API_KEY for Llama/Mixtral models');
        console.log('\n📋 REQUIRED OUTPUT FORMATS:\n');
        
        // Show required formats
        console.log('BID DECISION:');
        console.log('  Required: {');
        console.log('    bid: "Pass" | "Solo" | "Frog" | "Heart Solo",');
        console.log('    reasoning: "string explaining the decision"');
        console.log('  }\n');
        
        console.log('CARD DECISION:');
        console.log('  Required: {');
        console.log('    card: "AS" | "10H" | "9C" etc (must be in legalPlays),');
        console.log('    reasoning: "string explaining the play"');
        console.log('  }\n');
        
        console.log('INSURANCE DECISION:');
        console.log('  Required: {');
        console.log('    offer: 0-180 (number, points defender wants to receive),');
        console.log('    requirement: 0-540 (number, points bidder wants),');
        console.log('    reasoning: "string explaining the decision"');
        console.log('  }\n');
        
        console.log('Note: Our code adds logging prefixes like 🎰, 🤖, 🎯');
        console.log('The reasoning shown in logs is genuine AI thinking!');
        
        return;
    }
    
    console.log(`Found ${models.length} configured models:`);
    models.forEach(m => console.log(`  - ${m.id} (${m.provider}, ${m.speed})`));
    
    const allResults = {};
    
    // Test each model
    for (const model of models) {
        allResults[model.id] = await testModel(model.id);
        
        // Rate limit protection
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Summary
    console.log(`\n${'═'.repeat(60)}`);
    console.log('SUMMARY');
    console.log(`${'═'.repeat(60)}`);
    
    for (const [modelId, results] of Object.entries(allResults)) {
        const bidValid = results.bid?.validation?.valid ? '✅' : '❌';
        const cardValid = results.card?.validation?.valid ? '✅' : '❌';
        const insuranceValid = results.insurance?.validation?.valid ? '✅' : '❌';
        
        const bidTime = results.bid?.time || 'N/A';
        const cardTime = results.card?.time || 'N/A';
        const insuranceTime = results.insurance?.time || 'N/A';
        
        console.log(`\n${modelId}:`);
        console.log(`  Bid:       ${bidValid} (${bidTime}ms)`);
        console.log(`  Card:      ${cardValid} (${cardTime}ms)`);
        console.log(`  Insurance: ${insuranceValid} (${insuranceTime}ms)`);
        
        // Show any critical errors
        const allErrors = [
            ...(results.bid?.validation?.errors || []),
            ...(results.card?.validation?.errors || []),
            ...(results.insurance?.validation?.errors || [])
        ];
        
        if (allErrors.length > 0) {
            console.log(`  ⚠️  Issues found:`);
            [...new Set(allErrors)].slice(0, 3).forEach(err => 
                console.log(`    - ${err}`)
            );
        }
    }
    
    console.log('\n✅ Test complete!');
    console.log('\nAll working models will show their reasoning in game logs:');
    console.log('  - Bid reasoning (newly added)');
    console.log('  - Card play reasoning (already shown)');
    console.log('  - Insurance reasoning (newly added)');
}

// Run the tests
runTests().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});