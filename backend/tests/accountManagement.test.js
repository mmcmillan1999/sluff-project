'use strict';

const assert = require('node:assert/strict');
const {
    AccountIdentityError,
    RENAME_COOLDOWN_MS,
    USERNAME_HISTORY_LIMIT,
    nextUsernameHistory,
    renameUser,
    setCaseInsensitiveUsernamesEnforced,
    validateUsername,
} = require('../src/data/accountIdentity');
const {
    AccountDeletionError,
    deleteOwnAccount,
    disconnectAccountSockets,
} = require('../src/data/accountDeletion');
const { validateOutcomeIdentity } = require('../src/data/gameVoid');

// --- fake pool -------------------------------------------------------------
// Matches on query text the way the other data-layer suites do, so a rewritten
// query shows up as an explicit failure instead of a silent pass.

function createPool({
    user = null,
    nameTaken = false,
    activeGame = false,
    otherAdmin = true,
    updateRowCount = 1,
    deleteRowCount = 1,
    updateError = null,
} = {}) {
    const calls = [];
    let releaseCount = 0;
    const client = {
        async query(text, params = []) {
            const sql = String(text).replace(/\s+/g, ' ').trim();
            calls.push({ sql, params });
            if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };

            if (sql.includes('FROM users') && sql.includes('username_changed_at') && sql.includes('FOR UPDATE')) {
                return { rows: user ? [user] : [], rowCount: user ? 1 : 0 };
            }
            if (sql.includes('LOWER(username) = LOWER($1)')) {
                return { rows: nameTaken ? [{ '?column?': 1 }] : [], rowCount: nameTaken ? 1 : 0 };
            }
            if (sql.startsWith('UPDATE users') && sql.includes('SET username =')) {
                if (updateError) throw updateError;
                return {
                    rows: [{ id: user.id, username: params[0], username_changed_at: params[1] }],
                    rowCount: updateRowCount,
                };
            }

            if (sql.includes('FROM users') && sql.includes('is_admin') && sql.includes('FOR UPDATE')) {
                return { rows: user ? [user] : [], rowCount: user ? 1 : 0 };
            }
            if (sql.includes('FROM transactions active_transaction')) {
                return { rows: activeGame ? [{ game_id: 44 }] : [], rowCount: activeGame ? 1 : 0 };
            }
            if (sql.includes('COALESCE(is_admin, FALSE) = TRUE') && sql.includes('id <> $1')) {
                return { rows: otherAdmin ? [{ '?column?': 1 }] : [], rowCount: otherAdmin ? 1 : 0 };
            }
            if (sql.includes('SET roster_complete = FALSE')) return { rows: [], rowCount: 3 };
            if (sql.startsWith('DELETE FROM transactions')) return { rows: [], rowCount: 7 };
            if (sql.startsWith('UPDATE feedback')) return { rows: [], rowCount: 2 };
            if (sql.startsWith('UPDATE lobby_chat_messages')) return { rows: [], rowCount: 5 };
            if (sql.startsWith('DELETE FROM users')) {
                return { rows: [{ id: user.id, username: user.username }], rowCount: deleteRowCount };
            }

            throw new Error(`Unexpected query: ${sql}`);
        },
        release() { releaseCount += 1; },
    };
    return {
        calls,
        get releaseCount() { return releaseCount; },
        async connect() { return client; },
    };
}

const sqlList = pool => pool.calls.map(call => call.sql);

async function rejectsWithCode(promise, code) {
    try {
        await promise;
    } catch (error) {
        assert.ok(
            error instanceof AccountIdentityError || error instanceof AccountDeletionError,
            `expected a typed error, got ${error}`,
        );
        assert.equal(error.code, code);
        return error;
    }
    throw new Error(`expected rejection with code ${code}`);
}

// --- username validation ---------------------------------------------------

