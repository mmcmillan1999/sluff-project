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
const { frogDiscardStrategyFor } = require('../src/core/frogDiscards');

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

// The forfeit timer covered disconnected seats and the first version of this
// timer covered bids and card plays. Human vs bots makes the human the dealer
// every third round, so "phone face-down at Dealing Pending" was the commonest
// freeze left, followed by the three bidder-only prompts (upgrade, trump,
// widow exchange) that nobody else at the table can answer.

const FROG_HAND = ['AS', 'KS', '9C', '8D', '7D', '6D', 'AH', 'KH', 'QH', 'JH', '10H'];

const dealingFor = overrides => engineFor({
    state: 'Dealing Pending', dealer: 1, trickTurnPlayerId: null, ...overrides,
});
const upgradeFor = overrides => engineFor({
    state: 'Awaiting Frog Upgrade Decision', biddingTurnPlayerId: 1, trickTurnPlayerId: null, ...overrides,
});
const trumpFor = overrides => engineFor({
    state: 'Trump Selection',
    bidWinnerInfo: { userId: 1 },
    trumpSuit: null,
    trickTurnPlayerId: null,
    hands: { You: ['AS', 'KS', '9C', '8D', '7D', '6D'] },
    ...overrides,
});
const exchangeFor = overrides => engineFor({
    state: 'Frog Widow Exchange',
    bidWinnerInfo: { userId: 1 },
    widowDiscardsForFrogBidder: [],
    trickTurnPlayerId: null,
    hands: { You: [...FROG_HAND] },
    ...overrides,
});

// First sighting arms, one tick short stays quiet, the full window fires.
function armThenFire(engine) {
    const start = 1_000_000;
    assert.equal(evaluate(engine, { now: start }), null, 'first sighting only arms the clock');
    assert.equal(engine.afkWatch.since, start, 'the clock armed at first sighting');
    assert.equal(evaluate(engine, { now: start + DEFAULT_TIMEOUT_MS - 1 }), null, 'one tick short stays quiet');
    return evaluate(engine, { now: start + DEFAULT_TIMEOUT_MS });
}

function testAnAbsentDealerDeals() {
    const engine = dealingFor();
    assert.equal(pendingHumanAction(engine).kind, 'deal');
    assert.deepEqual(armThenFire(engine), { action: 'deal', userId: 1, playerName: 'You' });

    assert.equal(pendingHumanAction(dealingFor({ dealer: 3 })), null, 'a disconnected dealer belongs to the forfeit timer');
    assert.equal(pendingHumanAction(dealingFor({ dealer: 2 })), null, 'a bot dealer belongs to the bot loop');
    assert.equal(pendingHumanAction(dealingFor({ dealer: null })), null, 'no dealer, nothing to wait on');
    console.log('  an absent dealer deals; bot and disconnected dealers are left alone');
}

function testAnAbsentFrogBidderDeclinesTheUpgrade() {
    const engine = upgradeFor();
    assert.equal(pendingHumanAction(engine).kind, 'upgrade');
    assert.deepEqual(
        armThenFire(engine),
        { action: 'bid', userId: 1, bid: 'Pass', playerName: 'You' },
        'declining keeps the Frog the player actually committed to',
    );

    assert.equal(pendingHumanAction(upgradeFor({ biddingTurnPlayerId: 2 })), null, 'a bot decides its own upgrade');
    assert.equal(pendingHumanAction(upgradeFor({ biddingTurnPlayerId: 3 })), null, 'a disconnected bidder is not auto-decided');
    console.log('  an absent Frog bidder declines the upgrade rather than raising');
}

