// backend/scripts/fit-play-model.js
//
// Fits the card-play model Opus 5.5 reads the table with
// (src/core/bot-brains/playInference.js): a multinomial logit over features
// of each legal card, seen from the acting seat only (own hand, cards played,
// the live trick). Data = every non-forced play at simulated tables of mixed
// brains, so the model describes "sensible play" rather than one brain's
// habits.
//
//   node scripts/fit-play-model.js 1500 --seed=9000 [--brains=counting,sphinx,...] [--write[=file]]
//
// Prints the held-out log-likelihood per decision against a uniform guess.

'use strict';

const fs = require('fs');
const path = require('path');
const { makeRng } = require('../src/core/bot-strategies/RolloutEstimator');
const { buildPublicView } = require('../src/core/bot-strategies/PublicRoundView');
const inference = require('../src/core/bot-brains/playInference');
const search = require('../src/core/bot-brains/ravenSearch');
const { buildEngine, SEAT_POOL } = require('./simulate-brains');

const FLAGS = process.argv.slice(2).filter(arg => arg.startsWith('--'));
const ARGS = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
const flag = (name) => {
    const hit = FLAGS.find(arg => arg === `--${name}` || arg.startsWith(`--${name}=`));
    if (!hit) return null;
    return hit.includes('=') ? hit.slice(name.length + 3) : true;
};

const masks = (cards) => {
    const m = [0, 0, 0, 0];
    for (const card of cards) { const idx = search.cardIdx(card); m[(idx / 9) | 0] |= 1 << (idx % 9); }
    return m;
};

// Play one round, recording each non-forced play's features.
function recordRound(seatNames, out) {
    const engine = buildEngine(seatNames);
    for (let step = 0; step < 2000; step += 1) {
        const state = engine.state;
        if (state === 'Awaiting Next Round Trigger' || state === 'Game Over') return;
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
            continue;
        }
        if (state === 'Playing Phase') {
            const id = engine.trickTurnPlayerId;
            const name = engine.players[id].playerName;
            const view = buildPublicView(engine, name);
            const card = engine.bots[id].playCard();
            if (view && view.activeNames.length === 3) {
                const seats = view.activeNames;
                const ctx = {
                    hand: masks(view.myHand),
                    played: masks([...view.playedSet]),
                    plays: view.partialTrick.map(p => { const idx = search.cardIdx(p.card); return { p: seats.indexOf(p.playerName), s: (idx / 9) | 0, r: idx % 9 }; }),
                    trump: search.SUIT_IDX[view.trumpSuit],
                    broken: view.trumpBroken,
                    bidder: seats.indexOf(view.bidderName),
                    actor: seats.indexOf(name),
                };
                const { cards, feats } = inference.cardFeatures(ctx);
                const chosen = cards.indexOf(search.cardIdx(card));
                if (cards.length > 1 && chosen !== -1) out.push({ feats: feats.map(f => Array.from(f)), chosen, brain: name });
            }
            engine.playCard(id, card);
            continue;
        }
        throw new Error(`unexpected state ${state}`);
    }
}

// Mean log-likelihood per decision.
function meanLL(data, w, epsilon = 0) {
    let total = 0;
    for (const d of data) {
        const z = d.feats.map(f => f.reduce((s, v, k) => s + v * w[k], 0));
        const max = Math.max(...z);
        const e = z.map(v => Math.exp(v - max));
        const sum = e.reduce((s, v) => s + v, 0);
        const p = e[d.chosen] / sum;
        total += Math.log((1 - epsilon) * p + epsilon / z.length);
    }
    return total / data.length;
}

