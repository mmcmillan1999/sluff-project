// backend/src/services/GameService.js

const GameEngine = require('../core/GameEngine');
const transactionManager = require('../data/transactionManager');
// --- THIS IS THE LINE TO FIX ---
const { THEMES, TABLE_COSTS } = require('../core/constants');

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
                
                // Note: The engine doesn't get io or pool anymore.
                this.engines[tableId] = new GameEngine(tableId, theme.id, tableName, this.getLobbyState.bind(this));
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
        // This logic is moved from the old gameState.js and adapted for the service
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
            serverVersion: require('../core/constants').SERVER_VERSION
        };
    }


    // --- Action Handlers (called by socket events) ---

    async playCard(tableId, userId, card) {
        const engine = this.getEngineById(tableId);
        if (!engine) return;

        // 1. Call the pure engine method
        const result = engine.playCard(userId, card);
        
        // 2. Execute the returned side effects
        await this._executeEffects(tableId, result.effects);
    }
    
    // ... Other action handlers for placeBid, leaveTable, etc. would follow this same pattern ...


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
                    this._triggerBots(tableId); // Trigger bots after state change
                    break;

                case 'EMIT_TO_SOCKET':
                    this.io.to(effect.payload.socketId).emit(effect.payload.event, effect.payload.data);
                    break;
                
                case 'UPDATE_LOBBY':
                    this.io.emit('lobbyState', this.getLobbyState());
                    break;

                case 'START_GAME_TRANSACTIONS': {
                    try {
                        const gameId = await transactionManager.createGameRecord(this.pool, effect.payload.table);
                        await transactionManager.handleGameStartTransaction(this.pool, effect.payload.table, effect.payload.playerIds, gameId);
                        
                        // If successful, call the onSuccess callback to update the engine's state
                        if (effect.onSuccess) effect.onSuccess(gameId);

                    } catch (err) {
                        const insufficientFundsMatch = err.message.match(/(.+) has insufficient tokens/);
                        const brokePlayerName = insufficientFundsMatch ? insufficientFundsMatch[1] : null;

                        // If it fails, call the onFailure callback
                        if (effect.onFailure) effect.onFailure(err, brokePlayerName);
                        
                        // Also emit an error to the whole table
                        this.io.to(tableId).emit('gameStartFailed', { message: err.message, kickedPlayer: brokePlayerName });
                    }
                    break;
                }
                
                // ... More effect handlers would go here (e.g., HANDLE_GAME_OVER)
            }
        }
    }

    /**
     * Triggers bot actions for a specific table. This is now managed by the service.
     * @param {string} tableId 
     */
    _triggerBots(tableId) {
        const engine = this.getEngineById(tableId);
        if (!engine || engine.pendingBotAction) return;

        // The bot logic from the old Table.js would be adapted here.
        // It would check the engine's state and call the appropriate
        // action handler on this service (e.g., this.playCard(...))
    }
}

module.exports = GameService;