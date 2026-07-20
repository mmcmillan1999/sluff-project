// backend/src/core/logic.js

const { RANKS_ORDER, BID_MULTIPLIERS, PLACEHOLDER_ID, CARD_POINT_VALUES, TABLE_COSTS } = require('./constants');
const transactionManager = require('../data/transactionManager');

// =================================================================
// PURE UTILITY FUNCTIONS
// =================================================================

const getSuit = (cardStr) => (cardStr ? cardStr.slice(-1) : null);
const getRank = (cardStr) => (cardStr ? cardStr.slice(0, -1) : null);
const isFundedPlayer = player => Number.isInteger(player?.userId) && player.userId > 0;

const calculateCardPoints = (cardsArray) => {
    if (!cardsArray || cardsArray.length === 0) return 0;
    return cardsArray.reduce((sum, cardString) => sum + (CARD_POINT_VALUES[getRank(cardString)] || 0), 0);
};

function determineTrickWinner(trickCards, leadSuit, trumpSuit) {
    let highestTrumpPlay = null;
    let highestLeadSuitPlay = null;
    for (const play of trickCards) {
        const cardSuit = getSuit(play.card);
        const cardRankIndex = RANKS_ORDER.indexOf(getRank(play.card));
        if (cardSuit === trumpSuit) {
            if (!highestTrumpPlay || cardRankIndex > RANKS_ORDER.indexOf(getRank(highestTrumpPlay.card))) {
                highestTrumpPlay = play;
            }
        } else if (cardSuit === leadSuit) {
            if (!highestLeadSuitPlay || cardRankIndex > RANKS_ORDER.indexOf(getRank(highestLeadSuitPlay.card))) {
                highestLeadSuitPlay = play;
            }
        }
    }
    return highestTrumpPlay || highestLeadSuitPlay;
}


// =================================================================
// PURE CALCULATION FUNCTIONS (Called by GameEngine/GameService)
// =================================================================

function calculateForfeitPayout(table, forfeitingPlayerName) {
    const forfeitingPlayer = Object.values(table.players).find(p => p.playerName === forfeitingPlayerName);
    const remainingPlayers = Object.values(table.players).filter(p => 
        !p.isSpectator && 
        isFundedPlayer(p) &&
        p.playerName !== forfeitingPlayerName
    );

    if (remainingPlayers.length === 0) return {};

    const tableBuyIn = TABLE_COSTS[table.theme] || 0;
    // Negative-id fallback bots are unfunded. Persistent positive-id bots own
    // the same stake as every other account.
    const forfeitedPot = isFundedPlayer(forfeitingPlayer) ? tableBuyIn : 0;
    const totalScoreOfRemaining = remainingPlayers.reduce((sum, player) => sum + (table.scores[player.playerName] || 0), 0);
    
    const payoutDetails = {};
    if (totalScoreOfRemaining > 0) {
        remainingPlayers.forEach(player => {
            const playerScore = table.scores[player.playerName] || 0;
            const proportion = playerScore / totalScoreOfRemaining;
            const shareOfPot = forfeitedPot * proportion;
            
            payoutDetails[player.playerName] = {
                totalGain: tableBuyIn + shareOfPot,
                buyInReturned: tableBuyIn,
                forfeitShare: shareOfPot,
            };
        });
    } else {
        const evenShare = forfeitedPot / remainingPlayers.length;
        remainingPlayers.forEach(player => {
            payoutDetails[player.playerName] = {
                totalGain: tableBuyIn + evenShare,
                buyInReturned: tableBuyIn,
                forfeitShare: evenShare,
            };
        });
    }

    return payoutDetails;
}

