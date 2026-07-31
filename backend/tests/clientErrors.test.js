'use strict';

// The crash-report intake is a public endpoint, which makes its bounds the
// whole point: everything oversized is clipped, everything invalid is a silent
// 204 (nothing for a prober to learn), and nothing about the caller's account
// is stored even if they are signed in.

const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const createErrorRoutes = require('../src/api/errors');
const { LIMITS } = createErrorRoutes;

function createPool() {
    const inserts = [];
    return {
        inserts,
        query(text, params) {
            if (String(text).includes('INSERT INTO client_errors')) {
                inserts.push(params);
                return Promise.resolve({ rows: [], rowCount: 1 });
            }
            return Promise.resolve({ rows: [], rowCount: 0 });
        },
    };
}

async function withServer(pool, run) {
    const app = express();
    app.use(express.json({ limit: '100kb' }));
    app.use('/api/errors', createErrorRoutes(pool, { verify: (t, s, cb) => cb(new Error('no tokens in this test')) }));
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
        await run(base);
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
}

async function post(base, body) {
    return fetch(`${base}/api/errors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'u'.repeat(1000) },
        body: JSON.stringify(body),
    });
}

async function run() {
    const pool = createPool();
    await withServer(pool, async (base) => {
        // Happy path: stored, clipped, and no identity fields at all.
        const ok = await post(base, {
            message: 'm'.repeat(LIMITS.message + 500),
            stack: 's'.repeat(LIMITS.stack + 500),
            url: '/game',
            buildId: 'b'.repeat(LIMITS.buildId + 10),
            // A hostile client volunteering identity must not smuggle it in.
            userId: 42,
            username: 'sneaky',
        });
        assert.equal(ok.status, 204);
        assert.equal(pool.inserts.length, 1);
        const [message, stack, url, buildId, userAgent] = pool.inserts[0];
        assert.equal(message.length, LIMITS.message, 'message clipped');
        assert.equal(stack.length, LIMITS.stack, 'stack clipped');
        assert.equal(url, '/game');
        assert.equal(buildId.length, LIMITS.buildId, 'build id clipped');
        assert.equal(userAgent.length, LIMITS.userAgent, 'user agent clipped');
        assert.equal(pool.inserts[0].length, 5, 'exactly five columns — no identity ever stored');

        // Invalid bodies: same 204 as success, nothing stored, nothing to probe.
        for (const bad of [{}, { message: '' }, { message: '   ' }, { message: 42 }]) {
            const res = await post(base, bad);
            assert.equal(res.status, 204, `invalid body ${JSON.stringify(bad)} still 204s`);
        }
        assert.equal(pool.inserts.length, 1, 'invalid bodies stored nothing');
    });

    // A database failure returns the same 204: crash reporting must never cause
    // a second failure on a client that is already broken.
    const failingPool = {
        query: () => Promise.reject(new Error('db down')),
    };
    await withServer(failingPool, async (base) => {
        const res = await post(base, { message: 'boom' });
        assert.equal(res.status, 204);
    });

    console.log('Client crash-report intake tests passed.');
}

if (require.main === module) {
    run().catch(error => { console.error(error); process.exit(1); });
}

module.exports = run;
