// backend/scripts/simulate-brains.js
//
// Offline bot-vs-bot simulator: full games in-process, no database, no
// sockets, no server involvement. Usage:
//
//   node scripts/simulate-brains.js          # standard matchups, 500 games each
//   node scripts/simulate-brains.js 5000     # same, 5000 games each
//
// Brains resolve exactly as in production (bot-brains/ by name). Insurance
// is left at its never-crossing defaults so every round settles on cards
// alone — the cleanest read on card play, which is what the brains differ
// in. Bidding/trump/discard logic is shared, so hands are the only luck and
// seats rotate via a random dealer each game.

'use strict';

const GameEngine = require('../src/core/GameEngine');
const BotPlayer = require('../src/core/BotPlayer');
const { PLACEHOLDER_ID } = require('../src/core/constants');
const { brainNameFor } = require('../src/core/bot-brains');

const MAX_ROUNDS_PER_GAME = 300;

// One seat name per brain arm (names drive brain resolution in production).
const SEAT_POOL = {
    classic: ['Ace McGraw', 'Buck Wilder', 'Mabel Moon'],
    counting: ['Kimba', 'Grampa Blane', 'Courtney Sr.'],
    flytrap: ['Mike Knight', 'Dolly Deal', 'Rosie Rounds'],
};
const seats = (...brains) => brains.map((brain, i) => SEAT_POOL[brain][i % 3]);

function buildEngine(seatNames) {
    const engine = new GameEngine(`sim-${Math.random().toString(36).slice(2)}`, 'fort-creek', 'Sim', () => {});
    seatNames.forEach((name, i) => {
        const id = i + 1;
        engine.players[id] = { userId: id, playerName: name, socketId: null, isSpectator: false, disconnected: false, isBot: true, tokens: 'N/A' };
        engine.bots[id] = new BotPlayer(id, name, engine);
        engine.scores[name] = 120;
        engine.playerOrder.add(id);
    });
    engine.playerMode = 3;
    engine.gameStarted = true;
    engine.gameId = null; // keeps every analytics effect a no-op
    engine.scores[PLACEHOLDER_ID] = 120;
    engine.dealer = engine.playerOrder.allIds[Math.floor(Math.random() * 3)];
    engine.playerOrder.setTurnOrder(engine.dealer, false);
    engine._initializeNewRoundState();
    engine.state = 'Dealing Pending';
    return engine;
}

// Drive one full game synchronously.
function playOneGame(seatNames) {
    const engine = buildEngine(seatNames);
    let rounds = 0;

    while (engine.state !== 'Game Over') {
        if (rounds > MAX_ROUNDS_PER_GAME) throw new Error('runaway game');

        if (engine.state === 'Dealing Pending') {
            engine.dealCards(engine.dealer);
            rounds += 1;
            continue;
        }
        if (engine.state === 'Bidding Phase') {
            const bidderId = engine.biddingTurnPlayerId;
            engine.placeBid(bidderId, engine.bots[bidderId].decideBid());
            continue;
        }
        if (engine.state === 'Awaiting Frog Upgrade Decision') {
            const bidderId = engine.biddingTurnPlayerId;
            engine.placeBid(bidderId, engine.bots[bidderId].decideFrogUpgrade());
            continue;
        }
        if (engine.state === 'AllPassWidowReveal') {
            engine._advanceRound();
            continue;
        }
        if (engine.state === 'Trump Selection') {
            const bidderId = engine.bidWinnerInfo.userId;
            engine.chooseTrump(bidderId, engine.bots[bidderId].chooseTrump());
            continue;
        }
        if (engine.state === 'Frog Widow Exchange') {
            const bidderId = engine.bidWinnerInfo.userId;
            engine.submitFrogDiscards(bidderId, engine.bots[bidderId].submitFrogDiscards());
            continue;
        }
        if (engine.state === 'Bid Announcement') {
            engine.state = 'Playing Phase'; // skip the client fanfare timer
            continue;
        }
        if (engine.state === 'TrickCompleteLinger') {
            // Replicate the linger timeout: winner leads the next trick.
            engine.currentTrickCards = [];
            engine.leadSuitCurrentTrick = null;
            engine.trickTurnPlayerId = engine.trickLeaderId;
            engine.state = 'Playing Phase';
            engine.turnStartedAt = Date.now();
            continue;
        }
        if (engine.state === 'Playing Phase') {
            const turnId = engine.trickTurnPlayerId;
            const before = engine.currentTrickCards.length;
            const card = engine.bots[turnId].playCard();
            engine.playCard(turnId, card);
            if (engine.state === 'Playing Phase' && engine.currentTrickCards.length === before) {
                throw new Error(`stalled: ${engine.players[turnId].playerName} offered illegal ${card}`);
            }
            continue;
        }
        if (engine.state === 'Awaiting Next Round Trigger') {
            engine._advanceRound();
            continue;
        }
        throw new Error(`unexpected state ${engine.state}`);
    }

    const finalScores = {};
    seatNames.forEach(name => { finalScores[name] = engine.scores[name]; });
    const top = Math.max(...Object.values(finalScores));
    const winners = seatNames.filter(name => finalScores[name] === top);
    return { winners, scores: finalScores, rounds, roundHistory: engine.roundHistory };
}

