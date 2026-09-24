// backend/scripts/simulate-seat.js
//
// Paired WHOLE-ROUND harness: the score a seat takes from a round, bidding
// included. simulate-defense.js pairs card play only (bidding must match);
// a brain that bids differently changes who plays what, so the fair measure
// is the seat's score change on the identical deal. Seeded deals, one round
// each; an all-pass hand is thrown in and scores 0 (no redeal).
//
//   node scripts/simulate-seat.js 1000 opus-5.5 counting sphinx --seed=500 --json=out.json
//   node scripts/simulate-seat.js --compare base.json variant.json   (or base*.json -- var*.json)
//
// Insurance is off.

'use strict';

const fs = require('fs');
const { registerBrainProfile } = require('../src/core/bot-brains');
const { makeRng } = require('../src/core/bot-strategies/RolloutEstimator');
const { buildEngine, SEAT_POOL } = require('./simulate-brains');

const FLAGS = process.argv.slice(2).filter(arg => arg.startsWith('--'));
const ARGS = process.argv.slice(2).filter(arg => !arg.startsWith('--') || arg === '--');
const flag = (name) => {
    const hit = FLAGS.find(arg => arg === `--${name}` || arg.startsWith(`--${name}=`));
    if (!hit) return null;
    return hit.includes('=') ? hit.slice(name.length + 3) : true;
};

function playOneRound(seatNames) {
    const engine = buildEngine(seatNames);
    for (let step = 0; step < 2000; step += 1) {
        const state = engine.state;
        if (state === 'Awaiting Next Round Trigger' || state === 'Game Over') {
            const entry = engine.roundHistory[0];
            return { entry, trump: engine.trumpSuit, change: Object.fromEntries(seatNames.map(name => [name, engine.scores[name] - 120])) };
        }
        if (state === 'Dealing Pending') { engine.dealCards(engine.dealer); continue; }
        if (state === 'Bidding Phase') { const id = engine.biddingTurnPlayerId; engine.placeBid(id, engine.bots[id].decideBid()); continue; }
        if (state === 'Awaiting Frog Upgrade Decision') { const id = engine.biddingTurnPlayerId; engine.placeBid(id, engine.bots[id].decideFrogUpgrade()); continue; }
        if (state === 'AllPassWidowReveal') return { entry: null, change: Object.fromEntries(seatNames.map(name => [name, 0])) };
        if (state === 'Trump Selection') { const id = engine.bidWinnerInfo.userId; engine.chooseTrump(id, engine.bots[id].chooseTrump()); continue; }
        if (state === 'Frog Widow Exchange') { const id = engine.bidWinnerInfo.userId; engine.submitFrogDiscards(id, engine.bots[id].submitFrogDiscards()); continue; }
        if (state === 'Bid Announcement') { engine.state = 'Playing Phase'; continue; }
        if (state === 'TrickCompleteLinger') {
            engine.currentTrickCards = [];
            engine.leadSuitCurrentTrick = null;
            engine.trickTurnPlayerId = engine.trickLeaderId;
            engine.state = 'Playing Phase';
            continue;
        }
        if (state === 'Playing Phase') {
            const id = engine.trickTurnPlayerId;
            engine.playCard(id, engine.bots[id].playCard());
            continue;
        }
        throw new Error(`unexpected state ${state}`);
    }
    throw new Error('runaway round');
}

function load(files) {
    const rounds = new Map();
    for (const file of files) {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        for (const r of data.perRound) rounds.set(`${data.seedBase}:${r.i}`, r);
    }
    return rounds;
}

function compare(baseFiles, varFiles) {
    const base = load(baseFiles);
    const variant = load(varFiles);
    const groups = {};
    const add = (key, d) => { const g = groups[key] = groups[key] || { n: 0, s: 0, ss: 0 }; g.n += 1; g.s += d; g.ss += d * d; };
    for (const [k, b] of base) {
        const v = variant.get(k);
        if (!v) continue;
        const d = v.me - b.me;
        add('ALL', d);
        // Who ended up bidding, baseline -> variant.
        add(`bid: ${b.role} -> ${v.role}`, d);
    }
    const rows = Object.entries(groups).sort((a, b) => (a[0] === 'ALL' ? -1 : b[0] === 'ALL' ? 1 : b[1].n - a[1].n));
    for (const [key, g] of rows) {
        const mean = g.s / g.n;
        const se = Math.sqrt(Math.max(0, g.ss / g.n - mean * mean) / g.n);
        console.log(`  ${key.padEnd(34)} ${String(g.n).padStart(6)} rounds · seat score ${mean >= 0 ? '+' : ''}${mean.toFixed(2)} ±${se.toFixed(2)} (z ${(se ? mean / se : 0).toFixed(1)}) · total ${(g.s).toFixed(0)}`);
    }
}

if (require.main === module) {
    if (flag('compare')) {
        const files = ARGS;
        const split = files.indexOf('--');
        const [b, v] = split === -1 ? [[files[0]], [files[1]]] : [files.slice(0, split), files.slice(split + 1)];
        compare(b, v);
        process.exit(0);
    }
    const rounds = Number(ARGS[0]) || 500;
    const [subject = 'raven-1.2', partner = 'counting', opponent = 'sphinx'] = ARGS.slice(1);
    const used = {};
    const seatNames = [subject, partner, opponent].map(brain => {
        if (!SEAT_POOL[brain]) throw new Error(`No sim seats for brain "${brain}"`);
        const k = used[brain] || 0;
        used[brain] = k + 1;
        const name = SEAT_POOL[brain][k % 3];
        registerBrainProfile(name, brain);
        return name;
    });
    const seedBase = Number(flag('seed')) || 500;
    const perRound = [];
    const totals = { me: 0, bids: 0, made: 0, bidPts: 0 };
    const realLog = console.log;
    console.log = () => {};
    const t0 = Date.now();
    try {
        for (let i = 0; i < rounds; i += 1) {
            Math.random = makeRng(seedBase + i);
            const { entry, trump, change } = playOneRound(seatNames);
            const role = !entry ? 'none' : (entry.bidderName === seatNames[0] ? 'me' : 'other');
            const me = change[seatNames[0]];
            totals.me += me;
            if (role === 'me') { totals.bids += 1; totals.bidPts += entry.bidderCardPoints; if (entry.bidderCardPoints > 60) totals.made += 1; }
            perRound.push({ i, role, bid: entry ? entry.bidType : null, trump: entry ? trump : null, pts: entry ? entry.bidderCardPoints : null, me });
        }
    } finally { console.log = realLog; }
    console.log(`${rounds} rounds · ${seatNames.join(' / ')} · seed ${seedBase} · seat avg ${(totals.me / rounds).toFixed(2)} · bids ${totals.bids} (${(100 * totals.bids / rounds).toFixed(1)}%) made ${(100 * totals.made / Math.max(1, totals.bids)).toFixed(1)}% avg ${(totals.bidPts / Math.max(1, totals.bids)).toFixed(1)} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    const json = flag('json');
    if (json) fs.writeFileSync(json, JSON.stringify({ seats: [subject, partner, opponent], seedBase, perRound }));
}

module.exports = { playOneRound };
