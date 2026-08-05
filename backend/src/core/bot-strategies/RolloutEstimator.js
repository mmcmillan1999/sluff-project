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
    const trumpBias = { Frog: 1.5, Solo: 2.5, 'Heart Solo': 3.5 }[view.bidType] || 0;
    const fade = Math.max(0, 11 - view.tricksPlayed) / 11;
    return card => 1
        + (getSuit(card) === view.trumpSuit ? trumpBias * fade : 0)
        + (pointValue(card) >= 10 ? 0.8 * fade : 0);
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
        const pool = deck.filter(c => !seen.has(c));

        const bidderVoids = view.voids[view.bidderName] || new Set();
        const bidderHandCap = handSize(view.bidderName);
        const bidderHand = [];
        const discards = [];
        for (const card of forced) {
            const mustDiscard = bidderVoids.has(getSuit(card)) || bidderHand.length >= bidderHandCap;
            if (discards.length < 3 && (mustDiscard || rng() < 0.25)) discards.push(card);
            else bidderHand.push(card);
        }
        // Guess the remaining discards: mild bias toward point cards, strong
        // bias away from trump.
        const discardsNeeded = 3 - discards.length;
        const { picked, rest } = weightedPick(
            pool,
            discardsNeeded,
            card => (1 + pointValue(card) * 0.5) * (getSuit(card) === view.trumpSuit ? 0.1 : 1),
            rng,
        );
        discards.push(...picked);

        const zones = [
            {
                name: view.bidderName,
                size: bidderHandCap - bidderHand.length,
                voids: bidderVoids,
                weight: bidWeightFn(view),
            },
            ...others.filter(name => name !== view.bidderName)
                .map(name => ({ name, size: handSize(name), voids: view.voids[name] })),
        ];
        const { assigned } = dealHands(rest, zones, rng);
        hands[view.bidderName] = [...bidderHand, ...assigned[view.bidderName]];
        others.filter(name => name !== view.bidderName)
            .forEach(name => { hands[name] = assigned[name]; });
        frogDiscards = discards;
    } else {
        const pool = deck.filter(c => !seen.has(c));
        const zones = others.map(name => ({
            name,
            size: handSize(name),
            voids: view.voids[name],
            // Condition the bidder's unseen cards on the announced bid.
            weight: !view.botIsBidder && name === view.bidderName ? bidWeightFn(view) : null,
        }));
        const { assigned, leftover } = dealHands(pool, zones, rng);
        others.forEach(name => { hands[name] = assigned[name]; });
        // Solo / Heart Solo: the three leftovers are the face-down widow.
        // Frog with the bot as bidder: nothing is left over.
        widow = leftover;
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

module.exports = { estimateBidderPoints, sampleWorld, makeRng };
