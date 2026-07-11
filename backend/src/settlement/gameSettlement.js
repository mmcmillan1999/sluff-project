'use strict';

const { TABLE_COSTS } = require('../core/constants');

function createSettlementSnapshot(payload) {
    const snapshot = structuredClone(payload);
    return deepFreeze(snapshot);
}

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
    return value;
}

function toCents(amount) {
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount)) throw new TypeError('Settlement amount must be finite');
    return Math.round(numericAmount * 100);
}

function fromCents(cents) {
    return Number((cents / 100).toFixed(2));
}

function formatCents(cents) {
    return (cents / 100).toFixed(2);
}

function tableCostCents(theme) {
    return toCents(TABLE_COSTS[theme] ?? 0);
}

function normalizePlayers(table) {
    const rawPlayers = Object.values(table.players || {});
    const seatOrder = new Map((table.seatingOrderIds || []).map((id, index) => [String(id), index]));
    return rawPlayers
        .filter(player => player && !player.isSpectator)
        .map((player, fallbackIndex) => ({
            userId: player.userId,
            playerName: player.playerName,
            isBot: player.isBot === true,
            score: finiteScore(table.scores?.[player.playerName]),
            seatIndex: seatOrder.get(String(player.userId)) ?? (seatOrder.size + fallbackIndex),
        }));
}

function finiteScore(score) {
    const numericScore = Number(score);
    return Number.isFinite(numericScore) ? numericScore : 0;
}

function compareIdentity(left, right) {
    const leftId = Number(left.userId);
    const rightId = Number(right.userId);
    if (Number.isFinite(leftId) && Number.isFinite(rightId) && leftId !== rightId) {
        return leftId - rightId;
    }
    return String(left.playerName).localeCompare(String(right.playerName));
}

function rankPlayers(players) {
    return [...players].sort((left, right) => (
        right.score - left.score
        || left.seatIndex - right.seatIndex
        || compareIdentity(left, right)
    ));
}

function actualWinnerName(players) {
    const rankings = rankPlayers(players);
    if (rankings.length === 0) return 'No Winner';
    const topScore = rankings[0].score;
    return rankings
        .filter(player => player.score === topScore)
        .map(player => player.playerName)
        .join(' & ');
}

function allocateEvenCents(totalCents, players) {
    if (!Number.isInteger(totalCents) || totalCents < 0) {
        throw new RangeError('Even allocation requires non-negative integer cents');
    }
    if (players.length === 0) return new Map();

    const ordered = [...players].sort(compareIdentity);
    const base = Math.floor(totalCents / ordered.length);
    let remainder = totalCents - (base * ordered.length);
    const allocations = new Map();
    for (const player of ordered) {
        const cents = base + (remainder > 0 ? 1 : 0);
        if (remainder > 0) remainder -= 1;
        allocations.set(player.userId, cents);
    }
    return allocations;
}

function allocateWeightedCents(totalCents, players, weightForPlayer) {
    if (!Number.isInteger(totalCents) || totalCents < 0) {
        throw new RangeError('Weighted allocation requires non-negative integer cents');
    }
    if (players.length === 0) return new Map();

    const weighted = players.map(player => ({
        player,
        weight: Math.max(0, finiteScore(weightForPlayer(player))),
    }));
    const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
    if (totalWeight <= 0) return allocateEvenCents(totalCents, players);

    const allocations = new Map();
    const remainders = [];
    let allocated = 0;
    for (const item of weighted) {
        const exact = totalCents * item.weight / totalWeight;
        const floor = Math.floor(exact);
        allocations.set(item.player.userId, floor);
        allocated += floor;
        remainders.push({ player: item.player, fraction: exact - floor });
    }

    remainders.sort((left, right) => (
        right.fraction - left.fraction
        || compareIdentity(left.player, right.player)
    ));
    let remaining = totalCents - allocated;
    for (let index = 0; remaining > 0; index = (index + 1) % remainders.length) {
        const player = remainders[index].player;
        allocations.set(player.userId, allocations.get(player.userId) + 1);
        remaining -= 1;
    }
    return allocations;
}

function validateHumanPlayers(players) {
    const seen = new Set();
    for (const player of players) {
        if (!Number.isInteger(player.userId) || player.userId <= 0) {
            throw new TypeError(`Invalid funded human user id: ${player.userId}`);
        }
        if (seen.has(player.userId)) throw new Error(`Duplicate funded human user id: ${player.userId}`);
        seen.add(player.userId);
    }
}

