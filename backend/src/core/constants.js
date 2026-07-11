// backend/src/core/constants.js

const SERVER_VERSION = "12.9.0 Recap scoring and podium payouts";

const SUITS = { H: "Hearts", D: "Diamonds", C: "Clubs", S: "Spades" };
const RANKS_ORDER = ["6", "7", "8", "9", "J", "Q", "K", "10", "A"];
const CARD_POINT_VALUES = { "A": 11, "10": 10, "K": 4, "Q": 3, "J": 2, "9":0, "8":0, "7":0, "6":0 };
const BID_HIERARCHY = ["Pass", "Frog", "Solo", "Heart Solo"];
const BID_MULTIPLIERS = { "Frog": 1, "Solo": 2, "Heart Solo": 3 };
const PLACEHOLDER_ID = "ScoreAbsorber";
// The natural finale is 9.2s and the longest score count is 3.55s. Shared
// state transitions stay locked until every normally animated client has had
// that full window, while reduced-motion clients may show static results early.
const ROUND_PRESENTATION_LOCK_MS = 13_000;
// A vanished/backgrounded client must not pin a live table forever. Once the
// normal presentation lock has elapsed, acknowledgements may hold the shared
// transition for at most this additional grace period.
const ROUND_PRESENTATION_ACK_GRACE_MS = 30_000;

const TABLE_COSTS = {
    'miss-pauls-academy': 0.1,
    'fort-creek': 1,
    'shirecliff-road': 5,
    'dans-deck': 20,
};

// --- NEWLY ADDED ---
const THEMES = [
    { id: 'fort-creek', name: 'Fort Creek', count: 10 },
    { id: 'shirecliff-road', name: 'Shirecliff', count: 10 },
    { id: 'dans-deck', name: "Dan's Deck", count: 10 },
    { id: 'miss-pauls-academy', name: "Academy", count: 10 },
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
    ROUND_PRESENTATION_LOCK_MS,
    ROUND_PRESENTATION_ACK_GRACE_MS,
    TABLE_COSTS,
    THEMES, // --- ADDED TO EXPORTS ---
    deck
};