function calculateDrawSplitPayout(table) {
    const tableBuyIn = TABLE_COSTS[table.theme] || 0;
    const playersInOrder = Object.values(table.players)
        .filter(p => !p.isSpectator && isFundedPlayer(p))
        .map(p => ({ name: p.playerName, score: table.scores[p.playerName] || 0, userId: p.userId }))
        .sort((a, b) => a.score - b.score);

    if (playersInOrder.length !== 3) {
        return { wash: true, players: playersInOrder };
    }

    const [lowest, ...others] = playersInOrder;
    const [p1, p2] = others.sort((a,b) => b.score - a.score);

    const lowestRecoveryPercentage = Math.max(0, lowest.score) / 120;
    const lowestRecoveryAmount = tableBuyIn * lowestRecoveryPercentage;
    const remainingPot = tableBuyIn - lowestRecoveryAmount;
    
    const totalScoreOfSplitters = p1.score + p2.score;
    let p1Share = 0;
    let p2Share = 0;

    if (totalScoreOfSplitters > 0) {
        p1Share = remainingPot * (p1.score / totalScoreOfSplitters);
        p2Share = remainingPot * (p2.score / totalScoreOfSplitters);
    } else {
        p1Share = remainingPot / 2;
        p2Share = remainingPot / 2;
    }

    const payouts = {
        [lowest.name]: { userId: lowest.userId, totalReturn: lowestRecoveryAmount },
        [p1.name]: { userId: p1.userId, totalReturn: tableBuyIn + p1Share },
        [p2.name]: { userId: p2.userId, totalReturn: tableBuyIn + p2Share },
    };

    return { wash: false, payouts };
}


// The pure card-based point exchange for a round, ignoring insurance. This is
// what actually applies when no deal is struck, and the counterfactual we log
// alongside an executed deal ("what the cards would have paid"). Extracted so
// the applied no-deal path and the analytics counterfactual share one source
// of truth.
function calculateCardPointChanges({ activePlayerNames, bidWinnerName, bidderTotalCardPoints, bidMultiplier, playerMode, sittingOutDealerName }) {
    const changes = {};
    activePlayerNames.forEach(name => { changes[name] = 0; });
    if (playerMode === 3) changes[PLACEHOLDER_ID] = 0;
    if (sittingOutDealerName) changes[sittingOutDealerName] = 0;

    const scoreDifferenceFrom60 = bidderTotalCardPoints - 60;
    const exchangeValue = Math.abs(scoreDifferenceFrom60) * bidMultiplier;
    if (scoreDifferenceFrom60 === 0) return changes;

    if (bidderTotalCardPoints > 60) {
        let gained = 0;
        activePlayerNames.forEach(name => {
            if (name !== bidWinnerName) { changes[name] -= exchangeValue; gained += exchangeValue; }
        });
        changes[bidWinnerName] += gained;
    } else {
        let lost = 0;
        const opponents = activePlayerNames.filter(name => name !== bidWinnerName);
        opponents.forEach(name => { changes[name] += exchangeValue; lost += exchangeValue; });
        if (playerMode === 3) { changes[PLACEHOLDER_ID] += exchangeValue; lost += exchangeValue; }
        else if (playerMode === 4 && sittingOutDealerName
            && !opponents.includes(sittingOutDealerName) && sittingOutDealerName !== bidWinnerName) {
            changes[sittingOutDealerName] += exchangeValue; lost += exchangeValue;
        }
        changes[bidWinnerName] -= lost;
    }
    return changes;
}

