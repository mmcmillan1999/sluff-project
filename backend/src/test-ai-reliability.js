// backend/src/test-ai-reliability.js
require('dotenv').config();
const aiService = require('./services/aiService');

// Test configuration
const TESTS_PER_MODEL = 100;
const MODELS_TO_TEST = [
    'gpt-4o-mini',
    'gpt-4o',
    'gpt-3.5-turbo',
    'claude-3.5-haiku',
    'claude-3.5-sonnet',
    'gemini-2.0-flash',
    'gemini-1.5-flash',
    'llama-3.3-70b',
    'llama-3.1-8b',
    'mixtral-8x7b'
];

// Sample game states for testing
const sampleGameStates = [
    {
        myHand: ['AS', 'KH', '10D', '9C', '7S', '3H', '2C'],
        trumpSuit: 'H',
        leadSuit: null,
        currentTrick: [],
        trickNumber: 1,
        scores: { Player1: 45, Player2: 60, Player3: 35 },
        playedCards: [],
        legalPlays: ['AS', 'KH', '10D', '9C', '7S', '3H', '2C']
    },
    {
        myHand: ['QS', '10H', 'JC', '8D', '4H', '2S'],
        trumpSuit: 'C',
        leadSuit: 'S',
        currentTrick: [{ card: '3S', player: 'Player1' }],
        trickNumber: 5,
        scores: { Player1: 65, Player2: 40, Player3: 55 },
        playedCards: ['AS', 'KS', 'AC', '10C', 'AH', '10H', 'AD', '10D'],
        legalPlays: ['QS', '2S']
    },
    {
        myHand: ['AC', '10C', 'KD', '9H', '5S', '3D'],
        trumpSuit: 'D',
        leadSuit: 'H',
        currentTrick: [
            { card: '7H', player: 'Player1' },
            { card: 'QH', player: 'Player2' }
        ],
        trickNumber: 8,
        scores: { Player1: 80, Player2: 75, Player3: 70 },
        playedCards: ['AS', 'KS', 'QS', 'JS', '10S', '9S', '8S', '7S', 'AH', 'KH', 'JH', '10H'],
        legalPlays: ['9H']
    }
];

// Test results storage
const results = {};

async function testCardDecision(model, gameState, legalPlays) {
    const startTime = Date.now();
    try {
        const decision = await aiService.getCardDecision(model, gameState, legalPlays);
        const responseTime = Date.now() - startTime;
        
        // Validate response
        if (!decision) {
            return { success: false, error: 'Null response', responseTime };
        }
        if (!decision.card) {
            return { success: false, error: 'Missing card field', responseTime, response: JSON.stringify(decision) };
        }
        if (!legalPlays.includes(decision.card)) {
            return { success: false, error: 'Illegal move returned', responseTime, card: decision.card };
        }
        
        return { 
            success: true, 
            responseTime, 
            card: decision.card,
            reasoning: decision.reasoning?.substring(0, 50) 
        };
    } catch (error) {
        const responseTime = Date.now() - startTime;
        return { 
            success: false, 
            error: error.message, 
            responseTime 
        };
    }
}

async function testBidDecision(model) {
    const gameState = {
        myHand: ['AH', 'KH', 'QH', 'JH', '10H', 'AS', 'KS', 'AC', 'KC', 'AD', 'KD', '10D', '9D'],
        scores: { Player1: 50, Player2: 50, Player3: 50 }
    };
    const currentHighestBid = 'Pass';
    
    const startTime = Date.now();
    try {
        const decision = await aiService.getBidDecision(model, gameState, currentHighestBid);
        const responseTime = Date.now() - startTime;
        
        if (!decision) {
            return { success: false, error: 'Null response', responseTime };
        }
        if (!decision.bid) {
            return { success: false, error: 'Missing bid field', responseTime };
        }
        if (!['Pass', 'Solo', 'Frog', 'Heart Solo'].includes(decision.bid)) {
            return { success: false, error: 'Invalid bid', responseTime, bid: decision.bid };
        }
        
        return { 
            success: true, 
            responseTime, 
            bid: decision.bid,
            reasoning: decision.reasoning?.substring(0, 50) 
        };
    } catch (error) {
        const responseTime = Date.now() - startTime;
        return { 
            success: false, 
            error: error.message, 
            responseTime 
        };
    }
}

