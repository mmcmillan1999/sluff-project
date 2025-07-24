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

    _getBestCardToPlay(legalCards, isLeading) {
        if (isLeading) {
            return legalCards.sort((a, b) => getRankValue(b) - getRankValue(a))[0];
        } else {
            const winningPlays = legalCards.filter(myCard => {
                const potentialTrick = [...this.engine.currentTrickCards, { card: myCard, userId: this.userId }];
                const winner = gameLogic.determineTrickWinner(potentialTrick, this.engine.leadSuitCurrentTrick, this.engine.trumpSuit);
                return winner.userId === this.userId;
            });

            if (winningPlays.length > 0) {
                return winningPlays.sort((a, b) => getRankValue(b) - getRankValue(a))[0];
            } else {
                return legalCards.sort((a, b) => getRankValue(a) - getRankValue(b))[0];
            }
        }
    }

    playCard() {
        const hand = this.engine.hands[this.playerName];
        if (!hand || hand.length === 0) return null;

        const isLeading = this.engine.currentTrickCards.length === 0;
        let legalPlays = getLegalMoves(hand, isLeading, this.engine.leadSuitCurrentTrick, this.engine.trumpSuit, this.engine.trumpBroken);
        if (legalPlays.length === 0) return null;

        let proposedCard = this._getBestCardToPlay([...legalPlays], isLeading);

        if (gameLogic.getRank(proposedCard) === '10') {
            const suit = gameLogic.getSuit(proposedCard);
            const aceOfSuit = 'A' + suit;

            const allPlayedCards = Object.values(this.engine.capturedTricks)
                .flat()
                .flatMap(trick => trick.cards);
            
            const isAceUnaccountedFor = !hand.includes(aceOfSuit) && !allPlayedCards.includes(aceOfSuit);

            if (isAceUnaccountedFor) {
                const saferPlays = legalPlays.filter(card => card !== proposedCard);
                if (saferPlays.length > 0) {
                    proposedCard = this._getBestCardToPlay(saferPlays, isLeading);
                }
            }
        }

        return proposedCard;
    }

    makeBid() {
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
            
            let strategicOffer;
            if (projectedDefenderLoss > 0) {
                const baseOffer = Math.round((projectedDefenderLoss * 1.05) / 5) * 5;
                // --- THIS IS THE FIX: Make defender more stingy ---
                strategicOffer = baseOffer + 20; 
            } else {
                const projectedDefenderWinnings = -projectedDefenderLoss;
                const baseOffer = -Math.round((projectedDefenderWinnings / 2) / 5) * 5;
                // --- THIS IS THE FIX: Make defender more stingy ---
                strategicOffer = baseOffer + 20; 
            }

            if (strategicOffer !== insurance.defenderOffers[this.playerName]) {
                return { settingType: 'defenderOffer', value: strategicOffer };
            }
        }
        
        return null;
    }
}

module.exports = BotPlayer;