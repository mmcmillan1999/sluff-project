// backend/src/core/BotPlayer.js

const gameLogic = require('./logic');
const { RANKS_ORDER, BID_HIERARCHY } = require('./constants');
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

    // --- NEW METHOD: Bot Insurance Logic ---
    decideInitialInsurance() {
        if (!this.engine.insurance.isActive) return null;

        const isBidder = this.engine.bidWinnerInfo.userId === this.userId;
        const hand = this.engine.hands[this.playerName] || [];
        const { points, suits } = this._analyzeHand(hand);
        const trumpSuit = this.engine.trumpSuit;
        const trumpCount = suits[trumpSuit] || 0;
        const multiplier = this.engine.insurance.bidMultiplier;

        if (isBidder) {
            let value;
            if (points > 35 && trumpCount >= 5) { // Strong Hand
                value = Math.round(80 * multiplier);
            } else if (points < 25 || trumpCount <= 3) { // Weak Hand
                value = Math.round(40 * multiplier);
            } else { // Average Hand
                value = Math.round(60 * multiplier);
            }
            return { settingType: 'bidderRequirement', value };
        } else { // Is Defender
            const highTrump = hand.filter(c => gameLogic.getSuit(c) === trumpSuit && ['A', '10', 'K'].includes(gameLogic.getRank(c)));
            let value;
            if (highTrump.length >= 2) { // Strong Defensive Hand
                value = Math.round(-20 * multiplier);
            } else { // Weak Defensive Hand
                value = Math.round(-40 * multiplier);
            }
            return { settingType: 'defenderOffer', value };
        }
    }

    playCard() {
        const hand = this.engine.hands[this.playerName];
        if (!hand || hand.length === 0) return null;

        const isLeading = this.engine.currentTrickCards.length === 0;
        const legalPlays = getLegalMoves(hand, isLeading, this.engine.leadSuitCurrentTrick, this.engine.trumpSuit, this.engine.trumpBroken);
        if (legalPlays.length === 0) return null;

        legalPlays.sort((a, b) => getRankValue(a) - getRankValue(b));
        let cardToPlay;

        if (isLeading) {
            // --- NEW "NAKED 10" LOGIC ---
            const bestCard = legalPlays[legalPlays.length - 1];
            if (gameLogic.getRank(bestCard) === '10' && legalPlays.length > 1) {
                const suitOf10 = gameLogic.getSuit(bestCard);
                const aceOfSuit = 'A' + suitOf10;
                if (!this.engine.allCardsPlayedThisRound.includes(aceOfSuit)) {
                    // The Ace is still out, and we have other options. Don't lead the 10.
                    cardToPlay = legalPlays[legalPlays.length - 2]; // Play the next-best card
                } else {
                    cardToPlay = bestCard; // Ace is gone, 10 is safe to lead
                }
            } else {
                cardToPlay = bestCard; // Default behavior
            }
            // --- END NEW LOGIC ---
        } else {
            const winningPlays = legalPlays.filter(myCard => {
                const potentialTrick = [...this.engine.currentTrickCards, { card: myCard, userId: this.userId }];
                const winner = gameLogic.determineTrickWinner(potentialTrick, this.engine.leadSuitCurrentTrick, this.engine.trumpSuit);
                return winner.userId === this.userId;
            });
            if (winningPlays.length > 0) {
                winningPlays.sort((a, b) => getRankValue(a) - getRankValue(b));
                cardToPlay = winningPlays[winningPlays.length - 1];
            } else {
                cardToPlay = legalPlays[0];
            }
        }
        return cardToPlay;
    }
}

module.exports = BotPlayer;