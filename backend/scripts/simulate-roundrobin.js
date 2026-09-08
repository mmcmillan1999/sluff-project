// backend/scripts/simulate-roundrobin.js
//
// Round-robin strength table for the live bot brains. Every distinct trio of
// brains plays the same number of games (random seating and dealer each
// game, insurance off — see simulate-brains.js), so each brain meets every
// other brain equally often and the win rates are directly comparable:
// chance is one third for everyone.
//
//   node scripts/simulate-roundrobin.js 500                 # all trios, 500 games each, report
//   node scripts/simulate-roundrobin.js 2000 --only=3 --out=DIR --seed=7
//                                                           # one trio (index 3) to DIR/trio-3.json
//   node scripts/simulate-roundrobin.js --report=DIR        # merge DIR/*.json and print the table
//   node scripts/simulate-roundrobin.js 500 --brains=raven,sphinx,coyote
//
// Per brain the report gives: games, game-win rate, average final score,
// bidding (rounds, average card points, made rate) and defending (rounds,
// set rate — each defender is credited when the bidder is set, so it mixes
// in the partner's play, but it is the same mix for every brain).

'use strict';

const fs = require('fs');
const path = require('path');
const { brainNameFor } = require('../src/core/bot-brains');
const { shuffle } = require('../src/utils/shuffle');
const { makeRng } = require('../src/core/bot-strategies/RolloutEstimator');
const { playOneGame, SEAT_POOL } = require('./simulate-brains');

