'use strict';

const { acquireSeasonReadLock } = require('../services/seasonService');

const GAME_VOID_ATTESTATION = 'scouts_honor';
const GAME_VOID_ATTESTATION_VERSION = 'scouts_honor_v1';
const GAME_VOID_STATUS = 'player_voided';
const GAME_VOID_TRANSACTION_TYPE = 'game_void_reversal';
const NORMAL_OUTCOME_PREFIX = 'Game Over! Winner: ';
// `forfeit_loss` remains in the legacy enum, but the current atomic settlement
// records a forfeiter through their negative buy-in and a loss stat only. It
// is intentionally not reversible here: encountering one is ambiguous legacy
// history and must fail closed instead of guessing at a second debit.
const SOURCE_TRANSACTION_TYPES = new Set([
    'buy_in',
    'win_payout',
    'wash_payout',
    'forfeit_payout',
]);

class GameVoidError extends Error {
    constructor(code, message, statusCode = 409) {
        super(message);
        this.name = 'GameVoidError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

function requirePositiveGameId(value) {
    const gameId = Number(value);
    if (!Number.isSafeInteger(gameId) || gameId <= 0) {
        throw new GameVoidError('INVALID_GAME_ID', 'A positive game id is required.', 400);
    }
    return gameId;
}

function requireRequester(requester) {
    const userId = Number(requester?.id);
    if (!Number.isSafeInteger(userId) || userId <= 0
        || typeof requester?.username !== 'string' || !requester.username.trim()) {
        throw new GameVoidError('AUTHENTICATION_REQUIRED', 'Authentication required.', 401);
    }
    return { id: userId, username: requester.username.trim() };
}

function toCents(value, label = 'ledger amount') {
    const amount = Number(value);
    if (!Number.isFinite(amount)) {
        throw new GameVoidError('GAME_LEDGER_AMBIGUOUS', `Invalid ${label}.`);
    }
    const exactCents = amount * 100;
    const cents = Math.round(exactCents);
    if (!Number.isSafeInteger(cents) || Math.abs(exactCents - cents) > 0.000001) {
        throw new GameVoidError('GAME_LEDGER_AMBIGUOUS', `Non-cent ${label}.`);
    }
    return cents;
}

function amountFromCents(cents) {
    return (cents / 100).toFixed(2);
}

function normalizeLedgerRow(row) {
    const transactionId = Number(row.transaction_id);
    const userId = Number(row.user_id);
    if (!Number.isSafeInteger(transactionId) || transactionId <= 0
        || !Number.isSafeInteger(userId) || userId <= 0) {
        throw new GameVoidError('GAME_LEDGER_AMBIGUOUS', 'The game ledger contains an invalid transaction identity.');
    }
    return {
        transactionId,
        userId,
        type: String(row.transaction_type || ''),
        amountCents: toCents(row.amount),
        reversesTransactionId: row.reverses_transaction_id === null
            || row.reverses_transaction_id === undefined
            ? null
            : Number(row.reverses_transaction_id),
    };
}

function findGenuineBuyIn(rows, userId) {
    return rows.filter(row => (
        Number(row.user_id) === userId
        && String(row.transaction_type) === 'buy_in'
        && row.reverses_transaction_id == null
        && toCents(row.amount) < 0
    ));
}

function genuineBuyInUserIds(rows) {
    const userIds = [];
    const seen = new Set();
    for (const row of rows) {
        if (String(row.transaction_type) !== 'buy_in'
            || row.reverses_transaction_id != null
            || toCents(row.amount) >= 0) continue;
        const userId = Number(row.user_id);
        if (!Number.isSafeInteger(userId) || userId <= 0 || seen.has(userId)) {
            throw new GameVoidError(
                'GAME_LEDGER_AMBIGUOUS',
                'The funded participant ledger is ambiguous.',
            );
        }
        seen.add(userId);
        userIds.push(userId);
    }
    return userIds.sort((left, right) => left - right);
}

function validateSourceLedger(rows, { playerCount, outcome }) {
    const normalizedRows = rows.map(normalizeLedgerRow);
    if (normalizedRows.length === 0
        || normalizedRows.some(row => (
            row.reversesTransactionId !== null
            || !SOURCE_TRANSACTION_TYPES.has(row.type)
        ))) {
        throw new GameVoidError(
            'GAME_LEDGER_AMBIGUOUS',
            'This game has ledger activity that cannot be reversed automatically.',
        );
    }

    const seenTransactions = new Set();
    const byUser = new Map();
    for (const row of normalizedRows) {
        if (seenTransactions.has(row.transactionId)) {
            throw new GameVoidError('GAME_LEDGER_AMBIGUOUS', 'The game ledger contains a duplicate transaction.');
        }
        seenTransactions.add(row.transactionId);
        if (!byUser.has(row.userId)) byUser.set(row.userId, []);
        byUser.get(row.userId).push(row);
    }

    const recordedPlayerCount = Number(playerCount);
    if (!Number.isInteger(recordedPlayerCount) || recordedPlayerCount < 1
        || byUser.size < 1 || byUser.size > recordedPlayerCount) {
        throw new GameVoidError('GAME_LEDGER_AMBIGUOUS', 'The funded roster does not match the game record.');
    }

    let potCents = 0;
    let payoutCents = 0;
    let buyInCents = null;
    const participantResults = [];
    const isDraw = /^Game Over! Draw \(/.test(outcome);
    const isForfeit = !isDraw
        && !outcome.startsWith(NORMAL_OUTCOME_PREFIX)
        && /^Game Over! .+ forfeited \(.*\)$/.test(outcome);

    for (const [userId, userRows] of [...byUser.entries()].sort((left, right) => left[0] - right[0])) {
        const buyIns = userRows.filter(row => row.type === 'buy_in');
        const payouts = userRows.filter(row => row.type !== 'buy_in');
        if (buyIns.length !== 1 || buyIns[0].amountCents >= 0 || payouts.length > 1) {
            throw new GameVoidError(
                'GAME_LEDGER_AMBIGUOUS',
                'Each funded player must have one exact buy-in and at most one payout.',
            );
        }
        const playerBuyInCents = -buyIns[0].amountCents;
        if (buyInCents === null) buyInCents = playerBuyInCents;
        else if (playerBuyInCents !== buyInCents) {
            throw new GameVoidError(
                'GAME_LEDGER_AMBIGUOUS',
                'Every funded player must have the same persisted buy-in.',
            );
        }
        const payout = payouts[0] || null;
        if (payout && payout.amountCents <= 0) {
            throw new GameVoidError('GAME_LEDGER_AMBIGUOUS', 'Game payouts must be positive.');
        }
        if (payout?.type === 'wash_payout' && payout.amountCents !== buyInCents) {
            throw new GameVoidError('GAME_LEDGER_AMBIGUOUS', 'A returned buy-in does not match the table cost.');
        }
        if (payout?.type === 'forfeit_payout' && !isForfeit) {
            throw new GameVoidError('GAME_LEDGER_AMBIGUOUS', 'A forfeit payout is attached to a non-forfeit game.');
        }

        potCents += buyInCents;
        payoutCents += payout?.amountCents || 0;
        const gameNetCents = userRows.reduce((sum, row) => sum + row.amountCents, 0);
        let statColumn;
        if (isDraw) statColumn = 'washes';
        else if (payout?.type === 'forfeit_payout') statColumn = 'wins';
        else if (payout?.type === 'wash_payout') statColumn = 'washes';
        else if (isForfeit && !payout) statColumn = 'losses';
        else if (gameNetCents > 0) statColumn = 'wins';
        else if (gameNetCents === 0) statColumn = 'washes';
        else statColumn = 'losses';

        participantResults.push({ userId, statColumn });
    }

    const potIsConserved = isForfeit
        ? payoutCents === potCents || (payoutCents === 0 && participantResults.length === 1)
        : payoutCents === potCents;
    if (!potIsConserved) {
        throw new GameVoidError(
            'GAME_LEDGER_AMBIGUOUS',
            'The recorded payouts do not conserve the complete funded pot.',
        );
    }

    return {
        buyInCents,
        participantResults,
        sourceRows: normalizedRows.sort((left, right) => right.transactionId - left.transactionId),
    };
}

function sourceLedgerFingerprint(validated) {
    return JSON.stringify(validated.sourceRows.map(source => [
        source.transactionId,
        source.userId,
        source.type,
        source.amountCents,
    ]));
}

function permutations(values) {
    if (values.length <= 1) return [values];
    const result = [];
    for (let index = 0; index < values.length; index += 1) {
        const head = values[index];
        const rest = [...values.slice(0, index), ...values.slice(index + 1)];
        for (const tail of permutations(rest)) result.push([head, ...tail]);
    }
    return result;
}

function validateOutcomeIdentity(validated, outcome, userRows) {
    const usernames = new Map((userRows || []).map(row => [Number(row.id), row.username]));
    if (usernames.size !== validated.participantResults.length
        || [...usernames.values()].some(username => typeof username !== 'string' || !username)) {
        throw new GameVoidError('GAME_LEDGER_AMBIGUOUS', 'The funded player identities are incomplete.');
    }
    if (/^Game Over! Draw \(/.test(outcome)) return;

    if (!outcome.startsWith(NORMAL_OUTCOME_PREFIX)) {
        const losers = validated.participantResults.filter(result => result.statColumn === 'losses');
        const allWashes = validated.participantResults.every(result => result.statColumn === 'washes');
        const fundedNames = new Set(usernames.values());
        const fundedForfeiterMatches = losers.length === 1
            && outcome.startsWith(`Game Over! ${usernames.get(losers[0].userId)} forfeited (`)
            && outcome.endsWith(')');
        const generalForfeitMatch = /^Game Over! (.+) forfeited \(.*\)$/.exec(outcome);
        const unfundedForfeiterMatches = losers.length === 0
            && allWashes
            && generalForfeitMatch
            && ![...fundedNames].some(name => outcome.startsWith(`Game Over! ${name} forfeited (`));
        if (!fundedForfeiterMatches && !unfundedForfeiterMatches) {
            throw new GameVoidError(
                'GAME_LEDGER_AMBIGUOUS',
                'The forfeit outcome does not match the funded player results.',
            );
        }
        return;
    }

    const winners = validated.participantResults.filter(result => result.statColumn === 'wins');
    const allWashes = validated.participantResults.every(result => result.statColumn === 'washes');
    const expectedNames = winners.length > 0
        ? winners.map(result => usernames.get(result.userId))
        : allWashes ? [...usernames.values()] : [];
    const matchesCanonicalWinner = expectedNames.length > 0
        && permutations(expectedNames).some(order => (
            outcome === `${NORMAL_OUTCOME_PREFIX}${order.join(' & ')}`
        ));
    if (!matchesCanonicalWinner) {
        throw new GameVoidError(
            'GAME_LEDGER_AMBIGUOUS',
            'The game winner does not match the funded payout results.',
        );
    }
}

function validateVoidManifest(rows, audit, game) {
    const expectedSourceCount = Number(audit?.source_transaction_count);
    const expectedReversalCount = Number(audit?.reversal_transaction_count);
    const expectedPlayerCount = Number(audit?.affected_player_count);
    if (!Array.isArray(rows)
        || rows.length !== expectedSourceCount
        || rows.length !== expectedReversalCount
        || !Number.isSafeInteger(expectedPlayerCount)
        || expectedPlayerCount <= 0) {
        throw new GameVoidError('GAME_VOID_INTEGRITY_ERROR', 'This void requires administrator review.');
    }

    const reversalIds = new Set();
    const userNames = new Map();
    const sourceRows = rows.map(row => {
        const sourceTransactionId = Number(row.source_transaction_id_snapshot);
        const userId = Number(row.source_user_id_snapshot);
        const reversalTransactionId = Number(row.reversal_transaction_id_snapshot);
        const sourceType = String(row.source_transaction_type || '');
        const username = row.source_username_snapshot;
        const sourceAmountCents = toCents(row.source_amount, 'manifest source amount');
        const reversalAmountCents = toCents(row.reversal_amount, 'manifest reversal amount');
        if (!Number.isSafeInteger(sourceTransactionId) || sourceTransactionId <= 0
            || !Number.isSafeInteger(reversalTransactionId) || reversalTransactionId <= 0
            || !Number.isSafeInteger(userId) || userId <= 0
            || !SOURCE_TRANSACTION_TYPES.has(sourceType)
            || typeof username !== 'string' || !username
            || reversalAmountCents !== -sourceAmountCents
            || row.reversal_idempotency_key !== `game-void:${game.game_id}:${sourceTransactionId}`
            || reversalIds.has(reversalTransactionId)) {
            throw new GameVoidError('GAME_VOID_INTEGRITY_ERROR', 'This void requires administrator review.');
        }
        reversalIds.add(reversalTransactionId);
        if (userNames.has(userId) && userNames.get(userId) !== username) {
            throw new GameVoidError('GAME_VOID_INTEGRITY_ERROR', 'This void requires administrator review.');
        }
        userNames.set(userId, username);
        return {
            transaction_id: sourceTransactionId,
            user_id: userId,
            transaction_type: sourceType,
            amount: amountFromCents(sourceAmountCents),
            reverses_transaction_id: null,
        };
    });
    if (userNames.size !== expectedPlayerCount) {
        throw new GameVoidError('GAME_VOID_INTEGRITY_ERROR', 'This void requires administrator review.');
    }

    const validated = validateSourceLedger(sourceRows, {
        playerCount: game.player_count,
        outcome: game.outcome,
    });
    validateOutcomeIdentity(
        validated,
        game.outcome,
        [...userNames].map(([id, username]) => ({ id, username })),
    );
    return [...userNames.keys()].sort((left, right) => left - right);
}

function publicVoidResult(row, { alreadyVoided, currentBalanceCents, affectedUserIds }) {
    return {
        gameId: Number(row.game_id),
        status: GAME_VOID_STATUS,
        alreadyVoided,
        voidedAt: row.voided_at,
        affectedPlayerCount: Number(row.affected_player_count),
        reversalTransactionCount: Number(row.reversal_transaction_count),
        currentBalanceCents,
        // The API route consumes this field for socket notifications and must
        // remove it before serializing the requester-safe response.
        affectedUserIds: [...affectedUserIds],
    };
}

async function currentBalanceCents(client, userId) {
    const result = await client.query(
        `SELECT (COALESCE(SUM(amount), 0) * 100)::bigint AS current_balance_cents
         FROM transactions
         WHERE user_id = $1`,
        [userId],
    );
    const cents = Number(result.rows?.[0]?.current_balance_cents ?? 0);
    if (!Number.isSafeInteger(cents)) {
        throw new GameVoidError('GAME_LEDGER_AMBIGUOUS', 'The account balance is invalid.');
    }
    return cents;
}

async function voidGame(pool, { gameId: rawGameId, requester: rawRequester, attestation }) {
    const gameId = requirePositiveGameId(rawGameId);
    const requester = requireRequester(rawRequester);
    if (attestation !== GAME_VOID_ATTESTATION) {
        throw new GameVoidError(
            'ATTESTATION_REQUIRED',
            'Scout\'s honor is required before a game can be voided.',
            400,
        );
    }
    if (!pool || typeof pool.connect !== 'function') {
        throw new TypeError('A database pool with connect() is required.');
    }

    const client = await pool.connect();
    let transactionOpen = false;
    try {
        await client.query('BEGIN');
        transactionOpen = true;
        // A shared season lock lets profile/ledger reads continue while
        // preventing a rollover from freezing standings halfway through this
        // reversal.
        await acquireSeasonReadLock(client);

        const gameResult = await client.query(
            `SELECT game.game_id,
                    game.theme,
                    game.player_count,
                    game.outcome,
                    game.end_time,
                    game.reconciliation_status,
                    game.season_id,
                    season.status AS season_status
             FROM game_history game
             JOIN seasons season ON season.season_id = game.season_id
             WHERE game.game_id = $1
             FOR UPDATE OF game`,
            [gameId],
        );
        const game = gameResult.rows?.[0];
        if (!game) throw new GameVoidError('GAME_NOT_FOUND', 'Game not found.', 404);

        // The first ledger read is deliberately unlocked. Global wallet
        // writers lock users before touching transactions, so taking game
        // transaction locks here could deadlock against deletion/reset work.
        const initialLedgerResult = await client.query(
            `SELECT transaction_id,
                    user_id,
                    transaction_type::text AS transaction_type,
                    amount,
                    reverses_transaction_id,
                    idempotency_key
             FROM transactions
             WHERE game_id = $1
             ORDER BY transaction_id DESC`,
            [gameId],
        );
        const initialLedgerRows = initialLedgerResult.rows || [];
        if (findGenuineBuyIn(initialLedgerRows, requester.id).length !== 1) {
            throw new GameVoidError(
                'FUNDED_PARTICIPANT_REQUIRED',
                'Only a funded participant can void this game.',
                403,
            );
        }

        if (game.reconciliation_status === GAME_VOID_STATUS) {
            // Read the audit marker in a fresh statement after acquiring the
            // game row lock. A concurrent request may have taken this query's
            // first READ COMMITTED snapshot before the winning void committed.
            const existingVoidResult = await client.query(
                `SELECT game_id, voided_at, affected_player_count,
                        source_transaction_count, reversal_transaction_count
                 FROM game_voids
                 WHERE game_id = $1`,
                [gameId],
            );
            const existingVoid = existingVoidResult.rows?.[0];
            if (!existingVoid?.voided_at
                || Number(existingVoid.source_transaction_count)
                    !== Number(existingVoid.reversal_transaction_count)) {
                throw new GameVoidError(
                    'GAME_VOID_INTEGRITY_ERROR',
                    'This void requires administrator review.',
                );
            }
            const manifestResult = await client.query(
                `SELECT source_transaction_id_snapshot,
                        source_user_id_snapshot,
                        source_username_snapshot,
                        source_transaction_type,
                        source_amount,
                        reversal_transaction_id_snapshot,
                        reversal_amount,
                        reversal_idempotency_key
                 FROM game_void_ledger_manifest
                 WHERE game_id = $1
                 ORDER BY source_transaction_id_snapshot DESC`,
                [gameId],
            );
            const affectedUserIds = validateVoidManifest(manifestResult.rows || [], existingVoid, game);
            const balance = await currentBalanceCents(client, requester.id);
            await client.query('COMMIT');
            transactionOpen = false;
            return publicVoidResult(existingVoid, {
                alreadyVoided: true,
                currentBalanceCents: balance,
                affectedUserIds,
            });
        }

        if (game.reconciliation_status) {
            throw new GameVoidError('GAME_NOT_VOIDABLE', 'This game has already been reconciled.');
        }
        if (game.season_status !== 'active') {
            throw new GameVoidError(
                'GAME_SEASON_FINALIZED',
                'Games from a finalized season cannot be voided.',
            );
        }
        if (typeof game.outcome !== 'string' || !game.outcome.startsWith('Game Over!') || !game.end_time) {
            throw new GameVoidError('GAME_NOT_SETTLED', 'Only a completed game can be voided.');
        }

        const initialValidated = validateSourceLedger(initialLedgerRows, {
            playerCount: game.player_count,
            outcome: game.outcome,
        });
        const participantIds = initialValidated.participantResults.map(result => result.userId);
        if (!participantIds.includes(requester.id)) {
            throw new GameVoidError(
                'FUNDED_PARTICIPANT_REQUIRED',
                'Only a funded participant can void this game.',
                403,
            );
        }

        const usersResult = await client.query(
            `SELECT id, username
             FROM users
             WHERE id = ANY($1::int[])
             ORDER BY id
             FOR UPDATE`,
            [participantIds],
        );
        if ((usersResult.rows || []).length !== participantIds.length) {
            throw new GameVoidError(
                'GAME_VOID_USER_MISSING',
                'One or more funded participants no longer exist.',
            );
        }

        // With every participant user row held in canonical id order, lock
        // and re-read the game ledger. A wallet writer that was already in
        // flight may have committed while this request waited for those user
        // locks, so the exact source identity/content must still match the
        // unlocked validation above.
        const lockedLedgerResult = await client.query(
            `SELECT transaction_id,
                    user_id,
                    transaction_type::text AS transaction_type,
                    amount,
                    reverses_transaction_id,
                    idempotency_key
             FROM transactions
             WHERE game_id = $1
             ORDER BY transaction_id DESC
             FOR UPDATE`,
            [gameId],
        );
        const validated = validateSourceLedger(lockedLedgerResult.rows || [], {
            playerCount: game.player_count,
            outcome: game.outcome,
        });
        if (sourceLedgerFingerprint(initialValidated) !== sourceLedgerFingerprint(validated)) {
            throw new GameVoidError(
                'GAME_VOID_LEDGER_CHANGED',
                'The game ledger changed while the void was being prepared. Please try again.',
            );
        }
        validateOutcomeIdentity(validated, game.outcome, usersResult.rows);

        const seasonStatsResult = await client.query(
            `SELECT user_id, wins, losses, washes
             FROM season_player_stats
             WHERE season_id = $1 AND user_id = ANY($2::int[])
             ORDER BY user_id
             FOR UPDATE`,
            [Number(game.season_id), participantIds],
        );
        if ((seasonStatsResult.rows || []).length !== participantIds.length) {
            throw new GameVoidError(
                'GAME_VOID_STATS_MISSING',
                'One or more game results cannot be reversed safely.',
            );
        }

        const reversalRecords = [];
        for (const source of validated.sourceRows) {
            const idempotencyKey = `game-void:${gameId}:${source.transactionId}`;
            const reversalResult = await client.query(
                `INSERT INTO transactions
                    (user_id, game_id, transaction_type, amount, description,
                     idempotency_key, reverses_transaction_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 RETURNING transaction_id`,
                [
                    source.userId,
                    gameId,
                    GAME_VOID_TRANSACTION_TYPE,
                    amountFromCents(-source.amountCents),
                    `Voided game #${gameId}: reversal of ${source.type} transaction #${source.transactionId}`,
                    idempotencyKey,
                    source.transactionId,
                ],
            );
            reversalRecords.push({
                source,
                reversalTransactionId: Number(reversalResult.rows?.[0]?.transaction_id),
                reversalAmountCents: -source.amountCents,
                idempotencyKey,
            });
        }
        if (reversalRecords.length !== validated.sourceRows.length
            || reversalRecords.some(record => (
                !Number.isSafeInteger(record.reversalTransactionId)
                || record.reversalTransactionId <= 0
            ))) {
            throw new GameVoidError('GAME_VOID_WRITE_FAILED', 'The game reversal could not be recorded.');
        }

        for (const result of validated.participantResults) {
            const lifetimeUpdate = await client.query(
                `UPDATE users
                 SET ${result.statColumn} = ${result.statColumn} - 1
                 WHERE id = $1 AND ${result.statColumn} > 0`,
                [result.userId],
            );
            const seasonUpdate = await client.query(
                `UPDATE season_player_stats
                 SET ${result.statColumn} = ${result.statColumn} - 1,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE season_id = $1 AND user_id = $2 AND ${result.statColumn} > 0`,
                [Number(game.season_id), result.userId],
            );
            if (lifetimeUpdate.rowCount !== 1 || seasonUpdate.rowCount !== 1) {
                throw new GameVoidError(
                    'GAME_VOID_STAT_CONFLICT',
                    'The recorded game result cannot be reversed safely.',
                );
            }
        }

        const auditResult = await client.query(
            `INSERT INTO game_voids
                (game_id, requested_by_user_id, requested_by_username,
                 attestation_version, original_outcome, affected_player_count,
                 source_transaction_count, reversal_transaction_count)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING game_id, voided_at, affected_player_count,
                       source_transaction_count, reversal_transaction_count`,
            [
                gameId,
                requester.id,
                requester.username,
                GAME_VOID_ATTESTATION_VERSION,
                game.outcome,
                participantIds.length,
                validated.sourceRows.length,
                reversalRecords.length,
            ],
        );
        const audit = auditResult.rows?.[0];
        if (!audit) throw new GameVoidError('GAME_VOID_WRITE_FAILED', 'The game void could not be recorded.');

        const usernamesById = new Map(usersResult.rows.map(row => [Number(row.id), row.username]));
        for (const record of reversalRecords) {
            const manifestInsert = await client.query(
                `INSERT INTO game_void_ledger_manifest
                    (game_id, source_transaction_id_snapshot,
                     source_user_id_snapshot, source_username_snapshot,
                     source_transaction_type, source_amount,
                     reversal_transaction_id_snapshot, reversal_amount,
                     reversal_idempotency_key)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [
                    gameId,
                    record.source.transactionId,
                    record.source.userId,
                    usernamesById.get(record.source.userId),
                    record.source.type,
                    amountFromCents(record.source.amountCents),
                    record.reversalTransactionId,
                    amountFromCents(record.reversalAmountCents),
                    record.idempotencyKey,
                ],
            );
            if (manifestInsert.rowCount !== 1) {
                throw new GameVoidError('GAME_VOID_WRITE_FAILED', 'The game void manifest could not be recorded.');
            }
        }

        const reconciledBy = `player:${requester.id}:${requester.username}`.slice(0, 128);
        const gameUpdate = await client.query(
            `UPDATE game_history
             SET reconciliation_status = $1,
                 reconciled_at = $2,
                 reconciled_by = $3
             WHERE game_id = $4 AND reconciliation_status IS NULL`,
            [GAME_VOID_STATUS, audit.voided_at, reconciledBy, gameId],
        );
        if (gameUpdate.rowCount !== 1) {
            throw new GameVoidError('GAME_VOID_CONFLICT', 'The game changed before the void committed.');
        }

        const balance = await currentBalanceCents(client, requester.id);
        await client.query('COMMIT');
        transactionOpen = false;
        return publicVoidResult(audit, {
            alreadyVoided: false,
            currentBalanceCents: balance,
            affectedUserIds: participantIds,
        });
    } catch (error) {
        if (transactionOpen) {
            try {
                await client.query('ROLLBACK');
            } catch (rollbackError) {
                console.error(`[VOID] Failed to roll back game ${gameId}:`, rollbackError);
            }
        }
        throw error;
    } finally {
        client.release();
    }
}

module.exports = {
    GAME_VOID_ATTESTATION,
    GAME_VOID_ATTESTATION_VERSION,
    GAME_VOID_STATUS,
    GAME_VOID_TRANSACTION_TYPE,
    GameVoidError,
    findGenuineBuyIn,
    genuineBuyInUserIds,
    validateOutcomeIdentity,
    validateSourceLedger,
    validateVoidManifest,
    voidGame,
};
