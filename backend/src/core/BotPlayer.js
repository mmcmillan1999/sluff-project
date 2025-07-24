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

    // --- NEW HELPER FUNCTION FOR CARD SELECTION ---
    _getBestCardToPlay(legalCards, isLeading) {
        // This function contains the original, simple logic
        if (isLeading) {
            // Original Logic: Play the highest ranking legal card
            return legalCards.sort((a, b) => getRankValue(b) - getRankValue(a))[0];
        } else {
            // Original Logic: Try to win, otherwise sluff low
            const winningPlays = legalCards.filter(myCard => {
                const potentialTrick = [...this.engine.currentTrickCards, { card: myCard, userId: this.userId }];
                const winner = gameLogic.determineTrickWinner(potentialTrick, this.engine.leadSuitCurrentTrick, this.engine.trumpSuit);
                return winner.userId === this.userId;
            });

            if (winningPlays.length > 0) {
                // Play highest card to win
                return winningPlays.sort((a, b) => getRankValue(b) - getRankValue(a))[0];
            } else {
                // Sluff lowest card
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

        // --- Step 1: Get the bot's initial "greedy" decision ---
        let proposedCard = this._getBestCardToPlay([...legalPlays], isLeading);

        // --- Step 2: The Final Safety Check ---
        if (gameLogic.getRank(proposedCard) === '10') {
            const suit = gameLogic.getSuit(proposedCard);
            const aceOfSuit = 'A' + suit;

            const allPlayedCards = Object.values(this.engine.capturedTricks)
                .flat()
                .flatMap(trick => trick.cards);
            
            // Check if the Ace is potentially in an opponent's hand
            const isAceUnaccountedFor = !hand.includes(aceOfSuit) && !allPlayedCards.includes(aceOfSuit);

            if (isAceUnaccountedFor) {
                // DANGER! The 10 is unsafe. Re-evaluate.
                // Exclude the risky 10 from the legal moves and get the next-best option.
                const saferPlays = legalPlays.filter(card => card !== proposedCard);
                if (saferPlays.length > 0) {
                    proposedCard = this._getBestCardToPlay(saferPlays, isLeading);
                }
                // If the 10 was the ONLY legal play, the bot is forced to play it anyway.
            }
        }

        // --- Step 3: Play the final, vetted card ---
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

    // --- REWRITTEN "TAPERING CONFIDENCE" INSURANCE LOGIC ---
    makeInsuranceDecision() {
        const { insurance, bidWinnerInfo, hands, bidderCardPoints, tricksPlayedCount } = this.engine;
        const bidMultiplier = BID_MULTIPLIERS[bidWinnerInfo.bid] || 1;
        const isBidder = this.playerName === bidWinnerInfo.playerName;
        const numberOfOpponents = this.engine.playerOrder.count - 1;

        // 1. Calculate the Tapering "Certainty Factor"
        const certaintyFactor = tricksPlayedCount / 10.0; // Ranges from 0.0 to 1.0
        const projectionFactor = 1.0 - certaintyFactor;

        // 2. Calculate the Bidder's Max Possible Score (Certainty)
        const bidderHand = hands[bidWinnerInfo.playerName] || [];
        const bidderPointsInHand = gameLogic.calculateCardPoints(bidderHand);
        const bidderMaxScore = bidderCardPoints + bidderPointsInHand;

        // 3. Calculate the Projected Final Score
        const GOAL = 60;
        const projectedFinalScore = (GOAL * projectionFactor) + (bidderMaxScore * certaintyFactor);

        // 4. Determine Action Based on Role
        if (isBidder) {
            const projectedSurplus = projectedFinalScore - GOAL;
            const projectedPointExchange = projectedSurplus * bidMultiplier * numberOfOpponents;
            
            // The bot asks for what it expects to win. If it expects to lose, this will be a negative number (an offer).
            const strategicAsk = Math.round(projectedPointExchange / 5) * 5; // Round to nearest 5

            // Only update if the new ask is different from the current one
            if (strategicAsk !== insurance.bidderRequirement) {
                return { settingType: 'bidderRequirement', value: strategicAsk };
            }
        } else { // Is a Defender
            const projectedSurplus = projectedFinalScore - GOAL;
            // From the defender's perspective, a positive surplus for the bidder is a loss for them.
            const projectedDefenderLoss = projectedSurplus * bidMultiplier;
            
            let strategicOffer;
            if (projectedDefenderLoss > 0) {
                // If expecting to lose, offer to pay a slight premium to cap losses
                strategicOffer = Math.round((projectedDefenderLoss * 1.05) / 5) * 5;
            } else {
                // If expecting to win, offer to give up half the winnings for a sure thing
                const projectedDefenderWinnings = -projectedDefenderLoss;
                strategicOffer = -Math.round((projectedDefenderWinnings / 2) / 5) * 5;
            }

            if (strategicOffer !== insurance.defenderOffers[this.playerName]) {
                return { settingType: 'defenderOffer', value: strategicOffer };
            }
        }
        
        return null; // No change needed
    }
}

module.exports = BotPlayer;