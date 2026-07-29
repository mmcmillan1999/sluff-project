// backend/src/data/accountIdentity.js
//
// Username rules and the self-service rename.
//
// A username is identity in two directions: it is the key the live game engine
// uses for seats, scores, hands and turn order, and it is the name other
// players see in chat. So a rename is deliberately narrow — it rewrites
// `users.username` and nothing else. Every other username column in the schema
// (`lobby_chat_messages`, `feedback`, `*_username_snapshot`, `applied_by_*`,
// `requested_by_*`) is a point-in-time record of who did what, and rewriting
// those would falsify history rather than update it. Leaderboards and profiles
// join back to `users`, so they follow the new name on their own.

const RENAME_COOLDOWN_DAYS = 7;
const RENAME_COOLDOWN_MS = RENAME_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

const USERNAME_MIN_LENGTH = 3;
const USERNAME_MAX_LENGTH = 20; // the column holds 50; 20 is what the UI can lay out
// Letters and digits, with single internal separators. No leading separator and
// no trailing one except a period, so a name cannot be padded with invisible
// space to shadow another — but ordinary human names still fit.
//
// The period and apostrophe are here because the first draft rejected them and
// that was wrong: the app ships a bot called "Courtney Sr.", and a player with
// 148 games is called "Courtney Jr.". A validator that refuses names the
// product itself uses is the validator's bug, not the name's. "O'Brien" is the
// same story.
//
// Known limit: a period may separate or end a name but cannot be followed by a
// space, so "J.R. Smith" is refused while "JR Smith" and "Courtney Sr." pass.
// Allowing it means also allowing "a..b", and initials-with-periods are rarer
// than sloppy punctuation.
const USERNAME_PATTERN = /^[A-Za-z0-9]+(?:[ _.'-][A-Za-z0-9]+)*\.?$/;

// Names that aren't accounts but appear as a username in the UI. Bot names need
// no entry here — bots are real rows in `users`, so the case-insensitive unique
// index already protects them. 'System' is the one that matters: lobby chat
// writes server notices under that name and renders it verbatim.
const RESERVED_USERNAMES = new Set([
    'system',
    'sluff',
    'admin',
    'administrator',
    'moderator',
    'deleted user',
]);

// How many former names to remember. They exist so a void request can still
// recognise a player in a pre-rename game outcome (see data/gameVoid.js), and
// that matcher's cost grows with the count, so the list is bounded.
const USERNAME_HISTORY_LIMIT = 5;

// Set by createTables at boot. The app-level availability check below is only
// race-safe because the LOWER(username) unique index is the final arbiter; if
// that index could not be built, renames must stop rather than run on a check
// two concurrent requests can both pass.
let caseInsensitiveUsernamesEnforced = true;

function setCaseInsensitiveUsernamesEnforced(enforced) {
    caseInsensitiveUsernamesEnforced = enforced !== false;
}

class AccountIdentityError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = 'AccountIdentityError';
        this.code = code;
        this.details = details;
    }
}

/**
 * Shared by registration and rename so the two can never drift apart.
 * @returns {{ok: true, value: string} | {ok: false, message: string}}
 */
function validateUsername(raw) {
    if (typeof raw !== 'string') {
        return { ok: false, message: 'Please choose a username.' };
    }
    // Collapse runs of whitespace so "Ace   McGraw" and "Ace McGraw" can't
    // both exist and read identically in chat.
    const value = raw.trim().replace(/\s+/g, ' ');

    if (value.length < USERNAME_MIN_LENGTH) {
        return { ok: false, message: `Usernames need at least ${USERNAME_MIN_LENGTH} characters.` };
    }
    if (value.length > USERNAME_MAX_LENGTH) {
        return { ok: false, message: `Usernames can be at most ${USERNAME_MAX_LENGTH} characters.` };
    }
    if (!USERNAME_PATTERN.test(value)) {
        return {
            ok: false,
            message: 'Use letters and numbers, with single spaces, hyphens, or underscores between them.',
        };
    }
    if (RESERVED_USERNAMES.has(value.toLowerCase())) {
        return { ok: false, message: 'That username is reserved.' };
    }
    return { ok: true, value };
}

function nextChangeAllowedAt(changedAt) {
    if (!changedAt) return null;
    const changedMs = changedAt instanceof Date ? changedAt.getTime() : Date.parse(changedAt);
    if (!Number.isFinite(changedMs)) return null;
    return new Date(changedMs + RENAME_COOLDOWN_MS);
}

const SELECT_FOR_RENAME = `
    SELECT id, username, username_changed_at, COALESCE(is_bot, FALSE) AS is_bot,
           COALESCE(previous_usernames, ARRAY[]::text[]) AS previous_usernames
    FROM users
    WHERE id = $1
    FOR UPDATE
`;

