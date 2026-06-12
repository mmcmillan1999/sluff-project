// backend/src/quick-test-ai.js
require('dotenv').config();
const aiService = require('./services/aiService');

async function quickTest() {
    console.log('🚀 Quick AI Service Test - Improved Version\n');
    
    const models = [
        'gpt-4o-mini',
        'gpt-4o', 
        'llama-3.1-8b',
        'gemini-2.0-flash'
    ];
    
    const testGameState = {
        myHand: ['AS', 'KH', '10D', '9C', '7S', '3H', '2C'],
        myName: 'TestBot',
        trumpSuit: 'H',
        leadSuit: null,
        currentTrick: [],
        trickNumber: 1,
        roundNumber: 1,
        playedCards: [],
        capturedTricks: {},
        scores: { TestBot: 50, Player2: 60, Player3: 45 },
        insurance: {
            offers: {},
            requirements: {},
            currentCaptured: {}
        },
        bidder: 'Player2',
        bidType: 'Solo',
        trumpBroken: false,
        playerOrder: ['TestBot', 'Player2', 'Player3'],
        cardPointValues: { 'A': 10, '10': 10, 'K': 0, 'Q': 0, 'J': 0 },
        ranksOrder: ['2', '3', '4', '5', '6', '7', '8', '9', 'J', 'Q', 'K', '10', 'A']
    };
    
    const legalPlays = ['AS', 'KH', '10D', '9C', '7S', '3H', '2C'];
    
    console.log('Testing each model 5 times for card decision:\n');
    
    for (const model of models) {
        console.log(`\nTesting ${model}:`);
        console.log('-'.repeat(40));
        
        let successes = 0;
        let totalTime = 0;
        
        for (let i = 1; i <= 5; i++) {
            const startTime = Date.now();
            try {
                const result = await aiService.getCardDecision(model, testGameState, legalPlays);
                const elapsed = Date.now() - startTime;
                totalTime += elapsed;
                
                if (result && result.card && legalPlays.includes(result.card)) {
                    successes++;
                    console.log(`  ✅ Test ${i}: ${result.card} (${elapsed}ms) - "${result.reasoning?.substring(0, 50)}..."`);
                } else {
                    console.log(`  ❌ Test ${i}: Invalid response (${elapsed}ms)`);
                }
            } catch (error) {
                const elapsed = Date.now() - startTime;
                totalTime += elapsed;
                console.log(`  ❌ Test ${i}: Error - ${error.message.substring(0, 50)} (${elapsed}ms)`);
            }
        }
        
        const avgTime = Math.round(totalTime / 5);
        const successRate = (successes / 5 * 100).toFixed(0);
        console.log(`\n  Summary: ${successRate}% success rate, ${avgTime}ms avg response time`);
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('Testing bid decisions:\n');
    
    for (const model of models) {
        console.log(`\nTesting ${model} for bidding:`);
        console.log('-'.repeat(40));
        
        try {
            const result = await aiService.getBidDecision(model, testGameState, 'Pass');
            if (result && ['Pass', 'Solo', 'Frog', 'Heart Solo'].includes(result.bid)) {
                console.log(`  ✅ Bid: ${result.bid} - "${result.reasoning?.substring(0, 60)}..."`);
            } else {
                console.log(`  ❌ Invalid bid response`);
            }
        } catch (error) {
            console.log(`  ❌ Error: ${error.message.substring(0, 50)}`);
        }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('Testing insurance decisions:\n');
    
    for (const model of models) {
        console.log(`\nTesting ${model} for insurance:`);
        console.log('-'.repeat(40));
        
        try {
            const result = await aiService.getInsuranceDecision(model, testGameState);
            if (result && typeof result.offer === 'number' && typeof result.requirement === 'number') {
                console.log(`  ✅ Insurance: Offer=${result.offer}, Req=${result.requirement}`);
                console.log(`     Reasoning: "${result.reasoning?.substring(0, 60)}..."`);
            } else {
                console.log(`  ❌ Invalid insurance response`);
            }
        } catch (error) {
            console.log(`  ❌ Error: ${error.message.substring(0, 50)}`);
        }
    }
    
    console.log('\n✨ Quick test complete!');
}

quickTest().catch(console.error);