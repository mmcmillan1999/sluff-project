'use strict';

// Safe default: read-only preview.
//   npm run tokens:reset-alpha2
// Explicit execution after backup/audit and exact preview review:
//   npm run tokens:reset-alpha2 -- --execute --expected-hash=... --expected-season-id=...
require('dotenv').config();
const { Pool } = require('pg');
const {
    applyAlpha2WalletReset,
    previewAlpha2WalletReset,
} = require('../src/services/alpha2WalletResetService');

function parseArgs(argv) {
    const options = {
        execute: false,
        expectedPreviewHash: null,
        expectedSeasonId: null,
    };
    for (const arg of argv) {
        if (arg === '--execute') {
            options.execute = true;
        } else if (arg.startsWith('--expected-hash=')) {
            options.expectedPreviewHash = arg.slice('--expected-hash='.length).trim();
        } else if (arg.startsWith('--expected-season-id=')) {
            options.expectedSeasonId = Number(arg.slice('--expected-season-id='.length));
        } else if (arg === '--help' || arg === '-h') {
            options.help = true;
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }
    if (options.execute && (!options.expectedPreviewHash || !options.expectedSeasonId)) {
        throw new Error('--execute requires --expected-hash and --expected-season-id from a fresh preview.');
    }
    return options;
}

function printHelp(output = console) {
    output.log(`Usage: node scripts/reset-alpha2-wallets.js [options]

No options              Run a READ ONLY preview; this is the default.
--execute               Apply the one-time Alpha Season 2 wallet reset.
--expected-hash=HASH    Exact hash printed by a fresh preview.
--expected-season-id=N  Exact season id printed by a fresh preview.
--help, -h              Show this help.

Execution must follow a fresh backup and token-accounting audit. The command
never rewrites history: it adds admin_adjustment ledger rows to reach 8.00.`);
}

function printResult(result, output = console) {
    const summary = result.summary;
    output.log(result.alreadyApplied
        ? 'ALPHA SEASON 2 WALLET RESET ALREADY APPLIED'
        : (result.canApply === false && result.operation
            ? 'ALPHA SEASON 2 WALLET RESET APPLIED'
            : 'ALPHA SEASON 2 WALLET RESET READ-ONLY PREVIEW'));
    output.log(`Season: ${result.season.name} (id ${result.season.id})`);
    output.log(`Target per account: ${result.targetTokens}`);
    output.log(`Accounts: ${summary.accountCount}; balances changing: ${summary.changedAccountCount}`);
    output.log(`Supply: ${summary.oldSupply} -> ${summary.newSupply}`);
    output.log(`Minted: ${summary.minted}; burned: ${summary.burned}; net: ${summary.net}`);
    output.log(`Current-season game rows: ${result.currentSeasonGameCount}`);
    output.log(`Preview hash: ${result.previewHash}`);
    output.log(`Can apply: ${result.canApply ? 'yes' : 'no'}`);
}

async function runCli({
    argv = process.argv.slice(2),
    env = process.env,
    PoolClass = Pool,
    preview = previewAlpha2WalletReset,
    apply = applyAlpha2WalletReset,
    output = console,
} = {}) {
    const options = parseArgs(argv);
    if (options.help) {
        printHelp(output);
        return null;
    }
    if (!env.POSTGRES_CONNECT_STRING) throw new Error('POSTGRES_CONNECT_STRING is required.');

    const pool = new PoolClass({
        connectionString: env.POSTGRES_CONNECT_STRING,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 30000,
    });
    try {
        const result = options.execute
            ? await apply(pool, {
                expectedPreviewHash: options.expectedPreviewHash,
                expectedSeasonId: options.expectedSeasonId,
                appliedBy: { username: 'maintenance-cli' },
            })
            : await preview(pool);
        printResult(result, output);
        return result;
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    runCli().catch(error => {
        console.error(`Alpha Season 2 wallet reset failed: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = { parseArgs, printHelp, printResult, runCli };
