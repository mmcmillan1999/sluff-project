// backend/src/core/bot-brains/ravenNextBrain.js
//
// RAVEN 1.1 and 1.2 — raven with a repaired defense. Same engine, same
// offense card for card (ravenBrain.createSearchBrain); only what a DEFENDER
// believes about the hidden cards, and how it treats one risky lead, differ.
//
// SEATS: raven-1.2 plays Grandpa George and Courtney M. since Sept 17 2026
// (Matt's call, BRAIN_PROFILES in index.js). raven-1.1 plays no bot; it and
// the original raven stay registered for the simulators and as a one-line
// rollback. (First built under the working name "sphinx 1.x"; sphinx's own
// logic was never involved.)
//
// Why they exist: the raven seats were seen, on defense, leading a 10 while
// that suit's ace was still unplayed — fine when partner holds the ace,
// ruinous when the bidder does. scripts/analyze-ten-leads.js measured it over
// 1,658 defended rounds: raven made that lead 38 times and lost the trick 53%
// of the time (65% in Frog rounds), handing over 18 points a time. Sphinx
// made it 54 times.
//
// The cause was not the search. It was what the search BELIEVED. Every search
// brain draws its hidden worlds from the insurance market's sampler, which
// guesses a Frog bidder's discards by weight 1 + points/2 — an ace 6.5x as
// likely to be buried as a six. Over 8,264 real Frog rounds the bidder buried
// an ace zero times, yet two imagined Frog worlds in three had one buried. So
// the search saw the unplayed ace "safely in the discards" and priced the 10
// as a free winner. The beliefs were off wherever it matters: a Solo bidder
// holds the trump ace 89% of the time (believed: 66%), and a side ace that
// has not appeared after its suit was led twice is in the widow about 70% of
// the time (believed: ~19%) — the dog that did not bark. And the stronger the
// bidder, the worse the lead: an unled side ace is the bidder's 28% of the
// time among the simple brains, 41% at a mixed table, 59-64% when the bidder
// is a search brain. Good players sit on their aces.
//
// Both candidates are the raven search engine (ravenBrain.createSearchBrain:
// sampled worlds, policy rollout, exact endgame) with its beliefs repaired
// and a limit on the lead itself:
//
//   frogBuryModel 'calibrated'  RolloutEstimator.FROG_BURY_WEIGHT — what Frog
//                               bidders really bury; never an ace.
//   keyCardModel 'calibrated'   RolloutEstimator.placeKeyCards + the measured
//                               keyCardTable.json — a defender's unseen Aces
//                               and 10s are dealt to bidder / partner /
//                               buried by odds keyed on public facts only:
//                               bid type, trump or side, whether the 10's
//                               ace is gone, how often the suit has been
//                               led, and how deep the round is. Regenerate
//                               with scripts/calibrate-sampler.js.
//   tenLeadGuard 0.15           a defender may not LEAD a 10 under an
//                               unaccounted ace when the bidder holds that
//                               ace in more than 15% of the sampled worlds,
//                               if any other lead exists. Repairing the
//                               beliefs alone does NOT stop the lead (52 on
//                               the same deals): the search still likes the
//                               gamble. With the limit: 8, and the bidder
//                               held the ace in none of them.
//   riskAversion 0.5  (1.2)     a defender scores a card by its average
//                               payoff less 0.5 x its downside against the
//                               other candidates in the same world — the play
//                               that is fine in most worlds and ruinous in a
//                               few pays for the ruin. The same caution as
//                               the 10-lead limit, applied to every card.
//
// Paired results against raven on identical deals (scripts/simulate-defense.js
// + compare-defense.js; bidder's points CONCEDED, negative is better; 7,200
// rounds vs sphinx/counting bidders, 4,800 vs a raven bidder):
//
//                       vs sphinx   vs counting   vs raven (behind / ahead)
//   Frog bury fix only    -0.07       -0.27        -0.33 / 0.00
//   + key cards           -0.33       -0.40        -0.34 / +0.04
//   1.1 (+ 10-lead limit) -0.25       -0.38        -0.37 / +0.02
//   1.2 (+ regret 0.5)    -0.16       -0.33        -0.38 / -0.02
//
// Standard errors are 0.15-0.19 a cell, so the three lower rows are one tier:
// about a quarter of a point a round better than raven on defense (pooled
// z ~ -2.9), and the risk controls cost nothing measurable. Offense is
// raven's, card for card — the repair only touches a defender's sampling.
//
// The out-of-sample check that seated 1.2 (Sept 17 2026): fresh seeds never
// used for tuning, four table types including coyote/flytrap partners and
// bidders that had not been tried — 1.2 concedes 0.26 ±0.06 points a round
// less than raven over 17,527 defense rounds (z -4.5), ahead in 7 of 8
// table-and-seat cells, with offense identical on all 8,873 bids. With the
// tuning seeds: -0.249 ±0.048 over 25,581 rounds (z -5.2). Five-brain round
// robin, 9,000 games a brain (±0.5): raven-1.2 44.9%, raven 43.1%, sphinx
// 34.6%, coyote 22.2%, flytrap 21.8%. Whole-game win rates are too noisy to
// separate the two ravens by themselves; the paired harness is what does.
// Tried and dropped: a half-strength blend of the table (weaker), the table
// fitted to the simple brains only (weaker against a strong bidder), and the
// same calibration from the bidder's seat (no gain on offense).
//
// Also tried and dropped — and worth knowing before anyone chases it again.
// The unplayed-ace lead is the small end of how defenders lose led 10s: six
// times as often (304 leads in 3,000 rounds) the 10 IS the boss of its suit,
// is led, and is ruffed 45% of the time. The search misjudged that too — it
// believed the bidder would ruff 40% of the time when the truth is 53%,
// because a size-weighted deal does not know how short a bidder is in the
// side suits. A measured bidder-void model (void chance by bid type, leads of
// the suit, cards of it the bidder has shown, cards of it still unseen) fixed
// the belief exactly — 55.1% believed against 55.2% true — and changed the
// results by nothing: +0.01 / +0.11 against sphinx and counting bidders,
// -0.16 / -0.10 against raven, all within ±0.17. Cashing a boss 10 at a
// coin-flip ruff risk is simply the best of bad options; holding it loses as
// much. So those leads stay, and the model was taken back out.
//
// And the sampler's void-order bias (RolloutEstimator.dealHands; found Sept 17
// 2026 through the insurance market, where it mattered a great deal). The fix
// is the profile option unbiasedDeal, and for these brains it is OFF because
// it was measured: raven-1.2 with it against raven-1.2 without, 48,000 paired
// rounds over four tables — defending +0.11 ±0.06 and +0.12 ±0.06 (the bidder
// takes a shade MORE; Heart Solo +0.64 ±0.22), bidding +0.18 ±0.07. A wash:
// worth about a twentieth of a point a round, inside the noise. The reason is
// that the search barely meets the bias. It bites only when a hidden seat is
// dealt with no weight function after a seat with a proven void, and the
// played-low floors give nearly every seat a weight: 3-5% of a search brain's
// decisions are exposed, against 31-54% for the insurance estimator, which has
// no floors. (scratch tool: biasExposure.js.)

'use strict';

const { createSearchBrain } = require('./ravenBrain');

const CALIBRATED_BELIEFS = { frogBuryModel: 'calibrated', keyCardModel: 'calibrated' };

const PROFILES = {
    // 1.1 — the targeted fix: repaired beliefs and the 10-lead limit.
    // Otherwise it still plays for the best average.
    'raven-1.1': { ...CALIBRATED_BELIEFS, tenLeadGuard: 0.15 },
    // 1.2 — safety first: 1.1 plus regret aversion on every defensive card.
    'raven-1.2': { ...CALIBRATED_BELIEFS, tenLeadGuard: 0.15, riskAversion: 0.5 },
};

const brains = {};
for (const [name, profile] of Object.entries(PROFILES)) brains[name] = createSearchBrain(profile);

module.exports = { brains, PROFILES };
