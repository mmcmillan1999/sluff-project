// backend/src/core/bot-brains/ravenSearch.js
//
// Search core for the raven brain: a compact bitmask representation of one
// fully-known Sluff round (a sampled "world"), a fast full-information play
// policy for rolling the early tricks forward, and an exact alpha-beta
// endgame solver with a transposition table for the last tricks.
//
// Everything here operates on a WORLD — every hand known. The brain that
// drives it (ravenBrain.js) only ever feeds it worlds sampled from public
// information, so this module never touches engine state at all.
//
// Representation: card index = suit * 9 + rank, with suits H D C S = 0..3 and
// ranks in RANKS_ORDER (6 7 8 9 J Q K 10 A = 0..8). A hand is four 9-bit suit
// masks. Three active seats always (the fourth-player dealer sits out).

'use strict';

const { RANKS_ORDER } = require('../constants');

const SUIT_CHARS = ['H', 'D', 'C', 'S'];
const SUIT_IDX = { H: 0, D: 1, C: 2, S: 3 };
const RANK_PTS = [0, 0, 0, 0, 2, 3, 4, 10, 11];
const TRICKS_PER_ROUND = 11;

const cardIdx = (card) => SUIT_IDX[card.slice(-1)] * 9 + RANKS_ORDER.indexOf(card.slice(0, -1));
const cardStr = (idx) => RANKS_ORDER[idx % 9] + SUIT_CHARS[(idx / 9) | 0];
const idxPts = (idx) => RANK_PTS[idx % 9];

// Highest set bit of a 9-bit mask (rank of the top card), -1 for empty.
const topRank = (mask) => (mask ? 31 - Math.clz32(mask) : -1);
// Lowest set bit.
const lowRank = (mask) => (mask ? 31 - Math.clz32(mask & -mask) : -1);

const handKey = (h) => h[0] + h[1] * 512 + h[2] * 262144 + h[3] * 134217728;

class SearchAbort extends Error {}
const ABORT = new SearchAbort('node budget exhausted');

/**
 * Build a mutable world state.
 * @param {object} spec
 *   hands: [[m0,m1,m2,m3] x3]   suit masks per seat (seat order = turn order)
 *   trump: suit index
 *   broken: trump broken flag
 *   bidder: seat index of the bidder
 *   leader: seat index leading the current trick
 *   plays: [{p, s, r}] cards already on the table this trick, in order
 *   tricksLeft: tricks not yet completed (the partial one counts)
 *   bidderPts: bidder's card points banked so far
 *   bonus: points that go to the bidder unconditionally at round end
 *          (Solo widow, Frog discards)
 *   lastTrickBonus: points that go to whichever side wins the LAST trick
 *          (Heart Solo widow)
 */
function makeState(spec) {
    const st = {
        hands: spec.hands.map(h => h.slice()),
        trump: spec.trump,
        broken: Boolean(spec.broken),
        bidder: spec.bidder,
        leader: spec.leader,
        plays: [],
        leadSuit: -1,
        winP: -1,
        winS: -1,
        winR: -1,
        trickPts: 0,
        tricksLeft: spec.tricksLeft,
        bidderPts: spec.bidderPts || 0,
        bonus: spec.bonus || 0,
        lastTrickBonus: spec.lastTrickBonus || 0,
        // Card points not yet scored: everything still in a hand or on the
        // table. Bounds the bidder's future in the solver.
        ptsLeft: 0,
        nodes: 0,
        maxNodes: Infinity,
        tt: null,
        orderMode: 'deep',
    };
    for (let p = 0; p < 3; p += 1) {
        for (let su = 0; su < 4; su += 1) {
            let m = st.hands[p][su];
            while (m) { const r = lowRank(m); m &= ~(1 << r); st.ptsLeft += RANK_PTS[r]; }
        }
    }
    for (const play of spec.plays || []) {
        st.ptsLeft += RANK_PTS[play.r];
        applyPlay(st, play.p, play.s, play.r);
    }
    return st;
}

// Does the card (s, r) beat the current winner of the trick in `st`?
const beatsWinner = (st, s, r) => {
    if (st.winP === -1) return true;
    if (s === st.trump) return st.winS !== st.trump || r > st.winR;
    return st.winS !== st.trump && s === st.leadSuit && r > st.winR;
};

