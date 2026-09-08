const assert = require('assert');
const {
    BOT_NAMES,
    BOT_RENAMES,
    BOT_SEED_ADVISORY_LOCK_ID,
    BOT_STARTING_TOKENS,
    botEmail,
    botStartingBalanceKey,
    ensureBotAccounts,
    loadBotAccounts,
} = require('../src/data/botAccounts');
const { CURRENT_USER_QUERY } = require('../src/middleware/requireAuth');

function makeBotAccountPool({ conflictingUsername = null, conflictingEmail = null, retiredBots = [] } = {}) {
    const users = new Map();
    const transactions = new Map();
    const calls = [];
    let nextId = 100;

    // Retired bot accounts already on the books: seeded stake plus winnings.
    for (const username of retiredBots) {
        const id = nextId++;
        users.set(username, {
            id,
            username,
            email: botEmail(username),
            password_hash: '$server-only$legacy',
            is_bot: true,
            previous_usernames: [],
        });
        transactions.set(botStartingBalanceKey(username), {
            userId: id, amount: BOT_STARTING_TOKENS, description: 'New bot starting balance', idempotencyKey: botStartingBalanceKey(username),
        });
        transactions.set(`winnings:${username}`, {
            userId: id, amount: 100, description: 'winnings', idempotencyKey: `winnings:${username}`,
        });
    }

    if (conflictingUsername) {
        users.set(conflictingUsername, {
            id: nextId++,
            username: conflictingUsername,
            is_bot: false,
        });
    }
    if (conflictingEmail) {
        users.set('ReservedEmailOwner', {
            id: nextId++,
            username: 'ReservedEmailOwner',
            email: conflictingEmail,
            is_bot: false,
        });
    }

    const client = {
        async query(query, params = []) {
            const text = String(query).trim();
            calls.push({ text, params });

            if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(text)) {
                return { rows: [], rowCount: 0 };
            }
            if (text.startsWith('SELECT pg_advisory_xact_lock')) {
                return { rows: [{ pg_advisory_xact_lock: null }], rowCount: 1 };
            }
            if (text === 'LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE') {
                return { rows: [], rowCount: 0 };
            }
            if (text.startsWith('SELECT id, is_bot FROM users')) {
                const user = users.get(params[0]);
                return { rows: user ? [{ id: user.id, is_bot: user.is_bot }] : [], rowCount: user ? 1 : 0 };
            }
            if (text.startsWith('SELECT id, username, is_bot') && text.includes('WHERE email = $1')) {
                const user = [...users.values()].find(candidate => candidate.email === params[0]);
                return {
                    rows: user ? [{ id: user.id, username: user.username, is_bot: user.is_bot }] : [],
                    rowCount: user ? 1 : 0,
                };
            }
            if (text.startsWith('INSERT INTO users')) {
                const [username, email, passwordHash] = params;
                const user = {
                    id: nextId++,
                    username,
                    email,
                    password_hash: passwordHash,
                    is_bot: true,
                };
                users.set(username, user);
                return { rows: [{ id: user.id }], rowCount: 1 };
            }
            if (text.startsWith('SELECT id, is_bot, COALESCE(previous_usernames')) {
                const user = users.get(params[0]);
                return {
                    rows: user ? [{ id: user.id, is_bot: user.is_bot, previous_usernames: user.previous_usernames || [] }] : [],
                    rowCount: user ? 1 : 0,
                };
            }
            if (text.startsWith('UPDATE users') && text.includes('SET username = $1')) {
                const [newName, history, id] = params;
                const user = [...users.values()].find(candidate => candidate.id === id);
                assert.ok(user?.is_bot, 'only a retired bot account may be renamed');
                users.delete(user.username);
                Object.assign(user, { username: newName, previous_usernames: history });
                users.set(newName, user);
                return { rows: [], rowCount: 1 };
            }
            if (text.startsWith('UPDATE transactions SET idempotency_key')) {
                const [newKey, oldKey] = params;
                const transaction = transactions.get(oldKey);
                if (transaction) {
                    transactions.delete(oldKey);
                    transaction.idempotencyKey = newKey;
                    transactions.set(newKey, transaction);
                }
                return { rows: [], rowCount: transaction ? 1 : 0 };
            }
            if (text.startsWith('UPDATE users')) {
                const [email, passwordHash, id] = params;
                const user = [...users.values()].find(candidate => candidate.id === id);
                assert.ok(user?.is_bot, 'only an existing bot account may be normalized');
                Object.assign(user, { email, password_hash: passwordHash });
                return { rows: [], rowCount: 1 };
            }
            if (text.startsWith('INSERT INTO transactions')) {
                const [userId, amount, description, idempotencyKey] = params;
                if (!transactions.has(idempotencyKey)) {
                    transactions.set(idempotencyKey, { userId, amount, description, idempotencyKey });
                }
                return { rows: [], rowCount: transactions.has(idempotencyKey) ? 1 : 0 };
            }
            if (text.startsWith('SELECT user_id, amount, transaction_type')) {
                const transaction = transactions.get(params[0]);
                return {
                    rows: transaction ? [{
                        user_id: transaction.userId,
                        amount: transaction.amount,
                        transaction_type: 'admin_adjustment',
                    }] : [],
                    rowCount: transaction ? 1 : 0,
                };
            }
            if (text.startsWith('SELECT') && text.includes('FROM users u')) {
                const rows = BOT_NAMES
                    .map(username => users.get(username))
                    .filter(user => user?.is_bot)
                    .map(user => ({
                        id: user.id,
                        username: user.username,
                        tokens: [...transactions.values()]
                            .filter(transaction => transaction.userId === user.id)
                            .reduce((sum, transaction) => sum + transaction.amount, 0)
                            .toFixed(2),
                    }));
                return { rows, rowCount: rows.length };
            }
            throw new Error(`Unexpected bot-account query: ${text}`);
        },
        released: false,
        release() {
            this.released = true;
        },
    };

    return {
        calls,
        client,
        pool: { connect: async () => client },
        transactions,
        users,
    };
}

