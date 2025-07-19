// backend/src/core/GameEngine.js

const { SERVER_VERSION, TABLE_COSTS, BID_HIERARCHY, PLACEHOLDER_ID, deck, SUITS, BID_MULTIPLIERS } = require('./constants');
const gameLogic = require('./logic');
const BotPlayer = require('./BotPlayer');
const { shuffle } = require('../utils/shuffle');

const BOT_NAMES = ["Mike Knight", "Grandma Joe", "Grampa Blane", "Kimba", "Courtney Sr.", "Cliff"];

/**
 * GameEngine is a PURE state machine for the Sluff card game.
 * It does NOT interact with sockets or databases directly.
 * Instead, its methods return a list of "effects" for a service layer to execute.
 */
class GameEngine {
    constructor(tableId, theme, tableName) {
        this.tableId = tableId;
        this.tableName = tableName;
        this.theme = theme;
        this.serverVersion = SERVER_VERSION;
        this.state = "Waiting for Players";
        this.players = {};
        this.playerOrderActive = [];
        this.scores = {};
        this.gameStarted = false;
        this.gameId = null;
        this.playerMode = null;
        this.dealer = null;
        this.internalTimers = {};
        this.bots = {};
        this._nextBotId = -1;
        this.pendingBotAction = null;
        this._initializeNewRoundState();
    }

    // =================================================================
    // PUBLIC METHODS
    // =================================================================
    
    startForfeitTimer(requestingUserId, targetPlayerName) {
        if (!this.players[requestingUserId] || this.internalTimers.forfeit) return;
        const targetPlayer = Object.values(this.players).find(p => p.playerName === targetPlayerName);
        if (!targetPlayer || !targetPlayer.disconnected) {
            // TODO: Refactor to return an error effect
            return;
        }
        console.log(`[${this.tableId}] Forfeit timer started for ${targetPlayerName} by ${this.players[requestingUserId].playerName}.`);
        this.forfeiture.targetPlayerName = targetPlayerName;
        this.forfeiture.timeLeft = 120;
    }

    forfeitGame(userId) {
        const playerName = this.players[userId]?.playerName;
        if (!playerName || !this.gameStarted) return;
        this._resolveForfeit(playerName, "voluntary forfeit");
    }
    
    joinTable(user, socketId) {
        const { id, username } = user;
        const isPlayerAlreadyInGame = !!this.players[id];

        if (isPlayerAlreadyInGame) {
            this.players[id].disconnected = false;
            this.players[id].socketId = socketId;
        } else {
            const activePlayersCount = Object.values(this.players).filter(p => !p.isSpectator).length;

            if (this.gameStarted || activePlayersCount >= 4) {
                this.players[id] = { userId: id, playerName: username, socketId: socketId, isSpectator: true, disconnected: false };
            } else {
                 this.players[id] = { userId: id, playerName: username, socketId: socketId, isSpectator: false, disconnected: false };
            }
        }

        if (!this.scores[username]) {
            this.scores[username] = 120;
        }

        this._recalculateActivePlayerOrder();

        const activePlayersAfterJoin = this.playerOrderActive.length;
        if (!this.gameStarted) {
            this.state = (activePlayersAfterJoin >= 3) ? "Ready to Start" : "Waiting for Players";
        }
    }

    addBotPlayer() {
        const currentPlayers = Object.values(this.players).filter(p => !p.isSpectator);
        if (currentPlayers.length >= 4) return;
        const currentBotNames = new Set(currentPlayers.filter(p => p.isBot).map(p => p.playerName));
        const availableNames = BOT_NAMES.filter(name => !currentBotNames.has(name));
        if (availableNames.length === 0) return;
        const botName = availableNames[Math.floor(Math.random() * availableNames.length)];
        const botId = this._nextBotId--;
        this.players[botId] = { userId: botId, playerName: botName, socketId: null, isSpectator: false, disconnected: false, isBot: true };
        this.bots[botId] = new BotPlayer(botId, botName, this);
        if (!this.scores[botName]) this.scores[botName] = 120;
        this._recalculateActivePlayerOrder();
        if (this.playerOrderActive.length >= 3 && !this.gameStarted) this.state = 'Ready to Start';
    }