async function testInsuranceDecision(model) {
    const gameState = {
        myHand: ['AS', 'KS', 'QS', '10H', '9H', '8C', '7C', '6D', '5D', '4D', '3D', '2D', '2H'],
        myName: 'TestBot',
        scores: { TestBot: 60, Player2: 50, Player3: 40 },
        bidder: 'Player2',
        bidType: 'Solo',
        insurance: {
            offers: { Player3: 5 },
            requirements: { Player3: 7 }
        }
    };
    
    const startTime = Date.now();
    try {
        const decision = await aiService.getInsuranceDecision(model, gameState);
        const responseTime = Date.now() - startTime;
        
        if (!decision) {
            return { success: false, error: 'Null response', responseTime };
        }
        if (typeof decision.offer !== 'number' || typeof decision.requirement !== 'number') {
            return { success: false, error: 'Invalid insurance values', responseTime };
        }
        if (decision.offer < 0 || decision.offer > 10 || decision.requirement < 0 || decision.requirement > 10) {
            return { success: false, error: 'Insurance values out of range', responseTime };
        }
        
        return { 
            success: true, 
            responseTime, 
            offer: decision.offer,
            requirement: decision.requirement,
            reasoning: decision.reasoning?.substring(0, 50) 
        };
    } catch (error) {
        const responseTime = Date.now() - startTime;
        return { 
            success: false, 
            error: error.message, 
            responseTime 
        };
    }
}

