// backend/tests/playoutVote.test.js
// When an insurance deal executes mid-round, the table votes on whether to
// play the remaining tricks or wrap the round immediately. One "play it
// out" keeps the round alive; unanimous "wrap" (or a timeout) ends it with
// the deal-based scores.

const assert = require('assert');
const GameEngine = require('../src/core/GameEngine');
const scoringHandler = require('../src/core/handlers/scoringHandler');
const { serializeEngineForResume, restoreEngineFromResume } = require('../src/serialization/gameResume');

// Freeze interval creation so the 30s vote timer never really ticks; the
// timeout path is exercised by invoking the captured callback directly.
function withCapturedIntervals(run) {
    const original = global.setInterval;
    const intervals = [];
    global.setInterval = (callback, ms) => {
        const handle = { callback, ms, cleared: false };
        intervals.push(handle);
        return handle;
    };
    const originalClear = global.clearInterval;
    global.clearInterval = (handle) => { if (handle) handle.cleared = true; };
    try {
        return run(intervals);
    } finally {
        global.setInterval = original;
        global.clearInterval = originalClear;
    }
}

function makeMidRoundEngine({ botNames = [] } = {}) {
    const engine = new GameEngine('playout-test', 'fort-creek', 'Playout Test');
    engine.joinTable({ id: 1, username: 'Alice' }, 's1');
    engine.joinTable({ id: 2, username: 'Bob' }, 's2');
    engine.joinTable({ id: 3, username: 'Carol' }, 's3');
    Object.values(engine.players).forEach(p => {
        if (botNames.includes(p.playerName)) p.isBot = true;
    });

    engine.gameStarted = true;
    engine.state = 'Playing Phase';
    engine.playerOrder = { allIds: [1, 2, 3], turnOrder: [1, 2, 3] };
    engine.scores = { Alice: 100, Bob: 100, Carol: 100 };
    engine.capturedTricks = { Alice: [], Bob: [], Carol: [] };
    engine.bidWinnerInfo = { userId: 1, playerName: 'Alice', bid: 'Solo' };
    engine.trumpSuit = 'S';
    engine.tricksPlayedCount = 4;
    engine.bidderCardPoints = 30;
    engine.defenderCardPoints = 25;
    engine.widow = [];
    engine.originalDealtWidow = [];
    engine.widowDiscardsForFrogBidder = [];
    engine.lastCompletedTrick = { trickNumber: 4, winnerName: 'Bob', cards: [] };
    engine.currentTrickCards = [];
    engine.hands = { Alice: ['AS'], Bob: ['KS'], Carol: ['QS'] };
    engine.insurance = {
        isActive: true,
        bidMultiplier: 2,
        bidderPlayerName: 'Alice',
        bidderRequirement: 40,
        defenderOffers: { Bob: -20, Carol: 10 },
        dealExecuted: false,
        executedDetails: null,
    };
    return engine;
}

// Alice asks 30; Bob's 20 + Carol's 10 meet it, executing the deal.
function executeDeal(engine) {
    engine.updateInsuranceSetting(2, 'defenderOffer', 20);
    engine.updateInsuranceSetting(1, 'bidderRequirement', 30);
    assert.strictEqual(engine.insurance.dealExecuted, true, 'deal should execute');
}

