// backend/src/core/handlers/biddingHandler.js

const { BID_HIERARCHY } = require('../constants');

function placeBid(engine, userId, bid) {
    if (userId !== engine.biddingTurnPlayerId) return [];
    const player = engine.players[userId];
    if (!player) return [];

    // --- Handle Frog Upgrade Decision ---
    if (engine.state === "Awaiting Frog Upgrade Decision") {
        if (userId !== engine.originalFrogBidderId || (bid !== "Heart Solo" && bid !== "Pass")) return [];
        if (bid === "Heart Solo") {
            engine.currentHighestBidDetails = { userId, playerName: player.playerName, bid: "Heart Solo" };
        }
        engine.biddingTurnPlayerId = null;
        return resolveBiddingFinal(engine);
    }

    // --- Handle Normal Bidding ---
    if (engine.state !== "Bidding Phase" || !BID_HIERARCHY.includes(bid) || engine.playersWhoPassedThisRound.includes(userId)) return [];
    
    const currentHighestBidIndex = engine.currentHighestBidDetails ? BID_HIERARCHY.indexOf(engine.currentHighestBidDetails.bid) : -1;
    if (bid !== "Pass" && BID_HIERARCHY.indexOf(bid) <= currentHighestBidIndex) return [];
    
    if (bid !== "Pass") {
        engine.currentHighestBidDetails = { userId, playerName: player.playerName, bid };
        if (bid === "Frog" && !engine.originalFrogBidderId) engine.originalFrogBidderId = userId;
        if (bid === "Solo" && engine.originalFrogBidderId && userId !== engine.originalFrogBidderId) engine.soloBidMadeAfterFrog = true;
    } else {
        engine.playersWhoPassedThisRound.push(userId);
    }
    
    // --- Check if Bidding Round is Over ---
    const activeBiddersRemaining = engine.playerOrder.turnOrder.filter(id => !engine.playersWhoPassedThisRound.includes(id));
    if ((engine.currentHighestBidDetails && activeBiddersRemaining.length <= 1) || engine.playersWhoPassedThisRound.length === engine.playerOrder.turnOrder.length) {
        engine.biddingTurnPlayerId = null;
        return checkForFrogUpgrade(engine);
    } else {
        // --- Advance to Next Bidder ---
        const currentBidderIndex = engine.playerOrder.turnOrder.indexOf(userId);
        let nextBidderId = null;
        for (let i = 1; i < engine.playerOrder.turnOrder.length; i++) {
            let potentialNextBidderId = engine.playerOrder.turnOrder[(currentBidderIndex + i) % engine.playerOrder.turnOrder.length];
            if (!engine.playersWhoPassedThisRound.includes(potentialNextBidderId)) {
                nextBidderId = potentialNextBidderId;
                break;
            }
        }
        if (nextBidderId) { 
            engine.biddingTurnPlayerId = nextBidderId; 
        } else { 
            return checkForFrogUpgrade(engine);
        }
    }
    return [{ type: 'BROADCAST_STATE' }];
}

function checkForFrogUpgrade(engine) {
    if (engine.soloBidMadeAfterFrog && engine.originalFrogBidderId) {
        engine.state = "Awaiting Frog Upgrade Decision";
        engine.biddingTurnPlayerId = engine.originalFrogBidderId;
        return [{ type: 'BROADCAST_STATE' }];
    } else {
        return resolveBiddingFinal(engine);
    }
}

function resolveBiddingFinal(engine) {
    if (!engine.currentHighestBidDetails) {
        engine.state = "AllPassWidowReveal";
        return [{
            type: 'START_TIMER',
            payload: {
                duration: 3000,
                onTimeout: (engineRef) => {
                    if (engineRef.state === "AllPassWidowReveal") {
                        engineRef._advanceRound();
                        return [{ type: 'BROADCAST_STATE' }];
                    }
                    return [];
                }
            }
        }];
    }
    
    engine.bidWinnerInfo = { ...engine.currentHighestBidDetails };
    const bid = engine.bidWinnerInfo.bid;
    if (bid === "Frog") { 
        engine.trumpSuit = "H"; 
        engine.state = "Frog Widow Exchange";
        engine.revealedWidowForFrog = [...engine.widow];
        const bidderHand = engine.hands[engine.bidWinnerInfo.playerName];
        engine.hands[engine.bidWinnerInfo.playerName] = [...bidderHand, ...engine.widow];
    } else if (bid === "Heart Solo") { 
        engine.trumpSuit = "H"; 
        engine._transitionToPlayingPhase();
    } else if (bid === "Solo") { 
        engine.state = "Trump Selection";
    }
    engine.originalFrogBidderId = null;
    engine.soloBidMadeAfterFrog = false;
    return [{ type: 'BROADCAST_STATE' }];
}

module.exports = {
    placeBid
};