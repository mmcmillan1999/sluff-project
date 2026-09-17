// backend/src/core/bot-brains/index.js
//
// Bot brain profiles for A/B testing card play. Every bot resolves its brain
// by name at play time. The classic control was RETIRED from live play on
// Aug 6 2026 (Matt's call: it lost every arm of the trial) — it remains in
// BRAINS as the simulator's fixed baseline, but no roster bot plays it.
//
// The live roster was split EVENLY, five bots per brain (counting, flytrap,
// sphinx, coyote): the original trial trios kept their arms so their
// round_results series stay unbroken, and the eight freed classic bots were
// dealt round-robin into the four arms. Sept 7 2026: two sphinx seats became
// raven, so sphinx runs three bots and raven two.
//
// Bidding, trump choice, discards, and insurance stay SHARED across brains —
// the A/B isolates card play, so a difference in outcomes means card play.

const classicBrain = require('./classicBrain');
const countingBrain = require('./countingBrain');
const flytrapBrain = require('./flytrapBrain');
const coyoteBrain = require('./coyoteBrain');
const sphinxBrain = require('./sphinxBrain');
const ravenBrain = require('./ravenBrain');
const ravenNext = require('./ravenNextBrain');

const BRAINS = {
    classic: classicBrain,
    counting: countingBrain,
    flytrap: flytrapBrain,
    coyote: coyoteBrain,
    sphinx: sphinxBrain,
    // raven (Sept 2026): the search brain — samples hidden worlds from public
    // information and solves the endgame of each one exactly.
    raven: ravenBrain,
    // raven-1.1 / raven-1.2 (Sept 2026): raven with a repaired defense — it
    // no longer leads a 10 under an unplayed ace (ravenNextBrain.js).
    // raven-1.2 holds both raven seats since Sept 17 2026; raven-1.1 and the
    // original raven stay registered for the simulators and as a one-line
    // rollback in BRAIN_PROFILES below.
    ...ravenNext.brains,
};

// Unknown names (future bot accounts not yet assigned below) get a solid
// modern brain, never the retired classic.
const DEFAULT_BRAIN = 'counting';

// The full 20-bot roster. "Grampa Blane" and "Grandpa George" are both on
// the books (George arrived with the raven seats) — swap names here to
// reassign arms. flytrap = counting plus the Venus-flytrap-of-10s
// exception (see flytrapBrain.js): refuses first-trick low-lead bait, keeps
// the Ace loaded. sphinx and coyote are Claude's sealed entries (Aug 5
// 2026) — Matt is blind-testing these, so the strategies are documented
// only in their own source files.
const BRAIN_PROFILES = {
    // counting
    'Grampa Blane': 'counting',
    'Stephen Richins': 'counting', // was Courtney Sr. until Sept 7 2026
    'Kimba': 'counting',
    'Ace McGraw': 'counting',
    'Grandma Joe': 'counting',
    // flytrap
    'Mike Knight': 'flytrap',
    'Dolly Deal': 'flytrap',
    'Rosie Rounds': 'flytrap',
    'Buck Wilder': 'flytrap',
    'Jack Highwater': 'flytrap',
    // sphinx (sealed) — Lucky Lou and Mabel Moon retired Sept 7 2026; their
    // accounts (tokens and history) carry on as the two raven seats below.
    'Doc Shuffle': 'sphinx',
    'Vera Hearts': 'sphinx',
    'Cliff': 'sphinx',
    // coyote (sealed)
    'Otis Draw': 'coyote',
    'Ginger Snap': 'coyote',
    'Benny Bidwell': 'coyote',
    'Frankie Four': 'coyote',
    'Ruby Rook': 'coyote',
    // raven (Sept 7 2026): the search brain, on the accounts that were
    // Lucky Lou and Mabel Moon (see data/botAccounts.js BOT_RENAMES).
    // Sept 17 2026: both seats moved to raven-1.2 (Matt's call) after they
    // were seen leading 10s under unplayed aces. Same offense card for card;
    // on 25,581 paired rounds it concedes 0.25 ±0.05 points a round less on
    // defense (z -5.2) and won the five-brain round robin, 44.9% to raven's
    // 43.1%. round_results records the brain per round, so the live series
    // breaks cleanly from 'raven' to 'raven-1.2' at this deploy.
    'Grandpa George': 'raven-1.2',
    'Courtney M.': 'raven-1.2',
};

const brainNameFor = (botName) => BRAIN_PROFILES[botName] || DEFAULT_BRAIN;
const brainFor = (botName) => BRAINS[brainNameFor(botName)] || BRAINS[DEFAULT_BRAIN];

// Simulator/test hook: candidate brains audition under synthetic seat names
// before earning a production entry in BRAIN_PROFILES.
const registerBrainProfile = (botName, brainName) => {
    if (!BRAINS[brainName]) throw new Error(`Unknown brain: ${brainName}`);
    BRAIN_PROFILES[botName] = brainName;
};

module.exports = {
    BRAINS,
    BRAIN_PROFILES,
    DEFAULT_BRAIN,
    brainFor,
    brainNameFor,
    registerBrainProfile,
};
