// backend/tests/bugfix.test.js

const GameEngine = require('../src/core/GameEngine');
const { validateGameState } = require('../src/utils/stateValidator');

/**
 * Test suite for bug fixes
 */
async function runBugFixTests() {
    console.log('\n🧪 Running Bug Fix Tests...\n');
    
    let passedTests = 0;
    let totalTests = 0;

    // Test 1: Table Reset with Mixed Player Types
    totalTests++;
    try {
        console.log('Test 1: Table Reset Bug Fix');
        
        const engine = new GameEngine('test-table', 'Classic', 'Test Table', () => {});
        
        // Add human player
        engine.joinTable({ id: 101, username: 'Human1' }, 'socket1');
        
        // Add bot player
        engine.addBotPlayer();
        
        // Add another human player
        engine.joinTable({ id: 102, username: 'Human2' }, 'socket2');
        
        // Simulate game start
        engine.gameStarted = true;
        engine.dealer = 101;
        
        // Disconnect human player
        engine.disconnectPlayer(101);
        
        // Validate state before reset
        const preResetValidation = validateGameState(engine);
        console.log(`  Pre-reset state: ${preResetValidation.summary}`);
        
        // Reset the table
        engine.reset();
        
        // Validate state after reset
        const postResetValidation = validateGameState(engine);
        console.log(`  Post-reset state: ${postResetValidation.summary}`);
        
        if (postResetValidation.isValid) {
            console.log('  ✅ Table reset bug fix successful');
            passedTests++;
        } else {
            console.log('  ❌ Table reset still has issues:', postResetValidation.issues);
        }
        
    } catch (error) {
        console.log('  ❌ Test 1 failed:', error.message);
    }

    // Test 2: Timer Cleanup
    totalTests++;
    try {
        console.log('\nTest 2: Timer Cleanup');
        
        const engine = new GameEngine('test-table-2', 'Classic', 'Test Table 2', () => {});
        
        // Add players and start game
        engine.joinTable({ id: 201, username: 'Player1' }, 'socket1');
        engine.joinTable({ id: 202, username: 'Player2' }, 'socket2');
        engine.addBotPlayer();
        
        // Simulate active timers
        engine.internalTimers.drawTimer = setTimeout(() => {}, 1000);
        engine.internalTimers.forfeit = setInterval(() => {}, 500);
        
        const timersBefore = Object.keys(engine.internalTimers).length;
        console.log(`  Timers before cleanup: ${timersBefore}`);
        
        // Clear all timers
        engine._clearAllTimers();
        
        const timersAfter = Object.keys(engine.internalTimers).length;
        console.log(`  Timers after cleanup: ${timersAfter}`);
        
        if (timersAfter === 0) {
            console.log('  ✅ Timer cleanup successful');
            passedTests++;
        } else {
            console.log('  ❌ Timer cleanup failed');
        }
        
    } catch (error) {
        console.log('  ❌ Test 2 failed:', error.message);
    }

    // Test 3: Player Order Consistency
    totalTests++;
    try {
        console.log('\nTest 3: Player Order Consistency');
        
        const engine = new GameEngine('test-table-3', 'Classic', 'Test Table 3', () => {});
        
        // Add mixed player types
        engine.joinTable({ id: 301, username: 'Human1' }, 'socket1');
        engine.addBotPlayer(); // Bot ID will be -1
        engine.joinTable({ id: 302, username: 'Human2' }, 'socket2');
        
        const validation = validateGameState(engine);
        console.log(`  Player order validation: ${validation.summary}`);
        
        // Test disconnect and reconnect
        engine.disconnectPlayer(301);
        const afterDisconnect = validateGameState(engine);
        console.log(`  After disconnect: ${afterDisconnect.summary}`);
        
        if (validation.isValid && afterDisconnect.isValid) {
            console.log('  ✅ Player order consistency maintained');
            passedTests++;
        } else {
            console.log('  ❌ Player order consistency issues found');
            if (!validation.isValid) console.log('    Initial issues:', validation.issues);
            if (!afterDisconnect.isValid) console.log('    Post-disconnect issues:', afterDisconnect.issues);
        }
        
    } catch (error) {
        console.log('  ❌ Test 3 failed:', error.message);
    }

    // Test 4: Bot Management
    totalTests++;
    try {
        console.log('\nTest 4: Bot Management Consistency');
        
        const engine = new GameEngine('test-table-4', 'Classic', 'Test Table 4', () => {});
        
        // Add bots
        engine.addBotPlayer();
        engine.addBotPlayer();
        
        const botsAdded = Object.keys(engine.bots).length;
        console.log(`  Bots added: ${botsAdded}`);
        
        // Remove a bot
        engine.removeBot();
        
        const botsRemaining = Object.keys(engine.bots).length;
        console.log(`  Bots remaining: ${botsRemaining}`);
        
        const validation = validateGameState(engine);
        console.log(`  Bot consistency: ${validation.summary}`);
        
        if (validation.isValid && botsRemaining === botsAdded - 1) {
            console.log('  ✅ Bot management consistency maintained');
            passedTests++;
        } else {
            console.log('  ❌ Bot management issues found');
            if (!validation.isValid) console.log('    Issues:', validation.issues);
        }
        
    } catch (error) {
        console.log('  ❌ Test 4 failed:', error.message);
    }

    // Test 5: State Validation Edge Cases
    totalTests++;
    try {
        console.log('\nTest 5: State Validation Edge Cases');
        
        const engine = new GameEngine('test-table-5', 'Classic', 'Test Table 5', () => {});
        
        // Create an intentionally inconsistent state
        engine.joinTable({ id: 501, username: 'Player1' }, 'socket1');
        engine.playerOrder.add(999); // Add non-existent player to order
        
        const validation = validateGameState(engine);
        console.log(`  Edge case validation: ${validation.summary}`);
        
        if (!validation.isValid && validation.issues.length > 0) {
            console.log('  ✅ State validator correctly detected issues');
            passedTests++;
        } else {
            console.log('  ❌ State validator failed to detect known issues');
        }
        
        // Clean up the inconsistent state
        engine.playerOrder.remove(999);
        
    } catch (error) {
        console.log('  ❌ Test 5 failed:', error.message);
    }

    // Summary
    console.log(`\n📊 Bug Fix Test Results: ${passedTests}/${totalTests} tests passed`);
    
    if (passedTests === totalTests) {
        console.log('🎉 All bug fix tests passed!');
        return true;
    } else {
        console.log('❌ Some bug fix tests failed. Please review the fixes.');
        return false;
    }
}

// Run tests if this file is executed directly
if (require.main === module) {
    runBugFixTests().then(success => {
        process.exit(success ? 0 : 1);
    }).catch(error => {
        console.error('Test execution failed:', error);
        process.exit(1);
    });
}

module.exports = { runBugFixTests };