function normalHumanAllocations(humans, buyInCents) {
    const rankings = rankPlayers(humans);
    validateHumanPlayers(rankings);
    const entries = rankings.map((player, index) => ({
        player,
        cents: 0,
        stat: 'losses',
        rankLabel: ordinal(index + 1),
    }));

    if (entries.length === 0) return entries;
    if (entries.length === 1) {
        entries[0].cents = buyInCents;
        entries[0].stat = 'washes';
        return entries;
    }
    if (entries.length === 2) {
        if (entries[0].player.score === entries[1].player.score) {
            const tied = allocateEvenCents(buyInCents * 2, rankings);
            entries.forEach(entry => {
                entry.cents = tied.get(entry.player.userId);
                entry.stat = 'washes';
                entry.rankLabel = 'tied 1st-2nd';
            });
        } else {
            entries[0].cents = buyInCents * 2;
            entries[0].stat = 'wins';
            entries[1].stat = 'losses';
        }
        return entries;
    }
    if (entries.length === 3) {
        const [first, second, third] = entries;
        if (first.player.score === third.player.score) {
            entries.forEach(entry => {
                entry.cents = buyInCents;
                entry.stat = 'washes';
                entry.rankLabel = 'tied 1st-3rd';
            });
        } else if (first.player.score === second.player.score) {
            const tied = allocateEvenCents(buyInCents * 3, [first.player, second.player]);
            for (const entry of [first, second]) {
                entry.cents = tied.get(entry.player.userId);
                entry.stat = 'wins';
                entry.rankLabel = 'tied 1st-2nd';
            }
            third.stat = 'losses';
        } else if (second.player.score === third.player.score) {
            first.cents = buyInCents * 3;
            first.stat = 'wins';
            second.stat = 'losses';
            third.stat = 'losses';
            second.rankLabel = 'tied 2nd-3rd';
            third.rankLabel = 'tied 2nd-3rd';
        } else {
            first.cents = buyInCents * 2;
            first.stat = 'wins';
            second.cents = buyInCents;
            second.stat = 'washes';
            third.stat = 'losses';
        }
        return entries;
    }
    if (entries.length === 4) {
        const rankParts = [3 * buyInCents, buyInCents, 0, 0];
        let start = 0;
        while (start < entries.length) {
            let end = start;
            while (end + 1 < entries.length && entries[end + 1].player.score === entries[start].player.score) end += 1;
            const group = entries.slice(start, end + 1);
            const pooledCents = rankParts.slice(start, end + 1).reduce((sum, cents) => sum + cents, 0);
            const allocations = allocateEvenCents(pooledCents, group.map(entry => entry.player));
            const comparison = pooledCents - (group.length * buyInCents);
            const stat = comparison > 0 ? 'wins' : comparison === 0 ? 'washes' : 'losses';
            const label = group.length === 1
                ? ordinal(start + 1)
                : `tied ${ordinal(start + 1)}-${ordinal(end + 1)}`;
            for (const entry of group) {
                entry.cents = allocations.get(entry.player.userId);
                entry.stat = stat;
                entry.rankLabel = label;
            }
            start = end + 1;
        }
        return entries;
    }

    throw new RangeError(`Unsupported funded human count: ${entries.length}`);
}

function ordinal(rank) {
    if (rank === 1) return '1st';
    if (rank === 2) return '2nd';
    if (rank === 3) return '3rd';
    return `${rank}th`;
}

function normalPayoutMessage(entry, buyInCents) {
    if (entry.stat === 'wins') {
        return `You finished ${entry.rankLabel} and won a net ${formatCents(entry.cents - buyInCents)} tokens!`;
    }
    if (entry.stat === 'washes') {
        return `You finished ${entry.rankLabel}. Your buy-in was returned.`;
    }
    if (entry.cents > 0) {
        return `You finished ${entry.rankLabel} and recovered ${formatCents(entry.cents)} of your ${formatCents(buyInCents)} token buy-in.`;
    }
    return `You finished ${entry.rankLabel} and lost your buy-in of ${formatCents(buyInCents)} tokens.`;
}

