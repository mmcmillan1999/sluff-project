// backend/scripts/simulate-defense.js
//
// Paired single-round harness for card-play changes. Every round is dealt
// from a seed, so two runs with different brains (or different RAVEN_* env
// settings) see IDENTICAL deals and identical bidding — the shared bid
// strategy is deterministic — and only the card play differs. That makes
// the bidder's average points a paired measurement: far more sensitive
// than whole-game win rates.
//
//   node scripts/simulate-defense.js 3000 raven counting sphinx --seed=500
//
// Seats: <subject> <partner> <opponent>. Rounds are grouped by who won the
// bid: when the OPPONENT bids the subject and partner defend (the defense
// read); when the SUBJECT bids it plays alone (the offense read); when the
// PARTNER bids the subject defends beside the opponent. Insurance is off.
// --json=FILE writes the per-round bidder points so two runs can be
// compared round by round.

'use strict';

const fs = require('fs');
const { brainNameFor, registerBrainProfile } = require('../src/core/bot-brains');
const { makeRng } = require('../src/core/bot-strategies/RolloutEstimator');
const { buildEngine, SEAT_POOL } = require('./simulate-brains');

const FLAGS = process.argv.slice(2).filter(arg => arg.startsWith('--'));
const ARGS = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
const flag = (name) => {
    const hit = FLAGS.find(arg => arg.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
};

const MAX_STEPS = 2000;

// Play exactly one scored round on a fresh engine; returns the round entry.
function playOneRound(seatNames) {
    const engine = buildEngine(seatNames);
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
            engine.currentTrickCards = [];
            engine.leadSuitCurrentTrick = null;
            engine.trickTurnPlayerId = engine.trickLeaderId;
            engine.state = 'Playing Phase';
            engine.turnStartedAt = Date.now();
            continue;
        }
        if (state === 'Playing Phase') {
            const id = engine.trickTurnPlayerId;
            const before = engine.currentTrickCards.length;
            const card = engine.bots[id].playCard();
            engine.playCard(id, card);
            if (engine.state === 'Playing Phase' && engine.currentTrickCards.length === before) {
                throw new Error(`stalled: ${engine.players[id].playerName} offered illegal ${card}`);
            }
            continue;
        }
        throw new Error(`unexpected state ${state}`);
    }
    throw new Error('runaway round');
}

const stat = () => ({ rounds: 0, points: 0, made: 0, sets: 0 });

if (require.main === module) {
    const rounds = Number(ARGS[0]) || 1000;
    const [subject = 'raven', partner = 'counting', opponent = 'sphinx'] = ARGS.slice(1);
    for (const brain of [subject, partner, opponent]) {
        if (!SEAT_POOL[brain]) throw new Error(`No sim seats for brain "${brain}"`);
    }
    // Distinct seat names even when two seats share a brain.
    const used = {};
    const seatNames = [subject, partner, opponent].map(brain => {
        const idx = used[brain] || 0;
        used[brain] = idx + 1;
        const name = SEAT_POOL[brain][idx % 3];
        registerBrainProfile(name, brain);
        return name;
    });
    const seedBase = Number(flag('seed')) || 500;
    const jsonPath = flag('json');

    const byBidder = { subject: stat(), partner: stat(), opponent: stat() };
    const perRound = [];
    const realLog = console.log;
    console.log = () => {};
    const t0 = Date.now();
    try {
        for (let i = 0; i < rounds; i += 1) {
            Math.random = makeRng(seedBase + i);
            const round = playOneRound(seatNames);
            const role = round.bidderName === seatNames[0] ? 'subject' : (round.bidderName === seatNames[1] ? 'partner' : 'opponent');
            const s = byBidder[role];
            s.rounds += 1;
            s.points += round.bidderCardPoints;
            if (round.bidderCardPoints > 60) s.made += 1;
            if (round.bidderCardPoints < 60) s.sets += 1;
            perRound.push({ i, role, bid: round.bidType, points: round.bidderCardPoints });
        }
    } finally { console.log = realLog; }

    console.log(`\n=== ${rounds} paired rounds · subject ${subject} · partner ${partner} · opponent ${opponent} · seed ${seedBase} ===`);
    const line = (label, s, who) => {
        if (!s.rounds) return;
        const avg = s.points / s.rounds;
        console.log(`  ${label.padEnd(34)} ${String(s.rounds).padStart(5)} rounds · bidder avg ${avg.toFixed(2).padStart(6)} pts · made ${(100 * s.made / s.rounds).toFixed(1).padStart(5)}% · set ${(100 * s.sets / s.rounds).toFixed(1).padStart(5)}%${who ? `  (${who})` : ''}`);
    };
    line(`DEFENSE · ${opponent} bids`, byBidder.opponent, `${subject} + ${partner} defend`);
    line(`DEFENSE · ${partner} bids`, byBidder.partner, `${subject} + ${opponent} defend`);
    line(`OFFENSE · ${subject} bids`, byBidder.subject, `${partner} + ${opponent} defend`);
    console.log(`  done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    if (jsonPath) {
        fs.writeFileSync(jsonPath, JSON.stringify({ rounds, seats: [subject, partner, opponent], seedBase, env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('RAVEN_'))), byBidder, perRound }));
    }
}

module.exports = { playOneRound };
