// Quick live check that every AI provider responds through aiService.
// Usage: node scripts/smoke-test-ai.js
require('dotenv').config();
const aiService = require('../src/services/aiService');

const gameState = {
    myName: 'TestBot',
    myHand: ['AS', '10S', 'KS', '9H', '8H', '7C', '6C', 'QD', 'JD', '8D', '7D', '6D', 'AH'],
    currentTrick: [],
    trumpSuit: 'S',
    leadSuit: null,
    trickNumber: 1,
    capturedTricksCount: {},
    pointsCaptured: {},
    seatPosition: 'leader',
    bidder: 'TestBot',
    scores: { TestBot: 120, Bot2: 120, Bot3: 120 },
};
const legalPlays = ['AS', '10S', 'KS', '9H', '8H'];

const MODELS_TO_TEST = process.argv[2]
    ? [process.argv[2]]
    : ['gpt-5.4-mini', 'claude-haiku-4.5', 'gemini-2.5-flash', 'llama-3.3-70b'];

(async () => {
    let failures = 0;
    for (const model of MODELS_TO_TEST) {
        const start = Date.now();
        try {
            const result = await aiService.getCardDecision(model, gameState, legalPlays);
            const ms = Date.now() - start;
            if (result && legalPlays.includes(result.card)) {
                console.log(`PASS ${model} (${ms}ms): played ${result.card} — "${result.reasoning}"`);
            } else if (result) {
                console.log(`WARN ${model} (${ms}ms): returned ${JSON.stringify(result)} (card not in legal plays)`);
            } else {
                console.log(`FAIL ${model} (${ms}ms): returned null`);
                failures++;
            }
        } catch (err) {
            console.log(`FAIL ${model}: ${err.message}`);
            failures++;
        }
    }
    process.exit(failures ? 1 : 0);
})();
