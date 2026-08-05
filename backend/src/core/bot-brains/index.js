// backend/src/core/bot-brains/index.js
//
// Bot brain profiles for A/B testing card play. Every bot resolves its brain
// by name at play time:
//
//   classic  — the original ~70-line playCard tree, LOCKED as the control
//              group. All bots default here.
//   counting — full card-played memory (PublicRoundView: boss tracking, void
//              inference, trump accounting) with Matt's refinements: win with
//              the cheapest sufficient card IF the bigger card stays safe to
//              cash later, overruff instead of wasting low trump under a
//              made trick, schmear a partner's secure boss from any seat.
//
// The trial group is deliberately three named principals so round_results
// (player_results keyed by name/userId) separates the arms with no extra
// plumbing: compare points-per-round and set rates between the groups.
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

const DEFAULT_BRAIN = 'classic';

// The trial rosters. "Grampa Blane" is the grandpa on the books (there is no
// Grandpa George in bot accounts) — swap names here to reassign arms.
// flytrap = counting plus the Venus-flytrap-of-10s exception (see
// flytrapBrain.js): refuses first-trick low-lead bait, keeps the Ace loaded.
const BRAIN_PROFILES = {
    'Grampa Blane': 'counting',
    'Courtney Sr.': 'counting',
    'Kimba': 'counting',
    'Mike Knight': 'flytrap',
    'Dolly Deal': 'flytrap',
    'Rosie Rounds': 'flytrap',
    // Claude's sealed entries (Aug 5 2026) — Matt is blind-testing these, so
    // the strategies are documented only in their own source files. Both
    // cleared the audition gate against classic offline (sphinx 44% solo win
    // rate vs two classics over 3k games, coyote 35.7% over 20k).
    'Doc Shuffle': 'sphinx',
    'Vera Hearts': 'sphinx',
    'Lucky Lou': 'sphinx',
    'Otis Draw': 'coyote',
    'Ginger Snap': 'coyote',
    'Benny Bidwell': 'coyote',
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
