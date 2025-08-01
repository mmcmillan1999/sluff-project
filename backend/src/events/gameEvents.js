// backend/src/events/gameEvents.js

const jwt = require("jsonwebtoken");
const transactionManager = require('../data/transactionManager');

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
            gameService.pool.query("SELECT SUM(amount) AS tokens FROM transactions WHERE user_id = $1", [socket.user.id])
                .then(tokenResult => {
                    const tokens = parseFloat(tokenResult.rows[0].tokens || 0).toFixed(2);
                    engine.reconnectPlayer(socket.user.id, socket, tokens);
                    gameService.io.to(engine.tableId).emit('gameState', engine.getStateForClient());
                })
                .catch(err => console.error("Error fetching tokens on reconnect:", err));
        }
        
        socket.emit("lobbyState", gameService.getLobbyState());

        socket.on("hardResetServer", async () => {
            if (socket.user.is_admin) {
                console.log(`[ADMIN] Hard reset initiated by ${socket.user.username}.`);
                try {
                    const pool = gameService.pool;
                    const query = `INSERT INTO lobby_chat_messages (user_id, username, message) VALUES ($1, $2, $3)`;
                    await pool.query(query, [socket.user.id, 'System', 'The server is being reset by an administrator.']);
                    io.emit('new_lobby_message', { id: Date.now(), username: 'System', message: 'The server is being reset by an administrator.' });
                } catch (error) {
                    console.error("Failed to post server reset message to chat:", error);
                }
                gameService.resetAllEngines();
                socket.emit("notification", { message: "Server reset successfully initiated." });
                setTimeout(() => {
                    io.emit('forceDisconnectAndReset', 'The server has been reset. Please log in again.');
                    io.disconnectSockets(true);
                }, 500);
            } else {
                console.warn(`[SECURITY] FAILED hard reset attempt by non-admin user: ${socket.user.username}`);
                return socket.emit("error", { message: "Admin privileges required." });
            }
        });

        socket.on("joinTable", async ({ tableId }) => {
            const engineToJoin = gameService.getEngineById(tableId);
            if (!engineToJoin) return socket.emit("error", { message: "Table not found." });
            
            try {
                const tokenResult = await gameService.pool.query("SELECT SUM(amount) AS tokens FROM transactions WHERE user_id = $1", [socket.user.id]);
                const tokens = parseFloat(tokenResult.rows[0].tokens || 0).toFixed(2);

                const previousEngine = Object.values(gameService.getAllEngines()).find(e => e.players[socket.user.id] && e.tableId !== tableId);
                if (previousEngine) {
                    previousEngine.leaveTable(socket.user.id);
                    socket.leave(previousEngine.tableId);
                    gameService.io.to(previousEngine.tableId).emit('gameState', previousEngine.getStateForClient());
                }
                socket.join(tableId);
                engineToJoin.joinTable(socket.user, socket.id, tokens);
                socket.emit('joinedTable', { gameState: engineToJoin.getStateForClient() });
                gameService.io.to(tableId).emit('gameState', engineToJoin.getStateForClient());
                gameService.io.emit('lobbyState', gameService.getLobbyState());

            } catch(err) {
                 console.error(`Error fetching tokens for user ${socket.user.id} on join:`, err);
                 socket.emit("error", { message: "Could not retrieve your token balance." });
            }
        });

        socket.on("leaveTable", ({ tableId }) => {
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
        
        socket.on("startGame", ({tableId}) => gameService.startGame(tableId, socket.user.id));
        socket.on("playCard", ({tableId, card}) => gameService.playCard(tableId, socket.user.id, card));
        socket.on("dealCards", ({tableId}) => gameService.dealCards(tableId, socket.user.id));
        socket.on("placeBid", ({tableId, bid}) => gameService.placeBid(tableId, socket.user.id, bid));
        socket.on("chooseTrump", ({tableId, suit}) => gameService.chooseTrump(tableId, socket.user.id, suit));
        socket.on("submitFrogDiscards", ({tableId, discards}) => gameService.submitFrogDiscards(tableId, socket.user.id, discards));
        socket.on("requestNextRound", ({tableId}) => gameService.requestNextRound(tableId, socket.user.id));
        socket.on("submitDrawVote", ({tableId, vote}) => gameService.submitDrawVote(tableId, socket.user.id, vote)); // THE FIX

        // Non-effect handlers can still call the engine directly for simple synchronous changes.
        const createDirectHandler = (methodName) => (payload) => {
            const { tableId, ...args } = payload;
            const engine = gameService.getEngineById(tableId);
            if (engine && typeof engine[methodName] === 'function') {
                const methodArgs = Object.keys(args).length > 0 ? [socket.user.id, args] : [socket.user.id];
                engine[methodName](...methodArgs);
                gameService.io.to(tableId).emit('gameState', engine.getStateForClient());
                gameService.io.emit('lobbyState', gameService.getLobbyState());
            }
        };
        socket.on("removeBot", createDirectHandler('removeBot'));
        socket.on("forfeitGame", createDirectHandler('forfeitGame'));
        socket.on("resetGame", createDirectHandler('reset'));
        socket.on("updateInsuranceSetting", createDirectHandler('updateInsuranceSetting'));
        socket.on("startTimeoutClock", createDirectHandler('startTimeoutClock'));
        socket.on("requestDraw", createDirectHandler('requestDraw'));

        socket.on("requestUserSync", async () => {
            try {
                const pool = gameService.pool;
                const userQuery = "SELECT id, username, email, created_at, wins, losses, washes, is_admin FROM users WHERE id = $1";
                const userResult = await pool.query(userQuery, [socket.user.id]);
                const updatedUser = userResult.rows[0];
                if (updatedUser) {
                    const tokenQuery = "SELECT SUM(amount) AS current_tokens FROM transactions WHERE user_id = $1";
                    const tokenResult = await pool.query(tokenQuery, [socket.user.id]);
                    updatedUser.tokens = parseFloat(tokenResult.rows[0]?.current_tokens || 0).toFixed(2);
                    socket.emit("updateUser", updatedUser);
                }
            } catch(err) {
                console.error(`Error during user sync for user ${socket.user.id}:`, err);
            }
        });

        socket.on("requestFreeToken", async (data = {}) => {
            try {
                // Server-side validation of contemplation period
                const { contemplationStartTime } = data;
                if (!contemplationStartTime) {
                    return socket.emit("error", { message: "Invalid request. Please use the proper interface." });
                }
                
                const contemplationDuration = Date.now() - contemplationStartTime;
                const REQUIRED_CONTEMPLATION_TIME = 15000; // 15 seconds
                
                if (contemplationDuration < REQUIRED_CONTEMPLATION_TIME) {
                    const remainingTime = Math.ceil((REQUIRED_CONTEMPLATION_TIME - contemplationDuration) / 1000);
                    return socket.emit("error", { 
                        message: `Please contemplate your life choices for ${remainingTime} more seconds.`,
                        remainingTime 
                    });
                }

                // Use the new atomic mercy token handler
                const result = await transactionManager.handleMercyTokenRequest(gameService.pool, socket.user.id, socket.user.username);
                
                if (result.success) {
                    socket.emit("notification", { message: result.message });
                    socket.emit("requestUserSync");
                    
                    // Log successful mercy token for audit purposes
                    console.log(`🎁 Mercy token granted to ${socket.user.username} (ID: ${socket.user.id}). Balance: ${result.previousBalance.toFixed(2)} → ${result.newBalance.toFixed(2)}`);
                } else {
                    socket.emit("error", { 
                        message: result.error,
                        currentTokens: result.currentTokens,
                        timeLeft: result.timeLeft 
                    });
                    
                    // Log failed mercy token attempts for security monitoring
                    console.log(`⚠️ Mercy token denied for ${socket.user.username} (ID: ${socket.user.id}): ${result.error}`);
                }
            } catch (err) {
                console.error(`❌ Mercy token request error for user ${socket.user.id}:`, err);
                socket.emit("error", { message: "Could not process mercy token request. Please try again later." });
            }
        });

        socket.on("disconnect", async () => {
            console.log(`Socket disconnected: ${socket.user.username} (ID: ${socket.user.id}, Socket: ${socket.id})`);
            const enginePlayerIsOn = Object.values(gameService.getAllEngines()).find(e => e.players[socket.user.id]);
            if (enginePlayerIsOn) {
                enginePlayerIsOn.disconnectPlayer(socket.user.id);
                gameService.io.to(enginePlayerIsOn.tableId).emit('gameState', enginePlayerIsOn.getStateForClient());
            }
            try {
                const pool = gameService.pool;
                const logoutMsgQuery = `INSERT INTO lobby_chat_messages (user_id, username, message) VALUES ($1, $2, $3) RETURNING id, username, message, created_at;`;
                const msgValues = [socket.user.id, 'System', `${socket.user.username} has logged out.`];
                const { rows } = await pool.query(logoutMsgQuery, msgValues);
                io.emit('new_lobby_message', rows[0]);
            } catch (chatError) {
                console.error("Failed to post logout message to chat:", chatError);
            }
        });
    });
};

module.exports = registerGameHandlers;