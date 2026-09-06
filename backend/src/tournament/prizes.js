'use strict';

// Tournament placings and prizes. Fields of six or more pay three places
// (50 / 30 / 20); smaller fields pay two (65 / 35). Everything is integer
// cents and any rounding remainder goes to first place, so a pot always
// pays out exactly what was bought in.

const STANDARD_SHARES = Object.freeze([0.5, 0.3, 0.2]);
const SMALL_FIELD_SHARES = Object.freeze([0.65, 0.35]);

function prizeShares(fieldSize) {
    return fieldSize >= 6 ? STANDARD_SHARES : SMALL_FIELD_SHARES;
}

function prizeSplitCents(potCents, fieldSize) {
    if (!Number.isInteger(potCents) || potCents < 0) {
        throw new RangeError('potCents must be a non-negative integer');
    }
    const cents = prizeShares(fieldSize).map(share => Math.floor(potCents * share));
    const remainder = potCents - cents.reduce((sum, value) => sum + value, 0);
    cents[0] += remainder;
    return cents;
}

/**
 * Order the finishers. Survivors rank by stack; the busted rank by the round
 * they went out in (later is better), then by stack (less negative is
 * better). Equal keys share a place, which is how game settlement already
 * treats a tie.
 *
 * @returns {Array<{userId:number, place:number, stack:number, bustedRound:number|null}>}
 */
function rankFinishers({ survivors = [], busted = [] } = {}) {
    const ordered = [
        ...[...survivors]
            .sort((a, b) => (b.stack - a.stack) || (a.userId - b.userId))
            .map(player => ({ ...player, bustedRound: null, key: `s:${player.stack}` })),
        ...[...busted]
            .sort((a, b) => (b.bustedRound - a.bustedRound) || (b.stack - a.stack) || (a.userId - b.userId))
            .map(player => ({ ...player, key: `b:${player.bustedRound}:${player.stack}` })),
    ];
    const placings = [];
    let place = 1;
    ordered.forEach((player, index) => {
        const tiedWithPrevious = index > 0 && ordered[index - 1].key === player.key;
        if (!tiedWithPrevious) place = index + 1;
        placings.push({
            userId: Number(player.userId),
            place,
            stack: Number(player.stack),
            bustedRound: player.bustedRound,
        });
    });
    return placings;
}

/**
 * Prize money per player. Tied players pool the prizes of the places they
 * span and split them evenly (any odd cent to the lowest user id, the same
 * deterministic rule game settlement uses).
 *
 * @returns {Map<number, number>} userId -> prize cents
 */
function allocatePrizeCents(placings, potCents, fieldSize) {
    const byPlace = prizeSplitCents(potCents, fieldSize);
    const prizeAtPosition = position => byPlace[position - 1] || 0;
    const allocations = new Map();
    let start = 0;
    while (start < placings.length) {
        let end = start;
        while (end + 1 < placings.length && placings[end + 1].place === placings[start].place) end += 1;
        const group = placings.slice(start, end + 1);
        let pool = 0;
        for (let position = start + 1; position <= end + 1; position += 1) pool += prizeAtPosition(position);
        const base = Math.floor(pool / group.length);
        let remainder = pool - base * group.length;
        [...group].sort((a, b) => a.userId - b.userId).forEach(player => {
            allocations.set(player.userId, base + (remainder > 0 ? 1 : 0));
            if (remainder > 0) remainder -= 1;
        });
        start = end + 1;
    }
    return allocations;
}

module.exports = { prizeShares, prizeSplitCents, rankFinishers, allocatePrizeCents };
