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
        assert.deepEqual(early, { shift: 8.9, extraSd: 0 });
        const mid = pricing.estimatorCorrection({ isBidder: true, bidType: 'Solo', tricksPlayed: 6 });
        assert.deepEqual(mid, { shift: -0.4, extraSd: 3.7 });
        assert.deepEqual(pricing.estimatorCorrection({ isBidder: false, bidType: 'Nonsense', tricksPlayed: 3 }), { shift: 0, extraSd: 0 });
        // The last tricks each have their own column: the error shrinks fast there.
        const late = [8, 9, 10, 99].map(tricksPlayed => pricing.estimatorCorrection({ isBidder: false, bidType: 'Frog', tricksPlayed }).extraSd);
        assert.deepEqual(late, [6.5, 5.2, 3.1, 3.1]);
        // A table measured with fewer columns reads its last one for the rest.
        const five = { defender: { Frog: { shift: [1, 2, 3, 4, 5], extraSd: [0, 0, 0, 0, 9] } }, bidder: {} };
        assert.deepEqual(pricing.estimatorCorrection({ isBidder: false, bidType: 'Frog', tricksPlayed: 10, table: five }), { shift: 5, extraSd: 9 });

        const samples = bell(60, 3);
        const widened = pricing.stats(pricing.adjustSamples(samples, { shift: 5, extraSd: 4 }));
        assert.ok(Math.abs(widened.mean - 65) < 0.2, `shifted to ${widened.mean}`);
        assert.ok(Math.abs(widened.sd - 5) < 0.3, `variances add: sqrt(3^2 + 4^2) = 5, got ${widened.sd}`);
        // A bidder late in the round: every rollout agrees, yet the truth does not.
        const certain = pricing.stats(pricing.adjustSamples(new Array(161).fill(72), { shift: 0, extraSd: 6 }));
        assert.ok(Math.abs(certain.mean - 72) < 0.2 && Math.abs(certain.sd - 6) < 0.4, `a spike becomes a bell of the model error (${certain.sd})`);
        assert.equal(pricing.adjustSamples(samples, { shift: 0, extraSd: 0 }), samples, 'no correction, no copy');
        // No correction may imagine a result the banked points rule out.
        const bounded = pricing.adjustSamples(bell(66, 3), { shift: 5, extraSd: 6 }, { lo: 58, hi: 70 });
        assert.ok(Math.min(...bounded) >= 58 && Math.max(...bounded) <= 70, 'held inside what is still possible');
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
        // ...and one facing a bidder who is coming up short demands to be paid, in
        // whole points. (Against a bidder with NOTHING the demand is the cap,
        // which is also where an untouched offer sits.)
        const shortHand = ['KS', 'QS', '9S', '8S', '6S', 'KH', '7H', 'QC', '8C', 'JD', '7D'];
        const solidHand = ['AS', '10S', 'AH', 'KC', '9C', '10D', '9D', '8H', '9H', '6C', '7C'];
        const others = deck.filter(card => !shortHand.includes(card) && !solidHand.includes(card));
        const weakBidder = { Bidder: shortHand, DefA: solidHand, DefB: others.slice(0, 11) };
        const demand = strategy.calculateInsuranceMove(trapPrivateInfo(mockEngine({ hands: { ...weakBidder } }), 'DefA'), { playerName: 'DefA' });
        assert.equal(demand.settingType, 'defenderOffer');
        assert.ok(demand.value < 0 && demand.value > -120, `demands payment inside the range (${demand.value})`);
        assert.ok(Number.isInteger(demand.value));
        pass(`The live strategy prices by the informed rule from public information only (a defender facing a short bidder demands ${-demand.value}).`);
    }

    // 8) No stale quote, and no withdrawn one. The old market rule stopped
    //    updating at trick 8 and left its last quote standing; the first
    //    informed rule took its quote DOWN at trick 10. Matt, Sept 17: "I don't
    //    want them to withdraw their bid... we hone in on a fair offer as it
    //    gets closer to the end." Whole seeded rounds, a bot in every seat, the
    //    two defenders pricing on every card as they do live:
    {
        const sim = require('../scripts/simulate-brains');
        const { makeRng } = require('../src/core/bot-strategies/RolloutEstimator');
        const strategy = new MarketInsuranceStrategy(null, null, { rollouts: 120 });
        const realLog = console.log;
        const realRandom = Math.random;
        const gaps = { early: [], late: [] };
        let lastTrickQuotes = 0; let lastTrickStates = 0; let rounds = 0;
        console.log = () => {};
        try {
            for (let seed = 1; rounds < 8 && seed < 40; seed += 1) {
                Math.random = makeRng(424242 + seed);
                const engine = sim.buildEngine(sim.seats('counting', 'counting', 'counting'));
                const seen = [];
                for (let step = 0; step < 2000; step += 1) {
                    const state = engine.state;
                    if (state === 'Awaiting Next Round Trigger' || state === 'Game Over') break;
                    if (state === 'Dealing Pending') engine.dealCards(engine.dealer);
                    else if (state === 'Bidding Phase') engine.placeBid(engine.biddingTurnPlayerId, engine.bots[engine.biddingTurnPlayerId].decideBid());
                    else if (state === 'Awaiting Frog Upgrade Decision') engine.placeBid(engine.biddingTurnPlayerId, engine.bots[engine.biddingTurnPlayerId].decideFrogUpgrade());
                    else if (state === 'AllPassWidowReveal') engine._advanceRound();
                    else if (state === 'Trump Selection') engine.chooseTrump(engine.bidWinnerInfo.userId, engine.bots[engine.bidWinnerInfo.userId].chooseTrump());
                    else if (state === 'Frog Widow Exchange') engine.submitFrogDiscards(engine.bidWinnerInfo.userId, engine.bots[engine.bidWinnerInfo.userId].submitFrogDiscards());
                    else if (state === 'Bid Announcement') engine.state = 'Playing Phase';
                    else if (state === 'TrickCompleteLinger') {
                        engine.currentTrickCards = []; engine.leadSuitCurrentTrick = null;
                        engine.trickTurnPlayerId = engine.trickLeaderId; engine.state = 'Playing Phase';
                    } else if (state === 'Playing Phase') {
                        const ins = engine.insurance;
                        if (ins?.isActive && !ins.dealExecuted) {
                            // The bidder's seat plays the human who never touches the ask.
                            for (const name of Object.keys(ins.defenderOffers)) {
                                const move = strategy.calculateInsuranceMove(engine, { playerName: name });
                                if (move) ins.defenderOffers[name] = move.value;
                            }
                            const offers = Object.values(ins.defenderOffers);
                            seen.push({ t: engine.tricksPlayedCount || 0, sum: offers[0] + offers[1], m: ins.bidMultiplier, atDefault: offers.every(o => o === -60 * ins.bidMultiplier) });
                        }
                        engine.playCard(engine.trickTurnPlayerId, engine.bots[engine.trickTurnPlayerId].playCard());
                    } else throw new Error(`unexpected state ${state}`);
                }
                const round = engine.roundHistory[0];
                if (!round || seen.length === 0) continue;
                rounds += 1;
                const fair = pricing.bidderCardValue(round.bidderCardPoints - 60, seen[0].m);
                for (const s of seen) {
                    if (s.t <= 1) gaps.early.push(Math.abs(fair - s.sum) / s.m);
                    if (s.t === 10) { gaps.late.push(Math.abs(fair - s.sum) / s.m); lastTrickStates += 1; if (!s.atDefault) lastTrickQuotes += 1; }
                }
            }
        } finally {
            console.log = realLog;
            Math.random = realRandom;
        }
        const avg = (v) => v.reduce((s, x) => s + x, 0) / v.length;
        assert.ok(rounds >= 6, `played ${rounds} rounds`);
        assert.ok(lastTrickQuotes >= 0.8 * lastTrickStates, `a real price is still up on the last trick (${lastTrickQuotes} of ${lastTrickStates} states)`);
        assert.ok(avg(gaps.late) < 0.35 * avg(gaps.early), `and it has closed on what the cards paid: ${avg(gaps.early).toFixed(0)} per 1x away at the deal, ${avg(gaps.late).toFixed(0)} on the last trick`);

        const market = new MarketInsuranceStrategy(null, null, { rollouts: 120, pricing: 'market' });
        const stale = mockEngine({ hands: { Bidder: ['6S', '7S'], DefA: ['AS', 'KS'], DefB: ['QS', 'JS'] }, tricksPlayedCount: 9 });
        stale.insurance.defenderOffers.DefA = -37;
        assert.equal(market.calculateInsuranceMove(stale, { playerName: 'DefA' }), null, 'the old rule leaves -37 on the table for tricks 9-11');
        pass(`Bots price to the last card and home in: the two offers sit ${avg(gaps.early).toFixed(0)} per 1x from the truth at the deal and ${avg(gaps.late).toFixed(0)} on the last trick (${rounds} rounds).`);
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

    // 12) Matt's table examples, as the rule prices them.
    {
        const m = 1;
        const budget = 0.25 * m;
        // "Say I get a midnight special on a frog. If I can see the other
        //  players' points so far are 35, I know I'm going to get 25 from each
        //  of them. So I can require 50."
        const decided = pricing.informedQuote({ samples: new Array(160).fill(85), m, isBidder: true, limits: limitsFor(true, m), lossBudget: budget, safetyPerSd: 0.7, bounds: { lo: 60, hi: 85 } });
        assert.equal(decided.quote, 50, 'a decided hand is priced as decided: no spread, no margin');

        // "Three cards left, I'm the bidder of a frog, the opponents have 50.
        //  My max I should require is 20 because that is the max amount they
        //  will collectively lose." Trump splits 2-1 (I take the rest: 70) or
        //  3-0 (I lose the last trick: 62).
        const split = [...new Array(112).fill(70), ...new Array(48).fill(62)];
        const capped = pricing.informedQuote({ samples: split, m, isBidder: true, limits: limitsFor(true, m), lossBudget: budget, safetyPerSd: 0.7, bounds: { lo: 50, hi: 70 } });
        assert.ok(capped.margin > 0, 'there is a margin, because there is doubt');
        assert.ok(capped.quote <= 20, `but never more than the round can still pay (${capped.quote})`);
        const unbounded = pricing.informedQuote({ samples: split, m, isBidder: true, limits: limitsFor(true, m), lossBudget: budget, safetyPerSd: 0.7 });
        assert.ok(unbounded.quote > 20, `without the bound the margin would carry it past that (${unbounded.quote})`);

        // "In the case where the bidder will lose 10 points, his payout will
        //  be 30 since he would pay the widow. If instead he required -26 it
        //  would save them 4 points, and the defenders could get 3 extra each."
        const down10 = new Array(160).fill(50);
        const greedy = pricing.informedQuote({ samples: down10, m, isBidder: true, limits: limitsFor(true, m), lossBudget: budget });
        assert.equal(greedy.quote, -20, 'with nothing to tempt them, the bot keeps the whole absorber share');
        const shared = pricing.informedQuote({ samples: down10, m, isBidder: true, limits: limitsFor(true, m), lossBudget: budget, entice: 6 });
        assert.equal(shared.quote, -26, 'tempting each defender with 3: the deal all three want');
        assert.ok(shared.edge > 3.5, 'and the bidder still saves 4 of the 30');

        // The margin is sized to what is still unknown.
        const [wide, narrow] = [14, 3].map(sd => pricing.informedQuote({ samples: bell(80, sd), m: 2, isBidder: false, limits: limitsFor(false, 2), lossBudget: 0.5, safetyPerSd: 0.7 }).margin);
        assert.ok(wide > 4 * narrow, `${wide.toFixed(1)} points at the deal, ${narrow.toFixed(1)} late`);
        pass(`A decided Frog asks exactly 50; with 50 banked against it a bidder asks ${capped.quote}, never past 20; a bidder going down 10 offers -26 so that everyone gains.`);
    }

    // 13) The estimate it prices from deals the hidden hands without the
    //     void-order bias. The position that exposed it: last trick, the bidder
    //     holds the 9 of trump and plays second; one opponent is void in trump
    //     and spades. Five cards are unseen — two in hand, three in the widow.
    //     The old deal gave the second opponent the first one's leftover CLUB,
    //     every time, so the jack of trump was "in the widow" in every world.
    {
        const { sampleWorld, makeRng } = require('../src/core/bot-strategies/RolloutEstimator');
        const unseen = ['10C', 'JD', 'KS', 'KC', '8D'];
        const played = deck.filter(card => card !== '9D' && !unseen.includes(card));
        const view = {
            botName: 'B', bidderName: 'B', botIsBidder: true, bidType: 'Solo', trumpSuit: 'D', tricksPlayed: 10,
            activeNames: ['B', 'R', 'K'], myHand: ['9D'], playedSet: new Set(played),
            playedBy: { B: new Array(10).fill('x'), R: new Array(10).fill('x'), K: new Array(10).fill('x') },
            voids: { B: new Set(), R: new Set(['S', 'D']), K: new Set() }, frog: null,
        };
        const share = (v) => {
            const rng = makeRng(77);
            let jack = 0;
            for (let i = 0; i < 400; i += 1) if (sampleWorld(v, rng).hands.K[0] === 'JD') jack += 1;
            return jack / 400;
        };
        assert.equal(share(view), 0, 'the legacy deal (still what the raven brains sample with) never lets K hold the jack');
        const fair = share({ ...view, ...pricing.INFORMED_VIEW });
        assert.ok(fair > 0.17 && fair < 0.33, `dealt from everything that is left, K holds it about one world in four (${fair})`);
        assert.deepEqual(pricing.INFORMED_ESTIMATE, { exactTricks: 3 });
        pass(`Hidden hands are dealt without the void-order bias (the jack sits with the second opponent in ${Math.round(fair * 100)}% of worlds, not 0%).`);
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
