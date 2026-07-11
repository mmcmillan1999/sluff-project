const assert = require('assert');
require('dotenv').config();
const {
    loadRequiredEnvironment,
    remoteTargetsAreAllowed,
    withoutTrailingSlash,
} = require('./e2e-test-config');

async function runAuthTests({ serverUrl, emailDomain, registrationPassword }) {
    console.log('Running auth.js API tests...');

    const uniqueUser = `testuser_${Date.now()}`;
    const uniqueEmail = `${uniqueUser}@${emailDomain}`;

    // Test 1: Successful Registration
    let res = await fetch(`${serverUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: uniqueUser, email: uniqueEmail, password: registrationPassword }),
    });
    assert.strictEqual(res.status, 201, 'Test 1 Failed: Successful registration should return 201.');
    console.log('  \u2713 Test 1 Passed: Successful registration.');

    // Test 2: Attempt to register with the same username
    res = await fetch(`${serverUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            username: uniqueUser,
            email: `another_${uniqueEmail}`,
            password: registrationPassword,
        }),
    });
    assert.strictEqual(res.status, 500, 'Test 2 Failed: Duplicate username registration should return 500.');
    console.log('  \u2713 Test 2 Passed: Duplicate username correctly rejected.');
    
    // Test 3: Attempt to register with the same email
    res = await fetch(`${serverUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            username: `another_${uniqueUser}`,
            email: uniqueEmail,
            password: registrationPassword,
        }),
    });
    assert.strictEqual(res.status, 500, 'Test 3 Failed: Duplicate email registration should return 500.');
    console.log('  \u2713 Test 3 Passed: Duplicate email correctly rejected.');

    console.log('  \u2713 All auth.js tests passed!');
}

const config = loadRequiredEnvironment('auth registration E2E test', [
    'SLUFF_E2E_SERVER_URL',
    'SLUFF_E2E_REGISTRATION_EMAIL_DOMAIN',
    'SLUFF_E2E_REGISTRATION_PASSWORD',
]);

if (config && remoteTargetsAreAllowed('auth registration E2E test', [config.SLUFF_E2E_SERVER_URL])) {
    runAuthTests({
        serverUrl: withoutTrailingSlash(config.SLUFF_E2E_SERVER_URL),
        emailDomain: config.SLUFF_E2E_REGISTRATION_EMAIL_DOMAIN,
        registrationPassword: config.SLUFF_E2E_REGISTRATION_PASSWORD,
    }).catch(err => {
        console.error('Auth test suite failed:', err.message);
        process.exit(1);
    });
}
