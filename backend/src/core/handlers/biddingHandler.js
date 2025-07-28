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
    
    const currentHighestBidLevel = engine.currentHighestBidDetails ? BID_HIERARCHY.indexOf(engine.currentHighestBidDetails.bid) : -1;
    if (bid !== "Pass" && BID_HIERARCHY.indexOf(bid) <= currentHighestBidLevel) return [];
    
    if (bid !== "Pass") {
        const player = engine.players[userId];
        engine.currentHighestBidDetails = { userId, playerName: player.playerName, bid };
        
        if (bid === "Frog" && !engine.originalFrogBidderId) {
            engine.originalFrogBidderId = userId;
        }
    } else {
        engine.playersWhoPassedThisRound.push(userId);
    }

    const turnOrder = engine.playerOrder.turnOrder;
    const activeBidders = turnOrder.filter(id => !engine.playersWhoPassedThisRound.includes(id));

    // --- THE FIX ---
    // Condition 1: Bidding ends if only one person is left AND someone has actually made a bid.
    // Condition 2: Bidding ends if NO ONE is left (everyone passed).
    if ((activeBidders.length < 2 && engine.currentHighestBidDetails) || activeBidders.length < 1) {
        engine.biddingTurnPlayerId = null;
        return resolveBiddingFinal(engine);
    }
    
    // If a Solo bid is now the highest, give the original Frog bidder
    // exactly one opportunity to upgrade to Heart Solo – regardless of
    // how many bidders remain.  This mirrors live-play rules where the
    // Frog bidder can immediately "snap" to Heart Solo after being
    // out-bid.
    const soloIsHighest = engine.currentHighestBidDetails?.bid === "Solo";
    if (soloIsHighest && engine.originalFrogBidderId) {
        engine.state = "Awaiting Frog Upgrade Decision";
        engine.biddingTurnPlayerId = engine.originalFrogBidderId;
        return [{ type: 'BROADCAST_STATE' }];
    }

    const currentBidderIndex = turnOrder.indexOf(userId);
    for (let i = 1; i <= turnOrder.length; i++) {
        const nextBidderId = turnOrder[(currentBidderIndex + i) % turnOrder.length];
        if (!engine.playersWhoPassedThisRound.includes(nextBidderId)) {
            engine.biddingTurnPlayerId = nextBidderId;
            return [{ type: 'BROADCAST_STATE' }];
        }
    }

    engine.biddingTurnPlayerId = null;
    return resolveBiddingFinal(engine);
}


function resolveBiddingFinal(engine) {
    engine.originalFrogBidderId = null; 
    
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