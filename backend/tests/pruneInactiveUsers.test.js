const assert = require('assert');
const {
    DEFAULT_MIN_GAMES,
    activeGameProtectedQuery,
    candidateQuery,
    parseArgs,
    pruneInactiveUsers,
} = require('../scripts/prune-inactive-users');

const makePool = ({
    candidates = [],
    activeGameProtected = [],
    protectedAdmins = [],
    deleted,
    failDelete = null,
} = {}) => {
    const calls = [];
    const protectedIds = new Set(activeGameProtected.map(({ id }) => Number(id)));
    const eligibleCandidates = candidates.filter(({ id }) => !protectedIds.has(Number(id)));
    const deletedRows = deleted === undefined ? eligibleCandidates : deleted;

    const client = {
        query: async (query, params) => {
            const text = String(query).trim();
            calls.push({ text, params });

            if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
                return { rows: [], rowCount: 0 };
            }
            if (text.includes('FROM users u') && text.includes('FOR UPDATE OF u')) {
                return { rows: candidates, rowCount: candidates.length };
            }
            if (
                text.includes('SELECT DISTINCT u.id')
                && text.includes("active_game.outcome = 'In Progress'")
                && text.includes("active_game.reconciliation_status = 'manual_review'")
            ) {
                return { rows: activeGameProtected, rowCount: activeGameProtected.length };
            }
            if (text.includes('FROM users') && text.includes('TRUE AS is_admin')) {
                return { rows: protectedAdmins, rowCount: protectedAdmins.length };
            }
            if (text.startsWith('SELECT') && text.includes('FROM transactions')) {
                return {
                    rows: [{ transactions: 4, feedback: 2, chat_messages: 3 }],
                    rowCount: 1,
                };
            }
            if (text.startsWith('DELETE FROM users')) {
                if (failDelete) throw failDelete;
                return { rows: deletedRows, rowCount: deletedRows.length };
            }
            if (text.startsWith('DELETE FROM transactions')) {
                if (failDelete) throw failDelete;
                return { rows: [], rowCount: 4 };
            }
            if (text.startsWith('UPDATE feedback')) {
                return { rows: [], rowCount: 2 };
            }
            if (text.startsWith('UPDATE lobby_chat_messages')) {
                return { rows: [], rowCount: 3 };
            }
            throw new Error(`Unexpected query: ${text}`);
        },
        releaseCalled: false,
        release() {
            this.releaseCalled = true;
        },
    };

    return {
        calls,
        client,
        pool: { connect: async () => client },
    };
};

const candidate = { id: 7, username: 'LowActivity', games_played: 2, is_admin: false };
const admin = { id: 8, username: 'AdminTest', games_played: 0, is_admin: true };

