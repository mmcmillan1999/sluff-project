// backend/src/core/GameEngine.js

const { SERVER_VERSION, BID_HIERARCHY, PLACEHOLDER_ID, deck, SUITS, BID_MULTIPLIERS } = require('./constants');
const BotPlayer = require('./BotPlayer');
const { shuffle } = require('../utils/shuffle');
const playHandler = require('./handlers/playHandler');
const scoringHandler = require('./handlers/scoringHandler');
const PlayerList = require('./PlayerList');
const biddingHandler = require('./handlers/biddingHandler');

const BOT_NAMES = ["Mike Knight", "Grandma Joe", "Grampa Blane", "Kimba", "Courtney Sr.", "Cliff"];

class GameEngine {
    constructor(tableId, theme, tableName, emitLobbyUpdateCallback) {
        this.emitLobbyUpdateCallback = emitLobbyUpdateCallback;
        
        this.tableId = tableId;
        this.tableName = tableName;
        this.theme = theme;
        this.serverVersion = SERVER_VERSION;
        this.state = "Waiting for Players";
        this.players = {};
        this.playerOrder = new PlayerList();
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

    _effects(a = []) { return { effects: a }; }
    
    // =================================================================
    // PUBLIC METHODS
    // =================================================================
    
    startForfeitTimer(requestingUserId, targetPlayerName) {
        if (!this.players[requestingUserId] || this.internalTimers.forfeit) return;
        const targetPlayer = Object.values(this.players).find(p => p.playerName === targetPlayerName);
        if (!targetPlayer || !targetPlayer.disconnected) { return; }
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
            const activePlayersCount = this.playerOrder.count;
            if (this.gameStarted || activePlayersCount >= 4) {
                this.players[id] = { userId: id, playerName: username, socketId: socketId, isSpectator: true, disconnected: false };
            } else {
                 this.players[id] = { userId: id, playerName: username, socketId: socketId, isSpectator: false, disconnected: false };
                 if (!this.playerOrder.includes(id)) {
                    this.playerOrder.add(id);
                }
            }
        }
        if (!this.scores[username]) this.scores[username] = 120;
        const activePlayersAfterJoin = this.playerOrder.count;
        if (!this.gameStarted) {
            this.state = (activePlayersAfterJoin >= 3) ? "Ready to Start" : "Waiting for Players";
        }
    }

    addBotPlayer() {
        if (this.playerOrder.count >= 4) return;
        const currentBotNames = new Set(Object.values(this.players).filter(p => p.isBot).map(p => p.playerName));
        const availableNames = BOT_NAMES.filter(name => !currentBotNames.has(name));
        if (availableNames.length === 0) return;
        
        const botName = availableNames[Math.floor(Math.random() * availableNames.length)];
        const botId = this._nextBotId--;
        
        this.players[botId] = { userId: botId, playerName: botName, socketId: null, isSpectator: false, disconnected: false, isBot: true };
        this.bots[botId] = new BotPlayer(botId, botName, this);
        if (!this.scores[botName]) this.scores[botName] = 120;
        if (!this.playerOrder.includes(botId)) {
            this.playerOrder.add(botId);
        }
        if (this.playerOrder.count >= 3 && !this.gameStarted) this.state = 'Ready to Start';
    }

    removeBot() {
        if (this.gameStarted) return; 

        const botIds = Object.keys(this.players).filter(id => this.players[id].isBot).map(id => parseInt(id, 10));
        if (botIds.length === 0) return; 

        const botIdToRemove = Math.max(...botIds);
        const botInfo = this.players[botIdToRemove];

        if (botInfo) {
            console.log(`[${this.tableId}] Removing bot: ${botInfo.playerName}`);
            
            this.playerOrder.remove(botIdToRemove);
            delete this.scores[botInfo.playerName];
            delete this.bots[botIdToRemove];
            delete this.players[botIdToRemove];
        }

        this.playerMode = this.playerOrder.count;
        this.state = this.playerMode >= 3 ? "Ready to Start" : "Waiting for Players";
    }

