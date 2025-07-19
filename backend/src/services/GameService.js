// backend/src/services/GameService.js

const GameEngine = require('../core/GameEngine');
const transactionManager = require('../data/transactionManager');
const { THEMES, TABLE_COSTS, SERVER_VERSION } = require('../core/constants');
const gameLogic = require('../core/logic');

/**
 * GameService orchestrates all game-related actions.
 * It translates network events into calls to the pure GameEngine,
 * and executes the side effects (DB calls, socket emissions) returned by the engine.
 */
class GameService {
    constructor(io, pool) {
        this.io = io;
        this.pool = pool;
        this.engines = {}; // { [tableId]: GameEngine_instance }
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

    getEngineById(tableId) {
        return this.engines[tableId];
    }

    getAllEngines() {
        return this.engines;
    }

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
        return {
            themes: groupedByTheme,
            serverVersion: SERVER_VERSION
        };
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
    
    // ... Other action handlers would follow this same pattern ...

    /**
     * The core of the service. This function takes an array of effects
     * from the GameEngine and executes the necessary I/O operations.
     * @param {string} tableId - The ID of the table where the effects originated.
     * @param {Array<object>} effects - The list of effects to execute.
     */
    async _executeEffects(tableId, effects = []) {
        if (!effects || effects.length === 0) return;

        const engine = this.getEngineById(tableId);

        for (const effect of effects) {
            switch (effect.type) {
                case 'BROADCAST_STATE':
                    this.io.to(tableId).emit('gameState', engine.getStateForClient());
                    // this._triggerBots(tableId);
                    break;

                case 'EMIT_TO_SOCKET':
                    this.io.to(effect.payload.socketId).emit(effect.payload.event, effect.payload.data);
                    break;
                
                case 'UPDATE_LOBBY':
                    this.io.emit('lobbyState', this.getLobbyState());
                    break;
                
                // --- THIS IS THE NEWLY ADDED LOGIC ---
                case 'HANDLE_GAME_OVER': {
                    const transactionFn = (data) => transactionManager.postTransaction(this.pool, data);
                    const statUpdateFn = (query, params) => this.pool.query(query, params);

                    const gameOverResult = await gameLogic.handleGameOver(effect.payload, transactionFn, statUpdateFn);
                    await transactionManager.updateGameRecordOutcome(this.pool, effect.payload.gameId, `Game Over! Winner: ${gameOverResult.gameWinnerName}`);
                    
                    if (effect.onComplete) {
                        effect.onComplete(gameOverResult.gameWinnerName);
                    }
                    
                    Object.values(engine.players).forEach(p => {
                        if (!p.isBot && p.socketId) {
                            const playerSocket = this.io.sockets.sockets.get(p.socketId);
                            if (playerSocket) {
                                playerSocket.emit("requestUserSync"); 
                            }
                        }
                    });
                    break;
                }
                // --- END NEW LOGIC ---

                case 'START_GAME_TRANSACTIONS': {
                    // ... (this part remains unchanged)
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
        // Placeholder for future implementation
    }
}

module.exports = GameService;