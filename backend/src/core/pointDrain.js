// backend/src/core/pointDrain.js
//
// The point drain: between rounds every score drops by a percentage, so a
// game that would run an hour runs half of one. Tournaments have had it since
// Sept 6 2026 as the director's "chip drain" (a setting the host picks); since
// Sept 17 a normal table can vote one in (GameEngine.proposePointDrain). One
// rule for both, here:
//
//   - the drop is the percentage of the score, rounded UP, so a small score
//     still feels it;
//   - it never takes a LAST point. The drain squeezes; only the table
//     eliminates: a player goes out by losing their last point in a round
//     (Matt, Sept 17 2026).
//
// A normal table's vote: any seated player proposes one of DRAIN_OPTIONS (or,
// once a drain is running, a different one or none at all); everyone else at
// the table has VOTE_SECONDS to agree. It takes every seat — scores are money
// — and silence is a no. Play does not stop for it. An agreed drain first
// lands when the next round is dealt, and is gone with the game.

'use strict';

const DRAIN_OPTIONS = [5, 7.5, 10, 15, 20];
const RECOMMENDED_DRAIN = 10;
const VOTE_SECONDS = 30;
const STARTING_SCORE = 120;

// Points a score of `score` gives up to a drain of `percent`.
function drainDrop(score, percent) {
    const held = Number(score);
    const rate = Number(percent);
    if (!(held > 0) || !(rate > 0)) return 0;
    return Math.min(Math.ceil(held * rate / 100), Math.max(0, Math.floor(held) - 1));
}

const isDrainOption = (percent) => DRAIN_OPTIONS.includes(Number(percent));

module.exports = { DRAIN_OPTIONS, RECOMMENDED_DRAIN, VOTE_SECONDS, STARTING_SCORE, drainDrop, isDrainOption };
