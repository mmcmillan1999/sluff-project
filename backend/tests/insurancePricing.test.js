// backend/tests/insurancePricing.test.js
//
// The Sept 2026 insurance pricing rule (insurancePricing.informedQuote): a bot
// prices the PERSON on the other side, not only the round. In production the
// older rule gave humans 13.1 points a deal — a failing human bidder escaped
// for a seventh of what the cards would have cost, and a bot holding a winning
// bid sold it for 60 cents on the dollar — because a human knows their own
// hand and only says yes when the bot's quote is wrong in their favour. These
// tests pin what the new rule refuses to do, what it still agrees to, the
// measured estimator correction it prices from, and the live strategy that
// carries it (whole points, no stale quote, public information only).

'use strict';

const assert = require('node:assert/strict');
const pricing = require('../src/core/bot-strategies/insurancePricing');
const MarketInsuranceStrategy = require('../src/core/bot-strategies/MarketInsuranceStrategy');
const { insuranceLimits } = require('../src/core/insuranceLimits');
const { deck } = require('../src/core/constants');

// A bell of final bidder points around `mean`.
const bell = (mean, sd, n = 161) => Array.from({ length: n }, (_, k) => (
    Math.max(0, Math.min(120, mean + sd * pricing.normalQuantile((k + 0.5) / n)))
));
const limitsFor = (isBidder, m = 1, stack = 120) => insuranceLimits({ multiplier: m, stack, isBidder });

const NAMES = { 1: 'Bidder', 2: 'DefA', 3: 'DefB' };
function mockEngine({ bid = 'Solo', trumpSuit = 'S', hands, scores = { Bidder: 120, DefA: 120, DefB: 120 }, tricksPlayedCount = 0 }) {
    const multiplier = { Frog: 1, Solo: 2, 'Heart Solo': 3 }[bid];
    return {
        players: Object.fromEntries(Object.entries(NAMES).map(([id, playerName]) => [id, { userId: Number(id), playerName, isBot: true }])),
        playerOrder: { turnOrder: [1, 2, 3] },
        playerMode: 3,
        state: 'Playing Phase',
        bidWinnerInfo: { userId: 1, playerName: 'Bidder', bid },
        trumpSuit,
        trumpBroken: false,
        hands,
        capturedTricks: {},
        currentTrickCards: [],
        lastCompletedTrick: null,
        tricksPlayedCount,
        bidderCardPoints: 0,
        defenderCardPoints: 0,
        trickLeaderId: 1,
        revealedWidowForFrog: [],
        widowDiscardsForFrogBidder: [],
        scores: { ...scores, ScoreAbsorber: 120 },
        insurance: {
            isActive: true,
            bidMultiplier: multiplier,
            bidderPlayerName: 'Bidder',
            bidderRequirement: 120 * multiplier,
            defenderOffers: { DefA: -60 * multiplier, DefB: -60 * multiplier },
            dealExecuted: false,
            executedDetails: null,
        },
    };
}

function trapPrivateInfo(engine, botName) {
    engine.hands = new Proxy(engine.hands, {
        get(target, prop) {
            if (typeof prop === 'string' && prop !== botName && Object.values(NAMES).includes(prop)) throw new Error(`ILLEGAL READ: hand of ${prop}`);
            return target[prop];
        },
    });
    for (const key of ['widow', 'originalDealtWidow']) {
        Object.defineProperty(engine, key, { get() { throw new Error(`ILLEGAL READ: ${key}`); } });
    }
    return engine;
}

