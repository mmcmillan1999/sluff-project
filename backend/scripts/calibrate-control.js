// backend/scripts/calibrate-control.js
//
// Threshold calibration for control-weight variants: for each tier (Heart
// Solo, Solo on 5 / on 4, Frog on 4 / on 3), find the incumbent weights'
// bid probability among eligible random hands, then solve each variant's
// threshold to hit the same probability. Weights become the only variable
// the tournament measures; volume is held constant.
//
//   node scripts/calibrate-control.js          # 60k hands, prints bars

'use strict';

const {
    analyzeControl, controlScoreWith,
    CONTROL_WEIGHTS, CONTROL_WEIGHTS_A, CONTROL_WEIGHTS_B, CONTROL_WEIGHTS_C,
} = require('../src/core/bidAdvice');
const { deck } = require('../src/core/constants');

const HANDS = Number(process.argv[2]) || 60000;
const INCUMBENT_BARS = { hs: 8.5, solo5: 8, solo4: 9.5, frog4: 6, frog3: 7.5 };

const bestSideSuit = (facts) => ['S', 'C', 'D']
    .reduce((best, suit) => (facts[suit].length > facts[best].length ? suit : best), 'S');

const dealHand = () => {
    const d = [...deck];
    for (let j = d.length - 1; j > 0; j -= 1) {
        const k = Math.floor(Math.random() * (j + 1));
        [d[j], d[k]] = [d[k], d[j]];
    }
    return d.slice(0, 11);
};

// Collect per-tier score samples for every weight set over the same hands.
const WEIGHT_SETS = {
    control: CONTROL_WEIGHTS,
    controlA: CONTROL_WEIGHTS_A,
    controlB: CONTROL_WEIGHTS_B,
    controlC: CONTROL_WEIGHTS_C,
};
const samples = {};
for (const name of Object.keys(WEIGHT_SETS)) {
    samples[name] = { hs: [], solo5: [], solo4: [], frog4: [], frog3: [] };
}

for (let i = 0; i < HANDS; i += 1) {
    const hand = dealHand();
    const facts = analyzeControl(hand);
    const side = bestSideSuit(facts);
    for (const [name, weights] of Object.entries(WEIGHT_SETS)) {
        const s = samples[name];
        const heartScore = controlScoreWith(weights, facts, 'H');
        const sideScore = controlScoreWith(weights, facts, side);
        if (facts.H.length >= 5) s.hs.push(heartScore);
        if (facts[side].length >= 5) s.solo5.push(sideScore);
        if (facts[side].length === 4) s.solo4.push(sideScore);
        if (facts.H.length === 4) s.frog4.push(heartScore);
        if (facts.H.length === 3) s.frog3.push(heartScore);
    }
}

// The incumbent's pass/bid split per tier -> the variant threshold sitting
// at the same quantile of ITS OWN score distribution.
const quantileMatch = (incumbentScores, incumbentBar, variantScores) => {
    const sortedInc = [...incumbentScores].sort((a, b) => a - b);
    const below = sortedInc.filter(v => v < incumbentBar).length;
    const q = below / sortedInc.length;
    const sortedVar = [...variantScores].sort((a, b) => a - b);
    const idx = Math.min(sortedVar.length - 1, Math.floor(q * sortedVar.length));
    // Quarter-point rounding keeps the bars human-readable.
    return Math.round(sortedVar[idx] * 4) / 4;
};

console.log(`Calibrated on ${HANDS} random hands (incumbent bars ${JSON.stringify(INCUMBENT_BARS)}):\n`);
for (const name of ['controlA', 'controlB', 'controlC']) {
    const bars = {};
    for (const tier of Object.keys(INCUMBENT_BARS)) {
        bars[tier] = quantileMatch(samples.control[tier], INCUMBENT_BARS[tier], samples[name][tier]);
    }
    console.log(`${name}: ${JSON.stringify(bars)}`);
}
