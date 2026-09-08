// backend/src/core/botPacing.js
//
// How long a bot "thinks" before its card lands. Two profiles, resolved per
// bot name exactly like the brains are:
//
//   fixed — the historical cadence: 1.2 s per card (Courtney Sr. 2.4 s),
//           scaled by the table's pace multiplier on learner tables.
//   human — a think time drawn from a log-normal fitted, trick by trick, to
//           MrNoobCrusher's server-measured play timings (play_timings,
//           Aug 5 – Sept 7 2026: 2,028 card plays, the slow tail past 12 s
//           dropped on Matt's instruction). Overall that sample has median
//           2.7 s, mean 3.3 s, sd 2.1 s; trick 1 is the slowest (median
//           3.2 s) and the last trick the quickest (1.8 s). A forced play
//           (one legal card) is shortened, since nobody deliberates over it.
//
// The draw is clamped so a bot can never look AFK (12 s, 8 s at a tournament
// table where the human clock allows 12 s free), and on a slowed learner
// table it never lands faster than the fixed cadence would have.

'use strict';

// [mu, sigma] of ln(ms) for tricks 1..11.
const HUMAN_TRICK_PARAMS = Object.freeze([
    [8.093, 0.587],
    [7.995, 0.556],
    [8.047, 0.563],
    [8.128, 0.527],
    [8.002, 0.502],
    [7.988, 0.610],
    [8.034, 0.544],
    [7.963, 0.543],
    [7.905, 0.552],
    [7.764, 0.512],
    [7.548, 0.465],
]);

const HUMAN_MIN_MS = 700;
const HUMAN_MAX_MS = 12_000;
const HUMAN_TOURNAMENT_MAX_MS = 8_000;
const FORCED_PLAY_FACTOR = 0.7;

const FIXED_PLAY_MS = 1_200;
const FIXED_PLAY_MS_COURTNEY = 2_400;

// Bots not listed here keep the fixed cadence.
const PACING_PROFILES = Object.freeze({
    'Grandpa George': 'human',
    'Courtney M.': 'human',
});

const pacingProfileFor = (botName) => PACING_PROFILES[botName] || 'fixed';

const fixedPlayMs = (botName) => (botName === 'Courtney Sr.' ? FIXED_PLAY_MS_COURTNEY : FIXED_PLAY_MS);

// Standard normal via Box–Muller.
const gaussian = (rng) => {
    let u = 0;
    let v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

/**
 * One human-like think time in ms for the given trick (1..11). Unclamped
 * apart from the profile's floor/ceiling; callers apply table context.
 */
function sampleHumanThinkMs({ trickNumber = 1, legalCount = 2, rng = Math.random } = {}) {
    const index = clamp(Math.round(Number(trickNumber) || 1), 1, HUMAN_TRICK_PARAMS.length) - 1;
    const [mu, sigma] = HUMAN_TRICK_PARAMS[index];
    let ms = Math.exp(mu + sigma * gaussian(rng));
    if (Number(legalCount) === 1) ms *= FORCED_PLAY_FACTOR;
    return clamp(Math.round(ms), HUMAN_MIN_MS, HUMAN_MAX_MS);
}

/**
 * Delay before this bot's card play is applied.
 * @param {string} botName
 * @param {object} ctx
 *   trickNumber  1-based trick about to be played
 *   legalCount   number of legal cards (1 = forced)
 *   pace         table pace multiplier (learner tables run slow)
 *   tournament   true at a tournament table
 *   rng          injectable for tests
 */
function botPlayDelay(botName, { trickNumber = 1, legalCount = 2, pace = 1, tournament = false, rng = Math.random } = {}) {
    const paceFactor = Number(pace) > 1 ? Number(pace) : 1;
    const fixed = fixedPlayMs(botName) * paceFactor;
    if (pacingProfileFor(botName) !== 'human') return fixed;

    let ms = sampleHumanThinkMs({ trickNumber, legalCount, rng });
    if (tournament) ms = Math.min(ms, HUMAN_TOURNAMENT_MAX_MS);
    // A slowed learner table still reads slow: never quicker than the fixed
    // cadence the table was tuned around.
    if (paceFactor > 1) ms = Math.max(ms, fixed);
    return ms;
}

module.exports = {
    PACING_PROFILES,
    HUMAN_TRICK_PARAMS,
    HUMAN_MIN_MS,
    HUMAN_MAX_MS,
    HUMAN_TOURNAMENT_MAX_MS,
    FORCED_PLAY_FACTOR,
    FIXED_PLAY_MS,
    FIXED_PLAY_MS_COURTNEY,
    pacingProfileFor,
    fixedPlayMs,
    sampleHumanThinkMs,
    botPlayDelay,
};