async function runTestsForModel(model) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Testing ${model}`);
    console.log(`${'='.repeat(60)}`);
    
    const modelResults = {
        card: { successes: 0, failures: 0, totalTime: 0, errors: {} },
        bid: { successes: 0, failures: 0, totalTime: 0, errors: {} },
        insurance: { successes: 0, failures: 0, totalTime: 0, errors: {} }
    };
    
    // Test card decisions
    console.log('\nTesting card decisions...');
    for (let i = 0; i < TESTS_PER_MODEL; i++) {
        const gameState = sampleGameStates[i % sampleGameStates.length];
        const result = await testCardDecision(model, gameState, gameState.legalPlays);
        
        if (result.success) {
            modelResults.card.successes++;
            modelResults.card.totalTime += result.responseTime;
        } else {
            modelResults.card.failures++;
            modelResults.card.totalTime += result.responseTime;
            modelResults.card.errors[result.error] = (modelResults.card.errors[result.error] || 0) + 1;
        }
        
        // Progress indicator
        if ((i + 1) % 10 === 0) {
            process.stdout.write(`Card tests: ${i + 1}/${TESTS_PER_MODEL} `);
            process.stdout.write(`(✓${modelResults.card.successes} ✗${modelResults.card.failures})\n`);
        }
    }
    
    // Test bid decisions
    console.log('\nTesting bid decisions...');
    for (let i = 0; i < TESTS_PER_MODEL; i++) {
        const result = await testBidDecision(model);
        
        if (result.success) {
            modelResults.bid.successes++;
            modelResults.bid.totalTime += result.responseTime;
        } else {
            modelResults.bid.failures++;
            modelResults.bid.totalTime += result.responseTime;
            modelResults.bid.errors[result.error] = (modelResults.bid.errors[result.error] || 0) + 1;
        }
        
        if ((i + 1) % 10 === 0) {
            process.stdout.write(`Bid tests: ${i + 1}/${TESTS_PER_MODEL} `);
            process.stdout.write(`(✓${modelResults.bid.successes} ✗${modelResults.bid.failures})\n`);
        }
    }
    
    // Test insurance decisions
    console.log('\nTesting insurance decisions...');
    for (let i = 0; i < TESTS_PER_MODEL; i++) {
        const result = await testInsuranceDecision(model);
        
        if (result.success) {
            modelResults.insurance.successes++;
            modelResults.insurance.totalTime += result.responseTime;
        } else {
            modelResults.insurance.failures++;
            modelResults.insurance.totalTime += result.responseTime;
            modelResults.insurance.errors[result.error] = (modelResults.insurance.errors[result.error] || 0) + 1;
        }
        
        if ((i + 1) % 10 === 0) {
            process.stdout.write(`Insurance tests: ${i + 1}/${TESTS_PER_MODEL} `);
            process.stdout.write(`(✓${modelResults.insurance.successes} ✗${modelResults.insurance.failures})\n`);
        }
    }
    
    results[model] = modelResults;
    return modelResults;
}

function printResults() {
    console.log('\n\n' + '='.repeat(80));
    console.log('FINAL RESULTS SUMMARY');
    console.log('='.repeat(80));
    
    const sortedModels = Object.keys(results).sort((a, b) => {
        const aTotal = results[a].card.successes + results[a].bid.successes + results[a].insurance.successes;
        const bTotal = results[b].card.successes + results[b].bid.successes + results[b].insurance.successes;
        return bTotal - aTotal;
    });
    
    console.log('\n📊 Success Rates (sorted by total success):');
    console.log('-'.repeat(80));
    console.log('Model'.padEnd(20) + 'Cards'.padEnd(15) + 'Bids'.padEnd(15) + 'Insurance'.padEnd(15) + 'Overall');
    console.log('-'.repeat(80));
    
    for (const model of sortedModels) {
        const r = results[model];
        const cardRate = ((r.card.successes / TESTS_PER_MODEL) * 100).toFixed(1);
        const bidRate = ((r.bid.successes / TESTS_PER_MODEL) * 100).toFixed(1);
        const insuranceRate = ((r.insurance.successes / TESTS_PER_MODEL) * 100).toFixed(1);
        const overallRate = (((r.card.successes + r.bid.successes + r.insurance.successes) / (TESTS_PER_MODEL * 3)) * 100).toFixed(1);
        
        console.log(
            model.padEnd(20) +
            `${cardRate}%`.padEnd(15) +
            `${bidRate}%`.padEnd(15) +
            `${insuranceRate}%`.padEnd(15) +
            `${overallRate}%`
        );
    }
    
    console.log('\n⏱️ Average Response Times (ms):');
    console.log('-'.repeat(80));
    console.log('Model'.padEnd(20) + 'Cards'.padEnd(15) + 'Bids'.padEnd(15) + 'Insurance');
    console.log('-'.repeat(80));
    
    for (const model of sortedModels) {
        const r = results[model];
        const cardAvg = Math.round(r.card.totalTime / TESTS_PER_MODEL);
        const bidAvg = Math.round(r.bid.totalTime / TESTS_PER_MODEL);
        const insuranceAvg = Math.round(r.insurance.totalTime / TESTS_PER_MODEL);
        
        console.log(
            model.padEnd(20) +
            `${cardAvg}ms`.padEnd(15) +
            `${bidAvg}ms`.padEnd(15) +
            `${insuranceAvg}ms`
        );
    }
    
    console.log('\n❌ Common Error Patterns:');
    console.log('-'.repeat(80));
    
    for (const model of sortedModels) {
        const r = results[model];
        const allErrors = {
            ...r.card.errors,
            ...r.bid.errors,
            ...r.insurance.errors
        };
        
        if (Object.keys(allErrors).length > 0) {
            console.log(`\n${model}:`);
            for (const [error, count] of Object.entries(allErrors)) {
                console.log(`  - ${error}: ${count} times`);
            }
        }
    }
}

async function runAllTests() {
    console.log('🤖 AI Service Reliability Test Suite');
    console.log(`Testing ${MODELS_TO_TEST.length} models with ${TESTS_PER_MODEL} tests each`);
    console.log('This will take several minutes...\n');
    
    // Initialize the service
    aiService.initialize();
    
    // Test each model
    for (const model of MODELS_TO_TEST) {
        try {
            await runTestsForModel(model);
        } catch (error) {
            console.error(`\n❌ Critical error testing ${model}: ${error.message}`);
            results[model] = {
                card: { successes: 0, failures: TESTS_PER_MODEL, totalTime: 0, errors: { 'Critical error': TESTS_PER_MODEL } },
                bid: { successes: 0, failures: TESTS_PER_MODEL, totalTime: 0, errors: {} },
                insurance: { successes: 0, failures: TESTS_PER_MODEL, totalTime: 0, errors: {} }
            };
        }
    }
    
    // Print final results
    printResults();
    
    // Save results to file
    const fs = require('fs');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `ai-test-results-${timestamp}.json`;
    fs.writeFileSync(filename, JSON.stringify(results, null, 2));
    console.log(`\n💾 Detailed results saved to ${filename}`);
}

// Run the tests
runAllTests().catch(console.error);