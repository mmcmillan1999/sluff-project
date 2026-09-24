// backend/tests/opusBrain.test.js
//
// Opus 5.5 (Sept 2026): raven-1.2's card play plus an auction that prices
// every contract by playing the hand out (opusBidding.js), a searched Frog
// burial, and the optional table-reading layer (playInference.js). Pins
//   1. who plays it — Courtney M. only — and that no other brain gained an
//      auction, so every other bot still bids with the shared rules;
//   2. the information boundary for the auction, the burial and card play;
//   3. the auction itself: bids a monster, passes junk, never under the
//      table, names the Solo suit that priced best;
//   4. the play model: a duck with a high card under an opponent's winner is
//      less likely when the seat held a low one; the history is in order;
//   5. legality across whole simulated games.

'use strict';

const assert = require('assert');
const BotPlayer = require('../src/core/BotPlayer');
const { BRAINS, BRAIN_PROFILES, registerBrainProfile } = require('../src/core/bot-brains');
const { PROFILES: RAVEN_NEXT } = require('../src/core/bot-brains/ravenNextBrain');
const opus = require('../src/core/bot-brains/opusBrain');
const opusBidding = require('../src/core/bot-brains/opusBidding');
const inference = require('../src/core/bot-brains/playInference');
const search = require('../src/core/bot-brains/ravenSearch');
const { buildPublicView } = require('../src/core/bot-strategies/PublicRoundView');
const { deck } = require('../src/core/constants');

const ME = 'Opus Test';
const NAMES = ['Left', 'Right', ME];
const IDS = { Left: 1, Right: 2, [ME]: 3 };

// Any read of a hand other than mine, or of the widow, throws.
function trapped(engine) {
    engine.hands = new Proxy(engine.hands, {
        get(target, prop) {
            if (typeof prop === 'string' && prop !== ME && NAMES.includes(prop)) throw new Error(`ILLEGAL READ: hand of ${prop}`);
            return target[prop];
        },
    });
    for (const key of ['widow', 'originalDealtWidow', 'widowDiscardsForFrogBidder']) {
        Object.defineProperty(engine, key, { get() { throw new Error(`ILLEGAL READ: ${key}`); } });
    }
    return engine;
}

const biddingEngine = (myHand, currentBid = null) => trapped({
    players: Object.fromEntries(NAMES.map(n => [IDS[n], { userId: IDS[n], playerName: n, isBot: true }])),
    playerOrder: { turnOrder: NAMES.map(n => IDS[n]) },
    state: 'Bidding Phase',
    hands: { [ME]: myHand, Left: [], Right: [] },
    currentHighestBidDetails: currentBid ? { userId: 1, playerName: 'Left', bid: currentBid } : null,
    scores: { Left: 120, Right: 120, [ME]: 120 },
});

const MONSTER = ['AH', '10H', 'KH', 'QH', 'JH', '9H', 'AS', '10S', 'AD', '10D', 'AC'];
const JUNK = ['6H', '7H', '6S', '7S', '8S', '6D', '7D', '8D', '6C', '7C', '8C'];

