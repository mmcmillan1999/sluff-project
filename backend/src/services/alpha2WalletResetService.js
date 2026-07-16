'use strict';

const crypto = require('crypto');
const {
    acquireSeasonLock,
    acquireSeasonReadLock,
    loadActiveSeason,
    publicSeason,
} = require('./seasonService');

const ALPHA_TWO_NUMBER = 2;
const ALPHA_TWO_SLUG = 'alpha-season-2';
const ALPHA_TWO_WALLET_RESET_KEY = 'alpha-season-2-opening-wallets-v1';
const TARGET_TOKENS_CENTS = 800;
const TARGET_TOKENS = '8.00';

const WALLET_ACCOUNTS_QUERY = `
    SELECT
        u.id AS source_user_id,
        u.username,
        COALESCE(SUM(t.amount), 0)::numeric(14, 2) AS current_tokens
    FROM users u
    LEFT JOIN transactions t ON t.user_id = u.id
    GROUP BY u.id, u.username
    ORDER BY u.id ASC
`;

const CURRENT_SEASON_GAME_COUNT_QUERY = `
    SELECT COUNT(*)::integer AS count
    FROM game_history
    WHERE season_id = $1
`;

const OPERATION_SELECT = `
    SELECT operation_key, season_id, target_tokens, preview_hash,
           account_count, changed_account_count, old_supply, new_supply,
           minted, burned, net_change, applied_by_user_id,
           applied_by_username, applied_at
    FROM season_wallet_reset_operations
    WHERE operation_key = $1
`;

class Alpha2WalletResetConflictError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'Alpha2WalletResetConflictError';
        this.code = code;
    }
}

function moneyToCents(value) {
    const number = Number(value || 0);
    if (!Number.isFinite(number)) throw new TypeError(`Invalid token value: ${value}`);
    return Math.round(number * 100);
}

function centsToMoney(cents) {
    if (!Number.isSafeInteger(cents)) throw new TypeError(`Invalid token cents: ${cents}`);
    return (cents / 100).toFixed(2);
}

function assertAlphaTwo(seasonRow) {
    if (
        Number(seasonRow?.season_number) !== ALPHA_TWO_NUMBER
        || seasonRow?.slug !== ALPHA_TWO_SLUG
        || seasonRow?.status !== 'active'
    ) {
        throw new Alpha2WalletResetConflictError(
            'ALPHA2_NOT_ACTIVE',
            'The one-time wallet reset is available only while Alpha Season 2 is active.',
        );
    }
}

function accountsFromRows(rows) {
    return rows.map(row => {
        const currentCents = moneyToCents(row.current_tokens);
        const adjustmentCents = TARGET_TOKENS_CENTS - currentCents;
        return {
            sourceUserId: Number(row.source_user_id),
            username: row.username,
            currentCents,
            adjustmentCents,
            currentTokens: centsToMoney(currentCents),
            beforeTokens: centsToMoney(currentCents),
            adjustmentTokens: centsToMoney(adjustmentCents),
            targetTokens: TARGET_TOKENS,
            afterTokens: TARGET_TOKENS,
        };
    });
}

function publicAccount(account) {
    const { sourceUserId, currentCents, adjustmentCents, ...safe } = account;
    return safe;
}

function summaryFromAccounts(accounts) {
    const oldSupplyCents = accounts.reduce((sum, row) => sum + row.currentCents, 0);
    const newSupplyCents = accounts.length * TARGET_TOKENS_CENTS;
    const mintedCents = accounts.reduce(
        (sum, row) => sum + Math.max(row.adjustmentCents, 0),
        0,
    );
    const burnedCents = accounts.reduce(
        (sum, row) => sum + Math.max(-row.adjustmentCents, 0),
        0,
    );
    return {
        accountCount: accounts.length,
        changedAccountCount: accounts.filter(row => row.adjustmentCents !== 0).length,
        oldSupply: centsToMoney(oldSupplyCents),
        newSupply: centsToMoney(newSupplyCents),
        minted: centsToMoney(mintedCents),
        burned: centsToMoney(burnedCents),
        net: centsToMoney(newSupplyCents - oldSupplyCents),
    };
}