async function runInsurancePricingTests() {
    console.log('Running insurance pricing tests...');
    let testCounter = 1;
    const pass = (name) => console.log(`  ✔ Test ${testCounter++}: ${name}`);

    // 1) Leak two: a winning bot bidder does not sell. A made bid is zero-sum
    //    between bidder and defenders, so a counterparty who knows the result
    //    only buys it for less than it is worth.
    {
        for (const m of [1, 2, 3]) {
            const priced = pricing.informedQuote({ samples: bell(82, 9), m, isBidder: true, limits: limitsFor(true, m), informed: 1, minEdge: 1 });
            assert.equal(priced.agreeable, false, `x${m}: nothing worth asking`);
            assert.equal(priced.quote, 120 * m, 'so the ask stays at the unagreeable default');
        }
        // The market rule ALWAYS had an ask standing, sliding toward the
        // hand's average worth (88 here) as its margin decayed: 105 at the
        // deal, 90 by trick 7. Fair on average — and a defender who knows the
        // hand is worth 110 takes 90 every time, while one who knows it is
        // worth 70 never does. That is the whole leak.
        const asks = [0, 4, 7].map(t => pricing.marketQuote({ samples: bell(82, 9), m: 2, isBidder: true, tricksPlayed: t, limits: limitsFor(true, 2) }));
        assert.ok(asks[0] > asks[1] && asks[1] > asks[2], `its ask slides down through the round (${asks.join(', ')})`);
        assert.ok(asks[2] >= 85 && asks[2] <= 95, `to about the average worth of 88 (${asks[2]})`);
        pass(`A bot bidder holding a winner posts nothing agreeable; the old rule kept a fair-on-average ask standing (${asks.join(' → ')}).`);
    }

    // 2) Leak one: a failing bidder does not get out cheap. The cards would
    //    pay each defender S x m; the bot demands at least that, because the
    //    bidder is still saving the absorber's share.
    {
        const m = 2;
        const samples = bell(44, 8); // failing by 16 on average: each defender is owed ~32
        const priced = pricing.informedQuote({ samples, m, isBidder: false, limits: limitsFor(false, m), informed: 1, minEdge: 1 });
        assert.equal(priced.agreeable, true, 'a failing bid is the deal with real money in it for both sides');
        assert.ok(priced.quote < 0, 'the defender DEMANDS payment');
        assert.ok(-priced.quote >= 16 * m, `and demands at least its average card value (${-priced.quote} >= ${16 * m})`);
        assert.ok(priced.edge >= 1);
        const old = pricing.marketQuote({ samples, m, isBidder: false, tricksPlayed: 6, limits: limitsFor(false, m) });
        assert.ok(-old < -priced.quote, `the market rule settled for less late in the round (${-old} < ${-priced.quote})`);

        // And a defender facing a bid that is MAKING never pays to cap it: an
        // informed bidder only takes that money when the cards were worth less.
        const winning = pricing.informedQuote({ samples: bell(80, 8), m, isBidder: false, limits: limitsFor(false, m), informed: 1, minEdge: 1 });
        assert.equal(winning.agreeable, false);
        assert.equal(winning.quote, -60 * m);
        pass(`A failing bidder must pay the defenders what the cards owed them (demand ${-priced.quote} against an average ${16 * m}).`);
    }

    // 3) A failing BOT bidder pays to escape only inside the absorber's share:
    //    never more than the cards would cost, in expectation.
    {
        const m = 1;
        const samples = bell(40, 6); // failing by ~20: cards cost ~60, defenders are owed ~40 between them
        const priced = pricing.informedQuote({ samples, m, isBidder: true, limits: limitsFor(true, m), informed: 1, minEdge: 1 });
        assert.equal(priced.agreeable, true);
        assert.ok(priced.quote < 0, 'a negative ask: the bidder pays');
        assert.ok(-priced.quote < 3 * 20 * m, `pays less than the cards would cost (${-priced.quote} < 60)`);
        assert.ok(-priced.quote > 2 * 20 * m * 0.7, `and enough that defenders who know the result would take it (${-priced.quote})`);
        pass(`A failing bot bidder buys its way out for ${-priced.quote}, inside the absorber's share.`);
    }

    // 4) The less the counterparty is assumed to know, the more the bot deals.
    {
        const samples = bell(66, 12);
        const edges = [1, 0.5, 0].map(informed => pricing.informedQuote({ samples, m: 1, isBidder: true, limits: limitsFor(true), informed, minEdge: 0.1 }));
        assert.equal(edges[0].agreeable, false, 'against someone who knows the result a made bid is not for sale');
        assert.equal(edges[2].agreeable, true, 'against someone who knows nothing more than the bot, it is');
        assert.ok(edges[2].edge > edges[1].edge);
        pass('`informed` is the dial between "never picked off" and "always trading".');
    }

    // 5) Whole points, inside the seat's limits, stack limit included.
    {
        const samples = bell(47, 7);
        const priced = pricing.informedQuote({ samples, m: 1, isBidder: false, limits: limitsFor(false), informed: 1, minEdge: 1 });
        assert.ok(Number.isInteger(priced.quote));
        const many = [38, 41, 44, 47, 50].map(mean => pricing.informedQuote({ samples: bell(mean, 7), m: 1, isBidder: false, limits: limitsFor(false), informed: 1, minEdge: 1 }).quote);
        assert.ok(many.some(quote => quote % 5 !== 0), `quotes are not held to steps of five (${many.join(', ')})`);

        // A failing bot bidder holding 9 points can put up 8, no more.
        const short = pricing.informedQuote({ samples: bell(40, 6), m: 1, isBidder: true, limits: limitsFor(true, 1, 9), informed: 1, minEdge: 1 });
        assert.ok(short.quote >= -8, `never more than every point but its last (${short.quote})`);
        pass('Quotes are whole points inside the seat’s limits — nobody offers more than they hold.');
    }

    // 6) The measured correction: a defender's estimate is moved UP (it
    //    underrates the bidder) and widened mid-round; a bidder's is widened.
    {
        const early = pricing.estimatorCorrection({ isBidder: false, bidType: 'Heart Solo', tricksPlayed: 0 });
        assert.deepEqual(early, { shift: 10.1, extraSd: 0 });
        const mid = pricing.estimatorCorrection({ isBidder: true, bidType: 'Solo', tricksPlayed: 6 });
        assert.deepEqual(mid, { shift: 0, extraSd: 6.2 });
        assert.deepEqual(pricing.estimatorCorrection({ isBidder: false, bidType: 'Nonsense', tricksPlayed: 3 }), { shift: 0, extraSd: 0 });
        assert.deepEqual(pricing.estimatorCorrection({ isBidder: false, bidType: 'Frog', tricksPlayed: 99 }), { shift: 0.4, extraSd: 5.5 });

        const samples = bell(60, 3);
        const widened = pricing.stats(pricing.adjustSamples(samples, { shift: 5, extraSd: 4 }));
        assert.ok(Math.abs(widened.mean - 65) < 0.2, `shifted to ${widened.mean}`);
        assert.ok(Math.abs(widened.sd - 5) < 0.3, `variances add: sqrt(3^2 + 4^2) = 5, got ${widened.sd}`);
        // A bidder late in the round: every rollout agrees, yet the truth does not.
        const certain = pricing.stats(pricing.adjustSamples(new Array(161).fill(72), { shift: 0, extraSd: 6 }));
        assert.ok(Math.abs(certain.mean - 72) < 0.2 && Math.abs(certain.sd - 6) < 0.4, `a spike becomes a bell of the model error (${certain.sd})`);
        assert.equal(pricing.adjustSamples(samples, { shift: 0, extraSd: 0 }), samples, 'no correction, no copy');
        assert.ok(Math.abs(pricing.normalQuantile(0.975) - 1.96) < 0.001);
        pass('The estimator correction shifts a defender’s view of the bidder and restores the spread the rollouts hide.');
    }

    // 7) The live strategy: informed by default, public information only,
    //    whole points, and the market rule still there as the rollback.
    {
        assert.equal(new MarketInsuranceStrategy().pricing, 'informed', 'the default rule');
        // alwaysQuote off: what the bot WANTS, with no courtesy price (test 10).
        const strategy = new MarketInsuranceStrategy(null, null, { rollouts: 120, alwaysQuote: false });
        const monsterHand = ['AS', '10S', 'KS', 'QS', 'JS', '9S', 'AH', '10H', 'AC', '10C', 'AD'];
        const junkHand = ['6S', '7S', '6H', '7H', '8H', '6C', '7C', '6D', '7D', '8D', '9D'];
        const rest = deck.filter(card => !monsterHand.includes(card) && !junkHand.includes(card));
        const hands = { Bidder: monsterHand, DefA: junkHand, DefB: rest.slice(0, 11) };

        // A dominating bot bidder: the old rule asked for a discount on its
        // winner; this one leaves the ask where it is.
        const asBidder = trapPrivateInfo(mockEngine({ hands: { ...hands } }), 'Bidder');
        assert.equal(strategy.calculateInsuranceMove(asBidder, { playerName: 'Bidder' }), null, 'nothing to change: the ask stays at the default');
        const market = new MarketInsuranceStrategy(null, null, { rollouts: 120, pricing: 'market' });
        const sold = market.calculateInsuranceMove(mockEngine({ hands: { ...hands } }), { playerName: 'Bidder' });
        assert.equal(sold.settingType, 'bidderRequirement');
        assert.ok(sold.value < 240, 'the rollback rule still quotes');

        // A defender being crushed does not pay to cap it...
        const asDefender = trapPrivateInfo(mockEngine({ hands: { ...hands } }), 'DefA');
        assert.equal(strategy.calculateInsuranceMove(asDefender, { playerName: 'DefA' }), null);
        // ...and one facing a bidder with nothing demands to be paid, in whole points.
        const weakBidder = { Bidder: junkHand, DefA: monsterHand, DefB: rest.slice(0, 11) };
        const demand = strategy.calculateInsuranceMove(trapPrivateInfo(mockEngine({ hands: { ...weakBidder } }), 'DefA'), { playerName: 'DefA' });
        assert.equal(demand.settingType, 'defenderOffer');
        assert.ok(demand.value < 0 && demand.value > -120, `demands payment inside the range (${demand.value})`);
        assert.ok(Number.isInteger(demand.value));
        pass(`The live strategy prices by the informed rule from public information only (a crushing defender demands ${-demand.value}).`);
    }

    // 8) No stale quote: from trick 10 the quote comes DOWN, where the old
    //    rule stopped updating at trick 8 and left its last quote standing.
    {
        const strategy = new MarketInsuranceStrategy(null, null, { rollouts: 120 });
        const junkHand = ['6S', '7S'];
        const late = mockEngine({ hands: { Bidder: junkHand, DefA: ['AS', 'KS'], DefB: ['QS', 'JS'] }, tricksPlayedCount: 10 });
        late.insurance.defenderOffers.DefA = -37; // what it had standing
        const move = strategy.calculateInsuranceMove(late, { playerName: 'DefA' });
        assert.deepEqual(move, { settingType: 'defenderOffer', value: -120 }, 'withdrawn to the unagreeable default');
        late.insurance.defenderOffers.DefA = -120;
        assert.equal(strategy.calculateInsuranceMove(late, { playerName: 'DefA' }), null, 'and then it stands still');

        const market = new MarketInsuranceStrategy(null, null, { rollouts: 120, pricing: 'market' });
        const stale = mockEngine({ hands: { Bidder: junkHand, DefA: ['AS', 'KS'], DefB: ['QS', 'JS'] }, tricksPlayedCount: 9 });
        stale.insurance.defenderOffers.DefA = -37;
        assert.equal(market.calculateInsuranceMove(stale, { playerName: 'DefA' }), null, 'the old rule leaves -37 on the table for tricks 9-11');
        pass('When a bot stops quoting it takes its quote down.');
    }

    // 9) A price is only as good as it is fresh. While a finished trick
    //    lingers on the felt the engine still takes insurance changes — and a
    //    human has just learned something — so bots re-quote there too, and a
    //    move that makes a bot's quote LESS generous lands at once. Only a
    //    move that gives ground waits out the human-like pause.
    {
        const GameService = require('../src/services/GameService');
        const GameEngine = require('../src/core/GameEngine');
        const { createGameServiceWithoutHeartbeat, withControlledTimeouts } = require('./test-helpers');
        const io = { sockets: { sockets: new Map() }, to() { return { emit() {} }; }, emit() {} };
        const service = createGameServiceWithoutHeartbeat(GameService, io, { query: async () => ({ rows: [], rowCount: 0 }) });

        const engine = new GameEngine('insurance-fresh-test', 'fort-creek', 'Fresh Quote Test');
        engine.joinTable({ id: 1, username: 'Alice' }, 's1');
        [[2, 'Bob'], [3, 'Carol']].forEach(([id, name]) => {
            engine.players[id] = { userId: id, playerName: name, isBot: true, isSpectator: false, disconnected: false, socketId: null };
            engine.bots[id] = { userId: id, playerName: name };
        });
        engine.gameStarted = true;
        engine.gameId = null; // no analytics rows
        engine.playerOrder = { allIds: [1, 2, 3], turnOrder: [1, 2, 3], count: 3 };
        engine.scores = { Alice: 100, Bob: 100, Carol: 100 };
        engine.bidWinnerInfo = { userId: 1, playerName: 'Alice', bid: 'Solo' };
        engine.trumpSuit = 'S';
        engine.state = 'TrickCompleteLinger';
        engine.insurance = {
            isActive: true, bidMultiplier: 2, bidderPlayerName: 'Alice', bidderRequirement: 240,
            defenderOffers: { Bob: -20, Carol: -80 }, dealExecuted: false, executedDetails: null,
        };
        service.engines[engine.tableId] = engine;
        assert.equal(service.getEngineById(engine.tableId), engine);

        // Bob's new price is a harder demand (tightens); Carol's gives ground.
        service.marketInsurance = {
            calculateInsuranceMove: (_engine, bot) => ({ settingType: 'defenderOffer', value: bot.playerName === 'Bob' ? -50 : -60 }),
        };
        assert.equal(service._insuranceTightens(engine, { playerName: 'Bob' }, { settingType: 'defenderOffer', value: -50 }), true);
        assert.equal(service._insuranceTightens(engine, { playerName: 'Carol' }, { settingType: 'defenderOffer', value: -60 }), false);
        assert.equal(service._insuranceTightens(engine, { playerName: 'Alice' }, { settingType: 'bidderRequirement', value: 241 }), true);

        await withControlledTimeouts(async ({ timers, runNext }) => {
            service._triggerBots(engine.tableId);
            for (let i = 0; i < 6; i += 1) await Promise.resolve();
            assert.equal(engine.insurance.defenderOffers.Bob, -50, 'the harder demand is on the table before any timer runs');
            assert.equal(engine.insurance.defenderOffers.Carol, -80, 'the softer one is still waiting');
            assert.equal(timers.length, 1, 'one pause, for the move that gives ground');
            await runNext();
            assert.equal(engine.insurance.defenderOffers.Carol, -60);
        });
        pass('Bots re-quote while a trick lingers, tighten at once, and only loosen after a pause.');
    }

    // 10) Always a price on the table. The first live game under the rule had
    //     a human making a Heart Solo and two bot defenders sitting at the
    //     default for seven tricks: right, and no fun. With a loss budget the
    //     bot shows the friendliest price it can afford — stingy, never free.
    {
        const m = 2;
        const making = bell(80, 8); // making by 20: the cards cost each defender ~40
        const limits = limitsFor(false, m);
        const budget = 0.25 * m;
        const silent = pricing.informedQuote({ samples: making, m, isBidder: false, limits });
        assert.equal(silent.agreeable, false, 'without a budget there is nothing to say');
        const shown = pricing.informedQuote({ samples: making, m, isBidder: false, limits, lossBudget: budget });
        assert.equal(shown.agreeable, true, 'with one there is a price up');
        assert.ok(shown.quote > -60 * m && shown.quote < 20 * m, `a real offer, under the ~${20 * m} the cards would cost (${shown.quote})`);
        assert.ok(shown.edge >= -budget - 1e-9, `someone who KNOWS the result takes at most the budget off it (${shown.edge.toFixed(2)})`);

        // The safety margin backs the price off by exactly that, each seat in
        // its own direction: a defender offers less, a bidder asks more.
        const safe = pricing.informedQuote({ samples: making, m, isBidder: false, limits, lossBudget: budget, safety: 10 * m });
        assert.equal(safe.quote, shown.quote - 10 * m);
        const bareAsk = pricing.informedQuote({ samples: making, m, isBidder: true, limits: limitsFor(true, m), lossBudget: budget });
        const ask = pricing.informedQuote({ samples: making, m, isBidder: true, limits: limitsFor(true, m), lossBudget: budget, safety: 20 * m });
        assert.equal(ask.quote, bareAsk.quote + 20 * m);
        assert.ok(ask.quote > 2 * 20 * m && ask.quote < 120 * m, `a winning bot bidder names a price above the ~${2 * 20 * m} it is worth (${ask.quote})`);

        // The price closes on fair value as the round resolves...
        const [early, late] = [14, 3].map(sd => pricing.informedQuote({ samples: bell(80, sd), m, isBidder: false, limits, lossBudget: budget, safety: 10 * m }).quote);
        assert.ok(late > early, `stingy early, nearer the truth late (${early} → ${late})`);

        // ...and never costs the bot a deal it wants: against a failing bidder
        // the friendly price is at least as easy to meet as the wanted one, no
        // stingier, and gives up no more than the budget to be so.
        const failing = bell(44, 8);
        const wanted = pricing.informedQuote({ samples: failing, m, isBidder: false, limits });
        const friendly = pricing.informedQuote({ samples: failing, m, isBidder: false, limits, lossBudget: budget, safety: 10 * m });
        assert.equal(wanted.agreeable, true);
        assert.ok(friendly.quote >= wanted.quote, `${friendly.quote} >= ${wanted.quote}`);
        assert.ok(friendly.edge >= wanted.edge - budget - 1e-9);
        pass(`With nothing it wants, a bot still shows a price: offers ${safe.quote} where the cards would cost ~${20 * m}, asks ${ask.quote} for a hand worth ~${2 * 20 * m}.`);
    }

    // 11) The live strategy carries it: on by default, both seats quote where
    //     test 7's bots sat still, dearer than the old market rule's prices,
    //     and a re-price too small to matter is not sent.
    {
        const strategy = new MarketInsuranceStrategy(null, null, { rollouts: 120 });
        assert.equal(strategy.alwaysQuote, true);
        const market = new MarketInsuranceStrategy(null, null, { rollouts: 120, pricing: 'market' });
        // A fair Solo, not test 7's monster: that hand's price is above the
        // cap, and a bot whose price is off the scale rightly sits at the default.
        const goodHand = ['AS', 'KS', 'QS', '9S', '7S', 'AH', 'KH', '7C', '8C', 'QD', '6D'];
        const junkHand = ['6S', '8S', '6H', '7H', '8H', '6C', '9C', '7D', '8D', '9D', 'JD'];
        const rest = deck.filter(card => !goodHand.includes(card) && !junkHand.includes(card));
        const hands = { Bidder: goodHand, DefA: junkHand, DefB: rest.slice(0, 11) };

        const ask = strategy.calculateInsuranceMove(trapPrivateInfo(mockEngine({ hands: { ...hands } }), 'Bidder'), { playerName: 'Bidder' });
        const soldFor = market.calculateInsuranceMove(mockEngine({ hands: { ...hands } }), { playerName: 'Bidder' }).value;
        assert.equal(ask.settingType, 'bidderRequirement');
        assert.ok(ask.value < 240, `the bidder names a price (${ask.value})`);
        assert.ok(ask.value > soldFor, `dearer than the old rule sold for (${ask.value} > ${soldFor})`);

        const offer = strategy.calculateInsuranceMove(trapPrivateInfo(mockEngine({ hands: { ...hands } }), 'DefA'), { playerName: 'DefA' });
        const paid = market.calculateInsuranceMove(mockEngine({ hands: { ...hands } }), { playerName: 'DefA' }).value;
        assert.equal(offer.settingType, 'defenderOffer');
        assert.ok(offer.value > -120 && offer.value < paid, `the defender has a price up, below what the old rule paid (${offer.value} < ${paid})`);

        // Already standing a point away from the fresh price: not worth a move.
        const near = mockEngine({ hands: { ...hands } });
        near.insurance.defenderOffers.DefA = offer.value + 1;
        assert.equal(strategy.calculateInsuranceMove(near, { playerName: 'DefA' }), null);
        pass(`Live bots keep a price up: the bidder asks ${ask.value} (old rule ${soldFor}), the defender offers ${offer.value} (old rule ${paid}).`);
    }

    console.log('All insurance pricing tests passed.');
}

if (require.main === module) {
    runInsurancePricingTests().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}

module.exports = runInsurancePricingTests;
