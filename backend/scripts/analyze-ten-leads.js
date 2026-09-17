// backend/scripts/analyze-ten-leads.js
//
// Watches one brain defend on seeded deals and reports every time it LEADS A
// 10 WHILE THAT SUIT'S ACE IS UNACCOUNTED FOR (not played, not in its own
// hand) — the play Matt spotted the raven seats making in Sept 2026.
//
//   node scripts/analyze-ten-leads.js 2000 raven counting sphinx --seed=500
//
// Seats: <subject> <partner> <opponent>, as in simulate-defense.js. For every
// such lead it records where the Ace REALLY was (the harness may look; the
// brain may not) beside where the subject's world sampler BELIEVED it was,
// and what the trick cost. The second table is the sampler's calibration over
// every defensive decision: for each unseen Ace and 10, belief against truth.
// A sampler that is wrong about who holds the Aces is wrong about every
// lead it prices.

'use strict';

const gameLogic = require('../src/core/logic');
const { CARD_POINT_VALUES } = require('../src/core/constants');
const { registerBrainProfile } = require('../src/core/bot-brains');
const { buildPublicView } = require('../src/core/bot-strategies/PublicRoundView');
const { sampleWorld, makeRng } = require('../src/core/bot-strategies/RolloutEstimator');
const { buildEngine, SEAT_POOL } = require('./simulate-brains');

