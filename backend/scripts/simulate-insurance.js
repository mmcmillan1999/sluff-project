// backend/scripts/simulate-insurance.js
//
// How much can a sharp human take off the bots at the insurance table?
//
// In production (Aug 20 - Sept 17 2026, games with a human) humans took 13.1
// points a deal off the bots. This harness reproduces the mechanism so a
// pricing rule can be judged BEFORE it meets a person:
//
//   record   Plays seeded rounds with real brains. At every decision point it
//            stores, for each seat, the estimate that seat's insurance logic
//            would price from (quantiles of the sampled final bidder points),
//            and at the end the truth.
//
//              node scripts/simulate-insurance.js record 400 --seed=1 --out=ins-1.jsonl
//
//   analyze  Replays those rounds against an ADVERSARY in each seat in turn:
//            a player who knows more than the bots do and strikes a deal the
//            first time the bots' standing quotes beat what they expect from
//            the cards. `knows` is how much of the true final result the
//            adversary holds at the first card (0 = only the bot's own public
//            estimate, 1 = an oracle); everyone learns the rest as the cards
//            fall. Reports what the bots gain or lose per round and per deal.
//
//              node scripts/simulate-insurance.js analyze ins-*.jsonl
//
// The deal mechanics are the engine's: it locks the moment ask <= sum of
// offers, each defender pays their own offer, the bidder collects the sum.
// Insurance never changes the card play, so a round can be recorded once and
// replayed against any number of rules.

'use strict';

const fs = require('fs');
const { registerBrainProfile } = require('../src/core/bot-brains');
const { buildPublicView } = require('../src/core/bot-strategies/PublicRoundView');
const { estimateBidderPoints, makeRng } = require('../src/core/bot-strategies/RolloutEstimator');
const pricing = require('../src/core/bot-strategies/insurancePricing');
const { insuranceLimits } = require('../src/core/insuranceLimits');
const { BID_MULTIPLIERS } = require('../src/core/constants');
const { buildEngine, SEAT_POOL } = require('./simulate-brains');

const FLAGS = process.argv.slice(2).filter(arg => arg.startsWith('--'));
const ARGS = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
const flag = (name) => {
    const hit = FLAGS.find(arg => arg === `--${name}` || arg.startsWith(`--${name}=`));
    if (!hit) return null;
    return hit.includes('=') ? hit.slice(name.length + 3) : true;
};

const QUANTILES = 41;
const ROLLOUTS = 160;
const MAX_STEPS = 2000;

const quantilesOf = (samples) => {
    const sorted = [...samples].sort((a, b) => a - b);
    const out = [];
    for (let q = 0; q < QUANTILES; q += 1) out.push(sorted[Math.round(q * (sorted.length - 1) / (QUANTILES - 1))]);
    return out;
};

// ---------------------------------------------------------------- record

// The estimate each seat would price from, under both world samplers: the
// market's (what production uses today) and the calibrated one the raven 1.x
// brains sample with.
function estimatesFor(engine, names, seed) {
    const out = {};
    for (const name of names) {
        const view = buildPublicView(engine, name);
        if (!view) continue;
        const market = estimateBidderPoints(view, { rollouts: ROLLOUTS, seed });
        const calibrated = estimateBidderPoints(
            { ...view, frogBuryModel: 'calibrated', keyCardModel: 'calibrated' },
            { rollouts: ROLLOUTS, seed },
        );
        out[name] = { q: quantilesOf(market.samples), qc: quantilesOf(calibrated.samples) };
    }
    return out;
}

function recordRound(seatNames, index, seedBase) {
    const engine = buildEngine(seatNames);
    const points = [];
    for (let step = 0; step < MAX_STEPS; step += 1) {
        const state = engine.state;
        if (state === 'Awaiting Next Round Trigger' || state === 'Game Over') break;
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
            const tricks = engine.tricksPlayedCount || 0;
            const inTrick = engine.currentTrickCards.length;
            // Every card through trick 8, then the start of each later trick.
            if (tricks < pricing.NO_QUOTE_AFTER_TRICK || inTrick === 0) {
                // Seeded, so the harness's sampling never touches the deal stream.
                const est = estimatesFor(engine, seatNames, (seedBase * 7919 + index * 131 + points.length) >>> 0);
                points.push({ t: tricks, c: tricks * 3 + inTrick, est });
            }
            const id = engine.trickTurnPlayerId;
            engine.playCard(id, engine.bots[id].playCard());
            continue;
        }
        throw new Error(`unexpected state ${state}`);
    }
    const round = engine.roundHistory[0];
    if (!round || !engine.bidWinnerInfo) return null;
    return {
        i: index,
        bid: round.bidType,
        m: BID_MULTIPLIERS[round.bidType] || 1,
        bidder: round.bidderName,
        names: seatNames,
        pts: round.bidderCardPoints,
        points,
    };
}

