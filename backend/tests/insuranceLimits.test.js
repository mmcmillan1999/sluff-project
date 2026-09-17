// backend/tests/insuranceLimits.test.js
//
// Nobody may offer more insurance points than they hold (Matt, Sept 17 2026):
// the most a seat can put up is every point but its last, in a regular game
// and at a tournament table alike. "Offering" is the paying direction of
// each control — a defender's positive offer, a bidder's NEGATIVE ask — and
// the receiving direction is never limited by the stack. These tests pin the
// rule itself, the engine that enforces it on everyone, the limits the client
// is told, and the bots.

'use strict';

const assert = require('node:assert/strict');
const GameEngine = require('../src/core/GameEngine');
const GameService = require('../src/services/GameService');
const { affordable, insuranceLimits, clampToLimits } = require('../src/core/insuranceLimits');
const { calculateRoundScoreDetails } = require('../src/core/logic');
const { createGameServiceWithoutHeartbeat } = require('./test-helpers');

// Alice holds a Solo (multiplier 2); Bob and Carol defend.
function makeRound({ scores = { Alice: 100, Bob: 100, Carol: 100 }, bid = 'Solo', multiplier = 2, tournament = false } = {}) {
    const engine = new GameEngine('insurance-limit-test', 'fort-creek', 'Insurance Limit Test');
    engine.joinTable({ id: 1, username: 'Alice' }, 's1');
    engine.joinTable({ id: 2, username: 'Bob' }, 's2');
    engine.joinTable({ id: 3, username: 'Carol' }, 's3');
    engine.gameStarted = true;
    engine.state = 'Playing Phase';
    engine.playerOrder = { allIds: [1, 2, 3], turnOrder: [1, 2, 3] };
    engine.scores = { ...scores };
    engine.capturedTricks = { Alice: [], Bob: [], Carol: [] };
    engine.bidWinnerInfo = { userId: 1, playerName: 'Alice', bid };
    engine.trumpSuit = 'S';
    engine.tricksPlayedCount = 2;
    engine.widow = [];
    engine.originalDealtWidow = [];
    engine.widowDiscardsForFrogBidder = [];
    engine.currentTrickCards = [];
    engine.hands = { Alice: ['AS'], Bob: ['KS'], Carol: ['QS'] };
    engine.insurance = {
        isActive: true,
        bidMultiplier: multiplier,
        bidderPlayerName: 'Alice',
        bidderRequirement: 120 * multiplier,
        defenderOffers: { Bob: -60 * multiplier, Carol: -60 * multiplier },
        dealExecuted: false,
        executedDetails: null,
    };
    if (tournament) {
        engine.tableType = 'tournament';
        engine.tournament = { tournamentId: 9, roundNumber: 3 };
        engine.gameId = null;
    }
    return engine;
}

