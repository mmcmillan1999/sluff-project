// backend/src/services/GameService.js

const GameEngine = require('../core/GameEngine');
const transactionManager = require('../data/transactionManager');
const { THEMES, TABLE_COSTS, SERVER_VERSION } = require('../core/constants');
const gameLogic = require('../core/logic');

class GameService {
    constructor(io, pool) {
        this.io = io;
        this.pool = pool;
        this.engines = {};
        this._initializeEngines();
    }

    _initializeEngines() {
        let tableCounter = 1;
        THEMES.forEach(theme => {
            for (let i = 0; i < theme.count; i++) {
                const tableId = `table-${tableCounter}`;
                const tableNumber = i + 1;
                const tableName = `${theme.name} #${tableNumber}`;
                this.engines[tableId] = new GameEngine(tableId, theme.id, tableName);
                tableCounter++;
            }
        });
        console.log(`${tableCounter - 1} in-memory game engines initialized.`);
    }

    // --- Public Accessors ---
    getEngineById(tableId) { return this.engines[tableId]; }
    getAllEngines() { return this.engines; }
    getLobbyState() {
        const groupedByTheme = THEMES.map(theme => {
            const themeTables = Object.values(this.engines)
                .filter(engine => engine.theme === theme.id)
                .map(engine => {
                    const clientState = engine.getStateForClient();
                    const activePlayers = Object.values(clientState.players).filter(p => !p.isSpectator);
                    return {
                        tableId: clientState.tableId,
                        tableName: clientState.tableName,
                        state: clientState.state,
                        playerCount: activePlayers.length,
                        players: activePlayers.map(p => ({ userId: p.userId, playerName: p.playerName }))
                    };
                });
            return { ...theme, cost: TABLE_COSTS[theme.id] || 0, tables: themeTables };
        });
        return { themes: groupedByTheme, serverVersion: SERVER_VERSION };
    }

    // --- Action Handlers (called by socket events) ---
    async playCard(tableId, userId, card) {
        const engine = this.getEngineById(tableId);
        if (!engine) return;
        const result = engine.playCard(userId, card);
        await this._executeEffects(tableId, result.effects);
    }
    
    async startGame(tableId, requestingUserId) {
        const engine = this.getEngineById(tableId);
        if (!engine) return;
        const result = engine.startGame(requestingUserId);
        await this._executeEffects(tableId, result.effects);
    }
    
    async dealCards(tableId, requestingUserId) {
        const engine = this.getEngineById(tableId);
        if (!engine) return;
        const result = engine.dealCards(requestingUserId);
        await this._executeEffects(tableId, result.effects);
    }

    async placeBid(tableId, userId, bid) {
        const engine = this.getEngineById(tableId);
        if (!engine) return;
        const result = engine.placeBid(userId, bid);
        await this._executeEffects(tableId, result.effects);
    }

    async chooseTrump(tableId, userId, suit) {
        const engine = this.getEngineById(tableId);
        if (!engine) return;
        const result = engine.chooseTrump(userId, suit);
        await this._executeEffects(tableId, result.effects);
    }

    async submitFrogDiscards(tableId, userId, discards) {
        const engine = this.getEngineById(tableId);
        if (!engine) return;
        const result = engine.submitFrogDiscards(userId, discards);
        await this._executeEffects(tableId, result.effects);
    }

    async requestNextRound(tableId, userId) {
        const engine = this.getEngineById(tableId);
        if (!engine) return;
        const result = engine.requestNextRound(userId);
        await this._executeEffects(tableId, result.effects);
    }
    
