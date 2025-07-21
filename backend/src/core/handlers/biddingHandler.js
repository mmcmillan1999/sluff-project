// backend/src/core/handlers/biddingHandler.js

const { BID_HIERARCHY } = require('../constants');

function placeBid(engine, userId, bid) {
    if (userId !== engine.biddingTurnPlayerId) return [];
    
    if (engine.state === "Awaiting Frog Upgrade Decision") {
        return handleFrogUpgrade(engine, userId, bid);
    }
    
    if (engine.state === "Bidding Phase") {
        return handleNormalBid(engine, userId, bid);
    }

    return [];
}

function handleFrogUpgrade(engine, userId, bid) {
    if (userId !== engine.originalFrogBidderId || (bid !== "Heart Solo" && bid !== "Pass")) return [];
    
    if (bid === "Heart Solo") {
        const player = engine.players[userId];
        engine.currentHighestBidDetails = { userId, playerName: player.playerName, bid: "Heart Solo" };
    }
    
    engine.biddingTurnPlayerId = null;
    return resolveBiddingFinal(engine);
}

function handleNormalBid(engine, userId, bid) {
    if (!BID_HIERARCHY.includes(bid) || engine.playersWhoPassedThisRound.includes(userId)) return [];
    
    const currentHighestBidIndex = engine.currentHighestBidDetails ? BID_HIERARCHY.indexOf(engine.currentHighestBidDetails.bid) : -1;
    if (bid !== "Pass" && BID_HIERARCHY.indexOf(bid) <= currentHighestBidIndex) return [];
    
    if (bid !== "Pass") {
        const player = engine.players[userId];
        engine.currentHighestBidDetails = { userId, playerName: player.playerName, bid };
        
        if (bid === "Frog" && !engine.originalFrogBidderId) {
            engine.originalFrogBidderId = userId;
        }
        
        if (bid === "Solo" && engine.originalFrogBidderId && userId !== engine.originalFrogBidderId) {
            engine.state = "Awaiting Frog Upgrade Decision";
            engine.biddingTurnPlayerId = engine.originalFrogBidderId;
            return [{ type: 'BROADCAST_STATE' }];
        }
    } else {
        engine.playersWhoPassedThisRound.push(userId);
    }
    
    const activeBidders = engine.playerOrder.turnOrder.filter(id => !engine.playersWhoPassedThisRound.includes(id));
    if ((engine.currentHighestBidDetails && activeBidders.length <= 1) || activeBidders.length === 0) {
        engine.biddingTurnPlayerId = null;
        return resolveBiddingFinal(engine); // No frog upgrade check needed here
    }

    const currentBidderIndex = engine.playerOrder.turnOrder.indexOf(userId);
    for (let i = 1; i < engine.playerOrder.turnOrder.length; i++) {
        const nextBidderId = engine.playerOrder.turnOrder[(currentBidderIndex + i) % engine.playerOrder.turnOrder.length];
        if (!engine.playersWhoPassedThisRound.includes(nextBidderId)) {
            engine.biddingTurnPlayerId = nextBidderId;
            return [{ type: 'BROADCAST_STATE' }];
        }
    }
    
    return resolveBiddingFinal(engine);
}

function resolveBiddingFinal(engine) {
    engine.originalFrogBidderId = null;
    engine.soloBidMadeAfterFrog = false;
    
    if (!engine.currentHighestBidDetails) {
        engine.state = "AllPassWidowReveal";
  return [
            { type: 'BROADCAST_STATE' },
            { type: 'START_TIMER', payload: {
                duration: 3000,
                onTimeout: (engineRef) => {
                    if (engineRef.state === "AllPassWidowReveal") {
                        engineRef._advanceRound();
                        return [{ type: 'BROADCAST_STATE' }];
                    }
                    return [];
                }
            }}
        ];
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
    return [{ type: 'BROADCAST_STATE' }];
}

module.exports = {
    placeBid
};