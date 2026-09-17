// backend/src/core/bot-strategies/insurancePricing.js
//
// How a bot turns "what I think the bidder will score" into an insurance
// quote. Pure functions over a sample of the bidder's final card points, so
// the live strategy (MarketInsuranceStrategy) and the exploitability harness
// (scripts/simulate-insurance.js) price with exactly the same code.
//
// TWO RULES LIVE HERE.
//
// marketQuote — the Aug 2026 rule: quote your own certainty equivalent of
// playing the round out (mean - lambda x sd), shaded by a margin that decays
// as tricks resolve, in steps of five. It prices the ROUND. It does not price
// the PERSON ON THE OTHER SIDE, and that is where it bled: over Aug 20 - Sept
// 17 2026, in games with a human, humans took 13.1 points a deal off the bots
// (CJ +1,941, jazzachy +1,826). Two leaks carried it. A failing human bidder
// escaped for 5 x m where the cards would have cost 35 x m — each bot defender
// collected 2.5 of the 11.7 it was owed. And a bot bidder holding a winner
// sold it for 20 where the cards paid 35.
//
// Neither is a bad estimate of the round. Both are ADVERSE SELECTION: the
// human knows their own hand, and only says yes when the bot's quote is wrong
// in the human's favour. An honest average, quoted to someone who picks their
// moments, loses.
//
// informedQuote — the Sept 2026 rule: assume the other side only accepts when
// accepting is good for them, and post the quote that earns the most GIVEN
// that. For every candidate quote, walk the sample: in which futures would an
// informed counterparty say yes, and what does the bot gain or lose in exactly
// those futures? Post the best one; if nothing clears `minEdge`, post nothing
// agreeable at all. What falls out, with no special cases:
//   - a bid that is making is zero-sum between bidder and defenders, so an
//     informed defender only buys it for less than it is worth: a winning bot
//     bidder does not sell. (Leak two.)
//   - a bid that is failing pays THREE shares on the cards — two defenders
//     and the absorber / sitting-out dealer — and a deal has no absorber, so
//     there is real money for both sides in settling it. The bot asks for its
//     full card value and a slice of the absorber's share, instead of handing
//     the whole surplus to the bidder. (Leak one.) These are the deals that
//     still happen, and they are fair ones.
// `informed` (0..1) is how much the counterparty is assumed to know beyond
// the bot's own estimate: 1 = they know how the round ends. Quotes are whole
// points; nothing here rounds to five.
//
// A rule that only ever posts what it wants is right and silent, and a silent
// table is no fun, so the live strategy also gives it a loss budget, a margin
// sized to what is still unknown, the bounds the banked points set, and the
// enticement the other side needs (all documented on informedQuote): a price
// is always up, stingy at the deal when a bot has only the statistics of its
// hand, homing in on the fair number as the cards fall, exact once the hand is
// decided, and never withdrawn.

'use strict';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const roundTo5 = v => Math.round(v / 5) * 5;

// Card payoffs per seat for a bidder surplus (final card points - 60).
// A made bid collects one share from each defender; a failed bid pays a share
// to each defender AND one to the absorber / sitting-out dealer.
const bidderCardValue = (surplus, m) => (surplus > 0 ? 2 : 3) * surplus * m;
const defenderCardValue = (surplus, m) => -surplus * m;

const NO_QUOTE_AFTER_TRICK = 8;

// The estimate the informed rule prices from (RolloutEstimator options; the
// live strategy and the harness recorder both read them here). Hidden hands
// are dealt without the void-order bias, and the last three tricks are solved
// rather than played out, so what is left late in a round is the honest
// uncertainty — where the unseen cards are — and a decided hand prices as
// decided. The market rule and the raven brains keep the estimator as it was.
const INFORMED_VIEW = { unbiasedDeal: true };
const INFORMED_ESTIMATE = { exactTricks: 3 };

function stats(values) {
    const n = values.length;
    const mean = values.reduce((s, v) => s + v, 0) / n;
    const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) * (v - mean), 0) / Math.max(1, n - 1));
    return { mean, sd };
}

/**
 * The Aug 2026 rule. `samples` = sampled final bidder card points.
 */
