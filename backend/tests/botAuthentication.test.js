const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const createAuthRoutes = require('../src/api/auth');

async function listen(server) {
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
}

async function close(server) {
    await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
    });
}

function createPool() {
    const queries = [];
    const bot = {
        id: 77,
        username: 'Mike Knight',
        email: 'mike-knight@bots.sluff.invalid',
        password_hash: '$server-only$sha256$test',
        is_bot: true,
        is_verified: true,
        verification_token: 'bot-verification-token',
        password_reset_token: 'bot-reset-token',
    };

    async function query(text, params = []) {
        const sql = String(text);
        queries.push({ text: sql, params });
        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql.trim())) return { rows: [] };
        if (/SELECT[\s\S]*FROM\s+users/i.test(sql)) {
            // Model PostgreSQL's human-account predicate: the bot exists, but
            // user-facing credential lookups must never be able to select it.
            if (/COALESCE\(is_bot, FALSE\)\s*=\s*FALSE/i.test(sql)) return { rows: [] };
            return { rows: [{ ...bot }] };
        }
        throw new Error(`Unexpected bot-authentication query: ${sql}`);
    }

    const client = { query, release() {} };
    return {
        pool: {
            query,
            connect: async () => client,
        },
        queries,
    };
}

async function runBotAuthenticationTests() {
    const { pool, queries } = createPool();
    let passwordComparisons = 0;
    const bcrypt = {
        async compare() {
            passwordComparisons += 1;
            return true;
        },
        async hash() {
            throw new Error('bot credential routes must not hash a password');
        },
    };
    const jwt = {
        verify() {
            throw new Error('these public credential routes do not authenticate JWTs');
        },
        sign() {
            throw new Error('a bot login must never mint a JWT');
        },
    };
    const io = { emit() {} };
    const app = express();
    app.use(express.json());
    app.use('/api/auth', createAuthRoutes(pool, bcrypt, jwt, io));
    const server = http.createServer(app);

    await listen(server);
    const { port } = server.address();
    const url = path => `http://127.0.0.1:${port}/api/auth${path}`;

    try {
        const login = await fetch(url('/login'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'mike-knight@bots.sluff.invalid', password: 'anything' }),
        });
        assert.equal(login.status, 401);
        assert.equal(passwordComparisons, 0, 'bot records are filtered before password comparison');

        const requestReset = await fetch(url('/request-password-reset'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'mike-knight@bots.sluff.invalid' }),
        });
        assert.equal(requestReset.status, 200);

        const reset = await fetch(url('/reset-password'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: 'bot-reset-token', password: 'new-password' }),
        });
        assert.equal(reset.status, 400);

        const verify = await fetch(url('/verify-email'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: 'bot-verification-token' }),
        });
        assert.equal(verify.status, 404);

        const resend = await fetch(url('/resend-verification'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'mike-knight@bots.sluff.invalid' }),
        });
        assert.equal(resend.status, 200);

        const credentialLookups = queries.filter(({ text }) => /SELECT[\s\S]*FROM\s+users/i.test(text));
        assert.equal(credentialLookups.length, 5);
        for (const { text } of credentialLookups) {
            assert.match(text, /COALESCE\(is_bot, FALSE\)\s*=\s*FALSE/i);
        }
    } finally {
        await close(server);
    }

    console.log('Bot credential-isolation tests passed.');
}

if (require.main === module) {
    runBotAuthenticationTests().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = runBotAuthenticationTests;
