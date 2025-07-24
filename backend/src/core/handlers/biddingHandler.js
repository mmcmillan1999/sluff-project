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

// --- REWRITTEN BID HANDLING LOGIC ---
function handleNormalBid(engine, userId, bid) {
    if (!BID_HIERARCHY.includes(bid) || engine.playersWhoPassedThisRound.includes(userId)) return [];
    
    const currentHighestBidIndex = engine.currentHighestBidDetails ? BID_HIERARCHY.indexOf(engine.currentHighestBidDetails.bid) : -1;
    if (bid !== "Pass" && BID_HIERARCHY.indexOf(bid) <= currentHighestBidIndex) return [];
    
    // Process the player's bid
    if (bid !== "Pass") {
        const player = engine.players[userId];
        engine.currentHighestBidDetails = { userId, playerName: player.playerName, bid };
        
        if (bid === "Frog" && !engine.originalFrogBidderId) {
            engine.originalFrogBidderId = userId;
        }
    } else {
        engine.playersWhoPassedThisRound.push(userId);
    }
    
    // Determine who is next
    const turnOrder = engine.playerOrder.turnOrder;
    const currentBidderIndex = turnOrder.indexOf(userId);
    let nextBidderId = null;

    for (let i = 1; i < turnOrder.length; i++) {
        const potentialNextId = turnOrder[(currentBidderIndex + i) % turnOrder.length];
        if (!engine.playersWhoPassedThisRound.includes(potentialNextId)) {
            nextBidderId = potentialNextId;
            break;
        }
    }
    
    // Check for end-of-bidding conditions
    const activeBidders = turnOrder.filter(id => !engine.playersWhoPassedThisRound.includes(id));
    
    // Condition 1: Solo was bid, and the only remaining active bidder is the original Frog bidder.
    const soloIsHighest = engine.currentHighestBidDetails?.bid === "Solo";
    const frogBidderIsLast = activeBidders.length === 1 && activeBidders[0] === engine.originalFrogBidderId;

    if (soloIsHighest && frogBidderIsLast) {
        engine.state = "Awaiting Frog Upgrade Decision";
        engine.biddingTurnPlayerId = engine.originalFrogBidderId;
        return [{ type: 'BROADCAST_STATE' }];
    }

    // Condition 2: Bidding is over naturally (everyone else has passed or only one bidder left).
    if (activeBidders.length <= 1) {
        engine.biddingTurnPlayerId = null;
        return resolveBiddingFinal(engine);
    }

    // Condition 3: Continue to the next player.
    engine.biddingTurnPlayerId = nextBidderId;
    return [{ type: 'BROADCAST_STATE' }];
}


function resolveBiddingFinal(engine) {
    engine.originalFrogBidderId = null; // Clear the frog bidder state for the next round
    
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