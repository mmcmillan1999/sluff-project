// backend/src/core/SuperBot.js

const BotPlayer = require('./BotPlayer');
const aiService = require('../services/aiService');
const { getLegalMoves } = require('./legalMoves');
const { CARD_POINT_VALUES, RANKS_ORDER } = require('./constants');

class SuperBot extends BotPlayer {
    constructor(userId, name, engine, aiModel = 'gpt-4o-mini') {
        super(userId, name, engine);
        this.aiModel = aiModel;
        this.isSuperBot = true;
    }

    async decideBid() {
        try {
            const hand = this.engine.hands[this.playerName] || [];
            if (hand.length === 0) return "Pass";

            const gameState = this._buildGameState();
            const currentHighestBid = this.engine.currentHighestBidDetails?.bid || null;
            
            // Define bid hierarchy
            const bidHierarchy = ['Pass', 'Solo', 'Frog', 'Heart Solo'];
            const currentBidIndex = currentHighestBid ? bidHierarchy.indexOf(currentHighestBid) : -1;
            
            // Calculate valid bids (exactly like the frontend does for human players)
            const validBids = bidHierarchy.filter(bid => 
                bid === 'Pass' || bidHierarchy.indexOf(bid) > currentBidIndex
            );
            
            console.log(`[BID] ${this.playerName}: Current highest="${currentHighestBid}", valid options: ${validBids.join(', ')}`);
            
            // Pass valid bids to AI
            const aiDecision = await aiService.getBidDecision(
                this.aiModel,
                gameState,
                currentHighestBid,
                validBids  // Pass valid options to AI
            );

            if (aiDecision && aiDecision.bid && validBids.includes(aiDecision.bid)) {
                console.log(`🎰 ${this.playerName}: Bid ${aiDecision.bid} - "${aiDecision.reasoning}"`);
                return aiDecision.bid;
            }

            console.log(`⚠️ ${this.playerName}: Bid FALLBACK`);
            return super.decideBid();
        } catch (error) {
            console.error(`SuperBot ${this.aiModel} bid error:`, error);
            // Check if it's a rate limit error
            if (error.message && (error.message.includes('rate_limit') || 
                                 error.message.includes('429') || 
                                 error.message.includes('quota') ||
                                 error.message.includes('Resource exhausted'))) {
                console.log(`⚠️ ${this.playerName}: Rate limited, using fallback logic`);
                // Use the parent class's simple bid logic
                return super.decideBid();
            }
            return super.decideBid();
        }
    }

    async playCard() {
        try {
            const hand = this.engine.hands[this.playerName];
            if (!hand || hand.length === 0) return null;

            const isLeading = this.engine.currentTrickCards.length === 0;
            const legalPlays = getLegalMoves(
                hand, 
                isLeading, 
                this.engine.leadSuitCurrentTrick, 
                this.engine.trumpSuit, 
                this.engine.trumpBroken
            );
            
            if (legalPlays.length === 0) return null;
            if (legalPlays.length === 1) return legalPlays[0];

            const gameState = this._buildGameState();
            const aiDecision = await aiService.getCardDecision(
                this.aiModel,
                gameState,
                legalPlays
            );

            if (aiDecision && aiDecision.card && legalPlays.includes(aiDecision.card)) {
                console.log(`🤖 ${this.playerName}: ${aiDecision.card} - "${aiDecision.reasoning}"`);
                return aiDecision.card;
            }

            console.log(`⚠️ ${this.playerName}: FALLBACK (AI failed)`);
            return super.playCard();
        } catch (error) {
            console.error(`SuperBot ${this.aiModel} error:`, error);
            // Check if it's a rate limit error
            if (error.message && (error.message.includes('rate_limit') || 
                                 error.message.includes('429') || 
                                 error.message.includes('quota') ||
                                 error.message.includes('Resource exhausted'))) {
                console.log(`⚠️ ${this.playerName}: Rate limited, using fallback card logic`);
            }
            return super.playCard();
        }
    }

