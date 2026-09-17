// backend/scripts/compare-defense.js
//
// Round-by-round comparison of simulate-defense.js --json runs that shared a
// seed: the deals and the bidding are identical, so the difference in the
// bidder's points is the card play and nothing else.
//
//   node scripts/compare-defense.js baseline.json variant.json [more-variants.json ...]
//   node scripts/compare-defense.js base-*.json -- variant-*.json     # pooled seeds
//   ... --by-bid                                                      # split by contract
//
// Reads: "opponent bids" = the subject DEFENDS (lower is better for the
// variant), "partner bids" = the subject defends beside the opponent, and
// "subject bids" = the subject's own OFFENSE (higher is better).

'use strict';

const fs = require('fs');

const load = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

// Pool several runs (different seeds) into one keyed round list.
function pool(files) {
    const rounds = new Map();
    for (const file of files) {
        const data = load(file);
        for (const round of data.perRound) rounds.set(`${data.seedBase}:${round.i}`, round);
    }
    return rounds;
}

function compare(baseRounds, variantRounds, byBid = false) {
    const roles = {};
    let mismatched = 0;
    for (const [roundKey, base] of baseRounds) {
        const variant = variantRounds.get(roundKey);
        if (!variant) continue;
        if (variant.role !== base.role || variant.bid !== base.bid) { mismatched += 1; continue; }
        const group = byBid ? `${base.role}|${base.bid}` : base.role;
        const row = roles[group] = roles[group] || { n: 0, sum: 0, sumSq: 0, basePts: 0, swing: 0, madeBase: 0, madeVar: 0 };
        const diff = variant.points - base.points;
        row.n += 1;
        row.sum += diff;
        row.sumSq += diff * diff;
        row.basePts += base.points;
        if (diff !== 0) row.swing += 1;
        if (base.points > 60) row.madeBase += 1;
        if (variant.points > 60) row.madeVar += 1;
    }
    return { roles, mismatched };
}

if (require.main === module) {
    const byBid = process.argv.includes('--by-bid');
    const args = process.argv.slice(2).filter(arg => arg !== '--by-bid');
    const split = args.indexOf('--');
    const groups = split === -1
        ? [[args[0]], ...args.slice(1).map(file => [file])]
        : [args.slice(0, split), args.slice(split + 1)];
    if (groups.length < 2 || groups.some(group => group.length === 0 || !group[0])) {
        console.error('usage: compare-defense.js baseline.json variant.json [...]   |   base*.json -- variant*.json');
        process.exit(1);
    }
    const baseRounds = pool(groups[0]);
    const label = { opponent: 'DEFENSE  (opponent bids)', partner: 'DEFENSE  (partner bids) ', subject: 'OFFENSE  (subject bids) ' };
    for (const group of groups.slice(1)) {
        const { roles, mismatched } = compare(baseRounds, pool(group), byBid);
        console.log(`\n${group.length === 1 ? group[0] : `${group.length} pooled runs`}  vs  ${groups[0].length === 1 ? groups[0][0] : `${groups[0].length} pooled baselines`}${mismatched ? `   (${mismatched} rounds skipped: bidding differed)` : ''}`);
        const keys = byBid
            ? ['opponent', 'partner', 'subject'].flatMap(role => ['Frog', 'Solo', 'Heart Solo'].map(bid => `${role}|${bid}`))
            : ['opponent', 'partner', 'subject'];
        for (const key of keys) {
            const row = roles[key];
            if (!row) continue;
            const [role, bid] = key.split('|');
            const mean = row.sum / row.n;
            const se = Math.sqrt(Math.max(0, row.sumSq / row.n - mean * mean) / row.n);
            const z = se > 0 ? mean / se : 0;
            console.log(`  ${label[role]}${bid ? ` ${bid.padEnd(10)}` : ''} ${String(row.n).padStart(6)} rounds · bidder pts ${mean >= 0 ? '+' : ''}${mean.toFixed(2)} ±${se.toFixed(2)} (z ${z.toFixed(1)}) · baseline avg ${(row.basePts / row.n).toFixed(1)} · made ${(100 * row.madeBase / row.n).toFixed(1)}% -> ${(100 * row.madeVar / row.n).toFixed(1)}% · ${(100 * row.swing / row.n).toFixed(0)}% of rounds differ`);
        }
    }
}

module.exports = { pool, compare };
