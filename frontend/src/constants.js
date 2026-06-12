// frontend/src/constants.js

/**
 * This file centralizes constants used across the frontend application
 * to ensure consistency and make future updates easier.
 */

// Card and Suit Definitions
export const SUITS_MAP = { H: "Hearts", D: "Diamonds", C: "Clubs", S: "Spades" };
// --- FIX: Corrected UTF-8 characters for suit symbols ---
export const SUIT_SYMBOLS = { H: '♥', D: '♦', C: '♣', S: '♠' };
export const SUIT_COLORS = { H: '#c62828', D: '#c62828', C: '#1b1b1b', S: '#1b1b1b' };
// White card stock for every suit — suit identity comes from the pip color,
// matching standard playing-card conventions (no more pastel tints).
export const SUIT_BACKGROUNDS = { H: '#fbfaf4', D: '#fbfaf4', C: '#fbfaf4', S: '#fbfaf4' };

// Game Rule Definitions
export const RANKS_ORDER = ["6", "7", "8", "9", "J", "Q", "K", "10", "A"];
export const CARD_POINT_VALUES = { "A": 11, "10": 10, "K": 4, "Q": 3, "J": 2, "9":0, "8":0, "7":0, "6":0 };
export const BID_HIERARCHY = ["Pass", "Frog", "Solo", "Heart Solo"];
export const BID_MULTIPLIERS = { "Frog": 1, "Solo": 2, "Heart Solo": 3 };

// Sorting Order Definitions
export const SUIT_SORT_ORDER = ['C', 'D', 'H', 'S'];

// Miscellaneous Game Identifiers
export const PLACEHOLDER_ID_CLIENT = "ScoreAbsorber";