function testUsernameValidation() {
    assert.equal(validateUsername('  Ace   McGraw  ').value, 'Ace McGraw', 'collapses internal whitespace');
    assert.ok(validateUsername('Ok_Name-9').ok);

    // A validator that refuses names the product itself ships is the
    // validator's bug. The app has a bot called "Courtney Sr." and a player
    // with 148 games called "Courtney Jr.", and the first draft rejected both.
    assert.ok(validateUsername('Courtney Sr.').ok, 'abbreviating period');
    assert.ok(validateUsername('Courtney Jr.').ok);
    assert.ok(validateUsername("O'Brien").ok, 'apostrophe in a surname');
    // ...without letting punctuation run loose.
    assert.equal(validateUsername('a..b').ok, false, 'no doubled punctuation');
    assert.equal(validateUsername('...').ok, false);
    assert.equal(validateUsername('.leading').ok, false);
    assert.equal(validateUsername('amcmillan_').ok, false, 'no trailing underscore');

    for (const bad of ['ab', 'a'.repeat(21), 'bad!!name', '-lead', 'trail-', '', null, undefined, 42]) {
        assert.equal(validateUsername(bad).ok, false, `should reject ${JSON.stringify(bad)}`);
    }
    // 'System' is written into lobby chat for server notices; a player holding
    // it could impersonate the server.
    for (const reserved of ['System', 'sYsTeM', 'admin', 'Deleted User']) {
        assert.equal(validateUsername(reserved).ok, false, `should reserve ${reserved}`);
    }
    console.log('  username validation rules hold');
}


function testEveryBotNamePassesTheValidator() {
    // Bots live in the same users table and are protected by the same
    // case-insensitive index, so a bot name the validator rejects means a human
    // can never legitimately hold a name in that style.
    const { BOT_NAMES } = require('../src/data/botAccounts');
    const rejected = (BOT_NAMES || []).filter(name => !validateUsername(name).ok);
    assert.deepEqual(rejected, [], `these shipped bot names fail the validator: ${rejected.join(', ')}`);
    console.log(`  all ${(BOT_NAMES || []).length} shipped bot names satisfy the username rules`);
}

function testUsernameHistory() {
    assert.deepEqual(nextUsernameHistory(['C', 'B'], 'A', 'D'), ['A', 'C', 'B'], 'retired name goes first');
    assert.deepEqual(nextUsernameHistory(['C', 'B'], 'A', 'B'), ['A', 'C'], 'reclaimed name leaves history');
    assert.deepEqual(nextUsernameHistory(['a'], 'A', 'D'), ['A'], 'dedupes case-insensitively');

    const long = Array.from({ length: 12 }, (_, index) => `Name${index}`);
    assert.equal(
        nextUsernameHistory(long, 'Retired', 'Fresh').length,
        USERNAME_HISTORY_LIMIT,
        'history stays bounded so the void matcher cannot blow up',
    );
    console.log('  username history is ordered, deduped, and bounded');
}

// --- rename ----------------------------------------------------------------

async function testRenameHappyPath() {
    const pool = createPool({
        user: { id: 7, username: 'OldName', username_changed_at: null, is_bot: false, previous_usernames: [] },
    });
    const result = await renameUser(pool, 7, '  New   Name  ');

    assert.equal(result.username, 'New Name');
    assert.equal(result.previousUsername, 'OldName');
    assert.ok(Date.parse(result.nextChangeAllowedAt) > Date.now(), 'cooldown starts immediately');

    const update = pool.calls.find(call => call.sql.startsWith('UPDATE users'));
    assert.deepEqual(update.params[2], ['OldName'], 'retires the old name into history');
    assert.ok(sqlList(pool).includes('COMMIT'));
    assert.equal(pool.releaseCount, 1, 'client is always released');
    console.log('  rename commits, normalises, and records the former name');
}

