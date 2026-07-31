'use strict';

const assert = require('node:assert/strict');
const {
    DEFAULT_TIMEOUT_MS,
    MAX_TURN_WINDOWS,
    cheapestLegalCard,
    deadlineFor,
    evaluate,
    pendingHumanAction,
    refresh,
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


function testActivityPingsExtendTheClock() {
    // The server cannot see touches, only completed actions — so without the
    // ping, "idle" silently meant "elapsed turn time" and a present player
    // thinking through a hard trick was auto-played mid-thought. That is the
    // exact complaint feedback #73 filed.
    const engine = engineFor();
    const start = 1_000_000;
    evaluate(engine, { now: start });

    assert.equal(refresh(engine, 1, { now: start + 40_000 }), true, 'the pending player extends their clock');
    assert.equal(
        evaluate(engine, { now: start + DEFAULT_TIMEOUT_MS + 1000 }),
        null,
        'the extended clock does not fire at the original deadline',
    );
    const fired = evaluate(engine, { now: start + 40_000 + DEFAULT_TIMEOUT_MS });
    assert.ok(fired, 'it fires a full window after the last sign of life');

    // Only the player actually on turn can extend — a defender spamming pings
    // for the bidder must not hold the table open.
    const fresh = engineFor();
    evaluate(fresh, { now: start });
    assert.equal(refresh(fresh, 2, { now: start + 10_000 }), false, 'a bot seat cannot be extended');
    assert.equal(refresh(fresh, 3, { now: start + 10_000 }), false, 'a different player cannot extend');
    assert.equal(fresh.afkWatch.since, start, 'the clock did not move');

    assert.equal(refresh({ gameStarted: false }, 1), false, 'no engine state, no crash');
    console.log('  activity pings extend the clock, and only for the player on turn');
}


function testScriptedPingsCannotHoldTheTableHostage() {
    // The ceiling is the difference between "extend while thinking" and
    // "disable the backstop from devtools": a losing player scripting
    // socket.emit('turnActivity') every second must not be able to freeze a
    // funded table until the other players give up and forfeit to them.
    const engine = engineFor();
    const start = 1_000_000;
    evaluate(engine, { now: start });

    let fired = null;
    for (let now = start + 1000; now <= start + 10 * DEFAULT_TIMEOUT_MS && !fired; now += 1000) {
        refresh(engine, 1, { now, timeoutMs: DEFAULT_TIMEOUT_MS });
        if (evaluate(engine, { now, timeoutMs: DEFAULT_TIMEOUT_MS })) fired = now;
    }

    assert.ok(fired, 'the backstop still fires under continuous scripted pings');
    assert.equal(
        (fired - start) / DEFAULT_TIMEOUT_MS,
        MAX_TURN_WINDOWS,
        `the siege ends at exactly ${MAX_TURN_WINDOWS} windows`,
    );
    console.log('  scripted pings delay the backstop to the cap, never disable it');
}

function run() {
    testItOnlyWatchesIdleHumans();
    testNothingHappensBeforeTheWindowElapses();
    testTheClockRestartsOnANewTurn();
    testItPassesRatherThanBids();
    testItPlaysTheCheapestLegalCard();
    testCheapestPrefersPointlessThenLow();
    testItFiresOnlyOncePerTurn();
    testActivityPingsExtendTheClock();
    testScriptedPingsCannotHoldTheTableHostage();
    testDeadlineIsExposedForTheClient();
    console.log('AFK turn timer tests passed.');
}

if (require.main === module) run();

module.exports = run;
