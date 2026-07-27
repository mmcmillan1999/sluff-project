// backend/tests/playoutVote.test.js
// When an insurance deal executes mid-round, the table votes on whether to
// play the remaining tricks or wrap the round immediately. One "play it
// out" keeps the round alive; unanimous "wrap" (or a timeout) ends it with
// the deal-based scores.

const assert = require('assert');
const GameEngine = require('../src/core/GameEngine');

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
    });

    console.log('Playout vote tests passed.');
}

module.exports = runPlayoutVoteTests;

if (require.main === module) {
    runPlayoutVoteTests();
}
