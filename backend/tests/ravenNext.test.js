// backend/tests/ravenNext.test.js
//
// raven-1.1 / raven-1.2: the raven search engine with repaired beliefs about
// where Aces and 10s live, plus (1.2) explicit risk controls on defense. Born
// from the Sept 2026 sighting of the raven seats leading a 10 under an
// unplayed ace. These tests pin
//   1. who plays what — raven-1.2 on Grandpa George and nowhere else,
//      raven-1.1 on no bot — and that raven itself is untouched;
//   2. the information boundary — same trapped engine as raven's;
//   3. the repaired beliefs: a Frog bidder never buries an ace, key cards
//      follow the measured table and respect voids, worlds stay whole;
//   4. the 10-lead risk limit and the regret-averse score;
//   5. legality across whole simulated games.

'use strict';

const assert = require('assert');
const BotPlayer = require('../src/core/BotPlayer');
const { BRAINS, BRAIN_PROFILES, brainNameFor, registerBrainProfile } = require('../src/core/bot-brains');
const raven = require('../src/core/bot-brains/ravenBrain');
const { PROFILES } = require('../src/core/bot-brains/ravenNextBrain');
const { sampleWorld, makeRng, keyCardCells } = require('../src/core/bot-strategies/RolloutEstimator');
const { buildPublicView } = require('../src/core/bot-strategies/PublicRoundView');
const { deck } = require('../src/core/constants');
const keyCardTable = require('../src/core/bot-strategies/keyCardTable.json');

const ME = 'Raven Next Test';
const NAMES = ['Bidder', 'Ally', ME];
const CALIBRATED = { frogBuryModel: 'calibrated', keyCardModel: 'calibrated' };

