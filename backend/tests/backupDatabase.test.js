'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const {
    TABLE_DISCOVERY_QUERY,
    backupDatabase,
    createStagingPath,
    isVerifiedStagingPath,
    quoteIdentifier,
    tableBackupPath,
} = require('../scripts/backup-db');

function makeFileSystem({
    events = [],
    failCleanup = false,
    failOnTable = null,
    failRename = false,
} = {}) {
    const mkdirCalls = [];
    const writeCalls = [];
    const renameCalls = [];
    const rmCalls = [];
    const existingPaths = new Set();
    return {
        mkdirCalls,
        renameCalls,
        rmCalls,
        writeCalls,
        existsSync(targetPath) {
            return existingPaths.has(path.resolve(targetPath));
        },
        mkdirSync(directory, options) {
            const resolvedDirectory = path.resolve(directory);
            mkdirCalls.push({ directory: resolvedDirectory, options });
            existingPaths.add(resolvedDirectory);
            events.push(`fs:mkdir:${resolvedDirectory}`);
        },
        writeFileSync(filePath, contents, options) {
            events.push(`fs:write:${path.basename(filePath)}`);
            if (failOnTable && filePath.endsWith(`${failOnTable}.json`)) {
                throw new Error('injected backup write failure');
            }
            writeCalls.push({ filePath, contents, options });
        },
        renameSync(source, destination) {
            const resolvedSource = path.resolve(source);
            const resolvedDestination = path.resolve(destination);
            events.push(`fs:rename:${resolvedSource}->${resolvedDestination}`);
            if (failRename) throw new Error('injected backup rename failure');
            renameCalls.push({ source: resolvedSource, destination: resolvedDestination });
            existingPaths.delete(resolvedSource);
            existingPaths.add(resolvedDestination);
        },
        rmSync(targetPath, options) {
            const resolvedTarget = path.resolve(targetPath);
            events.push(`fs:rm:${resolvedTarget}`);
            rmCalls.push({ targetPath: resolvedTarget, options });
            if (failCleanup) throw new Error('injected backup cleanup failure');
            existingPaths.delete(resolvedTarget);
        },
    };
}

function makePool({
    commitFails = false,
    events = [],
    tables = [],
    rowsByTable = {},
    failOnTable = null,
    rollbackFails = false,
} = {}) {
    const calls = [];
    let releaseCount = 0;
    let connectCount = 0;
    const client = {
        async query(text) {
            const sql = String(text);
            calls.push(sql);
            events.push(`db:${sql}`);
            if (sql === 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY') return { rows: [] };
            if (sql === TABLE_DISCOVERY_QUERY) {
                return { rows: tables.map(tableName => ({ table_name: tableName })) };
            }
            if (sql === 'COMMIT') {
                if (commitFails) throw new Error('injected backup commit failure');
                return { rows: [] };
            }
            if (sql === 'ROLLBACK') {
                if (rollbackFails) throw new Error('injected rollback failure');
                return { rows: [] };
            }
            const match = sql.match(/^SELECT \* FROM "((?:[^"]|"")+)"$/);
            if (match) {
                const tableName = match[1].replace(/""/g, '"');
                if (tableName === failOnTable) throw new Error('injected backup read failure');
                return { rows: rowsByTable[tableName] || [] };
            }
            throw new Error(`Unexpected backup query: ${sql}`);
        },
        release() { releaseCount += 1; },
    };
    const pool = {
        async connect() {
            connectCount += 1;
            return client;
        },
        async query() {
            throw new Error('backup must not query through the pool after checkout');
        },
    };
    return {
        calls,
        client,
        pool,
        get connectCount() { return connectCount; },
        get releaseCount() { return releaseCount; },
    };
}

