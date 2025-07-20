// backend/src/events/gameEvents.js

const jwt = require("jsonwebtoken");

const registerGameHandlers = (io, gameService) => {

    io.use((socket, next) => {
        const token = socket.handshake.auth.token;
        if (!token) return next(new Error("Authentication error: No token provided."));
        jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
            if (err) return next(new Error("Authentication error: Invalid token."));
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

        // --- SERVER-WIDE ADMIN EVENTS ---
        socket.on("hardResetServer", ({ secret }) => {
            if (!socket.user.is_admin) {
                console.warn(`[SECURITY] Non-admin ${socket.user.username} attempted hard reset.`);
                return socket.emit("error", { message: "Admin privileges required." });
            }
            if (secret === process.env.ADMIN_SECRET) {
                console.log(`[ADMIN] Hard reset triggered by ${socket.user.username}`);
                gameService.resetAllEngines();
                io.emit('forceDisconnectAndReset', 'The server has been reset. Please log in again.');
                io.disconnectSockets(true);
            } else {
                console.warn(`[SECURITY] Failed hard reset attempt by ${socket.user.username} with wrong secret.`);
                return socket.emit("error", { message: "Invalid reset secret." });
            }
        });
        // --- END ADMIN EVENTS ---

        // --- GAME EVENT LISTENERS ---
        socket.on("joinTable", async ({ tableId }) => {
            const engineToJoin = gameService.getEngineById(tableId);
            if (!engineToJoin) return socket.emit("error", { message: "Table not found." });

            const previousEngine = Object.values(gameService.getAllEngines()).find(e => e.players[socket.user.id] && e.tableId !== tableId);
            if (previousEngine) {
                previousEngine.leaveTable(socket.user.id); // Engine state change
                socket.leave(previousEngine.tableId);
                gameService.io.to(previousEngine.tableId).emit('gameState', previousEngine.getStateForClient()); // Broadcast update
            }
            
            socket.join(tableId);
            engineToJoin.joinTable(socket.user, socket.id); // Engine state change
            gameService.io.to(tableId).emit('gameState', engineToJoin.getStateForClient()); // Broadcast update
            gameService.io.emit('lobbyState', gameService.getLobbyState()); // Update lobby
        });

        socket.on("leaveTable", async ({ tableId }) => {
            const engineToLeave = gameService.getEngineById(tableId);
            if (engineToLeave) {
                engineToLeave.leaveTable(socket.user.id);
                gameService.io.to(tableId).emit('gameState', engineToLeave.getStateForClient());
                gameService.io.emit('lobbyState', gameService.getLobbyState());
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
        
        // Refactored handlers that use the service
        socket.on("startGame", ({ tableId }) => { gameService.startGame(tableId, socket.user.id); });
        socket.on("playCard", ({ tableId, card }) => { gameService.playCard(tableId, socket.user.id, card); });

        // Un-refactored handlers that still call the engine directly
        const createDirectHandler = (methodName) => ({ tableId, ...payload }) => {
            const engine = gameService.getEngineById(tableId);
            if (engine && typeof engine[methodName] === 'function') {
                engine[methodName](socket.user.id, payload);
                gameService.io.to(tableId).emit('gameState', engine.getStateForClient());
            }
        };

        socket.on("dealCards", createDirectHandler('dealCards'));
        socket.on("placeBid", createDirectHandler('placeBid'));
        socket.on("chooseTrump", createDirectHandler('chooseTrump'));
        socket.on("submitFrogDiscards", createDirectHandler('submitFrogDiscards'));
        socket.on("requestNextRound", createDirectHandler('requestNextRound'));
        socket.on("forfeitGame", createDirectHandler('forfeitGame'));
        socket.on("resetGame", createDirectHandler('reset'));
        socket.on("updateInsuranceSetting", createDirectHandler('updateInsuranceSetting'));
        socket.on("startTimeoutClock", createDirectHandler('startTimeoutClock'));
        socket.on("requestDraw", createDirectHandler('requestDraw'));
        socket.on("submitDrawVote", createDirectHandler('submitDrawVote'));
    });
};

module.exports = registerGameHandlers;