async function runTests() {
    assert.match(candidateQuery, /NOT EXISTS/i);
    assert.match(candidateQuery, /COALESCE\(u\.is_bot, FALSE\)\s*=\s*FALSE/i);
    assert.match(candidateQuery, /active_game\.outcome\s*=\s*'In Progress'/i);
    assert.match(candidateQuery, /active_game\.reconciliation_status\s*=\s*'manual_review'/i);
    assert.match(activeGameProtectedQuery, /active_game\.outcome\s*=\s*'In Progress'/i);
    assert.match(activeGameProtectedQuery, /active_game\.reconciliation_status\s*=\s*'manual_review'/i);
    assert.match(activeGameProtectedQuery, /COALESCE\(u\.is_bot, FALSE\)\s*=\s*FALSE/i);
    assert.deepStrictEqual(parseArgs([]), {
        execute: false,
        includeAdmins: false,
        minGames: DEFAULT_MIN_GAMES,
    });
    assert.deepStrictEqual(parseArgs(['--execute', '--include-admins', '--min-games=5']), {
        execute: true,
        includeAdmins: true,
        minGames: 5,
    });
    assert.throws(() => parseArgs(['--min-games=0']), /positive integer/);
    assert.throws(() => parseArgs(['--surprise']), /Unknown argument/);

    const dryRun = makePool({ candidates: [candidate], protectedAdmins: [admin] });
    const dryResult = await pruneInactiveUsers(dryRun.pool, {
        execute: false,
        includeAdmins: false,
        minGames: 3,
    });
    assert.strictEqual(dryResult.executed, false);
    assert.deepStrictEqual(dryResult.candidates, [candidate]);
    assert.deepStrictEqual(dryResult.protectedAdmins, [admin]);
    assert.strictEqual(dryResult.protectedActiveGameAccounts, 0);
    assert.deepStrictEqual(dryResult.dependentData, {
        transactions: 4,
        feedback: 2,
        chat_messages: 3,
    });
    assert.ok(dryRun.calls.some(({ text }) => text === 'ROLLBACK'));
    assert.ok(!dryRun.calls.some(({ text }) => text.startsWith('DELETE FROM users')));
    assert.strictEqual(dryRun.client.releaseCalled, true);

    const execution = makePool({ candidates: [candidate] });
    const executeResult = await pruneInactiveUsers(execution.pool, {
        execute: true,
        includeAdmins: false,
        minGames: 3,
    });
    assert.strictEqual(executeResult.executed, true);
    assert.strictEqual(executeResult.deleted.length, 1);
    assert.ok(execution.calls.some(({ text }) => text.startsWith('DELETE FROM transactions')));
    assert.ok(execution.calls.some(({ text }) => text.startsWith('UPDATE feedback')));
    assert.ok(execution.calls.some(({ text }) => text.startsWith('UPDATE lobby_chat_messages')));
    assert.ok(execution.calls.some(({ text }) => text.startsWith('DELETE FROM users')));
    assert.ok(execution.calls.some(({ text }) => text === 'COMMIT'));
    assert.ok(!execution.calls.some(({ text }) => text === 'ROLLBACK'));

    const activePlayer = { id: 9, username: 'ActiveLowActivity', games_played: 0, is_admin: false };
    const manualReviewPlayer = { id: 10, username: 'QuarantinedLedger', games_played: 1, is_admin: false };
    const protectedExecution = makePool({
        candidates: [candidate, activePlayer, manualReviewPlayer],
        activeGameProtected: [{ id: activePlayer.id }, { id: manualReviewPlayer.id }],
    });
    const protectedResult = await pruneInactiveUsers(protectedExecution.pool, {
        execute: true,
        includeAdmins: true,
        minGames: 3,
    });
    assert.deepStrictEqual(protectedResult.candidates, [candidate]);
    assert.strictEqual(protectedResult.protectedActiveGameAccounts, 2);
    assert.deepStrictEqual(protectedResult.deleted, [candidate]);
    const destructiveCalls = protectedExecution.calls.filter(({ text }) => (
        text.startsWith('DELETE FROM transactions')
        || text.startsWith('UPDATE feedback')
        || text.startsWith('UPDATE lobby_chat_messages')
        || text.startsWith('DELETE FROM users')
    ));
    assert.ok(destructiveCalls.length > 0);
    for (const { params } of destructiveCalls) {
        assert.deepStrictEqual(params[0], [candidate.id], 'protected game ledgers never reach destructive queries');
    }

    const allProtected = makePool({
        candidates: [manualReviewPlayer],
        activeGameProtected: [{ id: manualReviewPlayer.id }],
    });
    const allProtectedResult = await pruneInactiveUsers(allProtected.pool, {
        execute: true,
        includeAdmins: true,
        minGames: 3,
    });
    assert.strictEqual(allProtectedResult.executed, false);
    assert.deepStrictEqual(allProtectedResult.candidates, []);
    assert.strictEqual(allProtectedResult.protectedActiveGameAccounts, 1);
    assert.ok(!allProtected.calls.some(({ text }) => text.startsWith('DELETE FROM users')));
    assert.ok(allProtected.calls.some(({ text }) => text === 'ROLLBACK'));

    const failed = makePool({ candidates: [candidate], failDelete: new Error('database unavailable') });
    await assert.rejects(
        () => pruneInactiveUsers(failed.pool, {
            execute: true,
            includeAdmins: true,
            minGames: 3,
        }),
        /database unavailable/
    );
    assert.ok(failed.calls.some(({ text }) => text === 'ROLLBACK'));
    assert.strictEqual(failed.client.releaseCalled, true);

    console.log('Inactive-user pruning tests passed.');
}

if (require.main === module) {
    runTests().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = runTests;
