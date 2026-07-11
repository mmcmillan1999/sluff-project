// Dumps every table in the Sluff database to timestamped JSON files.
// Usage: node scripts/backup-db.js          (reads POSTGRES_CONNECT_STRING from .env)
// Output: $SLUFF_BACKUP_DIR/<date>/<table>.json when configured,
// otherwise backend/backups/<date>/<table>.json (which is gitignored).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

(async () => {
    const pool = new Pool({
        connectionString: process.env.POSTGRES_CONNECT_STRING,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 30000,
    });

    const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    const backupRoot = process.env.SLUFF_BACKUP_DIR
        ? path.resolve(process.env.SLUFF_BACKUP_DIR)
        : path.join(__dirname, '..', 'backups');
    const outDir = path.join(backupRoot, stamp);

    try {
        const { rows } = await pool.query(
            "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name"
        );
        if (!rows.length) {
            console.log('Connected, but no tables found.');
            process.exit(0);
        }
        // Restrictive modes apply on Unix-like systems; Windows keeps the
        // inherited ACL. The exclusive write flag prevents accidental overwrite.
        fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });

        let total = 0;
        for (const { table_name } of rows) {
            const data = await pool.query(`SELECT * FROM "${table_name}"`);
            fs.writeFileSync(path.join(outDir, `${table_name}.json`), JSON.stringify(data.rows, null, 2), {
                encoding: 'utf8',
                flag: 'wx',
                mode: 0o600,
            });
            console.log(`${table_name}: ${data.rows.length} rows`);
            total += data.rows.length;
        }
        console.log(`\nBackup complete: ${total} rows across ${rows.length} tables -> ${outDir}`);
    } catch (err) {
        console.error('Backup failed:', err.message);
        process.exit(1);
    }
    process.exit(0);
})();