async function testRenameCooldown() {
    const justChanged = new Date(Date.now() - (RENAME_COOLDOWN_MS - 60_000));
    const pool = createPool({
        user: { id: 7, username: 'Recent', username_changed_at: justChanged, is_bot: false, previous_usernames: [] },
    });
    const error = await rejectsWithCode(renameUser(pool, 7, 'Another'), 'RENAME_TOO_SOON');
    assert.ok(error.details.nextChangeAllowedAt, 'tells the client when it unlocks');
    assert.ok(sqlList(pool).includes('ROLLBACK'));

    const expired = new Date(Date.now() - (RENAME_COOLDOWN_MS + 60_000));
    const freshPool = createPool({
        user: { id: 7, username: 'Recent', username_changed_at: expired, is_bot: false, previous_usernames: [] },
    });
    const ok = await renameUser(freshPool, 7, 'Another');
    assert.equal(ok.username, 'Another', 'allowed once a week has elapsed');
    console.log('  rename is capped at once a week');
}

async function testRenameGuards() {
    const base = { id: 7, username: 'Someone', username_changed_at: null, is_bot: false, previous_usernames: [] };

    await rejectsWithCode(
        renameUser(createPool({ user: base }), 7, 'Someone'),
        'UNCHANGED',
    );
    await rejectsWithCode(
        renameUser(createPool({ user: base, nameTaken: true }), 7, 'Taken Name'),
        'USERNAME_TAKEN',
    );
    await rejectsWithCode(
        renameUser(createPool({ user: null }), 7, 'Whoever'),
        'NOT_FOUND',
    );
    await rejectsWithCode(
        renameUser(createPool({ user: { ...base, is_bot: true } }), 7, 'Whoever'),
        'NOT_FOUND',
    );
    await rejectsWithCode(
        renameUser(createPool({ user: base }), 7, '!!'),
        'INVALID_USERNAME',
    );

    // The unique index is the real arbiter when two renames race.
    const raced = Object.assign(new Error('duplicate key'), { code: '23505' });
    await rejectsWithCode(
        renameUser(createPool({ user: base, updateError: raced }), 7, 'Race Winner'),
        'USERNAME_TAKEN',
    );
    console.log('  rename guards: unchanged, taken, missing, bot, invalid, raced');
}

// --- deletion --------------------------------------------------------------

async function testDeleteHappyPath() {
    const pool = createPool({ user: { id: 9, username: 'Leaving', is_admin: false, is_bot: false } });
    const summary = await deleteOwnAccount(pool, 9);

    assert.deepEqual(summary, {
        userId: 9,
        username: 'Leaving',
        removedTransactions: 7,
        anonymisedFeedback: 2,
        anonymisedChatMessages: 5,
        gamesMarkedUnvoidable: 3,
    });

    const sql = sqlList(pool);
    // The flag has to land BEFORE the ledger rows go: afterwards the subquery
    // that finds this player's games returns nothing and the games stay voidable.
    const flagIndex = sql.findIndex(text => text.includes('SET roster_complete = FALSE'));
    const deleteIndex = sql.findIndex(text => text.startsWith('DELETE FROM transactions'));
    assert.ok(flagIndex >= 0, 'marks the games it is about to strand');
    assert.ok(flagIndex < deleteIndex, 'flags rosters before deleting the ledger rows');
    // Other people's threads survive with the link to the departing player cut.
    assert.ok(sql.some(text => text.startsWith('DELETE FROM transactions')));
    assert.ok(sql.some(text => text.startsWith("UPDATE feedback") && text.includes("'Deleted User'")));
    assert.ok(sql.some(text => text.startsWith("UPDATE lobby_chat_messages") && text.includes("'Deleted User'")));
    assert.ok(
        sql.indexOf('COMMIT') > sql.findIndex(text => text.startsWith('DELETE FROM users')),
        'the user row goes before the commit',
    );
    assert.equal(pool.releaseCount, 1);
    console.log('  deletion removes the ledger and anonymises retained rows');
}

