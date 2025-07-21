// backend/tests/run_all_tests.js

// Import the actual test functions from their files
const runBotTests = require('./bot.test.js');
const runGameLogicTests = require('./gameLogic.unit.test.js');
const runLegalMovesTests = require('./legalMoves.test.js');
const runTableIntegrationTests = require('./Table.integration.test.js');
const testGameOverPayouts = require('./payouts.test.js'); // Import the new test suite

async function run() {
    try {
        console.log('--- Running All Backend Unit & Integration Tests ---');
        
        // --- UNIT TESTS ---
        console.log('\n[1/5] Running BotPlayer.js tests...');
        runBotTests();
        
        console.log('\n[2/5] Running gameLogic.unit.test.js tests...');
        runGameLogicTests();

        console.log('\n[3/5] Running legalMoves.test.js tests...');
        runLegalMovesTests();
        
        // --- INTEGRATION TESTS ---
        console.log('\n[4/5] Running Table.integration.test.js...');
        await runTableIntegrationTests();
        
        console.log('\n[5/5] Running payouts.test.js...');
        await testGameOverPayouts();

        console.log('\n--- âœ… All applicable tests passed! ---');
        process.exit(0); // Exit with success code
    } catch (error) {
        console.error('\n--- ❌ A test failed! ---');
        // The individual test files will log their own detailed errors.
        process.exit(1); // Exit with failure code
    }
}

run();
