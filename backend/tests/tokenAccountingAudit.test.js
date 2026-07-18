'use strict';

const assert = require('node:assert/strict');
const { TABLE_COSTS } = require('../src/core/constants');
const {
    ABANDONED_REFUNDS_QUERY,
    ACCOUNT_SUMMARY_QUERY,
    BUY_IN_MISMATCHES_QUERY,
    DUPLICATE_ENTRIES_QUERY,
    GAME_VOID_REVERSAL_ISSUES_QUERY,
    INVALID_AMOUNTS_QUERY,
    MINTED_GAMES_QUERY,
    QUARANTINED_LEGACY_GAMES_QUERY,
    THEME_COST_VALUES_SQL,
    TYPE_TOTALS_QUERY,
    UNPAIRED_PAYOUTS_QUERY,
    VOIDABLE_GAME_TRANSACTION_TYPES,
    auditTokenAccounting,
    buildThemeCostValuesSql,
    parseLimit,
} = require('../src/maintenance/tokenAccountingAudit');
const { money, parseArgs, printReport, runCli } = require('../scripts/audit-token-accounting');

function makeAuditPool({ failOn = null } = {}) {
    const calls = [];
    let released = false;
    let ended = false;
    const rowsByQuery = new Map([
        [ACCOUNT_SUMMARY_QUERY, [{ user_id: 13, username: 'Mcsaddle', balance: '42.00' }]],
        [TYPE_TOTALS_QUERY, [{ transaction_type: 'buy_in', transaction_count: 2, net_amount: '-2.00' }]],
        [ABANDONED_REFUNDS_QUERY, [{
            transaction_id: 81,
            game_id: 17,
            user_id: 13,
            username: 'Mcsaddle',
            amount: '20.00',
            transaction_time: '2026-07-11T20:00:00.000Z',
            recovery_eligible: null,
            reconciliation_status: 'abandoned_refunded',
            idempotency_key: 'abandoned-refund:17:13',
        }]],
        [QUARANTINED_LEGACY_GAMES_QUERY, [{
            game_id: 19,
            theme: 'fort-creek',
            start_time: '2025-07-11T20:00:00.000Z',
            last_activity_at: '2026-07-10T20:00:00.000Z',
            funded_user_count: 1,
            funded_tokens: '1.00',
            participants: 'Mcsaddle',
        }]],
        [MINTED_GAMES_QUERY, [{ game_id: 9, net_created: '2.00' }]],
        [DUPLICATE_ENTRIES_QUERY, []],
        [GAME_VOID_REVERSAL_ISSUES_QUERY, [{
            reversal_transaction_id: 102,
            game_id: 21,
            user_id: 13,
            username: 'Mcsaddle',
            source_transaction_id: 88,
            source_transaction_type: 'win_payout',
            source_amount: '3.00',
            reversal_amount: '-2.00',
            reconciliation_status: 'player_voided',
            has_game_void: true,
            issue: 'amount_not_exact_negation',
        }]],
        [UNPAIRED_PAYOUTS_QUERY, []],
        [INVALID_AMOUNTS_QUERY, []],
        [BUY_IN_MISMATCHES_QUERY, []],
    ]);
    const client = {
        async query(text, params = []) {
            calls.push({ text, params });
            if (text === failOn) throw new Error('injected audit failure');
            return { rows: rowsByQuery.get(text) || [], rowCount: (rowsByQuery.get(text) || []).length };
        },
        release() { released = true; },
    };
    return {
        calls,
        get released() { return released; },
        get ended() { return ended; },
        async connect() { return client; },
        async end() { ended = true; },
    };
}