function buildTokenSettlement(players, buyInCents, allocationEntries) {
    const grossReturnsByUserId = new Map(
        allocationEntries.map(entry => [String(entry.player.userId), entry.cents]),
    );
    const orderedPlayers = [...players].sort((left, right) => (
        left.seatIndex - right.seatIndex
        || compareIdentity(left, right)
    ));
    const entries = orderedPlayers.map(player => {
        const funded = player.isBot !== true;
        const grossReturnCents = funded
            ? (grossReturnsByUserId.get(String(player.userId)) || 0)
            : 0;
        const netChangeCents = funded ? grossReturnCents - buyInCents : 0;
        const tokenOutcome = !funded
            ? 'not_funded'
            : netChangeCents > 0
                ? 'gain'
                : netChangeCents < 0
                    ? 'loss'
                    : 'even';

        return {
            playerName: player.playerName,
            isBot: player.isBot === true,
            funded,
            grossReturnCents,
            netChangeCents,
            tokenOutcome,
        };
    });

    return {
        buyInCents,
        potCents: entries.reduce((sum, entry) => sum + (entry.funded ? buyInCents : 0), 0),
        entries,
    };
}

function payoutTypeFor(entry, buyInCents) {
    return entry.stat === 'washes' && entry.cents === buyInCents
        ? 'wash_payout'
        : 'win_payout';
}

function buildNormalGameSettlement(table) {
    const players = normalizePlayers(table);
    const humans = players.filter(player => !player.isBot);
    const buyInCents = tableCostCents(table.theme);
    const allocations = normalHumanAllocations(humans, buyInCents);
    const expectedPot = humans.length * buyInCents;
    assertExactPot(allocations, expectedPot, 'normal game');

    const gameWinnerName = actualWinnerName(players);
    const payoutDetails = {};
    const payouts = [];
    const stats = [];
    for (const entry of allocations) {
        payoutDetails[entry.player.userId] = normalPayoutMessage(entry, buyInCents);
        stats.push({ userId: entry.player.userId, column: entry.stat });
        if (entry.cents > 0) {
            payouts.push({
                userId: entry.player.userId,
                type: payoutTypeFor(entry, buyInCents),
                amountCents: entry.cents,
                description: `Final ${entry.rankLabel} payout for game #${table.gameId}`,
            });
        }
    }
    const tokenSettlement = buildTokenSettlement(players, buyInCents, allocations);

    return {
        gameId: table.gameId,
        outcome: `Game Over! Winner: ${gameWinnerName}`,
        payouts,
        stats,
        result: { gameWinnerName, payoutDetails, tokenSettlement },
    };
}

function buildDrawSettlement(table, requestedOutcome) {
    const players = normalizePlayers(table);
    const humans = players.filter(player => !player.isBot);
    validateHumanPlayers(humans);
    const buyInCents = tableCostCents(table.theme);
    const resolvedOutcome = requestedOutcome === 'split' && humans.length === 3 ? 'split' : 'wash';
    const payoutCents = new Map();

    if (resolvedOutcome === 'wash') {
        for (const player of humans) payoutCents.set(player.userId, buyInCents);
    } else {
        const ascending = [...humans].sort((left, right) => (
            left.score - right.score || compareIdentity(left, right)
        ));
        const lowest = ascending[0];
        const splitters = ascending.slice(1).sort((left, right) => (
            right.score - left.score || compareIdentity(left, right)
        ));
        const lowestRecovery = Math.min(
            buyInCents,
            Math.max(0, Math.round(buyInCents * Math.max(0, lowest.score) / 120)),
        );
        payoutCents.set(lowest.userId, lowestRecovery);
        const bonus = allocateWeightedCents(
            buyInCents - lowestRecovery,
            splitters,
            player => player.score,
        );
        for (const player of splitters) {
            payoutCents.set(player.userId, buyInCents + bonus.get(player.userId));
        }
    }

    const entries = humans.map(player => ({ player, cents: payoutCents.get(player.userId) || 0 }));
    assertExactPot(entries, humans.length * buyInCents, `draw ${resolvedOutcome}`);
    const payouts = [];
    const summaryPayouts = {};
    for (const entry of entries) {
        summaryPayouts[entry.player.playerName] = {
            userId: entry.player.userId,
            totalReturn: fromCents(entry.cents),
        };
        if (entry.cents > 0) {
            payouts.push({
                userId: entry.player.userId,
                type: resolvedOutcome === 'wash' ? 'wash_payout' : 'win_payout',
                amountCents: entry.cents,
                description: `Draw (${resolvedOutcome}) payout for game #${table.gameId}`,
            });
        }
    }

    const summary = {
        isGameOver: true,
        drawOutcome: resolvedOutcome,
        gameWinner: 'Draw',
        payouts: summaryPayouts,
        tokenSettlement: buildTokenSettlement(players, buyInCents, entries),
        finalScores: { ...(table.scores || {}) },
        message: resolvedOutcome === 'wash'
            ? 'The game ended in a wash. Every funded human buy-in was returned.'
            : 'The game ended in a split pot. Human payouts are based on score.',
    };
    return {
        gameId: table.gameId,
        outcome: `Game Over! Draw (${resolvedOutcome})`,
        payouts,
        stats: humans.map(player => ({ userId: player.userId, column: 'washes' })),
        result: summary,
    };
}