function testAnAbsentSoloBidderGetsTheirLongestSuit() {
    const engine = trumpFor();
    assert.equal(pendingHumanAction(engine).kind, 'trump');
    assert.deepEqual(
        armThenFire(engine),
        { action: 'trump', userId: 1, suit: 'D', playerName: 'You' },
        'three diamonds beat two spades and one club',
    );

    // The pick is the table default, not a judgement call: the longest suit
    // among S/C/D, spades ahead of diamonds on a tie, clubs when the hand
    // gives nothing to go on.
    const suitChosenFor = hand => armThenFire(trumpFor({ hands: { You: hand } })).suit;
    assert.equal(suitChosenFor(['AS', 'KS', '9D', '8D', 'AH']), 'S', 'a spade/diamond tie goes to spades');
    assert.equal(suitChosenFor(['AH', 'KH', 'QH']), 'C', 'an all-heart hand falls back to clubs');
    assert.equal(suitChosenFor([]), 'C', 'no hand at all still produces a legal suit');

    assert.equal(pendingHumanAction(trumpFor({ bidWinnerInfo: { userId: 2 } })), null, 'a bot bidder picks its own trump');
    assert.equal(pendingHumanAction(trumpFor({ bidWinnerInfo: { userId: 3 } })), null, 'a disconnected bidder is not auto-picked');
    assert.equal(pendingHumanAction(trumpFor({ trumpSuit: 'D' })), null, 'once trump is named nothing is owed');
    assert.equal(pendingHumanAction(trumpFor({ bidWinnerInfo: null })), null, 'no bid winner, nothing to wait on');
    console.log('  an absent Solo bidder is given their longest suit');
}

function testAnAbsentFrogBidderBuriesTheDefaultDiscards() {
    const engine = exchangeFor();
    assert.equal(pendingHumanAction(engine).kind, 'discards');

    const decision = armThenFire(engine);
    assert.equal(decision.action, 'discards');
    assert.equal(decision.userId, 1);
    assert.equal(decision.playerName, 'You');
    assert.equal(decision.discards.length, 3, 'the engine demands exactly three');
    assert.equal(new Set(decision.discards).size, 3, 'three distinct cards');
    for (const card of decision.discards) {
        assert.ok(FROG_HAND.includes(card), `${card} must come from the bidder's own hand`);
    }
    assert.deepEqual(
        decision.discards,
        frogDiscardStrategyFor('You')(FROG_HAND),
        'the table default discard policy applies, exactly as a bot would use it',
    );
    assert.deepEqual(engine.hands.You, FROG_HAND, 'deciding does not mutate the hand; the engine applies it');

    assert.equal(
        pendingHumanAction(exchangeFor({ widowDiscardsForFrogBidder: ['9C', '8D', '7D'] })),
        null,
        'once the discards are down nothing is owed',
    );
    assert.equal(pendingHumanAction(exchangeFor({ bidWinnerInfo: { userId: 2 } })), null, 'a bot buries its own');
    assert.equal(pendingHumanAction(exchangeFor({ bidWinnerInfo: { userId: 3 } })), null, 'a disconnected bidder is not auto-discarded');
    console.log('  an absent Frog bidder buries the default discards');
}

function testTheNewPromptsStillRespectVotesAndTheDeadline() {
    // The suspensions and the client-facing deadline are shared machinery;
    // a new state must not slip past them.
    assert.equal(pendingHumanAction(dealingFor({ drawRequest: { isActive: true } })), null);
    assert.equal(pendingHumanAction(trumpFor({ playoutVote: { isActive: true } })), null);
    assert.equal(pendingHumanAction(exchangeFor({ gameStarted: false })), null);

    const engine = trumpFor();
    const start = 1_000_000;
    evaluate(engine, { now: start });
    assert.equal(deadlineFor(engine, { timeoutMs: DEFAULT_TIMEOUT_MS }), start + DEFAULT_TIMEOUT_MS);
    assert.equal(refresh(engine, 1, { now: start + 10_000 }), true, 'the bidder can extend their own clock');
    assert.equal(refresh(engine, 2, { now: start + 20_000 }), false, 'a bot cannot extend it for them');

    // Naming trump moves the table on; the stale watch must not fire.
    engine.trumpSuit = 'D';
    assert.equal(evaluate(engine, { now: start + 2 * DEFAULT_TIMEOUT_MS }), null);
    assert.equal(engine.afkWatch, null, 'the watch is dropped once nothing is pending');
    console.log('  the new prompts share the vote suspension, deadline, and ping rules');
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
    testAnAbsentDealerDeals();
    testAnAbsentFrogBidderDeclinesTheUpgrade();
    testAnAbsentSoloBidderGetsTheirLongestSuit();
    testAnAbsentFrogBidderBuriesTheDefaultDiscards();
    testTheNewPromptsStillRespectVotesAndTheDeadline();
    console.log('AFK turn timer tests passed.');
}

if (require.main === module) run();

module.exports = run;
