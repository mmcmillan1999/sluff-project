#!/usr/bin/env node
// backend/scripts/rotate-render-secrets.js
//
// Rotates the production secrets that once sat in git history (see
// docs/CREDENTIAL_HISTORY_CLEANUP.md): the Render Postgres credential and
// JWT_SECRET. Also removes the two retired variables (AI_SECRET_KEY,
// ADMIN_SECRET) if they are still set. Dry run by default.
//
//   node backend/scripts/rotate-render-secrets.js             # plan only
//   node backend/scripts/rotate-render-secrets.js --execute   # do it
//
//   --force       skip the mid-game check (players get bounced)
//   --skip-db     rotate JWT_SECRET only
//   --skip-jwt    rotate the database credential only
//   --deploys     read-only: the last eight deploys (status, commit, trigger)
//   --check-env   read-only: list the service's env var NAMES and whether
//                 NODE_ENV=production; rotates nothing, needs no --execute
//   --set-node-env  with --execute: set NODE_ENV=production and redeploy
//                 (dev CORS origins and HTML stack traces are gated on it)
//
// Needs RENDER_API_KEY in backend/.env (Render → Account Settings → API Keys).
// The key is for this script only; never put it on Render itself.
//
// What it prints: key NAMES, usernames, deploy ids, statuses. Never a value.
//
// Safety order for the database credential:
//   1. create the new Render Postgres user (it becomes the default user)
//   2. prove the new user can SELECT and ALTER TABLE (boot runs ALTERs)
//   3. only then switch POSTGRES_CONNECT_STRING and deploy
//   4. only after /health is green on the new instance, deactivate the old user
// Any failure before step 3 deletes the new user and changes nothing. A failed
// deploy puts the old connection string back (the old user still works).
//
// JWT_SECRET rotation invalidates every 90-day login token on purpose; the
// client logs itself out on the next "Authentication error" and shows the
// sign-in screen. Rotating while people are mid-game bounces them, which is
// why the mid-game check gates --execute.

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const BACKEND_DIR = path.resolve(__dirname, '..');
const ENV_PATH = path.join(BACKEND_DIR, '.env');
const ROTATION_DOC = path.resolve(BACKEND_DIR, '..', 'docs', 'CREDENTIAL_HISTORY_CLEANUP.md');
require('dotenv').config({ path: ENV_PATH });
const { Client } = require('pg');

const API = 'https://api.render.com/v1';
const SERVICE_NAME = process.env.RENDER_SERVICE_NAME || 'sluff-backend';
const HEALTH_URL = process.env.RENDER_HEALTH_URL || 'https://sluff-backend.onrender.com/health';
const RETIRED_KEYS = ['AI_SECRET_KEY', 'ADMIN_SECRET'];

const args = new Set(process.argv.slice(2));
const EXECUTE = args.has('--execute');
const FORCE = args.has('--force');
const ROTATE_DB = !args.has('--skip-db');
const ROTATE_JWT = !args.has('--skip-jwt');
const CHECK_ENV = args.has('--check-env');
const LIST_DEPLOYS = args.has('--deploys');
const SET_NODE_ENV = args.has('--set-node-env');

const log = (...parts) => console.log(...parts);
const step = (title) => console.log(`\n== ${title}`);
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function fail(message) {
    console.error(`\nABORT: ${message}`);
    process.exit(1);
}