async function testDeleteGuards() {
    await rejectsWithCode(
        deleteOwnAccount(createPool({
            user: { id: 9, username: 'Staked', is_admin: false, is_bot: false },
            activeGame: true,
        }), 9),
        'ACTIVE_GAME',
    );

    // A quarantined ('manual_review') game is terminal and nothing in the app
    // clears it, so it must never veto deletion — that blocked the player
    // forever and told them to leave a game that had already ended.
    const quarantined = createPool({ user: { id: 9, username: 'Quarantined', is_admin: false, is_bot: false } });
    await deleteOwnAccount(quarantined, 9);
    const activeGameQuery = quarantined.calls.find(call => call.sql.includes('FROM transactions active_transaction'));
    assert.ok(
        !activeGameQuery.sql.includes('manual_review'),
        'the live-game guard must not treat a terminal quarantine as in-progress',
    );
    assert.ok(activeGameQuery.sql.includes("outcome = 'In Progress'"), 'still blocks a genuinely live game');
    await rejectsWithCode(
        deleteOwnAccount(createPool({
            user: { id: 9, username: 'OnlyAdmin', is_admin: true, is_bot: false },
            otherAdmin: false,
        }), 9),
        'LAST_ADMIN',
    );
    await rejectsWithCode(deleteOwnAccount(createPool({ user: null }), 9), 'NOT_FOUND');
    await rejectsWithCode(
        deleteOwnAccount(createPool({ user: { id: 9, username: 'Bot', is_admin: false, is_bot: true } }), 9),
        'NOT_FOUND',
    );

    // An admin with a peer is free to go.
    const summary = await deleteOwnAccount(createPool({
        user: { id: 9, username: 'OneOfTwo', is_admin: true, is_bot: false },
        otherAdmin: true,
    }), 9);
    assert.equal(summary.userId, 9);

    // A delete that would touch more than one row must abort, not commit.
    const wrongCount = createPool({
        user: { id: 9, username: 'Odd', is_admin: false, is_bot: false },
        deleteRowCount: 2,
    });
    await assert.rejects(() => deleteOwnAccount(wrongCount, 9), /expected exactly 1/);
    assert.ok(sqlList(wrongCount).includes('ROLLBACK'), 'rolls back on a failed safety check');
    console.log('  deletion guards: active game, last admin, missing, bot, row-count safety');
}

function testDisconnectAccountSockets() {
    const events = [];
    const makeSocket = (userId) => ({
        user: { id: userId },
        emit(event) { events.push([userId, event]); },
        disconnect() { events.push([userId, 'disconnected']); },
    });
    const io = { sockets: { sockets: new Map([['a', makeSocket(9)], ['b', makeSocket(10)], ['c', makeSocket(9)]]) } };

    assert.equal(disconnectAccountSockets(io, 9), 2, 'drops every socket for the deleted account only');
    assert.deepEqual(events.filter(([id]) => id === 10), [], 'other players are untouched');

    // A throwing socket must not fail an already-committed deletion.
    const angry = { user: { id: 9 }, emit() { throw new Error('gone'); }, disconnect() {} };
    const noisyIo = { sockets: { sockets: new Map([['x', angry]]) } };
    assert.equal(disconnectAccountSockets(noisyIo, 9), 0);
    assert.equal(disconnectAccountSockets(null, 9), 0, 'tolerates a missing io');
    console.log('  socket cleanup is scoped and never throws');
}

// --- rename x game-void interaction ---------------------------------------

