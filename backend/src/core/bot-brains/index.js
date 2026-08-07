// backend/src/core/bot-brains/index.js
//
// Bot brain profiles for A/B testing card play. Every bot resolves its brain
// by name at play time. The classic control was RETIRED from live play on
// Aug 6 2026 (Matt's call: it lost every arm of the trial) — it remains in
// BRAINS as the simulator's fixed baseline, but no roster bot plays it.
//
// The live roster is split EVENLY, five bots per brain: counting, flytrap,
// sphinx, coyote. The original trial trios kept their arms so their
// round_results series stay unbroken; the eight freed classic bots were
// dealt round-robin into the four arms.
//
// Bidding, trump choice, discards, and insurance stay SHARED across brains —
// the A/B isolates card play, so a difference in outcomes means card play.

const classicBrain = require('./classicBrain');
const countingBrain = require('./countingBrain');
const flytrapBrain = require('./flytrapBrain');
const coyoteBrain = require('./coyoteBrain');
const sphinxBrain = require('./sphinxBrain');

const BRAINS = {
    classic: classicBrain,
    counting: countingBrain,
    flytrap: flytrapBrain,
    coyote: coyoteBrain,
    sphinx: sphinxBrain,
};

// Unknown names (future bot accounts not yet assigned below) get a solid
// modern brain, never the retired classic.
const DEFAULT_BRAIN = 'counting';

// The full 20-bot roster, five per arm. "Grampa Blane" is the grandpa on
// the books (there is no Grandpa George in bot accounts) — swap names here
// to reassign arms. flytrap = counting plus the Venus-flytrap-of-10s
// exception (see flytrapBrain.js): refuses first-trick low-lead bait, keeps
// the Ace loaded. sphinx and coyote are Claude's sealed entries (Aug 5
// 2026) — Matt is blind-testing these, so the strategies are documented
// only in their own source files.
const BRAIN_PROFILES = {
    // counting
    'Grampa Blane': 'counting',
    'Courtney Sr.': 'counting',
    'Kimba': 'counting',
    'Ace McGraw': 'counting',
    'Grandma Joe': 'counting',
    // flytrap
    'Mike Knight': 'flytrap',
    'Dolly Deal': 'flytrap',
    'Rosie Rounds': 'flytrap',
    'Buck Wilder': 'flytrap',
    'Jack Highwater': 'flytrap',
    // sphinx (sealed)
    'Doc Shuffle': 'sphinx',
    'Vera Hearts': 'sphinx',
    'Lucky Lou': 'sphinx',
    'Cliff': 'sphinx',
    'Mabel Moon': 'sphinx',
    // coyote (sealed)
    'Otis Draw': 'coyote',
    'Ginger Snap': 'coyote',
    'Benny Bidwell': 'coyote',
    'Frankie Four': 'coyote',
    'Ruby Rook': 'coyote',
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