async function runOpusBrainTests() {
    console.log('Running opus-5.5 candidate tests...');
    let testCounter = 1;
    const pass = (name) => console.log(`  ✔ Test ${testCounter++}: ${name}`);

    // 1) Registered, seated on no bot; the live brains bid with the shared rules.
    {
        assert.ok(BRAINS['opus-5.5'] && typeof BRAINS['opus-5.5'].playCard === 'function');
        const seated = Object.entries(BRAIN_PROFILES).filter(([bot, brain]) => brain === 'opus-5.5' && !/^opus-5\.5 [ABC]$/.test(bot) && bot !== ME).map(([bot]) => bot);
        assert.deepStrictEqual(seated, ['Courtney M.'], 'opus-5.5 plays Courtney M. and no other bot (Matt, Sept 24 2026)');
        for (const [name, brain] of Object.entries(BRAINS)) {
            if (name === 'opus-5.5') continue;
            for (const hook of ['decideBid', 'chooseTrump', 'decideFrogUpgrade', 'submitFrogDiscards']) {
                assert.strictEqual(brain[hook], undefined, `${name} has no ${hook}: it bids with the shared rules`);
            }
        }
        assert.deepStrictEqual(opus.DEFAULT_PROFILE.play, RAVEN_NEXT['raven-1.2'], 'card play is raven-1.2');
        assert.strictEqual(opus.DEFAULT_PROFILE.play.inference, undefined, 'table reading is off by default');
        pass('opus-5.5 plays Courtney M. only, and no other brain has an auction of its own.');
    }

    // 2) Information boundary: the auction, the trump call and the upgrade read
    //    my own eleven cards only.
    {
        registerBrainProfile(ME, 'opus-5.5');
        const bot = new BotPlayer(IDS[ME], ME, biddingEngine(MONSTER));
        const bid = bot.decideBid();
        assert.ok(['Frog', 'Solo', 'Heart Solo'].includes(bid));
        assert.ok(['S', 'C', 'D'].includes(bot.chooseTrump()));
        const upgrade = new BotPlayer(IDS[ME], ME, biddingEngine(MONSTER, 'Solo'));
        assert.ok(['Heart Solo', 'Pass'].includes(upgrade.decideFrogUpgrade()));
        pass(`The auction reads no other hand and no widow (monster hand bids ${bid}).`);
    }

    // 3) The auction: bids a monster, passes junk, never at or under the table.
    {
        const monster = opusBidding.contractValues(MONSTER, { worlds: 24, seed: 7 });
        assert.ok(monster['Heart Solo'].mean > 100, 'six hearts with the ace and three side aces is a Heart Solo');
        assert.strictEqual(opusBidding.decide(monster, null, { Frog: -10, Solo: -10, 'Heart Solo': -10 }).bid, 'Heart Solo');
        const junk = opusBidding.contractValues(JUNK, { worlds: 24, seed: 7 });
        assert.strictEqual(opusBidding.decide(junk, null, { Frog: -10, Solo: -10, 'Heart Solo': -10 }).bid, 'Pass');
        const values = { Frog: { bid: 'Frog', trump: 'H', mean: 30 }, 'Solo S': { bid: 'Solo', trump: 'S', mean: 20 }, 'Solo C': { bid: 'Solo', trump: 'C', mean: 25 }, 'Solo D': { bid: 'Solo', trump: 'D', mean: -5 }, 'Heart Solo': { bid: 'Heart Solo', trump: 'H', mean: -50 } };
        assert.strictEqual(opusBidding.decide(values, null, { Frog: 0, Solo: 0, 'Heart Solo': 0 }).bid, 'Frog');
        assert.strictEqual(opusBidding.decide(values, 'Frog', { Frog: 0, Solo: 0, 'Heart Solo': 0 }).bid, 'Solo', 'over a Frog, the best higher contract');
        assert.strictEqual(opusBidding.decide(values, 'Solo', { Frog: 0, Solo: 0, 'Heart Solo': 0 }).bid, 'Pass', 'never at or under the table');
        assert.strictEqual(opusBidding.bestSoloSuit(values), 'C');
        pass('Bids the monster as a Heart Solo, passes junk, never at or under the table, names the best Solo suit.');
    }

    // 4) The searched Frog burial: three of my fourteen, never trump or an ace.
    {
        const full = ['AH', '10H', 'KH', '9H', '7H', 'AS', '10S', '6S', 'KD', '8D', '6D', 'QC', '9C', '6C'];
        const buried = opusBidding.searchFrogDiscards(full, { screenWorlds: 4, finalWorlds: 8, finalists: 3, seed: 3 });
        assert.strictEqual(buried.length, 3);
        assert.strictEqual(new Set(buried).size, 3);
        for (const card of buried) {
            assert.ok(full.includes(card));
            assert.ok(!card.endsWith('H') && !card.startsWith('A'), `buries ${card}: never trump, never an ace`);
        }
        pass(`Buries three legal cards (${buried.join(' ')}).`);
    }

    // 5) The play model: under an opponent's winning ace, following with the
    //    king says "nothing lower" — a world where that seat also held the six
    //    is less likely than one where it did not.
    {
        assert.ok(inference.MODEL() && inference.MODEL().weights.length === inference.FEATURES.length, 'a fitted model ships');
        const view = {
            botName: ME, activeNames: NAMES, bidderName: 'Left', trumpSuit: 'H',
            playedBy: { Left: ['AS'], Right: ['KS'], [ME]: [] },
            tricks: [{ leaderName: 'Left', plays: [{ playerName: 'Left', card: 'AS' }, { playerName: 'Right', card: 'KS' }] }],
        };
        // Only Right's follow is scored; the two worlds differ in one card.
        const others = ['7H', '8H', '9H', 'JH', 'QH', 'KH', '6D', '7D', '8D'];
        const withSix = { hands: { Left: [], Right: ['6S', ...others], [ME]: [] } };
        const withoutSix = { hands: { Left: [], Right: ['9D', ...others], [ME]: [] } };
        const skip = new Set(['Left']);
        const a = inference.historyLogLikelihood(view, withSix, { epsilon: 0.1, skip });
        const b = inference.historyLogLikelihood(view, withoutSix, { epsilon: 0.1, skip });
        assert.ok(b > a, `ducking the king is likelier with no lower spade (${b.toFixed(2)} vs ${a.toFixed(2)})`);
        pass('The play model reads a high duck under an opponent’s winner as "nothing lower".');
    }

    // 6) PublicRoundView.tricks: every card in table order with its seat.
    {
        const engine = {
            bidWinnerInfo: { userId: 1, playerName: 'Left', bid: 'Solo' },
            trumpSuit: 'S',
            players: Object.fromEntries(NAMES.map(n => [IDS[n], { userId: IDS[n], playerName: n }])),
            playerOrder: { turnOrder: NAMES.map(n => IDS[n]) },
            hands: { [ME]: ['9D'] },
            capturedTricks: { Right: [{ trickNumber: 1, cards: ['6C', 'AC', '7C'], winnerName: 'Right' }] },
            currentTrickCards: [{ playerName: 'Right', card: 'KD' }],
            trickLeaderId: IDS.Right,
            tricksPlayedCount: 1,
        };
        const view = buildPublicView(engine, ME);
        assert.deepStrictEqual(view.tricks, [
            { leaderName: 'Left', plays: [{ playerName: 'Left', card: '6C' }, { playerName: 'Right', card: 'AC' }, { playerName: ME, card: '7C' }] },
            { leaderName: 'Right', plays: [{ playerName: 'Right', card: 'KD' }] },
        ]);
        pass('The public view carries the round’s history in table order.');
    }

    // 7) Whole games with opus seats: every card legal, every phase answered.
    {
        const sim = require('../scripts/simulate-brains');
        const realLog = console.log;
        console.log = () => {};
        let rounds = 0;
        const bidTypes = new Set();
        BRAINS['opus-5.5'].configure({ worlds: 8, timeBudgetMs: 10_000 });
        BRAINS['opus-5.5'].config.bidding.worlds = 12;
        try {
            for (const seatsFor of [['opus-5.5 A', 'opus-5.5 B', 'Kimba'], ['opus-5.5 A', 'Sphinx A', 'raven-1.2 A']]) {
                const result = sim.playOneGame(seatsFor);
                rounds += result.rounds;
                result.roundHistory.forEach(r => bidTypes.add(r.bidType));
            }
        } finally {
            console.log = realLog;
            BRAINS['opus-5.5'].resetConfig();
            BRAINS['opus-5.5'].config.bidding.worlds = opus.DEFAULT_PROFILE.bidding.worlds;
        }
        assert.ok(rounds > 0);
        pass(`Plays ${rounds} full rounds with no illegal card or bid (bids seen: ${[...bidTypes].join(', ')}).`);
    }

    // Card-play boundary is raven-1.2's own (ravenNext.test.js); the search
    // is the same engine with the same profile, asserted in test 1.
    search.cardIdx('AS');
    console.log('All opus-5.5 candidate tests passed.');
}

if (require.main === module) {
    runOpusBrainTests().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}

module.exports = runOpusBrainTests;
