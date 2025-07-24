// backend/src/core/BotPlayer.js

const gameLogic = require('./logic');
const { RANKS_ORDER, BID_HIERARCHY, BID_MULTIPLIERS, CARD_POINT_VALUES } = require('./constants');
const { getLegalMoves } = require('./legalMoves');

const getRankValue = (card) => RANKS_ORDER.indexOf(gameLogic.getRank(card));

class BotPlayer {
    constructor(userId, name, engine) {
        this.userId = userId;
        this.playerName = name;
        this.engine = engine; 
    }

    _analyzeHand(hand) {
        if (!hand || hand.length === 0) return { points: 0, suits: { H: 0, S: 0, C: 0, D: 0 } };
        const points = gameLogic.calculateCardPoints(hand);
        const suits = { H: 0, S: 0, C: 0, D: 0 };
        for (const card of hand) { suits[gameLogic.getSuit(card)]++; }
        return { points, suits };
    }

    playCard() {
        const hand = this.engine.hands[this.playerName];
        if (!hand || hand.length === 0) return null;

        const isLeading = this.engine.currentTrickCards.length === 0;
        const legalPlays = getLegalMoves(hand, isLeading, this.engine.leadSuitCurrentTrick, this.engine.trumpSuit, this.engine.trumpBroken);
        if (legalPlays.length === 0) return null;

        let cardToPlay;

        if (isLeading) {
            // --- REWRITTEN AND CORRECTED LEAD LOGIC ---
            const allPastTricks = Object.values(this.engine.capturedTricks).flat();
            const allPlayedCards = allPastTricks.flatMap(trick => trick.cards);

            // Create a function to check if an Ace is gone
            const isAceGone = (suit) => allPlayedCards.includes('A' + suit);

            // 1. Best move: Play an Ace
            const aces = legalPlays.filter(card => gameLogic.getRank(card) === 'A');
            if (aces.length > 0) {
                cardToPlay = aces[0];
            } else {
                // 2. Good move: Play a "safe" 10 (Ace is gone)
                const safeTens = legalPlays.filter(card => gameLogic.getRank(card) === '10' && isAceGone(gameLogic.getSuit(card)));
                if (safeTens.length > 0) {
                    cardToPlay = safeTens[0];
                } else {
                    // 3. Safe move: Play junk (non-point cards)
                    const junkCards = legalPlays.filter(card => CARD_POINT_VALUES[gameLogic.getRank(card)] === 0);
                    if (junkCards.length > 0) {
                        // Play the lowest junk card
                        cardToPlay = junkCards.sort((a, b) => getRankValue(a) - getRankValue(b))[0];
                    } else {
                        // 4. Last resort: Lead the lowest-value point card (minimizing risk)
                        // This avoids leading with a naked 10 if a King, Queen, or Jack is available.
                        cardToPlay = legalPlays.sort((a, b) => CARD_POINT_VALUES[gameLogic.getRank(a)] - CARD_POINT_VALUES[gameLogic.getRank(b)])[0];
                    }
                }
            }
        } else {
            // --- UNCHANGED FOLLOW LOGIC ---
            const winningPlays = legalPlays.filter(myCard => {
                const potentialTrick = [...this.engine.currentTrickCards, { card: myCard, userId: this.userId }];
                const winner = gameLogic.determineTrickWinner(potentialTrick, this.engine.leadSuitCurrentTrick, this.engine.trumpSuit);
                return winner.userId === this.userId;
            });

            if (winningPlays.length > 0) {
                cardToPlay = winningPlays.sort((a, b) => getRankValue(b) - getRankValue(a))[0];
            } else {
                cardToPlay = legalPlays.sort((a, b) => getRankValue(a) - getRankValue(b))[0];
            }
        }
        return cardToPlay;
    }

