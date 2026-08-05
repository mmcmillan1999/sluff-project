// backend/tests/marketInsurance.test.js
//
// Tests for the market-pricing insurance strategy and its estimator:
//   1. Information boundary: the strategy must work from public info only —
//      a trapped engine throws if it touches another hand or the widow.
//   2. Leak regressions (the exploits found in the August 2026 data review):
//      a winning defender never posts a positive offer, a dominating bidder
//      never posts a token ask, and a failing human bidder's ask of 0 never
//      executes against rational defenders.
//   3. Estimator sanity: bounds, determinism, void inference, attribution.

const assert = require('assert');
const MarketInsuranceStrategy = require('../src/core/bot-strategies/MarketInsuranceStrategy');
const { buildPublicView } = require('../src/core/bot-strategies/PublicRoundView');
const { estimateBidderPoints } = require('../src/core/bot-strategies/RolloutEstimator');
const { deck } = require('../src/core/constants');

// --- Mock engine -------------------------------------------------------

const NAMES = { 1: 'Bidder', 2: 'DefA', 3: 'DefB' };

function mockEngine({
    bidderId = 1,
    bid = 'Solo',
    trumpSuit = 'S',
    hands,
    multiplier = { Frog: 1, Solo: 2, 'Heart Solo': 3 }[bid],
    scores = { Bidder: 120, DefA: 120, DefB: 120 },
    overrides = {},
}) {
    const players = {
        1: { userId: 1, playerName: NAMES[1], isBot: true },
        2: { userId: 2, playerName: NAMES[2], isBot: true },
        3: { userId: 3, playerName: NAMES[3], isBot: true },
    };
    const bidderName = NAMES[bidderId];
    const defenders = Object.values(NAMES).filter(n => n !== bidderName);
    return {
        players,
        playerOrder: { turnOrder: [1, 2, 3] },
        playerMode: 3,
        state: 'Bid Announcement',
        bidWinnerInfo: { userId: bidderId, playerName: bidderName, bid },
        trumpSuit,
        trumpBroken: false,
        hands,
        capturedTricks: {},
        currentTrickCards: [],
        lastCompletedTrick: null,
        tricksPlayedCount: 0,
        bidderCardPoints: 0,
        defenderCardPoints: 0,
        trickLeaderId: bidderId,
        revealedWidowForFrog: [],
        widowDiscardsForFrogBidder: [],
        scores: { ...scores, ScoreAbsorber: 120 },
        insurance: {
            isActive: true,
            bidMultiplier: multiplier,
            bidderPlayerName: bidderName,
            bidderRequirement: 120 * multiplier,
            defenderOffers: Object.fromEntries(defenders.map(d => [d, -60 * multiplier])),
            dealExecuted: false,
            executedDetails: null,
        },
        ...overrides,
    };
}

// Wrap an engine so any read of private information throws.
function trapPrivateInfo(engine, botName) {
    engine.hands = new Proxy(engine.hands, {
        get(target, prop) {
            if (typeof prop === 'string' && prop !== botName && Object.values(NAMES).includes(prop)) {
                throw new Error(`ILLEGAL READ: hand of ${prop}`);
            }
            return target[prop];
        },
    });
    Object.defineProperty(engine, 'widow', {
        get() { throw new Error('ILLEGAL READ: widow'); },
    });
    Object.defineProperty(engine, 'originalDealtWidow', {
        get() { throw new Error('ILLEGAL READ: originalDealtWidow'); },
    });
    return engine;
}

const remainingDeck = used => deck.filter(c => !used.includes(c));

