// backend/scripts/calibrate-sampler.js
//
// Measures where unseen Aces and 10s REALLY are, from a defender's seat, for
// the world sampler's key-card calibration (RolloutEstimator.keyCardCells /
// KEY_CARD_TABLE). Rounds are seeded and played by a rotating mix of brains
// so the table reflects good play in general rather than one bot's habits.
//
//   node scripts/calibrate-sampler.js 3000 --brains=raven,sphinx,counting,flytrap --seed=1 --out=cal-1.json
//   node scripts/calibrate-sampler.js --merge=cal-1.json,cal-2.json            # print the table
//   node scripts/calibrate-sampler.js --merge=... --blend=r-1.json,r-2.json     # average in a second population
//   node scripts/calibrate-sampler.js --merge=... --blend=... --write           # and write keyCardTable.json
//
// WHO PLAYS THE ROUNDS MATTERS. The simple brains cash a side ace the moment
// they can; the search brains (and good humans) hold one back. An unled side
// ace is the Solo bidder's 28% of the time when only simple brains play, 41%
// at a mixed table, and 59% when every seat is a search brain. The shipped
// table (Sept 2026) is 36,000 rounds of --brains=raven,sphinx,counting,flytrap
// — a mixed table. On the paired harness it beat both the simple-only table
// and an even blend of the two against every kind of bidder. --blend remains
// for averaging two populations by hand.
//
// The harness may look at hidden hands — that is what "truth" means here. The
// table it produces is keyed ONLY on public information, so a brain that uses
// it learns nothing a careful human at the table could not have counted.

'use strict';

const fs = require('fs');
const path = require('path');
const gameLogic = require('../src/core/logic');
const { registerBrainProfile } = require('../src/core/bot-brains');
const { buildPublicView } = require('../src/core/bot-strategies/PublicRoundView');
const { makeRng, keyCardCells } = require('../src/core/bot-strategies/RolloutEstimator');
const { buildEngine, SEAT_POOL } = require('./simulate-brains');

const FLAGS = process.argv.slice(2).filter(arg => arg.startsWith('--'));
const ARGS = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
const flag = (name) => {
    const hit = FLAGS.find(arg => arg === `--${name}` || arg.startsWith(`--${name}=`));
    if (!hit) return null;
    return hit.includes('=') ? hit.slice(name.length + 3) : true;
};

const TABLE_PATH = path.join(__dirname, '..', 'src', 'core', 'bot-strategies', 'keyCardTable.json');
const MIN_CELL = 400; // below this a cell defers to its coarser parent

const SUITS = ['H', 'D', 'C', 'S'];
const KEY_RANKS = ['A', '10'];
const MAX_STEPS = 2000;

function truthZone(engine, card, view) {
    if ((engine.hands[view.bidderName] || []).includes(card)) return 'bidder';
    for (const name of view.activeNames) {
        if (name !== view.bidderName && name !== view.botName && (engine.hands[name] || []).includes(card)) return 'partner';
    }
    return 'buried';
}

function observe(engine, name, counts) {
    const view = buildPublicView(engine, name);
    if (!view || view.botIsBidder) return;
    const seen = new Set([...view.myHand, ...view.playedSet]);
    // Revealed Frog widow cards are known to be the bidder's (hand or
    // discards); the sampler handles them separately.
    const shown = new Set(view.frog?.revealedWidow || []);
    for (const suit of SUITS) {
        for (const rank of KEY_RANKS) {
            const card = rank + suit;
            if (seen.has(card) || shown.has(card)) continue;
            const zone = truthZone(engine, card, view);
            for (const cell of keyCardCells(view, card)) {
                const row = counts[cell] = counts[cell] || { bidder: 0, partner: 0, buried: 0 };
                row[zone] += 1;
            }
        }
    }
}