    leaveTable(userId) {
        if (!this.players[userId]) return;
        const playerInfo = this.players[userId];
        const safeLeaveStates = ["Waiting for Players", "Ready to Start", "Game Over"];
        if (safeLeaveStates.includes(this.state) || playerInfo.isSpectator) { delete this.players[userId]; }
        else if (this.gameId && this.gameStarted) { this.disconnectPlayer(userId); }
        else { delete this.players[userId]; }
        if (playerInfo.isBot) delete this.bots[userId];
        this._recalculateActivePlayerOrder();
    }
    
    disconnectPlayer(userId) {
        const player = this.players[userId];
        if (!player) return;
        if (!this.gameStarted || player.isSpectator) {
            delete this.players[userId];
            this._recalculateActivePlayerOrder();
        } else {
            console.log(`[${this.tableId}] Player ${player.playerName} has disconnected.`);
            player.disconnected = true;
        }
    }
    
    reconnectPlayer(userId, socket) {
        if (!this.players[userId] || !this.players[userId].disconnected) return;
        console.log(`[${this.tableId}] Reconnecting user ${this.players[userId].playerName}.`);
        this.players[userId].disconnected = false;
        this.players[userId].socketId = socket.id;
        if (this.forfeiture.targetPlayerName === this.players[userId].playerName) {
             this._clearForfeitTimer();
        }
    }

    startGame(requestingUserId) {
        if (this.gameStarted) return;
        if (!this.players[requestingUserId] || this.players[requestingUserId].isSpectator) return;
        const activePlayers = Object.values(this.players).filter(p => !p.isSpectator && !p.disconnected);
        if (activePlayers.length < 3) {
            // TODO: Return an error effect
            return;
        }
        this.playerMode = activePlayers.length;
        const activePlayerIds = activePlayers.map(p => p.userId);
        
        // This method will eventually be refactored to return effects
        this.gameStarted = true;
        activePlayers.forEach(p => { if (this.scores[p.playerName] === undefined) this.scores[p.playerName] = 120; });
        if (this.playerMode === 3 && this.scores[PLACEHOLDER_ID] === undefined) { this.scores[PLACEHOLDER_ID] = 120; }
        const shuffledPlayerIds = shuffle([...activePlayerIds]);
        this.dealer = shuffledPlayerIds[0];
        this._recalculateActivePlayerOrder();
        this._initializeNewRoundState();
        this.state = "Dealing Pending";
    }

    dealCards(requestingUserId) {
        if (this.state !== "Dealing Pending" || requestingUserId !== this.dealer) return;
        const shuffledDeck = shuffle([...deck]);
        this.playerOrderActive.forEach((playerId, i) => {
            const playerName = this.players[playerId].playerName;
            this.hands[playerName] = shuffledDeck.slice(i * 11, (i + 1) * 11);
        });
        this.widow = shuffledDeck.slice(11 * this.playerOrderActive.length);
        this.originalDealtWidow = [...this.widow];
        this.state = "Bidding Phase";
        this.biddingTurnPlayerId = this.playerOrderActive[0];
    }

