// backend/src/core/GameEngine.js

const { SERVER_VERSION, TABLE_COSTS, BID_HIERARCHY, PLACEHOLDER_ID, deck, SUITS, BID_MULTIPLIER } = require('./constants');
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
    constructor(tableId, theme, tableName, emitLobbyUpdateCallback) {
        // --- REFACTOR: Removed io and pool from constructor ---
        this.emitLobbyUpdateCallback = emitLobbyUpdateCallback;
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
        this.internalTimers = {}; // Note: Timers are a grey area. A purer model would have the service manage them. We'll keep them here for now for simplicity.
        this.bots = {};
        this._nextBotId = -1;
        this.pendingBotAction = null;
        this._initializeNewRoundState();
    }

    /**
     * A helper to create a standard effects object.
     * @param {Array} a - The array of effects.
     * @returns {{effects: Array}}
     */
    _effects(a = []) {
        return { effects: a };
    }

    // =================================================================
    // PUBLIC METHODS (returning effects instead of direct I/O)
    // =================================================================

    joinTable(user, socketId) {
        const { id, username } = user;
        const isPlayerAlreadyInGame = !!this.players[id];
        const effects = [];

        if (isPlayerAlreadyInGame) {
            this.players[id].disconnected = false;
            this.players[id].socketId = socketId;
        } else {
            const activePlayersCount = Object.values(this.players).filter(p => !p.isSpectator).length;

            if (this.gameStarted || activePlayersCount >= 4) {
                this.players[id] = { userId: id, playerName: username, socketId: socketId, isSpectator: true, disconnected: false };
            } else {
                const tableCost = TABLE_COSTS[this.theme] || 0;
                // --- REFACTOR: Return an effect for the service to check balance ---
                effects.push({
                    type: 'VERIFY_PLAYER_BALANCE',
                    payload: { userId: id, required: tableCost, onSuccess: () => {
                        this.players[id] = { userId: id, playerName: username, socketId: socketId, isSpectator: false, disconnected: false };
                    }}
                });
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
        
        effects.push({ type: 'SYNC_PLAYER_TOKENS', payload: { playerIds: Object.keys(this.players) } });
        effects.push({ type: 'EMIT_TO_SOCKET', payload: { socketId, event: 'joinedTable', data: { tableId: this.tableId, gameState: this.getStateForClient() } } });
        effects.push({ type: 'BROADCAST_STATE' });
        effects.push({ type: 'UPDATE_LOBBY' });
        
        return this._effects(effects);
    }
    
    // ... (Other methods like leaveTable, addBotPlayer, etc. would be refactored similarly)
    // For brevity, we'll skip to the most critical ones.

    startGame(requestingUserId) {
        const effects = [];
        if (this.gameStarted || !this.players[requestingUserId] || this.players[requestingUserId].isSpectator) {
            return this._effects();
        }

        const activePlayers = Object.values(this.players).filter(p => !p.isSpectator && !p.disconnected);
        if (activePlayers.length < 3) { 
            const socketId = this.players[requestingUserId]?.socketId;
            effects.push({ type: 'EMIT_TO_SOCKET', payload: { socketId, event: 'gameStartError', data: { message: "Need at least 3 players to start." } } });
            return this._effects(effects);
        }
        
        this.playerMode = activePlayers.length;
        const activePlayerIds = activePlayers.map(p => p.userId);
        
        // --- REFACTOR: Return effects to handle DB transactions ---
        effects.push({
            type: 'START_GAME_TRANSACTIONS',
            payload: { 
                table: this,
                playerIds: activePlayers.filter(p => !p.isBot).map(p => p.userId) 
            },
            onSuccess: (gameId) => {
                this.gameId = gameId; // The service will pass the new gameId back
                this.gameStarted = true;
                activePlayers.forEach(p => { if (this.scores[p.playerName] === undefined) this.scores[p.playerName] = 120; });
                if (this.playerMode === 3 && this.scores[PLACEHOLDER_ID] === undefined) { this.scores[PLACEHOLDER_ID] = 120; }
                const shuffledPlayerIds = shuffle([...activePlayerIds]);
                this.dealer = shuffledPlayerIds[0];
                this._recalculateActivePlayerOrder();
                this._initializeNewRoundState();
                this.state = "Dealing Pending";
            },
            onFailure: (error, brokePlayerName) => {
                // Logic to handle failure, e.g., kicking the broke player
                if (brokePlayerName) {
                    const brokePlayer = Object.values(this.players).find(p => p.playerName === brokePlayerName);
                    if (brokePlayer) delete this.players[brokePlayer.userId];
                    this._recalculateActivePlayerOrder();
                    this.playerMode = this.playerOrderActive.length;
                    this.state = this.playerMode >= 3 ? "Ready to Start" : "Waiting for Players";
                }
                this.gameId = null; 
            }
        });

        effects.push({ type: 'SYNC_PLAYER_TOKENS', payload: { playerIds: activePlayerIds } });
        effects.push({ type: 'BROADCAST_STATE' });
        effects.push({ type: 'UPDATE_LOBBY' });

        return this._effects(effects);
    }
    
    playCard(userId, card) {
        // ... (existing playCard validation logic remains the same) ...

        // --- REFACTOR: No direct emissions, return effects ---
        this.hands[player.playerName] = hand.filter(c => c !== card);
        this.currentTrickCards.push({ userId, playerName: player.playerName, card });
        if (isLeading) this.leadSuitCurrentTrick = playedSuit;
        if (playedSuit === this.trumpSuit) this.trumpBroken = true;
        
        const expectedCardsInTrick = this.playerOrderActive.length;
        if (this.currentTrickCards.length === expectedCardsInTrick) {
            return this._resolveTrick(); // _resolveTrick will now return effects
        } else {
            const currentTurnPlayerIndex = this.playerOrderActive.indexOf(userId);
            this.trickTurnPlayerId = this.playerOrderActive[(currentTurnPlayerIndex + 1) % expectedCardsInTrick];
            return this._effects([{ type: 'BROADCAST_STATE' }]);
        }
    }
    
    // =================================================================
    // INTERNAL METHODS (many now return effects to be passed up)
    // =================================================================

    _resolveTrick() {
        // ... (all existing logic for determining winner, points, etc.) ...
        
        if (this.tricksPlayedCount === 11) {
            return this._calculateRoundScores(); // Pass effects up
        } else {
            this.state = "TrickCompleteLinger";
            // The service layer will handle the timeout
            const winnerId = winnerInfo.userId;
            const effects = [
                { type: 'BROADCAST_STATE' },
                { 
                    type: 'START_TIMER', 
                    payload: { 
                        duration: 1000, 
                        onTimeout: () => {
                            if (this.state === "TrickCompleteLinger") {
                                this.currentTrickCards = [];
                                this.leadSuitCurrentTrick = null;
                                this.trickTurnPlayerId = winnerId;
                                this.state = "Playing Phase";
                                // Return another effect to broadcast the final state change
                                return [{ type: 'BROADCAST_STATE' }];
                            }
                            return []; // No further effects if state changed
                        }
                    } 
                }
            ];
            return this._effects(effects);
        }
    }

    _calculateRoundScores() {
        const roundData = gameLogic.calculateRoundScoreDetails(this);
        for(const playerName in roundData.pointChanges) { if(this.scores[playerName] !== undefined) { this.scores[playerName] += roundData.pointChanges[playerName]; } }
        
        let isGameOver = Object.values(this.scores).filter(s => typeof s === 'number').some(score => score <= 0);
        
        const effects = [];

        if (isGameOver) {
            // --- REFACTOR: Create an effect for the service to handle game over logic ---
            effects.push({
                type: 'HANDLE_GAME_OVER',
                payload: { table: this },
                onComplete: (gameWinnerName) => {
                    this.roundSummary = { 
                        /* ... */ 
                        gameWinner: gameWinnerName,
                        /* ... */ 
                    };
                }
            });
        }
        
        this.roundSummary = { /* ... create summary object ... */ };
        this.state = isGameOver ? "Game Over" : "Awaiting Next Round Trigger";

        effects.push({ type: 'SYNC_PLAYER_TOKENS', payload: { playerIds: Object.keys(this.players) } });
        effects.push({ type: 'BROADCAST_STATE' });
        
        return this._effects(effects);
    }
    
    // ... (All other methods like `_emitUpdate` are removed)
    // ... (All other pure logic methods remain unchanged)
}

module.exports = GameEngine;