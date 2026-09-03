// Test script to verify AI API responses
const aiService = require('./src/services/aiService');

// Test configurations
const MODELS_TO_TEST = [
    'gpt-4o-mini',
    'gpt-3.5-turbo',
    'claude-3.5-haiku',
    'gemini-2.0-flash',
    'llama-3.3-70b',
    'mixtral-8x7b'
];

const TEST_ROUNDS = 5;

// Sample game states for testing
const BID_TEST_STATE = {
    myHand: ['AS', '10S', 'KS', 'QH', 'JH', '10H', '9D', '8D', '7C', '6C', '5C', '4C', '3C'],
    scores: { 'TestBot': 100, 'Player1': 95, 'Player2': 85 }
};

const CARD_TEST_STATE = {
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
};

const INSURANCE_TEST_STATE = {
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
};

// Color codes for console output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m'
};

async function testBidDecision(model) {
    const results = [];
    console.log(`\n${colors.cyan}Testing BID decisions for ${model}:${colors.reset}`);
    
    for (let i = 1; i <= TEST_ROUNDS; i++) {
        try {
            const start = Date.now();
            const decision = await aiService.getBidDecision(model, BID_TEST_STATE, 'Pass');
            const time = Date.now() - start;
            
            // Validate response
            const isValid = decision && 
                           decision.bid && 
                           ['Pass', 'Solo', 'Frog', 'Heart Solo'].includes(decision.bid) &&
                           typeof decision.reasoning === 'string';
            
            results.push({
                round: i,
                valid: isValid,
                bid: decision?.bid,
                reasoning: decision?.reasoning?.substring(0, 50),
                time: time
            });
            
            console.log(`  Round ${i}: ${isValid ? colors.green + '✓' : colors.red + '✗'} ${colors.reset}` +
                       `Bid: ${decision?.bid || 'INVALID'} (${time}ms)`);
        } catch (error) {
            results.push({
                round: i,
                valid: false,
                error: error.message
            });
            console.log(`  Round ${i}: ${colors.red}✗ ERROR: ${error.message}${colors.reset}`);
        }
    }
    
    return results;
}

async function testCardDecision(model) {
    const results = [];
    const legalPlays = ['KH', 'QH']; // Must follow hearts
    console.log(`\n${colors.cyan}Testing CARD decisions for ${model}:${colors.reset}`);
    
    for (let i = 1; i <= TEST_ROUNDS; i++) {
        try {
            const start = Date.now();
            const decision = await aiService.getCardDecision(model, CARD_TEST_STATE, legalPlays);
            const time = Date.now() - start;
            
            // Validate response
            const isValid = decision && 
                           decision.card && 
                           legalPlays.includes(decision.card) &&
                           typeof decision.reasoning === 'string';
            
            results.push({
                round: i,
                valid: isValid,
                card: decision?.card,
                reasoning: decision?.reasoning?.substring(0, 50),
                time: time
            });
            
            console.log(`  Round ${i}: ${isValid ? colors.green + '✓' : colors.red + '✗'} ${colors.reset}` +
                       `Card: ${decision?.card || 'INVALID'} ` +
                       `${!decision?.card || !legalPlays.includes(decision?.card) ? colors.yellow + '(illegal!)' + colors.reset : ''}` +
                       ` (${time}ms)`);
        } catch (error) {
            results.push({
                round: i,
                valid: false,
                error: error.message
            });
            console.log(`  Round ${i}: ${colors.red}✗ ERROR: ${error.message}${colors.reset}`);
        }
    }
    
    return results;
}

