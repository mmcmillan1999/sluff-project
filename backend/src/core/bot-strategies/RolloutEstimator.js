// backend/src/core/bot-strategies/RolloutEstimator.js
//
// Monte Carlo estimator for the bidder's final card points, working strictly
// from a PublicRoundView. Each rollout deals the unseen cards into the hidden
// zones (opponent hands, face-down widow, unseen Frog discards) consistent
// with the suit voids the play history has revealed, then plays the round to
// completion with a fast team-aware policy. The result is a sampled
// distribution of bidderTotalCardPoints (widow/discard scoring included, per
// bid type), from which the market strategy prices asks and offers.

const { getSuit, getRank, determineTrickWinner, calculateCardPoints } = require('../logic');
const { deck, RANKS_ORDER, CARD_POINT_VALUES } = require('../constants');
const { getLegalMoves } = require('../legalMoves');

const rankValue = card => RANKS_ORDER.indexOf(getRank(card));
const pointValue = card => CARD_POINT_VALUES[getRank(card)] || 0;

// Deterministic small PRNG (mulberry32) so tests can pin a seed.
function makeRng(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function shuffleInPlace(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// Weighted sample without replacement (used for guessing Frog discards:
// humans bury points more often than junk-weight-alone would suggest, but
// only mildly, and almost never bury trump).
function weightedPick(pool, count, weightFn, rng) {
    const picked = [];
    const candidates = [...pool];
    while (picked.length < count && candidates.length > 0) {
        const weights = candidates.map(weightFn);
        const total = weights.reduce((s, w) => s + w, 0);
        let roll = rng() * total;
        let idx = 0;
        while (idx < candidates.length - 1 && roll > weights[idx]) { roll -= weights[idx]; idx++; }
        picked.push(candidates.splice(idx, 1)[0]);
    }
    return { picked, rest: candidates };
}

// --- Hidden-zone sampling ---------------------------------------------

// The announced bid is public information: a Heart Solo bidder is loaded
// with hearts, a Solo bidder with their chosen trump. Weight the bidder's
// unseen cards accordingly, fading as actual play supersedes the prior.
function bidWeightFn(view) {
    // A caller may scale the prior (view.bidBiasScale, default 1) — the
    // raven brain's tuning runs use it; the insurance market leaves it alone.
    const scale = Number.isFinite(view.bidBiasScale) ? view.bidBiasScale : 1;
    const trumpBias = ({ Frog: 1.5, Solo: 2.5, 'Heart Solo': 3.5 }[view.bidType] || 0) * scale;
    const fade = Math.max(0, 11 - view.tricksPlayed) / 11;
    return card => 1
        + (getSuit(card) === view.trumpSuit ? trumpBias * fade : 0)
        + (pointValue(card) >= 10 ? 0.8 * scale * fade : 0);
}

// Multiply a zone's weight by the floor penalty for cards beneath the seat's
// inferred floor in their suit (PublicRoundView.floors). Off unless the view
// asks for it (view.floorPenalty < 1): the insurance market samples as before.
function withFloors(view, name, weight) {
    const penalty = Number(view.floorPenalty);
    const seatFloors = view.floors?.[name];
    if (!(penalty >= 0 && penalty < 1) || !seatFloors || Object.keys(seatFloors).length === 0) return weight;
    const base = weight || (() => 1);
    return card => {
        const floor = seatFloors[getSuit(card)];
        const below = floor !== undefined && rankValue(card) < floor;
        return base(card) * (below ? penalty : 1);
    };
}

// What a Frog bidder really buries — measured Sept 2026 over 8,264 Frog
// rounds of the shipped discard policy (frogDiscards.js 'matt', which is
// Matt's own table lore: bank a hanging 10, strip to a bare ace, void a short
// suit, NEVER an ace, never trump). Chance that one given side-suit card ends
// in the discards: A 0.0%, 10 4.9%, K 14.4%, Q 12.8%, J 14.3%, 9 15.6%,
// 8 19.1%, 7 22.5%, 6 27.5%; any trump 0.0%. For a card the table SAW in the
// revealed widow: A 0%, 10 9.9%, K 28%, Q 28%, J 31%, 9 33%, 8 38%, 7 49%,
// 6 61%.
//
// The market model below (view.frogBuryModel unset) weights discards by
// 1 + points/2 — an ace 6.5x as likely as a six. That is the right way round
// for pricing (buried points are the bidder's) and the wrong way round for
// card play: a defender who believes the unplayed ace is probably buried
// leads the 10 of that suit into it. A view that asks for 'calibrated' gets
// these odds instead. The ace keeps a sliver of weight so a human who does
// the unthinkable cannot make a world impossible.
const FROG_BURY_WEIGHT = { A: 0.02, 10: 0.18, K: 0.52, Q: 0.47, J: 0.52, 9: 0.57, 8: 0.69, 7: 0.82, 6: 1 };
const FROG_WIDOW_BURY_CHANCE = { A: 0.01, 10: 0.10, K: 0.28, Q: 0.28, J: 0.31, 9: 0.33, 8: 0.38, 7: 0.49, 6: 0.61 };
// Not zero: the nearly-all-hearts hand does bury hearts (frogDiscards.js pads
// with them), it is just too rare to show up in 50,000 trump cards.
const FROG_TRUMP_BURY_FACTOR = 0.001;

// --- Key-card calibration (opt-in: view.keyCardModel) -------------------
//
// Aces and 10s are 84 of the 120 points, and where an UNSEEN one lives is
// not a matter of zone sizes. A Solo bidder holds the trump ace 89% of the
// time, not the 66% a size-weighted deal gives; and a big card that has not
// appeared after its suit went round is a dog that did not bark — whoever
// held it would usually have played it, so it is more likely buried or being
// held over someone's 10. The cell below is everything PUBLIC that predicts
// the card's zone; scripts/calibrate-sampler.js measures the zone
// frequencies per cell from a defender's seat, and KEY_CARD_TABLE (generated
// by that script) is the result. Cells are tried most-specific first.
function keyCardCells(view, card) {
    const suit = getSuit(card);
    const rank = getRank(card);
    const side = suit === view.trumpSuit ? 'T' : 'S';
    // A 10 whose ace is gone is a boss card: its holder cashes it, so an
    // unplayed one reads differently from a 10 still sitting under its ace.
    const aceLive = rank === '10' && !view.playedSet.has(`A${suit}`) ? 'u' : 'b';
    const leads = Math.min(2, view.suitLeads?.[suit] || 0);
    const phase = view.tricksPlayed <= 2 ? 0 : (view.tricksPlayed <= 5 ? 1 : 2);
    const base = `${view.bidType}|${rank}${side}${aceLive}`;
    return [`${base}|L${leads}|P${phase}`, `${base}|L${leads}`, base];
}

let KEY_CARD_TABLE = {};
try {
    // Generated by scripts/calibrate-sampler.js; absent = the model is a
    // no-op. KEY_CARD_TABLE_PATH lets a simulator run audition another table.
    KEY_CARD_TABLE = require(process.env.KEY_CARD_TABLE_PATH || './keyCardTable.json').table || {};
} catch (error) { /* no table yet */ }

// Place the unseen Aces and 10s into zones by the calibrated odds before the
// rest of the pool is dealt. `zones` = { bidder, partner, buried }, each
// { cap, voids? }; a zone that is full, or void in the card's suit, is out.
// view.keyCardStrength (0..1, default 1) blends the table with plain
// zone-size odds. Returns the placed cards per zone and the untouched rest.
//
// Defenders only. The same table was measured from the BIDDER's seat ("is
// that unseen ace in a hand or in the widow?") and tried on offense in Sept
// 2026: +0.05 ±0.16 and +0.08 ±0.17 points a round over 3,900 paired bids —
// nothing — so it was taken out again.
function placeKeyCards(view, pool, zones, rng) {
    const placed = { bidder: [], partner: [], buried: [] };
    const strength = Number.isFinite(view.keyCardStrength) ? Math.min(1, Math.max(0, view.keyCardStrength)) : 1;
    const zoneNames = ['bidder', 'partner', 'buried'];
    const keyCards = shuffleInPlace(pool.filter(card => pointValue(card) >= 10), rng);
    const taken = new Set();
    for (const card of keyCards) {
        let odds = null;
        for (const cell of keyCardCells(view, card)) {
            if (KEY_CARD_TABLE[cell]) { odds = KEY_CARD_TABLE[cell]; break; }
        }
        if (!odds) continue;
        const suit = getSuit(card);
        const room = zoneNames.map(name => {
            const zone = zones[name];
            const left = zone.cap - placed[name].length;
            return left > 0 && !(zone.voids && zone.voids.has(suit)) ? left : 0;
        });
        const roomTotal = room[0] + room[1] + room[2];
        if (roomTotal === 0) continue;
        const weights = zoneNames.map((_, i) => (room[i] > 0
            ? strength * odds[i] + (1 - strength) * (room[i] / roomTotal)
            : 0));
        const total = weights[0] + weights[1] + weights[2];
        if (!(total > 0)) continue;
        let roll = rng() * total;
        let pick = 0;
        while (pick < 2 && roll > weights[pick]) { roll -= weights[pick]; pick += 1; }
        if (weights[pick] === 0) pick = weights.findIndex(w => w > 0);
        placed[zoneNames[pick]].push(card);
        taken.add(card);
    }
    return { placed, rest: pool.filter(card => !taken.has(card)) };
}

// Deal `pool` into player hand zones respecting known suit voids, with
// retries. Voids come from actual play, so a satisfying assignment always
// exists in reality; retries only paper over unlucky greedy orders. As a
// last resort the voids are relaxed rather than failing the estimate.
function dealHands(pool, zones, rng, maxAttempts = 30) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const remaining = shuffleInPlace([...pool], rng);
        const result = {};
        // Most-constrained zone first.
        const order = [...zones].sort((a, b) => (b.voids?.size || 0) - (a.voids?.size || 0));
        let failed = false;
        for (const zone of order) {
            const allowed = [];
            const rejected = [];
            for (const card of remaining) {
                if (zone.voids && zone.voids.has(getSuit(card))) rejected.push(card);
                else allowed.push(card);
            }
            if (allowed.length < zone.size) { failed = true; break; }
            let taken;
            let rest;
            if (zone.weight) {
                ({ picked: taken, rest } = weightedPick(allowed, zone.size, zone.weight, rng));
            } else {
                taken = allowed.slice(0, zone.size);
                rest = allowed.slice(zone.size);
            }
            result[zone.name] = taken;
            remaining.length = 0;
            remaining.push(...rest, ...rejected);
        }
        if (!failed) return { assigned: result, leftover: remaining };
    }
    // Relaxed fallback: ignore voids so the estimator degrades instead of dying.
    const remaining = shuffleInPlace([...pool], rng);
    const result = {};
    for (const zone of zones) result[zone.name] = remaining.splice(0, zone.size);
    return { assigned: result, leftover: remaining };
}

