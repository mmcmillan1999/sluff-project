'use strict';

const assert = require('node:assert/strict');
const {
    DEFAULT_TIMEOUT_MS,
    cheapestLegalCard,
    deadlineFor,
    evaluate,
    pendingHumanAction,
} = require('../src/core/afkTurnTimer');

// The timer exists because the forfeit timer only ever covered DISCONNECTED
// seats: a player whose phone was face-down froze the table indefinitely. What
// matters most here is what it refuses to touch — bots, disconnected seats, and
// live votes all have their own owners.

const HUMAN = { playerName: 'You', isBot: false, disconnected: false };
const BOT = { playerName: 'Brandi', isBot: true, disconnected: false };
const GONE = { playerName: 'Elena', isBot: false, disconnected: true };

const engineFor = (overrides = {}) => ({
    gameStarted: true,
    state: 'Playing Phase',
    players: { 1: HUMAN, 2: BOT, 3: GONE },
    trickTurnPlayerId: 1,
    biddingTurnPlayerId: null,
    hands: { You: ['AS', '7C', 'KH', '9D'] },
    currentTrickCards: [],
    leadSuitCurrentTrick: null,
    trumpSuit: 'S',
    trumpBroken: true,
    tricksPlayedCount: 0,
    playersWhoPassedThisRound: [],
    drawRequest: null,
    playoutVote: null,
    afkWatch: null,
    ...overrides,
});

function testItOnlyWatchesIdleHumans() {
    assert.ok(pendingHumanAction(engineFor()), 'a human on the clock is watched');

    assert.equal(
        pendingHumanAction(engineFor({ trickTurnPlayerId: 2 })), null,
        'bots are the bot loop\'s problem',
    );
    assert.equal(
        pendingHumanAction(engineFor({ trickTurnPlayerId: 3 })), null,
        'disconnected seats belong to the forfeit timer',
    );
    assert.equal(
        pendingHumanAction(engineFor({ gameStarted: false })), null,
        'nothing to do before the game starts',
    );
    assert.equal(
        pendingHumanAction(engineFor({ state: 'TrickCompleteLinger' })), null,
        'no action is owed between tricks',
    );
    // A vote is its own timed interaction; racing it would resolve someone's
    // turn out from under a modal.
    assert.equal(
        pendingHumanAction(engineFor({ drawRequest: { isActive: true } })), null,
        'a draw vote suspends the clock',
    );
    assert.equal(
        pendingHumanAction(engineFor({ playoutVote: { isActive: true } })), null,
        'a playout vote suspends the clock',
    );
    console.log('  watches idle humans only — not bots, disconnects, or votes');
}

function testNothingHappensBeforeTheWindowElapses() {
    const engine = engineFor();
    const start = 1_000_000;

    assert.equal(evaluate(engine, { now: start }), null, 'first sighting only arms the clock');
    assert.equal(engine.afkWatch.since, start);

    assert.equal(evaluate(engine, { now: start + DEFAULT_TIMEOUT_MS - 1 }), null, 'one tick short');
    assert.equal(engine.afkWatch.since, start, 'the clock did not restart');
    console.log('  the window has to actually elapse');
}

function testTheClockRestartsOnANewTurn() {
    const engine = engineFor();
    const start = 1_000_000;
    evaluate(engine, { now: start });

    // A card lands: same player is no longer the one being waited on.
    engine.currentTrickCards = [{ card: 'KH' }];
    assert.equal(evaluate(engine, { now: start + 100 }), null);
    assert.equal(engine.afkWatch.since, start + 100, 'a genuinely new turn restarts the clock');

    // Unrelated churn must NOT restart it, or a chatty table never times out.
    const before = engine.afkWatch.since;
    engine.someUnrelatedField = 'insurance tick';
    evaluate(engine, { now: start + 200 });
    assert.equal(engine.afkWatch.since, before, 'unrelated state change does not restart it');
    console.log('  the clock tracks turns, not unrelated table churn');
}

function testItPassesRatherThanBids() {
    const engine = engineFor({
        state: 'Bidding Phase',
        biddingTurnPlayerId: 1,
        trickTurnPlayerId: null,
    });
    const start = 1_000_000;
    evaluate(engine, { now: start });

    const decision = evaluate(engine, { now: start + DEFAULT_TIMEOUT_MS });
    assert.deepEqual(decision, {
        action: 'bid', userId: 1, bid: 'Pass', playerName: 'You',
    }, 'passing can never cost the absent player more than they already risked');
    console.log('  an absent bidder passes');
}

function testItPlaysTheCheapestLegalCard() {
    const engine = engineFor({
        hands: { You: ['AS', '7S', 'KS', '9S'] },
        leadSuitCurrentTrick: 'S',
        currentTrickCards: [{ card: '6S' }],
    });
    const start = 1_000_000;
    evaluate(engine, { now: start });

    const decision = evaluate(engine, { now: start + DEFAULT_TIMEOUT_MS });
    assert.equal(decision.action, 'play');
    // 7S is worth nothing and is the lowest of the pointless cards; AS (11) and
    // KS (4) would hand away real points on the player's behalf.
    assert.equal(decision.card, '7S', 'surrenders the fewest points available');
    console.log('  an absent player sheds the cheapest legal card');
}

function testCheapestPrefersPointlessThenLow() {
    assert.equal(cheapestLegalCard(['AS', 'KS', '9S']), '9S', 'pointless beats pointed');
    assert.equal(cheapestLegalCard(['AS', 'KS', 'QS']), 'QS', 'least valuable of a bad lot');
    assert.equal(cheapestLegalCard(['8H', '6H', '9H']), '6H', 'lowest of the pointless');
    assert.equal(cheapestLegalCard([]), null);
    assert.equal(cheapestLegalCard(null), null);
    console.log('  card choice is least-damaging, not cleverest');
}

function testItFiresOnlyOncePerTurn() {
    const engine = engineFor();
    const start = 1_000_000;
    evaluate(engine, { now: start });

    const first = evaluate(engine, { now: start + DEFAULT_TIMEOUT_MS });
    assert.ok(first, 'fires once the window elapses');

    // Re-armed on firing: the heartbeat runs every 1.5s, and without this the
    // same turn would be auto-played on every tick until the state caught up.
    const immediate = evaluate(engine, { now: start + DEFAULT_TIMEOUT_MS + 1500 });
    assert.equal(immediate, null, 'does not fire again while the state settles');
    console.log('  one action per turn, not one per heartbeat');
}

function testDeadlineIsExposedForTheClient() {
    const engine = engineFor();
    const start = 1_000_000;
    assert.equal(deadlineFor(engine), null, 'no deadline before the clock arms');

    evaluate(engine, { now: start });
    assert.equal(deadlineFor(engine, { timeoutMs: DEFAULT_TIMEOUT_MS }), start + DEFAULT_TIMEOUT_MS);

    engine.trickTurnPlayerId = 2; // a bot's turn
    assert.equal(deadlineFor(engine), null, 'a stale watch does not report a deadline');
    console.log('  the deadline is reportable so the client can warn first');
}

function run() {
    testItOnlyWatchesIdleHumans();
    testNothingHappensBeforeTheWindowElapses();
    testTheClockRestartsOnANewTurn();
    testItPassesRatherThanBids();
    testItPlaysTheCheapestLegalCard();
    testCheapestPrefersPointlessThenLow();
    testItFiresOnlyOncePerTurn();
    testDeadlineIsExposedForTheClient();
    console.log('AFK turn timer tests passed.');
}

if (require.main === module) run();

module.exports = run;
