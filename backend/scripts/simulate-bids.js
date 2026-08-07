// backend/scripts/simulate-bids.js
//
// Bid-strategy tournament: the top three card-play brains (sphinx, flytrap,
// coyote) sit at every table while the BID strategies rotate across seats —
// each game seats three different strategies in direct auction competition,
// and over every 4-game cycle each (brain, strategy) pairing occurs equally,
// so no strategy owes its numbers to a brain or a chair.
//
//   node scripts/simulate-bids.js            # 2000 games, all strategies
//   node scripts/simulate-bids.js 6000       # more games
//   node scripts/simulate-bids.js 6000 points,control   # head-to-head subset
//
// Reads: per-strategy win rate (vs 33.3% chance), net points per seat-game,
// bid volume/mix, made%, and net points per bid — plus the brain x strategy
// matrix to spot interactions.

'use strict';

const { playOneGame } = require('./simulate-brains');
const { registerBidProfile, BID_STRATEGIES } = require('../src/core/bidAdvice');
const { shuffle } = require('../src/utils/shuffle');

// simulate-brains registered these synthetic names with their brains.
const SEATS = [
    { name: 'Sphinx A', brain: 'sphinx' },
    { name: 'Mike Knight', brain: 'flytrap' },
    { name: 'Coyote A', brain: 'coyote' },
];

const games = Number(process.argv[2]) || 2000;
const strategyNames = (process.argv[3] || Object.keys(BID_STRATEGIES).join(','))
    .split(',').map(s => s.trim()).filter(s => BID_STRATEGIES[s]);
if (strategyNames.length < 2) {
    console.error(`Need at least 2 known strategies (have: ${Object.keys(BID_STRATEGIES).join(', ')})`);
    process.exit(1);
}

console.log(`Bid-strategy tournament: ${strategyNames.join(' vs ')} — ${games} games`);
console.log(`Brains at every table: ${SEATS.map(s => s.brain).join(', ')}\n`);

const stratStats = Object.fromEntries(strategyNames.map(s => [s, {
    seatGames: 0, wins: 0, scoreSum: 0,
    bids: 0, made: 0, bidderNet: 0, bidderPoints: 0,
    byType: { Frog: 0, Solo: 0, 'Heart Solo': 0 },
    worstLoss: 0,
}]));
const matrix = {}; // `${brain}|${strat}` -> { seatGames, wins }
let completedRounds = 0;
let dealsTotal = 0;

const realLog = console.log;
console.log = () => {};
const t0 = Date.now();
try {
    for (let g = 0; g < games; g += 1) {
        // Rotation: seat i takes strategy (g + i) mod N — every brain plays
        // every strategy equally across each N-game cycle, three distinct
        // strategies per table whenever N >= 3.
        const assignment = {};
        SEATS.forEach((seat, i) => {
            const strat = strategyNames[(g + i) % strategyNames.length];
            assignment[seat.name] = strat;
            registerBidProfile(seat.name, strat);
        });

        const result = playOneGame(shuffle(SEATS.map(s => s.name)));
        dealsTotal += result.rounds;
        completedRounds += result.roundHistory.length;

        for (const seat of SEATS) {
            const strat = assignment[seat.name];
            const s = stratStats[strat];
            s.seatGames += 1;
            s.scoreSum += result.scores[seat.name];
            if (result.winners.includes(seat.name)) s.wins += 1 / result.winners.length;
            const key = `${seat.brain}|${strat}`;
            matrix[key] = matrix[key] || { seatGames: 0, wins: 0 };
            matrix[key].seatGames += 1;
            if (result.winners.includes(seat.name)) matrix[key].wins += 1 / result.winners.length;
        }

        for (const round of result.roundHistory) {
            const strat = assignment[round.bidderName];
            if (!strat) continue;
            const s = stratStats[strat];
            const change = Number(round.pointChanges?.[round.bidderName]) || 0;
            s.bids += 1;
            s.bidderPoints += round.bidderCardPoints;
            s.bidderNet += change;
            if (round.bidderCardPoints > 60) s.made += 1;
            if (round.bidType in s.byType) s.byType[round.bidType] += 1;
            if (change < s.worstLoss) s.worstLoss = change;
        }
    }
} finally { console.log = realLog; }

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
const allPass = dealsTotal - completedRounds;
console.log(`${games} games in ${elapsed}s — ${completedRounds} rounds, ${allPass} all-pass redeals (${(100 * allPass / dealsTotal).toFixed(1)}%)\n`);

const rows = strategyNames.map(name => {
    const s = stratStats[name];
    return {
        name,
        winPct: 100 * s.wins / s.seatGames,
        netPerGame: (s.scoreSum - 120 * s.seatGames) / s.seatGames,
        bidsPerGame: s.bids / s.seatGames,
        mix: `${s.byType.Frog}F/${s.byType.Solo}S/${s.byType['Heart Solo']}H`,
        madePct: s.bids ? 100 * s.made / s.bids : 0,
        netPerBid: s.bids ? s.bidderNet / s.bids : 0,
        avgPts: s.bids ? s.bidderPoints / s.bids : 0,
        worstLoss: s.worstLoss,
    };
}).sort((a, b) => b.winPct - a.winPct);

console.log('strategy   win% (33.3 chance)  net pts/game   bids/game   mix (F/S/H)      made%   net/bid   avg pts   worst');
for (const r of rows) {
    console.log(`${r.name.padEnd(10)} ${r.winPct.toFixed(1).padStart(6)}            ${r.netPerGame.toFixed(1).padStart(8)}       ${r.bidsPerGame.toFixed(2).padStart(6)}    ${r.mix.padEnd(15)} ${r.madePct.toFixed(1).padStart(6)}   ${r.netPerBid.toFixed(1).padStart(6)}   ${r.avgPts.toFixed(1).padStart(6)}   ${String(r.worstLoss).padStart(5)}`);
}

console.log('\nbrain x strategy win% (each cell equal exposure):');
const header = ['brain'.padEnd(9)].concat(strategyNames.map(s => s.padStart(9))).join('');
console.log(header);
for (const seat of SEATS) {
    const cells = strategyNames.map(strat => {
        const m = matrix[`${seat.brain}|${strat}`];
        return m ? (100 * m.wins / m.seatGames).toFixed(1).padStart(9) : '—'.padStart(9);
    });
    console.log(seat.brain.padEnd(9) + cells.join(''));
}