// Put a card on the table. Returns the undo record.
function applyPlay(st, p, s, r) {
    const undo = {
        p, s, r,
        leadSuit: st.leadSuit, winP: st.winP, winS: st.winS, winR: st.winR,
        trickPts: st.trickPts, broken: st.broken,
    };
    st.hands[p][s] &= ~(1 << r);
    if (st.plays.length === 0) st.leadSuit = s;
    if (beatsWinner(st, s, r)) { st.winP = p; st.winS = s; st.winR = r; }
    st.trickPts += RANK_PTS[r];
    if (s === st.trump) st.broken = true;
    st.plays.push(undo);
    return undo;
}

function undoPlay(st) {
    const undo = st.plays.pop();
    st.hands[undo.p][undo.s] |= (1 << undo.r);
    st.leadSuit = undo.leadSuit;
    st.winP = undo.winP; st.winS = undo.winS; st.winR = undo.winR;
    st.trickPts = undo.trickPts;
    st.broken = undo.broken;
}

// Close a completed trick: returns the points the BIDDER gained and the undo
// record needed to reopen it.
function closeTrick(st) {
    const record = {
        leader: st.leader, plays: st.plays, leadSuit: st.leadSuit,
        winP: st.winP, winS: st.winS, winR: st.winR, trickPts: st.trickPts,
    };
    let gained = 0;
    const bidderWon = st.winP === st.bidder;
    if (bidderWon) gained += st.trickPts;
    if (st.tricksLeft === 1 && bidderWon) gained += st.lastTrickBonus;
    st.bidderPts += gained;
    st.ptsLeft -= st.trickPts;
    st.leader = st.winP;
    st.plays = [];
    st.leadSuit = -1; st.winP = -1; st.winS = -1; st.winR = -1; st.trickPts = 0;
    st.tricksLeft -= 1;
    return { gained, record };
}

function reopenTrick(st, { gained, record }) {
    st.tricksLeft += 1;
    st.bidderPts -= gained;
    st.ptsLeft += record.trickPts;
    st.leader = record.leader;
    st.plays = record.plays;
    st.leadSuit = record.leadSuit;
    st.winP = record.winP; st.winS = record.winS; st.winR = record.winR;
    st.trickPts = record.trickPts;
}

const seatToAct = (st) => (st.leader + st.plays.length) % 3;

// Legal suit masks for seat p: array of [suit, mask] with non-empty masks.
function legalSuits(st, p) {
    const h = st.hands[p];
    const out = [];
    if (st.plays.length === 0) {
        const hasNonTrump = [0, 1, 2, 3].some(s => s !== st.trump && h[s]);
        for (let s = 0; s < 4; s += 1) {
            if (!h[s]) continue;
            if (!st.broken && hasNonTrump && s === st.trump) continue;
            out.push([s, h[s]]);
        }
        return out;
    }
    if (h[st.leadSuit]) return [[st.leadSuit, h[st.leadSuit]]];
    if (h[st.trump]) return [[st.trump, h[st.trump]]];
    for (let s = 0; s < 4; s += 1) if (h[s]) out.push([s, h[s]]);
    return out;
}

// Legal cards for seat p with equivalence pruning: zero-point cards of one
// suit that are adjacent once every card between them is dead (played, or
// in p's own hand) lead to identical futures, so only the lowest survives.
// `others` = union mask of the cards still held by the other two seats.
function legalCardsPruned(st, p, prune) {
    const out = [];
    const others = prune
        ? [0, 1, 2, 3].map(s => (st.hands[(p + 1) % 3][s] | st.hands[(p + 2) % 3][s]))
        : null;
    for (const [s, mask] of legalSuits(st, p)) {
        let m = mask;
        let lastZeroRank = -1;
        while (m) {
            const r = lowRank(m);
            m &= ~(1 << r);
            if (prune && RANK_PTS[r] === 0 && lastZeroRank !== -1) {
                // Any live card between lastZeroRank and r breaks the class.
                const between = ((1 << r) - 1) & ~((1 << (lastZeroRank + 1)) - 1);
                if ((others[s] & between) === 0) continue;
            }
            if (RANK_PTS[r] === 0) lastZeroRank = r;
            out.push(s * 9 + r);
        }
    }
    return out;
}

// --- Full-information one-trick policy (rollouts + move ordering) --------

const sideOf = (st, p) => (p === st.bidder ? 1 : 0);