function makeEngine({
    myHand,
    bid = 'Solo',
    trumpSuit = 'H',
    trumpBroken = true,
    capturedTricks = {},
    currentTrickCards = [],
    trickLeaderName = null,
    tricksPlayedCount = 0,
    bidderCardPoints = 0,
    defenderCardPoints = 0,
    revealedWidowForFrog = [],
    otherHands = {},
} = {}) {
    const ids = { Bidder: 1, Ally: 2, [ME]: 3 };
    const players = {};
    NAMES.forEach(name => { players[ids[name]] = { userId: ids[name], playerName: name, isBot: true }; });
    return {
        players,
        playerOrder: { turnOrder: NAMES.map(n => ids[n]) },
        playerMode: 3,
        state: 'Playing Phase',
        bidWinnerInfo: { userId: 1, playerName: 'Bidder', bid },
        trumpSuit,
        trumpBroken,
        hands: { [ME]: myHand, ...otherHands },
        widow: ['6C', '7C', '8C'],
        originalDealtWidow: ['6C', '7C', '8C'],
        capturedTricks,
        currentTrickCards,
        leadSuitCurrentTrick: currentTrickCards.length ? currentTrickCards[0].card.slice(-1) : null,
        lastCompletedTrick: null,
        tricksPlayedCount,
        bidderCardPoints,
        defenderCardPoints,
        trickLeaderId: ids[trickLeaderName || (currentTrickCards[0]?.playerName ?? ME)],
        revealedWidowForFrog,
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
    for (const key of ['widow', 'originalDealtWidow', 'widowDiscardsForFrogBidder']) {
        Object.defineProperty(engine, key, { get() { throw new Error(`ILLEGAL READ: ${key}`); } });
    }
    return engine;
}

// A defender on lead in trick 1 of a Frog (hearts trump), holding the 10 of
// spades with its ace nowhere in sight. The revealed widow went to the bidder.
const frogDefenderOnLead = () => makeEngine({
    bid: 'Frog',
    trumpBroken: false,
    myHand: ['10S', '9S', '6S', 'KD', '9D', '7D', 'QC', '8C', '6C', '9H', '7H'],
    revealedWidowForFrog: ['JD', '8S', '6D'],
    trickLeaderName: ME,
    otherHands: { Bidder: [], Ally: [] },
});

async function runRavenNextTests() {
    console.log('Running raven 1.x candidate tests...');
    let testCounter = 1;
    const pass = (name) => console.log(`  ✔ Test ${testCounter++}: ${name}`);
    const candidates = Object.keys(PROFILES);

    // 1) Registered; raven-1.2 on Grandpa George (both raven seats Sept 17 2026;
    //    Courtney M. moved to opus-5.5 Sept 24) and
    //    nowhere else; raven-1.1 on no bot; raven exactly what it was.
    {
        assert.deepStrictEqual(candidates, ['raven-1.1', 'raven-1.2']);
        for (const name of candidates) {
            assert.ok(BRAINS[name] && typeof BRAINS[name].playCard === 'function', `${name} is a brain`);
            assert.strictEqual(PROFILES[name].frogBuryModel, 'calibrated');
            assert.strictEqual(PROFILES[name].keyCardModel, 'calibrated');
            assert.strictEqual(PROFILES[name].tenLeadGuard, 0.15, `${name} holds the 10 lead to a risk limit`);
        }
        assert.strictEqual(PROFILES['raven-1.1'].riskAversion, undefined, '1.1 still plays for the best average');
        assert.strictEqual(PROFILES['raven-1.2'].riskAversion, 0.5, '1.2 is the regret-averse one');
        // Simulator seats ("raven-1.2 A") are registered by the sim scripts;
        // everything else in BRAIN_PROFILES is a real bot.
        const seated = Object.entries(BRAIN_PROFILES)
            .filter(([bot, brain]) => candidates.includes(brain) && !/^raven-1\.\d [ABC]$/.test(bot))
            .map(([bot, brain]) => `${bot}=${brain}`)
            .sort();
        assert.deepStrictEqual(seated, ['Grandpa George=raven-1.2'],
            'raven-1.2 plays Grandpa George and no other bot (Courtney M. moved to opus-5.5 Sept 24 2026); raven-1.1 plays none');
        assert.strictEqual(brainNameFor('Doc Shuffle'), 'sphinx', 'sphinx keeps its own brain');
        assert.ok(BRAINS.raven && BRAINS['raven-1.1'], 'raven and raven-1.1 stay registered: the simulators’ baselines and a one-line rollback');
        assert.strictEqual(raven.DEFAULTS.frogBuryModel, 'market');
        assert.strictEqual(raven.DEFAULTS.keyCardModel, 'off');
        assert.strictEqual(raven.DEFAULTS.tenLeadGuard, 'off');
        assert.strictEqual(raven.DEFAULTS.riskAversion, 0);
        pass('raven-1.2 holds Grandpa George, raven-1.1 holds none, and raven’s own defaults are untouched.');
    }

    // 2) Information boundary, in the round type the repair touches most.
    {
        for (const name of candidates) {
            registerBrainProfile(ME, name);
            BRAINS[name].configure({ worlds: 6, timeBudgetMs: 10_000 });
            try {
                const frog = trapPrivateInfo(frogDefenderOnLead());
                const lead = new BotPlayer(3, ME, frog).playCard();
                assert.ok(frog.hands[ME].includes(lead) && !lead.endsWith('H'), `${name} leads a legal non-trump card (${lead})`);

                const solo = trapPrivateInfo(makeEngine({
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
                    bidderCardPoints: 28,
                    defenderCardPoints: 11,
                    otherHands: { Bidder: [], Ally: [] },
                }));
                const follow = new BotPlayer(3, ME, solo).playCard();
                assert.ok(['AD', 'JD'].includes(follow), `${name} follows suit (${follow})`);
            } finally {
                BRAINS[name].resetConfig();
            }
        }
        pass('Neither candidate reads another hand, the widow, or the Frog discards.');
    }

    // 3) The repair that started it: a Frog bidder does not bury aces.
    {
        const view = buildPublicView(frogDefenderOnLead(), ME);
        const buried = (options, isHit) => {
            const rng = makeRng(2026);
            let worlds = 0;
            for (let i = 0; i < 600; i += 1) {
                if (sampleWorld({ ...view, ...options }, rng).frogDiscards.some(isHit)) worlds += 1;
            }
            return worlds;
        };
        const anAce = card => card.startsWith('A');
        const aTrump = card => card.endsWith('H');
        const market = buried({}, anAce);
        const calibrated = buried(CALIBRATED, anAce);
        assert.ok(market > 150, `the market model buries an ace in a large share of worlds (${market}/600)`);
        assert.ok(calibrated <= 6, `the calibrated model almost never does (${calibrated}/600)`);
        assert.ok(buried(CALIBRATED, aTrump) <= 3, 'nor trump');
        pass(`Frog worlds with a buried ace: ${market}/600 under the market model, ${calibrated}/600 calibrated.`);
    }

    // 4) The measured table: whole rows, the facts that matter, public keys.
    {
        assert.deepStrictEqual(keyCardTable.zones, ['bidder', 'partner', 'buried']);
        const rows = Object.entries(keyCardTable.table);
        assert.ok(rows.length > 100, `a real table shipped (${rows.length} cells)`);
        for (const [cell, odds] of rows) {
            assert.strictEqual(odds.length, 3, cell);
            assert.ok(Math.abs(odds[0] + odds[1] + odds[2] - 1) < 0.01, `${cell} sums to one`);
        }
        const at = cell => keyCardTable.table[cell];
        assert.strictEqual(at('Frog|ASb')[2], 0, 'a Frog side ace is never buried');
        assert.ok(at('Solo|ATb')[0] > 0.8, 'a Solo bidder holds the trump ace');
        assert.ok(at('Solo|ASb|L2')[2] > 0.6, 'a side ace unseen after two leads of its suit is in the widow');
        assert.ok(at('Solo|ASb|L0')[2] < 0.3, 'before the suit is led it usually is not');

        const view = buildPublicView(frogDefenderOnLead(), ME);
        assert.deepStrictEqual(keyCardCells(view, 'AS'), ['Frog|ASb|L0|P0', 'Frog|ASb|L0', 'Frog|ASb']);
        assert.deepStrictEqual(keyCardCells(view, '10D'), ['Frog|10Su|L0|P0', 'Frog|10Su|L0', 'Frog|10Su']);
        assert.deepStrictEqual(keyCardCells(view, 'AH'), ['Frog|ATb|L0|P0', 'Frog|ATb|L0', 'Frog|ATb']);
        const blind = { bidType: view.bidType, trumpSuit: view.trumpSuit, playedSet: view.playedSet, suitLeads: view.suitLeads, tricksPlayed: view.tricksPlayed };
        assert.deepStrictEqual(keyCardCells(blind, 'AS'), keyCardCells(view, 'AS'), 'a cell reads nothing but public facts');
        pass('The key-card table is whole, says what was measured, and is keyed on public facts only.');
    }

    // 5) suitLeads, and key cards that respect a proven void: the bidder
    //    trumped the second diamond lead, so no world may hand him the AD.
    {
        const engine = makeEngine({
            myHand: ['10D', '9D', 'KS', '9S', '6S', 'QC', '8C', '6C', '7H'],
            capturedTricks: {
                Ally: [{ trickNumber: 1, cards: ['6D', 'KD', '7D'], winnerName: 'Ally' }],
                Bidder: [{ trickNumber: 2, cards: ['QD', '8D', '6H'], winnerName: 'Bidder' }],
            },
            tricksPlayedCount: 2,
            trickLeaderName: ME,
        });
        // Leader chain: the Bidder led trick 1 (6D), Ally won it and led
        // trick 2 (QD), I followed 8D and the Bidder ruffed with the 6H.
        const view = buildPublicView(engine, ME);
        assert.strictEqual(view.suitLeads.D, 2);
        assert.strictEqual(view.suitLeads.S, 0);
        assert.ok(view.voids.Bidder.has('D'), 'the ruff proved the bidder void in diamonds');
        const rng = makeRng(11);
        for (let i = 0; i < 300; i += 1) {
            const world = sampleWorld({ ...view, ...CALIBRATED }, rng);
            assert.ok(!world.hands.Bidder.some(card => card.endsWith('D')), 'no diamond reaches a void hand');
            const all = [...world.hands.Bidder, ...world.hands.Ally, ...world.hands[ME], ...world.widow, ...view.playedSet];
            assert.strictEqual(all.length, 36, 'every world is a full deck');
            assert.strictEqual(new Set(all).size, 36, 'with no card twice');
            assert.strictEqual(world.hands.Bidder.length, 9);
            assert.strictEqual(world.hands.Ally.length, 9);
            assert.strictEqual(world.widow.length, 3);
        }
        const frogView = buildPublicView(frogDefenderOnLead(), ME);
        for (let i = 0; i < 300; i += 1) {
            const world = sampleWorld({ ...frogView, ...CALIBRATED }, rng);
            const all = [...world.hands.Bidder, ...world.hands.Ally, ...world.hands[ME], ...world.frogDiscards];
            assert.strictEqual(new Set(all).size, 36, 'a Frog world is a full deck too');
            assert.strictEqual(world.hands.Bidder.length, 11);
            assert.strictEqual(world.frogDiscards.length, 3);
            for (const card of ['JD', '8S', '6D']) {
                assert.ok(world.hands.Bidder.includes(card) || world.frogDiscards.includes(card), 'the revealed widow stays the bidder’s');
            }
        }
        pass('Calibrated worlds are whole decks that honour voids, hand sizes and the revealed widow.');
    }

    // 6) The 10-lead risk limit. On lead as a defender with the 10 of spades
    //    and the ace unaccounted for: with the limit at zero it is never led
    //    while another lead exists; raven does not even measure it.
    {
        const view = buildPublicView(frogDefenderOnLead(), ME);
        const leads = ['10S', '6S', 'KD', '7D', 'QC', '6C'];
        const strict = raven.createSearchBrain({ ...CALIBRATED, tenLeadGuard: 0, worlds: 24, timeBudgetMs: 10_000 });
        const { results } = strict.searchCandidates(view, leads, makeRng(5));
        const ten = results.find(r => r.card === '10S');
        assert.ok(ten.tenRisk > 0.15 && ten.tenRisk < 0.75, `the bidder holds the AS in a believable share of worlds (${ten.tenRisk})`);
        results.filter(r => r.card !== '10S').forEach(r => assert.strictEqual(r.tenRisk, null));

        registerBrainProfile(ME, 'raven-1.2');
        BRAINS['raven-1.2'].configure({ tenLeadGuard: 0, worlds: 10, timeBudgetMs: 10_000 });
        try {
            for (let seed = 1; seed <= 12; seed += 1) {
                const realRandom = Math.random;
                Math.random = makeRng(seed);
                try {
                    assert.notStrictEqual(new BotPlayer(3, ME, frogDefenderOnLead()).playCard(), '10S', `seed ${seed}`);
                } finally { Math.random = realRandom; }
            }
        } finally {
            BRAINS['raven-1.2'].resetConfig();
        }

        raven.configure({ worlds: 8, timeBudgetMs: 10_000 });
        try {
            raven.searchCandidates(view, leads, makeRng(5)).results.forEach(r => assert.strictEqual(r.tenRisk, null));
        } finally { raven.resetConfig(); }

        // Holding the ace myself, or following, is never "under an ace".
        const holdingAce = buildPublicView(makeEngine({
            bid: 'Frog', trumpBroken: false, trickLeaderName: ME,
            myHand: ['AS', '10S', '6S', 'KD', '9D', '7D', 'QC', '8C', '6C', '9H', '7H'],
        }), ME);
        strict.searchCandidates(holdingAce, ['10S', '6S', 'KD'], makeRng(5)).results
            .forEach(r => assert.strictEqual(r.tenRisk, null));
        pass(`The 10-lead limit measures the bidder’s share of the ace (${ten.tenRisk.toFixed(2)} here) and holds the lead to it.`);
    }

    // 7) Regret-averse score: never above the average payoff, equal to it for
    //    raven, and only ever applied to a defender.
    {
        const view = buildPublicView(frogDefenderOnLead(), ME);
        const leads = ['10S', '6S', 'KD', '7D', 'QC', '6C'];
        const averse = raven.createSearchBrain({ ...CALIBRATED, riskAversion: 0.5, worlds: 16, timeBudgetMs: 10_000 });
        const scored = averse.searchCandidates(view, leads, makeRng(9)).results;
        scored.forEach(r => assert.ok(r.score <= r.payoff + 1e-9, `${r.card}: score ${r.score} <= payoff ${r.payoff}`));
        assert.ok(scored.some(r => r.score < r.payoff - 1e-6), 'some lead carries a downside');

        raven.configure({ worlds: 8, timeBudgetMs: 10_000 });
        try {
            raven.searchCandidates(view, leads, makeRng(9)).results.forEach(r => assert.strictEqual(r.score, r.payoff));
        } finally { raven.resetConfig(); }

        const bidderView = { ...view, botIsBidder: true, bidderName: ME, frog: { revealedWidow: [], myDiscards: ['6D', '7C', '8D'] } };
        averse.searchCandidates(bidderView, ['10S', '6S'], makeRng(9)).results
            .forEach(r => assert.strictEqual(r.score, r.payoff, 'a bidder already has its own utility curve'));
        pass('The regret-averse score only ever lowers a defender’s card, and leaves raven and bidders alone.');
    }

    // 8) Whole games, the candidates in every seat.
    {
        const sim = require('../scripts/simulate-brains');
        const realLog = console.log;
        console.log = () => {};
        let rounds = 0;
        const bidTypes = new Set();
        for (const name of candidates) BRAINS[name].configure({ worlds: 8, timeBudgetMs: 10_000 });
        try {
            for (const seatsFor of [['raven-1.1 A', 'raven-1.1 B', 'raven-1.2 A'], ['raven-1.2 A', 'raven-1.2 B', 'Raven A']]) {
                for (let g = 0; g < 2; g += 1) {
                    const result = sim.playOneGame(seatsFor);
                    rounds += result.rounds;
                    result.roundHistory.forEach(r => bidTypes.add(r.bidType));
                }
            }
        } finally {
            console.log = realLog;
            for (const name of candidates) BRAINS[name].resetConfig();
        }
        assert.ok(rounds > 0);
        assert.strictEqual(deck.length, 36);
        pass(`Plays ${rounds} full rounds with no illegal card (bids seen: ${[...bidTypes].join(', ')}).`);
    }

    console.log('All raven 1.x candidate tests passed.');
}

if (require.main === module) {
    runRavenNextTests().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}

module.exports = runRavenNextTests;
