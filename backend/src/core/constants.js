// backend/src/core/constants.js

const SERVER_VERSION = "9.1.6";

const SUITS = { H: "Hearts", D: "Diamonds", C: "Clubs", S: "Spades" };
const RANKS_ORDER = ["6", "7", "8", "9", "J", "Q", "K", "10", "A"];
const CARD_POINT_VALUES = { "A": 11, "10": 10, "K": 4, "Q": 3, "J": 2, "9":0, "8":0, "7":0, "6":0 };
const BID_HIERARCHY = ["Pass", "Frog", "Solo", "Heart Solo"];
const BID_MULTIPLIERS = { "Frog": 1, "Solo": 2, "Heart Solo": 3 };
const PLACEHOLDER_ID = "ScoreAbsorber";

const TABLE_COSTS = {
    'miss-pauls-academy': 0.1,
    'fort-creek': 1,
    'shirecliff-road': 5,
    'dans-deck': 20,
};

// --- NEWLY ADDED ---
const THEMES = [
    { id: 'fort-creek', name: 'Fort Creek', count: 10 },
    { id: 'shirecliff-road', name: 'ShireCliff Road', count: 10 },
    { id: 'dans-deck', name: "Dan's Deck", count: 10 },
    { id: 'miss-pauls-academy', name: "Miss Paul's Academy", count: 10 },
];
// --- END NEWLY ADDED ---

// Generate the initial, unshuffled deck
const deck = [];
for (const suitKey in SUITS) {
  for (const rank of RANKS_ORDER) {
    deck.push(rank + suitKey);
  }
}

module.exports = {
    SERVER_VERSION,
    SUITS,
    RANKS_ORDER,
    CARD_POINT_VALUES,
    BID_HIERARCHY,
    BID_MULTIPLIERS,
    PLACEHOLDER_ID,
    TABLE_COSTS,
    THEMES, // --- ADDED TO EXPORTS ---
    deck
};