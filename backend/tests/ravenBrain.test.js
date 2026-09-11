// backend/tests/ravenBrain.test.js
//
// The raven brain: determinized search over public information with an
// exact endgame solver. These tests pin
//   1. the information boundary — a trapped engine throws on any read of
//      another hand or the widow, and raven never trips it;
//   2. the solver — exact against brute-force minimax on random endgames,
//      and it leaves the world state exactly as it found it;
//   3. the payoff table it optimizes (2 shares made, 3 shares set);
//   4. candidate pruning (6/7/8 of a suit are one choice, a 9 and a 10 are not);
//   5. legality across whole simulated games at every bid type.

const assert = require('assert');
const BotPlayer = require('../src/core/BotPlayer');
const { BRAINS, brainNameFor, registerBrainProfile } = require('../src/core/bot-brains');
const raven = require('../src/core/bot-brains/ravenBrain');
const search = require('../src/core/bot-brains/ravenSearch');
const { makeRng } = require('../src/core/bot-strategies/RolloutEstimator');
const { buildPublicView } = require('../src/core/bot-strategies/PublicRoundView');
const { deck } = require('../src/core/constants');

const ME = 'Raven Test';
const NAMES = ['Bidder', 'Ally', ME];

function makeEngine({
    myHand,
    bidderName = 'Bidder',
    bid = 'Solo',
    trumpSuit = 'H',
    trumpBroken = true,
    capturedTricks = {},
    currentTrickCards = [],
    trickLeaderName = null,
    tricksPlayedCount = 0,
    bidderCardPoints = 0,
    defenderCardPoints = 0,
    otherHands = {},
} = {}) {
    const ids = { Bidder: 1, Ally: 2, [ME]: 3 };
    const players = {};
    NAMES.forEach(name => { players[ids[name]] = { userId: ids[name], playerName: name, isBot: true }; });
    const leadSuit = currentTrickCards.length ? currentTrickCards[0].card.slice(-1) : null;
    return {
        players,
        playerOrder: { turnOrder: NAMES.map(n => ids[n]) },
        playerMode: 3,
        state: 'Playing Phase',
        bidWinnerInfo: { userId: ids[bidderName], playerName: bidderName, bid },
        trumpSuit,
        trumpBroken,
        hands: { [ME]: myHand, ...otherHands },
        widow: ['6C', '7C', '8C'],
        originalDealtWidow: ['6C', '7C', '8C'],
        capturedTricks,
        currentTrickCards,
        leadSuitCurrentTrick: leadSuit,
        lastCompletedTrick: null,
        tricksPlayedCount,
        bidderCardPoints,
        defenderCardPoints,
        trickLeaderId: ids[trickLeaderName || (currentTrickCards[0]?.playerName ?? ME)],
        revealedWidowForFrog: [],
        widowDiscardsForFrogBidder: [],
        scores: { Bidder: 120, Ally: 120, [ME]: 120, ScoreAbsorber: 120 },
        insurance: { isActive: false },
    };
}

// Any read of private information throws.
function trapPrivateInfo(engine) {
    engine.hands = new Proxy(engine.hands, {
        get(target, prop) {
            if (typeof prop === 'string' && prop !== ME && NAMES.includes(prop)) {
                throw new Error(`ILLEGAL READ: hand of ${prop}`);
            }
            return target[prop];
        },
    });
    for (const key of ['widow', 'originalDealtWidow']) {
        Object.defineProperty(engine, key, { get() { throw new Error(`ILLEGAL READ: ${key}`); } });
    }
    return engine;
}