// Could any of the `count` seats acting from `fromSeat` onward, on the side
// opposite `mySide`, beat the current winner of the trick? Exact: every hand
// is known in a world.
function laterCanBeat(st, fromSeat, count, mySide) {
    let seat = fromSeat;
    for (let i = 0; i < count; i += 1, seat = (seat + 1) % 3) {
        if (sideOf(st, seat) === mySide) continue;
        const h = st.hands[seat];
        if (h[st.leadSuit]) {
            if (st.winS !== st.trump && topRank(h[st.leadSuit]) > st.winR) return true;
            continue;
        }
        if (h[st.trump]) {
            if (st.winS !== st.trump || topRank(h[st.trump]) > st.winR) return true;
        }
    }
    return false;
}

// Rank of the highest card of `s` still held by anyone (widow is out of play).
const bossRank = (st, s) => topRank(st.hands[0][s] | st.hands[1][s] | st.hands[2][s]);

function policyPick(st, p, legal) {
    if (legal.length === 1) return legal[0];
    const h = st.hands[p];
    const mySide = sideOf(st, p);
    const otherA = st.hands[(p + 1) % 3];
    const otherB = st.hands[(p + 2) % 3];

    if (st.plays.length === 0) {
        // Leading. First: a boss trump when drawing is worth it (bidder with
        // trump out, or a defender holding more trump than is out).
        const trumpOut = otherA[st.trump] | otherB[st.trump];
        let best = -1;
        let bestScore = -Infinity;
        for (const c of legal) {
            const s = (c / 9) | 0;
            const r = c % 9;
            const isBoss = r === bossRank(st, s);
            let score;
            if (s === st.trump) {
                if (isBoss && trumpOut) {
                    const myTrumpCount = popcount(h[s]);
                    const outCount = popcount(trumpOut);
                    score = (p === st.bidder || myTrumpCount > outCount) ? 1000 - r : -200 - r;
                } else {
                    score = -300 - r + RANK_PTS[r] * -2;
                }
            } else if (isBoss) {
                // A boss side card is safe when no opponent can ruff it.
                let ruffable = false;
                for (const q of [(p + 1) % 3, (p + 2) % 3]) {
                    if (sideOf(st, q) === mySide) continue;
                    if (!st.hands[q][s] && st.hands[q][st.trump]) ruffable = true;
                }
                score = ruffable ? -100 - RANK_PTS[r] * 3 : 500 + RANK_PTS[r];
            } else {
                // Exit low; prefer short suits to build voids, never lead a
                // lone 10 or ace-under card into a live ace.
                score = -RANK_PTS[r] * 20 - r - popcount(h[s]) * 2;
            }
            if (score > bestScore) { bestScore = score; best = c; }
        }
        return best;
    }

    // Following.
    const winnerSide = sideOf(st, st.winP);
    const amLast = st.plays.length === 2;
    const seatsAfterMe = 3 - st.plays.length - 1;
    if (winnerSide === mySide) {
        // Partner (or my own lead) is winning. Secure → schmear points.
        if (amLast || !laterCanBeat(st, (p + 1) % 3, seatsAfterMe, mySide)) {
            let best = legal[0];
            for (const c of legal) {
                const d = idxPts(c) - idxPts(best);
                if (d > 0 || (d === 0 && (c % 9) < (best % 9))) best = c;
            }
            if (idxPts(best) > 0) return best;
        }
        return cheapest(legal);
    }
    // Opponent winning: the cheapest card that takes the trick AND stands
    // against the seats still to act; if nothing stands, throw the cheapest.
    let win = -1;
    for (const c of legal) {
        const s = (c / 9) | 0;
        const r = c % 9;
        if (!beatsWinner(st, s, r)) continue;
        if (win !== -1 && rankCost(c) >= rankCost(win)) continue;
        if (!amLast) {
            applyPlay(st, p, s, r);
            const stands = !laterCanBeat(st, (p + 1) % 3, seatsAfterMe, mySide);
            undoPlay(st);
            if (!stands) continue;
        }
        win = c;
    }
    if (win !== -1) return win;
    return cheapest(legal);
}

// Point cost first, then rank (a 10 outranks a K but is worth more).
const rankCost = (c) => idxPts(c) * 10 + (c % 9);
function cheapest(legal) {
    let best = legal[0];
    for (const c of legal) if (rankCost(c) < rankCost(best)) best = c;
    return best;
}