    placeBid(userId, bid) {
        if (userId !== this.biddingTurnPlayerId) return;
        const player = this.players[userId];
        if (!player) return;

        if (this.state === "Awaiting Frog Upgrade Decision") {
            if (userId !== this.originalFrogBidderId || (bid !== "Heart Solo" && bid !== "Pass")) return;
            if (bid === "Heart Solo") { this.currentHighestBidDetails = { userId, playerName: player.playerName, bid: "Heart Solo" }; }
            this.biddingTurnPlayerId = null;
            this._resolveBiddingFinal();
            return;
        }
        if (this.state !== "Bidding Phase" || !BID_HIERARCHY.includes(bid) || this.playersWhoPassedThisRound.includes(userId)) return;
        
        const currentHighestBidIndex = this.currentHighestBidDetails ? BID_HIERARCHY.indexOf(this.currentHighestBidDetails.bid) : -1;
        if (bid !== "Pass" && BID_HIERARCHY.indexOf(bid) <= currentHighestBidIndex) return;
        
        if (bid !== "Pass") {
            this.currentHighestBidDetails = { userId, playerName: player.playerName, bid };
            if (bid === "Frog" && !this.originalFrogBidderId) this.originalFrogBidderId = userId;
            if (bid === "Solo" && this.originalFrogBidderId && userId !== this.originalFrogBidderId) this.soloBidMadeAfterFrog = true;
        } else { this.playersWhoPassedThisRound.push(userId); }
        
        const activeBiddersRemaining = this.playerOrderActive.filter(id => !this.playersWhoPassedThisRound.includes(id));
        if ((this.currentHighestBidDetails && activeBiddersRemaining.length <= 1) || this.playersWhoPassedThisRound.length === this.playerOrderActive.length) {
            this.biddingTurnPlayerId = null;
            this._checkForFrogUpgrade();
        } else {
            let currentBidderIndex = this.playerOrderActive.indexOf(userId);
            let nextBidderId = null;
            for (let i = 1; i < this.playerOrderActive.length; i++) {
                let potentialNextBidderId = this.playerOrderActive[(currentBidderIndex + i) % this.playerOrderActive.length];
                if (!this.playersWhoPassedThisRound.includes(potentialNextBidderId)) {
                    nextBidderId = potentialNextBidderId;
                    break;
                }
            }
            if (nextBidderId) { this.biddingTurnPlayerId = nextBidderId; }
            else { this._checkForFrogUpgrade(); }
        }
    }
    
    chooseTrump(userId, suit) {
        if (this.state !== "Trump Selection" || this.bidWinnerInfo?.userId !== userId || !["S", "C", "D"].includes(suit)) {
            return;
        }
        this.trumpSuit = suit;
        this._transitionToPlayingPhase();
    }

    submitFrogDiscards(userId, discards) {
        const player = this.players[userId];
        if (!player || this.state !== "Frog Widow Exchange" || this.bidWinnerInfo?.userId !== userId || !Array.isArray(discards) || discards.length !== 3) {
            return;
        }
        const currentHand = this.hands[player.playerName];
        if (!discards.every(card => currentHand.includes(card))) {
            return; // TODO: Return error effect
        }
        this.widowDiscardsForFrogBidder = discards;
        this.hands[player.playerName] = currentHand.filter(card => !discards.includes(card));
        this._transitionToPlayingPhase();
    }

    playCard(userId, card) {
        if (userId !== this.trickTurnPlayerId) return;
        const player = this.players[userId];
        if (!player) return;

        const hand = this.hands[player.playerName];
        if (!hand || !hand.includes(card)) return;
        
        const isLeading = this.currentTrickCards.length === 0;
        const playedSuit = gameLogic.getSuit(card);
        if (isLeading) {
            if (playedSuit === this.trumpSuit && !this.trumpBroken && !hand.every(c => gameLogic.getSuit(c) === this.trumpSuit)) {
                // TODO: Return error effect
                return;
            }
        } else {
            const leadCardSuit = this.leadSuitCurrentTrick;
            const hasLeadSuit = hand.some(c => gameLogic.getSuit(c) === leadCardSuit);
            if (hasLeadSuit && playedSuit !== leadCardSuit) {
                 // TODO: Return error effect
                return;
            }
            if (!hasLeadSuit && hand.some(c => gameLogic.getSuit(c) === this.trumpSuit) && playedSuit !== this.trumpSuit) {
                 // TODO: Return error effect
                return;
            }
        }
        this.hands[player.playerName] = hand.filter(c => c !== card);
        this.currentTrickCards.push({ userId, playerName: player.playerName, card });
        if (isLeading) this.leadSuitCurrentTrick = playedSuit;
        if (playedSuit === this.trumpSuit) this.trumpBroken = true;
        
        const expectedCardsInTrick = this.playerOrderActive.length;
        if (this.currentTrickCards.length === expectedCardsInTrick) {
            this._resolveTrick();
        } else {
            const currentTurnPlayerIndex = this.playerOrderActive.indexOf(userId);
            this.trickTurnPlayerId = this.playerOrderActive[(currentTurnPlayerIndex + 1) % this.playerOrderActive.length];
        }
    }