function calculateRoundScoreDetails(table) {
    const { bidWinnerInfo, playerOrderActive, playerMode, capturedTricks, widowDiscardsForFrogBidder, originalDealtWidow, insurance, players, bidderTotalCardPoints } = table;
    const bidWinnerName = bidWinnerInfo.playerName;
    const bidType = bidWinnerInfo.bid;
    const currentBidMultiplier = BID_MULTIPLIERS[bidType];
    
    const activePlayerNames = playerOrderActive.map(id => players[id].playerName);
    
    let widowPoints = 0;
    let widowForReveal = [...originalDealtWidow];
    if (bidType === "Frog") {
        widowPoints = calculateCardPoints(widowDiscardsForFrogBidder);
        widowForReveal = [...widowDiscardsForFrogBidder];
    } else if (bidType === "Solo" || bidType === "Heart Solo") {
        widowPoints = calculateCardPoints(originalDealtWidow);
    }

    let roundMessage = "";
    const pointChanges = {};
    activePlayerNames.forEach(p => pointChanges[p] = 0);
    if(playerMode === 3) pointChanges[PLACEHOLDER_ID] = 0;
    // 4-player: the sitting-out dealer is the absorber — initialize their
    // entry so the failed-bid branch below adds to a number, not undefined.
    const sittingOutDealerName = playerMode === 4 ? table.players[table.dealer]?.playerName : null;
    if (sittingOutDealerName) pointChanges[sittingOutDealerName] = 0;

    if (insurance.dealExecuted) {
        const agreement = insurance.executedDetails.agreement;
        const defenderOfferTotal = Object.values(agreement.defenderOffers || {})
            .reduce((sum, offer) => sum + (Number(offer) || 0), 0);
        const bidderSettlement = Number.isFinite(agreement.bidderSettlement)
            ? agreement.bidderSettlement
            : defenderOfferTotal;
        pointChanges[agreement.bidderPlayerName] += bidderSettlement;
        for (const defenderName in agreement.defenderOffers) {
            pointChanges[defenderName] -= agreement.defenderOffers[defenderName];
        }
        roundMessage = `Insurance deal executed. Points exchanged based on agreement.`;
    } else {
        // Card-based exchange (shared helper — see calculateCardPointChanges).
        const cardChanges = calculateCardPointChanges({
            activePlayerNames, bidWinnerName, bidderTotalCardPoints,
            bidMultiplier: currentBidMultiplier, playerMode, sittingOutDealerName,
        });
        for (const name in cardChanges) pointChanges[name] = cardChanges[name];

        const bidderChange = pointChanges[bidWinnerName] || 0;
        if (bidderTotalCardPoints === 60) {
            roundMessage = `${bidWinnerName} scored exactly 60. No points exchanged.`;
        } else if (bidderTotalCardPoints > 60) {
            roundMessage = `${bidWinnerName} succeeded! Gains ${bidderChange} points.`;
        } else {
            roundMessage = `${bidWinnerName} failed. Loses ${Math.abs(bidderChange)} points.`;
        }
    }

    // Always compute the pure card outcome for analytics — when a deal
    // executes this is the "what the cards would have paid" counterfactual;
    // with no deal it equals the applied pointChanges above.
    const cardPointChanges = calculateCardPointChanges({
        activePlayerNames, bidWinnerName, bidderTotalCardPoints,
        bidMultiplier: currentBidMultiplier, playerMode, sittingOutDealerName,
    });

    const insuranceHindsight = calculateInsuranceHindsight(table, pointChanges, cardPointChanges);

    const finalBidderPoints = bidderTotalCardPoints;
    const finalDefenderPoints = 120 - finalBidderPoints;

    return {
        pointChanges,
        cardPointChanges,
        roundMessage,
        widowForReveal,
        insuranceHindsight,
        finalBidderPoints,
        finalDefenderPoints,
        widowPointsValue: widowPoints,
        bidType
    };
}