function runMatchup(label, seatNames, games) {
    const brains = seatNames.map(brainNameFor);
    const distinctBrains = [...new Set(brains)];
    const wins = Object.fromEntries(seatNames.map(n => [n, 0]));
    const scoreSum = Object.fromEntries(seatNames.map(n => [n, 0]));
    const bidStats = Object.fromEntries(distinctBrains.map(b => [b, { rounds: 0, points: 0, made: 0 }]));
    const defenseStats = {};
    let roundsTotal = 0;

    // The engine narrates every round; keep the bulk run silent while the
    // report below still prints.
    const realLog = console.log;
    console.log = () => {};
    try {
    for (let i = 0; i < games; i += 1) {
        const result = playOneGame(seatNames);
        roundsTotal += result.rounds;
        result.winners.forEach(w => { wins[w] += 1 / result.winners.length; });
        seatNames.forEach(n => { scoreSum[n] += result.scores[n]; });

        for (const round of result.roundHistory) {
            const bidderBrain = brainNameFor(round.bidderName);
            bidStats[bidderBrain].rounds += 1;
            bidStats[bidderBrain].points += round.bidderCardPoints;
            if (round.bidderCardPoints > 60) bidStats[bidderBrain].made += 1;
            const defKey = seatNames
                .filter(n => n !== round.bidderName)
                .map(brainNameFor)
                .sort()
                .join('+');
            defenseStats[defKey] = defenseStats[defKey] || { rounds: 0, sets: 0 };
            defenseStats[defKey].rounds += 1;
            if (round.bidderCardPoints < 60) defenseStats[defKey].sets += 1;
        }
    }
    } finally { console.log = realLog; }

    console.log(`\n=== ${label} — ${games} games, avg ${(roundsTotal / games).toFixed(1)} rounds/game ===`);
    for (const brain of distinctBrains) {
        const names = seatNames.filter(n => brainNameFor(n) === brain);
        const groupWins = names.reduce((s, n) => s + wins[n], 0);
        const avgScore = names.reduce((s, n) => s + scoreSum[n], 0) / (names.length * games);
        const chance = (names.length / 3) * 100;
        console.log(`  ${brain.padEnd(8)} (${names.length} seat${names.length > 1 ? 's' : ''}): wins ${(100 * groupWins / games).toFixed(1)}% (chance ${chance.toFixed(0)}%), avg final score ${avgScore.toFixed(1)}`);
    }
    for (const brain of distinctBrains) {
        const s = bidStats[brain];
        if (!s.rounds) continue;
        console.log(`  as bidder [${brain}]: avg ${(s.points / s.rounds).toFixed(1)} pts, made ${(100 * s.made / s.rounds).toFixed(1)}% of ${s.rounds}`);
    }
    for (const [key, s] of Object.entries(defenseStats)) {
        console.log(`  defense [${key}]: set the bidder ${(100 * s.sets / s.rounds).toFixed(1)}% of ${s.rounds}`);
    }
}

const games = Number(process.argv[2]) || 500;
console.log(`Simulating offline (no server, no database). ${games} games per matchup...`);
const t0 = Date.now();

const matchups = [
    ['1 counting vs 2 classic', seats('counting', 'classic', 'classic')],
    ['2 counting vs 1 classic', seats('counting', 'counting', 'classic')],
    ['1 flytrap vs 2 classic', seats('flytrap', 'classic', 'classic')],
    ['flytrap vs counting vs classic', seats('flytrap', 'counting', 'classic')],
    ['2 flytrap vs 1 counting', seats('flytrap', 'flytrap', 'counting')],
];
for (const [label, seatNames] of matchups) {
    runMatchup(label, seatNames, games);
}
console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
