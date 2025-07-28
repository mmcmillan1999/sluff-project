// backend/tests/mercyToken.test.js
// Comprehensive tests for mercy token functionality

const assert = require('assert');
const transactionManager = require('../src/data/transactionManager');

// Mock database pool for testing
const createMockPool = () => {
    const queries = [];
    const mockClient = {
        query: async (text, params) => {
            queries.push({ text, params });
            
            // Mock responses based on query type
            if (text.includes('SELECT SUM(amount)')) {
                // Mock current token balance
                return { rows: [{ current_tokens: '3.00' }] };
            } else if (text.includes('SELECT COUNT(*)') && text.includes('mercy_count')) {
                // Mock rate limiting check - no recent mercy tokens
                return { rows: [{ mercy_count: '0', last_mercy_time: null }] };
            } else if (text.includes('SELECT username FROM users')) {
                // Mock username lookup
                return { rows: [{ username: 'testuser' }] };
            } else if (text.includes('SELECT') && text.includes('total_attempts')) {
                // Mock suspicious activity check
                return { rows: [{ total_attempts: '1', successful_mercy: '0', first_attempt: new Date(), last_attempt: new Date() }] };
            } else if (text.includes('INSERT INTO transactions')) {
                // Mock successful transaction insertion
                return { rows: [] };
            } else if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
                // Mock transaction control
                return { rows: [] };
            }
            return { rows: [] };
        },
        release: () => {},
    };

    return {
        connect: async () => {
            return {
                ...mockClient,
                query: async (text, params) => {
                    // Don't record queries twice - they're already recorded in mockClient.query
                    return mockClient.query(text, params);
                }
            };
        },
        query: mockClient.query, // Add direct query method for security monitor
        queries
    };
};

