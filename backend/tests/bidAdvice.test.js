'use strict';

const assert = require('node:assert/strict');
const { analyzeHandForBid, evaluateHandBid, recommendBid } = require('../src/core/bidAdvice');
const BotPlayer = require('../src/core/BotPlayer');

// The evaluator is shared verbatim with BotPlayer.decideBid: the player-facing
// hint must always describe exactly how the table's automated play would bid
// the same hand, or the advice teaches the wrong game.

// Points: A=11, 10=10, K=4, Q=3, J=2, others 0.

function testAnalyzeCountsPointsAndSuits() {
    const { points, suits } = analyzeHandForBid(['AH', 'KH', 'QH', 'JH', '10H', 'AS', '7S', '8C']);
    assert.equal(points, 41); // 11+4+3+2+10+11
    assert.deepEqual(suits, { H: 5, S: 2, C: 1, D: 0 });
    assert.deepEqual(analyzeHandForBid([]), { points: 0, suits: { H: 0, S: 0, C: 0, D: 0 } });
}

function testHeartSoloTiers() {
    // Five hearts with 31+ points.
    assert.equal(evaluateHandBid({ points: 31, suits: { H: 5, S: 0, C: 0, D: 0 } }), 'Heart Solo');
    assert.notEqual(evaluateHandBid({ points: 30, suits: { H: 5, S: 0, C: 0, D: 0 } }), 'Heart Solo');
    // Four hearts only on a premium hand.
    assert.equal(evaluateHandBid({ points: 47, suits: { H: 4, S: 0, C: 0, D: 0 } }), 'Heart Solo');
    assert.notEqual(evaluateHandBid({ points: 46, suits: { H: 4, S: 0, C: 0, D: 0 } }), 'Heart Solo');
}

function testSoloTiers() {
    assert.equal(evaluateHandBid({ points: 35, suits: { H: 0, S: 5, C: 0, D: 0 } }), 'Solo');
    assert.notEqual(evaluateHandBid({ points: 34, suits: { H: 0, S: 5, C: 0, D: 0 } }), 'Solo');
    assert.equal(evaluateHandBid({ points: 41, suits: { H: 0, S: 0, C: 4, D: 0 } }), 'Solo');
    assert.notEqual(evaluateHandBid({ points: 40, suits: { H: 0, S: 0, C: 4, D: 0 } }), 'Solo');
}

function testFrogTiersAndDemotedHeartHand() {
    assert.equal(evaluateHandBid({ points: 31, suits: { H: 4, S: 0, C: 0, D: 0 } }), 'Frog');
    assert.equal(evaluateHandBid({ points: 41, suits: { H: 3, S: 0, C: 0, D: 0 } }), 'Frog');
    assert.equal(evaluateHandBid({ points: 20, suits: { H: 4, S: 0, C: 0, D: 0 } }), 'Pass');
    // A 4-heart hand short of the premium Heart Solo bar falls to Frog.
    assert.equal(evaluateHandBid({ points: 44, suits: { H: 4, S: 0, C: 0, D: 0 } }), 'Frog');
}

function testOutbidDowngradesToPass() {
    // 31 points (AH KH QH JH + AS), four hearts: a Frog hand.
    const frogHand = ['AH', 'KH', 'QH', 'JH', 'AS', '7S', '8S', '7C', '8C', '7D', '8D'];
    const fresh = recommendBid(frogHand, null);
    assert.equal(fresh.bid, 'Frog');
    assert.equal(fresh.outbid, false);

    const outbid = recommendBid(frogHand, 'Solo');
    assert.equal(outbid.bid, 'Pass');
    assert.equal(outbid.handBid, 'Frog');
    assert.equal(outbid.outbid, true);

    // A passing hand is never "outbid" — there was nothing to take.
    const weak = recommendBid(['7S', '8S', '7C', '8C', '7D', '8D', '9D', '7H', '8H', '9H', 'JS'], 'Solo');
    assert.equal(weak.outbid, false);
    assert.equal(weak.bid, 'Pass');
}

function testBotDelegatesToTheSharedEvaluator() {
    const hand = ['AH', 'KH', 'QH', 'JH', '10H', 'AS', '7S', '8C', '9C', '7D', '8D'];
    const engine = {
        hands: { Brandi: hand },
        currentHighestBidDetails: null,
    };
    const bot = Object.create(BotPlayer.prototype);
    bot.engine = engine;
    bot.playerName = 'Brandi';
    assert.equal(bot.decideBid(), recommendBid(hand, null).bid);

    engine.currentHighestBidDetails = { bid: 'Heart Solo' };
    assert.equal(bot.decideBid(), 'Pass');
}

function run() {
    const tests = [
        testAnalyzeCountsPointsAndSuits,
        testHeartSoloTiers,
        testSoloTiers,
        testFrogTiersAndDemotedHeartHand,
        testOutbidDowngradesToPass,
        testBotDelegatesToTheSharedEvaluator,
    ];

    for (const test of tests) {
        test();
        console.log(`PASS ${test.name}`);
    }
    console.log(`bidAdvice: ${tests.length} tests passed`);
}

if (require.main === module) run();

module.exports = run;