function playOneRound(seatNames, counts) {
    const engine = buildEngine(seatNames);
    for (let step = 0; step < MAX_STEPS; step += 1) {
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
            engine.turnStartedAt = Date.now();
            continue;
        }
        if (state === 'Playing Phase') {
            const id = engine.trickTurnPlayerId;
            const name = engine.players[id].playerName;
            observe(engine, name, counts);
            const before = engine.currentTrickCards.length;
            const card = engine.bots[id].playCard();
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

function mergeCounts(files) {
    const merged = {};
    let rounds = 0;
    for (const file of files) {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        rounds += data.rounds;
        for (const [cell, row] of Object.entries(data.counts)) {
            const into = merged[cell] = merged[cell] || { bidder: 0, partner: 0, buried: 0 };
            for (const zone of Object.keys(into)) into[zone] += row[zone];
        }
    }
    return { rounds, counts: merged };
}

function cellOdds(row) {
    if (!row) return null;
    const n = row.bidder + row.partner + row.buried;
    return n > 0 ? { n, odds: [row.bidder / n, row.partner / n, row.buried / n] } : null;
}

// One population, or the even average of two. A finer cell ships only when
// every population measured it on at least MIN_CELL samples.
function buildTable(counts, blendCounts = null) {
    const table = {};
    const cells = new Set([...Object.keys(counts), ...Object.keys(blendCounts || {})]);
    for (const cell of cells) {
        const sources = [cellOdds(counts[cell]), blendCounts ? cellOdds(blendCounts[cell]) : null].filter(Boolean);
        if (sources.length === 0) continue;
        // The coarsest cells (no |L) always ship; finer ones need the sample.
        const thin = sources.some(source => source.n < MIN_CELL) || (blendCounts && sources.length < 2);
        if (cell.includes('|L') && thin) continue;
        table[cell] = [0, 1, 2].map(zone => (
            Math.round(1000 * sources.reduce((sum, source) => sum + source.odds[zone], 0) / sources.length) / 1000
        ));
    }
    return table;
}

if (require.main === module) {
    const merge = flag('merge');
    if (merge) {
        const { rounds, counts } = mergeCounts(String(merge).split(','));
        const blend = flag('blend') ? mergeCounts(String(flag('blend')).split(',')) : null;
        const table = buildTable(counts, blend ? blend.counts : null);
        console.log(`${rounds} rounds${blend ? ` + ${blend.rounds} blended in at equal weight` : ''} · ${Object.keys(counts).length} cells observed · ${Object.keys(table).length} kept (n >= ${MIN_CELL})\n`);
        console.log('  cell                           n    bidder partner  buried');
        for (const cell of Object.keys(counts).sort()) {
            const row = counts[cell];
            const n = row.bidder + row.partner + row.buried;
            const kept = table[cell] ? ' ' : '·';
            console.log(`${kept} ${cell.padEnd(26)} ${String(n).padStart(7)}   ${(100 * row.bidder / n).toFixed(1).padStart(5)}%  ${(100 * row.partner / n).toFixed(1).padStart(5)}%  ${(100 * row.buried / n).toFixed(1).padStart(5)}%`);
        }
        if (flag('write')) {
            const sorted = Object.fromEntries(Object.keys(table).sort().map(cell => [cell, table[cell]]));
            // --write=FILE audits a table elsewhere (see KEY_CARD_TABLE_PATH).
            const target = typeof flag('write') === 'string' ? flag('write') : TABLE_PATH;
            fs.writeFileSync(target, `${JSON.stringify({
                generated: 'scripts/calibrate-sampler.js',
                rounds,
                blendedRounds: blend ? blend.rounds : 0,
                zones: ['bidder', 'partner', 'buried'],
                table: sorted,
            }, null, 1)}\n`);
            console.log(`\nwrote ${target}`);
        }
        return;
    }

    const rounds = Number(ARGS[0]) || 10000;
    const brains = String(flag('brains') || 'raven,sphinx,counting,flytrap').split(',');
    for (const brain of brains) if (!SEAT_POOL[brain]) throw new Error(`No sim seats for brain "${brain}"`);
    const seedBase = Number(flag('seed')) || 1;
    const out = flag('out');
    const pick = makeRng(seedBase * 104729 + 7);
    const counts = {};

    const realLog = console.log;
    console.log = () => {};
    const t0 = Date.now();
    try {
        for (let i = 0; i < rounds; i += 1) {
            // A fresh trio each round; two seats may share a brain.
            const used = {};
            const seatNames = [0, 1, 2].map(() => {
                const brain = brains[Math.floor(pick() * brains.length)];
                const idx = used[brain] || 0;
                used[brain] = idx + 1;
                const name = SEAT_POOL[brain][idx % 3];
                registerBrainProfile(name, brain);
                return name;
            });
            Math.random = makeRng(seedBase * 1000003 + i);
            playOneRound(seatNames, counts);
        }
    } finally { console.log = realLog; }
    console.log(`${rounds} rounds · brains ${brains.join(',')} · ${Object.keys(counts).length} cells · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    if (out) fs.writeFileSync(out, JSON.stringify({ rounds, brains, seedBase, counts }));
}
