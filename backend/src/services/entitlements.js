// backend/src/services/entitlements.js
//
// Durable ownership, one API for every sales rail. Apple IAP, Google Play
// Billing, Stripe on the web, and admin grants all end at the same place: a
// player_entitlements row. Grants are idempotent (a replayed store receipt
// or a double-clicked admin button changes nothing) and revocation exists
// because refunds exist.

'use strict';

const { VALID_ENTITLEMENTS } = require('../core/products');

const VALID_SOURCES = new Set(['apple', 'google', 'stripe', 'admin', 'alpha']);

/**
 * Grant an entitlement. Returns { granted, alreadyOwned } — both false only
 * when the inputs were invalid.
 */
async function grantEntitlement(pool, userId, entitlementKey, source, externalRef = null) {
    const id = Number(userId);
    if (!Number.isSafeInteger(id) || id <= 0) return { granted: false, alreadyOwned: false };
    if (!VALID_ENTITLEMENTS.has(entitlementKey)) return { granted: false, alreadyOwned: false };
    if (!VALID_SOURCES.has(source)) return { granted: false, alreadyOwned: false };

    const result = await pool.query(
        `INSERT INTO player_entitlements (user_id, entitlement_key, source, external_ref)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, entitlement_key) DO NOTHING`,
        [id, entitlementKey, source, externalRef],
    );
    const granted = result.rowCount === 1;
    return { granted, alreadyOwned: !granted };
}

/** Revoke an entitlement (refunds, admin corrections). True when a row fell. */
async function revokeEntitlement(pool, userId, entitlementKey) {
    const result = await pool.query(
        'DELETE FROM player_entitlements WHERE user_id = $1 AND entitlement_key = $2',
        [Number(userId), entitlementKey],
    );
    return result.rowCount > 0;
}

/** Every entitlement key this player owns. */
async function listEntitlements(pool, userId) {
    const { rows } = await pool.query(
        'SELECT entitlement_key FROM player_entitlements WHERE user_id = $1 ORDER BY entitlement_key',
        [Number(userId)],
    );
    return rows.map(row => row.entitlement_key);
}

async function hasEntitlement(pool, userId, entitlementKey) {
    const { rows } = await pool.query(
        'SELECT 1 FROM player_entitlements WHERE user_id = $1 AND entitlement_key = $2',
        [Number(userId), entitlementKey],
    );
    return rows.length > 0;
}

module.exports = { grantEntitlement, revokeEntitlement, listEntitlements, hasEntitlement, VALID_SOURCES };