    async handleGameOver(payload) {
        let gameWinnerName = "N/A";
        const { playerOrderActive, scores, theme, gameId, players } = payload;
        const tableCost = TABLE_COSTS[theme] || 0;

        try {
            const finalPlayerScores = playerOrderActive
                .map(id => players[id])
                .filter(p => p && !p.isBot)
                .map(p => ({ name: p.playerName, score: scores[p.playerName], userId: p.userId }))
                .sort((a, b) => b.score - a.score);
            
            if (finalPlayerScores.length === 3) {
                const [p1, p2, p3] = finalPlayerScores;
                if (p1.score > p2.score && p2.score > p3.score) {
                    gameWinnerName = p1.name;
                    await transactionManager.postTransaction(this.pool, { userId: p1.userId, gameId, type: 'win_payout', amount: tableCost * 2, description: `Win and Payout from ${p3.name}` });
                    await this.pool.query("UPDATE users SET wins = wins + 1 WHERE id = $1", [p1.userId]);
                    await transactionManager.postTransaction(this.pool, { userId: p2.userId, gameId, type: 'wash_payout', amount: tableCost, description: `Wash - Buy-in returned` });
                    await this.pool.query("UPDATE users SET washes = washes + 1 WHERE id = $1", [p2.userId]);
                    await this.pool.query("UPDATE users SET losses = losses + 1 WHERE id = $1", [p3.userId]);
                }
                else if (p1.score === p2.score && p2.score > p3.score) {
                    gameWinnerName = `${p1.name} & ${p2.name}`;
                    await transactionManager.postTransaction(this.pool, { userId: p1.userId, gameId, type: 'win_payout', amount: tableCost * 1.5, description: `Win (tie) - Split payout from ${p3.name}` });
                    await transactionManager.postTransaction(this.pool, { userId: p2.userId, gameId, type: 'win_payout', amount: tableCost * 1.5, description: `Win (tie) - Split payout from ${p3.name}` });
                    await this.pool.query("UPDATE users SET wins = wins + 1 WHERE id = ANY($1::int[])", [[p1.userId, p2.userId]]);
                    await this.pool.query("UPDATE users SET losses = losses + 1 WHERE id = $1", [p3.userId]);
                }
                else if (p1.score > p2.score && p2.score === p3.score) {
                    gameWinnerName = p1.name;
                    await transactionManager.postTransaction(this.pool, { userId: p1.userId, gameId, type: 'win_payout', amount: tableCost * 3, description: `Win - Collects full pot` });
                    await this.pool.query("UPDATE users SET wins = wins + 1 WHERE id = $1", [p1.userId]);
                    await this.pool.query("UPDATE users SET losses = losses + 1 WHERE id = ANY($1::int[])", [[p2.userId, p3.userId]]);
                }
                else {
                    gameWinnerName = "3-Way Tie";
                    for (const p of finalPlayerScores) {
                        await transactionManager.postTransaction(this.pool, { userId: p.userId, gameId, type: 'wash_payout', amount: tableCost, description: `3-Way Tie - Buy-in returned` });
                        await this.pool.query("UPDATE users SET washes = washes + 1 WHERE id = $1", [p.userId]);
                    }
                }
            }
            await transactionManager.updateGameRecordOutcome(this.pool, gameId, `Game Over! Winner: ${gameWinnerName}`);
        } catch(err) {
            console.error("Database error during game over update:", err);
        }

        return { gameWinnerName };
    }

    resetAllEngines() {
        console.log("[ADMIN] Resetting all game engines to initial state.");
        this.engines = {};
        this._initializeEngines();
        this.io.emit('lobbyState', this.getLobbyState());
    }