// Full-batch Adam on the multinomial logit with a small L2 penalty.
function fit(data, nf, { iters = 400, lr = 0.05, l2 = 1e-3 } = {}) {
    const w = new Array(nf).fill(0);
    const m = new Array(nf).fill(0);
    const v = new Array(nf).fill(0);
    for (let t = 1; t <= iters; t += 1) {
        const g = new Array(nf).fill(0);
        for (const d of data) {
            const z = d.feats.map(f => f.reduce((s, x, k) => s + x * w[k], 0));
            const max = Math.max(...z);
            const e = z.map(x => Math.exp(x - max));
            const sum = e.reduce((s, x) => s + x, 0);
            for (let i = 0; i < d.feats.length; i += 1) {
                const p = e[i] / sum;
                const y = i === d.chosen ? 1 : 0;
                const f = d.feats[i];
                for (let k = 0; k < nf; k += 1) if (f[k] !== 0) g[k] += (y - p) * f[k];
            }
        }
        for (let k = 0; k < nf; k += 1) {
            const grad = g[k] / data.length - l2 * w[k];
            m[k] = 0.9 * m[k] + 0.1 * grad;
            v[k] = 0.999 * v[k] + 0.001 * grad * grad;
            const mh = m[k] / (1 - 0.9 ** t);
            const vh = v[k] / (1 - 0.999 ** t);
            w[k] += lr * mh / (Math.sqrt(vh) + 1e-8);
        }
    }
    return w;
}

if (require.main === module) {
    const rounds = Number(ARGS[0]) || 1000;
    const seedBase = Number(flag('seed')) || 9000;
    const brains = String(flag('brains') || 'counting,flytrap,sphinx,coyote,raven-1.2').split(',');
    for (const brain of brains) if (!SEAT_POOL[brain]) throw new Error(`No sim seats for brain "${brain}"`);
    const data = [];
    const realLog = console.log;
    console.log = () => {};
    const t0 = Date.now();
    try {
        for (let i = 0; i < rounds; i += 1) {
            Math.random = makeRng(seedBase + i);
            // A fresh random trio of brains every round (repeats allowed).
            const pick = () => brains[Math.floor(Math.random() * brains.length)];
            const trio = [pick(), pick(), pick()];
            const used = {};
            const seatNames = trio.map(brain => { const k = used[brain] || 0; used[brain] = k + 1; return SEAT_POOL[brain][k % 3]; });
            recordRound(seatNames, data);
        }
    } finally { console.log = realLog; }
    const nf = inference.FEATURES.length;
    const cut = Math.floor(data.length * 0.8);
    const train = data.slice(0, cut);
    const test = data.slice(cut);
    const uniform = test.reduce((s, d) => s - Math.log(d.feats.length), 0) / test.length;
    const w = fit(train, nf);
    console.log(`${data.length} decisions from ${rounds} rounds in ${((Date.now() - t0) / 1000).toFixed(0)}s (${brains.join(', ')})`);
    console.log(`held-out log-lik / decision: model ${meanLL(test, w).toFixed(3)} · with eps 0.1 ${meanLL(test, w, 0.1).toFixed(3)} · uniform ${uniform.toFixed(3)}`);
    for (const brain of brains) {
        const sub = test.filter(d => SEAT_POOL[brain].includes(d.brain));
        if (sub.length) console.log(`  ${brain.padEnd(10)} ${String(sub.length).padStart(6)} decisions · model ${meanLL(sub, w).toFixed(3)} · uniform ${(sub.reduce((s, d) => s - Math.log(d.feats.length), 0) / sub.length).toFixed(3)}`);
    }
    inference.FEATURES.forEach((name, k) => console.log(`  ${name.padEnd(18)} ${w[k].toFixed(3)}`));
    const write = flag('write');
    if (write) {
        const file = write === true ? path.join(__dirname, '../src/core/bot-brains/playModel.json') : write;
        fs.writeFileSync(file, JSON.stringify({
            fitted: new Date().toISOString().slice(0, 10),
            source: `${rounds} simulated rounds, seed ${seedBase}, brains ${brains.join(',')}`,
            decisions: data.length,
            features: inference.FEATURES,
            weights: w.map(x => Number(x.toFixed(4))),
        }, null, 2));
        console.log(`wrote ${file}`);
    }
}

module.exports = { recordRound, fit, meanLL };
