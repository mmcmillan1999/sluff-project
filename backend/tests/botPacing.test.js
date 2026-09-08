// backend/tests/botPacing.test.js
//
// Bot card cadence (core/botPacing.js): the two raven seats think like a
// human — a log-normal fitted per trick to MrNoobCrusher's play timings —
// while every other bot keeps the fixed beat it always had.

const assert = require('assert');
const pacing = require('../src/core/botPacing');
const { makeRng } = require('../src/core/bot-strategies/RolloutEstimator');

const stats = (values) => {
    const n = values.length;
    const mean = values.reduce((s, v) => s + v, 0) / n;
    const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) * (v - mean), 0) / n);
    const sorted = [...values].sort((a, b) => a - b);
    return { mean, sd, median: sorted[Math.floor(n / 2)], min: sorted[0], max: sorted[n - 1] };
};

async function runBotPacingTests() {
    console.log('Running bot pacing tests...');
    let testCounter = 1;
    const pass = (name) => console.log(`  ✔ Test ${testCounter++}: ${name}`);

    // 1) Profile resolution: the raven seats are human-paced, nobody else.
    {
        assert.strictEqual(pacing.pacingProfileFor('Grandpa George'), 'human');
        assert.strictEqual(pacing.pacingProfileFor('Courtney M.'), 'human');
        assert.strictEqual(pacing.pacingProfileFor('Courtney Sr.'), 'fixed');
        assert.strictEqual(pacing.pacingProfileFor('Kimba'), 'fixed');
        assert.strictEqual(pacing.pacingProfileFor('Nobody'), 'fixed');
        pass('Only the two raven seats carry the human profile.');
    }

    // 2) Fixed profile is exactly the historical cadence, pace-scaled.
    {
        assert.strictEqual(pacing.botPlayDelay('Kimba', { pace: 1 }), 1200);
        assert.strictEqual(pacing.botPlayDelay('Kimba', { pace: 3 }), 3600);
        assert.strictEqual(pacing.botPlayDelay('Courtney Sr.', { pace: 1 }), 2400);
        assert.strictEqual(pacing.botPlayDelay('Courtney Sr.', { pace: 3 }), 7200);
        assert.strictEqual(pacing.botPlayDelay('Kimba', { pace: 0.5 }), 1200, 'pace below 1 never speeds a bot up');
        pass('Fixed profile: 1.2 s (Courtney Sr. 2.4 s), times the learner pace.');
    }

    // 3) Human profile reproduces the fitted sample: overall median near
    //    2.7 s, mean near 3.3 s, sd near 2.1 s; trick 1 slower than trick 11.
    {
        const rng = makeRng(2026);
        const all = [];
        const byTrick = {};
        for (let i = 0; i < 22_000; i += 1) {
            const trickNumber = (i % 11) + 1;
            const ms = pacing.botPlayDelay('Grandpa George', { trickNumber, legalCount: 3, rng });
            all.push(ms);
            (byTrick[trickNumber] = byTrick[trickNumber] || []).push(ms);
        }
        const overall = stats(all);
        assert.ok(overall.median > 2400 && overall.median < 3100, `median ${overall.median}`);
        assert.ok(overall.mean > 3000 && overall.mean < 3700, `mean ${overall.mean}`);
        assert.ok(overall.sd > 1700 && overall.sd < 2500, `sd ${overall.sd}`);
        assert.ok(overall.min >= pacing.HUMAN_MIN_MS && overall.max <= pacing.HUMAN_MAX_MS);
        assert.ok(stats(byTrick[1]).median > stats(byTrick[11]).median + 800, 'trick 1 is slower than the last trick');
        pass(`Human profile: median ${Math.round(overall.median)} ms, mean ${Math.round(overall.mean)} ms, sd ${Math.round(overall.sd)} ms (target 2.7 s / 3.3 s / 2.1 s).`);
    }

    // 4) A forced play is quicker; every value is an integer inside the clamp.
    {
        const rngA = makeRng(7);
        const rngB = makeRng(7);
        let free = 0;
        let forced = 0;
        for (let i = 0; i < 4000; i += 1) {
            const a = pacing.botPlayDelay('Courtney M.', { trickNumber: 5, legalCount: 4, rng: rngA });
            const b = pacing.botPlayDelay('Courtney M.', { trickNumber: 5, legalCount: 1, rng: rngB });
            assert.ok(Number.isInteger(a) && Number.isInteger(b));
            free += a;
            forced += b;
        }
        assert.ok(forced < free * 0.8, `forced ${forced} vs free ${free}`);
        pass('Forced plays (one legal card) come down noticeably faster.');
    }

    // 5) Table context: tournaments cap the draw at 8 s; a slowed learner
    //    table never gets a human beat quicker than the fixed cadence.
    {
        // Box–Muller draws (u, v): a tiny u is a big magnitude, and v picks
        // the sign — v near 0 lands deep in the slow tail, v = 0.5 in the quick.
        const seq = (values) => { let i = 0; return () => values[i++ % values.length]; };
        const slowRng = () => seq([1e-6, 1e-9]);
        const fastRng = () => seq([1e-6, 0.5]);
        assert.strictEqual(pacing.botPlayDelay('Grandpa George', { trickNumber: 1, rng: slowRng() }), pacing.HUMAN_MAX_MS);
        assert.strictEqual(pacing.botPlayDelay('Grandpa George', { trickNumber: 1, tournament: true, rng: slowRng() }), pacing.HUMAN_TOURNAMENT_MAX_MS);
        assert.strictEqual(pacing.botPlayDelay('Grandpa George', { trickNumber: 11, rng: fastRng() }), pacing.HUMAN_MIN_MS);
        assert.strictEqual(pacing.botPlayDelay('Grandpa George', { trickNumber: 11, pace: 3, rng: fastRng() }), 3600);
        pass('Clamps: 12 s ceiling, 8 s at a tournament table, learner floor at the fixed cadence.');
    }

    // 6) Out-of-range trick numbers fall back to the nearest fitted trick.
    {
        const rng = makeRng(3);
        for (const trickNumber of [0, -4, 12, 40, undefined, NaN]) {
            const ms = pacing.botPlayDelay('Grandpa George', { trickNumber, rng });
            assert.ok(ms >= pacing.HUMAN_MIN_MS && ms <= pacing.HUMAN_MAX_MS, `trick ${trickNumber} -> ${ms}`);
        }
        pass('Odd trick numbers never break the draw.');
    }

    console.log('All bot pacing tests passed.');
}

if (require.main === module) {
    runBotPacingTests().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}

module.exports = runBotPacingTests;
