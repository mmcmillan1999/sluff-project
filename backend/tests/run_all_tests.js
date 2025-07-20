// backend/tests/run_all_tests.js

async function run() {
    try {
        console.log('--- Running All Backend Tests ---');
        
        // We require and immediately call the test functions.
        // The 'require' statement executes the file.
        require('./bot.test.js');
        require('./gameLogic.unit.test.js');
        require('./legalMoves.test.js');
        // Note: auth.test.js and api.test.js require a running server,
        // so we don't include them in this automated unit/integration test suite.
        
        // The Table.integration.test.js is more complex and best run on its own for now.
        // console.log('\nTo run the full integration test, use: node tests/Table.integration.test.js');

        console.log('\n--- ✅ All applicable tests passed! ---');
        process.exit(0); // Exit with success code
    } catch (error) {
        console.error('\n--- ❌ A test failed! ---');
        console.error(error);
        process.exit(1); // Exit with failure code
    }
}

run();