async function runMercyTokenTests() {
    console.log('Running mercy token tests...');

    // Test 1: Valid mercy token request
    console.log('  Test 1: Valid mercy token request');
    const mockPool1 = createMockPool();
    const result1 = await transactionManager.handleMercyTokenRequest(mockPool1, 123);
    
    assert.strictEqual(result1.success, true, 'Valid request should succeed');
    assert.strictEqual(result1.message, "1 free token has been added to your account!", 'Should return success message');
    assert.strictEqual(result1.previousBalance, 3.00, 'Should return correct previous balance');
    assert.strictEqual(result1.newBalance, 4.00, 'Should return correct new balance');
    
    // Verify transaction was inserted
    const transactionInserts = mockPool1.queries.filter(q => q.text.includes('INSERT INTO transactions') && q.text.includes('free_token_mercy'));
    assert.strictEqual(transactionInserts.length, 1, 'Should insert exactly one mercy token transaction');
    assert.strictEqual(transactionInserts[0].params[0], 123, 'Should use correct user ID');
    // The transaction type, amount, and description are hardcoded in the query
    assert(transactionInserts[0].text.includes('free_token_mercy'), 'Should use correct transaction type');
    assert(transactionInserts[0].text.includes('1'), 'Should add 1 token');
    assert(transactionInserts[0].text.includes('Mercy token requested by user'), 'Should have correct description');
    
    console.log('    ✓ Valid mercy token request test passed');

    // Test 2: User has too many tokens (>= 5)
    console.log('  Test 2: User has too many tokens');
    const mockPool2 = createMockPool();
    // Override the balance query to return 5 tokens
    const originalQueryFn = mockPool2.query;
    mockPool2.query = async (text, params) => {
        if (text.includes('SELECT SUM(amount)')) {
            return { rows: [{ current_tokens: '5.50' }] };
        }
        return originalQueryFn(text, params);
    };
    mockPool2.connect = async () => {
        const client = await createMockPool().connect();
        client.query = async (text, params) => {
            if (text.includes('SELECT SUM(amount)')) {
                return { rows: [{ current_tokens: '5.50' }] };
            }
            return originalQueryFn(text, params);
        };
        return client;
    };
    
    const result2 = await transactionManager.handleMercyTokenRequest(mockPool2, 123);
    
    assert.strictEqual(result2.success, false, 'Should fail when user has >= 5 tokens');
    assert(result2.error.includes('fewer than 5 tokens'), 'Should return appropriate error message');
    assert.strictEqual(result2.currentTokens, 5.50, 'Should return current token count');
    
    console.log('    ✓ Too many tokens test passed');

    // Test 3: Invalid user ID
    console.log('  Test 3: Invalid user ID');
    const mockPool3 = createMockPool();
    
    try {
        await transactionManager.handleMercyTokenRequest(mockPool3, null);
        assert.fail('Should throw error for null user ID');
    } catch (error) {
        assert(error.message.includes('Invalid userId'), 'Should throw appropriate error for null user ID');
    }

    try {
        await transactionManager.handleMercyTokenRequest(mockPool3, 'invalid');
        assert.fail('Should throw error for non-numeric user ID');
    } catch (error) {
        assert(error.message.includes('Invalid userId'), 'Should throw appropriate error for non-numeric user ID');
    }
    
    console.log('    ✓ Invalid user ID test passed');

    // Test 4: Rate limiting (user already got mercy token within hour)
    console.log('  Test 4: Rate limiting');
    const mockPool4 = createMockPool();
    // Override rate limiting query to return recent mercy token
    mockPool4.connect = async () => {
        const client = await createMockPool().connect();
        client.query = async (text, params) => {
            if (text.includes('SELECT SUM(amount)')) {
                return { rows: [{ current_tokens: '2.00' }] };
            } else if (text.includes('SELECT COUNT(*)') && text.includes('mercy_count')) {
                // Return that user got mercy token 30 minutes ago
                const thirtyMinutesAgo = new Date(Date.now() - 1800000);
                return { rows: [{ mercy_count: '1', last_mercy_time: thirtyMinutesAgo }] };
            }
            return { rows: [] };
        };
        return client;
    };
    
    const result4 = await transactionManager.handleMercyTokenRequest(mockPool4, 123);
    
    assert.strictEqual(result4.success, false, 'Should fail due to rate limiting');
    assert(result4.error.includes('one mercy token per hour'), 'Should return rate limiting error');
    assert(result4.timeLeft > 0, 'Should return time left until next request');
    
    console.log('    ✓ Rate limiting test passed');

    // Test 5: postTransaction input validation
    console.log('  Test 5: postTransaction input validation');
    const mockPool5 = createMockPool();
    
    // Test invalid userId
    try {
        await transactionManager.postTransaction(mockPool5, { userId: null, type: 'test', amount: 1, description: 'test' });
        assert.fail('Should throw error for null userId');
    } catch (error) {
        assert(error.message.includes('Invalid userId'), 'Should validate userId');
    }

    // Test invalid type
    try {
        await transactionManager.postTransaction(mockPool5, { userId: 123, type: null, amount: 1, description: 'test' });
        assert.fail('Should throw error for null type');
    } catch (error) {
        assert(error.message.includes('Invalid transaction type'), 'Should validate transaction type');
    }

    // Test invalid amount
    try {
        await transactionManager.postTransaction(mockPool5, { userId: 123, type: 'test', amount: 'invalid', description: 'test' });
        assert.fail('Should throw error for invalid amount');
    } catch (error) {
        assert(error.message.includes('Invalid amount'), 'Should validate amount');
    }

    // Test invalid description
    try {
        await transactionManager.postTransaction(mockPool5, { userId: 123, type: 'test', amount: 1, description: null });
        assert.fail('Should throw error for null description');
    } catch (error) {
        assert(error.message.includes('Invalid description'), 'Should validate description');
    }
    
    console.log('    ✓ postTransaction validation test passed');

    console.log('  ✓ All mercy token tests passed!');
}

// Export for use in test runner
module.exports = { runMercyTokenTests };

// Run tests if this file is executed directly
if (require.main === module) {
    runMercyTokenTests().catch(err => {
        console.error('Mercy token test suite failed:', err.message);
        console.error(err.stack);
        process.exit(1);
    });
}