function summaryFromOperation(row) {
    return {
        accountCount: Number(row.account_count),
        changedAccountCount: Number(row.changed_account_count),
        oldSupply: Number(row.old_supply).toFixed(2),
        newSupply: Number(row.new_supply).toFixed(2),
        minted: Number(row.minted).toFixed(2),
        burned: Number(row.burned).toFixed(2),
        net: Number(row.net_change).toFixed(2),
    };
}

function operationFromRow(row) {
    return {
        key: row.operation_key,
        appliedAt: row.applied_at,
        appliedBy: row.applied_by_username,
    };
}

function hashWalletResetPreview(seasonRow, accounts, currentSeasonGameCount) {
    const canonical = {
        operationKey: ALPHA_TWO_WALLET_RESET_KEY,
        targetTokens: TARGET_TOKENS,
        season: {
            id: Number(seasonRow.season_id),
            number: Number(seasonRow.season_number),
            slug: seasonRow.slug,
            status: seasonRow.status,
        },
        currentSeasonGameCount: Number(currentSeasonGameCount),
        accounts: accounts.map(row => ({
            sourceUserId: row.sourceUserId,
            username: row.username,
            currentTokens: row.currentTokens,
            adjustmentTokens: row.adjustmentTokens,
        })),
    };
    return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

async function loadWalletAccounts(client) {
    const result = await client.query(WALLET_ACCOUNTS_QUERY);
    return accountsFromRows(result.rows || []);
}

async function countCurrentSeasonGames(client, seasonId) {
    const result = await client.query(CURRENT_SEASON_GAME_COUNT_QUERY, [seasonId]);
    return Number(result.rows?.[0]?.count || 0);
}

async function loadOperation(client, { forUpdate = false } = {}) {
    const result = await client.query(
        `${OPERATION_SELECT}${forUpdate ? ' FOR UPDATE' : ''}`,
        [ALPHA_TWO_WALLET_RESET_KEY],
    );
    return result.rows?.[0] || null;
}

function previewPayload({ seasonRow, accounts, currentSeasonGameCount, operation = null }) {
    const calculatedSummary = summaryFromAccounts(accounts);
    const previewHash = operation?.preview_hash?.trim?.()
        || hashWalletResetPreview(seasonRow, accounts, currentSeasonGameCount);
    return {
        season: publicSeason(seasonRow),
        targetTokens: TARGET_TOKENS,
        summary: operation ? summaryFromOperation(operation) : calculatedSummary,
        accounts: operation ? [] : accounts.map(publicAccount),
        currentSeasonGameCount,
        canApply: !operation && currentSeasonGameCount === 0,
        alreadyApplied: Boolean(operation),
        previewHash,
        ...(operation ? { operation: operationFromRow(operation) } : {}),
    };
}

async function previewAlpha2WalletReset(pool) {
    const client = await pool.connect();
    let transactionOpen = false;
    try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        transactionOpen = true;
        await acquireSeasonReadLock(client);
        const seasonRow = await loadActiveSeason(client);
        assertAlphaTwo(seasonRow);
        const currentSeasonGameCount = await countCurrentSeasonGames(client, seasonRow.season_id);
        const operation = await loadOperation(client);
        const accounts = operation ? [] : await loadWalletAccounts(client);
        const payload = previewPayload({
            seasonRow,
            accounts,
            currentSeasonGameCount,
            operation,
        });
        await client.query('COMMIT');
        transactionOpen = false;
        return payload;
    } catch (error) {
        if (transactionOpen) await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

function validateApplyProof({ expectedPreviewHash, expectedSeasonId }) {
    if (!/^[a-f0-9]{64}$/.test(String(expectedPreviewHash || ''))) {
        const error = new TypeError('A valid expectedPreviewHash from the wallet-reset preview is required.');
        error.code = 'PREVIEW_HASH_REQUIRED';
        throw error;
    }
    const seasonId = Number(expectedSeasonId);
    if (!Number.isSafeInteger(seasonId) || seasonId <= 0) {
        const error = new TypeError('A positive expectedSeasonId from the wallet-reset preview is required.');
        error.code = 'EXPECTED_SEASON_REQUIRED';
        throw error;
    }
    return seasonId;
}

function appliedPayload({
    seasonRow,
    operation,
    accounts = [],
    currentSeasonGameCount = 0,
    alreadyApplied,
}) {
    return {
        season: publicSeason(seasonRow),
        targetTokens: TARGET_TOKENS,
        summary: summaryFromOperation(operation),
        accounts: accounts.map(publicAccount),
        currentSeasonGameCount,
        canApply: false,
        alreadyApplied,
        previewHash: operation.preview_hash.trim(),
        operation: operationFromRow(operation),
    };
}

async function applyAlpha2WalletReset(
    pool,
    { expectedPreviewHash, expectedSeasonId, appliedBy = {} } = {},
) {
    const requestedSeasonId = validateApplyProof({ expectedPreviewHash, expectedSeasonId });
    const appliedByUserId = Number(appliedBy.id);
    const auditUserId = Number.isSafeInteger(appliedByUserId) && appliedByUserId > 0
        ? appliedByUserId
        : null;
    const auditUsername = String(appliedBy.username || 'maintenance-cli').trim();
    if (!auditUsername || auditUsername.length > 50) {
        throw new TypeError('The wallet reset requires an audit username no longer than 50 characters.');
    }

    const client = await pool.connect();
    let transactionOpen = false;
    try {
        await client.query('BEGIN');
        transactionOpen = true;
        await acquireSeasonLock(client);

        // Durable idempotency is checked before mutable active-season state.
        // This makes a network retry safe even after play or another season has
        // begun, while a different hash still fails closed.
        const completed = await loadOperation(client, { forUpdate: true });
        if (completed) {
            if (
                Number(completed.season_id) !== requestedSeasonId
                || completed.preview_hash.trim() !== expectedPreviewHash
            ) {
                throw new Alpha2WalletResetConflictError(
                    'RESET_ALREADY_APPLIED',
                    'The Alpha Season 2 wallet reset was already applied from a different preview.',
                );
            }
            const completedSeasonResult = await client.query(
                `SELECT season_id, season_number, slug, display_name, status,
                        ranking_method, rules, starts_at, ends_at, finalized_at,
                        final_standings_hash, final_player_count
                 FROM seasons
                 WHERE season_id = $1`,
                [completed.season_id],
            );
            const completedSeasonGameCount = await countCurrentSeasonGames(
                client,
                completed.season_id,
            );
            await client.query('COMMIT');
            transactionOpen = false;
            return appliedPayload({
                seasonRow: completedSeasonResult.rows[0],
                operation: completed,
                currentSeasonGameCount: completedSeasonGameCount,
                alreadyApplied: true,
            });
        }

        // Match wallet writers' users-row -> transactions order. The users
        // table lock first prevents account creation; locking every existing
        // user row then waits out mercy grants, game settlements, and other
        // writers while they can still finish their ledger insert. Only after
        // those row writers drain do we freeze transactions. Reversing the row
        // and transactions locks could either deadlock or let a queued credit
        // land immediately after the reset baseline.
        // EXCLUSIVE drains any transaction that has already taken a row lock
        // on game_history before we begin waiting on user rows. That prevents
        // a legacy settlement/recovery writer from later needing to upgrade
        // its game-history table lock while this reset waits on the same user.
        await client.query('LOCK TABLE game_history IN EXCLUSIVE MODE');
        await client.query('LOCK TABLE users IN SHARE MODE');
        await client.query('SELECT id FROM users ORDER BY id ASC FOR UPDATE');
        await client.query('LOCK TABLE transactions IN SHARE MODE');
        const seasonRow = await loadActiveSeason(client, { forUpdate: true });
        assertAlphaTwo(seasonRow);
        if (Number(seasonRow.season_id) !== requestedSeasonId) {
            throw new Alpha2WalletResetConflictError(
                'SEASON_CHANGED',
                'The active season changed after this wallet reset was previewed.',
            );
        }

        const currentSeasonGameCount = await countCurrentSeasonGames(client, seasonRow.season_id);
        if (currentSeasonGameCount > 0) {
            throw new Alpha2WalletResetConflictError(
                'CURRENT_SEASON_GAMES_EXIST',
                'Alpha Season 2 wallets can be reset only before its first game starts.',
            );
        }

        const accounts = await loadWalletAccounts(client);
        const actualPreviewHash = hashWalletResetPreview(
            seasonRow,
            accounts,
            currentSeasonGameCount,
        );
        if (actualPreviewHash !== expectedPreviewHash) {
            throw new Alpha2WalletResetConflictError(
                'PREVIEW_STALE',
                'Wallet balances or accounts changed after this reset was previewed. Preview again before applying.',
            );
        }

        for (const account of accounts) {
            if (account.adjustmentCents === 0) continue;
            await client.query(
                `INSERT INTO transactions
                    (user_id, transaction_type, amount, description, idempotency_key)
                 VALUES ($1, 'admin_adjustment', $2, $3, $4)`,
                [
                    account.sourceUserId,
                    account.adjustmentTokens,
                    'Alpha Season 2 opening wallet reset to 8 tokens',
                    `${ALPHA_TWO_WALLET_RESET_KEY}:${account.sourceUserId}`,
                ],
            );
        }

        const verificationResult = await client.query(
            `SELECT u.id
             FROM users u
             LEFT JOIN transactions t ON t.user_id = u.id
             GROUP BY u.id
             HAVING COALESCE(SUM(t.amount), 0)::numeric(14, 2) <> $1::numeric
             LIMIT 1`,
            [TARGET_TOKENS],
        );
        if (verificationResult.rows.length > 0) {
            const error = new Error('Wallet reset verification failed; the transaction was rolled back.');
            error.code = 'RESET_VERIFICATION_FAILED';
            throw error;
        }

        const summary = summaryFromAccounts(accounts);
        const markerResult = await client.query(
            `INSERT INTO season_wallet_reset_operations
                (operation_key, season_id, target_tokens, preview_hash,
                 account_count, changed_account_count, old_supply, new_supply,
                 minted, burned, net_change, applied_by_user_id, applied_by_username)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
             RETURNING operation_key, season_id, target_tokens, preview_hash,
                       account_count, changed_account_count, old_supply, new_supply,
                       minted, burned, net_change, applied_by_user_id,
                       applied_by_username, applied_at`,
            [
                ALPHA_TWO_WALLET_RESET_KEY,
                seasonRow.season_id,
                TARGET_TOKENS,
                actualPreviewHash,
                summary.accountCount,
                summary.changedAccountCount,
                summary.oldSupply,
                summary.newSupply,
                summary.minted,
                summary.burned,
                summary.net,
                auditUserId,
                auditUsername,
            ],
        );

        await client.query('COMMIT');
        transactionOpen = false;
        return appliedPayload({
            seasonRow,
            operation: markerResult.rows[0],
            accounts,
            alreadyApplied: false,
        });
    } catch (error) {
        if (transactionOpen) await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

module.exports = {
    ALPHA_TWO_WALLET_RESET_KEY,
    CURRENT_SEASON_GAME_COUNT_QUERY,
    OPERATION_SELECT,
    TARGET_TOKENS,
    TARGET_TOKENS_CENTS,
    WALLET_ACCOUNTS_QUERY,
    Alpha2WalletResetConflictError,
    accountsFromRows,
    applyAlpha2WalletReset,
    assertAlphaTwo,
    hashWalletResetPreview,
    previewAlpha2WalletReset,
    summaryFromAccounts,
    validateApplyProof,
};
