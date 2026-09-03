// backend/src/data/gameVoidPolicy.js
//
// A player-requested void reverses a settled game's whole ledger. The
// mechanics (gameVoid.js) are exact and idempotent; this is the policy that
// keeps them from being a mulligan button: a void is a mistake-correction
// requested soon after the game, and each account gets a few per season.
// Shared by the void itself and by the ledger read that decides whether to
// show the button, so the two can never disagree.

const positiveInteger = (raw, fallback) => {
    const value = Number.parseInt(raw, 10);
    return Number.isInteger(value) && value > 0 ? value : fallback;
};

const VOID_WINDOW_HOURS = positiveInteger(process.env.GAME_VOID_WINDOW_HOURS, 24);
const VOID_QUOTA_PER_SEASON = positiveInteger(process.env.GAME_VOID_QUOTA_PER_SEASON, 3);

module.exports = { VOID_WINDOW_HOURS, VOID_QUOTA_PER_SEASON };