    requestNextRound(requestingUserId) {
        if (this.state === "Awaiting Next Round Trigger" && requestingUserId === this.roundSummary?.dealerOfRoundId) { this._advanceRound(); }
    }

    async reset() {
        console.log(`[${this.tableId}] Game is being reset.`);
        const originalPlayers = { ...this.players };
        
        this.state = "Waiting for Players";
        this.players = {};
        this.playerOrderActive = [];
        this.scores = {};
        this.gameStarted = false;
        this.gameId = null;
        this.playerMode = null;
        this.dealer = null;
        this.bots = {};
        this._nextBotId = -1;
        this.pendingBotAction = null;
        this._initializeNewRoundState();

        for (const userId in originalPlayers) {
            const playerInfo = originalPlayers[userId];
            if (!playerInfo.disconnected) {
                this.players[userId] = { ...playerInfo, isSpectator: false, socketId: playerInfo.socketId };
                if (playerInfo.isBot) {
                    this.bots[userId] = new BotPlayer(parseInt(userId,10), playerInfo.playerName, this);
                }
                this.scores[playerInfo.playerName] = 120;
            }
        }
        const botIds = Object.keys(this.bots).map(id => parseInt(id,10));
        this._nextBotId = botIds.length ? Math.min(...botIds) - 1 : -1;
        this._recalculateActivePlayerOrder();
        this.playerMode = this.playerOrderActive.length;
        this.state = this.playerMode >= 3 ? "Ready to Start" : "Waiting for Players";
    }
    
    updateInsuranceSetting(userId, settingType, value) {
        const player = this.players[userId];
        if (!player || !this.insurance.isActive || this.insurance.dealExecuted) return;

        const multiplier = this.insurance.bidMultiplier;
        const parsedValue = parseInt(value, 10);
        if (isNaN(parsedValue)) return;

        if (settingType === 'bidderRequirement' && player.playerName === this.insurance.bidderPlayerName) {
            const minReq = -120 * multiplier;
            const maxReq = 120 * multiplier;
            if (parsedValue >= minReq && parsedValue <= maxReq) {
                this.insurance.bidderRequirement = parsedValue;
            }
        } else if (settingType === 'defenderOffer' && this.insurance.defenderOffers.hasOwnProperty(player.playerName)) {
            const minOffer = -60 * multiplier;
            const maxOffer = 60 * multiplier;
            if (parsedValue >= minOffer && parsedValue <= maxOffer) {
                this.insurance.defenderOffers[player.playerName] = parsedValue;
            }
        } else {
            return;
        }

        const sumOfOffers = Object.values(this.insurance.defenderOffers || {}).reduce((sum, offer) => sum + (offer || 0), 0);
        if (this.insurance.bidderRequirement <= sumOfOffers) {
            this.insurance.dealExecuted = true;
            this.insurance.executedDetails = {
                agreement: {
                    bidderPlayerName: this.insurance.bidderPlayerName,
                    bidderRequirement: this.insurance.bidderRequirement,
                    defenderOffers: { ...this.insurance.defenderOffers }
                }
            };
        }
    }