const FLAGS = process.argv.slice(2).filter(arg => arg.startsWith('--'));
const ARGS = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
const flag = (name) => {
    const hit = FLAGS.find(arg => arg.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
};

const BELIEF_WORLDS = Number(flag('belief')) || 120;
// The sampling options the subject's brain really uses (raven's defaults).
const SAMPLING = {
    bidBiasScale: Number(flag('bias') ?? 2),
    floorPenalty: Number(flag('floor') ?? 0.15),
    frogBuryModel: flag('bury') || undefined,
    keyCardModel: flag('keycards') || undefined,
};

const pts = (card) => CARD_POINT_VALUES[gameLogic.getRank(card)] || 0;

// Where a card truly is. Reads hidden state — harness only.
function truthOf(engine, card, view) {
    if ((engine.hands[view.bidderName] || []).includes(card)) return 'bidder';
    for (const name of view.activeNames) {
        if (name !== view.bidderName && name !== view.botName && (engine.hands[name] || []).includes(card)) return 'partner';
    }
    return 'buried'; // face-down widow, or the Frog bidder's discards
}

function beliefOf(view, card, rng) {
    const tally = { bidder: 0, partner: 0, buried: 0 };
    const samplingView = { ...view, ...SAMPLING };
    for (let i = 0; i < BELIEF_WORLDS; i += 1) {
        const world = sampleWorld(samplingView, rng);
        if (world.hands[view.bidderName].includes(card)) tally.bidder += 1;
        else if (view.activeNames.some(name => name !== view.bidderName && name !== view.botName && world.hands[name].includes(card))) tally.partner += 1;
        else tally.buried += 1;
    }
    for (const key of Object.keys(tally)) tally[key] /= BELIEF_WORLDS;
    return tally;
}

const MAX_STEPS = 2000;

function playOneRound(seatNames, subjectName, sink, beliefRng) {
    const engine = buildEngine(seatNames);
    let pendingLead = null;
    for (let step = 0; step < MAX_STEPS; step += 1) {
        const state = engine.state;
        if (state === 'Awaiting Next Round Trigger' || state === 'Game Over') return engine.roundHistory[0];
        if (state === 'Dealing Pending') { engine.dealCards(engine.dealer); continue; }
        if (state === 'Bidding Phase') { const id = engine.biddingTurnPlayerId; engine.placeBid(id, engine.bots[id].decideBid()); continue; }
        if (state === 'Awaiting Frog Upgrade Decision') { const id = engine.biddingTurnPlayerId; engine.placeBid(id, engine.bots[id].decideFrogUpgrade()); continue; }
        if (state === 'AllPassWidowReveal') { engine._advanceRound(); continue; }
        if (state === 'Trump Selection') { const id = engine.bidWinnerInfo.userId; engine.chooseTrump(id, engine.bots[id].chooseTrump()); continue; }
        if (state === 'Frog Widow Exchange') { const id = engine.bidWinnerInfo.userId; engine.submitFrogDiscards(id, engine.bots[id].submitFrogDiscards()); continue; }
        if (state === 'Bid Announcement') { engine.state = 'Playing Phase'; continue; }
        if (state === 'TrickCompleteLinger') {
            if (pendingLead) {
                // The trick the 10 was led into just closed.
                const cards = engine.currentTrickCards.map(play => play.card);
                const winner = gameLogic.determineTrickWinner(engine.currentTrickCards, gameLogic.getSuit(cards[0]), engine.trumpSuit);
                pendingLead.wonByDefense = winner.playerName !== pendingLead.bidderName;
                pendingLead.trickPoints = cards.reduce((sum, card) => sum + pts(card), 0);
                pendingLead.ruffed = gameLogic.getSuit(winner.card) === engine.trumpSuit && pendingLead.suit !== engine.trumpSuit;
                sink.leads.push(pendingLead);
                pendingLead = null;
            }
            engine.currentTrickCards = [];
            engine.leadSuitCurrentTrick = null;
            engine.trickTurnPlayerId = engine.trickLeaderId;
            engine.state = 'Playing Phase';
            engine.turnStartedAt = Date.now();
            continue;
        }
        if (state === 'Playing Phase') {
            const id = engine.trickTurnPlayerId;
            const name = engine.players[id].playerName;
            const isSubjectDefending = name === subjectName && engine.bidWinnerInfo.playerName !== subjectName;
            let view = null;
            if (isSubjectDefending) {
                // Math.random drives the brain's own sampling; keep the
                // harness's peeking on a separate stream so runs stay paired.
                view = buildPublicView(engine, name);
                if (view) {
                    sink.decisions += 1;
                    if (view.partialTrick.length === 0) sink.leadsTotal += 1;
                    const seen = new Set([...view.myHand, ...view.playedSet]);
                    for (const suit of ['H', 'D', 'C', 'S']) {
                        for (const rank of ['A', '10']) {
                            const card = rank + suit;
                            if (seen.has(card)) continue;
                            // One calibration sample per decision is plenty.
                            if (beliefRng() > 0.12) continue;
                            const belief = beliefOf(view, card, beliefRng);
                            const truth = truthOf(engine, card, view);
                            const key = `${view.bidType === 'Frog' ? 'Frog' : 'Solo/HS'} ${rank}${suit === view.trumpSuit ? ' trump' : ' side'}`;
                            const row = sink.calibration[key] = sink.calibration[key] || { n: 0, belief: { bidder: 0, partner: 0, buried: 0 }, truth: { bidder: 0, partner: 0, buried: 0 } };
                            row.n += 1;
                            for (const zone of Object.keys(belief)) row.belief[zone] += belief[zone];
                            row.truth[truth] += 1;
                        }
                    }
                }
            }
            const before = engine.currentTrickCards.length;
            const card = engine.bots[id].playCard();
            if (view && view.partialTrick.length === 0 && gameLogic.getRank(card) === '10') {
                const suit = gameLogic.getSuit(card);
                const ace = `A${suit}`;
                const aceUnseen = !view.playedSet.has(ace) && !view.myHand.includes(ace);
                if (aceUnseen) {
                    pendingLead = {
                        bidType: view.bidType,
                        bidderName: view.bidderName,
                        suit,
                        trump: suit === view.trumpSuit,
                        trick: view.tricksPlayed + 1,
                        suitLength: view.myHand.filter(c => gameLogic.getSuit(c) === suit).length,
                        aceTruth: truthOf(engine, ace, view),
                        aceBelief: beliefOf(view, ace, beliefRng),
                        revealedToBidder: (view.frog?.revealedWidow || []).includes(ace),
                    };
                }
            }
            engine.playCard(id, card);
            if (engine.state === 'Playing Phase' && engine.currentTrickCards.length === before) {
                throw new Error(`stalled: ${name} offered illegal ${card}`);
            }
            continue;
        }
        throw new Error(`unexpected state ${state}`);
    }
    throw new Error('runaway round');
}

if (require.main === module) {
    const rounds = Number(ARGS[0]) || 1000;
    const [subject = 'raven', partner = 'counting', opponent = 'sphinx'] = ARGS.slice(1);
    const used = {};
    const seatNames = [subject, partner, opponent].map(brain => {
        if (!SEAT_POOL[brain]) throw new Error(`No sim seats for brain "${brain}"`);
        const idx = used[brain] || 0;
        used[brain] = idx + 1;
        const name = SEAT_POOL[brain][idx % 3];
        registerBrainProfile(name, brain);
        return name;
    });
    const seedBase = Number(flag('seed')) || 500;
    const sink = { leads: [], decisions: 0, leadsTotal: 0, calibration: {}, defended: 0 };
    const beliefRng = makeRng(seedBase * 7919 + 17);

    const realLog = console.log;
    console.log = () => {};
    const t0 = Date.now();
    try {
        for (let i = 0; i < rounds; i += 1) {
            Math.random = makeRng(seedBase + i);
            const round = playOneRound(seatNames, seatNames[0], sink, beliefRng);
            if (round.bidderName !== seatNames[0]) sink.defended += 1;
        }
    } finally { console.log = realLog; }

    const pct = (x) => `${(100 * x).toFixed(1).padStart(5)}%`;
    console.log(`\n=== ${subject} defending · partner ${partner} · bidder ${opponent} · ${rounds} rounds (${sink.defended} defended) · seed ${seedBase} ===`);
    console.log(`  defensive decisions ${sink.decisions} · defensive leads ${sink.leadsTotal}`);
    console.log(`  10 led under an unaccounted Ace: ${sink.leads.length}  (${(sink.leads.length / Math.max(1, sink.defended)).toFixed(3)} per defended round, ${pct(sink.leads.length / Math.max(1, sink.leadsTotal))} of defensive leads)`);

    const group = (label, rows) => {
        if (!rows.length) return;
        const n = rows.length;
        const where = (zone) => rows.filter(r => r.aceTruth === zone).length / n;
        const believed = (zone) => rows.reduce((s, r) => s + r.aceBelief[zone], 0) / n;
        const lost = rows.filter(r => !r.wonByDefense);
        console.log(`\n  ${label} — ${n} leads`);
        console.log(`    Ace REALLY with   bidder ${pct(where('bidder'))} · partner ${pct(where('partner'))} · buried ${pct(where('buried'))}`);
        console.log(`    sampler BELIEVED  bidder ${pct(believed('bidder'))} · partner ${pct(believed('partner'))} · buried ${pct(believed('buried'))}`);
        console.log(`    trick lost to the bidder ${pct(lost.length / n)} (ruffed ${pct(rows.filter(r => r.ruffed).length / n)}) · avg points handed over when lost ${(lost.reduce((s, r) => s + r.trickPoints, 0) / Math.max(1, lost.length)).toFixed(1)}`);
    };
    group('ALL', sink.leads);
    group('Frog rounds', sink.leads.filter(r => r.bidType === 'Frog'));
    group('Solo / Heart Solo rounds', sink.leads.filter(r => r.bidType !== 'Frog'));
    group('side-suit 10s', sink.leads.filter(r => !r.trump));
    group('early (tricks 1-4)', sink.leads.filter(r => r.trick <= 4));
    group('late (tricks 8+)', sink.leads.filter(r => r.trick >= 8));

    console.log('\n  Sampler calibration over every defensive decision (belief vs truth, unseen cards):');
    console.log('    card class              n     bidder  bel/true     partner bel/true     buried  bel/true');
    for (const key of Object.keys(sink.calibration).sort()) {
        const row = sink.calibration[key];
        const b = (zone) => row.belief[zone] / row.n;
        const t = (zone) => row.truth[zone] / row.n;
        console.log(`    ${key.padEnd(20)} ${String(row.n).padStart(5)}    ${pct(b('bidder'))} /${pct(t('bidder'))}     ${pct(b('partner'))} /${pct(t('partner'))}     ${pct(b('buried'))} /${pct(t('buried'))}`);
    }
    console.log(`\n  done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

module.exports = { truthOf, beliefOf };
