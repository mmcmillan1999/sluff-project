'use strict';

// Small input-hygiene guards: the email normalizer registration and login
// share, and the mercy-token security report naming the window it queried.

const assert = require('node:assert/strict');
const { normalizeEmail } = require('../src/data/accountIdentity');
const { generateSecurityReport } = require('../src/utils/securityMonitor');

const pass = message => console.log(`  ✓ ${message}`);

async function runAccountHygieneTests() {
    {
        assert.deepEqual(normalizeEmail('  someone@example.com '), { ok: true, value: 'someone@example.com' });
        assert.deepEqual(normalizeEmail('Someone@Example.com'), { ok: true, value: 'Someone@Example.com' }, 'case is left alone');
        for (const bad of ['', '   ', 'nope', 'a@b', 'a b@c.com', '@c.com', 'a@', 42, null, undefined, `${'x'.repeat(250)}@example.com`]) {
            assert.equal(normalizeEmail(bad).ok, false, `rejected: ${JSON.stringify(bad)}`);
        }
        assert.equal(normalizeEmail('nope').message, 'Enter a valid email address.');
        pass('Emails are trimmed and shaped like an address before they are stored or looked up.');
    }
    {
        const seen = [];
        const pool = { async query(sql, params) { seen.push(params); return { rows: [] }; } };
        const quiet = console.log;
        console.log = () => {};
        try {
            assert.equal((await generateSecurityReport(pool, NaN)).period, '24h', 'an unreadable window falls back to a day');
            assert.equal((await generateSecurityReport(pool, 99999)).period, '8760h', 'the window is capped at a year');
            assert.equal((await generateSecurityReport(pool, 6)).period, '6h');
            assert.deepEqual(seen.map(p => p[0]), [24, 8760, 6], 'the report names the window it queried');
            const failing = { async query() { throw new Error('relation "transactions" does not exist'); } };
            const report = await generateSecurityReport(failing, 24);
            assert.ok(report.error, 'a failed query is reported, not thrown');
        } finally {
            console.log = quiet;
        }
        pass('The security report reports the window it actually queried.');
    }
    console.log('Account hygiene tests passed.');
}

module.exports = runAccountHygieneTests;

if (require.main === module) {
    runAccountHygieneTests().catch(error => { console.error(error); process.exitCode = 1; });
}