function popcount(m) {
    let n = 0;
    while (m) { m &= m - 1; n += 1; }
    return n;
}

// --- Exact solver ---------------------------------------------------------

// Moves for alpha-beta in a good static order, built in one pass with no
// sorting: cards that take the trick as it stands (high to low), then the
// rest cheap to dear — rank order IS point order in this deck. On a lead,
// "takes the trick" means boss of its suit. The policy's own pick then
// jumps the queue where that pays (leads, and deep positions).
function orderedMoves(st, p) {
    const following = st.plays.length > 0;
    const winners = [];
    const losers = [];
    const others = [
        st.hands[(p + 1) % 3][0] | st.hands[(p + 2) % 3][0],
        st.hands[(p + 1) % 3][1] | st.hands[(p + 2) % 3][1],
        st.hands[(p + 1) % 3][2] | st.hands[(p + 2) % 3][2],
        st.hands[(p + 1) % 3][3] | st.hands[(p + 2) % 3][3],
    ];
    for (const [s, mask] of legalSuits(st, p)) {
        const boss = following ? -1 : topRank(mask | others[s]);
        let m = mask;
        let lastZeroRank = -1;
        while (m) {
            const r = lowRank(m);
            m &= ~(1 << r);
            if (RANK_PTS[r] === 0) {
                if (lastZeroRank !== -1) {
                    const between = ((1 << r) - 1) & ~((1 << (lastZeroRank + 1)) - 1);
                    if ((others[s] & between) === 0) continue;
                }
                lastZeroRank = r;
            }
            const c = s * 9 + r;
            const wins = following ? beatsWinner(st, s, r) : r === boss;
            if (wins) winners.push(c); else losers.push(c);
        }
    }
    winners.reverse();
    const ordered = winners.length ? winners.concat(losers) : losers;
    if (ordered.length <= 1) return ordered;
    const usePolicy = st.orderMode === 'policy'
        || (st.orderMode === 'lead' && !following)
        || (st.orderMode === 'deep' && (st.tricksLeft >= 7 || !following));
    if (!usePolicy) return ordered;
    const pick = policyPick(st, p, ordered);
    if (ordered[0] === pick) return ordered;
    const out = [pick];
    for (const c of ordered) if (c !== pick) out.push(c);
    return out;
}

function ttLookup(st) {
    const k0 = handKey(st.hands[0]);
    let m1 = st.tt.get(k0);
    if (!m1) { m1 = new Map(); st.tt.set(k0, m1); }
    const k1 = handKey(st.hands[1]);
    let m2 = m1.get(k1);
    if (!m2) { m2 = new Map(); m1.set(k1, m2); }
    const k2 = handKey(st.hands[2]) * 8 + st.leader * 2 + (st.broken ? 1 : 0);
    return { map: m2, key: k2, entry: m2.get(k2) };
}

// Future bidder points from the current position, exact within (alpha, beta),
// fail-soft. Throws ABORT when the node budget runs out.
function solve(st, alpha, beta) {
    if (st.tricksLeft === 0) return 0;
    // The bidder's future lies in [0, points still unscored (+ the last-trick
    // widow)]. Outside the window the exact value cannot matter — and when
    // only junk is left, the position is already decided.
    const maxFuture = st.ptsLeft + st.lastTrickBonus;
    if (maxFuture <= alpha || maxFuture === 0) return maxFuture;
    if (beta <= 0) return 0;
    st.nodes += 1;
    if (st.nodes > st.maxNodes) throw ABORT;

    const atBoundary = st.plays.length === 0;
    let slot = null;
    if (atBoundary && st.tt) {
        slot = ttLookup(st);
        const e = slot.entry;
        if (e) {
            if (e.lo === e.hi) return e.lo;
            if (e.lo >= beta) return e.lo;
            if (e.hi <= alpha) return e.hi;
            if (e.lo > alpha) alpha = e.lo;
            if (e.hi < beta) beta = e.hi;
        }
    }
    // The window actually searched — a result outside it is only a bound.
    const alpha0 = alpha;
    const beta0 = beta;

    const p = seatToAct(st);
    const isMax = p === st.bidder;
    const moves = orderedMoves(st, p);
    let best = isMax ? -Infinity : Infinity;
    for (const c of moves) {
        const s = (c / 9) | 0;
        const r = c % 9;
        applyPlay(st, p, s, r);
        let val;
        if (st.plays.length === 3) {
            const closed = closeTrick(st);
            val = closed.gained + solve(st, alpha - closed.gained, beta - closed.gained);
            reopenTrick(st, closed);
        } else {
            val = solve(st, alpha, beta);
        }
        undoPlay(st);
        if (isMax) {
            if (val > best) best = val;
            if (best > alpha) alpha = best;
        } else {
            if (val < best) best = val;
            if (best < beta) beta = best;
        }
        if (alpha >= beta) break;
    }

    if (slot) {
        const e = slot.entry || { lo: -Infinity, hi: Infinity };
        if (best <= alpha0) { if (best < e.hi) e.hi = best; }
        else if (best >= beta0) { if (best > e.lo) e.lo = best; }
        else { e.lo = best; e.hi = best; }
        if (!slot.entry) slot.map.set(slot.key, e);
    }
    return best;
}