function marketQuote({ samples, m, isBidder, tricksPlayed, limits, lambda = 0.12, marginScale = 1 }) {
    const myDeltas = samples.map(pts => (isBidder ? bidderCardValue(pts - 60, m) : defenderCardValue(pts - 60, m)));
    const { mean, sd } = stats(myDeltas);
    const decay = Math.max(0, NO_QUOTE_AFTER_TRICK - tricksPlayed) / NO_QUOTE_AFTER_TRICK;
    const margin = 0.45 * sd * decay * marginScale + 3;
    const ce = mean - lambda * sd;
    // Bidder: the ask is the settlement received; never below the certainty
    // equivalent of playing. Defender: willing to offer at most -ce.
    const raw = isBidder ? roundTo5(ce + margin) : roundTo5(-ce - margin);
    return clamp(raw, limits.min, limits.max);
}

// --- What the estimator gets wrong, measured -----------------------------
//
// The quote is only as honest as the sample it is priced from, and the
// sample comes from a rollout that plays every seat with one simple policy.
// Against 4,500 recorded rounds of real brains (scripts/simulate-insurance.js
// record; counting / flytrap / sphinx / raven-1.2 tables), every card state of
// every round, with the INFORMED_VIEW / INFORMED_ESTIMATE estimator above:
//
//   BIAS — from a DEFENDER's seat it underrates the bidder for most of the
//   round: Frog 3-4 points, Solo 6-7, Heart Solo 9-10, fading to nothing by
//   the last trick. From the BIDDER's own seat it is within a point or two.
//   A defender who thinks the bidder is weaker than they are lets a failing
//   bidder out cheap; a bidder who thinks they are failing harder than they
//   are overpays to escape.
//
//   OVERCONFIDENCE — it starts honest and then claims more certainty than it
//   has: mid-round the truth lands 4-9 points further from the estimate than
//   its own spread allows (worst for a Frog defender, who is guessing the
//   bidder's discards to the end). That missing spread is error in the rollout
//   MODEL, which no amount of resampling shows, so it is added back here as
//   independent noise. It was far worse before the hidden hands were dealt
//   without the void-order bias: a Solo bidder at trick 8 claimed 5.4 points
//   of spread against a real error of 8.1; now 6.5 against 7.0.
//
// [tricks played 0-1, 2-3, 4-5, 6-7, 8, 9, 10] — a table with fewer columns
// (the first measurement had 8+ as one) reads its last column for the rest.
const BUCKET_OF_TRICK = [0, 0, 1, 1, 2, 2, 3, 3, 4, 5, 6, 6];
const ESTIMATOR_CORRECTION = {
    defender: {
        Frog: { shift: [3.3, 4.0, 4.1, 2.2, 1.3, 0.2, -0.7], extraSd: [0, 7.2, 9.0, 8.0, 6.5, 5.2, 3.1] },
        Solo: { shift: [6.0, 6.5, 7.0, 4.3, 2.6, 1.2, 0], extraSd: [0, 0, 0, 2.7, 2.2, 0, 0.2] },
        'Heart Solo': { shift: [8.9, 10.2, 9.5, 6.3, 3.3, 2.6, 0.9], extraSd: [0, 0, 0, 2.0, 1.7, 0, 0] },
    },
    bidder: {
        Frog: { shift: [0.6, 0.6, 0.4, 0, 0.4, 0.1, 0], extraSd: [1.1, 5.0, 5.3, 3.9, 2.9, 1.5, 0] },
        Solo: { shift: [0, 0.2, 0.4, -0.4, -0.3, -0.3, -0.3], extraSd: [2.5, 4.6, 4.6, 3.7, 2.6, 1.5, 0.6] },
        'Heart Solo': { shift: [1.5, 2.3, 1.8, 0.5, -0.3, -0.4, -0.3], extraSd: [0, 5.7, 6.5, 5.0, 4.6, 2.1, 0] },
    },
};

