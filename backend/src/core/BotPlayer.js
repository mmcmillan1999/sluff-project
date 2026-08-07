// backend/src/core/BotPlayer.js

const gameLogic = require('./logic');
const { BID_HIERARCHY, BID_MULTIPLIERS } = require('./constants');
const { analyzeHandForBid, recommendBidFor } = require('./bidAdvice');
const { frogDiscardStrategyFor } = require('./frogDiscards');
const { calculateInsuranceMove } = require('./bot-strategies/InsuranceStrategy');
const { brainFor } = require('./bot-brains');

const getRankValue = (card) => require('./constants').RANKS_ORDER.indexOf(gameLogic.getRank(card));

class BotPlayer {
    constructor(userId, name, engine) {
        this.userId = userId;
        this.playerName = name;
        this.engine = engine;
    }

    _analyzeHand(hand) {
        return analyzeHandForBid(hand);
    }

    // Card play is delegated to the bot's brain profile (bot-brains/):
    // 'classic' — the locked original tree — for every bot by default, the
    // 'counting' trial brain for the named A/B group. Bidding, trump choice,
    // discards, and insurance stay shared so the experiment isolates play.
    playCard() {
        return brainFor(this.playerName).playCard(this.engine, this);
    }

    decideBid() {
        // The evaluator lives in bidAdvice.js, shared with the player-facing
        // bid hint — thresholds and their tuning notes live there. The
        // strategy resolves per bot name (sim-rotated candidates; production
        // default until a winner is crowned).
        const hand = this.engine.hands[this.playerName] || [];
        return recommendBidFor(this.playerName, hand, this.engine.currentHighestBidDetails?.bid || null).bid;
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
        // Strategy resolves per bot name (frogDiscards.js registry) — the
        // sim rotates candidates; production runs the default.
        const hand = this.engine.hands[this.playerName] || [];
        return frogDiscardStrategyFor(this.playerName)(hand);
    }

    makeInsuranceDecision() {
        return calculateInsuranceMove(this.engine, this);
    }

    /**
     * NEW: Decides how the bot should vote on a draw request.
     * The bot's strategy is to be agreeable and help players who are losing.
     * @returns {'wash'|'split'} The bot's vote.
     */
    decideDrawVote() {
        const { drawRequest, scores } = this.engine;
        if (!drawRequest || !drawRequest.initiator) {
            return 'wash'; // Safe default
        }

        const initiatorName = drawRequest.initiator;
        const initiatorScore = scores[initiatorName] || 0;

        // If the player requesting the draw is losing (score < 60),
        // the bot agrees to a "split" to help them recover some tokens.
        if (initiatorScore < 60) {
            return 'split';
        }

        // Otherwise, the bot agrees to a simple "wash".
        return 'wash';
    }
}

module.exports = BotPlayer;
