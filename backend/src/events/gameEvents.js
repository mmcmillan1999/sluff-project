// backend/src/events/gameEvents.js

/**
 * Registers all Socket.IO event handlers for the application.
 * This is the "network layer" that listens for client events
 * and calls the appropriate service methods.
 * @param {object} io - The main Socket.IO server instance.
 * @param {GameService} gameService - The service that orchestrates game logic.
 */
const registerGameHandlers = (io, gameService) => {

    // --- Authentication Middleware ---
    io.use((socket, next) => {
        const token = socket.handshake.auth.token;
        if (!token) {
            return next(new Error("Authentication error: No token provided."));
        }
        const jwt = require("jsonwebtoken");
        jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
            if (err) {
                return next(new Error("Authentication error: Invalid token."));
            }
            socket.user = user;
            next();
        });
    });

    // --- Main Connection Handler ---
    io.on("connection", (socket) => {
        console.log(`Socket connected: ${socket.user.username} (ID: ${socket.user.id}, Socket: ${socket.id})`);

        // Reconnect logic
        const engine = Object.values(gameService.getAllEngines()).find(e => e.players[socket.user.id]);
        if (engine && engine.players[socket.user.id].disconnected) {
            engine.reconnectPlayer(socket.user.id, socket);
        }
        
        // Send initial lobby state on connection
        socket.emit("lobbyState", gameService.getLobbyState());

        // --- GAME EVENT LISTENERS (DELEGATION MODEL) ---
        // Refactored to call the gameService instead of the table directly
        socket.on("joinTable", async ({ tableId }) => {
            const engineToJoin = gameService.getEngineById(tableId);
            if (!engineToJoin) return socket.emit("error", { message: "Table not found." });

            const previousEngine = Object.values(gameService.getAllEngines()).find(e => e.players[socket.user.id] && e.tableId !== tableId);
            if (previousEngine) {
                await previousEngine.leaveTable(socket.user.id);
                socket.leave(previousEngine.tableId);
            }
            
            socket.join(tableId);
            // We still need to call the engine directly for join/leave as it's complex
            // This is a candidate for a future refactor into the service itself.
            await engineToJoin.joinTable(socket.user, socket.id);
        });

        socket.on("leaveTable", async ({ tableId }) => {
            const engineToLeave = gameService.getEngineById(tableId);
            if (engineToLeave) {
                await engineToLeave.leaveTable(socket.user.id);
            }
            socket.leave(tableId);
            socket.emit("lobbyState", gameService.getLobbyState());
        });

        socket.on("addBot", ({ tableId, name }) => {
            const engine = gameService.getEngineById(tableId);
            if (engine) engine.addBotPlayer(name || 'Lee'); // This can also be moved to the service
        });
        
        socket.on("startGame", ({ tableId }) => {
            gameService.startGame(tableId, socket.user.id);
        });
        
        socket.on("playCard", ({ tableId, card }) => {
            gameService.playCard(tableId, socket.user.id, card);
        });

        // ... other simple handlers would be refactored to call the service ...
        // e.g., gameService.placeBid(tableId, socket.user.id, bid);
        
        // For now, we leave the less critical ones pointing to the engine for simplicity.
        // The pattern is established.
        socket.on("dealCards", ({ tableId }) => {
            const engine = gameService.getEngineById(tableId);
            if (engine) engine.dealCards(socket.user.id);
        });

        socket.on("placeBid", ({ tableId, bid }) => {
            const engine = gameService.getEngineById(tableId);
            if (engine) engine.placeBid(socket.user.id, bid);
        });

        socket.on("chooseTrump", ({ tableId, suit }) => {
            const engine = gameService.getEngineById(tableId);
            if (engine) engine.chooseTrump(socket.user.id, suit);
        });

        socket.on("submitFrogDiscards", ({ tableId, discards }) => {
            const engine = gameService.getEngineById(tableId);
            if (engine) engine.submitFrogDiscards(socket.user.id, discards);
        });

        socket.on("requestNextRound", ({ tableId }) => {
            const engine = gameService.getEngineById(tableId);
            if (engine) engine.requestNextRound(socket.user.id);
        });
        
        socket.on("forfeitGame", ({ tableId }) => {
            const engine = gameService.getEngineById(tableId);
            if (engine) engine.forfeitGame(socket.user.id);
        });
        
        socket.on("resetGame", async ({ tableId }) => {
            const engine = gameService.getEngineById(tableId);
            if (engine) await engine.reset();
        });

        socket.on("updateInsuranceSetting", ({ tableId, settingType, value }) => {
            const engine = gameService.getEngineById(tableId);
            if (engine) engine.updateInsuranceSetting(socket.user.id, settingType, value);
        });

        socket.on("startTimeoutClock", ({ tableId, targetPlayerName }) => {
            const engine = gameService.getEngineById(tableId);
            if (engine) engine.startForfeitTimer(socket.user.id, targetPlayerName);
        });

        socket.on("requestDraw", ({ tableId }) => {
            const engine = gameService.getEngineById(tableId);
            if (engine) engine.requestDraw(socket.user.id);
        });
        
        socket.on("submitDrawVote", ({ tableId, vote }) => {
            const engine = gameService.getEngineById(tableId);
            if (engine) engine.submitDrawVote(socket.user.id, vote);
        });


        // --- USER & DISCONNECT LOGIC ---
        // (These do not need the gameService as they interact directly with DB/players)
        socket.on("requestUserSync", async () => { /* ... unchanged ... */ });
        socket.on("requestFreeToken", async () => { /* ... unchanged ... */ });
        socket.on("disconnect", async () => { /* ... unchanged, but uses gameService now ... */
            const enginePlayerIsOn = Object.values(gameService.getAllEngines()).find(e => e.players[socket.user.id]);
            if (enginePlayerIsOn) {
                enginePlayerIsOn.disconnectPlayer(socket.user.id);
            }
        });
    });
};

module.exports = registerGameHandlers;