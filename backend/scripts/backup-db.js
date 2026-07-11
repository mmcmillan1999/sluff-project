// Dumps every table in the Sluff database to timestamped JSON files.
// Usage: node scripts/backup-db.js          (reads POSTGRES_CONNECT_STRING from .env)
// Output: $SLUFF_BACKUP_DIR/<date>/<table>.json.
// The destination is required so plaintext production data cannot silently
// fall back into this repository or a cloud-synced project directory.
require('dotenv').config();
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const TABLE_DISCOVERY_QUERY = (
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name"
);

const quoteIdentifier = (identifier) => `"${String(identifier).replace(/"/g, '""')}"`;

const createStagingPath = (outDir, uniqueId = randomUUID()) => {
    const finalOutDir = path.resolve(outDir);
    const finalName = path.basename(finalOutDir);
    const stagingId = String(uniqueId);
    if (!finalName) throw new TypeError('Backup output must name a directory, not a filesystem root.');
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(stagingId)) {
        throw new TypeError('Backup staging id contains unsafe path characters.');
    }
    return path.join(path.dirname(finalOutDir), `.${finalName}.staging-${stagingId}`);
};

const isVerifiedStagingPath = (stagingDir, outDir) => {
    if (!stagingDir) return false;
    const finalOutDir = path.resolve(outDir);
    const resolvedStagingDir = path.resolve(stagingDir);
    const prefix = `.${path.basename(finalOutDir)}.staging-`;
    const stagingName = path.basename(resolvedStagingDir);
    const stagingId = stagingName.slice(prefix.length);
    return resolvedStagingDir !== finalOutDir
        && path.dirname(resolvedStagingDir) === path.dirname(finalOutDir)
        && stagingName.startsWith(prefix)
        && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(stagingId);
};

const tableBackupPath = (stagingDir, tableName) => {
    const stagingRoot = path.resolve(stagingDir);
    const filePath = path.resolve(stagingRoot, `${tableName}.json`);
    const relativePath = path.relative(stagingRoot, filePath);
    if (!relativePath || path.isAbsolute(relativePath) || path.dirname(relativePath) !== '.') {
        throw new Error(`Unsafe table name for backup file: ${tableName}`);
    }
    return filePath;
};

const backupDatabase = async (pool, outDir, {
    fileSystem = fs,
    logger = console,
    stagingIdFactory = randomUUID,
} = {}) => {
    if (!pool || typeof pool.connect !== 'function') {
        throw new TypeError('A database pool with connect() is required.');
    }
    if (typeof stagingIdFactory !== 'function') {
        throw new TypeError('stagingIdFactory must be a function.');
    }

    const client = await pool.connect();
    const finalOutDir = path.resolve(outDir);
    let transactionOpen = false;
    let stagingDir = null;
    let stagingCreated = false;

    try {
        // One checked-out connection and one MVCC snapshot keep game_history,
        // transactions, and every other table mutually consistent.
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        transactionOpen = true;

        const { rows } = await client.query(TABLE_DISCOVERY_QUERY);
        if (!rows.length) {
            await client.query('COMMIT');
            transactionOpen = false;
            return { outDir, tableCount: 0, totalRows: 0, tables: [] };
        }

        if (fileSystem.existsSync(finalOutDir)) {
            throw new Error(`Backup destination already exists: ${finalOutDir}`);
        }

        // Restrictive modes apply on Unix-like systems; Windows keeps the
        // inherited ACL. Files remain unpublished in a uniquely named sibling until
        // the database snapshot commits and one atomic rename publishes them.
        fileSystem.mkdirSync(path.dirname(finalOutDir), { recursive: true, mode: 0o700 });
        stagingDir = createStagingPath(finalOutDir, stagingIdFactory());
        if (!isVerifiedStagingPath(stagingDir, finalOutDir)) {
            throw new Error('Refusing to create an unverified backup staging directory.');
        }
        fileSystem.mkdirSync(stagingDir, { recursive: false, mode: 0o700 });
        stagingCreated = true;

        let totalRows = 0;
        const tables = [];
        for (const { table_name: tableName } of rows) {
            const data = await client.query(`SELECT * FROM ${quoteIdentifier(tableName)}`);
            fileSystem.writeFileSync(
                tableBackupPath(stagingDir, tableName),
                JSON.stringify(data.rows, null, 2),
                {
                    encoding: 'utf8',
                    flag: 'wx',
                    mode: 0o600,
                },
            );
            logger.log(`${tableName}: ${data.rows.length} rows`);
            totalRows += data.rows.length;
            tables.push({ tableName, rowCount: data.rows.length });
        }

        await client.query('COMMIT');
        transactionOpen = false;

        if (fileSystem.existsSync(finalOutDir)) {
            throw new Error(`Backup destination appeared before publish: ${finalOutDir}`);
        }
        fileSystem.renameSync(stagingDir, finalOutDir);
        stagingCreated = false;
        stagingDir = null;
        return { outDir, tableCount: tables.length, totalRows, tables };
    } catch (error) {
        if (transactionOpen) {
            try {
                await client.query('ROLLBACK');
            } catch (rollbackError) {
                logger.error(`Backup rollback also failed: ${rollbackError.message}`);
            }
        }
        if (stagingCreated && isVerifiedStagingPath(stagingDir, finalOutDir)) {
            try {
                fileSystem.rmSync(stagingDir, { recursive: true, force: true });
            } catch (cleanupError) {
                logger.error(`Backup staging cleanup also failed: ${cleanupError.message}`);
            }
        }
        throw error;
    } finally {
        client.release();
    }
};

const runCli = async () => {
    if (!process.env.POSTGRES_CONNECT_STRING) {
        throw new Error('POSTGRES_CONNECT_STRING is required.');
    }
    if (!process.env.SLUFF_BACKUP_DIR?.trim()) {
        throw new Error(
            'SLUFF_BACKUP_DIR is required and must point to an access-restricted, encrypted location outside the project.',
        );
    }

    const pool = new Pool({
        connectionString: process.env.POSTGRES_CONNECT_STRING,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 30000,
    });

    const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    const backupRoot = path.resolve(process.env.SLUFF_BACKUP_DIR);
    const outDir = path.join(backupRoot, stamp);

    try {
        const result = await backupDatabase(pool, outDir);
        if (result.tableCount === 0) {
            console.log('Connected, but no tables found.');
            return result;
        }
        console.log(
            `\nBackup complete: ${result.totalRows} rows across ${result.tableCount} tables -> ${outDir}`,
        );
        return result;
    } finally {
        await pool.end();
    }
};

if (require.main === module) {
    runCli().catch((error) => {
        console.error('Backup failed:', error.message);
        process.exitCode = 1;
    });
}

module.exports = {
    TABLE_DISCOVERY_QUERY,
    backupDatabase,
    createStagingPath,
    isVerifiedStagingPath,
    quoteIdentifier,
    runCli,
    tableBackupPath,
};