function runPlayoutVoteTests() {
    console.log('Running playout vote tests...');
    let testCounter = 1;
    const pass = (name) => console.log(`  ✔ Test ${testCounter++}: ${name}`);

    withCapturedIntervals((intervals) => {
        // --- Vote opens on deal execution ---
        {
            const engine = makeMidRoundEngine();
            executeDeal(engine);
            assert.strictEqual(engine.playoutVote.isActive, true);
            assert.deepStrictEqual(
                Object.keys(engine.playoutVote.votes).sort(),
                ['Alice', 'Bob', 'Carol']
            );
            assert.strictEqual(engine.playoutVote.timer, 30);
            pass('A struck deal opens the playout vote for every active player.');
        }

        // --- Any "play it out" resolves instantly ---
        {
            const engine = makeMidRoundEngine();
            executeDeal(engine);
            engine.submitPlayoutVote(2, 'play');
            assert.strictEqual(engine.playoutVote.isActive, false);
            assert.strictEqual(engine.playoutVote.resolution, 'play');
            assert.strictEqual(engine.state, 'Playing Phase');
            assert.strictEqual(engine.roundSummary, null);
            pass('One play-it-out vote keeps the round alive for everyone.');
        }

        // --- Unanimous wrap ends the round with deal scores ---
        {
            const engine = makeMidRoundEngine();
            executeDeal(engine);
            engine.submitPlayoutVote(1, 'wrap');
            engine.submitPlayoutVote(2, 'wrap');
            assert.strictEqual(engine.playoutVote.isActive, true, 'still waiting on Carol');
            const { effects } = engine.submitPlayoutVote(3, 'wrap');
            assert.strictEqual(engine.playoutVote.resolution, 'wrap');
            assert.strictEqual(engine.state, 'Awaiting Next Round Trigger');
            assert.ok(engine.roundSummary, 'round summary exists');
            assert.deepStrictEqual(engine.roundSummary.insuranceWrap, { reason: 'unanimous' });
            // Deal-based scores: Alice +30 (settlement), Bob -20, Carol -10.
            assert.deepStrictEqual(engine.roundSummary.pointChanges, { Alice: 30, Bob: -20, Carol: -10 });
            assert.strictEqual(engine.scores.Alice, 130);
            // Analytics for the partial round are skipped.
            assert.ok(!effects.some(e => e.type === 'LOG_ROUND_RESULT'), 'round_results skipped');
            assert.ok(effects.some(e => e.type === 'BROADCAST_STATE'));
            pass('Unanimous wrap ends the round on deal scores and skips analytics.');
        }

        // --- Cards cannot be played during the vote ---
        {
            const engine = makeMidRoundEngine();
            engine.trickTurnPlayerId = 2;
            executeDeal(engine);
            const before = engine.hands.Bob.length;
            engine.playCard(2, 'KS');
            assert.strictEqual(engine.hands.Bob.length, before, 'card play blocked during vote');
            engine.submitPlayoutVote(2, 'play');
            engine.playCard(2, 'KS');
            assert.strictEqual(engine.hands.Bob.length, before - 1, 'play resumes after play-it-out');
            pass('Card play pauses during the vote and resumes on play-it-out.');
        }

        // --- Draw requests are blocked during the vote ---
        {
            const engine = makeMidRoundEngine();
            executeDeal(engine);
            engine.requestDraw(2);
            assert.strictEqual(engine.drawRequest.isActive, false);
            pass('A draw cannot be requested while the playout vote is open.');
        }

        // --- Timeout wraps the round ---
        {
            const engine = makeMidRoundEngine();
            const emitted = [];
            engine.emitLobbyUpdateCallback = (effects) => emitted.push(effects);
            executeDeal(engine);
            const interval = intervals[intervals.length - 1];
            engine.playoutVote.timer = 1; // fast-forward to the last second
            interval.callback();
            assert.strictEqual(engine.playoutVote.resolution, 'wrap');
            assert.strictEqual(engine.state, 'Awaiting Next Round Trigger');
            assert.deepStrictEqual(engine.roundSummary.insuranceWrap, { reason: 'timeout' });
            assert.ok(emitted.flat().some(e => e.type === 'BROADCAST_STATE'));
            pass('A silent table wraps on timeout.');
        }

        // --- Bots never open a vote on an all-bot table ---
        {
            const engine = makeMidRoundEngine({ botNames: ['Alice', 'Bob', 'Carol'] });
            executeDeal(engine);
            assert.strictEqual(engine.playoutVote.isActive, false);
            pass('All-bot tables skip the vote and play every round out.');
        }

        // --- Vote state is serialized to clients ---
        {
            const engine = makeMidRoundEngine();
            executeDeal(engine);
            const raw = engine._getRawStateForClient();
            assert.strictEqual(raw.playoutVote.isActive, true);
            assert.ok(raw.playoutVote.votes);
            pass('The playout vote reaches clients in the serialized state.');
        }

        // --- Invalid votes are ignored ---
        {
            const engine = makeMidRoundEngine();
            executeDeal(engine);
            engine.submitPlayoutVote(1, 'maybe');
            engine.submitPlayoutVote(99, 'wrap');
            assert.strictEqual(engine.playoutVote.isActive, true);
            assert.deepStrictEqual(
                Object.values(engine.playoutVote.votes),
                [null, null, null]
            );
            engine.submitPlayoutVote(1, 'wrap');
            engine.submitPlayoutVote(1, 'play'); // cannot change a cast vote
            assert.strictEqual(engine.playoutVote.votes.Alice, 'wrap');
            assert.strictEqual(engine.playoutVote.isActive, true);
            pass('Unknown voters, bad votes, and vote changes are rejected.');
        }

        // --- New round resets the vote ---
        {
            const engine = makeMidRoundEngine();
            executeDeal(engine);
            engine._initializeNewRoundState();
            assert.strictEqual(engine.playoutVote.isActive, false);
            assert.strictEqual(engine.roundWrappedEarly, false);
            pass('Round initialization clears the vote and its timer.');
        }

        // --- Adversarial pass (owed since the 4am ship) -----------------

        // A timeout wrap that pushes a score to zero must run the full
        // game-over machinery: the vote interval hands its effects to the
        // service executor, so HANDLE_GAME_OVER and settlement still fire.
        {
            const engine = makeMidRoundEngine();
            engine.scores = { Alice: 100, Bob: 100, Carol: 5 };
            const emitted = [];
            engine.emitLobbyUpdateCallback = (effects) => emitted.push(effects);
            executeDeal(engine); // Carol pays 10 -> lands at -5
            const interval = intervals[intervals.length - 1];
            engine.playoutVote.timer = 1;
            interval.callback();
            assert.strictEqual(engine.state, 'Game Over');
            assert.ok(engine.scores.Carol <= 0);
            assert.ok(
                emitted.flat().some(e => e.type === 'HANDLE_GAME_OVER'),
                'the timeout path must deliver the settlement effect to the executor'
            );
            assert.notStrictEqual(engine.settlement.status, 'idle', 'settlement began');
            pass('A timeout wrap crossing game over still settles the game.');
        }

        // A wrap during the Bid Announcement fanfare: the fanfare timer that
        // would flip the table back to Playing Phase must stay inert.
        {
            const engine = makeMidRoundEngine();
            engine.playerMode = 3;
            const fanfareTimer = engine._transitionToPlayingPhase();
            assert.strictEqual(engine.state, 'Bid Announcement');
            // Meet the (freshly re-activated) insurance in the fanfare window.
            engine.updateInsuranceSetting(2, 'defenderOffer', 20);
            engine.updateInsuranceSetting(3, 'defenderOffer', 10);
            engine.updateInsuranceSetting(1, 'bidderRequirement', 30);
            assert.strictEqual(engine.insurance.dealExecuted, true);
            assert.strictEqual(engine.playoutVote.isActive, true, 'vote opens during the fanfare');
            engine.submitPlayoutVote(1, 'wrap');
            engine.submitPlayoutVote(2, 'wrap');
            engine.submitPlayoutVote(3, 'wrap');
            assert.strictEqual(engine.state, 'Awaiting Next Round Trigger');
            const after = fanfareTimer.payload.onTimeout(engine);
            assert.deepStrictEqual(after, [], 'the dead fanfare timer emits nothing');
            assert.strictEqual(engine.state, 'Awaiting Next Round Trigger', 'the wrap result is not stomped');
            pass('Wrapping during the bid fanfare leaves its timer inert.');
        }

        // A fast unanimous wrap during the trick linger: the 2.2s linger
        // timer must not drag the settled table back into Playing Phase.
        {
            const engine = makeMidRoundEngine();
            engine.trickTurnPlayerId = 3;
            engine.leadSuitCurrentTrick = 'S';
            engine.currentTrickCards = [
                { userId: 1, playerName: 'Alice', card: 'AS' },
                { userId: 2, playerName: 'Bob', card: 'KS' },
            ];
            const { effects } = engine.playCard(3, 'QS');
            assert.strictEqual(engine.state, 'TrickCompleteLinger');
            const lingerTimer = effects.find(e => e.type === 'START_TIMER');
            assert.ok(lingerTimer, 'the linger schedules its own transition');
            executeDeal(engine); // insurance may still strike during the linger
            engine.submitPlayoutVote(1, 'wrap');
            engine.submitPlayoutVote(2, 'wrap');
            engine.submitPlayoutVote(3, 'wrap');
            assert.strictEqual(engine.state, 'Awaiting Next Round Trigger');
            const after = lingerTimer.payload.onTimeout(engine);
            assert.deepStrictEqual(after, [], 'the dead linger timer emits nothing');
            assert.strictEqual(engine.state, 'Awaiting Next Round Trigger');
            pass('Wrapping during the trick linger leaves its timer inert.');
        }

        // Heart Solo wrap mid-round: the widow's last-trick attribution is a
        // counterfactual footnote — the points that actually apply must come
        // from the executed agreement alone.
        {
            const engine = makeMidRoundEngine();
            engine.bidWinnerInfo = { userId: 1, playerName: 'Alice', bid: 'Heart Solo' };
            engine.insurance.bidMultiplier = 3;
            engine.originalDealtWidow = ['AH', '10H', 'KH']; // 25 widow points
            engine.lastCompletedTrick = { trickNumber: 4, winnerName: 'Bob', cards: [] };
            executeDeal(engine);
            engine.submitPlayoutVote(1, 'wrap');
            engine.submitPlayoutVote(2, 'wrap');
            engine.submitPlayoutVote(3, 'wrap');
            // Agreement: Alice +30 (Bob 20 + Carol 10), regardless of where
            // the widow's 25 card points were attributed mid-round.
            assert.deepStrictEqual(engine.roundSummary.pointChanges, { Alice: 30, Bob: -20, Carol: -10 });
            assert.strictEqual(engine.scores.Alice, 130);
            assert.strictEqual(engine.scores.Bob, 80);
            assert.strictEqual(engine.scores.Carol, 90);
            pass('A Heart Solo wrap pays the agreement, never the stale widow attribution.');
        }

        // A Midnight Special can fire BEFORE the deal executes (trick 3 run,
        // trick 5 deal). The wrap's scoring must still stamp the rider onto
        // the round-history entry the podium tallies.
        {
            const engine = makeMidRoundEngine();
            engine.midnightSpecialFired = true;
            engine.midnightSpecialRider = 'Alice';
            executeDeal(engine);
            engine.submitPlayoutVote(1, 'wrap');
            engine.submitPlayoutVote(2, 'wrap');
            engine.submitPlayoutVote(3, 'wrap');
            assert.strictEqual(engine.roundHistory.at(-1).midnightSpecial, 'Alice');
            pass('An early wrap still stamps the round\'s Midnight Special rider.');
        }

        // A played-out round records each bot's BRAIN at play time in
        // round_results — recorded, not derived, so roster reassignments
        // (classic's retirement) can never rewrite history. Humans carry no
        // brain field, and a human bidder logs a null bidderBrain.
        {
            const engine = makeMidRoundEngine({ botNames: ['Bob', 'Carol'] });
            engine.gameId = 4242;
            const effects = scoringHandler.calculateRoundScores(engine);
            const log = effects.find(e => e.type === 'LOG_ROUND_RESULT');
            assert.ok(log, 'a played-out round logs to round_results');
            assert.strictEqual(log.payload.bidderBrain, null, 'human bidder -> null brain');
            const rows = Object.fromEntries(log.payload.playerResults.map(r => [r.name, r]));
            assert.ok(!('brain' in rows.Alice), 'humans carry no brain field');
            assert.strictEqual(rows.Bob.brain, 'counting', 'bots record their live brain');
            assert.strictEqual(rows.Carol.brain, 'counting');
            pass('Round results record each bot\'s brain at play time.');
        }

        // A deploy mid-vote: the snapshot carries the executed deal and the
        // vote itself; the interval died with the process, so the restored
        // table reopens the vote with a fresh clock (Sept 2026 — before this
        // the vote evaporated and everyone had to play the round out).
        {
            const engine = makeMidRoundEngine();
            engine.gameId = 777;
            executeDeal(engine);
            assert.strictEqual(engine.playoutVote.isActive, true);
            const snapshot = serializeEngineForResume(engine);
            assert.ok(snapshot, 'a mid-vote game is snapshot-worthy');
            const revived = new GameEngine('playout-restore', 'fort-creek', 'Playout Restore');
            assert.strictEqual(restoreEngineFromResume(revived, snapshot), true);
            assert.strictEqual(revived.state, 'Playing Phase');
            assert.strictEqual(revived.playoutVote.isActive, true, 'the vote is reopened with a fresh clock');
            assert.ok(revived.internalTimers.playoutTimer, 'and its interval is live, not orphaned');
            clearInterval(revived.internalTimers.playoutTimer);
            assert.strictEqual(revived.insurance.dealExecuted, true, 'the deal survives the deploy');
            assert.strictEqual(revived.roundWrappedEarly, false);
            pass('A deploy mid-vote restores a playable round with the deal intact.');
        }
    });

    console.log('Playout vote tests passed.');
}

module.exports = runPlayoutVoteTests;

if (require.main === module) {
    runPlayoutVoteTests();
}