// Case-insensitive so a rename can't shadow an existing player (or one of the
// bot accounts, which live in this same table) by changing only capitalisation.
// Excludes the caller's own row so "mcsaddle" -> "McSaddle" is still allowed.
const SELECT_NAME_TAKEN = `
    SELECT 1
    FROM users
    WHERE LOWER(username) = LOWER($1)
      AND id <> $2
    LIMIT 1
`;

const UPDATE_USERNAME = `
    UPDATE users
    SET username = $1, username_changed_at = $2, previous_usernames = $3::text[]
    WHERE id = $4
    RETURNING id, username, username_changed_at
`;

// Most-recent-first, deduplicated, and bounded. A name the player is reclaiming
// drops out of the history, since it is current again.
function nextUsernameHistory(previousHistory, retiredName, nextName) {
    const seen = new Set([nextName.toLowerCase()]);
    const history = [];
    for (const name of [retiredName, ...(previousHistory || [])]) {
        if (typeof name !== 'string' || !name) continue;
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        history.push(name);
        if (history.length >= USERNAME_HISTORY_LIMIT) break;
    }
    return history;
}

/**
 * Renames a player, at most once every RENAME_COOLDOWN_DAYS.
 * Throws AccountIdentityError with a `code` the route maps to a status.
 */
async function renameUser(pool, userId, requestedName, { now = new Date() } = {}) {
    if (!caseInsensitiveUsernamesEnforced) {
        throw new AccountIdentityError(
            'RENAME_UNAVAILABLE',
            'Username changes are temporarily unavailable. Please try again later.',
        );
    }
    const validation = validateUsername(requestedName);
    if (!validation.ok) {
        throw new AccountIdentityError('INVALID_USERNAME', validation.message);
    }
    const nextName = validation.value;

    const client = await pool.connect();
    let transactionOpen = false;
    try {
        await client.query('BEGIN');
        transactionOpen = true;

        const { rows } = await client.query(SELECT_FOR_RENAME, [userId]);
        const user = rows?.[0];
        if (!user || user.is_bot === true) {
            throw new AccountIdentityError('NOT_FOUND', 'Account not found.');
        }

        const allowedAt = nextChangeAllowedAt(user.username_changed_at);
        if (allowedAt && allowedAt.getTime() > now.getTime()) {
            throw new AccountIdentityError(
                'RENAME_TOO_SOON',
                `You can change your username again after ${allowedAt.toISOString()}.`,
                { nextChangeAllowedAt: allowedAt.toISOString() },
            );
        }

        if (user.username === nextName) {
            throw new AccountIdentityError('UNCHANGED', 'That is already your username.');
        }

        const taken = await client.query(SELECT_NAME_TAKEN, [nextName, userId]);
        if (taken.rowCount > 0) {
            throw new AccountIdentityError('USERNAME_TAKEN', 'That username is already taken.');
        }

        const history = nextUsernameHistory(user.previous_usernames, user.username, nextName);
        const updated = await client.query(UPDATE_USERNAME, [nextName, now, history, userId]);
        if (updated.rowCount !== 1) {
            throw new Error(`Rename affected ${updated.rowCount} rows; expected exactly 1.`);
        }

        await client.query('COMMIT');
        transactionOpen = false;

        return {
            previousUsername: user.username,
            username: updated.rows[0].username,
            nextChangeAllowedAt: nextChangeAllowedAt(updated.rows[0].username_changed_at).toISOString(),
        };
    } catch (error) {
        if (transactionOpen) {
            try {
                await client.query('ROLLBACK');
            } catch (rollbackError) {
                console.error('Rename rollback failed:', rollbackError.message);
            }
        }
        // The unique index is the real arbiter — two simultaneous renames to the
        // same name both pass the check above and one loses here.
        if (error?.code === '23505') {
            throw new AccountIdentityError('USERNAME_TAKEN', 'That username is already taken.');
        }
        throw error;
    } finally {
        client.release();
    }
}

module.exports = {
    AccountIdentityError,
    RENAME_COOLDOWN_DAYS,
    RENAME_COOLDOWN_MS,
    RESERVED_USERNAMES,
    USERNAME_HISTORY_LIMIT,
    USERNAME_MAX_LENGTH,
    USERNAME_MIN_LENGTH,
    USERNAME_PATTERN,
    nextChangeAllowedAt,
    nextUsernameHistory,
    renameUser,
    setCaseInsensitiveUsernamesEnforced,
    validateUsername,
    SELECT_FOR_RENAME,
    SELECT_NAME_TAKEN,
    UPDATE_USERNAME,
};
