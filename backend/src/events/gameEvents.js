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
            engine.reconnectPlayer(socket.user.id, socket);
            gameService.io.to(engine.tableId).emit('gameState', engine.getStateForClient());
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

        socket.on("joinTable", ({ tableId }) => {
            const engineToJoin = gameService.getEngineById(tableId);
            if (!engineToJoin) return socket.emit("error", { message: "Table not found." });
            const previousEngine = Object.values(gameService.getAllEngines()).find(e => e.players[socket.user.id] && e.tableId !== tableId);
            if (previousEngine) {
                previousEngine.leaveTable(socket.user.id);
                socket.leave(previousEngine.tableId);
                gameService.io.to(previousEngine.tableId).emit('gameState', previousEngine.getStateForClient());
            }
            socket.join(tableId);
            engineToJoin.joinTable(socket.user, socket.id);
            socket.emit('joinedTable', { gameState: engineToJoin.getStateForClient() });
            gameService.io.to(tableId).emit('gameState', engineToJoin.getStateForClient());
            gameService.io.emit('lobbyState', gameService.getLobbyState());
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
        
        // --- ALL HANDLERS NOW POINT TO THE SERVICE ---
        socket.on("startGame", ({tableId}) => gameService.startGame(tableId, socket.user.id));
        socket.on("playCard", ({tableId, card}) => gameService.playCard(tableId, socket.user.id, card));
        socket.on("dealCards", ({tableId}) => gameService.dealCards(tableId, socket.user.id));
        socket.on("placeBid", ({tableId, bid}) => gameService.placeBid(tableId, socket.user.id, bid));
        socket.on("chooseTrump", ({tableId, suit}) => gameService.chooseTrump(tableId, socket.user.id, suit));
        socket.on("submitFrogDiscards", ({tableId, discards}) => gameService.submitFrogDiscards(tableId, socket.user.id, discards));
        socket.on("requestNextRound", ({tableId}) => gameService.requestNextRound(tableId, socket.user.id));

        // --- NON-EFFECT HANDLERS (for now) ---
        const createDirectHandler = (methodName) => (payload) => {
            const { tableId, ...args } = payload;
            const engine = gameService.getEngineById(tableId);
            if (engine && typeof engine[methodName] === 'function') {
                const methodArgs = Object.keys(args).length > 0 ? [socket.user.id, args] : [socket.user.id];
                engine[methodName](...methodArgs);
                gameService.io.to(tableId).emit('gameState', engine.getStateForClient());
                gameService.io.emit('lobbyState', gameService.getLobbyState()); // Also update lobby
            }
        };
        socket.on("removeBot", createDirectHandler('removeBot'));
        socket.on("forfeitGame", createDirectHandler('forfeitGame'));
        socket.on("resetGame", createDirectHandler('reset'));
        socket.on("updateInsuranceSetting", createDirectHandler('updateInsuranceSetting'));
        socket.on("startTimeoutClock", createDirectHandler('startTimeoutClock'));
        socket.on("requestDraw", createDirectHandler('requestDraw'));
        socket.on("submitDrawVote", createDirectHandler('submitDrawVote'));

        // --- USER-SPECIFIC & MISC LISTENERS ---
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

        socket.on("requestFreeToken", async () => {
            try {
                const pool = gameService.pool;
                const tokenQuery = "SELECT SUM(amount) AS current_tokens FROM transactions WHERE user_id = $1";
                const tokenResult = await pool.query(tokenQuery, [socket.user.id]);
                const currentTokens = parseFloat(tokenResult.rows[0]?.current_tokens || 0);
                if (currentTokens >= 5) {
                    return socket.emit("error", { message: "Sorry, free tokens are only for players with fewer than 5 tokens." });
                }
                await transactionManager.postTransaction(pool, {
                    userId: socket.user.id, gameId: null, type: 'free_token_mercy', amount: 1,
                    description: 'Mercy token requested by user'
                });
                socket.emit("notification", { message: "1 free token has been added to your account!" });
                socket.emit("requestUserSync");
            } catch (err) {
                socket.emit("error", { message: "Could not grant token." });
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