    requestDraw(userId) {
        const player = this.players[userId];
        if (!player || this.drawRequest.isActive || this.state !== 'Playing Phase') return;
        this.drawRequest.isActive = true;
        this.drawRequest.initiator = player.playerName;
        this.drawRequest.votes = {};
        const activePlayers = Object.values(this.players).filter(p => !p.isSpectator);
        activePlayers.forEach(p => {
            this.drawRequest.votes[p.playerName] = (p.playerName === player.playerName) ? 'wash' : null;
        });
        this.drawRequest.timer = 30;
    }

    submitDrawVote(userId, vote) {
        const player = this.players[userId];
        if (!player || !this.drawRequest.isActive || !['wash', 'split', 'no'].includes(vote) || this.drawRequest.votes[player.playerName] !== null) return;
        
        this.drawRequest.votes[player.playerName] = vote;
    
        if (vote === 'no') {
            this.drawRequest.isActive = false;
            // TODO: Return an effect to notify players
            return;
        }
    
        const allVotes = Object.values(this.drawRequest.votes);
        if (!allVotes.every(v => v !== null)) {
            return;
        }

        this.drawRequest.isActive = false;
        // TODO: This should return a HANDLE_DRAW_VOTE effect
        // The service will then do the DB transactions and end the game.
        this.state = "Game Over";
    }



    // =================================================================
    // --- HELPER METHODS ---
    // =================================================================

    _initializeNewRoundState() {
        this.hands = {}; this.widow = []; this.originalDealtWidow = [];
        this.biddingTurnPlayerId = null;
        this.currentHighestBidDetails = null;
        this.playersWhoPassedThisRound = [];
        this.bidWinnerInfo = null; this.trumpSuit = null; this.trumpBroken = false; this.originalFrogBidderId = null; this.soloBidMadeAfterFrog = false; this.revealedWidowForFrog = []; this.widowDiscardsForFrogBidder = [];
        this.trickTurnPlayerId = null;
        this.trickLeaderId = null;
        this.currentTrickCards = []; this.leadSuitCurrentTrick = null; this.lastCompletedTrick = null; this.tricksPlayedCount = 0; this.capturedTricks = {}; this.roundSummary = null; 
        this.insurance = { isActive: false, bidMultiplier: null, bidderPlayerName: null, bidderRequirement: 0, defenderOffers: {}, dealExecuted: false, executedDetails: null };
        this.forfeiture = { targetPlayerName: null, timeLeft: null };
        this.drawRequest = { isActive: false, initiator: null, votes: {}, timer: null };
        
        Object.values(this.players).forEach(p => {
            if (p.playerName && this.scores[p.playerName] !== undefined) {
                this.capturedTricks[p.playerName] = [];
            }
        });
        
        this.bidderCardPoints = 0;
        this.defenderCardPoints = 0;
    }

    _recalculateActivePlayerOrder() {
        const activePlayers = Object.values(this.players).filter(p => !p.isSpectator && !p.disconnected);
        if (activePlayers.length === 0) { this.playerOrderActive = []; return; }
        if (this.gameStarted && this.dealer) {
            const playerUserIds = activePlayers.map(p => p.userId);
            let dealerIndex = playerUserIds.indexOf(this.dealer);
            if (dealerIndex === -1) { this.dealer = playerUserIds[0]; dealerIndex = 0; }
            const orderedIds = [];
            for (let i = 1; i <= playerUserIds.length; i++) { 
                const playerId = playerUserIds[(dealerIndex + i) % playerUserIds.length]; 
                if (this.players[playerId]) {
                    orderedIds.push(playerId); 
                }
            }
            this.playerOrderActive = orderedIds;
        } else { this.playerOrderActive = activePlayers.map(p => p.userId).sort((a,b) => a - b); }
    }