    leaveTable(userId) {
        if (!this.players[userId]) return;
        const playerInfo = this.players[userId];
        const safeLeaveStates = ["Waiting for Players", "Ready to Start"];
        
        // --- THIS IS FIX #1: REJOIN LOGIC ---
        // If a game has started (has an ID), leaving should ALWAYS just disconnect the player,
        // allowing them to rejoin, even if the state is "Game Over".
        if (this.gameId) {
            this.disconnectPlayer(userId);
        } 
        // If the game hasn't started yet, it's safe to remove them completely.
        else if (safeLeaveStates.includes(this.state) || playerInfo.isSpectator) {
            delete this.players[userId];
            if (playerInfo.isBot) delete this.bots[userId];
            this.playerOrder.remove(userId);
        }
    }
    
    disconnectPlayer(userId) {
        const player = this.players[userId];
        if (!player) return;
        if (!this.gameStarted || player.isSpectator) {
            delete this.players[userId];
            if (player.isBot) delete this.bots[userId];
            this.playerOrder.remove(userId);
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
        if (this.gameStarted) return this._effects();
        if (!this.players[requestingUserId] || this.players[requestingUserId].isSpectator) return this._effects();
        const activePlayerIds = this.playerOrder.allIds;
        if (activePlayerIds.length < 3) {
            return this._effects([{ type: 'EMIT_TO_SOCKET', payload: { socketId: this.players[requestingUserId].socketId, event: 'gameStartError', data: { message: "Need at least 3 players to start." } } }]);
        }
        
        this.playerMode = activePlayerIds.length;
        
        const effects = [{
            type: 'START_GAME_TRANSACTIONS',
            payload: { 
                table: { tableId: this.tableId, theme: this.theme, playerMode: this.playerMode },
                playerIds: activePlayerIds.filter(id => !this.players[id].isBot) 
            },
            onSuccess: (gameId) => {
                this.gameId = gameId;
                this.gameStarted = true;
                activePlayerIds.forEach(id => { if (this.scores[this.players[id].playerName] === undefined) this.scores[this.players[id].playerName] = 120; });
                if (this.playerMode === 3 && this.scores[PLACEHOLDER_ID] === undefined) { this.scores[PLACEHOLDER_ID] = 120; }
                const shuffledPlayerIds = shuffle([...activePlayerIds]);
                this.dealer = shuffledPlayerIds[0];
                this.playerOrder.setTurnOrder(this.dealer);
                this._initializeNewRoundState();
                this.state = "Dealing Pending";
            },
            onFailure: (error, brokePlayerName) => {
                if (brokePlayerName) {
                    const brokePlayer = Object.values(this.players).find(p => p.playerName === brokePlayerName);
                    if (brokePlayer) {
                        delete this.players[brokePlayer.userId];
                        this.playerOrder.remove(brokePlayer.userId);
                    }
                }
                this.gameStarted = false;
                this.gameId = null; 
                this.playerMode = this.playerOrder.count;
                this.state = this.playerMode >= 3 ? "Ready to Start" : "Waiting for Players";
            }
        }];
        
        effects.push({ type: 'SYNC_PLAYER_TOKENS', payload: { playerIds: activePlayerIds } });
        effects.push({ type: 'BROADCAST_STATE' });
        effects.push({ type: 'UPDATE_LOBBY' });
        return this._effects(effects);
    }

    dealCards(requestingUserId) {
        if (this.state !== "Dealing Pending" || requestingUserId !== this.dealer) return this._effects();
        const turnOrder = this.playerOrder.turnOrder;
        const shuffledDeck = shuffle([...deck]);
        turnOrder.forEach((playerId, i) => {
            const playerName = this.players[playerId].playerName;
            this.hands[playerName] = shuffledDeck.slice(i * 11, (i + 1) * 11);
        });
        this.widow = shuffledDeck.slice(11 * turnOrder.length);
        this.originalDealtWidow = [...this.widow];
        this.state = "Bidding Phase";
        this.biddingTurnPlayerId = turnOrder[0];
        return this._effects([{ type: 'BROADCAST_STATE' }]);
    }

    placeBid(userId, bid) {
        const effects = biddingHandler.placeBid(this, userId, bid);
        return this._effects(effects);
    }
    
    chooseTrump(userId, suit) {
        if (this.state !== "Trump Selection" || this.bidWinnerInfo?.userId !== userId || !["S", "C", "D"].includes(suit)) return this._effects();
        this.trumpSuit = suit;
        this._transitionToPlayingPhase();
        return this._effects([{ type: 'BROADCAST_STATE' }]);
    }

    submitFrogDiscards(userId, discards) {
        const player = this.players[userId];
        if (!player || this.state !== "Frog Widow Exchange" || this.bidWinnerInfo?.userId !== userId || !Array.isArray(discards) || discards.length !== 3) return this._effects();
        const currentHand = this.hands[player.playerName];
        if (!discards.every(card => currentHand.includes(card))) return this._effects();
        this.widowDiscardsForFrogBidder = discards;
        this.hands[player.playerName] = currentHand.filter(card => !discards.includes(card));
        this._transitionToPlayingPhase();
        return this._effects([{ type: 'BROADCAST_STATE' }]);
    }

    playCard(userId, card) {
        const effects = playHandler.playCard(this, userId, card);
        return this._effects(effects);
    }

    requestNextRound(requestingUserId) {
        if (this.state === "Awaiting Next Round Trigger" && requestingUserId === this.roundSummary?.dealerOfRoundId) {
            this._advanceRound();
        }
        return this._effects([{ type: 'BROADCAST_STATE' }]);
    }

    reset() {
        console.log(`[${this.tableId}] Game is being reset by 'Play Again' button.`);
        this.gameStarted = false;
        this.gameId = null;
        this.playerMode = null;
        this._initializeNewRoundState();
        for (const userId in this.players) {
            if (this.players[userId].disconnected) {
                console.log(`[${this.tableId}] Removing disconnected player ${this.players[userId].playerName} during reset.`);
                this.playerOrder.remove(parseInt(userId, 10));
                if (this.players[userId].isBot) {
                    delete this.bots[userId];
                }
                delete this.players[userId];
            }
        }
        
        this.scores = {};
        for (const userId in this.players) {
            const player = this.players[userId];
            player.isSpectator = false;
            this.scores[player.playerName] = 120;
        }
        this.playerMode = this.playerOrder.count;
        this.state = this.playerMode >= 3 ? "Ready to Start" : "Waiting for Players";
        this.dealer = null;

        console.log(`[${this.tableId}] Reset complete. State is now '${this.state}' with ${this.playerMode} players.`);

        return this._effects([{ type: 'BROADCAST_STATE' }, { type: 'UPDATE_LOBBY' }]);
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
        } else { return; }
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
        if (!player || this.drawRequest.isActive || this.state !== 'Playing Phase') return this._effects();
        this.drawRequest.isActive = true;
        this.drawRequest.initiator = player.playerName;
        this.drawRequest.votes = {};
        const activePlayers = this.playerOrder.allIds.map(id => this.players[id]);
        activePlayers.forEach(p => {
            if (!p.isSpectator) {
                this.drawRequest.votes[p.playerName] = (p.playerName === player.playerName) ? 'wash' : null;
            }
        });
        this.drawRequest.timer = 30;
        return this._effects([{ type: 'BROADCAST_STATE' }]);
    }