function testVoidRecognisesFormerNames() {
    const validated = {
        participantResults: [
            { userId: 1, statColumn: 'wins' },
            { userId: 2, statColumn: 'washes' },
            { userId: 3, statColumn: 'losses' },
        ],
    };
    // game_history.outcome froze the name this player held at the time.
    const outcome = 'Game Over! Winner: OldName';
    const renamed = [
        { id: 1, username: 'BrandNew', previous_usernames: ['OldName'] },
        { id: 2, username: 'Player2', previous_usernames: [] },
        { id: 3, username: 'Player3', previous_usernames: [] },
    ];
    assert.doesNotThrow(() => validateOutcomeIdentity(validated, outcome, renamed));

    // Without the history the same void would be refused — this is the
    // regression the alias list exists to prevent.
    const withoutHistory = renamed.map(row => ({ ...row, previous_usernames: [] }));
    assert.throws(
        () => validateOutcomeIdentity(validated, outcome, withoutHistory),
        /does not match the funded payout results/,
    );

    // A forfeit outcome resolves through the alias list too.
    const forfeitValidated = {
        participantResults: [
            { userId: 1, statColumn: 'wins' },
            { userId: 2, statColumn: 'wins' },
            { userId: 3, statColumn: 'losses' },
        ],
    };
    assert.doesNotThrow(() => validateOutcomeIdentity(
        forfeitValidated,
        'Game Over! GoneName forfeited (disconnect timeout)',
        [
            { id: 1, username: 'Player1', previous_usernames: [] },
            { id: 2, username: 'Player2', previous_usernames: [] },
            { id: 3, username: 'Player3', previous_usernames: ['GoneName'] },
        ],
    ));

    // An unrelated name still fails: aliases widen recognition, never authority.
    assert.throws(
        () => validateOutcomeIdentity(validated, 'Game Over! Winner: SomeoneElse', renamed),
        /does not match the funded payout results/,
    );
    console.log('  voiding a pre-rename game still recognises the player');
}

async function testRenameDisabledWithoutTheIndex() {
    const base = { id: 7, username: 'Someone', username_changed_at: null, is_bot: false, previous_usernames: [] };
    setCaseInsensitiveUsernamesEnforced(false);
    try {
        await rejectsWithCode(renameUser(createPool({ user: base }), 7, 'New Name'), 'RENAME_UNAVAILABLE');
    } finally {
        setCaseInsensitiveUsernamesEnforced(true);
    }
    // Restored: renames work again once the index is in place.
    const ok = await renameUser(createPool({ user: base }), 7, 'New Name');
    assert.equal(ok.username, 'New Name');
    console.log('  renames refuse themselves when the uniqueness index is missing');
}

async function testRenameHoldBlocksSeating() {
    // The rename route checks "not seated" and then runs a multi-statement
    // transaction. A join landing inside that window seats the OLD name and
    // orphans every name-keyed engine structure the instant the rename commits.
    // The hold closes the window; seating paths refuse while it is up.
    const GameService = require('../src/services/GameService');
    const { createGameServiceWithoutHeartbeat } = require('./test-helpers');
    const mockIo = { to: () => ({ emit: () => {} }), emit: () => {}, sockets: { sockets: new Map() } };
    const mockPool = {
        query: () => Promise.resolve({ rows: [], rowCount: 0 }),
        connect: async () => ({ query: () => Promise.resolve({ rows: [], rowCount: 0 }), release() {} }),
    };
    const service = createGameServiceWithoutHeartbeat(GameService, mockIo, mockPool);

    assert.equal(service.isRenameInFlight(7), false, 'no hold by default');
    const release = service.holdRenameFor(7);
    assert.equal(service.isRenameInFlight(7), true);
    assert.equal(service.isRenameInFlight('7'), true, 'string ids normalise');
    assert.equal(service.isRenameInFlight(8), false, 'other players are unaffected');

    const seat = service.claimQuickPlaySeat('fort-creek', { id: 7, username: 'Mid Rename' }, 'sock', '8.00');
    assert.equal(seat, null, 'quick play refuses a seat mid-rename');

    release();
    assert.equal(service.isRenameInFlight(7), false, 'the hold releases');
    // Released twice must be harmless — the route calls it in a finally.
    release();
    assert.equal(service.isRenameInFlight(7), false);
    console.log('  a rename in flight blocks seating until it releases');
}

async function run() {
    testUsernameValidation();
    testEveryBotNamePassesTheValidator();
    await testRenameHoldBlocksSeating();
    testUsernameHistory();
    await testRenameHappyPath();
    await testRenameCooldown();
    await testRenameGuards();
    await testRenameDisabledWithoutTheIndex();
    await testDeleteHappyPath();
    await testDeleteGuards();
    testDisconnectAccountSockets();
    testVoidRecognisesFormerNames();
    console.log('Account rename and deletion tests passed.');
}

if (require.main === module) {
    run().catch(error => {
        console.error(error);
        process.exit(1);
    });
}

module.exports = run;