// Sample one complete hidden world consistent with the public view.
// Returns { hands: {name: [cards]}, widow: [cards], frogDiscards: [cards] }.
function sampleWorld(view, rng) {
    const seen = new Set([...view.myHand, ...view.playedSet]);
    const myDiscards = view.frog?.myDiscards || null;
    if (myDiscards) myDiscards.forEach(c => seen.add(c));

    const others = view.activeNames.filter(name => name !== view.botName);
    const handSize = name => 11 - (view.playedBy[name] || []).length;

    const hands = { [view.botName]: [...view.myHand] };
    let widow = [];
    let frogDiscards = myDiscards ? [...myDiscards] : [];

    if (view.bidType === 'Frog' && !view.botIsBidder) {
        // The three revealed widow cards live with the bidder — still in hand
        // or among the discards. A card the voids bar from the bidder's hand
        // must be a discard (discards happened before any void arose).
        const forced = (view.frog?.revealedWidow || []).filter(c => !view.playedSet.has(c));
        forced.forEach(c => seen.add(c));
        let pool = deck.filter(c => !seen.has(c));

        const bidderVoids = view.voids[view.bidderName] || new Set();
        const bidderHandCap = handSize(view.bidderName);
        const bidderHand = [];
        const discards = [];
        const calibrated = view.frogBuryModel === 'calibrated';
        const widowBuryChance = card => (calibrated
            ? (getSuit(card) === view.trumpSuit ? 0 : FROG_WIDOW_BURY_CHANCE[getRank(card)] ?? 0.25)
            : 0.25);
        for (const card of forced) {
            const mustDiscard = bidderVoids.has(getSuit(card)) || bidderHand.length >= bidderHandCap;
            if (discards.length < 3 && (mustDiscard || rng() < widowBuryChance(card))) discards.push(card);
            else bidderHand.push(card);
        }
        // Calibrated key cards: the unseen Aces and 10s go to bidder, partner
        // or discards by measured odds before anything else is dealt.
        const partners = others.filter(name => name !== view.bidderName);
        const partnerKeyed = [];
        if (view.keyCardModel === 'calibrated' && partners.length === 1) {
            const keyed = placeKeyCards(view, pool, {
                bidder: { cap: bidderHandCap - bidderHand.length, voids: bidderVoids },
                partner: { cap: handSize(partners[0]), voids: view.voids[partners[0]] },
                buried: { cap: 3 - discards.length },
            }, rng);
            pool = keyed.rest;
            bidderHand.push(...keyed.placed.bidder);
            discards.push(...keyed.placed.buried);
            partnerKeyed.push(...keyed.placed.partner);
        }
        // Guess the remaining discards. Market model: mild bias toward point
        // cards, strong bias away from trump. Calibrated model: what bidders
        // really bury (FROG_BURY_WEIGHT above).
        const discardsNeeded = 3 - discards.length;
        const buryWeight = calibrated
            ? card => (FROG_BURY_WEIGHT[getRank(card)] ?? 0.5) * (getSuit(card) === view.trumpSuit ? FROG_TRUMP_BURY_FACTOR : 1)
            : card => (1 + pointValue(card) * 0.5) * (getSuit(card) === view.trumpSuit ? 0.1 : 1);
        const { picked, rest } = weightedPick(
            pool,
            discardsNeeded,
            buryWeight,
            rng,
        );
        discards.push(...picked);

        const zones = [
            {
                name: view.bidderName,
                size: bidderHandCap - bidderHand.length,
                voids: bidderVoids,
                weight: withFloors(view, view.bidderName, bidWeightFn(view)),
            },
            ...partners
                .map(name => ({ name, size: handSize(name) - partnerKeyed.length, voids: view.voids[name], weight: withFloors(view, name, null) })),
        ];
        const { assigned } = dealHands(rest, zones, rng);
        hands[view.bidderName] = [...bidderHand, ...assigned[view.bidderName]];
        partners.forEach(name => { hands[name] = [...partnerKeyed, ...assigned[name]]; });
        frogDiscards = discards;
    } else {
        let pool = deck.filter(c => !seen.has(c));
        // A defender's calibrated key cards (Solo / Heart Solo): the widow is
        // the buried zone.
        const partners = others.filter(name => name !== view.bidderName);
        const keyedHands = {};
        let keyedWidow = [];
        if (view.keyCardModel === 'calibrated' && !view.botIsBidder && partners.length === 1) {
            const keyed = placeKeyCards(view, pool, {
                bidder: { cap: handSize(view.bidderName), voids: view.voids[view.bidderName] },
                partner: { cap: handSize(partners[0]), voids: view.voids[partners[0]] },
                buried: { cap: 3 },
            }, rng);
            pool = keyed.rest;
            keyedHands[view.bidderName] = keyed.placed.bidder;
            keyedHands[partners[0]] = keyed.placed.partner;
            keyedWidow = keyed.placed.buried;
        }
        const zones = others.map(name => ({
            name,
            size: handSize(name) - (keyedHands[name]?.length || 0),
            voids: view.voids[name],
            // Condition the bidder's unseen cards on the announced bid.
            weight: withFloors(view, name, !view.botIsBidder && name === view.bidderName ? bidWeightFn(view) : null),
        }));
        const { assigned, leftover } = dealHands(pool, zones, rng);
        others.forEach(name => { hands[name] = [...(keyedHands[name] || []), ...assigned[name]]; });
        // Solo / Heart Solo: the three leftovers are the face-down widow.
        // Frog with the bot as bidder: nothing is left over.
        widow = [...keyedWidow, ...leftover];
    }

    return { hands, widow, frogDiscards };
}