    decideBid() {
        const hand = this.engine.hands[this.playerName] || [];
        const { points, suits } = this._analyzeHand(hand);
        let potentialBid = "Pass";

        if ((points > 30 && suits.H >= 5) || (points > 40 && suits.H >= 4)) {
            potentialBid = "Heart Solo";
        } else if ((points > 30 && (suits.S >= 5 || suits.C >= 5 || suits.D >= 5)) || (points > 40 && (suits.S >= 4 || suits.C >= 4 || suits.D >= 4))) {
            potentialBid = "Solo";
        } else if ((points > 30 && suits.H >= 4) || (points > 40 && suits.H >= 3)) {
            potentialBid = "Frog";
        }

        const currentBidDetails = this.engine.currentHighestBidDetails;
        const currentBidLevel = currentBidDetails ? BID_HIERARCHY.indexOf(currentBidDetails.bid) : -1;
        const potentialBidLevel = BID_HIERARCHY.indexOf(potentialBid);

        if (potentialBidLevel > currentBidLevel) {
            return potentialBid;
        }
        return "Pass";
    }

    decideFrogUpgrade() {
        const hand = this.engine.hands[this.playerName] || [];
        const { points, suits } = this._analyzeHand(hand);
        if (suits.H >= 5 && points > 35) {
            return "Heart Solo";
        }
        return "Pass";
    }

    chooseTrump() {
        const hand = this.engine.hands[this.playerName] || [];
        const handStats = this._analyzeHand(hand);
        let bestSuit = 'C';
        let maxCount = 0;
        for (const suit of ['S', 'C', 'D']) {
            if (handStats.suits[suit] > maxCount) {
                maxCount = handStats.suits[suit];
                bestSuit = suit;
            }
        }
        return bestSuit;
    }

    submitFrogDiscards() {
        const hand = this.engine.hands[this.playerName] || [];
        const sortedHand = [...hand].sort((a, b) => getRankValue(a) - getRankValue(b));
        return sortedHand.slice(0, 3);
    }

    makeInsuranceDecision() {
        const { insurance, bidWinnerInfo, hands, bidderCardPoints, tricksPlayedCount } = this.engine;
        const bidMultiplier = BID_MULTIPLIERS[bidWinnerInfo.bid] || 1;
        const isBidder = this.playerName === bidWinnerInfo.playerName;
        const numberOfOpponents = this.engine.playerOrder.count - 1;

        const certaintyFactor = tricksPlayedCount / 10.0;
        const projectionFactor = 1.0 - certaintyFactor;

        const bidderHand = hands[bidWinnerInfo.playerName] || [];
        const bidderPointsInHand = gameLogic.calculateCardPoints(bidderHand);
        const bidderMaxScore = bidderCardPoints + bidderPointsInHand;

        const GOAL = 60;
        const projectedFinalScore = (GOAL * projectionFactor) + (bidderMaxScore * certaintyFactor);

        if (isBidder) {
            const projectedSurplus = projectedFinalScore - GOAL;
            const projectedPointExchange = projectedSurplus * bidMultiplier * numberOfOpponents;
            const strategicAsk = Math.round(projectedPointExchange / 5) * 5;

            if (strategicAsk !== insurance.bidderRequirement) {
                return { settingType: 'bidderRequirement', value: strategicAsk };
            }
        } else { // Is a Defender
            const projectedSurplus = projectedFinalScore - GOAL;
            const projectedDefenderLoss = projectedSurplus * bidMultiplier;
            
            // --- THIS IS THE FIX: Make defender more stingy ---
            const stingyFactor = 15 * bidMultiplier;

            let strategicOffer;
            if (projectedDefenderLoss > 0) {
                const baseOffer = Math.round((projectedDefenderLoss * 1.05) / 5) * 5;
                strategicOffer = baseOffer + stingyFactor; 
            } else {
                const projectedDefenderWinnings = -projectedDefenderLoss;
                const baseOffer = -Math.round((projectedDefenderWinnings / 2) / 5) * 5;
                strategicOffer = baseOffer + stingyFactor; 
            }

            if (strategicOffer !== insurance.defenderOffers[this.playerName]) {
                return { settingType: 'defenderOffer', value: strategicOffer };
            }
        }
        
        return null;
    }
}

module.exports = BotPlayer;