async function testInsuranceDecision(model) {
    const results = [];
    console.log(`\n${colors.cyan}Testing INSURANCE decisions for ${model}:${colors.reset}`);
    
    for (let i = 1; i <= TEST_ROUNDS; i++) {
        try {
            const start = Date.now();
            const decision = await aiService.getInsuranceDecision(model, INSURANCE_TEST_STATE);
            const time = Date.now() - start;
            
            // Validate response
            const isValid = decision && 
                           typeof decision.offer === 'number' && 
                           typeof decision.requirement === 'number' &&
                           decision.offer >= 0 && decision.offer <= 180 &&
                           decision.requirement >= 0 && decision.requirement <= 540 &&
                           typeof decision.reasoning === 'string';
            
            // Since TestBot is a defender (Player1 is bidder), requirement should be 0
            const roleCorrect = decision?.requirement === 0;
            
            results.push({
                round: i,
                valid: isValid,
                offer: decision?.offer,
                requirement: decision?.requirement,
                roleCorrect: roleCorrect,
                reasoning: decision?.reasoning?.substring(0, 50),
                time: time
            });
            
            console.log(`  Round ${i}: ${isValid ? colors.green + '✓' : colors.red + '✗'} ${colors.reset}` +
                       `Offer: ${decision?.offer ?? 'INVALID'}, Req: ${decision?.requirement ?? 'INVALID'} ` +
                       `${!roleCorrect ? colors.yellow + '(wrong role!)' + colors.reset : ''}` +
                       ` (${time}ms)`);
        } catch (error) {
            results.push({
                round: i,
                valid: false,
                error: error.message
            });
            console.log(`  Round ${i}: ${colors.red}✗ ERROR: ${error.message}${colors.reset}`);
        }
    }
    
    return results;
}

async function runAllTests() {
    console.log(`${colors.bright}${colors.magenta}=== AI API Consistency Test ===${colors.reset}`);
    console.log(`Testing ${MODELS_TO_TEST.length} models with ${TEST_ROUNDS} rounds each\n`);
    
    // Initialize the AI service
    aiService.initialize();
    const availableModels = aiService.getAvailableModels();
    console.log(`Available models: ${availableModels.map(m => m.id).join(', ')}\n`);
    
    const results = {};
    
    for (const model of MODELS_TO_TEST) {
        // Check if model is available
        if (!availableModels.find(m => m.id === model)) {
            console.log(`${colors.yellow}Skipping ${model} - not configured${colors.reset}`);
            continue;
        }
        
        console.log(`${colors.bright}${colors.blue}\n━━━ Testing ${model} ━━━${colors.reset}`);
        
        results[model] = {
            bid: await testBidDecision(model),
            card: await testCardDecision(model),
            insurance: await testInsuranceDecision(model)
        };
        
        // Add delay between models to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Print summary
    console.log(`\n${colors.bright}${colors.magenta}=== SUMMARY ===${colors.reset}\n`);
    
    for (const [model, modelResults] of Object.entries(results)) {
        console.log(`${colors.bright}${model}:${colors.reset}`);
        
        // Bid summary
        const bidValid = modelResults.bid.filter(r => r.valid).length;
        const avgBidTime = Math.round(modelResults.bid.reduce((sum, r) => sum + (r.time || 0), 0) / TEST_ROUNDS);
        console.log(`  Bid:       ${bidValid}/${TEST_ROUNDS} valid (avg ${avgBidTime}ms)`);
        
        // Card summary
        const cardValid = modelResults.card.filter(r => r.valid).length;
        const avgCardTime = Math.round(modelResults.card.reduce((sum, r) => sum + (r.time || 0), 0) / TEST_ROUNDS);
        console.log(`  Card:      ${cardValid}/${TEST_ROUNDS} valid (avg ${avgCardTime}ms)`);
        
        // Insurance summary
        const insuranceValid = modelResults.insurance.filter(r => r.valid).length;
        const roleCorrect = modelResults.insurance.filter(r => r.roleCorrect).length;
        const avgInsTime = Math.round(modelResults.insurance.reduce((sum, r) => sum + (r.time || 0), 0) / TEST_ROUNDS);
        console.log(`  Insurance: ${insuranceValid}/${TEST_ROUNDS} valid, ${roleCorrect}/${TEST_ROUNDS} correct role (avg ${avgInsTime}ms)`);
        
        // Overall score
        const totalValid = bidValid + cardValid + insuranceValid;
        const totalTests = TEST_ROUNDS * 3;
        const percentage = Math.round((totalValid / totalTests) * 100);
        const color = percentage >= 90 ? colors.green : percentage >= 70 ? colors.yellow : colors.red;
        console.log(`  ${colors.bright}Overall:   ${color}${percentage}% success rate${colors.reset}\n`);
    }
}

// Run the tests
runAllTests().catch(error => {
    console.error(`${colors.red}Fatal error:${colors.reset}`, error);
    process.exit(1);
});