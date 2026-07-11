'use strict';

// Default is a read-only report:
//   npm run games:reconcile
//
// Apply the reviewed refunds/status transitions:
//   npm run games:reconcile -- --execute
require('dotenv').config();
const { Pool } = require('pg');
const {
    DEFAULT_BATCH_LIMIT,
    DEFAULT_GRACE_MS,
    reconcileAbandonedGames,
} = require('../src/maintenance/abandonedGameRecovery');

function parseArgs(argv) {
    const options = {
        execute: false,
        graceMs: DEFAULT_GRACE_MS,
        limit: DEFAULT_BATCH_LIMIT,
    };

    for (const arg of argv) {
        if (arg === '--execute') {
            options.execute = true;
        } else if (arg.startsWith('--grace-hours=')) {
            const hours = Number(arg.slice('--grace-hours='.length));
            if (!Number.isFinite(hours) || hours < 1) {
                throw new Error('--grace-hours must be at least 1.');
            }
            options.graceMs = Math.round(hours * 60 * 60 * 1000);
        } else if (arg.startsWith('--limit=')) {
            const limit = Number(arg.slice('--limit='.length));
            if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
                throw new Error('--limit must be an integer from 1 through 1000.');
            }
            options.limit = limit;
        } else if (arg === '--help' || arg === '-h') {
            options.help = true;
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }
    return options;
}

function printHelp(output = console) {
    output.log(`Usage: node scripts/reconcile-abandoned-games.js [options]

Options:
  --execute           Atomically refund and terminalize eligible games.
  --grace-hours=N     Required inactivity age (default: 6, minimum: 1).
  --limit=N           Maximum games in this batch (default: ${DEFAULT_BATCH_LIMIT}, max: 1000).
  --help, -h          Show this help.

Without --execute this command is a dry run. Refunds are derived only from
persisted negative funded-player buy-in ledger rows. Games with unexpected ledger
activity are quarantined for manual review instead of being overpaid.`);
}

function printCandidate(candidate, output = console) {
    const total = candidate.refundTotal.toFixed(2);
    output.log(
        `  game #${candidate.gameId} table=${candidate.tableId || 'unknown'} `
        + `last_activity=${candidate.lastActivityAt} funded_players=${candidate.fundedPlayerCount ?? candidate.fundedHumanCount} `
        + `refund_total=${total}`,
    );
}

async function runCli({
    argv = process.argv.slice(2),
    env = process.env,
    PoolClass = Pool,
    reconcile = reconcileAbandonedGames,
    output = console,
} = {}) {
    const options = parseArgs(argv);
    if (options.help) {
        printHelp(output);
        return;
    }
    if (!env.POSTGRES_CONNECT_STRING) {
        const error = new Error('POSTGRES_CONNECT_STRING is required.');
        error.code = 'RECOVERY_CONFIG_REQUIRED';
        throw error;
    }

    const pool = new PoolClass({
        connectionString: env.POSTGRES_CONNECT_STRING,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 30000,
    });
    try {
        output.log(options.execute ? 'EXECUTE MODE' : 'DRY RUN - no ledger or game rows will change');
        output.log(`Grace window: ${(options.graceMs / 3600000).toFixed(2)} hours; batch limit: ${options.limit}`);
        const result = await reconcile(pool, options);
        output.log(`Eligible abandoned games: ${result.candidates.length}`);
        result.candidates.forEach(candidate => printCandidate(candidate, output));

        if (!options.execute) {
            output.log('Dry run complete. Review the game-level totals, then rerun with --execute.');
            return result;
        }

        for (const item of result.results) {
            const refundTotal = ((item.refundTotalCents || 0) / 100).toFixed(2);
            output.log(`  game #${item.gameId}: ${item.status}; refunded=${refundTotal}`);
        }
        const deferred = result.deferred || [];
        for (const item of deferred) {
            output.error(`  game #${item.gameId}: deferred; retry required`);
        }
        for (const error of result.errors) {
            output.error(`  game #${error.gameId}: failed (${safeErrorCode(error.code)})`);
        }
        output.log(
            `Execution complete: ${result.results.length} processed; `
            + `${deferred.length} deferred; ${result.errors.length} error(s).`,
        );
        if (result.errors.length > 0 || deferred.length > 0) process.exitCode = 1;
        return result;
    } finally {
        await pool.end();
    }
}

function safeErrorCode(value) {
    return typeof value === 'string' && /^[A-Z0-9_]{1,64}$/.test(value)
        ? value
        : 'RECOVERY_ERROR';
}

if (require.main === module) {
    runCli().catch(error => {
        console.error(`Abandoned-game reconciliation failed (${safeErrorCode(error.code)}).`);
        process.exitCode = 1;
    });
}

module.exports = { parseArgs, runCli, safeErrorCode };