    async makeInsuranceDecision() {
        try {
            const hand = this.engine.hands[this.playerName];
            if (!hand || hand.length === 0) return { offer: 0, requirement: 60 };

            // Log current insurance state
            console.log(`📊 [INSURANCE-DEBUG] ${this.playerName} checking insurance:`);
            console.log(`   - Current insurance state:`, {
                isActive: this.engine.insurance?.isActive,
                bidMultiplier: this.engine.insurance?.bidMultiplier,
                bidderPlayerName: this.engine.insurance?.bidderPlayerName,
                bidderRequirement: this.engine.insurance?.bidderRequirement,
                defenderOffers: this.engine.insurance?.defenderOffers,
                dealExecuted: this.engine.insurance?.dealExecuted
            });
            console.log(`   - BidWinnerInfo:`, this.engine.bidWinnerInfo);
            console.log(`   - My name: ${this.playerName}`);

            const gameState = this._buildGameState();
            
            // Log the full game state the AI is seeing
            console.log(`📊 [INSURANCE-STATE] ${this.playerName} sees:`);
            console.log(`   - Hand: ${gameState.myHand?.join(', ') || 'none'}`);
            console.log(`   - Scores: ${JSON.stringify(gameState.scores)}`);
            console.log(`   - Points captured: ${JSON.stringify(gameState.pointsCaptured)}`);
            console.log(`   - Tricks captured: ${JSON.stringify(gameState.capturedTricksCount)}`);
            console.log(`   - Bidder: ${gameState.bidder} (${gameState.bidType})`);
            console.log(`   - Trick ${gameState.trickNumber}/13`);
            
            const aiDecision = await aiService.getInsuranceDecision(
                this.aiModel,
                gameState
            );

            console.log(`📊 [INSURANCE-DEBUG] ${this.playerName} AI decision:`, aiDecision);

            if (aiDecision && typeof aiDecision.offer === 'number' && typeof aiDecision.requirement === 'number') {
                // Get the actual insurance limits based on bid multiplier
                const multiplier = this.engine.insurance?.bidMultiplier || 1;
                const maxOffer = 60 * multiplier;
                const maxReq = 120 * multiplier;
                
                // Determine if I'm the bidder
                const isBidder = (this.engine.bidWinnerInfo?.playerName === this.playerName);
                console.log(`📊 [INSURANCE-DEBUG] Role check: bidWinner="${this.engine.bidWinnerInfo?.playerName}", me="${this.playerName}", isBidder=${isBidder}`);
                
                // IMPORTANT: For defenders, negative values = incoming points (good for them)
                // The AI returns positive values, we need to convert for defenders
                let finalOffer, finalReq;
                
                if (isBidder) {
                    // Bidder: positive requirement = points they want
                    finalOffer = 0;
                    finalReq = Math.max(0, Math.min(maxReq, aiDecision.requirement));
                    console.log(`🎯 ${this.playerName} (BIDDER) Insurance Requirement: ${finalReq} points`);
                    console.log(`   → Reasoning: "${aiDecision.reasoning}"`);
                    console.log(`   → AI wanted ${aiDecision.requirement}, clamped to [0, ${maxReq}]`);
                } else {
                    // Defender: negative offer = points they'll receive if bidder wins
                    // Convert positive AI response to negative for game engine
                    const offerAmount = Math.max(0, Math.min(maxOffer, aiDecision.offer));
                    finalOffer = -offerAmount; // Make it negative (incoming points)
                    finalReq = 0;
                    console.log(`🎯 ${this.playerName} (DEFENDER) Insurance Offer: ${offerAmount} points`);
                    console.log(`   → Reasoning: "${aiDecision.reasoning}"`);
                    if (offerAmount > 0) {
                        console.log(`   → Protection: Will receive ${offerAmount} points if bidder wins`);
                    }
                }
                
                console.log(`📊 [INSURANCE-DEBUG] ${this.playerName} final decision:`, { offer: finalOffer, requirement: finalReq });
                return { offer: finalOffer, requirement: finalReq };
            }

            console.log(`⚠️ [INSURANCE-DEBUG] ${this.playerName} falling back to parent class`);
            // Silent fallback for insurance
            return super.makeInsuranceDecision();
        } catch (error) {
            console.error(`SuperBot ${this.aiModel} insurance error:`, error);
            return super.makeInsuranceDecision();
        }
    }