function record() {
    const rounds = Number(ARGS[1]) || 200;
    const seedBase = Number(flag('seed')) || 1;
    const brains = String(flag('brains') || 'counting,flytrap,sphinx').split(',');
    const out = flag('out') || `insurance-${seedBase}.jsonl`;
    const pick = makeRng(seedBase * 104729 + 3);
    const stream = fs.createWriteStream(out);
    const realLog = console.log;
    console.log = () => {};
    const t0 = Date.now();
    let kept = 0;
    try {
        for (let i = 0; i < rounds; i += 1) {
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
            const round = recordRound(seatNames, i, seedBase);
            if (!round) continue;
            stream.write(`${JSON.stringify(round)}\n`);
            kept += 1;
        }
    } finally { console.log = realLog; }
    stream.end();
    console.log(`${kept} rounds recorded to ${out} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

// ---------------------------------------------------------------- analyze

const mean = (values) => values.reduce((s, v) => s + v, 0) / values.length;

// The rules under test. Each returns the quote a bot seat would have standing
// at a decision point, or null for "nothing agreeable posted".
//   persists: the Aug 2026 strategy stops re-quoting after trick 8 and LEAVES
//   its last quote on the table through tricks 9-11.
function rulesFrom(spec) {
    const rules = [
        {
            name: 'market (live today)',
            persists: true,
            quote: ({ samples, m, isBidder, t, limits }) => (t >= pricing.NO_QUOTE_AFTER_TRICK
                ? undefined // keep whatever was last posted
                : pricing.marketQuote({ samples, m, isBidder, tricksPlayed: t, limits })),
        },
        {
            name: 'market, quote pulled after trick 8',
            persists: false,
            quote: ({ samples, m, isBidder, t, limits }) => (t >= pricing.NO_QUOTE_AFTER_TRICK
                ? null
                : pricing.marketQuote({ samples, m, isBidder, tricksPlayed: t, limits })),
        },
    ];
    for (const params of spec) {
        rules.push({
            name: params.name,
            sampler: params.sampler || 'q',
            persists: false,
            quote: ({ samples, m, isBidder, t, limits, bid }) => {
                if (t >= (params.lastTrick ?? pricing.NO_QUOTE_AFTER_TRICK)) return null;
                const correction = params.corrected
                    ? pricing.estimatorCorrection({ isBidder, bidType: bid, tricksPlayed: t })
                    : null;
                const priced = pricing.informedQuote({ samples, m, isBidder, limits, correction, ...params.pricing });
                return priced.agreeable ? priced.quote : null;
            },
        });
    }
    return rules;
}

// Play one recorded round with `human` as the adversary and the other two
// seats as bots pricing by `rule`. Returns the deal struck, if any.
function playAdversary(round, human, rule, { knows, threshold }) {
    const { m, bidder, names, pts } = round;
    const surplus = pts - 60;
    const bots = names.filter(name => name !== human);
    const humanIsBidder = human === bidder;
    const standing = {}; // bot name -> standing quote (null = unagreeable default)
    const stack = 120;

    for (const point of round.points) {
        for (const bot of bots) {
            const isBidder = bot === bidder;
            const limits = insuranceLimits({ multiplier: m, stack, isBidder });
            const samples = point.est[bot]?.[rule.sampler || 'q'];
            if (!samples) continue;
            const quoted = rule.quote({ samples, m, isBidder, t: point.t, limits, bid: round.bid });
            if (quoted !== undefined) standing[bot] = quoted;
        }
        // What the adversary expects from the cards: their own public
        // estimate, pulled toward the truth by what they know — and everyone
        // knows more as the round runs out.
        const publicMean = mean(point.est[human].q);
        const w = knows + (1 - knows) * (point.c / 33);
        const believedSurplus = w * pts + (1 - w) * publicMean - 60;

        if (humanIsBidder) {
            const [a, b] = bots;
            if (standing[a] == null || standing[b] == null) continue;
            const settlement = standing[a] + standing[b]; // the ask they can lock right now
            const limits = insuranceLimits({ multiplier: m, stack, isBidder: true });
            if (settlement < limits.min || settlement > limits.max) continue;
            if (settlement - pricing.bidderCardValue(believedSurplus, m) < threshold) continue;
            return {
                at: point.t,
                botEdge: bots.map(bot => (surplus * m - standing[bot])), // (-offer) - (-S x m)
                humanEdge: settlement - pricing.bidderCardValue(surplus, m),
                humanRole: 'bidder',
            };
        }
        const botBidder = bots.find(bot => bot === bidder);
        const botDefender = bots.find(bot => bot !== bidder);
        if (standing[botBidder] == null || standing[botDefender] == null) continue;
        const limits = insuranceLimits({ multiplier: m, stack, isBidder: false });
        // The least the human can put up and still meet the ask.
        const needed = Math.max(limits.min, standing[botBidder] - standing[botDefender]);
        if (needed > limits.max) continue;
        if (believedSurplus * m - needed < threshold) continue; // (-needed) - (-S x m)
        const settlement = needed + standing[botDefender];
        return {
            at: point.t,
            botEdge: [settlement - pricing.bidderCardValue(surplus, m), surplus * m - standing[botDefender]],
            humanEdge: surplus * m - needed,
            humanRole: 'defender',
        };
    }
    return null;
}

function analyze() {
    const files = ARGS.slice(1);
    if (files.length === 0) throw new Error('analyze needs recorded .jsonl files');
    const rounds = [];
    for (const file of files) {
        for (const line of fs.readFileSync(file, 'utf8').split('\n')) if (line.trim()) rounds.push(JSON.parse(line));
    }
    const spec = flag('rules') ? JSON.parse(fs.readFileSync(flag('rules'), 'utf8')) : DEFAULT_RULES;
    const threshold = Number(flag('threshold') ?? 3);
    const adversaries = String(flag('knows') || '0.25,0.5,1').split(',').map(Number);

    console.log(`${rounds.length} recorded rounds · adversary strikes at the first deal worth ${threshold}+ points to them · each seat takes a turn as the adversary\n`);

    // How good is the estimate the bots price from? Bias and spread at the
    // first card of the round, from a DEFENDER's seat.
    for (const sampler of ['q', 'qc']) {
        const byBid = {};
        for (const round of rounds) {
            const first = round.points[0];
            const defender = round.names.find(name => name !== round.bidder);
            const samples = first?.est?.[defender]?.[sampler];
            if (!samples) continue;
            const { mean: mu, sd } = pricing.stats(samples);
            const row = byBid[round.bid] = byBid[round.bid] || { n: 0, err: 0, z2: 0 };
            row.n += 1; row.err += mu - round.pts; row.z2 += ((round.pts - mu) / Math.max(1, sd)) ** 2;
        }
        console.log(`  estimator (${sampler === 'q' ? 'market sampler' : 'calibrated sampler'}) at the first card, defender's seat: ${Object.entries(byBid).map(([bid, r]) => `${bid} bias ${(r.err / r.n).toFixed(1)} pts, truth-spread/claimed-spread ${Math.sqrt(r.z2 / r.n).toFixed(2)}`).join(' · ')}`);
    }

    for (const knows of adversaries) {
        console.log(`\n=== adversary knows ${Math.round(knows * 100)}% of the true result at the first card ===`);
        console.log('  rule                                              deals/100 rnds   bots per deal   BOTS PER 100 ROUNDS   vs human bidder / defender (per deal)');
        for (const rule of rulesFrom(spec)) {
            let deals = 0; let botTotal = 0; let seatsPlayed = 0;
            const byRole = { bidder: { n: 0, bot: 0 }, defender: { n: 0, bot: 0 } };
            for (const round of rounds) {
                for (const human of round.names) {
                    seatsPlayed += 1;
                    const deal = playAdversary(round, human, rule, { knows, threshold });
                    if (!deal) continue;
                    const botSum = deal.botEdge[0] + deal.botEdge[1];
                    deals += 1; botTotal += botSum;
                    byRole[deal.humanRole].n += 1; byRole[deal.humanRole].bot += botSum;
                }
            }
            const per = (row) => (row.n ? (row.bot / row.n).toFixed(1) : '—');
            console.log(`  ${rule.name.padEnd(49)} ${(100 * deals / seatsPlayed).toFixed(1).padStart(9)}      ${(deals ? botTotal / deals : 0).toFixed(1).padStart(9)}      ${(100 * botTotal / seatsPlayed).toFixed(0).padStart(12)}           ${per(byRole.bidder).padStart(6)} / ${per(byRole.defender)}`);
        }
    }
}

const DEFAULT_RULES = [
    { name: 'informed 100%, raw estimate', pricing: { informed: 1, minEdge: 1 } },
    { name: 'informed 100% + measured correction', corrected: true, pricing: { informed: 1, minEdge: 1 } },
    { name: 'informed 75% + measured correction', corrected: true, pricing: { informed: 0.75, minEdge: 1 } },
    { name: 'informed 50% + measured correction', corrected: true, pricing: { informed: 0.5, minEdge: 1 } },
    { name: 'informed 100% + correction, min edge 3', corrected: true, pricing: { informed: 1, minEdge: 3 } },
    { name: 'informed 100% + correction, quotes to trick 10', corrected: true, lastTrick: 10, pricing: { informed: 1, minEdge: 1 } },
];

if (require.main === module) {
    const mode = ARGS[0];
    if (mode === 'record') record();
    else if (mode === 'analyze') analyze();
    else {
        console.error('usage: simulate-insurance.js record <rounds> [--seed=N] [--brains=a,b,c] [--out=file.jsonl]\n       simulate-insurance.js analyze <files...> [--knows=0.25,0.5,1] [--threshold=3] [--rules=rules.json]');
        process.exit(1);
    }
}

module.exports = { playAdversary, rulesFrom, quantilesOf };
