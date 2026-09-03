// Quick test of all AI APIs with one call each
require('dotenv').config();
const aiService = require('./src/services/aiService');

async function quickTest() {
    console.log('🚀 QUICK AI API TEST\n');
    
    aiService.initialize();
    const models = aiService.getAvailableModels();
    
    if (models.length === 0) {
        console.log('❌ No models available');
        return;
    }
    
    console.log(`Testing ${models.length} models with 1 call each...\n`);
    
    // Test state for card decision (simplest to validate)
    const testState = {
        myHand: ['KH', 'QH', '9D'],
        myName: 'TestBot',
        trumpSuit: 'S',
        leadSuit: 'H',
        currentTrick: [{ card: 'JH', player: 'P1' }],
        trickNumber: 5,
        roundNumber: 2,
        playedCards: [],
        capturedTricksCount: { 'TestBot': 2, 'P1': 2, 'P2': 2 },
        pointsCaptured: { 'TestBot': 20, 'P1': 20, 'P2': 20 },
        scores: { 'TestBot': 100, 'P1': 100, 'P2': 100 },
        insurance: { offers: {}, requirements: {}, dealActive: false },
        bidder: 'P1',
        bidType: 'Solo',
        trumpBroken: false,
        playerOrder: ['TestBot', 'P1', 'P2'],
        seatPosition: 'left_of_bidder',
        cardPointValues: { 'A': 10, '10': 10 },
        ranksOrder: ['A', '10', 'K', 'Q', 'J', '9', '8', '7', '6', '5', '4', '3', '2'],
        suitTracking: {},
        remainingCards: { H: [], S: [], C: [], D: [] },
        remainingHighCards: { H: [], S: [], C: [], D: [] },
        cardHistory: []
    };
    
    const legalPlays = ['KH', 'QH']; // Must follow hearts
    
    const results = [];
    
    for (const model of models) {
        const result = { model: model.id, provider: model.provider };
        
        try {
            console.log(`Testing ${model.id}...`);
            const start = Date.now();
            const response = await aiService.getCardDecision(model.id, testState, legalPlays);
            const time = Date.now() - start;
            
            // Validate response
            const hasCard = response && response.card;
            const hasReasoning = response && response.reasoning;
            const isLegal = hasCard && legalPlays.includes(response.card);
            const isValid = hasCard && hasReasoning && isLegal;
            
            result.time = time;
            result.valid = isValid;
            result.response = response;
            
            if (isValid) {
                console.log(`  ✅ Valid: ${response.card} - "${response.reasoning.substring(0, 40)}..." (${time}ms)`);
            } else {
                console.log(`  ❌ Invalid response (${time}ms)`);
                if (!hasCard) console.log('     Missing card field');
                if (!hasReasoning) console.log('     Missing reasoning field');
                if (hasCard && !isLegal) console.log(`     Illegal card: ${response.card}`);
                console.log('     Raw:', JSON.stringify(response));
            }
        } catch (error) {
            result.error = error.message;
            console.log(`  ❌ Error: ${error.message}`);
        }
        
        results.push(result);
    }
    
    // Summary
    console.log('\n' + '═'.repeat(60));
    console.log('SUMMARY');
    console.log('═'.repeat(60) + '\n');
    
    const validCount = results.filter(r => r.valid).length;
    const errorCount = results.filter(r => r.error).length;
    
    console.log(`✅ Valid responses: ${validCount}/${models.length}`);
    console.log(`❌ Errors: ${errorCount}/${models.length}`);
    
    console.log('\nResponse times:');
    results.filter(r => r.time).forEach(r => {
        const symbol = r.valid ? '✅' : '⚠️';
        console.log(`  ${symbol} ${r.model}: ${r.time}ms`);
    });
    
    console.log('\n✨ Working models that return proper format:');
    results.filter(r => r.valid).forEach(r => {
        console.log(`  • ${r.model}: "${r.response.card}" - "${r.response.reasoning.substring(0, 30)}..."`);
    });
    
    if (validCount === models.length) {
        console.log('\n🎉 ALL MODELS WORKING CORRECTLY!');
    } else if (validCount > 0) {
        console.log(`\n⚠️ ${models.length - validCount} models need attention`);
    }
}

quickTest().catch(console.error);