const FLAGS = process.argv.slice(2).filter(arg => arg.startsWith('--'));
const ARGS = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
const flag = (name) => {
    const hit = FLAGS.find(arg => arg.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
};

const DEFAULT_BRAINS = ['counting', 'flytrap', 'sphinx', 'coyote', 'raven'];

function trios(brains) {
    const out = [];
    for (let a = 0; a < brains.length; a += 1) {
        for (let b = a + 1; b < brains.length; b += 1) {
            for (let c = b + 1; c < brains.length; c += 1) out.push([brains[a], brains[b], brains[c]]);
        }
    }
    return out;
}

const emptyStats = () => ({
    games: 0, wins: 0, scoreSum: 0,
    bidRounds: 0, bidPoints: 0, bidMade: 0,
    defRounds: 0, defSets: 0,
});

// Play one trio; returns per-brain stats for it.
function playTrio(trio, games) {
    const seatNames = trio.map(brain => SEAT_POOL[brain][0]);
    const stats = Object.fromEntries(trio.map(brain => [brain, emptyStats()]));
    const realLog = console.log;
    console.log = () => {};
    try {
        for (let i = 0; i < games; i += 1) {
            const result = playOneGame(shuffle([...seatNames]));
            for (const name of seatNames) {
                const s = stats[brainNameFor(name)];
                s.games += 1;
                s.scoreSum += result.scores[name];
            }
            for (const winner of result.winners) stats[brainNameFor(winner)].wins += 1 / result.winners.length;
            for (const round of result.roundHistory) {
                const bidder = stats[brainNameFor(round.bidderName)];
                bidder.bidRounds += 1;
                bidder.bidPoints += round.bidderCardPoints;
                if (round.bidderCardPoints > 60) bidder.bidMade += 1;
                for (const name of seatNames) {
                    if (name === round.bidderName) continue;
                    const defender = stats[brainNameFor(name)];
                    defender.defRounds += 1;
                    if (round.bidderCardPoints < 60) defender.defSets += 1;
                }
            }
        }
    } finally { console.log = realLog; }
    return stats;
}

function merge(into, from) {
    for (const [brain, s] of Object.entries(from)) {
        const t = into[brain] || (into[brain] = emptyStats());
        for (const key of Object.keys(s)) t[key] += s[key];
    }
    return into;
}

function report(totals, { gamesPerTrio = null, trioCount = null } = {}) {
    const rows = Object.entries(totals)
        .map(([brain, s]) => ({
            brain,
            games: s.games,
            winPct: s.games ? 100 * s.wins / s.games : 0,
            avgScore: s.games ? s.scoreSum / s.games : 0,
            bidRounds: s.bidRounds,
            bidAvg: s.bidRounds ? s.bidPoints / s.bidRounds : 0,
            madePct: s.bidRounds ? 100 * s.bidMade / s.bidRounds : 0,
            defRounds: s.defRounds,
            setPct: s.defRounds ? 100 * s.defSets / s.defRounds : 0,
        }))
        .sort((a, b) => b.winPct - a.winPct);
    const header = gamesPerTrio
        ? `Round-robin: ${trioCount} trios × ${gamesPerTrio} games (chance = 33.3% per seat)`
        : 'Round-robin (chance = 33.3% per seat)';
    console.log(`\n=== ${header} ===`);
    console.log('  brain     games   win%   ±SE   avg score | bids   avg pts  made% | defends  set%');
    for (const r of rows) {
        const se = r.games ? 100 * Math.sqrt((r.winPct / 100) * (1 - r.winPct / 100) / r.games) : 0;
        console.log(
            `  ${r.brain.padEnd(8)} ${String(r.games).padStart(6)}  ${r.winPct.toFixed(1).padStart(5)}  ±${se.toFixed(1)}  ${r.avgScore.toFixed(1).padStart(9)} | `
            + `${String(r.bidRounds).padStart(5)}  ${r.bidAvg.toFixed(1).padStart(7)}  ${r.madePct.toFixed(1).padStart(5)} | `
            + `${String(r.defRounds).padStart(7)}  ${r.setPct.toFixed(1).padStart(5)}`,
        );
    }
    return rows;
}

if (require.main === module) {
    const reportDir = flag('report');
    if (reportDir) {
        const totals = {};
        let trioCount = 0;
        let gamesPerTrio = null;
        for (const file of fs.readdirSync(reportDir).filter(f => f.endsWith('.json')).sort()) {
            const saved = JSON.parse(fs.readFileSync(path.join(reportDir, file), 'utf8'));
            merge(totals, saved.stats);
            trioCount += 1;
            gamesPerTrio = saved.games;
            console.log(`  ${file}: ${saved.trio.join(' vs ')} — ${saved.games} games`);
        }
        report(totals, { gamesPerTrio, trioCount });
        process.exit(0);
    }

    const games = Number(ARGS[0]) || 500;
    const brains = (flag('brains') || DEFAULT_BRAINS.join(',')).split(',').map(s => s.trim()).filter(Boolean);
    for (const brain of brains) {
        if (!SEAT_POOL[brain]) throw new Error(`No sim seats for brain "${brain}" (see SEAT_POOL in simulate-brains.js)`);
    }
    const all = trios(brains);
    const only = flag('only');
    const chosen = only === null ? all : [all[Number(only)]];
    if (chosen.some(t => !t)) throw new Error(`--only must be 0..${all.length - 1}`);
    const seed = flag('seed');
    if (seed !== null) Math.random = makeRng(Number(seed) + (only === null ? 0 : Number(only)));
    const outDir = flag('out');

    console.log(`Round-robin: ${chosen.length} of ${all.length} trios, ${games} games each, brains ${brains.join(', ')}.`);
    const t0 = Date.now();
    const totals = {};
    chosen.forEach((trio, i) => {
        const stats = playTrio(trio, games);
        merge(totals, stats);
        const index = only === null ? i : Number(only);
        console.log(`  trio ${index} ${trio.join(' vs ')}: ${Object.entries(stats).map(([b, s]) => `${b} ${(100 * s.wins / s.games).toFixed(1)}%`).join(', ')}`);
        if (outDir) {
            fs.mkdirSync(outDir, { recursive: true });
            fs.writeFileSync(path.join(outDir, `trio-${index}.json`), JSON.stringify({ trio, games, stats }, null, 2));
        }
    });
    if (only === null) report(totals, { gamesPerTrio: games, trioCount: chosen.length });
    console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
}

module.exports = { trios, playTrio, merge, report, DEFAULT_BRAINS };