    submitDrawVote(userId, vote) {
        const player = this.players[userId];
        if (!player || !this.drawRequest.isActive || !['wash', 'split', 'no'].includes(vote) || this.drawRequest.votes[player.playerName] !== null) {
            return this._effects();
        }

        this.drawRequest.votes[player.playerName] = vote;
        
        if (vote === 'no') {
            this.drawRequest.isActive = false;
            return this._effects([
                { type: 'EMIT_TO_TABLE', payload: { event: 'drawDeclined' } },
                { type: 'BROADCAST_STATE' }
            ]);
        }

        const allVotes = Object.values(this.drawRequest.votes);
        if (allVotes.some(v => v === null)) {
            return this._effects([{ type: 'BROADCAST_STATE' }]);
        }
        
        this.drawRequest.isActive = false;
        const outcome = allVotes.includes('split') ? 'split' : 'wash';

        return this._effects([{
            type: 'HANDLE_DRAW_OUTCOME',
            payload: {
                outcome,
                gameId: this.gameId,
                theme: this.theme,
                players: this.players,
                scores: this.scores
            },
            onComplete: (summary) => {
                this.roundSummary = summary;
                this.state = "Game Over";
            }
        }]);
    }

    // =================================================================
    // --- HELPER METHODS ---
    // =================================================================

