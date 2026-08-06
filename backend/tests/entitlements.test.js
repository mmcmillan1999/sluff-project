// backend/tests/entitlements.test.js
// The ownership layer every sales rail funnels into: idempotent grants,
// traceable revocation, and a catalog whose store ids stay well-formed for
// the platforms they will be registered with.

const assert = require('assert');
const { PRODUCTS, VALID_ENTITLEMENTS, publicCatalog } = require('../src/core/products');
const {
    grantEntitlement,
    revokeEntitlement,
    listEntitlements,
    hasEntitlement,
} = require('../src/services/entitlements');

// An in-memory pool speaking just enough SQL for the service.
function makePool() {
    const rows = new Map(); // "userId|key" -> row
    return {
        rows,
        async query(sql, params) {
            const text = sql.trim();
            if (/^INSERT INTO player_entitlements/i.test(text)) {
                const [userId, key, source, ref] = params;
                const mapKey = `${userId}|${key}`;
                if (rows.has(mapKey)) return { rowCount: 0 };
                rows.set(mapKey, { user_id: userId, entitlement_key: key, source, external_ref: ref });
                return { rowCount: 1 };
            }
            if (/^DELETE FROM player_entitlements/i.test(text)) {
                const [userId, key] = params;
                return { rowCount: rows.delete(`${userId}|${key}`) ? 1 : 0 };
            }
            if (/^SELECT entitlement_key/i.test(text)) {
                const [userId] = params;
                return {
                    rows: [...rows.values()]
                        .filter(row => row.user_id === userId)
                        .map(row => ({ entitlement_key: row.entitlement_key }))
                        .sort((a, b) => a.entitlement_key.localeCompare(b.entitlement_key)),
                };
            }
            if (/^SELECT 1 FROM player_entitlements/i.test(text)) {
                const [userId, key] = params;
                return { rows: rows.has(`${userId}|${key}`) ? [{ '?column?': 1 }] : [] };
            }
            throw new Error(`unexpected SQL: ${text.slice(0, 60)}`);
        },
    };
}

async function runEntitlementTests() {
    console.log('Running entitlement tests...');
    let testCounter = 1;
    const pass = (name) => console.log(`  ✔ Test ${testCounter++}: ${name}`);

    // --- Catalog shape: store ids must satisfy each platform's rules ---
    {
        for (const [id, product] of Object.entries(PRODUCTS)) {
            assert.ok(VALID_ENTITLEMENTS.has(product.entitlement), `${id} entitlement registered`);
            assert.match(product.appleProductId, /^[a-z0-9.]+$/, `${id} Apple id is reverse-DNS safe`);
            assert.match(product.googleProductId, /^[a-z0-9_]+$/, `${id} Google id is lowercase/underscore`);
            assert.ok(Number.isFinite(product.priceUsd) && product.priceUsd > 0);
        }
        const shelf = publicCatalog();
        assert.ok(shelf.length >= 1);
        assert.ok(!('appleProductId' in shelf[0]), 'public catalog hides store internals');
        assert.strictEqual(shelf.find(p => p.id === 'deck-mcmillan').priceUsd, 4.99);
        pass('The catalog is well-formed and the McMillan deck sells for $4.99.');
    }

    // --- Grants are idempotent across rails ---
    {
        const pool = makePool();
        let result = await grantEntitlement(pool, 7, 'deck-mcmillan', 'apple', 'txn-1000');
        assert.deepStrictEqual(result, { granted: true, alreadyOwned: false });
        // The same receipt replayed, or the same deck bought again on web:
        result = await grantEntitlement(pool, 7, 'deck-mcmillan', 'apple', 'txn-1000');
        assert.deepStrictEqual(result, { granted: false, alreadyOwned: true });
        result = await grantEntitlement(pool, 7, 'deck-mcmillan', 'stripe', 'pi_123');
        assert.deepStrictEqual(result, { granted: false, alreadyOwned: true });
        assert.strictEqual(pool.rows.size, 1, 'one ownership row, ever');
        pass('A replayed receipt or cross-rail repeat purchase grants exactly once.');
    }

    // --- Invalid inputs never write ---
    {
        const pool = makePool();
        assert.deepStrictEqual(
            await grantEntitlement(pool, 7, 'deck-imaginary', 'apple'),
            { granted: false, alreadyOwned: false },
        );
        assert.deepStrictEqual(
            await grantEntitlement(pool, 7, 'deck-mcmillan', 'carrier-pigeon'),
            { granted: false, alreadyOwned: false },
        );
        assert.deepStrictEqual(
            await grantEntitlement(pool, -1, 'deck-mcmillan', 'admin'),
            { granted: false, alreadyOwned: false },
        );
        assert.strictEqual(pool.rows.size, 0);
        pass('Unknown entitlements, sources, and bad user ids are refused.');
    }

    // --- Ownership reads and refund revocation ---
    {
        const pool = makePool();
        await grantEntitlement(pool, 7, 'deck-mcmillan', 'google', 'GPA.1234');
        assert.strictEqual(await hasEntitlement(pool, 7, 'deck-mcmillan'), true);
        assert.strictEqual(await hasEntitlement(pool, 8, 'deck-mcmillan'), false);
        assert.deepStrictEqual(await listEntitlements(pool, 7), ['deck-mcmillan']);
        assert.strictEqual(await revokeEntitlement(pool, 7, 'deck-mcmillan'), true);
        assert.strictEqual(await revokeEntitlement(pool, 7, 'deck-mcmillan'), false, 'second revoke is a no-op');
        assert.strictEqual(await hasEntitlement(pool, 7, 'deck-mcmillan'), false);
        pass('Ownership reads true, refunds revoke it, and nothing double-fires.');
    }

    console.log('Entitlement tests passed.');
}

module.exports = runEntitlementTests;

if (require.main === module) {
    runEntitlementTests().catch(error => { console.error(error); process.exitCode = 1; });
}