    getStateForClient() {
        const state = {
            tableId: this.tableId, tableName: this.tableName, theme: this.theme, state: this.state, players: this.players,
            playerOrderActive: Object.values(this.players)
                .filter(p => this.playerOrderActive.includes(p.userId))
                .sort((a, b) => this.playerOrderActive.indexOf(a.userId) - this.playerOrderActive.indexOf(b.userId))
                .map(p => p.playerName),
            dealer: this.dealer, hands: this.hands, widow: this.widow, originalDealtWidow: this.originalDealtWidow, scores: this.scores, currentHighestBidDetails: this.currentHighestBidDetails, bidWinnerInfo: this.bidWinnerInfo, gameStarted: this.gameStarted, trumpSuit: this.trumpSuit, currentTrickCards: this.currentTrickCards, tricksPlayedCount: this.tricksPlayedCount, leadSuitCurrentTrick: this.leadSuitCurrentTrick, trumpBroken: this.trumpBroken, capturedTricks: this.capturedTricks, roundSummary: this.roundSummary, lastCompletedTrick: this.lastCompletedTrick, playersWhoPassedThisRound: this.playersWhoPassedThisRound.map(id => this.players[id]?.playerName), playerMode: this.playerMode, serverVersion: this.serverVersion, insurance: this.insurance, forfeiture: this.forfeiture, drawRequest: this.drawRequest, originalFrogBidderId: this.originalFrogBidderId, soloBidMadeAfterFrog: this.soloBidMadeAfterFrog, revealedWidowForFrog: this.revealedWidowForFrog, widowDiscardsForFrogBidder: this.widowDiscardsForFrogBidder,
            bidderCardPoints: this.bidderCardPoints,
            defenderCardPoints: this.defenderCardPoints,
        };
        state.biddingTurnPlayerName = this.players[this.biddingTurnPlayerId]?.playerName;
        state.trickTurnPlayerName = this.players[this.trickTurnPlayerId]?.playerName;
        return state;
    }
    
    _clearForfeitTimer() {
        if (this.internalTimers.forfeit) {
            clearInterval(this.internalTimers.forfeit);
            delete this.internalTimers.forfeit;
        }
        this.forfeiture = { targetPlayerName: null, timeLeft: null };
    }

    _resolveForfeit(forfeitingPlayerName, reason) {
        // TODO: This should return effects
        console.log(`[${this.tableId}] Forfeit by ${forfeitingPlayerName}`);
        this.state = "Game Over";
    }

    _resolveTrick() {
        const winnerInfo = gameLogic.determineTrickWinner(this.currentTrickCards, this.leadSuitCurrentTrick, this.trumpSuit);
        this.lastCompletedTrick = { cards: [...this.currentTrickCards], winnerName: winnerInfo.playerName };
        
        const trickPoints = gameLogic.calculateCardPoints(this.lastCompletedTrick.cards.map(p => p.card));
        const winnerIsBidder = winnerInfo.playerName === this.bidWinnerInfo.playerName;
        if (winnerIsBidder) {
            this.bidderCardPoints += trickPoints;
        } else {
            this.defenderCardPoints += trickPoints;
        }

        this.tricksPlayedCount++;
        this.trickLeaderId = winnerInfo.userId;
        const winnerName = winnerInfo.playerName;
        if (winnerName && !this.capturedTricks[winnerName]) { this.capturedTricks[winnerName] = []; }
        if (winnerName) { this.capturedTricks[winnerName].push(this.currentTrickCards.map(p => p.card)); }
        
        if (this.tricksPlayedCount === 11) {
            this._calculateRoundScores();
        } else {
            this.state = "TrickCompleteLinger";
            // TODO: Refactor to return a START_TIMER effect
        }
    }

