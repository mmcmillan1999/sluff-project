'use strict';

// Read-only token audit:
//   npm run tokens:audit
//   npm run tokens:audit -- --username=Mcsaddle --limit=100
require('dotenv').config();
const { Pool } = require('pg');
const { auditTokenAccounting, parseLimit } = require('../src/maintenance/tokenAccountingAudit');

function parseArgs(argv) {
    const options = { username: null, limit: 50 };
    for (const arg of argv) {
        if (arg.startsWith('--username=')) {
            const username = arg.slice('--username='.length).trim();
            if (!username) throw new Error('--username cannot be blank.');
            options.username = username;
        } else if (arg.startsWith('--limit=')) {
            options.limit = parseLimit(arg.slice('--limit='.length));
        } else if (arg === '--help' || arg === '-h') {
            options.help = true;
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }
    return options;
}

function printHelp(output = console) {
    output.log(`Usage: node scripts/audit-token-accounting.js [options]

Options:
  --username=NAME   Limit account rows and anomalies to one player.
  --limit=N         Maximum rows per anomaly section (default: 50, max: 500).
  --help, -h        Show this help.

This command opens a PostgreSQL READ ONLY transaction. It never repairs,
deletes, or adjusts token history.`);
}

function money(value) {
    const number = Number(value || 0);
    return `${number >= 0 ? '+' : ''}${number.toFixed(2)}`;
}

function printSection(output, heading, rows, render) {
    output.log(`\n${heading}: ${rows.length}`);
    rows.forEach(row => output.log(`  ${render(row)}`));
}

function printReport(report, output = console) {
    output.log('READ-ONLY TOKEN ACCOUNTING AUDIT');
    output.log(`Scope: ${report.filter.username || 'all players'}; row limit: ${report.filter.limit}`);

    printSection(output, 'Account balances', report.accountSummary, row => (
        `#${row.user_id} ${row.username}: balance=${money(row.balance)} `
        + `credits=${money(row.total_credits)} debits=${money(row.total_debits)} `
        + `entries=${row.transaction_count}`
    ));
    printSection(output, 'Transaction types', report.typeTotals, row => (
        `${row.transaction_type}: net=${money(row.net_amount)} entries=${row.transaction_count}`
    ));
    printSection(output, 'Abandoned-game refunds', report.abandonedRefunds, row => {
        const lifecycle = row.recovery_eligible === true
            ? 'hardened-lifecycle'
            : 'legacy-or-unknown-lifecycle';
        return (
            `transaction #${row.transaction_id}, game #${row.game_id ?? 'unknown'}, ${row.username}: `
            + `${money(row.amount)} at ${row.transaction_time || 'unknown-time'} `
            + `lifecycle=${lifecycle} reconciliation=${row.reconciliation_status || 'none'} `
            + `idempotency=${row.idempotency_key || 'none'}`
        );
    });
    printSection(output, 'Quarantined legacy in-progress games', report.quarantinedLegacyGames, row => (
        `game #${row.game_id} ${row.theme || 'unknown-theme'}: `
        + `started=${row.start_time || 'unknown-time'} `
        + `last-activity=${row.last_activity_at || 'unknown-time'} `
        + `funded-players=${row.funded_user_count || 0} `
        + `funded-tokens=${money(row.funded_tokens)} `
        + `players=[${row.participants || ''}]`
    ));
    printSection(output, 'Games that created tokens', report.mintedGames, row => (
        `game #${row.game_id} ${row.theme || 'unknown-theme'}: created=${money(row.net_created)} `
        + `debits=${money(-Number(row.total_debits))} credits=${money(row.total_credits)} `
        + `${report.filter.username ? `selected-player-net=${money(row.selected_user_net)} ` : ''}`
        + `players=[${row.participants || ''}]`
    ));
    printSection(output, 'Duplicate game ledger entries', report.duplicateEntries, row => (
        `game #${row.game_id}, ${row.username}, ${row.transaction_type}: `
        + `${row.duplicate_count} rows totaling ${money(row.total_amount)} `
        + `[${row.transaction_ids.join(', ')}]`
    ));
    printSection(output, 'Payouts without a matching buy-in', report.unpairedPayouts, row => (
        `transaction #${row.transaction_id}, game #${row.game_id}, ${row.username}: `
        + `${row.transaction_type} ${money(row.amount)}`
    ));
    printSection(output, 'Invalid amount signs, zero entries, or mercy grants', report.invalidAmounts, row => (
        `transaction #${row.transaction_id}, ${row.username}: ${row.transaction_type} ${money(row.amount)}`
    ));
    printSection(output, 'Buy-ins that differ from table cost', report.buyInMismatches, row => (
        `transaction #${row.transaction_id}, game #${row.game_id}, ${row.username}: `
        + `${row.theme || 'unknown-theme'} actual=${money(row.actual_amount)} `
        + `expected=${row.expected_amount === null || row.expected_amount === undefined
            ? 'UNKNOWN THEME'
            : money(row.expected_amount)}`
    ));
}

async function runCli({
    argv = process.argv.slice(2),
    env = process.env,
    PoolClass = Pool,
    audit = auditTokenAccounting,
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
        const report = await audit(pool, options);
        printReport(report, output);
        return report;
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    runCli().catch(error => {
        console.error(`Token accounting audit failed: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = { money, parseArgs, printReport, runCli };