async function runBotAccountTests() {
    assert.strictEqual(BOT_NAMES.length, 20);
    assert.strictEqual(new Set(BOT_NAMES).size, BOT_NAMES.length);
    assert.match(CURRENT_USER_QUERY, /COALESCE\(is_bot, FALSE\)\s*=\s*FALSE/i);

    for (const name of BOT_NAMES) {
        assert.match(botEmail(name), /^[a-z0-9-]+@bots\.sluff\.invalid$/);
        assert.match(botStartingBalanceKey(name), /^bot-account:[a-z0-9-]+:starting-balance:v1$/);
    }

    const seeded = makeBotAccountPool();
    const firstProfiles = await ensureBotAccounts(seeded.pool);
    assert.deepStrictEqual(
        firstProfiles.map(({ username }) => username),
        BOT_NAMES,
        'startup receives bots in the canonical display order',
    );
    assert.ok(firstProfiles.every(profile => profile.isBot === true));
    assert.ok(firstProfiles.every(profile => profile.tokens === BOT_STARTING_TOKENS));
    assert.strictEqual(seeded.users.size, BOT_NAMES.length);
    assert.strictEqual(seeded.transactions.size, BOT_NAMES.length);
    assert.ok([...seeded.users.values()].every(user => user.email.endsWith('.invalid')));
    assert.ok([...seeded.users.values()].every(user => user.password_hash.startsWith('$server-only$')));
    assert.deepStrictEqual(
        seeded.calls.find(({ text }) => text.startsWith('SELECT pg_advisory_xact_lock')).params,
        [BOT_SEED_ADVISORY_LOCK_ID],
        'rolling deploys serialize the canonical seed',
    );
    assert.ok(
        seeded.calls.findIndex(({ text }) => text.startsWith('SELECT pg_advisory_xact_lock'))
            < seeded.calls.findIndex(({ text }) => text.startsWith('SELECT id, is_bot FROM users')),
        'the cross-process lock is acquired before checking whether any bot exists',
    );
    assert.ok(
        seeded.calls.findIndex(({ text }) => text === 'LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE')
            < seeded.calls.findIndex(({ text }) => text.includes('WHERE email = $1')),
        'user writes are locked before checking reserved email ownership',
    );

    const secondProfiles = await ensureBotAccounts(seeded.pool);
    assert.deepStrictEqual(secondProfiles, firstProfiles);
    assert.strictEqual(seeded.users.size, BOT_NAMES.length, 'restarts reuse the same bot identities');
    assert.strictEqual(seeded.transactions.size, BOT_NAMES.length, 'restarts do not duplicate starting tokens');
    assert.ok(seeded.calls.filter(({ text }) => text === 'COMMIT').length === 2);
    assert.strictEqual(seeded.client.released, true);

    const missing = makeBotAccountPool();
    await assert.rejects(
        () => loadBotAccounts(missing.client),
        /canonical bot accounts in canonical order/,
    );
    await assert.rejects(
        () => loadBotAccounts({
            query: async () => ({
                rows: [...BOT_NAMES].reverse().map((username, index) => ({
                    id: index + 1,
                    username,
                    tokens: '8.00',
                })),
            }),
        }),
        /canonical bot accounts in canonical order/,
        'startup rejects a roster whose identity ordering contract drifted',
    );

    const conflict = makeBotAccountPool({ conflictingUsername: BOT_NAMES[0] });
    await assert.rejects(
        () => ensureBotAccounts(conflict.pool),
        error => error?.code === 'BOT_USERNAME_CONFLICT',
        'a canonical human username must never be silently converted into a bot',
    );
    assert.ok(conflict.calls.some(({ text }) => text === 'ROLLBACK'));
    assert.ok(!conflict.calls.some(({ text }) => text === 'COMMIT'));
    assert.strictEqual(conflict.users.get(BOT_NAMES[0]).is_bot, false);

    const emailConflict = makeBotAccountPool({ conflictingEmail: botEmail(BOT_NAMES[0]) });
    await assert.rejects(
        () => ensureBotAccounts(emailConflict.pool),
        error => (
            error?.code === 'BOT_EMAIL_CONFLICT'
            && error.message.includes(botEmail(BOT_NAMES[0]))
            && error.message.includes('ReservedEmailOwner')
        ),
        'a reserved bot email owned by another account gets a stable diagnostic',
    );
    assert.ok(emailConflict.calls.some(({ text }) => text === 'ROLLBACK'));
    assert.ok(!emailConflict.calls.some(({ text }) => text === 'COMMIT'));
    assert.strictEqual(emailConflict.users.size, 1, 'email conflicts never create or convert an account');

    // Roster replacement (Sept 7 2026): a retired account is renamed in place
    // at boot — same id, tokens and history, the old name kept in
    // previous_usernames, no second starting stake — and it is idempotent.
    assert.deepStrictEqual(BOT_RENAMES, { 'Grandpa George': 'Lucky Lou', 'Courtney M.': 'Mabel Moon', 'Stephen Richins': 'Courtney Sr.' });
    for (const newName of Object.keys(BOT_RENAMES)) {
        assert.ok(BOT_NAMES.includes(newName), `${newName} is on the canonical roster`);
        assert.ok(!BOT_NAMES.includes(BOT_RENAMES[newName]), `${BOT_RENAMES[newName]} is off it`);
    }
    const inherited = makeBotAccountPool({ retiredBots: Object.values(BOT_RENAMES) });
    const luckyId = inherited.users.get('Lucky Lou').id;
    const mabelId = inherited.users.get('Mabel Moon').id;
    const courtneySrId = inherited.users.get('Courtney Sr.').id;
    const inheritedProfiles = await ensureBotAccounts(inherited.pool);
    assert.strictEqual(inherited.users.size, BOT_NAMES.length, 'renamed accounts are reused, never duplicated');
    assert.ok(!inherited.users.has('Lucky Lou') && !inherited.users.has('Mabel Moon') && !inherited.users.has('Courtney Sr.'));
    const george = inherited.users.get('Grandpa George');
    const courtneyM = inherited.users.get('Courtney M.');
    assert.strictEqual(george.id, luckyId);
    assert.strictEqual(courtneyM.id, mabelId);
    assert.strictEqual(inherited.users.get('Stephen Richins').id, courtneySrId);
    assert.deepStrictEqual(inherited.users.get('Stephen Richins').previous_usernames, ['Courtney Sr.']);
    assert.deepStrictEqual(george.previous_usernames, ['Lucky Lou']);
    assert.deepStrictEqual(courtneyM.previous_usernames, ['Mabel Moon']);
    assert.strictEqual(george.email, botEmail('Grandpa George'), 'the reserved email follows the new name');
    assert.deepStrictEqual(
        inheritedProfiles.map(({ username }) => username),
        BOT_NAMES,
        'the renamed roster still loads in canonical order',
    );
    const georgeProfile = inheritedProfiles.find(profile => profile.username === 'Grandpa George');
    assert.strictEqual(georgeProfile.id, luckyId);
    assert.strictEqual(georgeProfile.tokens, BOT_STARTING_TOKENS + 100, 'winnings carry over and no second stake is granted');
    assert.strictEqual(inherited.transactions.size, BOT_NAMES.length + 3, 'one stake per bot plus the three inherited winnings rows');
    assert.ok(inherited.transactions.has(botStartingBalanceKey('Grandpa George')), 'the stake marker moved to the new name');
    assert.ok(!inherited.transactions.has(botStartingBalanceKey('Lucky Lou')));
    const restartProfiles = await ensureBotAccounts(inherited.pool);
    assert.deepStrictEqual(restartProfiles, inheritedProfiles, 'a restart after the rename is a no-op');
    assert.strictEqual(inherited.transactions.size, BOT_NAMES.length + 3);

    console.log('Persistent bot-account tests passed.');
}

if (require.main === module) {
    runBotAccountTests().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = runBotAccountTests;