    _initializeNewRoundState() {
        this.hands = {}; this.widow = []; this.originalDealtWidow = [];
        this.biddingTurnPlayerId = null; this.currentHighestBidDetails = null; this.playersWhoPassedThisRound = [];
        this.bidWinnerInfo = null; this.trumpSuit = null; this.trumpBroken = false; this.originalFrogBidderId = null; this.soloBidMadeAfterFrog = false; this.revealedWidowForFrog = []; this.widowDiscardsForFrogBidder = [];
        this.trickTurnPlayerId = null; this.trickLeaderId = null; this.currentTrickCards = []; this.leadSuitCurrentTrick = null; this.lastCompletedTrick = null; this.tricksPlayedCount = 0; this.capturedTricks = {}; this.roundSummary = null; 
        this.insurance = { isActive: false, bidMultiplier: null, bidderPlayerName: null, bidderRequirement: 0, defenderOffers: {}, dealExecuted: false, executedDetails: null };
        this.forfeiture = { targetPlayerName: null, timeLeft: null }; this.drawRequest = { isActive: false, initiator: null, votes: {}, timer: null };
        Object.values(this.players).forEach(p => {
            if (p.playerName && this.scores[p.playerName] !== undefined) {
                this.capturedTricks[p.playerName] = [];
            }
        });
        this.bidderCardPoints = 0; this.defenderCardPoints = 0;
    }
    
    _clearForfeitTimer() {
        if (this.internalTimers.forfeit) {
            clearInterval(this.internalTimers.forfeit);
            delete this.internalTimers.forfeit;
        }
        this.forfeiture = { targetPlayerName: null, timeLeft: null };
    }

    _resolveForfeit(forfeitingPlayerName, reason) {
        console.log(`[${this.tableId}] Forfeit by ${forfeitingPlayerName}`);
        this.state = "Game Over";
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
            
            // --- THIS IS FIX #2: INSURANCE COUNTER ---
            // This is a more robust way to get the list of defender names.
            const allPlayerNames = Object.values(this.players)
                .filter(p => !p.isSpectator)
                .map(p => p.playerName);
            const defenders = allPlayerNames.filter(name => name !== this.bidWinnerInfo.playerName);

            defenders.forEach(defName => { this.insurance.defenderOffers[defName] = -60 * multiplier; });
        }
    }
    
    _advanceRound() {
        if (!this.gameStarted) return;
        const roster = this.playerOrder.allIds;
        const oldDealerIndex = roster.indexOf(this.dealer);
        this.dealer = roster[(oldDealerIndex + 1) % roster.length];

        if (!this.players[this.dealer]) {
            console.error(`[${this.tableId}] FATAL: Could not find new dealer. Resetting table.`);
            this.reset();
            return;
        }
        
        this.playerOrder.setTurnOrder(this.dealer);
        this._initializeNewRoundState();
        this.state = "Dealing Pending";
    }

    getStateForClient() {
        const activeTurnOrder = this.gameStarted ? this.playerOrder.turnOrder : this.playerOrder.allIds;
        const state = {
            tableId: this.tableId, tableName: this.tableName, theme: this.theme, state: this.state, players: this.players,
            playerOrderActive: activeTurnOrder.map(id => this.players[id]?.playerName).filter(Boolean),
            dealer: this.dealer, hands: this.hands, widow: this.widow, originalDealtWidow: this.originalDealtWidow, scores: this.scores, currentHighestBidDetails: this.currentHighestBidDetails, bidWinnerInfo: this.bidWinnerInfo, gameStarted: this.gameStarted, trumpSuit: this.trumpSuit, currentTrickCards: this.currentTrickCards, tricksPlayedCount: this.tricksPlayedCount, leadSuitCurrentTrick: this.leadSuitCurrentTrick, trumpBroken: this.trumpBroken, capturedTricks: this.capturedTricks, roundSummary: this.roundSummary, lastCompletedTrick: this.lastCompletedTrick, playersWhoPassedThisRound: this.playersWhoPassedThisRound.map(id => this.players[id]?.playerName), playerMode: this.playerMode, serverVersion: this.serverVersion, insurance: this.insurance, forfeiture: this.forfeiture, drawRequest: this.drawRequest, originalFrogBidderId: this.originalFrogBidderId, soloBidMadeAfterFrog: this.soloBidMadeAfterFrog, revealedWidowForFrog: this.revealedWidowForFrog, widowDiscardsForFrogBidder: this.widowDiscardsForFrogBidder,
            bidderCardPoints: this.bidderCardPoints, defenderCardPoints: this.defenderCardPoints,
        };
        state.biddingTurnPlayerName = this.players[this.biddingTurnPlayerId]?.playerName;
        state.trickTurnPlayerName = this.players[this.trickTurnPlayerId]?.playerName;
        return state;
    }
}

module.exports = GameEngine;