async function handleGameOver(table, transactionFn, statUpdateFn) {
    let gameWinnerName = "N/A";
    const { playerOrderActive, scores, theme, gameId, players } = table;
    try {
        const tableCost = TABLE_COSTS[theme] || 0;
        const transactionPromises = [];
        const statPromises = [];

        const finalPlayerScores = playerOrderActive
            .map(id => players[id])
            .filter(isFundedPlayer)
            .map(p => ({ name: p.playerName, score: scores[p.playerName], userId: p.userId }))
            .sort((a, b) => b.score - a.score);
        
        if (finalPlayerScores.length === 3) {
            const [p1, p2, p3] = finalPlayerScores;
            if (p1.score > p2.score && p2.score > p3.score) {
                gameWinnerName = p1.name;
                transactionPromises.push(transactionFn({ userId: p1.userId, gameId, type: 'win_payout', amount: tableCost * 2, description: `Win and Payout from ${p3.name}` }));
                statPromises.push(statUpdateFn("UPDATE users SET wins = wins + 1 WHERE id = $1", [p1.userId]));
                transactionPromises.push(transactionFn({ userId: p2.userId, gameId, type: 'wash_payout', amount: tableCost, description: `Wash - Buy-in returned` }));
                statPromises.push(statUpdateFn("UPDATE users SET washes = washes + 1 WHERE id = $1", [p2.userId]));
                statPromises.push(statUpdateFn("UPDATE users SET losses = losses + 1 WHERE id = $1", [p3.userId]));
            }
            else if (p1.score === p2.score && p2.score > p3.score) {
                gameWinnerName = `${p1.name} & ${p2.name}`;
                transactionPromises.push(transactionFn({ userId: p1.userId, gameId, type: 'win_payout', amount: tableCost * 1.5, description: `Win (tie) - Split payout from ${p3.name}` }));
                transactionPromises.push(transactionFn({ userId: p2.userId, gameId, type: 'win_payout', amount: tableCost * 1.5, description: `Win (tie) - Split payout from ${p3.name}` }));
                statPromises.push(statUpdateFn("UPDATE users SET wins = wins + 1 WHERE id = ANY($1::int[])", [[p1.userId, p2.userId]]));
                statPromises.push(statUpdateFn("UPDATE users SET losses = losses + 1 WHERE id = $1", [p3.userId]));
            }
            else if (p1.score > p2.score && p2.score === p3.score) {
                gameWinnerName = p1.name;
                transactionPromises.push(transactionFn({ userId: p1.userId, gameId, type: 'win_payout', amount: tableCost * 3, description: `Win - Collects full pot` }));
                statPromises.push(statUpdateFn("UPDATE users SET wins = wins + 1 WHERE id = $1", [p1.userId]));
                statPromises.push(statUpdateFn("UPDATE users SET losses = losses + 1 WHERE id = ANY($1::int[])", [[p2.userId, p3.userId]]));
            }
            else {
                gameWinnerName = "3-Way Tie";
                finalPlayerScores.forEach(p => {
                    transactionPromises.push(transactionFn({ userId: p.userId, gameId, type: 'wash_payout', amount: tableCost, description: `3-Way Tie - Buy-in returned` }));
                    statPromises.push(statUpdateFn("UPDATE users SET washes = washes + 1 WHERE id = $1", [p.userId]));
                });
            }
        }
        
        await Promise.all(transactionPromises);
        await Promise.all(statPromises);
        
    } catch(err) {
        console.error("Database error during game over update:", err);
    }
    return { gameWinnerName };
}

