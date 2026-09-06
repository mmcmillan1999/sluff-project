'use strict';

// Tournament seating (the Sluff Tournament whiteboard, Sept 2026).
//
// After every chip transfer the field is counted and split into tables of
// three or four seats: n divisible by 3 gives all three-seat tables,
// remainder 1 gives one four-seat table, remainder 2 gives two. Five is the
// one field a four-seat table cannot cover, so five is a single table where
// two players share the widow seat. Tables are filled top with top: the room
// is sorted by stack and the four-seat tables sit at the bottom of the field.
//
// A four-seat table is the engine's 4-player mode: the "dealer" sits out,
// peeks at the widow and collects the failed bidder's third share. Who sits
// out is decided by a per-tournament sit-out count (fewest first, shortest
// stack on ties) so nobody is the widow seat twice while others never were.

function tableSizes(n) {
    if (!Number.isInteger(n) || n < 3) return [];
    if (n === 3) return [3];
    if (n === 4) return [4];
    if (n === 5) return [5];
    const fours = n % 3 === 1 ? 1 : (n % 3 === 2 ? 2 : 0);
    const threes = (n - 4 * fours) / 3;
    return [...new Array(threes).fill(3), ...new Array(fours).fill(4)];
}

const byStackDesc = (a, b) => (b.stack - a.stack) || (a.sitOuts - b.sitOuts) || (a.userId - b.userId);
const bySitOutPriority = (a, b) => (a.sitOuts - b.sitOuts) || (a.stack - b.stack) || (a.userId - b.userId);

function normalize(player) {
    return {
        userId: Number(player.userId),
        stack: Number(player.stack) || 0,
        sitOuts: Number(player.sitOuts) || 0,
        deals: Number(player.deals) || 0,
    };
}

// The dealer at a three-seat table (who plays the round like anyone else) is
// the seat that has dealt the fewest times this tournament, random on ties.
function pickDealer(group, random) {
    const fewest = Math.min(...group.map(player => player.deals));
    const candidates = group.filter(player => player.deals === fewest);
    const sample = Number(random());
    const unit = Number.isFinite(sample) && sample >= 0 && sample < 1 ? sample : 0;
    return candidates[Math.floor(unit * candidates.length)];
}

function seatTable(group, index, random) {
    const sitOutCount = group.length - 3;
    if (sitOutCount <= 0) {
        return {
            index,
            playerMode: 3,
            seats: group.map(player => player.userId),
            dealerUserId: pickDealer(group, random).userId,
            sitOutUserIds: [],
            spectatorUserIds: [],
        };
    }
    const sitOuts = [...group].sort(bySitOutPriority).slice(0, sitOutCount);
    // The first sit-out is the engine's sitting-out dealer; any further
    // sit-out (only at exactly five players) shares that seat as a spectator
    // and the director splits the widow share between them.
    const [dealer, ...spectators] = sitOuts;
    const spectatorIds = new Set(spectators.map(player => player.userId));
    return {
        index,
        playerMode: 4,
        seats: group.filter(player => !spectatorIds.has(player.userId)).map(player => player.userId),
        dealerUserId: dealer.userId,
        sitOutUserIds: sitOuts.map(player => player.userId),
        spectatorUserIds: spectators.map(player => player.userId),
    };
}

/**
 * Split the surviving field into tables for the next round.
 *
 * @param {Array<{userId:number, stack:number, sitOuts?:number, deals?:number}>} players
 * @returns {Array<{index:number, playerMode:3|4, seats:number[], dealerUserId:number,
 *                  sitOutUserIds:number[], spectatorUserIds:number[]}>}
 */
function seatRound(players, { random = Math.random } = {}) {
    const ranked = players.map(normalize).sort(byStackDesc);
    const sizes = tableSizes(ranked.length);
    const tables = [];
    let cursor = 0;
    sizes.forEach((size, index) => {
        tables.push(seatTable(ranked.slice(cursor, cursor + size), index, random));
        cursor += size;
    });
    return tables;
}

module.exports = { tableSizes, seatRound };