async function runBackupDatabaseTests() {
    assert.equal(quoteIdentifier('normal'), '"normal"');
    assert.equal(quoteIdentifier('odd"table'), '"odd""table"');
    const helperStaging = createStagingPath('/safe/helper-backup', 'helper-id');
    assert.equal(isVerifiedStagingPath(helperStaging, '/safe/helper-backup'), true);
    assert.equal(isVerifiedStagingPath('/safe/helper-backup', '/safe/helper-backup'), false);
    assert.equal(isVerifiedStagingPath('/safe/unrelated-staging', '/safe/helper-backup'), false);
    assert.throws(() => createStagingPath('/safe/helper-backup', '../escape'), /unsafe path characters/i);
    assert.throws(() => tableBackupPath(helperStaging, '../escape'), /unsafe table name/i);

    const successEvents = [];
    const successfulPool = makePool({
        events: successEvents,
        tables: ['game_history', 'transactions'],
        rowsByTable: {
            game_history: [{ game_id: 1, outcome: 'In Progress' }],
            transactions: [{ transaction_id: 2, game_id: 1 }],
        },
    });
    const successfulFs = makeFileSystem({ events: successEvents });
    const logs = [];
    const result = await backupDatabase(successfulPool.pool, '/safe/backup', {
        fileSystem: successfulFs,
        logger: { log: message => logs.push(message), error: message => logs.push(message) },
        stagingIdFactory: () => 'successful',
    });
    const successfulFinal = path.resolve('/safe/backup');
    const successfulStaging = createStagingPath(successfulFinal, 'successful');

    assert.equal(successfulPool.connectCount, 1, 'exactly one client is checked out');
    assert.equal(successfulPool.releaseCount, 1);
    assert.deepEqual(successfulPool.calls, [
        'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
        TABLE_DISCOVERY_QUERY,
        'SELECT * FROM "game_history"',
        'SELECT * FROM "transactions"',
        'COMMIT',
    ]);
    assert.deepEqual(result, {
        outDir: '/safe/backup',
        tableCount: 2,
        totalRows: 2,
        tables: [
            { tableName: 'game_history', rowCount: 1 },
            { tableName: 'transactions', rowCount: 1 },
        ],
    });
    assert.deepEqual(successfulFs.mkdirCalls, [
        {
            directory: path.dirname(successfulFinal),
            options: { recursive: true, mode: 0o700 },
        },
        {
            directory: successfulStaging,
            options: { recursive: false, mode: 0o700 },
        },
    ]);
    assert.equal(successfulFs.writeCalls.length, 2);
    assert.deepEqual(JSON.parse(successfulFs.writeCalls[0].contents), [{ game_id: 1, outcome: 'In Progress' }]);
    assert.equal(successfulFs.writeCalls[0].filePath, path.join(successfulStaging, 'game_history.json'));
    assert.deepEqual(successfulFs.writeCalls[0].options, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
    });
    assert.deepEqual(successfulFs.renameCalls, [{
        source: successfulStaging,
        destination: successfulFinal,
    }]);
    assert.equal(successfulFs.existsSync(successfulStaging), false);
    assert.equal(successfulFs.existsSync(successfulFinal), true);
    const finalWriteIndex = Math.max(
        ...successEvents.map((event, index) => (event.startsWith('fs:write:') ? index : -1)),
    );
    const commitIndex = successEvents.indexOf('db:COMMIT');
    const renameIndex = successEvents.findIndex(event => event.startsWith('fs:rename:'));
    assert.ok(finalWriteIndex < commitIndex, 'all staging writes finish before snapshot commit');
    assert.ok(commitIndex < renameIndex, 'the committed snapshot is published by rename, never before');

    const emptyPool = makePool();
    const emptyFs = makeFileSystem();
    const emptyResult = await backupDatabase(emptyPool.pool, '/safe/empty', { fileSystem: emptyFs });
    assert.equal(emptyResult.tableCount, 0);
    assert.deepEqual(emptyPool.calls, [
        'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
        TABLE_DISCOVERY_QUERY,
        'COMMIT',
    ]);
    assert.equal(emptyFs.mkdirCalls.length, 0);
    assert.equal(emptyFs.renameCalls.length, 0);
    assert.equal(emptyFs.rmCalls.length, 0);
    assert.equal(emptyPool.releaseCount, 1);

    const readFailureEvents = [];
    const failingReadPool = makePool({
        events: readFailureEvents,
        tables: ['game_history', 'transactions'],
        rowsByTable: { game_history: [{ game_id: 1 }] },
        failOnTable: 'transactions',
    });
    const failingReadFs = makeFileSystem({ events: readFailureEvents });
    const failingReadFinal = path.resolve('/safe/read-failure');
    const failingReadStaging = createStagingPath(failingReadFinal, 'read-failure');
    await assert.rejects(
        backupDatabase(failingReadPool.pool, '/safe/read-failure', {
            fileSystem: failingReadFs,
            logger: { log() {}, error() {} },
            stagingIdFactory: () => 'read-failure',
        }),
        /injected backup read failure/,
    );
    assert.ok(failingReadPool.calls.includes('ROLLBACK'));
    assert.ok(!failingReadPool.calls.includes('COMMIT'));
    assert.deepEqual(failingReadFs.rmCalls, [{
        targetPath: failingReadStaging,
        options: { recursive: true, force: true },
    }]);
    assert.equal(failingReadFs.renameCalls.length, 0);
    assert.equal(failingReadFs.existsSync(failingReadStaging), false);
    assert.equal(failingReadFs.existsSync(failingReadFinal), false);
    assert.equal(failingReadPool.releaseCount, 1);

    const failingWritePool = makePool({
        tables: ['game_history'],
        rowsByTable: { game_history: [{ game_id: 1 }] },
    });
    const failingWriteFs = makeFileSystem({ failOnTable: 'game_history' });
    const failingWriteFinal = path.resolve('/safe/write-failure');
    const failingWriteStaging = createStagingPath(failingWriteFinal, 'write-failure');
    await assert.rejects(
        backupDatabase(failingWritePool.pool, '/safe/write-failure', {
            fileSystem: failingWriteFs,
            stagingIdFactory: () => 'write-failure',
        }),
        /injected backup write failure/,
    );
    assert.ok(failingWritePool.calls.includes('ROLLBACK'));
    assert.equal(failingWriteFs.rmCalls[0].targetPath, failingWriteStaging);
    assert.equal(failingWriteFs.existsSync(failingWriteFinal), false);
    assert.equal(failingWritePool.releaseCount, 1);

    const commitFailureEvents = [];
    const failingCommitPool = makePool({
        commitFails: true,
        events: commitFailureEvents,
        tables: ['game_history'],
        rowsByTable: { game_history: [{ game_id: 1 }] },
    });
    const failingCommitFs = makeFileSystem({ events: commitFailureEvents });
    const failingCommitFinal = path.resolve('/safe/commit-failure');
    const failingCommitStaging = createStagingPath(failingCommitFinal, 'commit-failure');
    await assert.rejects(
        backupDatabase(failingCommitPool.pool, '/safe/commit-failure', {
            fileSystem: failingCommitFs,
            stagingIdFactory: () => 'commit-failure',
        }),
        /injected backup commit failure/,
    );
    assert.ok(failingCommitPool.calls.includes('ROLLBACK'));
    assert.equal(failingCommitFs.renameCalls.length, 0);
    assert.equal(failingCommitFs.rmCalls[0].targetPath, failingCommitStaging);
    assert.equal(failingCommitFs.existsSync(failingCommitFinal), false);
    assert.ok(commitFailureEvents.indexOf('db:COMMIT') < commitFailureEvents.indexOf('db:ROLLBACK'));
    assert.ok(
        commitFailureEvents.indexOf('db:ROLLBACK')
            < commitFailureEvents.findIndex(event => event.startsWith('fs:rm:')),
        'failed commits roll back before staging cleanup',
    );

    const renameFailureEvents = [];
    const failingRenamePool = makePool({
        events: renameFailureEvents,
        tables: ['game_history'],
        rowsByTable: { game_history: [{ game_id: 1 }] },
    });
    const failingRenameFs = makeFileSystem({ events: renameFailureEvents, failRename: true });
    const failingRenameFinal = path.resolve('/safe/rename-failure');
    const failingRenameStaging = createStagingPath(failingRenameFinal, 'rename-failure');
    await assert.rejects(
        backupDatabase(failingRenamePool.pool, '/safe/rename-failure', {
            fileSystem: failingRenameFs,
            stagingIdFactory: () => 'rename-failure',
        }),
        /injected backup rename failure/,
    );
    assert.ok(failingRenamePool.calls.includes('COMMIT'));
    assert.ok(!failingRenamePool.calls.includes('ROLLBACK'));
    assert.equal(failingRenameFs.rmCalls[0].targetPath, failingRenameStaging);
    assert.equal(failingRenameFs.existsSync(failingRenameStaging), false);
    assert.equal(failingRenameFs.existsSync(failingRenameFinal), false);
    const failedRenameCommitIndex = renameFailureEvents.indexOf('db:COMMIT');
    const failedRenameIndex = renameFailureEvents.findIndex(event => event.startsWith('fs:rename:'));
    const failedRenameCleanupIndex = renameFailureEvents.findIndex(event => event.startsWith('fs:rm:'));
    assert.ok(failedRenameCommitIndex < failedRenameIndex && failedRenameIndex < failedRenameCleanupIndex);

    const rollbackFailurePool = makePool({
        tables: ['game_history'],
        failOnTable: 'game_history',
        rollbackFails: true,
    });
    const rollbackFs = makeFileSystem();
    const rollbackLogs = [];
    await assert.rejects(
        backupDatabase(rollbackFailurePool.pool, '/safe/rollback-failure', {
            fileSystem: rollbackFs,
            logger: { log() {}, error: message => rollbackLogs.push(message) },
            stagingIdFactory: () => 'rollback-failure',
        }),
        /injected backup read failure/,
        'rollback failure must not mask the original backup failure',
    );
    assert.match(rollbackLogs[0], /rollback also failed/i);
    assert.equal(rollbackFs.rmCalls.length, 1, 'rollback failure does not prevent staging cleanup');
    assert.equal(rollbackFailurePool.releaseCount, 1);

    const cleanupFailurePool = makePool({
        tables: ['game_history'],
        rowsByTable: { game_history: [{ game_id: 1 }] },
    });
    const cleanupFailureFs = makeFileSystem({ failCleanup: true, failRename: true });
    const cleanupFailureLogs = [];
    const cleanupFailureFinal = path.resolve('/safe/cleanup-failure');
    const cleanupFailureStaging = createStagingPath(cleanupFailureFinal, 'cleanup-failure');
    await assert.rejects(
        backupDatabase(cleanupFailurePool.pool, '/safe/cleanup-failure', {
            fileSystem: cleanupFailureFs,
            logger: { log() {}, error: message => cleanupFailureLogs.push(message) },
            stagingIdFactory: () => 'cleanup-failure',
        }),
        /injected backup rename failure/,
        'cleanup failure must not mask the original publish failure',
    );
    assert.match(cleanupFailureLogs[0], /staging cleanup also failed/i);
    assert.equal(cleanupFailureFs.rmCalls[0].targetPath, cleanupFailureStaging);
    assert.equal(cleanupFailureFs.existsSync(cleanupFailureFinal), false);

    console.log('Repeatable-read database backup tests passed.');
}

if (require.main === module) {
    runBackupDatabaseTests().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = runBackupDatabaseTests;
