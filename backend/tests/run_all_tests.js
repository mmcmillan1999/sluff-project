const path = require('path');

const suites = [
    { name: 'BotPlayer', file: './bot.test.js' },
    { name: 'bid advice', file: './bidAdvice.test.js' },
    { name: 'persistent bot accounts', file: './botAccounts.test.js' },
    { name: 'funded bot accounting', file: './fundedBots.test.js' },
    { name: 'bot credential isolation', file: './botAuthentication.test.js' },
    { name: 'account hygiene', file: './accountHygiene.test.js' },
    { name: 'service guards', file: './serviceGuards.test.js' },
    { name: 'game logic', file: './gameLogic.unit.test.js' },
    { name: 'legal moves', file: './legalMoves.test.js' },
    { name: 'mercy tokens', file: './mercyToken.test.js', exportName: 'runMercyTokenTests' },
    { name: 'table integration', file: './Table.integration.test.js' },
    { name: 'rematch consent', file: './rematchConsent.test.js' },
    { name: 'departed seat scores', file: './departedSeatScores.test.js' },
    { name: 'playout vote', file: './playoutVote.test.js' },
    { name: 'bot exhibition', file: './botExhibition.test.js' },
    { name: 'payouts', file: './payouts.test.js' },
    { name: 'quick play', file: './quickPlay.test.js' },
    { name: 'exhibition preemption', file: './exhibitionPreemption.test.js' },
    { name: 'four-player mode', file: './fourPlayer.test.js' },
    { name: 'leaderboard privacy', file: './leaderboard.test.js' },
    { name: 'season lifecycle and archives', file: './seasons.test.js' },
    { name: 'Alpha Season 2 wallet reset', file: './alpha2WalletReset.test.js' },
    { name: 'player profiles', file: './playerProfiles.test.js' },
    { name: 'token ledger', file: './tokenLedger.test.js' },
    { name: 'player-requested game voids', file: './gameVoid.test.js' },
    { name: 'account rename and deletion', file: './accountManagement.test.js' },
    { name: 'chat moderation filter', file: './chatModeration.test.js' },
    { name: 'AFK turn timer', file: './afkTurnTimer.test.js' },
    { name: 'lone-human forfeit clock', file: './loneHumanForfeit.test.js' },
    { name: 'bid winner leads trick one', file: './bidWinnerLeads.test.js' },
    { name: 'client crash-report intake', file: './clientErrors.test.js' },
    { name: 'inactive-user maintenance', file: './pruneInactiveUsers.test.js' },
    { name: 'database backup snapshot', file: './backupDatabase.test.js' },
    { name: 'abandoned-game crash recovery', file: './abandonedGameRecovery.test.js' },
    { name: 'admin abandoned-game recovery', file: './adminGameRecovery.test.js' },
    { name: 'token accounting audit', file: './tokenAccountingAudit.test.js' },
    { name: 'viewer-safe game state', file: './gameStateSerializer.test.js' },
    { name: 'backend integrity', file: './backendIntegrity.test.js' },
    { name: 'atomic game settlement', file: './gameSettlementIntegrity.test.js' },
    { name: 'settlement retry', file: './settlementRetry.test.js' },
    { name: 'authentication integrity', file: './authenticationIntegrity.test.js' },
    { name: 'voice chat signaling', file: './voiceSignaling.test.js' },
    { name: 'tutorial persistence', file: './tutorialPersistence.test.js' },
    { name: 'quick-tips read receipts', file: './tips.test.js' },
    { name: 'AI prompt rule contract', file: './aiPromptRules.test.js' },
    { name: 'market insurance strategy', file: './marketInsurance.test.js' },
    { name: 'game resume and play timing', file: './gameResume.test.js' },
    { name: 'bot brain profiles', file: './botBrains.test.js' },
    { name: 'raven brain', file: './ravenBrain.test.js' },
    { name: 'bot pacing', file: './botPacing.test.js' },
    { name: 'Midnight Special detector', file: './midnightSpecial.test.js' },
    { name: 'champion line service', file: './championLine.test.js' },
    { name: 'champion line route', file: './championLineRoute.test.js' },
    { name: 'store entitlements', file: './entitlements.test.js' },
    { name: 'frog discards', file: './frogDiscards.test.js' },
    { name: 'tournament director', file: './tournament.test.js' },
    { name: 'tournament welcome', file: './tournamentWelcome.test.js' },
    { name: 'tournament socket events', file: './tournamentEvents.test.js' },
    { name: 'tournament shot clock and pace', file: './tournamentClock.test.js' },
    { name: 'tournament deploy survival', file: './tournamentResume.test.js' },
    { name: 'tournament scoreboard API', file: './tournamentScoreboard.test.js' },
];

function loadRunner(suite) {
    const absolutePath = path.resolve(__dirname, suite.file);
    const testModule = require(absolutePath);
    const runner = suite.exportName ? testModule[suite.exportName] : testModule;
    if (typeof runner !== 'function') {
        throw new TypeError(`${suite.file} must export a test runner function.`);
    }
    return runner;
}

// `--only <text>` (or --only=<text>, or ONLY=<text>) runs the suites whose
// name or file contains the text: one area in a second or two instead of
// the whole run. Timings print per suite, and a failure names its suite.
function selectSuites(argv = process.argv.slice(2), env = process.env) {
    const flag = argv.findIndex(arg => arg === '--only' || arg.startsWith('--only='));
    const only = flag < 0
        ? env.ONLY
        : (argv[flag].includes('=') ? argv[flag].slice('--only='.length) : argv[flag + 1]);
    if (!only) return suites;
    const needle = only.toLowerCase();
    const selected = suites.filter(suite => suite.name.toLowerCase().includes(needle) || suite.file.toLowerCase().includes(needle));
    if (selected.length === 0) throw new Error(`No suite matches --only ${only}. Names: ${suites.map(s => s.name).join(', ')}`);
    return selected;
}

async function run() {
    const selected = selectSuites();
    console.log(selected.length === suites.length
        ? '--- Running safe backend unit and integration tests ---'
        : `--- Running ${selected.length} of ${suites.length} backend suites ---`);

    let completed = 0;
    for (const suite of selected) {
        const runner = loadRunner(suite);
        console.log(`\n[${completed + 1}] ${suite.name}`);
        const started = Date.now();
        try {
            await runner();
        } catch (error) {
            error.message = `[${suite.name}] ${error.message}`;
            throw error;
        }
        console.log(`    (${Date.now() - started} ms)`);
        completed += 1;
    }

    console.log(`\n--- All ${completed} safe backend suites passed. ---`);
}

if (require.main === module) {
    run().catch(error => {
        console.error('\n--- Backend test run failed. ---');
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = run;
