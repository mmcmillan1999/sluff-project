// backend/src/data/accountDeletion.js
//
// Self-service account deletion (App Store guideline 5.1.1(v) — a player must
// be able to delete their account from inside the app, not by emailing us).
//
// The delete sequence mirrors scripts/prune-inactive-users.js on purpose: ledger
// rows go, but chat and feedback are ANONYMISED rather than removed. Those rows
// are other people's conversations and our own bug reports; deleting them would
// tear holes in threads that don't belong to the departing player. Anonymising
// severs the link to them, which is what deletion actually owes.

class AccountDeletionError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'AccountDeletionError';
        this.code = code;
    }
}

const SELECT_ACCOUNT_FOR_DELETE = `
    SELECT id, username, COALESCE(is_admin, FALSE) AS is_admin, COALESCE(is_bot, FALSE) AS is_bot
    FROM users
    WHERE id = $1
    FOR UPDATE
`;

// A player with tokens committed to a live game cannot leave: settlement
// redistributes exactly the staked pot, and removing a staker mid-game would
// break that conservation. Same condition the prune maintenance task uses.
const SELECT_ACTIVE_GAME = `
    SELECT active_game.game_id
    FROM transactions active_transaction
    JOIN game_history active_game
      ON active_game.game_id = active_transaction.game_id
    WHERE active_transaction.user_id = $1
      AND (
          active_game.outcome = 'In Progress'
          OR active_game.reconciliation_status = 'manual_review'
      )
    LIMIT 1
`;

const SELECT_OTHER_ADMIN = `
    SELECT 1
    FROM users
    WHERE COALESCE(is_admin, FALSE) = TRUE
      AND COALESCE(is_bot, FALSE) = FALSE
      AND id <> $1
    LIMIT 1
`;

// Removing this player's ledger rows makes every game they funded impossible to
// reverse correctly, so those games are marked before the rows go. gameVoid.js
// refuses a flagged game: otherwise a settled forfeit whose winners have since
// deleted their accounts reads as a lone unfunded forfeit, and voiding it hands
// the forfeiter back a buy-in that nobody gives up — minting tokens in a ledger
// whose whole premise is conservation.
const FLAG_INCOMPLETE_ROSTERS = `
    UPDATE game_history
    SET roster_complete = FALSE
    WHERE game_id IN (
        SELECT DISTINCT game_id
        FROM transactions
        WHERE user_id = $1 AND game_id IS NOT NULL
    )
`;

const DELETE_TRANSACTIONS = 'DELETE FROM transactions WHERE user_id = $1';
const ANONYMISE_FEEDBACK = `
    UPDATE feedback
    SET user_id = NULL, username = 'Deleted User'
    WHERE user_id = $1
`;
const ANONYMISE_CHAT = `
    UPDATE lobby_chat_messages
    SET user_id = NULL, username = 'Deleted User'
    WHERE user_id = $1
`;
const DELETE_USER = 'DELETE FROM users WHERE id = $1 RETURNING id, username';

/**
 * Permanently deletes the caller's own account. Throws AccountDeletionError
 * with a `code` the route maps to a status; anything else is a real fault and
 * rolls back.
 */
async function deleteOwnAccount(pool, userId) {
    const client = await pool.connect();
    let transactionOpen = false;

    try {
        await client.query('BEGIN');
        transactionOpen = true;

        const { rows } = await client.query(SELECT_ACCOUNT_FOR_DELETE, [userId]);
        const account = rows?.[0];
        if (!account || account.is_bot === true) {
            throw new AccountDeletionError('NOT_FOUND', 'Account not found.');
        }

        const activeGame = await client.query(SELECT_ACTIVE_GAME, [userId]);
        if (activeGame.rowCount > 0) {
            throw new AccountDeletionError(
                'ACTIVE_GAME',
                'You have a game in progress. Finish or leave it, then delete your account.',
            );
        }

        // Losing the last admin would lock everyone out of the recovery and
        // season tooling with no way back in through the app.
        if (account.is_admin === true) {
            const otherAdmin = await client.query(SELECT_OTHER_ADMIN, [userId]);
            if (otherAdmin.rowCount === 0) {
                throw new AccountDeletionError(
                    'LAST_ADMIN',
                    'This is the only admin account. Promote another admin before deleting it.',
                );
            }
        }

        const strandedGames = await client.query(FLAG_INCOMPLETE_ROSTERS, [userId]);
        const ledger = await client.query(DELETE_TRANSACTIONS, [userId]);
        const feedback = await client.query(ANONYMISE_FEEDBACK, [userId]);
        const chat = await client.query(ANONYMISE_CHAT, [userId]);

        const deleted = await client.query(DELETE_USER, [userId]);
        if (deleted.rowCount !== 1) {
            throw new Error(`Safety check failed: deleted ${deleted.rowCount} users, expected exactly 1.`);
        }

        await client.query('COMMIT');
        transactionOpen = false;

        return {
            userId: account.id,
            username: account.username,
            removedTransactions: ledger.rowCount,
            anonymisedFeedback: feedback.rowCount,
            anonymisedChatMessages: chat.rowCount,
            gamesMarkedUnvoidable: strandedGames.rowCount,
        };
    } catch (error) {
        if (transactionOpen) {
            try {
                await client.query('ROLLBACK');
            } catch (rollbackError) {
                console.error('Account deletion rollback failed:', rollbackError.message);
            }
        }
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Drops every live socket for a deleted account so the player can't linger in a
 * seat their user row no longer backs. Disconnecting routes through the normal
 * disconnect path, which vacates pre-game seats for us.
 */
function disconnectAccountSockets(io, userId) {
    const targetId = Number(userId);
    const connectedSockets = io?.sockets?.sockets;
    if (!Number.isSafeInteger(targetId) || typeof connectedSockets?.values !== 'function') return 0;

    let dropped = 0;
    for (const socket of connectedSockets.values()) {
        if (Number(socket?.user?.id) !== targetId) continue;
        try {
            socket.emit('accountDeleted');
            socket.disconnect(true);
            dropped += 1;
        } catch (error) {
            // The row is already gone and requireAuth re-reads it per request,
            // so a stuck socket can't act. Don't fail the delete over it.
            console.error(`[DELETE] Failed to disconnect socket for user ${targetId}:`, error);
        }
    }
    return dropped;
}

module.exports = {
    AccountDeletionError,
    deleteOwnAccount,
    disconnectAccountSockets,
    SELECT_ACCOUNT_FOR_DELETE,
    SELECT_ACTIVE_GAME,
    SELECT_OTHER_ADMIN,
};