    async _executeEffects(tableId, effects = []) {
        if (!effects || effects.length === 0) return;
        const engine = this.getEngineById(tableId);

        for (const effect of effects) {
            switch (effect.type) {
                case 'BROADCAST_STATE':
                    this.io.to(tableId).emit('gameState', engine.getStateForClient());
                    this._triggerBots(tableId);
                    break;
                case 'EMIT_TO_SOCKET':
                    this.io.to(effect.payload.socketId).emit(effect.payload.event, effect.payload.data);
                    break;
                case 'UPDATE_LOBBY':
                    this.io.emit('lobbyState', this.getLobbyState());
                    break;
                case 'START_TIMER':
                    setTimeout(async () => {
                        const followUpEffects = effect.payload.onTimeout(engine);
                        if (followUpEffects && followUpEffects.length > 0) {
                            await this._executeEffects(tableId, followUpEffects);
                        }
                    }, effect.payload.duration);
                    break;
                case 'SYNC_PLAYER_TOKENS':
                    Object.values(engine.players).forEach(p => {
                        if (!p.isBot && p.socketId) {
                            const playerSocket = this.io.sockets.sockets.get(p.socketId);
                            if (playerSocket) playerSocket.emit("requestUserSync");
                        }
                    });
                    break;
                case 'HANDLE_GAME_OVER': {
                    const gameOverResult = await this.handleGameOver(effect.payload);
                    if (effect.onComplete) {
                        effect.onComplete(gameOverResult.gameWinnerName);
                    }
                    this.io.to(tableId).emit('gameState', engine.getStateForClient());
                    break;
                }
                case 'START_GAME_TRANSACTIONS': {
                    try {
                        const gameId = await transactionManager.createGameRecord(this.pool, effect.payload.table);
                        await transactionManager.handleGameStartTransaction(this.pool, effect.payload.table, effect.payload.playerIds, gameId);
                        if (effect.onSuccess) effect.onSuccess(gameId);
                    } catch (err) {
                        const insufficientFundsMatch = err.message.match(/(.+) has insufficient tokens/);
                        const brokePlayerName = insufficientFundsMatch ? insufficientFundsMatch[1] : null;
                        if (effect.onFailure) effect.onFailure(err, brokePlayerName);
                        this.io.to(tableId).emit('gameStartFailed', { message: err.message, kickedPlayer: brokePlayerName });
                    }
                    break;
                }
            }
        }
    }

    _triggerBots(tableId) {
        const engine = this.getEngineById(tableId);
        if (!engine || engine.pendingBotAction) return;

        for (const botId in engine.bots) {
            const bot = engine.bots[botId];
            
            const isCourtney = bot.playerName === "Courtney Sr.";
            const standardDelay = 1000;
            const playDelay = 1200;
            const roundEndDelay = 8000;

            const makeMove = (actionFn, ...args) => {
                const delay = 
                    engine.state === 'Playing Phase' ? (isCourtney ? playDelay * 2 : playDelay) :
                    engine.state === 'Awaiting Next Round Trigger' ? (isCourtney ? roundEndDelay * 2 : roundEndDelay) :
                    (isCourtney ? standardDelay * 2 : standardDelay);

                engine.pendingBotAction = setTimeout(() => {
                    engine.pendingBotAction = null;
                    actionFn(tableId, bot.userId, ...args);
                }, delay);
            };

            if (engine.state === 'Dealing Pending' && engine.dealer == bot.userId) {
                return makeMove(this.dealCards.bind(this));
            }
            if (engine.state === 'Awaiting Next Round Trigger' && engine.roundSummary?.dealerOfRoundId == bot.userId) {
                return makeMove(this.requestNextRound.bind(this));
            }
            if (engine.state === 'Awaiting Frog Upgrade Decision' && engine.biddingTurnPlayerId == bot.userId) {
                return makeMove(this.placeBid.bind(this), "Pass");
            }
            if (engine.state === 'Bidding Phase' && engine.biddingTurnPlayerId == bot.userId) {
                const bid = bot.makeBid(); // Bot logic now returns the bid
                return makeMove(this.placeBid.bind(this), bid);
            }
            if (engine.state === 'Trump Selection' && engine.bidWinnerInfo?.userId == bot.userId && !engine.trumpSuit) {
                const suit = bot.chooseTrump(); // Bot logic now returns the suit
                return makeMove(this.chooseTrump.bind(this), suit);
            }
            if (engine.state === 'Frog Widow Exchange' && engine.bidWinnerInfo?.userId == bot.userId && engine.widowDiscardsForFrogBidder.length === 0) {
                const discards = bot.submitFrogDiscards(); // Bot logic now returns discards
                return makeMove(this.submitFrogDiscards.bind(this), discards);
            }
            if (engine.state === 'Playing Phase' && engine.trickTurnPlayerId == bot.userId) {
                const card = bot.playCard(); // Bot logic now returns the card
                return makeMove(this.playCard.bind(this), card);
            }
        }
    }
}

module.exports = GameService;