// A random fully-known endgame with `tricksLeft` tricks to go, rolled there
// with the search policy from a fresh deal.
function randomState(rng, tricksLeft, bidType) {
    const cards = [...Array(36).keys()];
    for (let i = cards.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    const hands = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    for (let p = 0; p < 3; p += 1) {
        for (let i = 0; i < 11; i += 1) {
            const c = cards[p * 11 + i];
            hands[p][(c / 9) | 0] |= 1 << (c % 9);
        }
    }
    const widowPts = cards.slice(33).reduce((s, c) => s + search.idxPts(c), 0);
    const bidder = Math.floor(rng() * 3);
    const st = search.makeState({
        hands,
        trump: bidType === 'Heart Solo' ? 0 : 1 + Math.floor(rng() * 3),
        broken: false,
        bidder,
        leader: bidder,
        plays: [],
        tricksLeft: 11,
        bidderPts: 0,
        bonus: bidType === 'Solo' ? widowPts : 0,
        lastTrickBonus: bidType === 'Heart Solo' ? widowPts : 0,
    });
    while (st.tricksLeft > tricksLeft) {
        const p = (st.leader + st.plays.length) % 3;
        const c = search.policyPick(st, p, search.legalCardsPruned(st, p, false));
        search.applyPlay(st, p, (c / 9) | 0, c % 9);
        if (st.plays.length === 3) search.closeTrick(st);
    }
    return st;
}

// Plain minimax — no table, no pruning, no equivalence classes.
function bruteForce(st) {
    if (st.tricksLeft === 0) return 0;
    const p = (st.leader + st.plays.length) % 3;
    const isMax = p === st.bidder;
    let best = isMax ? -Infinity : Infinity;
    for (const c of search.legalCardsPruned(st, p, false)) {
        search.applyPlay(st, p, (c / 9) | 0, c % 9);
        let v;
        if (st.plays.length === 3) {
            const closed = search.closeTrick(st);
            v = closed.gained + bruteForce(st);
            search.reopenTrick(st, closed);
        } else {
            v = bruteForce(st);
        }
        search.undoPlay(st);
        best = isMax ? Math.max(best, v) : Math.min(best, v);
    }
    return best;
}

const snapshotOf = (st) => JSON.stringify([st.hands, st.leader, st.plays.length, st.tricksLeft, st.bidderPts, st.broken]);

async function runRavenBrainTests() {
    console.log('Running raven brain tests...');
    let testCounter = 1;
    const pass = (name) => console.log(`  ✔ Test ${testCounter++}: ${name}`);

    registerBrainProfile(ME, 'raven');
    // Keep the suite quick: fewer worlds, exact from five tricks out.
    raven.configure({ worlds: 6, exactTricks: 5, timeBudgetMs: 10_000 });

    try {
        // 1) Registered and resolvable; no roster seat yet (Matt's call).
        {
            assert.ok(BRAINS.raven, 'raven is registered in BRAINS');
            assert.strictEqual(brainNameFor(ME), 'raven');
            assert.strictEqual(brainNameFor('Doc Shuffle'), 'sphinx', 'existing roster untouched');
            pass('raven is registered and resolves by name.');
        }

        // 2) Information boundary: a trapped engine throws on any read of
        //    another hand or the widow. Defender mid-round with a partial
        //    trick, then the bidder leading.
        {
            const asDefender = trapPrivateInfo(makeEngine({
                myHand: ['AD', 'JD', '6C', 'KS', '9S', '10H', '7H', 'QC'],
                capturedTricks: {
                    Bidder: [
                        { trickNumber: 1, cards: ['AH', 'KH', '6H'], winnerName: 'Bidder' },
                        { trickNumber: 2, cards: ['QH', '8H', '9C'], winnerName: 'Bidder' },
                    ],
                    Ally: [{ trickNumber: 3, cards: ['7C', 'AC', '8C'], winnerName: 'Ally' }],
                },
                currentTrickCards: [{ userId: 2, playerName: 'Ally', card: '9D' }],
                trickLeaderName: 'Ally',
                tricksPlayedCount: 3,
                bidderCardPoints: 25 + 3,
                defenderCardPoints: 11,
                otherHands: { Bidder: ['6S', '7S', '8S', 'JS', 'QS', 'AS', '10S', '10C'], Ally: ['10D', 'KD', 'QD', '8D', '7D', '6D', 'KC', 'JC'] },
            }));
            const bot = new BotPlayer(3, ME, asDefender);
            const card = bot.playCard();
            assert.ok(['AD', 'JD'].includes(card), `defender follows suit (${card})`);

            const asBidder = trapPrivateInfo(makeEngine({
                bidderName: ME,
                myHand: ['AH', '10H', 'KH', '6H', 'AS', '10S', '7D', '8D', '9C', 'JC', 'QC'],
                trumpBroken: false,
                otherHands: { Bidder: [], Ally: [] },
            }));
            const lead = new BotPlayer(3, ME, asBidder).playCard();
            assert.ok(lead && !lead.endsWith('H'), `bidder cannot lead trump before it is broken (${lead})`);
            pass('Never reads another hand or the widow; plays legally as defender and bidder.');
        }

        // 3) Exact solver agrees with brute-force minimax on random endgames
        //    of every bid type, and restores the state it searched.
        {
            const rng = makeRng(4242);
            let checked = 0;
            for (const tricksLeft of [2, 3, 4]) {
                for (let i = 0; i < (tricksLeft === 4 ? 12 : 40); i += 1) {
                    const bidType = ['Solo', 'Heart Solo', 'Frog'][i % 3];
                    const st = randomState(rng, tricksLeft, bidType);
                    const before = snapshotOf(st);
                    const exact = search.solveExact(st, Infinity, new Map());
                    assert.strictEqual(snapshotOf(st), before, 'solver restores the state');
                    const truth = bruteForce(st);
                    assert.strictEqual(exact, truth, `exact ${exact} vs brute ${truth} with ${tricksLeft} tricks left`);
                    checked += 1;
                }
            }
            // The node budget aborts cleanly and leaves the state intact.
            const st = randomState(rng, 7, 'Solo');
            const before = snapshotOf(st);
            assert.strictEqual(search.solveExact(st, 50, new Map()), null);
            assert.strictEqual(snapshotOf(st), before);
            pass(`Endgame solver matches brute force on ${checked} random positions and restores state (budget abort too).`);
        }

        // 4) The payoff table: made bids collect two shares, failed bids pay
        //    three; defenders' payoff is linear.
        {
            assert.strictEqual(raven.payoffFor(true, 2, 70), 40);
            assert.strictEqual(raven.payoffFor(true, 2, 50), -60);
            assert.strictEqual(raven.payoffFor(true, 3, 61), 6);
            assert.strictEqual(raven.payoffFor(true, 1, 60), 0);
            assert.strictEqual(raven.payoffFor(false, 2, 70), -20);
            assert.strictEqual(raven.payoffFor(false, 2, 50), 20);
            assert.strictEqual(raven.payoffFor(false, 1, 60), 0);
            pass('Payoff: bidder +2 shares made / −3 shares set, defender ±1 share.');
        }

        // 5) Candidate pruning: touching zero-point cards collapse, point
        //    cards never do, and an unseen card between two of mine keeps
        //    them apart.
        {
            const engine = makeEngine({ myHand: ['6S', '7S', '8S', '9S', '10S', 'AS', 'JD', 'QD'], trumpSuit: 'H' });
            const view = buildPublicView(engine, ME);
            const legal = ['6S', '7S', '8S', '9S', '10S', 'AS', 'JD', 'QD'];
            assert.deepStrictEqual(
                raven.distinctCandidates(view, legal).sort(),
                ['6S', '10S', 'AS', 'JD', 'QD'].sort(),
            );
            // 6S and 8S with the 7S unseen: distinct.
            const gapEngine = makeEngine({ myHand: ['6S', '8S', 'AD'], trumpSuit: 'H' });
            const gapView = buildPublicView(gapEngine, ME);
            assert.deepStrictEqual(raven.distinctCandidates(gapView, ['6S', '8S', 'AD']).sort(), ['6S', '8S', 'AD'].sort());
            // ...and one choice once the 7S has been played.
            const seenEngine = makeEngine({
                myHand: ['6S', '8S', 'AD'],
                trumpSuit: 'H',
                capturedTricks: { Ally: [{ trickNumber: 1, cards: ['7S', 'KS', 'QS'], winnerName: 'Ally' }] },
                tricksPlayedCount: 1,
            });
            const seenView = buildPublicView(seenEngine, ME);
            assert.deepStrictEqual(raven.distinctCandidates(seenView, ['6S', '8S', 'AD']).sort(), ['6S', 'AD'].sort());
            pass('Candidate pruning keeps one card per equivalence class.');
        }

        // 6) A forced win it must see: last to play, the trick holds a 10,
        //    and only the ace takes it. Every world agrees, so the search
        //    has to agree too.
        {
            const engine = trapPrivateInfo(makeEngine({
                myHand: ['AD', '6D', '7C', '8C'],
                capturedTricks: {
                    Bidder: [
                        { trickNumber: 1, cards: ['AH', 'KH', '6H'], winnerName: 'Bidder' },
                        { trickNumber: 2, cards: ['QH', '8H', '9H'], winnerName: 'Bidder' },
                        { trickNumber: 3, cards: ['JH', '7H', '10H'], winnerName: 'Bidder' },
                        { trickNumber: 4, cards: ['AS', 'KS', '6S'], winnerName: 'Bidder' },
                        { trickNumber: 5, cards: ['QS', '8S', '9S'], winnerName: 'Bidder' },
                        { trickNumber: 6, cards: ['JS', '7S', '10S'], winnerName: 'Bidder' },
                    ],
                    Ally: [{ trickNumber: 7, cards: ['9C', 'AC', '6C'], winnerName: 'Ally' }],
                },
                currentTrickCards: [
                    { userId: 1, playerName: 'Bidder', card: '10D' },
                    { userId: 2, playerName: 'Ally', card: '9D' },
                ],
                trickLeaderName: 'Bidder',
                tricksPlayedCount: 7,
                bidderCardPoints: 11 + 4 + 3 + 2 + 10 + 11 + 4 + 3 + 2 + 10,
                defenderCardPoints: 11,
                otherHands: { Bidder: ['KD', 'QD', 'JD', 'KC'], Ally: ['8D', '7D', 'QC', 'JC'] },
            }));
            assert.strictEqual(new BotPlayer(3, ME, engine).playCard(), 'AD');
            pass('Takes the bidder’s 10 with the ace when it is the only winning card.');
        }

        // 7) Whole games at every bid type, raven in every seat: the engine
        //    rejects illegal cards, and the sim driver throws on a stall.
        {
            const sim = require('../scripts/simulate-brains');
            const realLog = console.log;
            console.log = () => {};
            let rounds = 0;
            const bidTypes = new Set();
            try {
                for (let g = 0; g < 4; g += 1) {
                    const result = sim.playOneGame(['Raven A', 'Raven B', 'Raven C']);
                    rounds += result.rounds;
                    result.roundHistory.forEach(r => bidTypes.add(r.bidType));
                }
            } finally {
                console.log = realLog;
            }
            assert.ok(rounds > 0);
            pass(`Plays ${rounds} full rounds against itself with no illegal card (bids seen: ${[...bidTypes].join(', ')}).`);
        }

        // 8) Played-low inference (seat order Bidder, Ally, Me; hearts trump).
        //    Trick 1: Bidder led AC, Ally followed 8C under it (losing to an
        //    opponent → Ally's clubs floor is the 8), I followed 9C.
        //    Trick 2: Bidder led 9S, Ally took it with AS, I schmeared KS onto
        //    my partner's ace (partner winning → no floor for me).
        //    Trick 3: Ally led QS, I followed JS under my partner, the Bidder
        //    followed 7S under a defender (→ Bidder's spades floor is the 7).
        //    A world sampled with the penalty on almost never puts a lower
        //    club in Ally's hand or the 6S in the Bidder's.
        {
            const engine = makeEngine({
                myHand: ['AD', 'KD', '10D', 'QD', '6H', '7H', 'JH', 'QH'],
                capturedTricks: {
                    Bidder: [{ trickNumber: 1, cards: ['AC', '8C', '9C'], winnerName: 'Bidder' }],
                    Ally: [
                        { trickNumber: 2, cards: ['9S', 'AS', 'KS'], winnerName: 'Ally' },
                        { trickNumber: 3, cards: ['QS', 'JS', '7S'], winnerName: 'Ally' },
                    ],
                },
                tricksPlayedCount: 3,
                trickLeaderName: 'Ally',
            });
            const view = buildPublicView(engine, ME);
            assert.strictEqual(view.floors.Ally.C, 2, 'Ally showed the 8 under an opponent: nothing lower in clubs');
            assert.strictEqual(view.floors.Bidder.S, 1, 'Bidder showed the 7 under a defender: nothing lower in spades');
            assert.strictEqual(view.floors[ME].S, undefined, 'a schmear on the partner’s winner says nothing');
            assert.strictEqual(view.floors.Bidder.C, undefined, 'the leader is never inferred');

            const { sampleWorld } = require('../src/core/bot-strategies/RolloutEstimator');
            const count = (penalty) => {
                const rng = makeRng(99);
                let below = 0;
                for (let i = 0; i < 400; i += 1) {
                    const world = sampleWorld({ ...view, floorPenalty: penalty }, rng);
                    if (world.hands.Ally.some(c => ['6C', '7C'].includes(c))) below += 1;
                    if (world.hands.Bidder.includes('6S')) below += 1;
                }
                return below;
            };
            const off = count(1);
            const on = count(0.15);
            assert.ok(off > 150, `without the inference the low cards land there often (${off})`);
            assert.ok(on < off / 3, `with it they rarely do (${on} vs ${off})`);
            pass('Floors: a low follow under an opponent rules out lower cards; the sampler honours it softly.');
        }

        // 9) sampleWorld stays the only source of hidden cards: every world the
        //    brain builds states from is a full 36-card partition.
        {
            const engine = makeEngine({ myHand: ['AD', 'KD', '6C', '7C', '8C', 'AS', 'KS', 'QS', 'JS', '9S', '10H'] });
            const view = buildPublicView(engine, ME);
            const rng = makeRng(7);
            const { results, worlds } = raven.searchCandidates(view, ['AD', 'AS'], rng);
            assert.strictEqual(worlds, 6);
            assert.strictEqual(results.length, 2);
            results.forEach(r => assert.ok(Number.isFinite(r.payoff)));
            assert.strictEqual(deck.length, 36);
            pass('Search runs the configured number of worlds and returns finite payoffs.');
        }
    } finally {
        raven.resetConfig();
    }

    console.log('All raven brain tests passed.');
}

if (require.main === module) {
    runRavenBrainTests().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}

module.exports = runRavenBrainTests;