    _resolveBiddingFinal() {
        if (!this.currentHighestBidDetails) {
            this.state = "AllPassWidowReveal";
            // TODO: Refactor to return a START_TIMER effect
            return;
        }
        this.bidWinnerInfo = { ...this.currentHighestBidDetails };
        const bid = this.bidWinnerInfo.bid;
        if (bid === "Frog") { 
            this.trumpSuit = "H"; 
            this.state = "Frog Widow Exchange";
            this.revealedWidowForFrog = [...this.widow];
            const bidderHand = this.hands[this.bidWinnerInfo.playerName];
            this.hands[this.bidWinnerInfo.playerName] = [...bidderHand, ...this.widow];
        } else if (bid === "Heart Solo") { 
            this.trumpSuit = "H"; 
            this._transitionToPlayingPhase();
        } else if (bid === "Solo") { 
            this.state = "Trump Selection";
        }
        this.originalFrogBidderId = null;
        this.soloBidMadeAfterFrog = false;
    }

    _checkForFrogUpgrade() {
        if (this.soloBidMadeAfterFrog && this.originalFrogBidderId) {
            this.state = "Awaiting Frog Upgrade Decision";
            this.biddingTurnPlayerId = this.originalFrogBidderId;
        } else { this._resolveBiddingFinal(); }
    }
    
    _transitionToPlayingPhase() {
        this.state = "Playing Phase";
        this.tricksPlayedCount = 0;
        this.trumpBroken = false;
        this.currentTrickCards = [];
        this.leadSuitCurrentTrick = null;
        this.lastCompletedTrick = null;
        this.trickLeaderId = this.bidWinnerInfo.userId;
        this.trickTurnPlayerId = this.bidWinnerInfo.userId;
        if (this.playerMode === 3) {
            this.insurance.isActive = true;
            const multiplier = BID_MULTIPLIERS[this.bidWinnerInfo.bid];
            this.insurance.bidMultiplier = multiplier;
            this.insurance.bidderPlayerName = this.bidWinnerInfo.playerName;
            this.insurance.bidderRequirement = 120 * multiplier;
            const defenders = this.playerOrderActive.map(id => this.players[id].playerName).filter(pName => pName !== this.bidWinnerInfo.playerName);
            defenders.forEach(defName => { this.insurance.defenderOffers[defName] = -60 * multiplier; });
        }
    }
    
    _advanceRound() {
        if (!this.gameStarted) return;
        const oldDealerId = this.playerOrderActive.shift();
        this.playerOrderActive.push(oldDealerId);
        this.dealer = this.playerOrderActive[0];
        
        if (!this.players[this.dealer]) {
            console.error(`[${this.tableId}] FATAL: Could not find new dealer. Resetting table.`);
            this.reset();
            return;
        }

        this._initializeNewRoundState();
        this.state = "Dealing Pending";
    }
    
    _calculateRoundScores() {
        const roundData = gameLogic.calculateRoundScoreDetails(this);
        for(const playerName in roundData.pointChanges) { if(this.scores[playerName] !== undefined) { this.scores[playerName] += roundData.pointChanges[playerName]; } }
        let isGameOver = Object.values(this.scores).filter(s => typeof s === 'number').some(score => score <= 0);
        
        this.roundSummary = {
            message: isGameOver ? "Game Over!" : roundData.roundMessage,
            finalScores: { ...this.scores },
            isGameOver,
            gameWinner: null, // The service will determine the winner
            dealerOfRoundId: this.dealer,
            widowForReveal: roundData.widowForReveal,
            insuranceDealWasMade: this.insurance.dealExecuted,
            insuranceDetails: this.insurance.dealExecuted ? this.insurance.executedDetails : null,
            insuranceHindsight: roundData.insuranceHindsight,
            allTricks: this.capturedTricks,
            // We can't know the final tokens until the service runs the transactions
            playerTokens: this.playerTokens 
        };

        this.state = isGameOver ? "Game Over" : "Awaiting Next Round Trigger";

        if (isGameOver) {
            // TODO: In the next phase, this should return a HANDLE_GAME_OVER effect.
            // For now, we'll let the client handle the "Play Again" button.
        }
    }
}

module.exports = GameEngine;