function buildForfeitSettlement(table) {
    const players = normalizePlayers(table);
    const humans = players.filter(player => !player.isBot);
    validateHumanPlayers(humans);
    const buyInCents = tableCostCents(table.theme);
    const forfeitingPlayer = players.find(player => player.playerName === table.forfeitingPlayerName);
    const forfeitingHuman = humans.find(player => player.playerName === table.forfeitingPlayerName);
    const recipients = humans.filter(player => player.playerName !== table.forfeitingPlayerName);
    const payoutCents = new Map();
    const stats = [];

    if (!forfeitingHuman) {
        for (const player of humans) {
            payoutCents.set(player.userId, buyInCents);
            stats.push({ userId: player.userId, column: 'washes' });
        }
    } else {
        for (const player of recipients) payoutCents.set(player.userId, buyInCents);
        if (recipients.length > 0) {
            const extra = allocateWeightedCents(buyInCents, recipients, player => player.score);
            for (const player of recipients) {
                payoutCents.set(player.userId, payoutCents.get(player.userId) + extra.get(player.userId));
                stats.push({ userId: player.userId, column: 'wins' });
            }
        }
        stats.push({ userId: forfeitingHuman.userId, column: 'losses' });
    }

    const expectedPaidPot = forfeitingHuman && recipients.length === 0
        ? 0
        : humans.length * buyInCents;
    const entries = recipients.length === 0 && forfeitingHuman
        ? []
        : humans.filter(player => player !== forfeitingHuman).map(player => ({
            player,
            cents: payoutCents.get(player.userId) || 0,
        }));
    assertExactPot(entries, expectedPaidPot, 'forfeit');

    const payoutDetails = {};
    const payouts = [];
    for (const entry of entries) {
        payoutDetails[entry.player.userId] = forfeitingHuman
            ? `You received ${formatCents(entry.cents)} tokens after ${table.forfeitingPlayerName} forfeited.`
            : 'A bot forfeited. Your funded buy-in was returned.';
        if (entry.cents > 0) {
            payouts.push({
                userId: entry.player.userId,
                type: forfeitingHuman ? 'forfeit_payout' : 'wash_payout',
                amountCents: entry.cents,
                description: `Payout after ${table.forfeitingPlayerName} forfeited game #${table.gameId}`,
            });
        }
    }
    if (forfeitingHuman) payoutDetails[forfeitingHuman.userId] = 'You forfeited and lost your buy-in.';

    const remainingPlayers = players.filter(player => player.playerName !== table.forfeitingPlayerName);
    const gameWinnerName = remainingPlayers.length
        ? remainingPlayers.map(player => player.playerName).join(' & ')
        : 'Forfeit';
    const tokenSettlement = buildTokenSettlement(players, buyInCents, entries);

    return {
        gameId: table.gameId,
        outcome: `Game Over! ${table.forfeitingPlayerName} forfeited (${table.reason})`,
        payouts,
        stats,
        result: {
            gameWinnerName,
            payoutDetails,
            forfeitingPlayerIsBot: forfeitingPlayer?.isBot === true,
            tokenSettlement,
        },
    };
}

function assertExactPot(entries, expectedCents, label) {
    const total = entries.reduce((sum, entry) => sum + entry.cents, 0);
    if (total !== expectedCents) {
        throw new Error(`${label} settlement does not conserve its funded pot: expected ${expectedCents} cents, got ${total}`);
    }
}

module.exports = {
    allocateEvenCents,
    allocateWeightedCents,
    buildDrawSettlement,
    buildForfeitSettlement,
    buildNormalGameSettlement,
    createSettlementSnapshot,
    fromCents,
    tableCostCents,
    toCents,
};
