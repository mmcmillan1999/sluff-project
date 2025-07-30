// backend/src/core/logic.js

const { RANKS_ORDER, BID_MULTIPLIERS, PLACEHOLDER_ID, CARD_POINT_VALUES, TABLE_COSTS } = require('./constants');
const transactionManager = require('../data/transactionManager');

// =================================================================
// PURE UTILITY FUNCTIONS
// =================================================================

const getSuit = (cardStr) => (cardStr ? cardStr.slice(-1) : null);
const getRank = (cardStr) => (cardStr ? cardStr.slice(0, -1) : null);

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
    const remainingPlayers = Object.values(table.players).filter(p => 
        !p.isSpectator && 
        p.playerName !== forfeitingPlayerName
    );

    if (remainingPlayers.length === 0) return {};

    const tableBuyIn = TABLE_COSTS[table.theme] || 0;
    const forfeitedPot = tableBuyIn;
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
        .filter(p => !p.isSpectator && !p.isBot)
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

    if (insurance.dealExecuted) {
        const agreement = insurance.executedDetails.agreement;
        pointChanges[agreement.bidderPlayerName] += agreement.bidderRequirement;
        for (const defenderName in agreement.defenderOffers) {
            pointChanges[defenderName] -= agreement.defenderOffers[defenderName];
        }
        roundMessage = `Insurance deal executed. Points exchanged based on agreement.`;
    } else {
        const scoreDifferenceFrom60 = bidderTotalCardPoints - 60;
        const exchangeValue = Math.abs(scoreDifferenceFrom60) * currentBidMultiplier;
        if (scoreDifferenceFrom60 === 0) { 
            roundMessage = `${bidWinnerName} scored exactly 60. No points exchanged.`; 
        } else if (bidderTotalCardPoints > 60) {
            let totalPointsGained = 0;
            activePlayerNames.forEach(pName => { 
                if (pName !== bidWinnerName) { 
                    pointChanges[pName] -= exchangeValue;
                    totalPointsGained += exchangeValue; 
                } 
            });
            pointChanges[bidWinnerName] += totalPointsGained;
            roundMessage = `${bidWinnerName} succeeded! Gains ${totalPointsGained} points.`;
        } else { // Bidder failed
            let totalPointsLost = 0;
            const activeOpponents = activePlayerNames.filter(pName => pName !== bidWinnerName);
            activeOpponents.forEach(oppName => { 
                pointChanges[oppName] += exchangeValue; 
                totalPointsLost += exchangeValue; 
            });
            if (playerMode === 3) { 
                pointChanges[PLACEHOLDER_ID] += exchangeValue; 
                totalPointsLost += exchangeValue; 
            }
            else if (playerMode === 4) { 
                const dealerName = table.players[table.dealer]?.playerName;
                if(dealerName && !activeOpponents.includes(dealerName) && dealerName !== bidWinnerName) {
                    pointChanges[dealerName] += exchangeValue; 
                    totalPointsLost += exchangeValue;
                }
            }
            pointChanges[bidWinnerName] -= totalPointsLost;
            roundMessage = `${bidWinnerName} failed. Loses ${totalPointsLost} points.`;
        }
    }
    
    console.log('[DEBUG] About to calculate insurance hindsight. PlayerMode:', table.playerMode, 'Insurance active:', table.insurance?.isActive, 'Deal executed:', table.insurance?.dealExecuted);
    const insuranceHindsight = calculateInsuranceHindsight(table, pointChanges);
    console.log('[DEBUG] Insurance hindsight result:', insuranceHindsight);

    const finalBidderPoints = bidderTotalCardPoints;
    const finalDefenderPoints = 120 - finalBidderPoints;

    return {
        pointChanges,
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
            .filter(p => p && !p.isBot)
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

    const humanPlayers = Object.values(table.players).filter(p => !p.isBot && !p.isSpectator);
    const statPromises = [];
    const transactionPromises = [];

    if (outcome === 'wash') {
        summaryData.message = "The game has ended in a wash. All buy-ins have been returned.";
        for (const player of humanPlayers) {
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


function calculateInsuranceHindsight(table, pointChanges) {
    console.log('[DEBUG] calculateInsuranceHindsight called. PlayerMode:', table.playerMode);
    if (table.playerMode !== 3) {
        console.log('[DEBUG] Returning null - not 3 player mode');
        return null;
    }

    const { bidWinnerInfo, insurance, players } = table;
    const bidWinnerName = bidWinnerInfo.playerName;
    const defenders = Object.values(players)
        .filter(p => !p.isSpectator && p.playerName !== bidWinnerName)
        .map(p => p.playerName);
    
    const hindsight = {};
    
    console.log('[DEBUG] Insurance state:', { isActive: insurance.isActive, dealExecuted: insurance.dealExecuted, bidderRequirement: insurance.bidderRequirement });

    if (insurance.dealExecuted) {
        console.log('[DEBUG] Insurance deal was executed, calculating hindsight...');
        // Hindsight is what would have happened if they played it out.
        // The "actual" points are from the deal, "potential" are from the cards.
        const actualPointsFromDeal = pointChanges;
        const potentialPointsFromCards = {};
        
        const scoreDifferenceFrom60 = table.bidderCardPoints - 60;
        const exchangeValue = Math.abs(scoreDifferenceFrom60) * insurance.bidMultiplier;
        
        if (scoreDifferenceFrom60 > 0) { // Bidder would have succeeded
            potentialPointsFromCards[bidWinnerName] = exchangeValue * 2;
            defenders.forEach(def => potentialPointsFromCards[def] = -exchangeValue);
        } else { // Bidder would have failed
            potentialPointsFromCards[bidWinnerName] = -(exchangeValue * 2);
            defenders.forEach(def => potentialPointsFromCards[def] = exchangeValue);
        }

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
    calculateCardPoints
};