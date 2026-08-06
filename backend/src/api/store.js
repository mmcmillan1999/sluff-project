// backend/src/api/store.js
// The store's server truth: the public catalog, the caller's owned
// entitlements, and admin grant/revoke for support and testing. The
// platform purchase-verification endpoints (Apple App Store Server API,
// Google Play Developer API, Stripe webhooks) land here when those
// accounts exist — every rail funnels into the same entitlement grant.

const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const { publicCatalog, VALID_ENTITLEMENTS } = require('../core/products');
const {
    grantEntitlement,
    revokeEntitlement,
    listEntitlements,
} = require('../services/entitlements');

const createStoreRoutes = (pool, jwt) => {
    const router = express.Router();
    const checkAuth = requireAuth(pool, jwt);

    // GET /api/store — the shelf: catalog plus what the caller already owns.
    router.get('/', checkAuth, async (req, res) => {
        try {
            const entitlements = await listEntitlements(pool, req.user.id);
            res.json({ catalog: publicCatalog(), entitlements });
        } catch (error) {
            console.error('Error loading store:', error);
            res.status(500).json({ message: 'Unable to load the store.' });
        }
    });

    // POST /api/store/admin-grant { userId, entitlement, revoke? } — admin
    // support tool: grant a purchase manually (or claw one back after a
    // refund) until the automated rails land, and forever after for support.
    router.post('/admin-grant', checkAuth, async (req, res) => {
        if (req.user.is_admin !== true) {
            return res.status(403).json({ message: 'Administrator only.' });
        }
        const userId = Number(req.body?.userId);
        const entitlement = req.body?.entitlement;
        if (!Number.isSafeInteger(userId) || userId <= 0 || !VALID_ENTITLEMENTS.has(entitlement)) {
            return res.status(400).json({ message: 'A valid userId and entitlement are required.' });
        }
        try {
            if (req.body?.revoke === true) {
                const revoked = await revokeEntitlement(pool, userId, entitlement);
                return res.json({ revoked });
            }
            const result = await grantEntitlement(pool, userId, entitlement, 'admin', `admin:${req.user.id}`);
            return res.json(result);
        } catch (error) {
            console.error('Error in admin entitlement grant:', error);
            return res.status(500).json({ message: 'Unable to update the entitlement.' });
        }
    });

    return router;
};

module.exports = createStoreRoutes;
