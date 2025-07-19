// backend/src/events/gameEvents.js

const jwt = require("jsonwebtoken");

/**
 * Registers all Socket.IO event handlers for the application.
 * @param {object} io - The main Socket.IO server instance.
 * @param {GameService} gameService - The service that orchestrates game logic.
 */
const registerGameHandlers = (io, gameService) => {

    io.use((socket, next) => {
        const token = socket.handshake.auth.token;
        if (!token) {
            return next(new Error("Authentication error: No token provided."));
        }
        jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
            if (err) {
                return next(new Error("Authentication error: Invalid token."));
            }
            socket.user = user;
            next();
        });
    });

    io.on("connection", (socket) => {
        console.log(`Socket connected: ${socket.user.username} (ID: ${socket.user.id}, Socket: ${socket.id})`);

        const engine = Object.values(gameService.getAllEngines()).find(e => e.players[socket.user.id]);
        if (engine && engine.players[socket.user.id]?.disconnected) {
            engine.reconnectPlayer(socket.user.id, socket);
        }
        
        socket.emit("lobbyState", gameService.getLobbyState());

        // --- NEW: SERVER-WIDE ADMIN EVENTS ---
        socket.on("hardResetServer", ({ secret }) => {
            // Check for the admin secret from the .env file
            if (secret === process.env.ADMIN_SECRET) {
                console.log(`[ADMIN] Hard reset triggered by ${socket.user.username}`);
                gameService.resetAllEngines();
                io.emit('forceDisconnectAndReset', 'The server is being reset by an administrator. Please log in again.');
            } else {
                console.warn(`[SECURITY] Failed hard reset attempt by ${socket.user.username}`);
            }
        });
        // --- END NEW ---

        // --- GAME EVENT LISTENERS ---
        socket.on("joinTable", async ({ tableId }) => {
            const engineToJoin = gameService.getEngineById(tableId);
            if (!engineToJoin) return socket.emit("error", { message: "Table not found." });

            const previousEngine = Object.values(gameService.getAllEngines()).find(e => e.players[socket.user.id] && e.tableId !== tableId);
            if (previousEngine) {
                await previousEngine.leaveTable(socket.user.id);
                socket.leave(previousEngine.tableId);
            }
            
            socket.join(tableId);
            // This part will be refactored into the service later
            engineToJoin.joinTable(socket.user, socket.id);
            gameService.io.to(tableId).emit('gameState', engineToJoin.getStateForClient());
            gameService.io.emit('lobbyState', gameService.getLobbyState());
        });

        socket.on("leaveTable", async ({ tableId }) => {
            const engineToLeave = gameService.getEngineById(tableId);
            if (engineToLeave) {
                engineToLeave.leaveTable(socket.user.id);
                gameService.io.to(tableId).emit('gameState', engineToLeave.getStateForClient());
            }
            socket.leave(tableId);
            socket.emit("lobbyState", gameService.getLobbyState());
        });

        socket.on("addBot", ({ tableId, name }) => {
            const engine = gameService.getEngineById(tableId);
            if (engine) {
                engine.addBotPlayer(name || 'Lee');
                gameService.io.to(tableId).emit('gameState', engine.getStateForClient());
                gameService.io.emit('lobbyState', gameService.getLobbyState());
            }
        });
        
        // Refactored handlers
        socket.on("startGame", ({ tableId }) => {
            gameService.startGame(tableId, socket.user.id);
        });
        
        socket.on("playCard", ({ tableId, card }) => {
            gameService.playCard(tableId, socket.user.id, card);
        });

        // Un-refactored handlers (for now)
        socket.on("dealCards", ({ tableId }) => {
            const engine = gameService.getEngineById(tableId);
            if (engine) {
                engine.dealCards(socket.user.id);
                gameService.io.to(tableId).emit('gameState', engine.getStateForClient());
            }
        });

        // ... (other un-refactored handlers would also need to emit state updates)
    });
};

module.exports = registerGameHandlers;