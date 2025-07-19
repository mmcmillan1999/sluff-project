// backend/game/Table.js

const { SERVER_VERSION, TABLE_COSTS, BID_HIERARCHY, PLACEHOLDER_ID, deck, SUITS, BID_MULTIPLIERS } = require('./constants');
const gameLogic = require('./logic');
const BotPlayer = require('./BotPlayer');
const transactionManager = require('../db/transactionManager');
const { shuffle } = require('../utils/shuffle');

// --- MODIFIED --- Expanded the list of predefined bot names.
const BOT_NAMES = [
    "Michael Jr.", "George Charles Watts Sr.", "Verl Fayette Sr.", "George",
    "Courtney", "Verl Fayette Jr.", "Bob Lynn", "Wendell Taylor",
    "Dutch Woolstenhulme", "Ken Woolstenhulme", "Alfred", "Joe Colete",
    "Steve Richins", "Cliff Horning", "Mike Horning", "Jansen Richins",
    "Steve Knight", "Samson Clyde", "Two-bits", "Blaze", "Jay & Deb"
];

class Table {
    constructor(tableId, theme, tableName, io, pool, emitLobbyUpdateCallback) {
        this.io = io;
        this.pool = pool;
        this.emitLobbyUpdateCallback = emitLobbyUpdateCallback;
        this.tableId = tableId;
        this.tableName = tableName;
        this.theme = theme;
        this.serverVersion = SERVER_VERSION;
        this.state = "Waiting for Players";
        this.players = {};
        this.playerOrderActive = []; // --- MODIFIED --- Will now store user IDs instead of names.
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
    // PUBLIC: Forfeit & Timeout Logic
    // =================================================================

    startForfeitTimer(requestingUserId, targetPlayerName) {
        if (!this.players[requestingUserId] || this.internalTimers.forfeit) return;
        const targetPlayer = Object.values(this.players).find(p => p.playerName === targetPlayerName);
        if (!targetPlayer || !targetPlayer.disconnected) {
            return this.io.to(this.players[requestingUserId].socketId).emit("error", { message: "Cannot start timer: Player is not disconnected." });
        }
        console.log(`[${this.tableId}] Forfeit timer started for ${targetPlayerName} by ${this.players[requestingUserId].playerName}.`);
        this.forfeiture.targetPlayerName = targetPlayerName;
        this.forfeiture.timeLeft = 120;
        this.internalTimers.forfeit = setInterval(() => {
            if (!this.forfeiture.targetPlayerName) return this._clearForfeitTimer();
            this.forfeiture.timeLeft -= 1;
            if (this.forfeiture.timeLeft <= 0) {
                this._resolveForfeit(targetPlayerName, "timeout");
            } else {
                this._emitUpdate();
            }
        }, 1000);
        this._emitUpdate();
    }

    forfeitGame(userId) {
        const playerName = this.players[userId]?.playerName;
        if (!playerName || !this.gameStarted) return;
        this._resolveForfeit(playerName, "voluntary forfeit");
    }

    // =================================================================
    // PUBLIC: Player & Connection Management
    // =================================================================

    async joinTable(user, socketId) {
        const { id, username } = user;
        const isPlayerAlreadyInGame = !!this.players[id];
        if (!isPlayerAlreadyInGame) {
            const tableCost = TABLE_COSTS[this.theme] || 0;
            try {
                const tokenResult = await this.pool.query("SELECT SUM(amount) as tokens FROM transactions WHERE user_id = $1", [id]);
                const userTokens = parseFloat(tokenResult.rows[0]?.tokens || 0);
                if (userTokens < tableCost) {
                    return this.io.to(socketId).emit("error", { message: `You need ${tableCost} tokens to join. You have ${userTokens.toFixed(2)}.` });
                }
            } catch (err) {
                return this.io.to(socketId).emit("error", { message: "A server error occurred trying to join the table." });
            }
        }
        if (this.gameStarted && !isPlayerAlreadyInGame) {
            return this.io.to(socketId).emit("error", { message: "Game has already started." });
        }
        const activePlayersBeforeJoin = Object.values(this.players).filter(p => !p.isSpectator && !p.disconnected).length;
        const canTakeSeat = activePlayersBeforeJoin < 4 && !this.gameStarted;
        this.players[id] = { userId: id, playerName: username, socketId: socketId, isSpectator: this.players[id]?.isSpectator ?? !canTakeSeat, disconnected: false };
        if (!this.scores[username]) { this.scores[username] = 120; }
        this._recalculateActivePlayerOrder();
        const activePlayersAfterJoin = this.playerOrderActive.length;
        if (activePlayersAfterJoin >= 3 && !this.gameStarted) { this.state = "Ready to Start"; }
        else if (activePlayersAfterJoin < 3 && !this.gameStarted) { this.state = "Waiting for Players"; }
        await this._syncPlayerTokens(Object.keys(this.players));
        this.io.to(socketId).emit("joinedTable", { tableId: this.tableId, gameState: this.getStateForClient() });
        this._emitUpdate();
        this.emitLobbyUpdateCallback();
    }

    addBotPlayer() {
        // --- MODIFIED --- Complete overhaul of bot naming and selection logic.
        const currentPlayers = Object.values(this.players).filter(p => !p.isSpectator);
        if (currentPlayers.length >= 4) return; // Table is full

        const currentBotNames = new Set(currentPlayers.filter(p => p.isBot).map(p => p.playerName));
        const availableNames = BOT_NAMES.filter(name => !currentBotNames.has(name));

        if (availableNames.length === 0) {
            console.log(`[${this.tableId}] No available bot names to add.`);
            return; // No more unique named bots to add
        }

        const botName = availableNames[Math.floor(Math.random() * availableNames.length)];
        
        const botId = this._nextBotId--;
        this.players[botId] = {
            userId: botId,
            playerName: botName,
            socketId: null,
            isSpectator: false,
            disconnected: false,
            isBot: true
        };
        this.bots[botId] = new BotPlayer(botId, botName, this);
        if (!this.scores[botName]) this.scores[botName] = 120;
        this._recalculateActivePlayerOrder();
        const activePlayers = this.playerOrderActive.length;
        if (activePlayers >= 3 && !this.gameStarted) this.state = 'Ready to Start';
        this._emitUpdate();
        this.emitLobbyUpdateCallback();
    }

    async leaveTable(userId) {
        if (!this.players[userId]) return;
        const playerInfo = this.players[userId];
        const safeLeaveStates = ["Waiting for Players", "Ready to Start", "Game Over"];
        if (safeLeaveStates.includes(this.state) || playerInfo.isSpectator) { delete this.players[userId]; }
        else if (this.gameId && this.gameStarted) { this.disconnectPlayer(userId); }
        else { delete this.players[userId]; }
        if (playerInfo.isBot) {
            delete this.bots[userId];
        }
        this._recalculateActivePlayerOrder();
        await this._syncPlayerTokens(Object.keys(this.players));
        this._emitUpdate();
        this.emitLobbyUpdateCallback();
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
        this._emitUpdate();
        this.emitLobbyUpdateCallback();
    }
    
    reconnectPlayer(userId, socket) {
        if (!this.players[userId] || !this.players[userId].disconnected) return;
        console.log(`[${this.tableId}] Reconnecting user ${this.players[userId].playerName}.`);
        this.players[userId].disconnected = false;
        this.players[userId].socketId = socket.id;
        socket.join(this.tableId);
        if (this.forfeiture.targetPlayerName === this.players[userId].playerName) {
            this._clearForfeitTimer();
            console.log(`[${this.tableId}] Cleared timeout for reconnected player ${this.players[userId].playerName}.`);
        }
        this._emitUpdate();
        this.emitLobbyUpdateCallback();
    }

    // =================================================================
    // PUBLIC: Game Flow Management
    // =================================================================

    async startGame(requestingUserId) {
        if (this.gameStarted) return;
        if (!this.players[requestingUserId] || this.players[requestingUserId].isSpectator) return;
        const activePlayers = Object.values(this.players).filter(p => !p.isSpectator && !p.disconnected);
        if (activePlayers.length < 3) { 
            const userSocket = this.io.sockets.sockets.get(this.players[requestingUserId].socketId);
            if (userSocket) {
                userSocket.emit("gameStartError", { message: "Need at least 3 players to start." });
            }
            return;
        }
        this.playerMode = activePlayers.length;
        const activePlayerIds = activePlayers.map(p => p.userId);
        const humanIds = activePlayers.filter(p => !p.isBot).map(p => p.userId);
        try {
            this.gameId = await transactionManager.createGameRecord(this.pool, this);
            if (humanIds.length > 0) {
                await transactionManager.handleGameStartTransaction(this.pool, this, humanIds, this.gameId);
            }
            this.gameStarted = true;
            activePlayers.forEach(p => { if (this.scores[p.playerName] === undefined) this.scores[p.playerName] = 120; });
            if (this.playerMode === 3 && this.scores[PLACEHOLDER_ID] === undefined) { this.scores[PLACEHOLDER_ID] = 120; }
            const shuffledPlayerIds = shuffle([...activePlayerIds]);
            this.dealer = shuffledPlayerIds[0];
            this._recalculateActivePlayerOrder();
            this._initializeNewRoundState();
            this.state = "Dealing Pending";
            await this._syncPlayerTokens(activePlayerIds);
            this._emitUpdate();
            this.emitLobbyUpdateCallback();
        } catch (err) {
            const insufficientFundsMatch = err.message.match(/(.+) has insufficient tokens/);
            if (insufficientFundsMatch) {
                const brokePlayerName = insufficientFundsMatch[1];
                const brokePlayer = Object.values(this.players).find(p => p.playerName === brokePlayerName);
                if (brokePlayer) {
                    delete this.players[brokePlayer.userId];
                    this._recalculateActivePlayerOrder();
                    this.playerMode = this.playerOrderActive.length;
                    this.state = this.playerMode >= 3 ? "Ready to Start" : "Waiting for Players";
                    this.gameId = null; 
                    this.io.to(this.tableId).emit("gameStartFailed", { message: err.message, kickedPlayer: brokePlayerName });
                    this._emitUpdate();
                    this.emitLobbyUpdateCallback();
                }
            } else {
                const userSocket = this.io.sockets.sockets.get(this.players[requestingUserId].socketId);
                if (userSocket) {
                    userSocket.emit("gameStartError", { message: err.message || "A server error occurred during buy-in." });
                }
                this.gameStarted = false; 
                this.playerMode = null;
                this.gameId = null;
            }
        }
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
        this._emitUpdate();
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
        this._emitUpdate();
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
            return this.io.to(player.socketId).emit("error", { message: "Invalid discard selection." });
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
        // --- MODIFICATION: Added logging and error emissions for all rule checks ---
        if (isLeading) {
            if (playedSuit === this.trumpSuit && !this.trumpBroken && !hand.every(c => gameLogic.getSuit(c) === this.trumpSuit)) {
                const msg = "Cannot lead trump until it is broken.";
                console.error(`[${this.tableId}] ILLEGAL MOVE by ${player.playerName}: ${msg}`);
                return this.io.to(player.socketId).emit("error", { message: msg });
            }
        } else {
            const leadCardSuit = this.leadSuitCurrentTrick;
            const hasLeadSuit = hand.some(c => gameLogic.getSuit(c) === leadCardSuit);
            if (hasLeadSuit && playedSuit !== leadCardSuit) {
                const msg = `Must follow suit (${SUITS[leadCardSuit]}).`;
                console.error(`[${this.tableId}] ILLEGAL MOVE by ${player.playerName}: ${msg}`);
                return this.io.to(player.socketId).emit("error", { message: msg });
            }
            if (!hasLeadSuit && hand.some(c => gameLogic.getSuit(c) === this.trumpSuit) && playedSuit !== this.trumpSuit) {
                const msg = "You must play trump if you cannot follow suit.";
                console.error(`[${this.tableId}] ILLEGAL MOVE by ${player.playerName}: ${msg}`);
                return this.io.to(player.socketId).emit("error", { message: msg });
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
            this.trickTurnPlayerId = this.playerOrderActive[(currentTurnPlayerIndex + 1) % expectedCardsInTrick];
            this._emitUpdate();
        }
    }

    requestNextRound(requestingUserId) {
        if (this.state === "Awaiting Next Round Trigger" && requestingUserId === this.roundSummary?.dealerOfRoundId) { this._advanceRound(); }
    }

    async reset() {
        console.log(`[${this.tableId}] Game is being reset.`);
        this._clearAllTimers();
        const originalPlayers = { ...this.players };
        Object.assign(this, new Table(this.tableId, this.theme, this.tableName, this.io, this.pool, this.emitLobbyUpdateCallback));
        const playerIdsToKeep = [];
        for (const userId in originalPlayers) {
            const playerInfo = originalPlayers[userId];
            if (!playerInfo.disconnected) {
                this.players[userId] = { ...playerInfo, isSpectator: false, socketId: playerInfo.socketId };
                if (playerInfo.isBot) {
                    this.bots[userId] = new BotPlayer(parseInt(userId,10), playerInfo.playerName, this);
                }
                this.scores[playerInfo.playerName] = 120;
                if (!playerInfo.isSpectator) { playerIdsToKeep.push(parseInt(userId, 10)); }
            }
        }
        const botIds = Object.keys(this.bots).map(id => parseInt(id,10));
        this._nextBotId = botIds.length ? Math.min(...botIds) - 1 : -1;
        this._recalculateActivePlayerOrder();
        this.playerMode = this.playerOrderActive.length;
        this.state = this.playerMode >= 3 ? "Ready to Start" : "Waiting for Players";
        await this._syncPlayerTokens(playerIdsToKeep);
        this._emitUpdate();
        this.emitLobbyUpdateCallback();
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
        this._emitUpdate();
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
        this.internalTimers.draw = setInterval(() => {
            if (!this.drawRequest.isActive) return clearInterval(this.internalTimers.draw);
            this.drawRequest.timer -= 1;
            if (this.drawRequest.timer <= 0) {
                clearInterval(this.internalTimers.draw);
                this.drawRequest.isActive = false;
                this.io.to(this.tableId).emit("notification", { message: "Draw request timed out. Game resumes." });
                this._emitUpdate();
            } else {
                this._emitUpdate();
            }
        }, 1000);
        this._emitUpdate();
    }

    async submitDrawVote(userId, vote) {
        const player = this.players[userId];
        if (!player || !this.drawRequest.isActive || !['wash', 'split', 'no'].includes(vote) || this.drawRequest.votes[player.playerName] !== null) return;
        
        this.drawRequest.votes[player.playerName] = vote;
    
        if (vote === 'no') {
            clearInterval(this.internalTimers.draw);
            this.drawRequest.isActive = false;
            this.io.to(this.tableId).emit("notification", { message: `${player.playerName} vetoed the draw. Game resumes.` });
            this._emitUpdate();
            return;
        }
    
        const allVotes = Object.values(this.drawRequest.votes);
        if (!allVotes.every(v => v !== null)) {
            this._emitUpdate();
            return;
        }

        clearInterval(this.internalTimers.draw);
        this.drawRequest.isActive = false;
        
        try {
            const voteCounts = allVotes.reduce((acc, v) => { acc[v] = (acc[v] || 0) + 1; return acc; }, {});
            const tableCost = TABLE_COSTS[this.theme] || 0;
            const activePlayers = Object.values(this.players).filter(p => !p.isSpectator);
            let outcomeMessage = "Draw resolved.";
            const transactionPromises = [];
    
            if (voteCounts.wash === activePlayers.length) {
                outcomeMessage = "All players agreed to a wash. All buy-ins returned.";
                activePlayers.forEach(p => {
                    transactionPromises.push(transactionManager.postTransaction(this.pool, { userId: p.userId, gameId: this.gameId, type: 'wash_payout', amount: tableCost, description: `Draw Outcome: Wash` }));
                });
            } else if (voteCounts.wash > 0 && voteCounts.split > 0) {
                outcomeMessage = "A split was agreed upon. Payouts calculated by score.";
                const payoutResult = gameLogic.calculateDrawSplitPayout(this);
                if (payoutResult && payoutResult.payouts) {
                    for (const playerName in payoutResult.payouts) {
                        const pData = payoutResult.payouts[playerName];
                        transactionPromises.push(transactionManager.postTransaction(this.pool, { userId: pData.userId, gameId: this.gameId, type: 'win_payout', amount: pData.totalReturn, description: `Draw Outcome: Split` }));
                    }
                }
            } else {
                outcomeMessage = "The draw resulted in a wash. All buy-ins returned.";
                activePlayers.forEach(p => {
                    transactionPromises.push(transactionManager.postTransaction(this.pool, { userId: p.userId, gameId: this.gameId, type: 'wash_payout', amount: tableCost, description: `Draw Outcome: Wash (Default)` }));
                });
            }
            
            await Promise.all(transactionPromises);
            await transactionManager.updateGameRecordOutcome(this.pool, this.gameId, outcomeMessage);
    
            this.state = "Game Over";
            this.roundSummary = { message: outcomeMessage, isGameOver: true, finalScores: this.scores };
            this._emitUpdate();
            this.emitLobbyUpdateCallback();

            this.internalTimers.drawReset = setTimeout(() => this.reset(), 10000);

        } catch (error) {
            console.error(`[${this.tableId}] Error resolving draw vote:`, error);
            this.io.to(this.tableId).emit("notification", { message: `A server error occurred resolving the draw. Resuming game.` });
            this.drawRequest = this._getInitialDrawRequestState();
            this._emitUpdate();
        }
    }

    // =================================================================
    // INTERNAL: Game Flow and State Transitions (_prefix)
    // =================================================================

    _clearForfeitTimer() {
        if (this.internalTimers.forfeit) {
            clearInterval(this.internalTimers.forfeit);
            delete this.internalTimers.forfeit;
        }
        this.forfeiture = this._getInitialForfeitureState();
    }

    async _resolveForfeit(forfeitingPlayerName, reason) {
        if (this.state === "Game Over" || !this.gameId) return;
        console.log(`[${this.tableId}] Resolving forfeit for ${forfeitingPlayerName}. Reason: ${reason}`);
        this._clearAllTimers();
        try {
            const forfeitingPlayer = Object.values(this.players).find(p => p.playerName === forfeitingPlayerName);
            const remainingPlayers = Object.values(this.players).filter(p => !p.isSpectator && p.playerName !== forfeitingPlayerName && !p.isBot);
            const tokenChanges = gameLogic.calculateForfeitPayout(this, forfeitingPlayerName);
            const transactionPromises = [];
            if (forfeitingPlayer && !forfeitingPlayer.isBot) {
                transactionPromises.push(transactionManager.postTransaction(this.pool, {
                    userId: forfeitingPlayer.userId, gameId: this.gameId, type: 'forfeit_loss',
                    amount: 0, description: `Forfeited game on table ${this.tableName}`
                }));
            }
            remainingPlayers.forEach(player => {
                const payoutInfo = tokenChanges[player.playerName];
                if (payoutInfo && payoutInfo.totalGain > 0) {
                    transactionPromises.push(transactionManager.postTransaction(this.pool, {
                        userId: player.userId, gameId: this.gameId, type: 'forfeit_payout',
                        amount: payoutInfo.totalGain, description: `Payout from ${forfeitingPlayerName}'s forfeit`
                    }));
                }
            });
            await Promise.all(transactionPromises);
            const statUpdatePromises = [];
            if (forfeitingPlayer && !forfeitingPlayer.isBot) {
                statUpdatePromises.push(this.pool.query("UPDATE users SET losses = losses + 1 WHERE id = $1", [forfeitingPlayer.userId]));
            }
            remainingPlayers.forEach(player => {
                statUpdatePromises.push(this.pool.query("UPDATE users SET washes = washes + 1 WHERE id = $1", [player.userId]));
            });
            await Promise.all(statUpdatePromises);
            const outcomeMessage = `${forfeitingPlayerName} has forfeited the game due to ${reason}.`;
            await transactionManager.updateGameRecordOutcome(this.pool, this.gameId, outcomeMessage);
            Object.values(this.players).forEach(p => {
                const playerSocket = this.io.sockets.sockets.get(p.socketId);
                if (playerSocket) {
                    playerSocket.emit("requestUserSync");
                }
            });
            this.roundSummary = {
                message: `${outcomeMessage} The game has ended.`, isGameOver: true,
                gameWinner: `Payout to remaining players.`, finalScores: this.scores, payouts: tokenChanges,
            };
            this.state = "Game Over";
            this._emitUpdate();
            this.emitLobbyUpdateCallback();
        } catch (err) {
            console.error(`Database error during forfeit resolution for table ${this.tableId}:`, err);
        }
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
            this._emitUpdate();
            this.internalTimers.trickLinger = setTimeout(() => {
                if (this.state === "TrickCompleteLinger") {
                    this.currentTrickCards = [];
                    this.leadSuitCurrentTrick = null;
                    this.trickTurnPlayerId = winnerInfo.userId;
                    this.state = "Playing Phase";
                    this._emitUpdate();
                }
            }, 1000);
        }
    }

    _resolveBiddingFinal() {
        if (!this.currentHighestBidDetails) {
            this.state = "AllPassWidowReveal";
            this._emitUpdate();
            this.internalTimers.allPass = setTimeout(() => {
                if (this.state === "AllPassWidowReveal") {
                    this._advanceRound();
                }
            }, 3000);
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
        this._emitUpdate();
        this.originalFrogBidderId = null;
        this.soloBidMadeAfterFrog = false;
    }

    _checkForFrogUpgrade() {
        if (this.soloBidMadeAfterFrog && this.originalFrogBidderId) {
            this.state = "Awaiting Frog Upgrade Decision";
            this.biddingTurnPlayerId = this.originalFrogBidderId;
        } else { this._resolveBiddingFinal(); }
        this._emitUpdate();
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
        this._emitUpdate();
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
        console.log(`[${this.tableId}] Round advanced. New dealer: ${this.players[this.dealer].playerName}. State: ${this.state}`);
        this._emitUpdate();
    }
    
    async _calculateRoundScores() {
        const roundData = gameLogic.calculateRoundScoreDetails(this);
        for(const playerName in roundData.pointChanges) { if(this.scores[playerName] !== undefined) { this.scores[playerName] += roundData.pointChanges[playerName]; } }
        let isGameOver = Object.values(this.scores).filter(s => typeof s === 'number').some(score => score <= 0);
        let gameWinnerName = null;
        let finalOutcomeMessage = roundData.roundMessage;
        if (isGameOver) {
            finalOutcomeMessage = "Game Over!";
            const gameOverResult = await gameLogic.handleGameOver(this, this.pool);
            gameWinnerName = gameOverResult.gameWinnerName;
            Object.values(this.players).forEach(p => { 
                if (!p.isBot) {
                    const playerSocket = this.io.sockets.sockets.get(p.socketId);
                    if (playerSocket) {
                        playerSocket.emit("requestUserSync"); 
                    }
                }
            });
        }
        await this._syncPlayerTokens(Object.keys(this.players));
        
        // --- MODIFICATION: Add bidWinnerInfo and playerOrderActive to the summary object ---
        const playerOrderActiveNames = this.playerOrderActive.map(id => this.players[id]?.playerName).filter(Boolean);
        this.roundSummary = { 
            ...roundData, // Includes points, message, etc.
            finalScores: { ...this.scores }, 
            isGameOver, 
            gameWinner: gameWinnerName, 
            dealerOfRoundId: this.dealer, 
            widowForReveal: roundData.widowForReveal, 
            insuranceDealWasMade: this.insurance.dealExecuted, 
            insuranceDetails: this.insurance.dealExecuted ? this.insurance.executedDetails : null, 
            insuranceHindsight: roundData.insuranceHindsight, 
            allTricks: this.capturedTricks, 
            playerTokens: this.playerTokens,
            bidWinnerInfo: { ...this.bidWinnerInfo }, // Snapshot of the winner info
            playerOrderActive: playerOrderActiveNames, // Snapshot of the player order (names)
        };
        this.state = isGameOver ? "Game Over" : "Awaiting Next Round Trigger";
        this._emitUpdate();
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
                .map(p => p.playerName), // Send names to client for UI
            dealer: this.dealer, hands: this.hands, widow: this.widow, originalDealtWidow: this.originalDealtWidow, scores: this.scores, currentHighestBidDetails: this.currentHighestBidDetails, bidWinnerInfo: this.bidWinnerInfo, gameStarted: this.gameStarted, trumpSuit: this.trumpSuit, currentTrickCards: this.currentTrickCards, tricksPlayedCount: this.tricksPlayedCount, leadSuitCurrentTrick: this.leadSuitCurrentTrick, trumpBroken: this.trumpBroken, capturedTricks: this.capturedTricks, roundSummary: this.roundSummary, lastCompletedTrick: this.lastCompletedTrick, playersWhoPassedThisRound: this.playersWhoPassedThisRound.map(id => this.players[id]?.playerName), playerMode: this.playerMode, serverVersion: this.serverVersion, insurance: this.insurance, forfeiture: this.forfeiture, playerTokens: this.playerTokens, drawRequest: this.drawRequest, originalFrogBidderId: this.originalFrogBidderId, soloBidMadeAfterFrog: this.soloBidMadeAfterFrog, revealedWidowForFrog: this.revealedWidowForFrog, widowDiscardsForFrogBidder: this.widowDiscardsForFrogBidder,
            bidderCardPoints: this.bidderCardPoints,
            defenderCardPoints: this.defenderCardPoints,
        };
        // Derive player names for client compatibility
        state.biddingTurnPlayerName = this.players[this.biddingTurnPlayerId]?.playerName;
        state.trickTurnPlayerName = this.players[this.trickTurnPlayerId]?.playerName;
        return state;
    }
    
    _emitUpdate() {
        this.io.to(this.tableId).emit('gameState', this.getStateForClient());
        this._triggerBots();
    }
    
    _triggerBots() {
        if (this.pendingBotAction) return;

        for (const botId in this.bots) {
            const bot = this.bots[botId];
            
            const isCourtney = bot.playerName === "Courtney Sr.";
            const standardDelay = 1000;
            const playDelay = 1200;
            const roundEndDelay = 8000;

            if (this.state === 'Dealing Pending' && this.dealer === bot.userId) {
                let delay = isCourtney ? standardDelay * 2 : standardDelay;
                this.pendingBotAction = setTimeout(() => {
                    this.pendingBotAction = null;
                    this.dealCards(bot.userId);
                }, delay);
                return;
            }

            if (this.state === 'Awaiting Next Round Trigger' && this.roundSummary?.dealerOfRoundId === bot.userId) {
                let delay = isCourtney ? roundEndDelay * 2 : roundEndDelay;
                this.pendingBotAction = setTimeout(() => {
                    this.pendingBotAction = null;
                    this.requestNextRound(bot.userId);
                }, delay);
                return;
            }

            if (this.state === 'Bidding Phase' && this.biddingTurnPlayerId === bot.userId) {
                let delay = isCourtney ? standardDelay * 2 : standardDelay;
                this.pendingBotAction = setTimeout(() => { this.pendingBotAction = null; bot.makeBid(); }, delay);
                return;
            }

            if (this.state === 'Trump Selection' && this.bidWinnerInfo?.userId === bot.userId && !this.trumpSuit) {
                let delay = isCourtney ? standardDelay * 2 : standardDelay;
                this.pendingBotAction = setTimeout(() => { this.pendingBotAction = null; bot.chooseTrump(); }, delay);
                return;
            }

            if (this.state === 'Frog Widow Exchange' && this.bidWinnerInfo?.userId === bot.userId && this.widowDiscardsForFrogBidder.length === 0) {
                let delay = isCourtney ? standardDelay * 2 : standardDelay;
                this.pendingBotAction = setTimeout(() => { this.pendingBotAction = null; bot.submitFrogDiscards(); }, delay);
                return;
            }

            if (this.state === 'Playing Phase' && this.trickTurnPlayerId === bot.userId) {
                let delay = isCourtney ? playDelay * 2 : playDelay;
                this.pendingBotAction = setTimeout(() => { this.pendingBotAction = null; bot.playCard(); }, delay);
                return;
            }
        }
    }
    _clearAllTimers() { for (const timer in this.internalTimers) { clearTimeout(this.internalTimers[timer]); clearInterval(this.internalTimers[timer]); } this.internalTimers = {}; }
    
    _initializeNewRoundState() {
        this.hands = {}; this.widow = []; this.originalDealtWidow = [];
        this.biddingTurnPlayerId = null; // --- MODIFIED ---
        this.currentHighestBidDetails = null;
        this.playersWhoPassedThisRound = []; // --- MODIFIED --- Will store user IDs
        this.bidWinnerInfo = null; this.trumpSuit = null; this.trumpBroken = false; this.originalFrogBidderId = null; this.soloBidMadeAfterFrog = false; this.revealedWidowForFrog = []; this.widowDiscardsForFrogBidder = [];
        this.trickTurnPlayerId = null; // --- MODIFIED ---
        this.trickLeaderId = null; // --- MODIFIED ---
        this.currentTrickCards = []; this.leadSuitCurrentTrick = null; this.lastCompletedTrick = null; this.tricksPlayedCount = 0; this.capturedTricks = {}; this.roundSummary = null; this.insurance = this._getInitialInsuranceState(); this.forfeiture = this._getInitialForfeitureState(); this.drawRequest = this._getInitialDrawRequestState();
        
        // This logic remains correct as it uses player names as keys
        Object.values(this.players).forEach(p => {
            if (p.playerName && this.scores[p.playerName] !== undefined) {
                this.capturedTricks[p.playerName] = [];
            }
        });
        
        this.bidderCardPoints = 0;
        this.defenderCardPoints = 0;
    }

    async _syncPlayerTokens(playerIds) {
        if (!playerIds || playerIds.length === 0) { this.playerTokens = {}; return; }
        playerIds = playerIds.filter(id => parseInt(id,10) >= 0);
        if (playerIds.length === 0) { this.playerTokens = {}; return; }
        try {
            const tokenQuery = `SELECT user_id, SUM(amount) as tokens FROM transactions WHERE user_id = ANY($1::int[]) GROUP BY user_id;`;
            const tokenResult = await this.pool.query(tokenQuery, [playerIds]);
            const newPlayerTokens = {};
            const userIdToNameMap = Object.values(this.players).reduce((acc, player) => { acc[player.userId] = player.playerName; return acc; }, {});
            tokenResult.rows.forEach(row => { const playerName = userIdToNameMap[row.user_id]; if (playerName) { newPlayerTokens[playerName] = parseFloat(row.tokens || 0).toFixed(2); } });
            this.playerTokens = newPlayerTokens;
        } catch (err) { console.error(`Error fetching tokens during sync for table ${this.tableId}:`, err); }
    }
    _getInitialInsuranceState() { return { isActive: false, bidMultiplier: null, bidderPlayerName: null, bidderRequirement: 0, defenderOffers: {}, dealExecuted: false, executedDetails: null }; }
    _getInitialForfeitureState() { return { targetPlayerName: null, timeLeft: null }; }
    _getInitialDrawRequestState() { return { isActive: false, initiator: null, votes: {}, timer: null }; }
}

module.exports = Table;