// Safely removes low-activity player accounts.
//
// Dry run (default):
//   npm run users:prune
//
// Execute after reviewing the dry run and taking a fresh backup:
//   npm run users:prune -- --execute
//
// Admin accounts are protected unless --include-admins is supplied explicitly.
require('dotenv').config();
const { Pool } = require('pg');

const DEFAULT_MIN_GAMES = 3;

const parseArgs = (argv) => {
    const options = {
        execute: false,
        includeAdmins: false,
        minGames: DEFAULT_MIN_GAMES,
    };

    for (const arg of argv) {
        if (arg === '--execute') {
            options.execute = true;
        } else if (arg === '--include-admins') {
            options.includeAdmins = true;
        } else if (arg.startsWith('--min-games=')) {
            const value = Number.parseInt(arg.slice('--min-games='.length), 10);
            if (!Number.isInteger(value) || value < 1) {
                throw new Error('--min-games must be a positive integer.');
            }
            options.minGames = value;
        } else if (arg === '--help' || arg === '-h') {
            options.help = true;
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }

    return options;
};

const printHelp = () => {
    console.log(`Usage: node scripts/prune-inactive-users.js [options]

Options:
  --execute           Permanently delete the accounts found by the dry run.
  --include-admins    Include admin accounts (admins are protected by default).
  --min-games=N       Delete accounts with fewer than N games (default: 3).
  --help, -h          Show this help.

Games are counted as wins + losses + washes. No email addresses, password
hashes, tokens, or other private fields are printed.`);
};

const candidateQuery = `
    SELECT
        u.id,
        u.username,
        COALESCE(u.wins, 0) + COALESCE(u.losses, 0) + COALESCE(u.washes, 0) AS games_played,
        COALESCE(u.is_admin, FALSE) AS is_admin
    FROM users u
    WHERE COALESCE(u.wins, 0) + COALESCE(u.losses, 0) + COALESCE(u.washes, 0) < $1
      AND COALESCE(u.is_bot, FALSE) = FALSE
      AND ($2::boolean OR COALESCE(u.is_admin, FALSE) = FALSE)
      AND NOT EXISTS (
          SELECT 1
          FROM transactions active_transaction
          JOIN game_history active_game
            ON active_game.game_id = active_transaction.game_id
          WHERE active_transaction.user_id = u.id
            AND (
                active_game.outcome = 'In Progress'
                OR active_game.reconciliation_status = 'manual_review'
            )
      )
    ORDER BY games_played ASC, id ASC
    FOR UPDATE OF u
`;

// Report every low-activity account protected by a live or quarantined game ledger.
// This second query also closes the narrow wait-on-lock window where a game start
// may commit after the candidate statement took its READ COMMITTED snapshot.
const activeGameProtectedQuery = `
    SELECT DISTINCT u.id
    FROM users u
    JOIN transactions active_transaction
      ON active_transaction.user_id = u.id
    JOIN game_history active_game
      ON active_game.game_id = active_transaction.game_id
    WHERE COALESCE(u.wins, 0) + COALESCE(u.losses, 0) + COALESCE(u.washes, 0) < $1
      AND COALESCE(u.is_bot, FALSE) = FALSE
      AND ($2::boolean OR COALESCE(u.is_admin, FALSE) = FALSE)
      AND (
          active_game.outcome = 'In Progress'
          OR active_game.reconciliation_status = 'manual_review'
      )
    ORDER BY u.id ASC
`;

const protectedAdminQuery = `
    SELECT
        id,
        username,
        COALESCE(wins, 0) + COALESCE(losses, 0) + COALESCE(washes, 0) AS games_played,
        TRUE AS is_admin
    FROM users
    WHERE COALESCE(wins, 0) + COALESCE(losses, 0) + COALESCE(washes, 0) < $1
      AND COALESCE(is_bot, FALSE) = FALSE
      AND COALESCE(is_admin, FALSE) = TRUE
    ORDER BY games_played ASC, id ASC
`;

const dependentDataCountsQuery = `
    SELECT
        (SELECT COUNT(*)::integer FROM transactions WHERE user_id = ANY($1::int[])) AS transactions,
        (SELECT COUNT(*)::integer FROM feedback WHERE user_id = ANY($1::int[])) AS feedback,
        (SELECT COUNT(*)::integer FROM lobby_chat_messages WHERE user_id = ANY($1::int[])) AS chat_messages
`;

const printAccounts = (heading, accounts) => {
    console.log(`\n${heading}: ${accounts.length}`);
    for (const account of accounts) {
        const adminMarker = account.is_admin ? ' [admin]' : '';
        console.log(`  #${account.id} ${account.username} — ${account.games_played} games${adminMarker}`);
    }
};

const pruneInactiveUsers = async (pool, options) => {
    const client = await pool.connect();
    let transactionOpen = false;

    try {
        await client.query('BEGIN');
        transactionOpen = true;

        const candidateResult = await client.query(candidateQuery, [options.minGames, options.includeAdmins]);
        const activeGameProtectedResult = await client.query(
            activeGameProtectedQuery,
            [options.minGames, options.includeAdmins],
        );
        const activeGameProtectedIds = new Set(activeGameProtectedResult.rows.map(({ id }) => Number(id)));
        const candidates = candidateResult.rows.filter(({ id }) => !activeGameProtectedIds.has(Number(id)));
        const protectedActiveGameAccounts = activeGameProtectedIds.size;

        let protectedAdmins = [];
        if (!options.includeAdmins) {
            const protectedResult = await client.query(protectedAdminQuery, [options.minGames]);
            protectedAdmins = protectedResult.rows;
        }

        const candidateIds = candidates.map(({ id }) => id);
        let dependentData = { transactions: 0, feedback: 0, chat_messages: 0 };
        if (candidateIds.length > 0) {
            const dependentResult = await client.query(dependentDataCountsQuery, [candidateIds]);
            dependentData = dependentResult.rows[0];
        }

        if (!options.execute || candidates.length === 0) {
            await client.query('ROLLBACK');
            transactionOpen = false;
            return {
                executed: false,
                candidates,
                protectedAdmins,
                protectedActiveGameAccounts,
                dependentData,
                deleted: [],
            };
        }

        // Older Sluff databases used NO ACTION foreign keys even though the current
        // schema declares CASCADE/SET NULL. Handle those relationships explicitly so
        // this maintenance task behaves consistently across both schema versions.
        await client.query(
            'DELETE FROM transactions WHERE user_id = ANY($1::int[])',
            [candidateIds]
        );
        await client.query(
            `UPDATE feedback
             SET user_id = NULL, username = 'Deleted User'
             WHERE user_id = ANY($1::int[])`,
            [candidateIds]
        );
        await client.query(
            `UPDATE lobby_chat_messages
             SET user_id = NULL, username = 'Deleted User'
             WHERE user_id = ANY($1::int[])`,
            [candidateIds]
        );

        const deleteResult = await client.query(
            'DELETE FROM users WHERE id = ANY($1::int[]) RETURNING id, username',
            [candidateIds]
        );

        if (deleteResult.rowCount !== candidates.length) {
            throw new Error(
                `Safety check failed: expected to delete ${candidates.length} users, deleted ${deleteResult.rowCount}.`
            );
        }

        await client.query('COMMIT');
        transactionOpen = false;

        return {
            executed: true,
            candidates,
            protectedAdmins,
            protectedActiveGameAccounts,
            dependentData,
            deleted: deleteResult.rows,
        };
    } catch (error) {
        if (transactionOpen) {
            try {
                await client.query('ROLLBACK');
            } catch (rollbackError) {
                console.error('Rollback also failed:', rollbackError.message);
            }
        }
        throw error;
    } finally {
        client.release();
    }
};

const runCli = async () => {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        printHelp();
        return;
    }

    if (!process.env.POSTGRES_CONNECT_STRING) {
        throw new Error('POSTGRES_CONNECT_STRING is required.');
    }

    const pool = new Pool({
        connectionString: process.env.POSTGRES_CONNECT_STRING,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 30000,
    });

    try {
        console.log(options.execute ? 'EXECUTE MODE' : 'DRY RUN — no users will be deleted');
        console.log(`Threshold: fewer than ${options.minGames} games (wins + losses + washes)`);
        console.log(`Admins: ${options.includeAdmins ? 'included' : 'protected'}`);

        const result = await pruneInactiveUsers(pool, options);
        printAccounts('Eligible accounts', result.candidates);
        console.log(
            `\nProtected game-ledger evidence: ${result.protectedActiveGameAccounts} low-activity account(s) excluded.`,
        );
        if (result.protectedAdmins.length > 0) {
            printAccounts('Protected low-activity admins', result.protectedAdmins);
        }
        console.log('\nDependent data covered by the transaction:');
        console.log(`  Transactions deleted: ${result.dependentData.transactions}`);
        console.log(`  Feedback rows anonymized: ${result.dependentData.feedback}`);
        console.log(`  Chat messages anonymized: ${result.dependentData.chat_messages}`);

        if (result.executed) {
            console.log(`\nDeleted ${result.deleted.length} account(s) in one committed transaction.`);
        } else if (result.candidates.length === 0) {
            console.log('\nNo eligible accounts found. Nothing changed.');
        } else {
            console.log('\nDry run complete. Take a fresh backup, then rerun with --execute to delete these accounts.');
        }
    } finally {
        await pool.end();
    }
};

if (require.main === module) {
    runCli().catch((error) => {
        console.error(`User pruning failed: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = {
    DEFAULT_MIN_GAMES,
    activeGameProtectedQuery,
    candidateQuery,
    dependentDataCountsQuery,
    parseArgs,
    protectedAdminQuery,
    pruneInactiveUsers,
};
