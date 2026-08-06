// backend/src/core/products.js
//
// The purchasable catalog: one entry per SKU, mapping every sales rail's
// product id to the single entitlement key the game actually checks. Store
// ids follow each platform's conventions (Apple reverse-DNS, Google
// lowercase-underscore) and must match what gets configured in App Store
// Connect / Play Console when those listings are created.
//
// Prices here are display truth for the web store; the stores themselves
// price by tier ($4.99), configured on their side.

'use strict';

const PRODUCTS = Object.freeze({
    'deck-mcmillan': Object.freeze({
        entitlement: 'deck-mcmillan',
        name: 'McMillan Crest deck',
        description: 'Clan claymore and motto over dress-tartan gold.',
        kind: 'non_consumable',
        priceUsd: 4.99,
        appleProductId: 'com.playsluff.deck.mcmillan',
        googleProductId: 'deck_mcmillan',
    }),
});

const VALID_ENTITLEMENTS = Object.freeze(new Set(
    Object.values(PRODUCTS).map(product => product.entitlement),
));

// The catalog as clients see it — no store internals, just what the shelf
// card needs.
const publicCatalog = () => Object.entries(PRODUCTS).map(([id, product]) => ({
    id,
    entitlement: product.entitlement,
    name: product.name,
    description: product.description,
    kind: product.kind,
    priceUsd: product.priceUsd,
}));

module.exports = { PRODUCTS, VALID_ENTITLEMENTS, publicCatalog };
