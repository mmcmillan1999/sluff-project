// backend/tests/pointDrain.test.js
//
// The voted point drain (Sept 17 2026). Matt: "I'd like to have an option even
// on normal games for the players to vote on degradation of points, because
// the game can take so long. 5% 7.5% 10%, 15% 20% with 10% being recommended."
//
// Any seated player proposes a percentage; every seat that is there has 30
// seconds to agree; play does not stop for it; an agreed drain lands as each
// next round is dealt, rounds up, and never takes a last point — the same rule
// the tournament director's chip drain follows (core/pointDrain.js).

'use strict';

const assert = require('node:assert/strict');
const GameEngine = require('../src/core/GameEngine');
const pointDrain = require('../src/core/pointDrain');
const { PLACEHOLDER_ID } = require('../src/core/constants');
const { serializeEngineForResume, restoreEngineFromResume } = require('../src/serialization/gameResume');
const { buildDrawSettlement } = require('../src/settlement/gameSettlement');
const { createGameServiceWithoutHeartbeat, withControlledTimeouts } = require('./test-helpers');

function makeEngine({ scores = { Alice: 120, Bob: 120, Carol: 120 }, bots = [], fourth = false } = {}) {
    const engine = new GameEngine('drain-test', 'fort-creek', 'Drain Test');
    const names = fourth ? ['Alice', 'Bob', 'Carol', 'Dave'] : ['Alice', 'Bob', 'Carol'];
    names.forEach((name, index) => engine.joinTable({ id: index + 1, username: name }, `s${index + 1}`));
    Object.values(engine.players).forEach((p) => { if (bots.includes(p.playerName)) p.isBot = true; });
    engine.gameStarted = true;
    engine.gameId = null;
    engine.playerMode = fourth ? 4 : 3;
    engine.dealer = 1;
    engine.playerOrder.setTurnOrder(1, fourth);
    engine.scores = { ...scores, ...(fourth ? {} : { [PLACEHOLDER_ID]: 120 }) };
    engine.state = 'Playing Phase';
    engine.emitLobbyUpdateCallback = () => {};
    return engine;
}

// A scored round is waiting for its dealer to call the next one.
function finishRound(engine) {
    engine.roundHistory.push({ roundNumber: engine.roundHistory.length + 1 });
    engine.state = 'Awaiting Next Round Trigger';
    engine.roundSummary = { dealerOfRoundId: engine.dealer, finalScores: { ...engine.scores } };
}

const agree = (engine, percent = 10) => {
    engine.proposePointDrain(1, percent);
    engine.submitDrainVote(2, 'yes');
    engine.submitDrainVote(3, 'yes');
    if (engine.players[4]) engine.submitDrainVote(4, 'yes');
};

