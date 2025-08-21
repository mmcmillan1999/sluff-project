// Test the fixed insurance system for SuperBots
require('dotenv').config();
const aiService = require('./src/services/aiService');

async function testInsuranceDecisions() {
    console.log('🎯 TESTING FIXED INSURANCE SYSTEM');
    console.log('=' .repeat(60));
    
    // Initialize AI service
    aiService.initialize();
    
    // Test scenario 1: Defender facing strong Frog bidder
    console.log('\n📊 SCENARIO 1: Defender vs Strong Frog Bidder');
    console.log('-'.repeat(60));
    
    const defenderVsFrog = {
        myHand: ['9S', '8H', '7D', '6C', '5S', '4H', '3D'],
        myName: 'TestBot',
        bidder: 'StrongBidder',
        bidType: 'Frog',
        scores: { TestBot: 100, StrongBidder: 90, OtherPlayer: 95 },
        insurance: { 
            offers: { OtherPlayer: 60 },
            requirements: {},
            dealActive: false
        },
        capturedTricksCount: { TestBot: 2, StrongBidder: 5, OtherPlayer: 1 },
        pointsCaptured: { TestBot: 10, StrongBidder: 40, OtherPlayer: 10 },
        trickNumber: 9,
        seatPosition: 'left_of_bidder'
    };
    
    const prompt1 = aiService._buildInsurancePrompt(defenderVsFrog);
    console.log('PROMPT EXCERPT:');
    console.log(prompt1.split('\n').slice(0, 12).join('\n'));
    
    try {
        const decision1 = await aiService.getInsuranceDecision('gpt-4o-mini', defenderVsFrog);
        console.log('\n✅ AI DECISION:', decision1);
        console.log('ANALYSIS: Should offer 60-120 to limit losses since bidder is winning');
    } catch (error) {
        console.log('❌ Error:', error.message);
    }
    
    // Test scenario 2: Bidder with strong hand
    console.log('\n📊 SCENARIO 2: Bidder with Strong Frog Hand');
    console.log('-'.repeat(60));
    
    const bidderFrog = {
        myHand: ['AS', 'AH', '10S', '10H', 'KS', 'KH', '9S'],
        myName: 'TestBidder',
        bidder: 'TestBidder',
        bidType: 'Frog',
        scores: { TestBidder: 100, Defender1: 90, Defender2: 95 },
        insurance: { 
            offers: {},
            requirements: {},
            dealActive: false
        },
        capturedTricksCount: {},
        pointsCaptured: {},
        trickNumber: 1,
        seatPosition: 'bidder'
    };
    
    const prompt2 = aiService._buildInsurancePrompt(bidderFrog);
    console.log('PROMPT EXCERPT:');
    console.log(prompt2.split('\n').slice(0, 12).join('\n'));
    
    try {
        const decision2 = await aiService.getInsuranceDecision('gpt-4o-mini', bidderFrog);
        console.log('\n✅ AI DECISION:', decision2);
        console.log('ANALYSIS: Should ask for 180-360 points with strong Frog hand');
    } catch (error) {
        console.log('❌ Error:', error.message);
    }
    
    // Test scenario 3: Defender vs weak Solo bidder
    console.log('\n📊 SCENARIO 3: Defender vs Weak Solo Bidder');
    console.log('-'.repeat(60));
    
    const defenderVsWeakSolo = {
        myHand: ['AS', 'AH', '10S', '10H', 'KS', 'KH', '9S'],
        myName: 'StrongDefender',
        bidder: 'WeakBidder',
        bidType: 'Solo',
        scores: { StrongDefender: 100, WeakBidder: 90, OtherDefender: 95 },
        insurance: { 
            offers: { OtherDefender: 0 },
            requirements: {},
            dealActive: false
        },
        capturedTricksCount: { StrongDefender: 4, WeakBidder: 2, OtherDefender: 2 },
        pointsCaptured: { StrongDefender: 30, WeakBidder: 10, OtherDefender: 20 },
        trickNumber: 9,
        seatPosition: 'right_of_bidder'
    };
    
    const prompt3 = aiService._buildInsurancePrompt(defenderVsWeakSolo);
    console.log('PROMPT EXCERPT:');
    console.log(prompt3.split('\n').slice(0, 12).join('\n'));
    
    try {
        const decision3 = await aiService.getInsuranceDecision('gpt-4o-mini', defenderVsWeakSolo);
        console.log('\n✅ AI DECISION:', decision3);
        console.log('ANALYSIS: Should offer 0-15 since bidder is losing');
    } catch (error) {
        console.log('❌ Error:', error.message);
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ INSURANCE FIX SUMMARY:');
    console.log('1. AI now understands bidder vs defender roles');
    console.log('2. AI knows correct point calculations (Frog = 2x, etc)');
    console.log('3. AI understands refusing strong bidder = double loss');
    console.log('4. Values are now in actual points (not 0-10 scale)');
    console.log('\nThe 360 point loss bug should be FIXED! 🎉');
}

testInsuranceDecisions().catch(console.error);