const path = require('path');

const suites = [
    { name: 'BotPlayer', file: './bot.test.js' },
    { name: 'game logic', file: './gameLogic.unit.test.js' },
    { name: 'legal moves', file: './legalMoves.test.js' },
    { name: 'mercy tokens', file: './mercyToken.test.js', exportName: 'runMercyTokenTests' },
    { name: 'table integration', file: './Table.integration.test.js' },
    { name: 'payouts', file: './payouts.test.js' },
    { name: 'quick play', file: './quickPlay.test.js' },
    { name: 'four-player mode', file: './fourPlayer.test.js' },
    { name: 'leaderboard privacy', file: './leaderboard.test.js' },
    { name: 'inactive-user maintenance', file: './pruneInactiveUsers.test.js' },
    { name: 'viewer-safe game state', file: './gameStateSerializer.test.js' },
    { name: 'backend integrity', file: './backendIntegrity.test.js' },
    { name: 'atomic game settlement', file: './gameSettlementIntegrity.test.js' },
    { name: 'authentication integrity', file: './authenticationIntegrity.test.js' },
    { name: 'AI prompt rule contract', file: './aiPromptRules.test.js' },
];

function loadRunner(suite) {
    const absolutePath = path.resolve(__dirname, suite.file);
    const testModule = require(absolutePath);
    const runner = suite.exportName ? testModule[suite.exportName] : testModule;
    if (typeof runner !== 'function') {
        throw new TypeError(`${suite.file} must export a test runner function.`);
    }
    return runner;
}

async function run() {
    console.log('--- Running safe backend unit and integration tests ---');

    let completed = 0;
    for (const suite of suites) {
        const runner = loadRunner(suite);
        console.log(`\n[${completed + 1}] ${suite.name}`);
        await runner();
        completed += 1;
    }

    console.log(`\n--- All ${completed} safe backend suites passed. ---`);
}

if (require.main === module) {
    run().catch(error => {
        console.error('\n--- Backend test run failed. ---');
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = run;