async function runPointDrainTests() {
    console.log('Running point drain tests...');
    let testCounter = 1;
    const pass = (name) => console.log(`  ✔ Test ${testCounter++}: ${name}`);

    // 1) The rule: a percentage, rounded up, never the last point.
    {
        assert.deepEqual(pointDrain.DRAIN_OPTIONS, [5, 7.5, 10, 15, 20]);
        assert.equal(pointDrain.RECOMMENDED_DRAIN, 10);
        assert.equal(pointDrain.drainDrop(120, 10), 12);
        assert.equal(pointDrain.drainDrop(120, 7.5), 9);
        assert.equal(pointDrain.drainDrop(101, 7.5), 8, '7.575 rounds UP');
        assert.equal(pointDrain.drainDrop(3, 5), 1, 'a small score still feels it');
        assert.equal(pointDrain.drainDrop(2, 20), 1);
        assert.equal(pointDrain.drainDrop(1, 20), 0, 'never the last point');
        assert.equal(pointDrain.drainDrop(0, 20), 0);
        assert.equal(pointDrain.drainDrop(-14, 20), 0);
        assert.equal(pointDrain.drainDrop(120, 0), 0);
        pass('A drain takes its percentage rounded up, and never a last point.');
    }

    // 2) Who may propose what, and when.
    await withControlledTimeouts(async () => {
        const engine = makeEngine();
        assert.equal(engine.pointDrainProposalError(1, 10), null);
        assert.match(engine.pointDrainProposalError(1, 12), /not one of the choices/);
        assert.match(engine.pointDrainProposalError(1, 0), /not one of the choices/, '"off" is only on offer once one is running');
        assert.match(engine.pointDrainProposalError(99, 10), /seated players/);
        engine.players[3].isSpectator = true;
        assert.match(engine.pointDrainProposalError(3, 10), /seated players/);
        engine.players[3].isSpectator = false;

        const tournament = makeEngine();
        tournament.tournament = { tournamentId: 1 };
        assert.match(tournament.pointDrainProposalError(1, 10), /tournament/);
        const unstarted = makeEngine();
        unstarted.gameStarted = false;
        assert.match(unstarted.pointDrainProposalError(1, 10), /no game/);
        const over = makeEngine();
        over.state = 'Game Over';
        assert.match(over.pointDrainProposalError(1, 10), /no game/);

        engine.drawRequest.isActive = true;
        assert.match(engine.pointDrainProposalError(1, 10), /Another vote/);
        engine.drawRequest.isActive = false;

        engine.proposePointDrain(1, 10);
        assert.equal(engine.drainVote.isActive, true);
        assert.match(engine.pointDrainProposalError(2, 5), /Another vote/);
        engine.submitDrainVote(2, 'no');
        assert.match(engine.pointDrainProposalError(1, 5), /One proposal a round/, 'the same seat cannot ask again this round');
        assert.equal(engine.pointDrainProposalError(2, 5), null, 'another seat may');
        finishRound(engine);
        assert.equal(engine.pointDrainProposalError(1, 5), null, 'and next round so may the first, between rounds too');
        pass('Seated players of a live, non-tournament game may propose a listed percentage, once a round each.');
    });

    // 3) The vote: every seat, one no ends it, silence is a no, play goes on.
    await withControlledTimeouts(async ({ timers, runNext }) => {
        const engine = makeEngine();
        engine.proposePointDrain(1, 15);
        assert.deepEqual(engine.drainVote.votes, { Alice: 'yes', Bob: null, Carol: null }, 'the proposer has voted');
        assert.equal(engine.state, 'Playing Phase', 'the game does not stop for it');
        assert.ok(engine.drainVote.endsAt > Date.now() + 25_000 && engine.drainVote.endsAt <= Date.now() + 30_000);
        engine.submitDrainVote(2, 'yes');
        engine.submitDrainVote(2, 'no');
        assert.equal(engine.drainVote.votes.Bob, 'yes', 'a vote is cast once');
        assert.equal(engine.pointDrain.percent, 0, 'two of three is not the table');
        engine.submitDrainVote(3, 'no');
        assert.equal(engine.drainVote.isActive, false);
        assert.equal(engine.drainVote.resolution, 'declined');
        assert.equal(engine.pointDrain.percent, 0);

        engine.proposePointDrain(2, 10);
        assert.equal(timers.at(-1).duration, 30_000);
        let broadcasts = 0;
        engine.emitLobbyUpdateCallback = () => { broadcasts += 1; };
        while (timers.length) await runNext();
        assert.equal(engine.drainVote.resolution, 'expired', 'silence is a no');
        assert.equal(engine.pointDrain.percent, 0);
        assert.equal(broadcasts, 1, 'and the table is told');

        engine.proposePointDrain(3, 10);
        engine.submitDrainVote(1, 'yes');
        engine.submitDrainVote(2, 'yes');
        assert.equal(engine.drainVote.resolution, 'agreed');
        assert.equal(engine.pointDrain.percent, 10);
        assert.deepEqual(engine.scores, { Alice: 120, Bob: 120, Carol: 120, [PLACEHOLDER_ID]: 120 }, 'nothing moves until a round is dealt');
        pass('It takes every seat; one no or 30 silent seconds ends it; the game plays on underneath.');
    });

    // 4) It lands as the next round is dealt, after a scored round only.
    await withControlledTimeouts(async () => {
        const engine = makeEngine({ scores: { Alice: 151, Bob: 96, Carol: 1 } });
        agree(engine, 7.5);
        // An all-pass redeal goes through _advanceRound and costs nothing.
        engine._advanceRound();
        assert.deepEqual([engine.scores.Alice, engine.scores.Bob, engine.scores.Carol], [151, 96, 1]);

        finishRound(engine);
        engine.requestNextRound(99);
        assert.equal(engine.scores.Alice, 151, 'only the dealer of the round calls the next one');
        engine.requestNextRound(engine.roundSummary.dealerOfRoundId);
        assert.equal(engine.state, 'Dealing Pending');
        assert.deepEqual([engine.scores.Alice, engine.scores.Bob, engine.scores.Carol], [139, 88, 1], '12 (11.3 up), 8 (7.2 up), and never a last point');
        assert.equal(engine.scores[PLACEHOLDER_ID], 120, 'the absorber is nobody\'s score');
        assert.deepEqual(engine.pointDrain.last, { afterRound: 1, percent: 7.5, drops: { Alice: 12, Bob: 8 } });
        assert.equal(engine.pointDrain.par, 111, 'an untouched 120 is worth 111 now');

        const four = makeEngine({ scores: { Alice: 120, Bob: 120, Carol: 120, Dave: 120 }, fourth: true });
        agree(four, 20);
        finishRound(four);
        four.requestNextRound(four.roundSummary.dealerOfRoundId);
        assert.deepEqual(four.scores, { Alice: 96, Bob: 96, Carol: 96, Dave: 96 }, 'the dealer sitting out drops with everyone');
        pass('Scores drop as the next round is dealt — 151/96/1 at 7.5% becomes 139/88/1 — and par follows.');
    });

    // 5) Changing it, and turning it off, are votes too.
    await withControlledTimeouts(async () => {
        const engine = makeEngine();
        agree(engine, 10);
        assert.match(engine.pointDrainProposalError(2, 10), /already/);
        finishRound(engine);
        engine.requestNextRound(1);
        engine.state = 'Playing Phase';
        engine.proposePointDrain(2, 0);
        assert.equal(engine.drainVote.percent, 0);
        engine.submitDrainVote(1, 'yes');
        engine.submitDrainVote(3, 'yes');
        assert.equal(engine.pointDrain.percent, 0);
        finishRound(engine);
        engine.requestNextRound(engine.dealer);
        assert.equal(engine.scores.Alice, 108, 'dropped once, and not again');
        assert.equal(engine.pointDrain.last, null);
        pass('A running drain can be changed or switched off, by the same vote.');
    });

    // 6) A seat whose player has dropped is not asked.
    await withControlledTimeouts(async ({ timers }) => {
        const engine = makeEngine();
        engine.players[3].disconnected = true;
        engine.proposePointDrain(1, 10);
        assert.deepEqual(Object.keys(engine.drainVote.votes), ['Alice', 'Bob']);
        engine.submitDrainVote(3, 'no');
        assert.equal(engine.drainVote.isActive, true, 'and has no vote to cast');
        engine.submitDrainVote(2, 'yes');
        assert.equal(engine.pointDrain.percent, 10);

        const alone = makeEngine();
        alone.players[2].disconnected = true;
        alone.players[3].disconnected = true;
        alone.proposePointDrain(1, 20);
        assert.equal(alone.pointDrain.percent, 20, 'nobody else to ask: agreed at once');
        assert.equal(alone.drainVote.resolution, 'agreed');
        assert.equal(timers.filter(t => t.duration === 30_000).length, 1, 'and no clock was started for it');
        pass('Only seats that are there vote; a table waiting on a dropped player can still speed up.');
    });

    // 7) It belongs to the game: a new game and a rematch start without one,
    //    a forfeit closes an open vote, the client is told what it needs.
    await withControlledTimeouts(async () => {
        const engine = makeEngine();
        agree(engine, 10);
        engine.proposePointDrain(2, 20);
        const state = engine._getRawStateForClient();
        assert.deepEqual(state.pointDrain, { percent: 10, par: 120, last: null, options: [5, 7.5, 10, 15, 20], recommended: 10 });
        assert.equal(state.drainVote.initiator, 'Bob');
        assert.equal(state.drainVote.percent, 20);
        assert.equal('proposedInRound' in state.drainVote, false);

        engine._resolveForfeit('Carol', 'test');
        assert.equal(engine.drainVote.isActive, false);
        assert.equal(engine.drainVote.resolution, 'cancelled');

        engine.settlement = engine._newSettlementState();
        engine.reset();
        assert.deepEqual(engine.pointDrain, { percent: 0, par: 120, last: null });
        assert.equal(engine.drainVote.isActive, false);
        pass('A drain lasts one game; the client state carries the choices, the recommendation and the open vote.');
    });

    // 8) A deploy does not switch it off; an open vote is simply asked again.
    await withControlledTimeouts(async () => {
        const engine = makeEngine({ bots: ['Bob', 'Carol'] });
        agree(engine, 15);
        finishRound(engine);
        engine.requestNextRound(engine.dealer);
        engine.state = 'Playing Phase';
        engine.proposePointDrain(1, 20);
        engine.gameId = 4242;
        engine.bidWinnerInfo = { userId: 1, playerName: 'Alice', bid: 'Solo' };
        const snapshot = serializeEngineForResume(engine);
        assert.ok(snapshot, 'a live game snapshots');
        assert.equal(snapshot.pointDrain.percent, 15);

        const restored = new GameEngine('drain-test', 'fort-creek', 'Drain Test');
        assert.equal(restoreEngineFromResume(restored, snapshot), true);
        assert.equal(restored.pointDrain.percent, 15);
        assert.equal(restored.pointDrain.par, 102);
        assert.equal(restored.drainVote.isActive, false);

        const old = JSON.parse(JSON.stringify(snapshot));
        delete old.pointDrain;
        const legacy = new GameEngine('drain-test', 'fort-creek', 'Drain Test');
        assert.equal(restoreEngineFromResume(legacy, old), true);
        assert.deepEqual(legacy.pointDrain, { percent: 0, par: 120, last: null }, 'a snapshot from before the feature gets none');
        pass('The agreed drain survives a deploy; snapshots from before it existed restore clean.');
    });

    // 9) A split draw measures the low score against par, not a flat 120.
    {
        const table = (scorePar) => ({
            gameId: 7, theme: 'fort-creek', scorePar,
            players: {
                1: { userId: 1, playerName: 'Alice' }, 2: { userId: 2, playerName: 'Bob' }, 3: { userId: 3, playerName: 'Carol' },
            },
            scores: { Alice: 90, Bob: 60, Carol: 30 },
            seatingOrderIds: [1, 2, 3],
        });
        const lowShare = (settlement) => settlement.payouts.find(p => p.userId === 3)?.amountCents || 0;
        const flat = lowShare(buildDrawSettlement(table(undefined), 'split'));
        const drained = lowShare(buildDrawSettlement(table(60), 'split'));
        assert.ok(flat > 0);
        assert.equal(drained, flat * 2, 'with par at 60, a score of 30 is half a buy-in, not a quarter');
        const engine = makeEngine();
        assert.equal(engine._createSettlementSnapshot().scorePar, 120);
        pass('Under a drain the split draw pays the low seat against what an untouched score is worth now.');
    }

    // 10) The house never blocks a faster game: its seats say yes after a
    //     pause, each tied to the vote it was scheduled for.
    await withControlledTimeouts(async ({ timers, runNext }) => {
        const GameService = require('../src/services/GameService');
        const io = { sockets: { sockets: new Map() }, to() { return { emit() {} }; }, emit() {} };
        const service = createGameServiceWithoutHeartbeat(GameService, io, { query: async () => ({ rows: [], rowCount: 0 }) });
        const engine = makeEngine({ bots: ['Bob', 'Carol'] });
        engine.bots = { 2: { userId: 2, playerName: 'Bob' }, 3: { userId: 3, playerName: 'Carol' } };
        service.engines[engine.tableId] = engine;

        await service.proposePointDrain(engine.tableId, 1, 10);
        assert.equal(engine.drainVote.isActive, true);
        const pauses = timers.filter(t => t.duration !== 30_000).map(t => t.duration);
        assert.equal(pauses.length, 2);
        assert.ok(pauses[0] >= 1800 && pauses[1] > pauses[0], `a person's pause, one after another (${pauses.join(', ')})`);
        // The fake clock runs timers in the order they were queued; the real
        // one runs the shortest first, and the 30 s limit is the longest.
        timers.sort((a, b) => a.duration - b.duration);
        while (timers.length) await runNext();
        assert.equal(engine.pointDrain.percent, 10);
        assert.equal(engine.drainVote.resolution, 'agreed');
        pass('House seats agree after a human pause, one after another.');
    });

    console.log('All point drain tests passed.');
}

if (require.main === module) {
    runPointDrainTests().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}

module.exports = runPointDrainTests;