// --- Playout policy ----------------------------------------------------

const byPointsThenRank = (a, b) => (pointValue(a) - pointValue(b)) || (rankValue(a) - rankValue(b));

// Is this card the highest not-yet-played card of its suit? Computed from
// public play history only — exactly the count a human keeps.
function isBoss(card, playedSet) {
    const suit = getSuit(card);
    for (let i = RANKS_ORDER.length - 1; i >= 0; i--) {
        const candidate = RANKS_ORDER[i] + suit;
        if (candidate === card) return true;
        if (!playedSet.has(candidate)) return false;
    }
    return false;
}

function winningPlay(plays, leadSuit, trumpSuit) {
    return determineTrickWinner(plays, leadSuit, trumpSuit);
}

function chooseCard(sim, playerName) {
    const hand = sim.hands[playerName];
    const isLeading = sim.plays.length === 0;
    const legal = getLegalMoves(hand, isLeading, sim.leadSuit, sim.trumpSuit, sim.trumpBroken);
    if (legal.length === 1) return legal[0];

    if (isLeading) {
        // Cash certain winners (highest points first); otherwise exit cheaply.
        const bosses = legal.filter(c => isBoss(c, sim.playedSet));
        if (bosses.length > 0) {
            return bosses.reduce((best, c) => (byPointsThenRank(c, best) > 0 ? c : best));
        }
        return legal.reduce((best, c) => (byPointsThenRank(c, best) < 0 ? c : best));
    }

    const iAmBidderSide = playerName === sim.bidderName;
    const winner = winningPlay(sim.plays, sim.leadSuit, sim.trumpSuit);
    const winnerIsFriend = (winner.playerName === sim.bidderName) === iAmBidderSide;
    const amLast = sim.plays.length === sim.n - 1;

    if (winnerIsFriend) {
        // Schmear points onto a secure friendly trick; otherwise stay cheap.
        const winnerSecure = amLast || (
            isBoss(winner.card, sim.playedSet) && getSuit(winner.card) === sim.trumpSuit
        );
        if (winnerSecure) {
            const fat = legal.reduce((best, c) => (byPointsThenRank(c, best) > 0 ? c : best));
            if (pointValue(fat) > 0) return fat;
        }
        return legal.reduce((best, c) => (byPointsThenRank(c, best) < 0 ? c : best));
    }

    const beats = legal.filter(card => {
        const candidate = winningPlay(
            [...sim.plays, { playerName, card }], sim.leadSuit, sim.trumpSuit,
        );
        return candidate.playerName === playerName;
    });
    if (beats.length > 0) {
        // Cheapest card that takes the trick.
        return beats.reduce((best, c) => (rankValue(c) < rankValue(best) ? c : best));
    }
    return legal.reduce((best, c) => (byPointsThenRank(c, best) < 0 ? c : best));
}