function snapshot(st) {
    return {
        hands: st.hands.map(h => h.slice()),
        leader: st.leader,
        plays: st.plays.slice(),
        leadSuit: st.leadSuit, winP: st.winP, winS: st.winS, winR: st.winR,
        trickPts: st.trickPts, tricksLeft: st.tricksLeft, bidderPts: st.bidderPts,
        broken: st.broken, ptsLeft: st.ptsLeft,
    };
}

function restore(st, snap) {
    for (let p = 0; p < 3; p += 1) for (let s = 0; s < 4; s += 1) st.hands[p][s] = snap.hands[p][s];
    st.leader = snap.leader;
    st.plays = snap.plays.slice();
    st.leadSuit = snap.leadSuit; st.winP = snap.winP; st.winS = snap.winS; st.winR = snap.winR;
    st.trickPts = snap.trickPts; st.tricksLeft = snap.tricksLeft; st.bidderPts = snap.bidderPts;
    st.broken = snap.broken; st.ptsLeft = snap.ptsLeft;
}

// Exact future bidder points from the current position, or null when the
// node budget ran out (the state is restored either way).
function solveExact(st, maxNodes, tt) {
    st.maxNodes = maxNodes;
    st.nodes = 0;
    st.tt = tt || new Map();
    const snap = snapshot(st);
    try {
        return solve(st, -Infinity, Infinity);
    } catch (err) {
        if (err !== ABORT) throw err;
        restore(st, snap);
        return null;
    }
}

// Play the position forward with the policy until `untilTricksLeft` remain
// (or the round ends). Every play is recorded on the stacks for unwind().
function rollForward(st, untilTricksLeft, undoStack, closedStack) {
    while (st.tricksLeft > untilTricksLeft && st.tricksLeft > 0) {
        const p = seatToAct(st);
        const c = policyPick(st, p, legalCardsPruned(st, p, false));
        applyPlay(st, p, (c / 9) | 0, c % 9);
        undoStack.push(1);
        if (st.plays.length === 3) {
            closedStack.push(closeTrick(st));
            undoStack.push(2);
        }
    }
}

function unwind(st, undoStack, closedStack) {
    while (undoStack.length) {
        const kind = undoStack.pop();
        if (kind === 2) reopenTrick(st, closedStack.pop());
        else undoPlay(st);
    }
}

// Roll the round forward with the policy until `exactTricks` remain, then
// solve exactly. Returns FINAL bidder points (bonus included); the state is
// left as it was. Falls back to a full policy playout when the solver runs
// out of budget.
function evaluate(st, { exactTricks, maxNodes, tt }) {
    const undoStack = [];
    const closedStack = [];
    rollForward(st, exactTricks, undoStack, closedStack);
    let future = st.tricksLeft > 0 ? solveExact(st, maxNodes, tt) : 0;
    if (future === null) {
        rollForward(st, 0, undoStack, closedStack);
        future = 0;
    }
    const total = st.bidderPts + future + st.bonus;
    unwind(st, undoStack, closedStack);
    return total;
}

module.exports = {
    SUIT_IDX, SUIT_CHARS, RANK_PTS, TRICKS_PER_ROUND,
    cardIdx, cardStr, idxPts,
    makeState, applyPlay, undoPlay, closeTrick, reopenTrick,
    legalCardsPruned, policyPick, solveExact, evaluate, handKey, popcount,
};