function runMarketInsuranceTests() {
    console.log('Running MarketInsuranceStrategy tests...');
    let testCounter = 1;
    const pass = (name) => console.log(`  ✔ Test ${testCounter++}: ${name}`);
    const strategy = new MarketInsuranceStrategy(null, null, { rollouts: 120 });

    // ------------------------------------------------------------------
    // A monster Solo hand: boss cards everywhere plus long trump.
    const monsterHand = ['AS', '10S', 'KS', 'QS', 'JS', '9S', 'AH', '10H', 'AC', '10C', 'AD'];
    // A hand that will get crushed defending: no points, short suits.
    const junkHand = ['6H', '7H', '8H', '6D', '7D', '8D', '6C', '7C', '8C', '6S', '7S'];

    // 1) Information boundary: bidder and defender decisions touch nothing
    //    private. The trap throws on any illegal read.
    {
        const engine = trapPrivateInfo(
            mockEngine({ hands: { Bidder: monsterHand } }), 'Bidder');
        const move = strategy.calculateInsuranceMove(engine, { playerName: 'Bidder' });
        assert.ok(move === null || Number.isFinite(move.value));
        pass('Bidder decision reads public information only.');
    }
    {
        const engine = trapPrivateInfo(
            mockEngine({ hands: { DefA: junkHand } }), 'DefA');
        const move = strategy.calculateInsuranceMove(engine, { playerName: 'DefA' });
        assert.ok(move === null || Number.isFinite(move.value));
        pass('Defender decision reads public information only.');
    }

    // 2) A dominating bidder never posts a token ask.
    {
        const engine = mockEngine({ hands: { Bidder: monsterHand } });
        const move = strategy.calculateInsuranceMove(engine, { playerName: 'Bidder' });
        assert.ok(move, 'expected a quote');
        assert.strictEqual(move.settingType, 'bidderRequirement');
        assert.ok(move.value >= 60,
            `dominating Solo bidder should ask big, got ${move.value}`);
        assert.strictEqual(move.value % 5, 0);
        assert.ok(move.value <= 240 && move.value >= -240);
        pass(`Dominating bidder asks ${move.value}, never a token 5.`);
    }

    // 3) A defender who is winning (monster defense vs weak bidder) demands
    //    payment — never a positive offer. Both defenders demanding means a
    //    failing bidder's ask of 0 can never execute for free.
    {
        const engineA = mockEngine({ bid: 'Frog', trumpSuit: 'H', hands: { DefA: monsterHand } });
        const moveA = strategy.calculateInsuranceMove(engineA, { playerName: 'DefA' });
        assert.ok(moveA, 'expected a quote');
        assert.strictEqual(moveA.settingType, 'defenderOffer');
        assert.ok(moveA.value < 0,
            `winning defender must demand payment, offered ${moveA.value}`);

        const engineB = mockEngine({ bid: 'Frog', trumpSuit: 'H', hands: { DefB: monsterHand } });
        const moveB = strategy.calculateInsuranceMove(engineB, { playerName: 'DefB' });
        assert.ok(moveB && moveB.value < 0);
        assert.ok(moveA.value + moveB.value < 0,
            'sum of winning defenders’ offers must stay below an ask of 0');
        pass(`Winning defenders demand payment (${moveA.value}, ${moveB.value}); no free escape at ask 0.`);
    }

    // 4) A crushed defender pays to cap the loss — but bounded by clamp and
    //    never more than the engine allows.
    {
        const engine = mockEngine({ bid: 'Heart Solo', trumpSuit: 'H', hands: { DefA: junkHand } });
        const move = strategy.calculateInsuranceMove(engine, { playerName: 'DefA' });
        assert.ok(move, 'expected a quote');
        assert.strictEqual(move.settingType, 'defenderOffer');
        assert.ok(move.value > 0, `crushed defender should pay to cap losses, got ${move.value}`);
        assert.ok(move.value <= 180, 'offer beyond the engine clamp');
        assert.strictEqual(move.value % 5, 0);
        pass(`Crushed defender pays ${move.value} to cap a Heart Solo blowout.`);
    }

    // 5) Survival guard: a defender near elimination never deals itself out.
    {
        const engine = mockEngine({
            bid: 'Heart Solo', trumpSuit: 'H', hands: { DefA: junkHand },
            scores: { Bidder: 200, DefA: 20, DefB: 140 },
        });
        const move = strategy.calculateInsuranceMove(engine, { playerName: 'DefA' });
        if (move) {
            assert.ok(move.value <= 15,
                `defender at 20 points must not pay ${move.value} and eliminate itself`);
        }
        pass('A defender near elimination never deals itself out of the game.');
    }

    // 6) The 4-player sitting dealer (not a party to insurance) gets no quote.
    {
        const engine = mockEngine({ hands: { Bidder: monsterHand } });
        engine.players[4] = { userId: 4, playerName: 'Dealer4', isBot: true };
        const move = strategy.calculateInsuranceMove(engine, { playerName: 'Dealer4' });
        assert.strictEqual(move, null);
        pass('A seat outside the round receives no insurance quote.');
    }

    // 7) No quotes after trick 8 (parity with the legacy strategy).
    {
        const engine = mockEngine({ hands: { Bidder: monsterHand } });
        engine.tricksPlayedCount = 8;
        assert.strictEqual(strategy.calculateInsuranceMove(engine, { playerName: 'Bidder' }), null);
        pass('No insurance changes after trick 8.');
    }

    // ------------------------------------------------------------------
    // Estimator internals.

    // 8) Bounds and determinism.
    {
        const engine = mockEngine({ hands: { Bidder: monsterHand } });
        const view = buildPublicView(engine, 'Bidder');
        const est1 = estimateBidderPoints(view, { rollouts: 80, seed: 42 });
        const est2 = estimateBidderPoints(view, { rollouts: 80, seed: 42 });
        assert.deepStrictEqual(est1.samples, est2.samples, 'same seed must reproduce');
        assert.ok(est1.samples.every(v => v >= 0 && v <= 120), 'points must stay within 0..120');
        assert.ok(est1.mean > 60, `monster Solo hand should project above 60, got ${est1.mean.toFixed(1)}`);
        pass(`Estimator is deterministic under a seed and in-bounds (monster mean ${est1.mean.toFixed(1)}).`);
    }

    // 9) The estimate responds to hand strength in the right direction.
    {
        const engineWeak = mockEngine({ bidderId: 2, bid: 'Frog', trumpSuit: 'H', hands: { DefB: junkHand } });
        // DefB defends with junk: the bidder's projected points should exceed
        // what the same seat projects when DefB holds the monster defense.
        const weakView = buildPublicView(engineWeak, 'DefB');
        const engineStrong = mockEngine({ bidderId: 2, bid: 'Frog', trumpSuit: 'H', hands: { DefB: monsterHand } });
        const strongView = buildPublicView(engineStrong, 'DefB');
        const weakDef = estimateBidderPoints(weakView, { rollouts: 120, seed: 7 });
        const strongDef = estimateBidderPoints(strongView, { rollouts: 120, seed: 7 });
        assert.ok(weakDef.mean > strongDef.mean + 10,
            `bidder should project higher vs junk defense (${weakDef.mean.toFixed(1)}) than vs monster defense (${strongDef.mean.toFixed(1)})`);
        pass('Bidder projection falls when the defense holds the cards.');
    }

    // 10) Void inference: failing to follow marks the lead-suit void, and a
    //     non-trump discard marks the trump void too.
    {
        const engine = mockEngine({ hands: { Bidder: monsterHand.slice(0, 10) } });
        // Trick 1: Bidder led AD; DefA followed 6D... DefB threw 6C (no D, and
        // no trump S either, else they would have had to play it).
        engine.capturedTricks = {
            Bidder: [{ trickNumber: 1, cards: ['AD', '6D', '6C'], winnerName: 'Bidder' }],
        };
        engine.tricksPlayedCount = 1;
        engine.bidderCardPoints = 11;
        engine.trickLeaderId = 1;
        const view = buildPublicView(engine, 'Bidder');
        assert.ok(view.voids.DefB.has('D'), 'DefB must be marked void in diamonds');
        assert.ok(view.voids.DefB.has('S'), 'DefB sluffed off-suit, so trump void too');
        assert.ok(!view.voids.DefA.has('D'), 'DefA followed suit; no void');
        assert.strictEqual(view.playedBy.DefA[0], '6D', 'leader-chain attribution');
        pass('Void inference and seat attribution from the public trick history.');
    }

    // 11) Sampled worlds respect the public card accounting: no duplicated
    //     cards, correct hand sizes, and voids honored.
    {
        const { sampleWorld, makeRng } = require('../src/core/bot-strategies/RolloutEstimator');
        const engine = mockEngine({ hands: { Bidder: monsterHand.slice(0, 10) } });
        engine.capturedTricks = {
            Bidder: [{ trickNumber: 1, cards: ['AD', '6D', '6C'], winnerName: 'Bidder' }],
        };
        engine.tricksPlayedCount = 1;
        engine.bidderCardPoints = 11;
        const view = buildPublicView(engine, 'Bidder');
        const rng = makeRng(99);
        for (let i = 0; i < 25; i++) {
            const world = sampleWorld(view, rng);
            const all = [
                ...world.hands.Bidder, ...world.hands.DefA, ...world.hands.DefB,
                ...world.widow,
            ];
            assert.strictEqual(new Set(all).size, all.length, 'no duplicate cards in a world');
            assert.strictEqual(world.hands.DefA.length, 10);
            assert.strictEqual(world.hands.DefB.length, 10);
            assert.strictEqual(world.widow.length, 3);
            assert.ok(world.hands.DefB.every(c => !c.endsWith('D') && !c.endsWith('S')),
                'sampled DefB hand must honor inferred voids');
        }
        pass('Sampled worlds honor card accounting, hand sizes, and voids.');
    }

    // 12) Frog: the revealed widow stays on the bidder's side of the deal.
    {
        const { sampleWorld, makeRng } = require('../src/core/bot-strategies/RolloutEstimator');
        const widow = ['AD', '10D', '6C'];
        const defHand = remainingDeck(widow).slice(0, 11);
        const engine = mockEngine({
            bid: 'Frog', trumpSuit: 'H',
            hands: { DefA: defHand },
            overrides: { revealedWidowForFrog: widow },
        });
        const view = buildPublicView(engine, 'DefA');
        const rng = makeRng(5);
        for (let i = 0; i < 25; i++) {
            const world = sampleWorld(view, rng);
            for (const card of widow) {
                assert.ok(
                    world.hands.Bidder.includes(card) || world.frogDiscards.includes(card),
                    `revealed widow card ${card} must be in the bidder's hand or discards`);
            }
            assert.strictEqual(world.frogDiscards.length, 3);
            assert.strictEqual(world.hands.Bidder.length, 11);
        }
        pass('Frog worlds keep the revealed widow on the bidder’s side.');
    }

    console.log('✅ All MarketInsuranceStrategy tests passed!');
}

if (require.main === module) {
    runMarketInsuranceTests();
}

module.exports = runMarketInsuranceTests;