// --- NEW FUNCTION for handling draw game over ---
async function handleDrawGameOver(table, outcome, transactionFn, statUpdateFn) {
    const tableCost = TABLE_COSTS[table.theme] || 0;
    const gameId = table.gameId;
    let summaryData = {
        isGameOver: true,
        drawOutcome: outcome,
        gameWinner: "Draw",
        payouts: {},
        finalScores: table.scores,
    };

    const fundedPlayers = Object.values(table.players).filter(p => !p.isSpectator && isFundedPlayer(p));
    const statPromises = [];
    const transactionPromises = [];

    if (outcome === 'wash') {
        summaryData.message = "The game has ended in a wash. All buy-ins have been returned.";
        for (const player of fundedPlayers) {
            summaryData.payouts[player.playerName] = { totalReturn: tableCost };
            transactionPromises.push(transactionFn({ userId: player.userId, gameId, type: 'wash_payout', amount: tableCost, description: `Draw (Wash) - Buy-in returned` }));
            statPromises.push(statUpdateFn("UPDATE users SET washes = washes + 1 WHERE id = $1", [player.userId]));
        }
    } else if (outcome === 'split') {
        const splitResult = calculateDrawSplitPayout(table);
        if (splitResult.wash) { // Fallback for 4-player games etc.
            return handleDrawGameOver(table, 'wash', transactionFn, statUpdateFn);
        }
        summaryData.message = "The game has ended in a split pot. Payouts are based on score.";
        summaryData.payouts = splitResult.payouts;
        for (const playerName in splitResult.payouts) {
            const payoutInfo = splitResult.payouts[playerName];
            transactionPromises.push(transactionFn({ userId: payoutInfo.userId, gameId, type: 'win_payout', amount: payoutInfo.totalReturn, description: `Draw (Split) - Payout` }));
            statPromises.push(statUpdateFn("UPDATE users SET washes = washes + 1 WHERE id = $1", [payoutInfo.userId]));
        }
    }
    
    try {
        await Promise.all(transactionPromises);
        await Promise.all(statPromises);
        await transactionManager.updateGameRecordOutcome(table.pool, gameId, `Game Over! Draw (${outcome})`);
    } catch (err) {
        console.error("Database error during draw game over update:", err);
    }

    return summaryData;
}


function calculateInsuranceHindsight(table, pointChanges, cardPointChanges) {
    if (table.playerMode !== 3 && table.playerMode !== 4) return null;

    const { bidWinnerInfo, insurance, players } = table;
    const bidWinnerName = bidWinnerInfo.playerName;
    // Defenders = the round's active players minus the bidder. In 4-player
    // the sitting-out dealer is not in playerOrderActive and has no
    // insurance stake.
    const defenders = table.playerOrderActive
        .map(id => players[id]?.playerName)
        .filter(name => name && name !== bidWinnerName);
    
    const hindsight = {};

    if (insurance.dealExecuted) {
        // Hindsight is what would have happened if they played it out.
        // The "actual" points are from the deal, "potential" are from the
        // canonical card-only calculation above. Reusing that result matters
        // on a failed bid: the bidder also funds the widow/dealer share.
        const actualPointsFromDeal = pointChanges;
        const potentialPointsFromCards = cardPointChanges || {};

        [bidWinnerName, ...defenders].forEach(pName => {
            hindsight[pName] = {
                hindsightValue: (actualPointsFromDeal[pName] || 0) - (potentialPointsFromCards[pName] || 0)
            };
        });

    } else {
        // --- THIS IS THE CORRECTED LOGIC ---
        // Hindsight is what would have happened if they took a forced deal.
        // The "actual" points are from the cards, "potential" are from a hypothetical deal.
        const actualPointsFromCards = pointChanges;
        const potentialPointsFromDeal = {};
        const bidderRequirement = insurance.bidderRequirement;
        
        // Bidder's potential is what they asked for.
        potentialPointsFromDeal[bidWinnerName] = bidderRequirement;

        // Defenders' potential is the cost of the bidder's ask, split evenly.
        if (defenders.length > 0) {
            const costPerDefender = bidderRequirement / defenders.length;
            defenders.forEach(def => {
                potentialPointsFromDeal[def] = -costPerDefender;
            });
        }
        
        [bidWinnerName, ...defenders].forEach(pName => {
            hindsight[pName] = {
                hindsightValue: (actualPointsFromCards[pName] || 0) - (potentialPointsFromDeal[pName] || 0)
            };
        });
    }

    // Round all hindsight values for cleaner display
    for (const pName in hindsight) {
        hindsight[pName].hindsightValue = Math.round(hindsight[pName].hindsightValue);
    }
    
    return hindsight;
}

module.exports = {
    getSuit,
    getRank,
    determineTrickWinner,
    calculateRoundScoreDetails,
    handleGameOver,
    handleDrawGameOver,
    calculateForfeitPayout,
    calculateDrawSplitPayout,
    calculateCardPoints,
    calculateCardPointChanges
};
