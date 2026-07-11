const assert = require('assert');
const {
    DEFAULT_MIN_GAMES,
    parseArgs,
    pruneInactiveUsers,
} = require('../scripts/prune-inactive-users');

const makePool = ({ candidates = [], protectedAdmins = [], deleted = candidates, failDelete = null } = {}) => {
    const calls = [];

    const client = {
        query: async (query, params) => {
            const text = String(query).trim();
            calls.push({ text, params });

            if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
                return { rows: [], rowCount: 0 };
            }
            if (text.includes('FROM users') && text.includes('FOR UPDATE')) {
                return { rows: candidates, rowCount: candidates.length };
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
                return { rows: deleted, rowCount: deleted.length };
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