async function runInsuranceLimitTests() {
    console.log('Running insurance limit tests...');
    let testCounter = 1;
    const pass = (name) => console.log(`  ✔ Test ${testCounter++}: ${name}`);

    // 1) The rule.
    {
        assert.equal(affordable(120), 119);
        assert.equal(affordable(2), 1);
        assert.equal(affordable(1), 0, 'a last point is never put up');
        assert.equal(affordable(0), 0);
        assert.equal(affordable(-14), 0);
        assert.equal(affordable(37.9), 36, 'a fractional stack rounds in the safe direction');
        assert.equal(affordable(undefined), Infinity, 'no score, no stack limit');

        assert.deepEqual(insuranceLimits({ multiplier: 1, stack: 120, isBidder: false }), { min: -60, max: 60, absoluteMin: -60, absoluteMax: 60 });
        assert.equal(insuranceLimits({ multiplier: 2, stack: 38, isBidder: false }).max, 37, 'a defender puts up every point but its last');
        assert.equal(insuranceLimits({ multiplier: 2, stack: 38, isBidder: false }).min, -120, 'and may still ask to be paid anything');
        assert.equal(insuranceLimits({ multiplier: 3, stack: 500, isBidder: false }).max, 180, 'a deep stack is still inside the round’s range');

        const shortBidder = insuranceLimits({ multiplier: 2, stack: 38, isBidder: true });
        assert.equal(shortBidder.min, -37, 'a bidder’s NEGATIVE ask is the bidder paying');
        assert.equal(shortBidder.max, 240, 'what a bidder asks to receive is not limited by the stack');
        assert.ok(Object.is(insuranceLimits({ multiplier: 1, stack: 1, isBidder: true }).min, 0), 'zero, not minus zero');
        assert.equal(insuranceLimits({ multiplier: 1, stack: undefined, isBidder: true }).min, -120);

        const limits = insuranceLimits({ multiplier: 2, stack: 38, isBidder: false });
        assert.equal(clampToLimits(60, limits), 37, 'past the stack: pulled back to every point but one');
        assert.equal(clampToLimits(37, limits), 37);
        assert.equal(clampToLimits(-120, limits), -120);
        assert.equal(clampToLimits(121, limits), null, 'outside the round’s range is not a setting at all');
        assert.equal(clampToLimits(NaN, limits), null);
        pass('The most a seat may put up is every point but its last; receiving is never limited.');
    }

    // 2) The engine holds a defender to it.
    {
        const engine = makeRound({ scores: { Alice: 100, Bob: 38, Carol: 100 } });
        engine.updateInsuranceSetting(2, 'defenderOffer', 60);
        assert.equal(engine.insurance.defenderOffers.Bob, 37, 'offering 60 while holding 38 puts up 37');
        engine.updateInsuranceSetting(2, 'defenderOffer', 20);
        assert.equal(engine.insurance.defenderOffers.Bob, 20, 'an affordable offer is taken as given');
        engine.updateInsuranceSetting(2, 'defenderOffer', 500);
        assert.equal(engine.insurance.defenderOffers.Bob, 20, 'outside the round’s range is still ignored');
        engine.updateInsuranceSetting(2, 'defenderOffer', -120);
        assert.equal(engine.insurance.defenderOffers.Bob, -120, 'asking to be paid is not limited by the stack');
        engine.updateInsuranceSetting(3, 'defenderOffer', 120);
        assert.equal(engine.insurance.defenderOffers.Carol, 99, 'Carol holds 100');
        pass('A defender’s offer stops at every point but its last.');
    }

    // 3) ...and a bidder buying their way out of a failing bid.
    {
        const engine = makeRound({ scores: { Alice: 25, Bob: 100, Carol: 100 } });
        engine.updateInsuranceSetting(1, 'bidderRequirement', -100);
        assert.equal(engine.insurance.bidderRequirement, -24, 'paying 100 while holding 25 puts up 24');
        engine.updateInsuranceSetting(1, 'bidderRequirement', 240);
        assert.equal(engine.insurance.bidderRequirement, 240, 'asking to receive is not limited by the stack');
        pass('A bidder’s negative ask stops at every point but its last.');
    }

    // 4) A deal struck at the limit leaves the seat its last point.
    {
        const engine = makeRound({ scores: { Alice: 100, Bob: 38, Carol: 12 } });
        engine.updateInsuranceSetting(2, 'defenderOffer', 120);
        engine.updateInsuranceSetting(3, 'defenderOffer', 120);
        engine.updateInsuranceSetting(1, 'bidderRequirement', 40);
        assert.equal(engine.insurance.dealExecuted, true);
        const { pointChanges } = calculateRoundScoreDetails({
            ...engine,
            playerOrderActive: [1, 2, 3],
            bidderTotalCardPoints: 90,
        });
        assert.equal(pointChanges.Bob, -37);
        assert.equal(pointChanges.Carol, -11);
        assert.equal(pointChanges.Alice, 48, 'the bidder collects exactly what was put up');
        assert.equal(38 + pointChanges.Bob, 1);
        assert.equal(12 + pointChanges.Carol, 1);

        const buyOut = makeRound({ scores: { Alice: 25, Bob: 100, Carol: 100 } });
        buyOut.updateInsuranceSetting(1, 'bidderRequirement', -240);
        buyOut.updateInsuranceSetting(2, 'defenderOffer', -12);
        buyOut.updateInsuranceSetting(3, 'defenderOffer', -12);
        assert.equal(buyOut.insurance.dealExecuted, true, 'the defenders ask 24 between them; the bidder put up 24');
        const bought = calculateRoundScoreDetails({ ...buyOut, playerOrderActive: [1, 2, 3], bidderTotalCardPoints: 20 });
        assert.equal(25 + bought.pointChanges.Alice, 1, 'the bidder keeps a last point');
        pass('No insurance deal can take a seat’s last point.');
    }

    // 5) A seat down to its last point has nothing to put up, and can still
    //    ask to be paid.
    {
        const engine = makeRound({ scores: { Alice: 1, Bob: 1, Carol: 0 }, bid: 'Frog', multiplier: 1 });
        engine.updateInsuranceSetting(2, 'defenderOffer', 5);
        assert.equal(engine.insurance.defenderOffers.Bob, 0);
        engine.updateInsuranceSetting(2, 'defenderOffer', -60);
        assert.equal(engine.insurance.defenderOffers.Bob, -60, 'asking to be paid is always open');
        engine.updateInsuranceSetting(3, 'defenderOffer', 1);
        assert.equal(engine.insurance.defenderOffers.Carol, 0);
        engine.updateInsuranceSetting(1, 'bidderRequirement', -1);
        assert.equal(engine.insurance.bidderRequirement, 0);
        assert.equal(engine.insurance.dealExecuted, false, 'an ask of 0 against offers of -60 and 0 is no deal');
        pass('A seat on its last point can put up nothing and may still ask to be paid.');
    }

    // 6) A tournament table is the same engine: the score is the stack.
    {
        const engine = makeRound({ scores: { Alice: 60, Bob: 9, Carol: 60 }, bid: 'Heart Solo', multiplier: 3, tournament: true });
        engine.updateInsuranceSetting(2, 'defenderOffer', 180);
        assert.equal(engine.insurance.defenderOffers.Bob, 8, 'a short tournament stack puts up all but one chip');
        pass('Tournament tables hold their stacks to the same limit.');
    }

    // 7) The client is told each seat's limits; the engine's own insurance
    //    state (what a deploy snapshot saves) does not carry them.
    {
        const engine = makeRound({ scores: { Alice: 25, Bob: 38, Carol: 100 } });
        const state = engine._getRawStateForClient();
        assert.deepEqual(state.insurance.limits, {
            Alice: { min: -24, max: 240 },
            Bob: { min: -120, max: 37 },
            Carol: { min: -120, max: 99 },
        });
        assert.equal(state.insurance.bidderRequirement, 240, 'the rest of the insurance state is unchanged');
        assert.equal('limits' in engine.insurance, false);
        engine.insurance.isActive = false;
        assert.deepEqual(engine._getRawStateForClient().insurance.limits, {});
        pass('Every party’s limits ride along in the client state.');
    }

    // 8) Bots: whatever a strategy asks for is held to the same limit, and a
    //    bot already standing at its limit has no move (a legacy strategy that
    //    still wants more must not re-submit on every bot tick).
    {
        const io = { sockets: { sockets: new Map() }, to() { return { emit() {} }; }, emit() {} };
        const pool = { query: async () => ({ rows: [], rowCount: 0 }) };
        const service = createGameServiceWithoutHeartbeat(GameService, io, pool);
        const engine = makeRound({ scores: { Alice: 25, Bob: 38, Carol: 100 } });
        const bob = { userId: 2, playerName: 'Bob' };
        const alice = { userId: 1, playerName: 'Alice' };

        assert.deepEqual(service._withinInsuranceLimits(engine, bob, { settingType: 'defenderOffer', value: 60 }),
            { settingType: 'defenderOffer', value: 37 }, 'all but one of its points, when its logic wanted more');
        assert.deepEqual(service._withinInsuranceLimits(engine, bob, { settingType: 'defenderOffer', value: 15 }),
            { settingType: 'defenderOffer', value: 15 }, 'an affordable quote is untouched');
        assert.deepEqual(service._withinInsuranceLimits(engine, alice, { settingType: 'bidderRequirement', value: -90 }),
            { settingType: 'bidderRequirement', value: -24 });
        assert.equal(service._withinInsuranceLimits(engine, bob, null), null);

        engine.updateInsuranceSetting(2, 'defenderOffer', 37);
        assert.equal(service._withinInsuranceLimits(engine, bob, { settingType: 'defenderOffer', value: 60 }), null,
            'already at the limit: nothing to submit');

        let asked = 0;
        service.marketInsurance = { calculateInsuranceMove: () => { asked += 1; return { settingType: 'defenderOffer', value: 60 }; } };
        assert.equal(await service._calculateBotInsuranceMove(engine, bob), null, 'the live bot path goes through the limit');
        assert.equal(asked, 1);
        pass('A bot puts up every point but its last when its logic wants more, and then stands still.');
    }

    console.log('All insurance limit tests passed.');
}

if (require.main === module) {
    runInsuranceLimitTests().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}

module.exports = runInsuranceLimitTests;