// Play the sampled world to the end of the round; returns the bidder's total
// card points including the bid type's widow/discard scoring.
function playOut(view, world, rng) {
    const sim = {
        n: view.n,
        activeNames: view.activeNames,
        bidderName: view.bidderName,
        trumpSuit: view.trumpSuit,
        trumpBroken: view.trumpBroken,
        hands: {},
        playedSet: new Set(view.playedSet),
        plays: view.partialTrick.map(p => ({ ...p })),
        leadSuit: view.partialLeadSuit,
        leaderIdx: view.activeNames.indexOf(view.trickLeaderName),
        tricksPlayed: view.tricksPlayed,
        bidderPts: view.bidderCardPoints,
        defenderPts: view.defenderCardPoints,
        lastTrickWinner: null,
    };
    for (const name of view.activeNames) sim.hands[name] = [...world.hands[name]];

    while (sim.tricksPlayed < 11) {
        while (sim.plays.length < sim.n) {
            const playerName = sim.activeNames[(sim.leaderIdx + sim.plays.length) % sim.n];
            const card = chooseCard(sim, playerName);
            sim.hands[playerName] = sim.hands[playerName].filter(c => c !== card);
            sim.plays.push({ playerName, card });
            sim.playedSet.add(card);
            if (sim.plays.length === 1) sim.leadSuit = getSuit(card);
            if (getSuit(card) === sim.trumpSuit) sim.trumpBroken = true;
        }
        const winner = winningPlay(sim.plays, sim.leadSuit, sim.trumpSuit);
        const trickPoints = calculateCardPoints(sim.plays.map(p => p.card));
        if (winner.playerName === sim.bidderName) sim.bidderPts += trickPoints;
        else sim.defenderPts += trickPoints;
        sim.lastTrickWinner = winner.playerName;
        sim.leaderIdx = sim.activeNames.indexOf(winner.playerName);
        sim.plays = [];
        sim.leadSuit = null;
        sim.tricksPlayed++;
    }

    // Widow / discard scoring mirrors scoringHandler.calculateRoundScores.
    if (view.bidType === 'Frog') {
        sim.bidderPts += calculateCardPoints(world.frogDiscards);
    } else if (view.bidType === 'Solo') {
        sim.bidderPts += calculateCardPoints(world.widow);
    } else if (view.bidType === 'Heart Solo') {
        const widowPts = calculateCardPoints(world.widow);
        if (sim.lastTrickWinner === view.bidderName) sim.bidderPts += widowPts;
        else sim.defenderPts += widowPts;
    }
    return sim.bidderPts;
}

// --- Public API --------------------------------------------------------

/**
 * Estimate the distribution of the bidder's final card points.
 * @returns {{ samples: number[], mean: number, sd: number }}
 */
function estimateBidderPoints(view, { rollouts = 160, seed = null } = {}) {
    const rng = makeRng(seed === null ? Math.floor(Math.random() * 0xFFFFFFFF) : seed);
    const samples = [];
    for (let i = 0; i < rollouts; i++) {
        const world = sampleWorld(view, rng);
        samples.push(playOut(view, world, rng));
    }
    const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
    const variance = samples.reduce((s, v) => s + (v - mean) * (v - mean), 0)
        / Math.max(1, samples.length - 1);
    return { samples, mean, sd: Math.sqrt(variance) };
}

module.exports = { estimateBidderPoints, sampleWorld, makeRng, keyCardCells };
