// backend/src/core/insuranceLimits.js
//
// What a seat may put on the insurance table. Two fences:
//
//   - the absolute range every round has: a bidder's ask within ±120 x the
//     bid multiplier, a defender's offer within ±60 x it;
//   - what the seat can AFFORD: nobody may offer more points than they hold.
//     The most a seat can put up is every point but its last one (Matt, Sept
//     17 2026) — in a regular game and at a tournament table alike, where the
//     score IS the stack.
//
// "Offering points" is the paying direction of each control: a defender's
// positive offer, and a bidder's NEGATIVE ask (paying the defenders to get
// out of a failing bid). The receiving direction is never limited by the
// stack. A deal pays exactly what was put up — each defender their own offer,
// the bidder at most the size of a negative ask — so holding each control to
// the limit is enough to keep a deal from taking a seat's last point.
//
// Pure, so the engine, the bot strategies and the tests share one rule.

'use strict';

// Every point but the last. A stack that is not a number (a test engine with
// no scores) puts no limit on the seat.
const affordable = (stack) => (Number.isFinite(stack) ? Math.max(0, Math.floor(stack) - 1) : Infinity);

/**
 * @param {object} seat
 *   multiplier  the round's bid multiplier (Frog 1, Solo 2, Heart Solo 3)
 *   stack       the seat's current points
 *   isBidder    the bidder sets an ask; a defender sets an offer
 * @returns {{ min: number, max: number, absoluteMin: number, absoluteMax: number }}
 */
function insuranceLimits({ multiplier = 1, stack, isBidder }) {
    const m = Number(multiplier) || 1;
    const pay = affordable(stack);
    if (isBidder) {
        const absoluteMin = -120 * m;
        // Math.max(-120m, -pay), written so a stack of 1 gives 0 and not -0.
        return { min: Math.max(absoluteMin, 0 - pay), max: 120 * m, absoluteMin, absoluteMax: 120 * m };
    }
    const absoluteMax = 60 * m;
    return { min: -60 * m, max: Math.min(absoluteMax, pay), absoluteMin: -60 * m, absoluteMax };
}

// A value inside the absolute range is pulled back to what the seat can
// afford; a value outside the absolute range is not a legal setting at all.
function clampToLimits(value, limits) {
    if (!Number.isFinite(value) || value < limits.absoluteMin || value > limits.absoluteMax) return null;
    return Math.min(limits.max, Math.max(limits.min, value));
}

module.exports = { affordable, insuranceLimits, clampToLimits };