async function testAuditIsReadOnlyAndScoped() {
    const pool = makeAuditPool();
    const report = await auditTokenAccounting(pool, { username: '  Mcsaddle  ', limit: 25 });

    assert.deepEqual(report.filter, { username: 'Mcsaddle', limit: 25 });
    assert.equal(report.accountSummary[0].balance, '42.00');
    assert.equal(report.abandonedRefunds[0].transaction_id, 81);
    assert.equal(report.quarantinedLegacyGames[0].game_id, 19);
    assert.equal(report.mintedGames[0].game_id, 9);
    assert.equal(report.gameVoidReversalIssues[0].issue, 'amount_not_exact_negation');
    assert.equal(pool.calls[0].text, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    assert.equal(pool.calls.at(-1).text, 'COMMIT');
    assert.ok(pool.calls.slice(1, -1).every(call => /^\s*SELECT|^\s*WITH/.test(call.text)));
    assert.deepEqual(
        pool.calls.find(call => call.text === ABANDONED_REFUNDS_QUERY).params,
        ['Mcsaddle', 25],
    );
    assert.deepEqual(
        pool.calls.find(call => call.text === QUARANTINED_LEGACY_GAMES_QUERY).params,
        ['Mcsaddle', 25],
    );
    assert.deepEqual(
        pool.calls.find(call => call.text === MINTED_GAMES_QUERY).params,
        ['Mcsaddle', 25],
    );
    assert.deepEqual(
        pool.calls.find(call => call.text === GAME_VOID_REVERSAL_ISSUES_QUERY).params,
        ['Mcsaddle', 25, VOIDABLE_GAME_TRANSACTION_TYPES],
    );
    assert.match(MINTED_GAMES_QUERY, /COUNT\(DISTINCT t\.user_id\) FILTER/);
    assert.match(MINTED_GAMES_QUERY, /t\.transaction_type = 'buy_in' AND t\.amount < 0/);
    assert.match(BUY_IN_MISMATCHES_QUERY, /LEFT JOIN theme_costs/);
    assert.match(DUPLICATE_ENTRIES_QUERY, /transaction_type::text <> 'game_void_reversal'/);
    assert.match(GAME_VOID_REVERSAL_ISSUES_QUERY, /FROM game_void_ledger_manifest manifest/);
    assert.match(GAME_VOID_REVERSAL_ISSUES_QUERY, /LEFT JOIN game_voids game_void/);
    assert.match(
        GAME_VOID_REVERSAL_ISSUES_QUERY,
        /live_source\.transaction_id = manifest\.source_transaction_id_snapshot/,
    );
    assert.match(
        GAME_VOID_REVERSAL_ISSUES_QUERY,
        /ABS\(reversal_amount \+ source_amount\) > 0\.005/,
    );
    assert.match(GAME_VOID_REVERSAL_ISSUES_QUERY, /'missing_live_source'/);
    assert.match(GAME_VOID_REVERSAL_ISSUES_QUERY, /'missing_live_reversal'/);
    assert.match(GAME_VOID_REVERSAL_ISSUES_QUERY, /'source_manifest_mismatch'/);
    assert.match(GAME_VOID_REVERSAL_ISSUES_QUERY, /'reversal_manifest_mismatch'/);
    assert.match(GAME_VOID_REVERSAL_ISSUES_QUERY, /'missing_manifest_source'::text/);
    assert.match(GAME_VOID_REVERSAL_ISSUES_QUERY, /'missing_manifest_reversal'/);
    assert.match(GAME_VOID_REVERSAL_ISSUES_QUERY, /'manifest_idempotency_mismatch'/);
    assert.match(GAME_VOID_REVERSAL_ISSUES_QUERY, /'pruned_live_pair_incomplete'/);
    assert.match(
        GAME_VOID_REVERSAL_ISSUES_QUERY,
        /live_user_id IS NOT NULL AND live_source_transaction_id IS NULL/,
    );
    assert.match(
        GAME_VOID_REVERSAL_ISSUES_QUERY,
        /live_user_id IS NOT NULL AND live_reversal_transaction_id IS NULL/,
    );
    assert.match(
        GAME_VOID_REVERSAL_ISSUES_QUERY,
        /live_user_id IS NULL\s+AND \(\(live_source_transaction_id IS NULL\)\s+IS DISTINCT FROM \(live_reversal_transaction_id IS NULL\)\)/,
    );
    assert.match(GAME_VOID_REVERSAL_ISSUES_QUERY, /IS DISTINCT FROM 'player_voided'/);
    assert.match(GAME_VOID_REVERSAL_ISSUES_QUERY, /game_void\.affected_player_count/);
    assert.match(GAME_VOID_REVERSAL_ISSUES_QUERY, /'marker_count_mismatch'/);
    assert.match(GAME_VOID_REVERSAL_ISSUES_QUERY, /'manifest_count_mismatch'/);
    assert.match(GAME_VOID_REVERSAL_ISSUES_QUERY, /'manifest_player_count_mismatch'/);
    assert.deepEqual(VOIDABLE_GAME_TRANSACTION_TYPES, [
        'buy_in',
        'win_payout',
        'wash_payout',
        'forfeit_payout',
    ]);
    assert.match(BUY_IN_MISMATCHES_QUERY, /theme_costs\.expected_cost IS NULL/);
    assert.match(ABANDONED_REFUNDS_QUERY, /to_jsonb\(gh\)->>'recovery_eligible'/);
    assert.match(QUARANTINED_LEGACY_GAMES_QUERY, /gh\.outcome = 'In Progress'/);
    assert.match(
        QUARANTINED_LEGACY_GAMES_QUERY,
        /to_jsonb\(gh\)->>'recovery_eligible' IS DISTINCT FROM 'true'/,
    );
    for (const [theme, cost] of Object.entries(TABLE_COSTS)) {
        assert.match(THEME_COST_VALUES_SQL, new RegExp(theme.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        assert.match(THEME_COST_VALUES_SQL, new RegExp(`${Number(cost)}::numeric`));
    }
    assert.equal(
        buildThemeCostValuesSql({ "captain's-table": 2.5 }),
        "('captain''s-table'::text, 2.5::numeric)",
    );
    assert.throws(() => buildThemeCostValuesSql({ broken: Number.NaN }), /Invalid table cost/);
    assert.throws(() => buildThemeCostValuesSql({}), /At least one canonical table cost/);
    assert.equal(pool.released, true);
}

async function testAuditRollsBackOnFailure() {
    const pool = makeAuditPool({ failOn: MINTED_GAMES_QUERY });
    await assert.rejects(
        auditTokenAccounting(pool, { limit: 5 }),
        /injected audit failure/,
    );
    assert.equal(pool.calls.at(-1).text, 'ROLLBACK');
    assert.equal(pool.released, true);
}

async function testCliContract() {
    assert.deepEqual(parseArgs(['--username=Alice', '--limit=12']), {
        username: 'Alice',
        limit: 12,
    });
    assert.throws(() => parseArgs(['--limit=0']), /1 through 500/);
    assert.throws(() => parseArgs(['--wat']), /Unknown argument/);
    assert.equal(parseLimit(undefined), 50);
    assert.equal(money('-1.5'), '-1.50');
    assert.equal(money('1.5'), '+1.50');

    const outputLines = [];
    let receivedOptions;
    const pool = makeAuditPool();
    class FakePool {
        constructor(config) {
            assert.equal(config.connectionString, 'postgres://read-only-test');
            return pool;
        }
    }
    const emptyReport = {
        filter: { username: 'Alice', limit: 10 },
        accountSummary: [],
        typeTotals: [],
        abandonedRefunds: [],
        quarantinedLegacyGames: [],
        mintedGames: [],
        duplicateEntries: [],
        gameVoidReversalIssues: [],
        unpairedPayouts: [],
        invalidAmounts: [],
        buyInMismatches: [],
    };
    await runCli({
        argv: ['--username=Alice', '--limit=10'],
        env: { POSTGRES_CONNECT_STRING: 'postgres://read-only-test' },
        PoolClass: FakePool,
        audit: async (receivedPool, options) => {
            assert.equal(receivedPool, pool);
            receivedOptions = options;
            return emptyReport;
        },
        output: { log: line => outputLines.push(line) },
    });
    assert.deepEqual(receivedOptions, { username: 'Alice', limit: 10 });
    assert.equal(pool.ended, true);
    assert.match(outputLines.join('\n'), /READ-ONLY TOKEN ACCOUNTING AUDIT/);

    const reportLines = [];
    printReport({
        ...emptyReport,
        abandonedRefunds: [{
            transaction_id: 81,
            game_id: 17,
            username: 'Mcsaddle',
            amount: '20.00',
            transaction_time: '2026-07-11T20:00:00.000Z',
            recovery_eligible: null,
            reconciliation_status: 'abandoned_refunded',
            idempotency_key: 'abandoned-refund:17:13',
        }],
        quarantinedLegacyGames: [{
            game_id: 19,
            theme: 'fort-creek',
            start_time: '2025-07-11T20:00:00.000Z',
            last_activity_at: '2026-07-10T20:00:00.000Z',
            funded_user_count: 1,
            funded_tokens: '1.00',
            participants: 'Mcsaddle',
        }],
        buyInMismatches: [{
            transaction_id: 82,
            game_id: 18,
            username: 'Mcsaddle',
            theme: 'retired-table',
            actual_amount: '-1.00',
            expected_amount: null,
        }],
        gameVoidReversalIssues: [{
            reversal_transaction_id: 102,
            game_id: 21,
            user_id: 13,
            username: 'Mcsaddle',
            source_transaction_id: 88,
            source_amount: '3.00',
            reversal_amount: '-2.00',
            issue: 'amount_not_exact_negation',
        }],
    }, { log: line => reportLines.push(line) });
    const renderedReport = reportLines.join('\n');
    assert.match(renderedReport, /Abandoned-game refunds: 1/);
    assert.match(renderedReport, /legacy-or-unknown-lifecycle/);
    assert.match(renderedReport, /idempotency=abandoned-refund:17:13/);
    assert.match(renderedReport, /Quarantined legacy in-progress games: 1/);
    assert.match(renderedReport, /game #19 fort-creek/);
    assert.match(renderedReport, /funded-tokens=\+1.00/);
    assert.match(renderedReport, /expected=UNKNOWN THEME/);
    assert.match(renderedReport, /Invalid game-void reversals: 1/);
    assert.match(renderedReport, /amount_not_exact_negation/);
    assert.match(renderedReport, /reversal=#102 source=#88/);
}

async function runTokenAccountingAuditTests() {
    await testAuditIsReadOnlyAndScoped();
    await testAuditRollsBackOnFailure();
    await testCliContract();
    console.log('Token accounting audit tests passed.');
}

if (require.main === module) {
    runTokenAccountingAuditTests().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = runTokenAccountingAuditTests;