    _buildGameState() {
        const allPastTricks = Object.values(this.engine.capturedTricks).flat();
        const playedCards = allPastTricks.flatMap(trick => 
            trick.cards.map(c => typeof c === 'string' ? c : c.card)
        );

        const scores = {};
        const playerNames = Object.values(this.engine.players)
            .filter(p => !p.isSpectator)
            .map(p => p.playerName);
        for (const playerName of playerNames) {
            scores[playerName] = this.engine.scores[playerName] || 0;
        }

        // Calculate captured tricks count and points for each player
        const capturedTricksCount = {};
        const pointsCaptured = {};
        const cardHistory = [];
        
        // Initialize counts
        playerNames.forEach(name => {
            capturedTricksCount[name] = 0;
            pointsCaptured[name] = 0;
        });
        
        // Process captured tricks for each player
        Object.entries(this.engine.capturedTricks).forEach(([playerName, tricks]) => {
            capturedTricksCount[playerName] = tricks.length;
            
            // Calculate points for this player's captured tricks
            tricks.forEach((trick, trickIndex) => {
                let trickPoints = 0;
                const trickCards = [];
                
                trick.cards.forEach(card => {
                    const cardStr = typeof card === 'string' ? card : card.card;
                    const rank = cardStr.slice(0, -1);
                    trickPoints += CARD_POINT_VALUES[rank] || 0;
                    
                    // Build card history
                    const playerId = typeof card === 'object' ? card.userId : null;
                    const playerName = playerId ? this.engine.players[playerId]?.playerName : 'Unknown';
                    trickCards.push({ player: playerName, card: cardStr });
                });
                
                pointsCaptured[playerName] += trickPoints;
                
                // Add to card history
                if (trickCards.length > 0) {
                    cardHistory.push({
                        trickNumber: trickIndex + 1,
                        cards: trickCards,
                        winner: playerName,
                        points: trickPoints
                    });
                }
            });
        });
        
        // Track suit distributions and voids
        const suitTracking = {};
        const remainingCards = { H: [], S: [], C: [], D: [] };
        
        // Initialize all 52 cards as remaining
        const allRanks = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
        const allSuits = ['H', 'S', 'C', 'D'];
        for (const suit of allSuits) {
            for (const rank of allRanks) {
                remainingCards[suit].push(rank + suit);
            }
        }
        
        // Remove cards that have been played
        for (const card of playedCards) {
            const suit = card[card.length - 1];
            const index = remainingCards[suit].indexOf(card);
            if (index > -1) {
                remainingCards[suit].splice(index, 1);
            }
        }
        
        // Remove cards in my hand
        const myHandCards = this.engine.hands[this.playerName] || [];
        for (const card of myHandCards) {
            const suit = card[card.length - 1];
            const index = remainingCards[suit].indexOf(card);
            if (index > -1) {
                remainingCards[suit].splice(index, 1);
            }
        }
        
        // Track which players have shown voids (didn't follow suit when they should)
        const playerVoids = {};
        playerNames.forEach(name => {
            playerVoids[name] = { H: false, S: false, C: false, D: false };
        });
        
        // Analyze card history to detect voids
        cardHistory.forEach(trick => {
            // Find the lead suit for this trick
            if (trick.cards && trick.cards.length > 0) {
                const leadCard = trick.cards[0].card;
                const leadSuit = leadCard[leadCard.length - 1];
                
                // Check if any player didn't follow suit
                trick.cards.forEach(play => {
                    const playedSuit = play.card[play.card.length - 1];
                    if (playedSuit !== leadSuit && play.player) {
                        // This player didn't follow suit, so they're void
                        // Make sure the player exists in our tracking
                        if (!playerVoids[play.player]) {
                            playerVoids[play.player] = { H: false, S: false, C: false, D: false };
                        }
                        playerVoids[play.player][leadSuit] = true;
                    }
                });
            }
        });
        
        // Count remaining suits per player (estimated)
        playerNames.forEach(name => {
            suitTracking[name] = {
                voids: playerVoids[name],
                estimatedCounts: {}
            };
            
            // For each suit, estimate how many cards this player might have
            for (const suit of allSuits) {
                if (playerVoids[name][suit]) {
                    suitTracking[name].estimatedCounts[suit] = 0;
                } else if (name === this.playerName) {
                    // We know our exact count
                    suitTracking[name].estimatedCounts[suit] = myHandCards.filter(c => c[c.length - 1] === suit).length;
                } else {
                    // Unknown - could have any of the remaining cards
                    suitTracking[name].estimatedCounts[suit] = '?';
                }
            }
        });
        
        // Calculate remaining high cards (A and 10)
        const remainingHighCards = {
            H: remainingCards.H.filter(c => c.startsWith('A') || c.startsWith('10')),
            S: remainingCards.S.filter(c => c.startsWith('A') || c.startsWith('10')),
            C: remainingCards.C.filter(c => c.startsWith('A') || c.startsWith('10')),
            D: remainingCards.D.filter(c => c.startsWith('A') || c.startsWith('10'))
        };
        
        // Determine seat position relative to bidder
        let seatPosition = 'not_bidder';
        const bidWinner = this.engine.bidWinnerInfo?.playerName;
        if (bidWinner === this.playerName) {
            seatPosition = 'bidder';
        } else if (bidWinner && playerNames.includes(bidWinner)) {
            const bidderIndex = playerNames.indexOf(bidWinner);
            const myIndex = playerNames.indexOf(this.playerName);
            if (bidderIndex >= 0 && myIndex >= 0) {
                const leftOfBidder = (bidderIndex + 1) % playerNames.length;
                const rightOfBidder = (bidderIndex - 1 + playerNames.length) % playerNames.length;
                if (myIndex === leftOfBidder) {
                    seatPosition = 'left_of_bidder';
                } else if (myIndex === rightOfBidder) {
                    seatPosition = 'right_of_bidder';
                }
            }
        }
        
        // Check insurance deal status
        const insuranceDealActive = this.engine.insurance?.dealExecuted || false;

        return {
            myHand: this.engine.hands[this.playerName],
            myName: this.playerName,
            trumpSuit: this.engine.trumpSuit,
            leadSuit: this.engine.leadSuitCurrentTrick,
            currentTrick: this.engine.currentTrickCards.map(tc => ({
                card: tc.card,
                player: this.engine.players[tc.userId]?.playerName || 'Unknown'
            })),
            trickNumber: this.engine.trickNumber,
            roundNumber: this.engine.roundNumber,
            playedCards: playedCards,
            cardHistory: cardHistory,
            capturedTricksCount: capturedTricksCount,
            pointsCaptured: pointsCaptured,
            suitTracking: suitTracking,
            remainingCards: remainingCards,
            remainingHighCards: remainingHighCards,
            scores: scores,
            insurance: {
                offers: this.engine.insuranceOffers || {},
                requirements: this.engine.insuranceRequirements || {},
                currentCaptured: this.engine.tricksCapturedThisRound || {},
                dealActive: insuranceDealActive
            },
            bidder: bidWinner,
            bidType: this.engine.bidWinnerInfo?.bid || this.engine.currentHighestBidDetails?.bid,
            trumpBroken: this.engine.trumpBroken,
            playerOrder: playerNames,
            seatPosition: seatPosition,
            cardPointValues: CARD_POINT_VALUES,
            ranksOrder: RANKS_ORDER
        };
    }
}

module.exports = SuperBot;