// ---------------------------------------------------------------- Render API
async function api(method, route, body) {
    const response = await fetch(`${API}${route}`, {
        method,
        headers: {
            Authorization: `Bearer ${process.env.RENDER_API_KEY}`,
            Accept: 'application/json',
            ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (error) { json = null; }
    if (!response.ok) {
        // Error bodies carry id/message/code — never echo a success body, some
        // of those contain values.
        const detail = json && json.message ? json.message : `HTTP ${response.status}`;
        const error = new Error(`${method} ${route} -> ${response.status}: ${detail}`);
        error.status = response.status;
        throw error;
    }
    return json;
}

// List endpoints wrap each item as { cursor, <kind>: {...} }; unwrap either shape.
function unwrap(list) {
    if (!Array.isArray(list)) return [];
    return list.map(item => {
        if (item && typeof item === 'object' && 'cursor' in item) {
            const key = Object.keys(item).find(k => k !== 'cursor');
            return key ? item[key] : item;
        }
        return item;
    });
}

async function findService() {
    const services = unwrap(await api('GET', `/services?name=${encodeURIComponent(SERVICE_NAME)}&limit=50`));
    const matches = services.filter(s => s.name === SERVICE_NAME);
    if (matches.length !== 1) {
        fail(`Expected exactly one service named "${SERVICE_NAME}", found ${matches.length}: ${services.map(s => s.name).join(', ') || '(none)'}`);
    }
    return matches[0];
}

async function readEnvVars(serviceId) {
    const vars = unwrap(await api('GET', `/services/${serviceId}/env-vars?limit=100`));
    const map = new Map();
    for (const v of vars) if (v && v.key) map.set(v.key, v.value);
    return map;
}

async function findPostgres(currentUrl) {
    const host = safeHost(currentUrl);
    const dbs = unwrap(await api('GET', '/postgres?limit=50'));
    const match = dbs.find(db => host && db.id && host.startsWith(db.id));
    if (!match) {
        fail(`No Render Postgres instance matches the host of the current POSTGRES_CONNECT_STRING. Instances: ${dbs.map(d => `${d.name} (${d.id})`).join(', ') || '(none)'}`);
    }
    return match;
}

const listCredentials = (pgId) => api('GET', `/postgres/${pgId}/credentials`).then(unwrap);
const connectionInfo = (pgId) => api('GET', `/postgres/${pgId}/connection-info`);

// ---------------------------------------------------------------- URL helpers
function safeHost(url) {
    try { return new URL(url).hostname; } catch (error) { return ''; }
}
function safeUser(url) {
    try { return decodeURIComponent(new URL(url).username); } catch (error) { return ''; }
}
function safeQuery(url) {
    try { return new URL(url).search; } catch (error) { return ''; }
}
function usesExternalHost(url) {
    return /\.render\.com$/i.test(safeHost(url));
}

// ---------------------------------------------------------------- database probes
async function probe(url, label) {
    const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
    try {
        await client.connect();
        const { rows } = await client.query('SELECT COUNT(*)::int AS n FROM users');
        // Boot runs ALTER TABLE ... ADD COLUMN IF NOT EXISTS on every start, so
        // the app user must own (or inherit ownership of) the tables. Prove it
        // inside a transaction and roll it back.
        await client.query('BEGIN');
        await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS __rotation_probe INTEGER');
        await client.query('ROLLBACK');
        log(`   ${label}: connect OK, SELECT OK (${rows[0].n} users), ALTER OK`);
        return { ok: true };
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch (ignored) { /* not in a tx */ }
        log(`   ${label}: FAILED — ${error.message}`);
        return { ok: false, reason: error.message };
    } finally {
        await client.end().catch(() => {});
    }
}

// Postgres <= 15 lets a role grant membership in itself. Membership with
// INHERIT gives the new user the old user's ownership privileges, which is
// exactly what boot-time ALTERs need if Render did not grant them already.
async function grantInherit(oldUrl, oldUser, newUser) {
    const client = new Client({ connectionString: oldUrl, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
    try {
        await client.connect();
        await client.query(`GRANT "${oldUser.replace(/"/g, '""')}" TO "${newUser.replace(/"/g, '""')}"`);
        log(`   granted membership of ${oldUser} to ${newUser}`);
        return true;
    } catch (error) {
        log(`   GRANT failed — ${error.message}`);
        return false;
    } finally {
        await client.end().catch(() => {});
    }
}

async function expectAuthFailure(url, label) {
    const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
    try {
        await client.connect();
        log(`   ${label}: still connects (Render may take a moment to revoke login)`);
        return false;
    } catch (error) {
        log(`   ${label}: refused as expected`);
        return true;
    } finally {
        await client.end().catch(() => {});
    }
}

// ---------------------------------------------------------------- deploy plumbing
function deployCheck() {
    const result = spawnSync(process.execPath, [path.join(__dirname, 'deploy-safety-check.js')], { cwd: BACKEND_DIR, encoding: 'utf8' });
    if (result.stdout) process.stdout.write(result.stdout.split('\n').map(l => `   ${l}`).join('\n') + '\n');
    if (result.stderr) process.stderr.write(result.stderr);
    return result.status;
}

async function triggerDeploy(serviceId) {
    const deploy = await api('POST', `/services/${serviceId}/deploys`, { clearCache: 'do_not_clear' });
    const record = deploy && deploy.deploy ? deploy.deploy : deploy;
    return record.id;
}

async function waitForDeploy(serviceId, deployId, timeoutMs = 15 * 60 * 1000) {
    const started = Date.now();
    let last = '';
    while (Date.now() - started < timeoutMs) {
        const deploy = await api('GET', `/services/${serviceId}/deploys/${deployId}`);
        const record = deploy && deploy.deploy ? deploy.deploy : deploy;
        if (record.status !== last) { log(`   deploy ${deployId}: ${record.status}`); last = record.status; }
        if (record.status === 'live') return true;
        if (['build_failed', 'update_failed', 'canceled', 'deactivated', 'pre_deploy_failed'].includes(record.status)) return false;
        await sleep(10000);
    }
    log('   deploy wait timed out');
    return false;
}

async function waitForHealth(timeoutMs = 3 * 60 * 1000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        try {
            const response = await fetch(HEALTH_URL, { headers: { Accept: 'application/json' } });
            const json = await response.json().catch(() => null);
            if (response.ok && json && json.db === 'up') {
                log(`   ${HEALTH_URL}: ${json.status}, db ${json.db}, uptime ${json.uptime}s`);
                return true;
            }
            log(`   ${HEALTH_URL}: ${response.status} ${json ? JSON.stringify(json) : ''}`);
        } catch (error) {
            log(`   ${HEALTH_URL}: ${error.message}`);
        }
        await sleep(10000);
    }
    return false;
}

// ---------------------------------------------------------------- local files
function updateLocalEnv(key, value) {
    if (!fs.existsSync(ENV_PATH)) return false;
    const original = fs.readFileSync(ENV_PATH, 'utf8');
    const eol = original.includes('\r\n') ? '\r\n' : '\n';
    const lines = original.split(/\r?\n/);
    const index = lines.findIndex(line => line.startsWith(`${key}=`));
    const quoted = index >= 0 && /^[A-Z_]+="/.test(lines[index]);
    const rendered = `${key}=${quoted ? `"${value}"` : value}`;
    if (index >= 0) lines[index] = rendered; else lines.push(rendered);
    fs.writeFileSync(ENV_PATH, lines.join(eol));
    return true;
}

function appendRotationLog(entries) {
    const stamp = new Date().toISOString();
    let doc = fs.existsSync(ROTATION_DOC) ? fs.readFileSync(ROTATION_DOC, 'utf8') : '# Credential history cleanup\n';
    const eol = doc.includes('\r\n') ? '\r\n' : '\n';
    if (!/^## Rotation log/m.test(doc)) {
        doc = doc.replace(/\s*$/, '') + eol + eol + '## Rotation log' + eol + eol
            + 'Anything published before the latest entry below is dead. Entries are appended by' + eol
            + '`backend/scripts/rotate-render-secrets.js`; never record a value here, only what was rotated.' + eol;
    }
    doc = doc.replace(/\s*$/, '') + eol + eol + `- **${stamp}** — ${entries.join(' ')}` + eol;
    fs.writeFileSync(ROTATION_DOC, doc);
    return stamp;
}

// ---------------------------------------------------------------- main
async function main() {
    if (!process.env.RENDER_API_KEY) {
        fail('RENDER_API_KEY is not set. Create one at Render → Account Settings → API Keys and add RENDER_API_KEY=... to backend/.env (gitignored).');
    }
    if (LIST_DEPLOYS) {
        // Read-only: the last few deploys, so 'did that push restart the server?'
        // has an answer that is not inferred from /health uptime.
        const service = await findService();
        const deploys = unwrap(await api('GET', `/services/${service.id}/deploys?limit=8`));
        for (const d of deploys) {
            const commit = d.commit?.id ? d.commit.id.slice(0, 7) : '-';
            log(`   ${d.createdAt || '?'}  ${String(d.status).padEnd(18)} ${commit}  ${d.trigger || ''}  ${(d.commit?.message || '').split('\n')[0].slice(0, 60)}`);
        }
        return;
    }
    if (CHECK_ENV || SET_NODE_ENV) {
        const service = await findService();
        const envVars = await readEnvVars(service.id);
        log(`Service ${service.name} (${service.id}) — ${envVars.size} environment variables (names only):`);
        for (const key of [...envVars.keys()].sort()) log(`   ${key}`);
        const nodeEnv = envVars.get('NODE_ENV');
        log(`NODE_ENV: ${nodeEnv === undefined ? 'ABSENT' : nodeEnv === 'production' ? 'production' : 'set, not production'}`);
        if (!SET_NODE_ENV) return;
        if (nodeEnv === 'production') { log('Nothing to do.'); return; }
        if (!EXECUTE) { log('Add --execute to set NODE_ENV=production and redeploy.'); return; }
        const checkStatus = deployCheck();
        if (checkStatus !== 0 && !FORCE) fail('A human is mid-game. Wait or re-run with --force.');
        await api('PUT', `/services/${service.id}/env-vars/NODE_ENV`, { value: 'production' });
        log('NODE_ENV=production set');
        const deployId = await triggerDeploy(service.id);
        const live = await waitForDeploy(service.id, deployId);
        const healthy = live && await waitForHealth();
        if (!healthy) fail(`Deploy ${deployId} did not come up healthy; check the Render dashboard.`);
        appendRotationLog(['NODE_ENV=production set on the service (dev CORS origins and verbose errors now off).', `Deploy ${deployId} live, /health green.`]);
        log('Done and recorded.');
        return;
    }
    log(EXECUTE ? 'MODE: EXECUTE — this changes production.' : 'MODE: dry run — nothing will change. Add --execute to rotate.');
    log(`Rotating: ${[ROTATE_DB && 'database credential', ROTATE_JWT && 'JWT_SECRET'].filter(Boolean).join(' + ') || 'nothing (both skipped)'}`);

    step('Service');
    const service = await findService();
    log(`   ${service.name} (${service.id}) — ${service.suspended === 'suspended' ? 'SUSPENDED' : 'active'}, autoDeploy ${service.autoDeploy || '?'}`);
    if (service.suspended === 'suspended') fail('The service is suspended; resume it in the Render dashboard first.');

    step('Environment variables on the service (names only)');
    const envVars = await readEnvVars(service.id);
    for (const key of ['POSTGRES_CONNECT_STRING', 'JWT_SECRET', ...RETIRED_KEYS]) {
        log(`   ${key}: ${envVars.has(key) ? 'present' : 'absent'}`);
    }
    const currentDbUrl = envVars.get('POSTGRES_CONNECT_STRING') || '';
    if (ROTATE_DB && !currentDbUrl) fail('POSTGRES_CONNECT_STRING is not set on the service.');
    if (ROTATE_JWT && !envVars.has('JWT_SECRET')) fail('JWT_SECRET is not set on the service.');
    const retiredPresent = RETIRED_KEYS.filter(key => envVars.has(key));

    let postgres = null;
    let oldUser = '';
    let newUser = '';
    if (ROTATE_DB) {
        step('Database');
        postgres = await findPostgres(currentDbUrl);
        oldUser = safeUser(currentDbUrl);
        log(`   ${postgres.name} (${postgres.id}), service connects as "${oldUser}" via the ${usesExternalHost(currentDbUrl) ? 'external' : 'internal'} host`);
        const creds = await listCredentials(postgres.id);
        for (const c of creds) log(`   user ${c.username}${c.default ? ' (default)' : ''}, ${c.openConnections ?? '?'} open connections`);
        if (!creds.some(c => c.username === oldUser)) fail(`The connection string's user "${oldUser}" is not among the database's credentials.`);
        const localUrl = process.env.POSTGRES_CONNECT_STRING || '';
        if (localUrl && safeUser(localUrl) !== oldUser) {
            log(`   note: backend/.env connects as "${safeUser(localUrl)}", not "${oldUser}"; it will not be rewritten.`);
        }
        const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        newUser = `sluff_app_${day}`;
        let suffix = 1;
        while (creds.some(c => c.username === newUser)) newUser = `sluff_app_${day}_${++suffix}`;
        log(`   new user will be "${newUser}"`);
    }

    step('Mid-game check');
    const checkStatus = deployCheck();
    if (checkStatus === 1 && !FORCE) {
        fail('A human is mid-game. Wait for the check to clear or re-run with --force to bounce them.');
    }
    if (checkStatus !== 0 && checkStatus !== 1) log(`   (check could not run, exit ${checkStatus}; continuing on ${FORCE ? '--force' : 'your say-so if you add --force'})`);
    if (checkStatus !== 0 && !FORCE) fail('Mid-game check did not pass.');

    if (!EXECUTE) {
        step('Plan');
        if (ROTATE_DB) log(`   1. create Postgres user "${newUser}", prove SELECT + ALTER, read its connection string`);
        if (ROTATE_JWT) log(`   ${ROTATE_DB ? 2 : 1}. generate a new 64-char JWT_SECRET`);
        log(`   ${ROTATE_DB && ROTATE_JWT ? 3 : 2}. update the env vars${retiredPresent.length ? `, delete ${retiredPresent.join(' and ')}` : ''}, trigger a deploy, wait for live + /health`);
        if (ROTATE_DB) log(`   4. rewrite POSTGRES_CONNECT_STRING in backend/.env, then deactivate "${oldUser}"`);
        log('   5. append the timestamped entry to docs/CREDENTIAL_HISTORY_CLEANUP.md');
        log('\nDry run complete. Re-run with --execute.');
        return;
    }

    // ------------------------------------------------------------ execute
    const logEntries = [];
    let newDbUrlForService = '';
    let newDbUrlExternal = '';

    if (ROTATE_DB) {
        step(`Creating Postgres user "${newUser}"`);
        await api('POST', `/postgres/${postgres.id}/credentials`, { username: newUser });
        let ready = false;
        for (let i = 0; i < 18 && !ready; i++) {
            await sleep(5000);
            const creds = await listCredentials(postgres.id);
            const mine = creds.find(c => c.username === newUser);
            if (mine && mine.default) ready = true;
            else log(`   waiting for "${newUser}" to become the default user…`);
        }
        if (!ready) {
            await api('DELETE', `/postgres/${postgres.id}/credentials/${encodeURIComponent(newUser)}`).catch(() => {});
            fail('The new user never became the default user; deleted it. Nothing changed.');
        }
        let info = null;
        for (let i = 0; i < 6; i++) {
            info = await connectionInfo(postgres.id);
            if (safeUser(info.externalConnectionString) === newUser) break;
            log('   connection info not yet on the new user, retrying…');
            await sleep(5000);
            info = null;
        }
        if (!info) {
            await api('DELETE', `/postgres/${postgres.id}/credentials/${encodeURIComponent(newUser)}`).catch(() => {});
            fail('Connection info never reflected the new user; deleted it. Nothing changed.');
        }
        const query = safeQuery(currentDbUrl);
        const withQuery = (url) => (query && !url.includes('?') ? url + query : url);
        newDbUrlExternal = withQuery(info.externalConnectionString);
        newDbUrlForService = withQuery(usesExternalHost(currentDbUrl) ? info.externalConnectionString : info.internalConnectionString);

        step('Proving the new user can run the app');
        let result = await probe(newDbUrlExternal, newUser);
        if (!result.ok) {
            log('   trying to inherit the old user\'s ownership…');
            if (await grantInherit(currentDbUrl, oldUser, newUser)) result = await probe(newDbUrlExternal, newUser);
        }
        if (!result.ok) {
            await api('DELETE', `/postgres/${postgres.id}/credentials/${encodeURIComponent(newUser)}`).catch(() => {});
            fail(`"${newUser}" cannot run the app (${result.reason}); deleted it. Nothing changed. The old credential still works.`);
        }
    }

    let newJwt = '';
    if (ROTATE_JWT) {
        newJwt = crypto.randomBytes(48).toString('base64url');
    }

    step('Updating environment variables');
    if (ROTATE_DB) { await api('PUT', `/services/${service.id}/env-vars/POSTGRES_CONNECT_STRING`, { value: newDbUrlForService }); log('   POSTGRES_CONNECT_STRING set'); }
    if (ROTATE_JWT) { await api('PUT', `/services/${service.id}/env-vars/JWT_SECRET`, { value: newJwt }); log('   JWT_SECRET set'); }
    for (const key of retiredPresent) { await api('DELETE', `/services/${service.id}/env-vars/${key}`); log(`   ${key} deleted`); }

    step('Deploying');
    const deployId = await triggerDeploy(service.id);
    const live = await waitForDeploy(service.id, deployId);
    const healthy = live && await waitForHealth();
    if (!healthy) {
        step('Deploy did not come up healthy — rolling the database change back');
        if (ROTATE_DB) {
            await api('PUT', `/services/${service.id}/env-vars/POSTGRES_CONNECT_STRING`, { value: currentDbUrl }).catch(e => log(`   restore failed: ${e.message}`));
            log('   POSTGRES_CONNECT_STRING restored to the old user (still valid)');
            await api('DELETE', `/postgres/${postgres.id}/credentials/${encodeURIComponent(newUser)}`).catch(e => log(`   delete new user failed: ${e.message}`));
            log(`   "${newUser}" deleted`);
            const redo = await triggerDeploy(service.id).catch(() => null);
            if (redo) { log(`   redeploying with the old connection string (${redo})`); await waitForDeploy(service.id, redo); }
        }
        fail(`Deploy ${deployId} failed or /health stayed red. JWT_SECRET ${ROTATE_JWT ? 'IS rotated (the next good deploy uses it)' : 'untouched'}; check the Render dashboard.`);
    }

    if (ROTATE_DB) {
        step('Cutting over local development');
        if (process.env.POSTGRES_CONNECT_STRING && safeUser(process.env.POSTGRES_CONNECT_STRING) === oldUser) {
            updateLocalEnv('POSTGRES_CONNECT_STRING', newDbUrlExternal);
            log('   backend/.env POSTGRES_CONNECT_STRING rewritten to the new user (external host)');
        } else {
            log('   backend/.env left alone (it did not use the old user)');
        }

        step(`Deactivating old user "${oldUser}"`);
        await api('DELETE', `/postgres/${postgres.id}/credentials/${encodeURIComponent(oldUser)}`);
        await sleep(5000);
        await expectAuthFailure(currentDbUrl, oldUser);
        logEntries.push(`Render Postgres credential rotated: user "${oldUser}" deactivated, service now connects as "${newUser}".`);
    }
    if (ROTATE_JWT) {
        logEntries.push('JWT_SECRET regenerated (64 chars, CSPRNG); every login token issued before this moment is invalid.');
    }
    if (retiredPresent.length) logEntries.push(`Removed retired variables: ${retiredPresent.join(', ')}.`);
    else logEntries.push(`Confirmed ${RETIRED_KEYS.join(' and ')} are absent from the service.`);
    logEntries.push(`Deploy ${deployId} live, /health green.`);

    step('Recording');
    const stamp = appendRotationLog(logEntries);
    log(`   docs/CREDENTIAL_HISTORY_CLEANUP.md: entry stamped ${stamp}`);

    log('\nRotation complete. Commit the doc change. Anything published before that stamp is dead.');
    if (ROTATE_DB) log('Reminder: the dormant sluff-backend-pilot service (if it still exists) holds the OLD connection string and will not start until it is updated or deleted.');
}

main().catch(error => {
    console.error(`\nFAILED: ${error.message}`);
    process.exit(1);
});
