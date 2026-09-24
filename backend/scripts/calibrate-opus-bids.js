// backend/scripts/calibrate-opus-bids.js
//
// Measures how far Opus 5.5's face-up bid playouts (bot-brains/opusBidding.js)
// over-state a bidder's real points. Plays whole rounds at a simulated table,
// and for every round that is bid, prices the winning bidder's dealt hand for
// the contract (and trump) actually played — uncalibrated — next to the points
// the bidder really took. The mean gap per bid type is the calibration.
//
//   node scripts/calibrate-opus-bids.js 2000 --seed=31000 [--brains=raven-1.2,raven-1.2,raven-1.2] [--write]

'use strict';

const fs = require('fs');
const path = require('path');
const { makeRng } = require('../src/core/bot-strategies/RolloutEstimator');
const opusBidding = require('../src/core/bot-brains/opusBidding');
const { buildEngine, SEAT_POOL } = require('./simulate-brains');

const FLAGS = process.argv.slice(2).filter(arg => arg.startsWith('--'));
const ARGS = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
const flag = (name) => {
    const hit = FLAGS.find(arg => arg === `--${name}` || arg.startsWith(`--${name}=`));
    if (!hit) return null;
    return hit.includes('=') ? hit.slice(name.length + 3) : true;
};

function playRound(seatNames) {
    const engine = buildEngine(seatNames);
    let dealt = null;
    for (let step = 0; step < 2000; step += 1) {
        const state = engine.state;
        if (state === 'Awaiting Next Round Trigger' || state === 'Game Over') {
            const entry = engine.roundHistory[0];
            return entry && dealt ? { entry, dealt, trump: engine.trumpSuit } : null;
        }
        if (state === 'Dealing Pending') {
            engine.dealCards(engine.dealer);
            dealt = Object.fromEntries(seatNames.map(name => [name, [...engine.hands[name]]]));
            continue;
        }
        if (state === 'Bidding Phase') { const id = engine.biddingTurnPlayerId; engine.placeBid(id, engine.bots[id].decideBid()); continue; }
        if (state === 'Awaiting Frog Upgrade Decision') { const id = engine.biddingTurnPlayerId; engine.placeBid(id, engine.bots[id].decideFrogUpgrade()); continue; }
        if (state === 'AllPassWidowReveal') return null;
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
        if (state === 'Playing Phase') { const id = engine.trickTurnPlayerId; engine.playCard(id, engine.bots[id].playCard()); continue; }
        throw new Error(`unexpected state ${state}`);
    }
    return null;
}

if (require.main === module) {
    const rounds = Number(ARGS[0]) || 500;
    const seedBase = Number(flag('seed')) || 31000;
    const brains = String(flag('brains') || 'raven-1.2,raven-1.2,raven-1.2').split(',');
    const used = {};
    const seatNames = brains.map(brain => { const k = used[brain] || 0; used[brain] = k + 1; return SEAT_POOL[brain][k % 3]; });
    const rows = {};
    const perRound = [];
    const realLog = console.log;
    console.log = () => {};
    try {
        for (let i = 0; i < rounds; i += 1) {
            Math.random = makeRng(seedBase + i);
            const played = playRound(seatNames);
            if (!played) continue;
            const { entry, dealt, trump } = played;
            const key = entry.bidType === 'Solo' ? `Solo ${trump}` : entry.bidType;
            const values = opusBidding.contractValues(dealt[entry.bidderName], { seed: seedBase * 13 + i, calibration: {} });
            const predicted = values[key]?.points;
            if (!Number.isFinite(predicted)) continue;
            const row = rows[entry.bidType] = rows[entry.bidType] || { n: 0, gap: 0, gapSq: 0, pred: 0, real: 0 };
            const gap = predicted - entry.bidderCardPoints;
            row.n += 1; row.gap += gap; row.gapSq += gap * gap; row.pred += predicted; row.real += entry.bidderCardPoints;
            perRound.push({ i, bid: entry.bidType, key, predicted, real: entry.bidderCardPoints });
        }
    } finally { console.log = realLog; }
    const offsets = {};
    console.log(`${rounds} rounds · table ${brains.join(', ')}`);
    for (const [bid, row] of Object.entries(rows)) {
        const mean = row.gap / row.n;
        const se = Math.sqrt(Math.max(0, row.gapSq / row.n - mean * mean) / row.n);
        offsets[bid] = Number(mean.toFixed(2));
        console.log(`  ${bid.padEnd(11)} ${String(row.n).padStart(5)} bids · predicted ${(row.pred / row.n).toFixed(1)} · real ${(row.real / row.n).toFixed(1)} · gap ${mean.toFixed(2)} ±${se.toFixed(2)}`);
    }
    const write = flag('write');
    if (write) {
        const file = write === true ? path.join(__dirname, '../src/core/bot-brains/opusBidCalibration.json') : write;
        fs.writeFileSync(file, JSON.stringify({ measured: new Date().toISOString().slice(0, 10), source: `${rounds} rounds, seed ${seedBase}, table ${brains.join(',')}`, offsets }, null, 2));
        console.log(`wrote ${file}`);
    }
    const dump = flag('json');
    if (dump) fs.writeFileSync(dump, JSON.stringify(perRound));
}