// `table`: another table of the same shape (the harness tries a freshly
// measured one before it replaces the one above).
function estimatorCorrection({ isBidder, bidType, tricksPlayed, table = ESTIMATOR_CORRECTION }) {
    const row = table[isBidder ? 'bidder' : 'defender']?.[bidType];
    if (!row) return { shift: 0, extraSd: 0 };
    const trick = clamp(Math.floor(tricksPlayed) || 0, 0, 11);
    const bucket = Math.min(BUCKET_OF_TRICK[trick], row.shift.length - 1);
    return { shift: row.shift[bucket], extraSd: row.extraSd[bucket] };
}

// Inverse normal CDF (Acklam's rational approximation, |error| < 1.2e-9).
function normalQuantile(p) {
    const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
    const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
    const lo = 0.02425;
    if (p < lo) {
        const q = Math.sqrt(-2 * Math.log(p));
        return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    if (p > 1 - lo) return -normalQuantile(1 - p);
    const q = p - 0.5;
    const r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// Move the sample to where the truth tends to be and widen it to the
// uncertainty that is really there: the claimed spread and the model error
// are independent, so their variances add. A sample with no spread of its own
// (a bidder late in the round) becomes a bell of the model error alone.
//
// `bounds` { lo, hi } is what everyone at the table can see: the bidder
// already has `lo` points banked and the defenders hold all but `hi` of the
// rest, so no correction may imagine a result outside that. It is what makes
// the estimate close on the truth as the round runs out — three cards left
// with the defenders on 50 and the bidder cannot finish past 70, whatever the
// model error says.
function adjustSamples(samples, { shift = 0, extraSd = 0 } = {}, bounds = null) {
    const lo = bounds ? bounds.lo : 0;
    const hi = bounds ? bounds.hi : 120;
    if (shift === 0 && extraSd === 0) {
        return bounds && samples.some(pts => pts < lo || pts > hi) ? samples.map(pts => clamp(pts, lo, hi)) : samples;
    }
    const { mean, sd } = stats(samples);
    const target = Math.sqrt(sd * sd + extraSd * extraSd);
    const n = samples.length;
    if (sd < 1e-6) {
        return samples.map((_, k) => clamp(mean + shift + target * normalQuantile((k + 0.5) / n), lo, hi));
    }
    const scale = target / sd;
    return samples.map(pts => clamp(mean + shift + (pts - mean) * scale, lo, hi));
}

/**
 * The Sept 2026 rule. Returns { quote, edge, agreeable }: `quote` is always a
 * legal setting — the most unagreeable one the seat may post when no deal is
 * worth offering (`agreeable: false`).
 *
 *   informed    0..1  how much of the truth the counterparty is assumed to hold
 *   minEdge     points of expected gain a quote must clear to count as a
 *               deal the bot WANTS
 *   lossBudget  points. With nothing it wants, the bot still shows the most
 *               generous quote that would cost it no more than this, on
 *               average, against a counterparty who knows the result. A table
 *               where the bots never quote is no fun — a winning human bidder
 *               saw two defenders sit at the default all round (Sept 17 2026)
 *               — and a rational opponent cannot hurt a stingy quote by more
 *               than the budget, while a nervous one who takes it pays for the
 *               certainty. 0 = only quote what is wanted.
 *   safety      points that budgeted price is then backed off by (a defender
 *               offers less, a bidder asks more), never past a quote the bot
 *               wants. The budget is per card state and the sample is a few
 *               dozen rollouts; without this a standing price still bleeds.
 *   safetyPerSd the same margin, sized to what is still unknown: this many
 *               times the spread of the (corrected) estimate, per share. Wide
 *               at the deal, when all a bot has is the statistics of its hand;
 *               a point or two by the last tricks; nothing once the hand is
 *               decided. This is what lets the price home in on fair value
 *               instead of being withdrawn (Matt, Sept 17 2026).
 *   entice      points the other side must GAIN over playing the cards before
 *               they say yes. A bidder going down 10 pays 30 on the cards —
 *               ten to each defender and ten to the absorber. Asking -20 leaves
 *               the defenders nothing to say yes for; -26 saves the bidder 4
 *               and hands each defender 3 more than the cards would: a deal all
 *               three want. 0 = they take any deal that is not worse.
 *   bounds      { lo, hi } the final bidder points still possible given the
 *               points both sides have banked in plain sight
 *   correction  { shift, extraSd } from estimatorCorrection(), or none
 */
function informedQuote({
    samples, m, isBidder, limits,
    informed = 1, minEdge = 1, lossBudget = 0, safety = 0, safetyPerSd = 0, entice = 0,
    bounds = null, correction = null,
}) {
    const pts = correction || bounds ? adjustSamples(samples, correction || {}, bounds) : samples;
    const surplus = pts.map(p => p - 60);
    const meanSurplus = surplus.reduce((s, v) => s + v, 0) / surplus.length;
    // What the counterparty believes in each future: the truth, blended with
    // the bot's own average to the degree they are NOT informed.
    const believed = surplus.map(s => informed * s + (1 - informed) * meanSurplus);
    const n = surplus.length;
    const noDeal = isBidder ? limits.max : limits.min;

    let best = { quote: noDeal, edge: 0, agreeable: false };
    const edges = [];
    for (let quote = limits.min; quote <= limits.max; quote += 1) {
        let total = 0;
        for (let k = 0; k < n; k += 1) {
            if (isBidder) {
                // My ask A. Each defender will offer at most what the cards
                // would cost them, so together they meet A only if A <= 2 x
                // (their believed card loss), less what it takes to tempt them.
                if (quote > 2 * believed[k] * m - entice) continue;
                total += quote - bidderCardValue(surplus[k], m);
            } else {
                // My offer o, my partner assumed to match it: the bidder is
                // offered 2o and takes it only if that beats the cards.
                if (2 * quote < bidderCardValue(believed[k], m) + entice) continue;
                total += surplus[k] * m - quote; // (-o) - (-S x m)
            }
        }
        const edge = total / n;
        edges.push(edge);
        if (edge > best.edge + 1e-9 && edge >= minEdge) best = { quote, edge, agreeable: true };
    }
    if (!(lossBudget > 0)) return best;

    // The friendliest price within `lossBudget` of the best the bot could do.
    // One rule for both situations, so the quote never jumps between them: with
    // a deal worth wanting it gives up a little of that edge to look
    // approachable; with none it shows a stingy price that costs next to
    // nothing even against someone who knows how the round ends.
    const floor = Math.max(0, ...edges) - lossBudget;
    for (let step = 0; step < edges.length; step += 1) {
        // Most generous first: a bidder's lowest ask, a defender's highest offer.
        const index = isBidder ? step : edges.length - 1 - step;
        if (edges[index] + 1e-9 < floor) continue;
        // `safety` (points of quote) backs the price off for what the sample
        // cannot see: it is a few dozen rollouts, so its worst case is not the
        // worst case, and the quote stands through thirty-odd card states for
        // someone to pick the one moment it is wrong. Never past the quote the
        // bot actually wants — being stingier than that only loses good deals.
        const generous = limits.min + index;
        // A bidder's ask covers two shares, so its margin is two shares wide.
        const margin = safety + safetyPerSd * stats(surplus).sd * m * (isBidder ? 2 : 1);
        let quote = isBidder ? generous + margin : generous - margin;
        if (best.agreeable) quote = isBidder ? Math.min(quote, best.quote) : Math.max(quote, best.quote);
        // Never a price the cards can no longer justify: a bidder cannot ask
        // for more than the most the round can still pay them, and a defender
        // need not offer less than it would pay if the bidder won nothing more.
        if (bounds) {
            quote = isBidder
                ? Math.min(quote, bidderCardValue(bounds.hi - 60, m))
                : Math.max(quote, (bounds.lo - 60) * m);
        }
        quote = Math.round(clamp(quote, limits.min, limits.max));
        return { quote, edge: edges[quote - limits.min], agreeable: quote !== noDeal, margin };
    }
    return best;
}

module.exports = {
    NO_QUOTE_AFTER_TRICK,
    INFORMED_VIEW,
    INFORMED_ESTIMATE,
    bidderCardValue,
    defenderCardValue,
    marketQuote,
    informedQuote,
    estimatorCorrection,
    adjustSamples,
    normalQuantile,
    stats,
};
