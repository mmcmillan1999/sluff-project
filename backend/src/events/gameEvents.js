// backend/src/events/gameEvents.js

const jwt = require("jsonwebtoken");
const transactionManager = require('../data/transactionManager');
const { authorizeTableAction, isPlainObject, validators } = require('./socketActionGuard');
const { loadCurrentUserByTokenId } = require('../middleware/requireAuth');
const { playerProgressFields } = require('../services/tutorialProgress');

const DEFAULT_SOCKET_AUTH_REFRESH_INTERVAL_MS = 60_000;

function revokeTrustedAdminObserver(socket) {
    socket.data = socket.data || {};
    socket.data.trustedAdminObserver = false;
}

async function refreshSocketUserFromDatabase(socket, pool) {
    const currentUser = await loadCurrentUserByTokenId(pool, { id: socket.user?.id });
    if (!currentUser) {
        revokeTrustedAdminObserver(socket);
        return null;
    }

    socket.user = currentUser;
    if (currentUser.is_admin !== true) revokeTrustedAdminObserver(socket);
    return currentUser;
}

function emitRedactedStateForSocket(socket, gameService) {
    const engine = Object.values(gameService.getAllEngines()).find(candidate => {
        const player = candidate.players?.[socket.user?.id];
        return player?.socketId === socket.id;
    });
    if (!engine || typeof gameService.getStateForSocket !== 'function') return;

    const redactedState = gameService.getStateForSocket(engine, socket);
    if (redactedState) socket.emit('gameState', redactedState);
}

async function requireFreshSocketAdmin(
    socket,
    pool,
    denialMessage = 'Admin privileges required.',
    onPrivilegeRevoked,
) {
    const hadTrustedObserverAccess = socket.data?.trustedAdminObserver === true;
    const notifyRevocation = () => {
        if (hadTrustedObserverAccess && typeof onPrivilegeRevoked === 'function') onPrivilegeRevoked();
    };

    try {
        const currentUser = await refreshSocketUserFromDatabase(socket, pool);
        if (!currentUser) {
            notifyRevocation();
            socket.emit('error', { message: 'Authentication required.' });
            return false;
        }
        if (currentUser.is_admin !== true) {
            notifyRevocation();
            socket.emit('error', { message: denialMessage });
            return false;
        }
        return true;
    } catch (error) {
        revokeTrustedAdminObserver(socket);
        if (socket.user) socket.user = { ...socket.user, is_admin: false };
        notifyRevocation();
        console.error(`[SECURITY] Failed to refresh admin status for user ${socket.user?.id}:`, error);
        socket.emit('error', { message: 'Admin privileges could not be verified.' });
        return false;
    }
}

const registerGameHandlers = (io, gameService, options = {}) => {
    const configuredRefreshInterval = Number(options.socketAuthRefreshIntervalMs);
    const socketAuthRefreshIntervalMs = Number.isFinite(configuredRefreshInterval)
        && configuredRefreshInterval > 0
        ? configuredRefreshInterval
        : DEFAULT_SOCKET_AUTH_REFRESH_INTERVAL_MS;
    const scheduleInterval = options.setIntervalFn || setInterval;
    const cancelInterval = options.clearIntervalFn || clearInterval;
    const latestSocketIdByUser = new Map();

    io.use((socket, next) => {
        const token = socket.handshake?.auth?.token;
        if (!token) return next(new Error("Authentication error: No token provided."));
        jwt.verify(token, process.env.JWT_SECRET, async (err, tokenUser) => {
            if (err) return next(new Error("Authentication error: Invalid token."));
            try {
                const currentUser = await loadCurrentUserByTokenId(gameService.pool, tokenUser);
                if (!currentUser) {
                    return next(new Error("Authentication error: Account no longer exists."));
                }
                socket.user = currentUser;
                return next();
            } catch (databaseError) {
                console.error('Socket authentication database lookup failed:', databaseError);
                return next(new Error("Authentication error: Unable to verify account."));
            }
        });
    });

    io.on("connection", (socket) => {
        socket.data = socket.data || {};
        latestSocketIdByUser.set(String(socket.user.id), socket.id);
        console.log(`Socket connected: ${socket.user.username} (ID: ${socket.user.id}, Socket: ${socket.id})`);

        const isCurrentSocketController = () => (
            socket.connected !== false
            && io.sockets?.sockets?.get(socket.id) === socket
            && latestSocketIdByUser.get(String(socket.user.id)) === socket.id
        );

        const emitRedactedState = () => emitRedactedStateForSocket(socket, gameService);
        const requireFreshAdmin = denialMessage => requireFreshSocketAdmin(
            socket,
            gameService.pool,
            denialMessage,
            emitRedactedState,
        );
        let socketIdentityRefreshStopped = false;
        let socketIdentityRefreshInFlight = false;

        const refreshConnectedSocketIdentity = async () => {
            if (socketIdentityRefreshStopped || socketIdentityRefreshInFlight) return;
            socketIdentityRefreshInFlight = true;
            const hadTrustedObserverAccess = socket.data.trustedAdminObserver === true;

            try {
                const currentUser = await refreshSocketUserFromDatabase(socket, gameService.pool);
                if (socketIdentityRefreshStopped) return;

                if (!currentUser) {
                    if (hadTrustedObserverAccess) emitRedactedState();
                    socket.emit('error', { message: 'Authentication required.' });
                    if (typeof socket.disconnect === 'function') socket.disconnect(true);
                    return;
                }

                if (hadTrustedObserverAccess && currentUser.is_admin !== true) emitRedactedState();
            } catch (error) {
                if (socketIdentityRefreshStopped) return;
                revokeTrustedAdminObserver(socket);
                if (socket.user) socket.user = { ...socket.user, is_admin: false };
                if (hadTrustedObserverAccess) emitRedactedState();
                console.error(`[SECURITY] Periodic identity refresh failed for user ${socket.user?.id}:`, error);
            } finally {
                socketIdentityRefreshInFlight = false;
            }
        };

        // Bound the lifetime of cached socket identity without adding a database
        // query to every gameplay event. Production revocation latency is at most
        // one refresh interval (60 seconds by default).
        const socketIdentityRefreshTimer = scheduleInterval(
            refreshConnectedSocketIdentity,
            socketAuthRefreshIntervalMs,
        );
        socketIdentityRefreshTimer?.unref?.();

        // Reconnection: if this user still holds a seat at any table, put them back
        // on it deterministically. This runs on every (re)connect — full reload or a
        // dropped-socket auto-reconnect — and is what lets a player return to their
        // table after closing/backgrounding the app. It must NOT depend on the old
        // socket's 'disconnect' having been processed, nor on the async token query.
        const engine = Object.values(gameService.getAllEngines()).find(e => e.players[socket.user.id]);
        if (engine) {
            socket.join(engine.tableId);                       // (1) so broadcasts reach this socket
            engine.reconnectPlayer(socket.user.id, socket);    // (2) adopt new socket id, clear forfeit
            socket.data.trustedAdminObserver = socket.user.is_admin === true
                && engine.players[socket.user.id]?.isSpectator === true
                && engine.players[socket.user.id]?.wasExplicitSpectator === true;
            gameService.emitGameState(engine.tableId);         // (3) push personalized state now
            gameService.evaluateTerminalCleanup(engine.tableId);

            // Best-effort token-balance refresh — never gates the rejoin above.
            gameService.pool.query("SELECT SUM(amount) AS tokens FROM transactions WHERE user_id = $1", [socket.user.id])
                .then(tokenResult => {
                    const player = engine.players[socket.user.id];
                    if (!player) return;
                    player.tokens = parseFloat(tokenResult.rows[0].tokens || 0).toFixed(2);
                    gameService.emitGameState(engine.tableId);
                })
                .catch(err => console.error("Error refreshing tokens on reconnect:", err));
        }
        
        socket.emit("lobbyState", gameService.getLobbyState());

        const onTableAction = (eventName, options, handler) => {
            socket.on(eventName, async (payload) => {
                if (options.adminOnly && !(await requireFreshAdmin())) return;
                const context = authorizeTableAction(socket, gameService, payload, options);
                if (!context) return;
                try {
                    await handler(context);
                } catch (error) {
                    console.error(`[SOCKET] ${eventName} failed for user ${socket.user.id}:`, error);
                    socket.emit('error', { message: 'The action could not be completed.' });
                }
            });
        };

        socket.on("hardResetServer", async () => {
            if (!(await requireFreshAdmin())) {
                console.warn(`[SECURITY] FAILED hard reset attempt by non-admin user: ${socket.user?.username}`);
                return;
            }

            const rejectWhileGameIsActive = () => {
                if (!gameService.hasActiveOrPendingGame()) return false;
                socket.emit('error', {
                    message: 'A game start or settlement is still committing, or a game is still active. Wait for its normal table reset before resetting the server.',
                });
                return true;
            };
            if (rejectWhileGameIsActive()) return;

            console.log(`[ADMIN] Hard reset initiated by ${socket.user.username}.`);
            // Keep this second check immediately adjacent to the reset. No
            // asynchronous work may open a new commit window between them.
            if (rejectWhileGameIsActive()) return;
            gameService.resetAllEngines();
            io.emit('forceDisconnectAndReset', 'The server has been reset. Please log in again.');
            io.disconnectSockets(true);

            try {
                const pool = gameService.pool;
                const query = `INSERT INTO lobby_chat_messages (user_id, username, message) VALUES ($1, $2, $3)`;
                await pool.query(query, [socket.user.id, 'System', 'The server is being reset by an administrator.']);
                io.emit('new_lobby_message', { id: Date.now(), username: 'System', message: 'The server is being reset by an administrator.' });
            } catch (error) {
                console.error("Failed to post server reset message to chat:", error);
            }
        });

        const activeSeatIsLocked = (engine, player) => (
            !!engine
            && !!player
            && !player.isSpectator
            && (engine.gameStarted || engine.gameStartPending)
            && !['Game Over', 'DrawComplete'].includes(engine.state)
        );
        const findSeatEngines = () => Object.values(gameService.getAllEngines())
            .filter(candidate => candidate.players[socket.user.id]);
        const hasSeatControlledByAnotherSocket = () => findSeatEngines().some(candidate => {
            const player = candidate.players[socket.user.id];
            return !!player?.socketId && player.socketId !== socket.id;
        });
        const readTokenBalance = async () => {
            const tokenResult = await gameService.pool.query(
                "SELECT SUM(amount) AS tokens FROM transactions WHERE user_id = $1",
                [socket.user.id],
            );
            return parseFloat(tokenResult.rows[0]?.tokens || 0).toFixed(2);
        };

        // Shared fixed-table seating flow. Quick Play uses a separate path so
        // its target is selected only after this asynchronous balance read.
        const seatUserAtTable = async (engineToJoin, asSpectator = false) => {
            const tableId = engineToJoin.tableId;
            const existingPlayer = engineToJoin.players[socket.user.id];
            if (asSpectator && activeSeatIsLocked(engineToJoin, existingPlayer)) {
                throw new Error('An active player cannot switch to spectator mode during a game.');
            }
            const findOtherSeatEngines = () => findSeatEngines()
                .filter(candidate => candidate.tableId !== tableId);
            const previousEngines = findOtherSeatEngines();
            if (previousEngines.some(engine => activeSeatIsLocked(engine, engine.players[socket.user.id]))) {
                throw new Error('You cannot join another table while your current game is active.');
            }
            const tokens = await readTokenBalance();
            if (!isCurrentSocketController() || hasSeatControlledByAnotherSocket()) return false;

            // Observer mode is an admin capability. Refresh it after the balance
            // read so no stale JWT claim survives into the seating mutation.
            if (asSpectator && !(await requireFreshAdmin(
                'Only administrators can request observer mode.',
            ))) return false;
            if (!isCurrentSocketController() || hasSeatControlledByAnotherSocket()) return false;

            // The balance read yields to PostgreSQL. Re-check both seats after
            // it returns because another socket may have requested a start in
            // that window, freezing the roster we are about to mutate.
            const currentExistingPlayer = engineToJoin.players[socket.user.id];
            if (asSpectator && activeSeatIsLocked(engineToJoin, currentExistingPlayer)) {
                throw new Error('An active player cannot switch to spectator mode during a game.');
            }
            // Search globally again instead of trusting the pre-await pointer.
            // Concurrent joins can both begin with no previous seat; the first
            // continuation to resume must become visible to the second one.
            const currentPreviousEngines = findOtherSeatEngines();
            if (currentPreviousEngines.some(engine => activeSeatIsLocked(engine, engine.players[socket.user.id]))) {
                throw new Error('You cannot join another table while your current game is active.');
            }
            if (engineToJoin.tableType === 'quickplay'
                && !currentExistingPlayer
                && !gameService.canAcceptQuickPlayHuman(engineToJoin)) {
                throw new Error('That Quick Play seat is no longer available.');
            }

            for (const previousEngine of currentPreviousEngines) {
                previousEngine.leaveTable(socket.user.id);
                socket.leave(previousEngine.tableId);
                gameService.emitGameState(previousEngine.tableId);
                if (previousEngine.tableType === 'quickplay') gameService.evaluateQuickPlayTable(previousEngine.tableId);
                gameService.evaluateTerminalCleanup(previousEngine.tableId);
            }
            socket.join(tableId);

            engineToJoin.joinTable(socket.user, socket.id, tokens, asSpectator);

            const joinedPlayer = engineToJoin.players[socket.user.id];
            if (engineToJoin.tableType === 'quickplay'
                && !asSpectator
                && (!joinedPlayer || joinedPlayer.isSpectator || !engineToJoin.playerOrder.includes(socket.user.id))) {
                if (joinedPlayer?.isSpectator && !engineToJoin.gameStarted && !engineToJoin.gameStartPending) {
                    delete engineToJoin.players[socket.user.id];
                }
                throw new Error('That Quick Play seat is no longer available.');
            }
            if (asSpectator && socket.user.is_admin === true && joinedPlayer?.isSpectator) {
                joinedPlayer.wasExplicitSpectator = true;
                socket.data.trustedAdminObserver = true;
            } else {
                socket.data.trustedAdminObserver = false;
            }

            socket.emit('joinedTable', { gameState: gameService.getStateForSocket(engineToJoin, socket) });
            gameService.emitGameState(tableId);
            gameService.evaluateTerminalCleanup(tableId);
            gameService.io.emit('lobbyState', gameService.getLobbyState());
            return true;
        };

        socket.on("joinTable", async (payload) => {
            if (!isPlainObject(payload) || typeof payload.tableId !== 'string' || (payload.asSpectator !== undefined && typeof payload.asSpectator !== 'boolean')) {
                return socket.emit('error', { message: 'Invalid join request.' });
            }
            const { tableId, asSpectator = false } = payload;
            if (asSpectator) {
                console.log(`[ADMIN] User ${socket.user.username} joining table ${tableId} as spectator`);
            }

            const engineToJoin = gameService.getEngineById(tableId);
            if (!engineToJoin) return socket.emit("error", { message: "Table not found." });

            try {
                const joined = await seatUserAtTable(engineToJoin, asSpectator);
                if (!joined) return;

                if (asSpectator) {
                    const finalPlayer = engineToJoin.players[socket.user.id];
                    console.log(`[ADMIN] Spectator join result: isSpectator=${finalPlayer?.isSpectator}, inPlayerOrder=${engineToJoin.playerOrder.includes(socket.user.id)}`);
                }
                // Joining a quick-play table via an invite link still counts.
                if (engineToJoin.tableType === 'quickplay') gameService.evaluateQuickPlayTable(tableId);

            } catch(err) {
                 console.error(`Error fetching tokens for user ${socket.user.id} on join:`, err);
                 const message = err.message?.includes('cannot switch to spectator') || err.message?.includes('cannot join another table')
                    ? err.message
                    : "Could not retrieve your token balance.";
                 socket.emit("error", { message });
            }
        });

        // Quick Play: complete I/O first, then select and claim a live target
        // without another await. Losing concurrent fourth players are matched
        // into another eligible table instead of falling through as spectators.
        socket.on("quickPlay", async (payload) => {
            if (!isPlainObject(payload) || typeof payload.theme !== 'string') {
                return socket.emit('error', { message: 'Invalid quick play request.' });
            }
            const { theme } = payload;
            try {
                const tokens = await readTokenBalance();
                // Balance I/O yields. A disconnect or replacement connection in
                // that window revokes this continuation before it can create a
                // ghost seat or overwrite the replacement controller's socket.
                if (!isCurrentSocketController() || hasSeatControlledByAnotherSocket()) return;
                const occupiedEngines = findSeatEngines();
                if (occupiedEngines.some(candidate => activeSeatIsLocked(candidate, candidate.players[socket.user.id]))) {
                    throw new Error('You cannot join another table while your current game is active.');
                }

                const engineToJoin = gameService.claimQuickPlaySeat(
                    theme,
                    socket.user,
                    socket.id,
                    tokens,
                );
                if (!engineToJoin) {
                    socket.emit('error', {
                        message: 'Every Quick Play table changed while you were joining. Your current seat is safe; tap Play Now to try again.',
                    });
                    return;
                }

                // Claim succeeds synchronously before releasing any old
                // waiting-room seat. If every matchmaking table is busy, the
                // retry response leaves the user exactly where they were.
                for (const previousEngine of occupiedEngines) {
                    if (previousEngine === engineToJoin) continue;
                    previousEngine.leaveTable(socket.user.id);
                    socket.leave(previousEngine.tableId);
                    gameService.emitGameState(previousEngine.tableId);
                    if (previousEngine.tableType === 'quickplay') {
                        gameService.evaluateQuickPlayTable(previousEngine.tableId);
                    }
                    gameService.evaluateTerminalCleanup(previousEngine.tableId);
                }

                socket.join(engineToJoin.tableId);
                socket.data.trustedAdminObserver = false;
                socket.emit('joinedTable', { gameState: gameService.getStateForSocket(engineToJoin, socket) });
                gameService.emitGameState(engineToJoin.tableId);
                gameService.evaluateTerminalCleanup(engineToJoin.tableId);
                gameService.io.emit('lobbyState', gameService.getLobbyState());
            } catch(err) {
                console.error(`Error in quickPlay for user ${socket.user.id}:`, err);
                const message = err.message?.includes('cannot join another table')
                    ? err.message
                    : 'Could not join Quick Play right now.';
                socket.emit("error", { message });
            }
        });

        onTableAction("leaveTable", { allowSpectator: true }, async ({ engine: engineToLeave, payload: { tableId } }) => {
            engineToLeave.leaveTable(socket.user.id);
            gameService.emitGameState(tableId);
            gameService.io.emit('lobbyState', gameService.getLobbyState());
            if (engineToLeave.tableType === 'quickplay') gameService.evaluateQuickPlayTable(tableId);
            gameService.evaluateTerminalCleanup(tableId);
            socket.leave(tableId);
            socket.data.trustedAdminObserver = false;
            socket.emit("lobbyState", gameService.getLobbyState());
        });

        onTableAction("moveToSpectator", {
            adminOnly: true,
            allowSpectator: true,
            validate: (_payload, { engine }) => (engine.gameStarted || engine.gameStartPending)
                ? 'Observer mode cannot be changed after a game start is requested.'
                : null,
        }, async ({ engine, payload: { tableId } }) => {
            console.log(`[ADMIN] ${socket.user.username} requesting move to spectator on table ${tableId}`);

            const existingPlayer = engine.players[socket.user.id];
            if (!existingPlayer) {
                return socket.emit("error", { message: "You are not at this table." });
            }

            if (existingPlayer.isSpectator) {
                return socket.emit("notification", { message: "You are already a spectator." });
            }

            console.log(`[ADMIN] BEFORE moveToSpectator - Player ${socket.user.username}:`);
            console.log(`[ADMIN]   - isSpectator: ${existingPlayer.isSpectator}`);
            console.log(`[ADMIN]   - inPlayerOrder: ${engine.playerOrder.includes(socket.user.id)}`);
            console.log(`[ADMIN]   - playerOrder.allIds: [${engine.playerOrder.allIds.join(', ')}]`);
            console.log(`[ADMIN]   - playerOrder.count: ${engine.playerOrder.count}`);
            console.log(`[ADMIN]   - gameStarted: ${engine.gameStarted}`);

            // Convert player to spectator
            engine.players[socket.user.id].isSpectator = true;
            engine.players[socket.user.id].wasExplicitSpectator = true; // Mark as explicitly chosen spectator
            delete engine.scores[existingPlayer.playerName];
            socket.data.trustedAdminObserver = true;
            console.log(`[ADMIN] Set isSpectator to true for ${socket.user.username}`);
            
            // Remove from player order
            if (engine.playerOrder.includes(socket.user.id)) {
                console.log(`[ADMIN] Removing ${socket.user.username} from playerOrder`);
                engine.playerOrder.remove(socket.user.id);
                console.log(`[ADMIN] After removal - playerOrder.allIds: [${engine.playerOrder.allIds.join(', ')}]`);
                console.log(`[ADMIN] After removal - playerOrder.count: ${engine.playerOrder.count}`);
            } else {
                console.log(`[ADMIN] Player ${socket.user.username} was NOT in playerOrder`);
            }

            // Update game state based on remaining players
            if (!engine.gameStarted) {
                const activePlayersCount = engine.playerOrder.count;
                const oldState = engine.state;
                engine.state = (activePlayersCount >= 3) ? "Ready to Start" : "Waiting for Players";
                console.log(`[ADMIN] Game state changed from '${oldState}' to '${engine.state}' (active players: ${activePlayersCount})`);
            }

            console.log(`[ADMIN] AFTER moveToSpectator - Player ${socket.user.username}:`);
            console.log(`[ADMIN]   - isSpectator: ${engine.players[socket.user.id].isSpectator}`);
            console.log(`[ADMIN]   - inPlayerOrder: ${engine.playerOrder.includes(socket.user.id)}`);
            console.log(`[ADMIN]   - playerOrder.allIds: [${engine.playerOrder.allIds.join(', ')}]`);
            console.log(`[ADMIN]   - playerOrder.count: ${engine.playerOrder.count}`);

            // Get the state that will be sent to clients
            const stateForClient = gameService.getStateForSocket(engine, socket);
            console.log(`[ADMIN] State being sent to clients:`);
            console.log(`[ADMIN]   - playerOrderActive: [${stateForClient.playerOrderActive.join(', ')}]`);
            console.log(`[ADMIN]   - players[${socket.user.id}].isSpectator: ${stateForClient.players[socket.user.id]?.isSpectator}`);
            console.log(`[ADMIN]   - players[${socket.user.id}].playerName: ${stateForClient.players[socket.user.id]?.playerName}`);

            console.log(`[ADMIN] Successfully converted ${socket.user.username} to spectator. Active players: ${engine.playerOrder.count}`);

            // Emit updated state
            gameService.emitGameState(tableId);
            gameService.io.emit('lobbyState', gameService.getLobbyState());
            if (engine.tableType === 'quickplay') gameService.evaluateQuickPlayTable(tableId);
            
            socket.emit("notification", { message: "You are now a spectator." });
        });

        // Bots are quick-play-only for regular players (the matchmaker seats
        // them). Manual bot management remains as an admin testing tool.
        onTableAction("addBot", {
            adminOnly: true,
            allowSpectator: true,
            validate: (_payload, { engine }) => engine.gameStarted ? 'Bots cannot be added during a game.' : null,
        }, async ({ engine, payload }) => {
            engine.addBotPlayer(payload.name || 'Lee');
            gameService.emitGameState(engine.tableId);
            gameService.io.emit('lobbyState', gameService.getLobbyState());
            if (engine.tableType === 'quickplay') gameService.evaluateQuickPlayTable(engine.tableId);
        });
        
        onTableAction("startGame", {}, ({ payload: { tableId } }) => gameService.startGame(tableId, socket.user.id));
        onTableAction("quickPlayDecision", {
            validate: payload => (
                ['start3', 'seek4', 'start4'].includes(payload.choice)
                && Number.isSafeInteger(payload.generation)
                && payload.generation >= 0
            ) ? null : 'Invalid Quick Play decision.',
        }, ({ engine, payload: { choice, generation } }) => {
            const result = gameService.quickPlayDecision(
                engine.tableId,
                socket.user.id,
                choice,
                generation,
            );
            if (!result.accepted) {
                socket.emit('quickPlayDecisionRejected', {
                    message: 'That Quick Play choice is no longer available.',
                    qpPhase: engine.qpPhase,
                    qpGeneration: engine.qpGeneration,
                });
            }
        });
        onTableAction("playCard", { validate: validators.card }, ({ payload: { tableId, card } }) => gameService.playCard(tableId, socket.user.id, card));
        onTableAction("dealCards", {}, ({ payload: { tableId } }) => gameService.dealCards(tableId, socket.user.id));
        onTableAction("placeBid", { validate: validators.bid }, ({ payload: { tableId, bid } }) => gameService.placeBid(tableId, socket.user.id, bid));
        onTableAction("chooseTrump", { validate: validators.trump }, ({ payload: { tableId, suit } }) => gameService.chooseTrump(tableId, socket.user.id, suit));
        onTableAction("submitFrogDiscards", { validate: validators.frogDiscards }, ({ payload: { tableId, discards } }) => (
            gameService.submitFrogDiscards(tableId, socket.user.id, discards)
        ));
        onTableAction("ackRoundPresentation", {
            validate: validators.presentationAck,
        }, ({ engine, payload: { tableId, presentationReadyAt } }) => {
            const result = gameService.ackRoundPresentation(
                tableId,
                socket.user.id,
                presentationReadyAt,
                socket.id,
            );
            if (result.accepted) {
                socket.emit('roundPresentationAcknowledged', result);
                return;
            }
            socket.emit('roundPresentationAckRejected', {
                reason: result.reason,
                presentationReadyAt: engine.roundSummary?.presentationReadyAt ?? null,
            });
        });
        onTableAction("requestNextRound", {
            validate: validators.roundAdvance,
        }, ({ payload: { tableId } }) => gameService.requestNextRound(tableId, socket.user.id));
        onTableAction("submitDrawVote", { validate: validators.drawVote }, ({ payload: { tableId, vote } }) => (
            gameService.submitDrawVote(tableId, socket.user.id, vote)
        ));
        onTableAction("forfeitGame", {}, ({ payload: { tableId } }) => gameService.forfeitGame(tableId, socket.user.id));
        onTableAction("updateInsuranceSetting", { validate: validators.insurance }, ({ payload: { tableId, settingType, value } }) => (
            gameService.updateInsuranceSetting(tableId, socket.user.id, settingType, value)
        ));
        onTableAction("startTimeoutClock", { validate: validators.targetPlayer }, ({ payload: { tableId, targetPlayerName } }) => (
            gameService.startForfeitTimer(tableId, socket.user.id, targetPlayerName)
        ));
        onTableAction("requestDraw", {}, ({ payload: { tableId } }) => gameService.requestDraw(tableId, socket.user.id));
        onTableAction("resetGame", {
            validate: validators.terminalReset,
        }, ({ payload: { tableId } }) => gameService.resetGame(tableId));
        onTableAction("removeBot", { adminOnly: true, allowSpectator: true }, async ({ engine }) => {
            engine.removeBot();
            gameService.emitGameState(engine.tableId);
            gameService.io.emit('lobbyState', gameService.getLobbyState());
            if (engine.tableType === 'quickplay') gameService.evaluateQuickPlayTable(engine.tableId);
        });
        
        // Admin spectator start game handler
        onTableAction("startGameAsBot", {
            adminOnly: true,
            allowSpectator: true,
            validate: payload => Number.isInteger(Number(payload.botPlayerId)) ? null : 'Invalid bot player.',
        }, ({ engine, payload: { tableId, botPlayerId } }) => {
            // Verify the bot exists and is a player
            const botPlayer = engine.players[botPlayerId];
            if (!botPlayer || !botPlayer.isBot || botPlayer.isSpectator) {
                return socket.emit("error", { message: "Invalid bot player." });
            }
            
            console.log(`[ADMIN] Starting game via bot ${botPlayer.playerName} (ID: ${botPlayerId})`);
            return gameService.startGame(tableId, botPlayerId);
        });

        socket.on("requestUserSync", async () => {
            const hadTrustedObserverAccess = socket.data.trustedAdminObserver === true;
            try {
                const pool = gameService.pool;
                const userQuery = `
                    SELECT id, username, email, created_at, wins, losses, washes,
                           is_admin, is_vip, tutorial_version, tutorial_active_version
                    FROM users
                    WHERE id = $1
                `;
                const userResult = await pool.query(userQuery, [socket.user.id]);
                const updatedUser = userResult.rows[0];
                if (updatedUser) {
                    const tokenQuery = "SELECT COALESCE(SUM(amount), 0) AS current_tokens FROM transactions WHERE user_id = $1";
                    const tokenResult = await pool.query(tokenQuery, [socket.user.id]);
                    updatedUser.tokens = parseFloat(tokenResult.rows[0]?.current_tokens || 0).toFixed(2);
                    Object.assign(updatedUser, playerProgressFields(updatedUser));
                    
                    // Keep the live socket identity canonical and revoke observer
                    // trust immediately if this refresh observes an admin demotion.
                    socket.user = {
                        id: updatedUser.id,
                        username: updatedUser.username,
                        is_admin: updatedUser.is_admin === true,
                    };
                    if (socket.user.is_admin !== true) {
                        revokeTrustedAdminObserver(socket);
                        if (hadTrustedObserverAccess) emitRedactedState();
                    }
                    console.log(`[DEBUG] User sync - ${updatedUser.username} admin status: ${updatedUser.is_admin}`);
                    
                    socket.emit("updateUser", updatedUser);
                } else {
                    revokeTrustedAdminObserver(socket);
                    if (hadTrustedObserverAccess) emitRedactedState();
                    socket.emit('error', { message: 'Authentication required.' });
                }
            } catch(err) {
                revokeTrustedAdminObserver(socket);
                if (socket.user) socket.user = { ...socket.user, is_admin: false };
                if (hadTrustedObserverAccess) emitRedactedState();
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

        socket.on("startBotGame", async (payload = {}) => {
            if (!isPlainObject(payload)) {
                return socket.emit('error', { message: 'Invalid bot game request.' });
            }
            const { botCount = 3 } = payload;
            if (!Number.isInteger(Number(botCount)) || Number(botCount) < 1 || Number(botCount) > 3) {
                return socket.emit('error', { message: 'Invalid bot count.' });
            }
            if (!(await requireFreshAdmin(
                'Only admins can start bot-only games.',
            ))) return;
            console.log(`[ADMIN] startBotGame event received from ${socket.user.username}`);

            try {
                // Find the table the admin is currently on
                let botEngine = Object.values(gameService.getAllEngines()).find(engine => 
                    engine.players[socket.user.id] !== undefined
                );

                if (!botEngine) {
                    return socket.emit("error", { message: "You must be at a table to start a bot game." });
                }

                console.log(`[ADMIN] Starting bot game on current table: ${botEngine.tableId}`);

                // First, check if admin is already at the table as a player
                const existingPlayer = Object.values(botEngine.players).find(p => p.userId === socket.user.id);
                console.log(`[ADMIN] Existing player check:`, existingPlayer ? `Found as ${existingPlayer.playerName}` : 'Not found');
                if (existingPlayer && existingPlayer.socketId !== socket.id) {
                    return socket.emit("error", { message: "This connection no longer controls that table seat." });
                }
                
                // If admin is already a spectator, we just need to ensure we have 3 bots
                if (existingPlayer && existingPlayer.isSpectator) {
                    console.log(`[ADMIN] Admin is already a spectator`);
                } else if (existingPlayer && !existingPlayer.isSpectator) {
                    // Admin needs to be moved to spectator
                    return socket.emit("error", { message: "Please use 'Move to Spectator' first before starting bot game." });
                }
                
                // Count current non-spectator players (excluding the admin spectator)
                const currentPlayers = Object.values(botEngine.players).filter(p => !p.isSpectator);
                const currentPlayerCount = currentPlayers.length;
                const currentBotCount = currentPlayers.filter(p => p.isBot).length;
                const botsNeeded = 3 - currentPlayerCount;
                
                console.log(`[ADMIN] Current player count: ${currentPlayerCount}, bots needed: ${botsNeeded}`);
                
                for (let i = 0; i < botsNeeded; i++) {
                    botEngine.addBotPlayer();
                    console.log(`[ADMIN] Added bot ${i + 1} of ${botsNeeded}`);
                }
                
                // If admin isn't at the table yet, they need to join first
                if (!existingPlayer) {
                    return socket.emit("error", { message: "You must be at the table to start a bot game." });
                }

                // Verify we have exactly 3 bot players
                const finalPlayers = Object.values(botEngine.players).filter(p => !p.isSpectator);
                const finalPlayerCount = finalPlayers.length;
                console.log(`[ADMIN] Final player count: ${finalPlayerCount}`);
                console.log(`[ADMIN] Players:`, Object.entries(botEngine.players).map(([id, p]) => 
                    `${p.playerName} (${p.isSpectator ? 'spectator' : 'player'})`
                ).join(', '));
                
                if (finalPlayerCount === 3 && finalPlayers.every(p => p.isBot)) {
                    console.log(`[ADMIN] Starting game with 3 bots`);
                    // Get a bot player to start the game
                    const botPlayer = finalPlayers[0];
                    if (botPlayer) {
                        console.log(`[ADMIN] Using bot ${botPlayer.playerName} (ID: ${botPlayer.userId}) to start game`);
                        console.log(`[ADMIN] Table details - ID: ${botEngine.tableId}, Name: ${botEngine.tableName}, Theme: ${botEngine.theme}`);
                        const startResult = botEngine.startGame(botPlayer.userId);
                        console.log(`[ADMIN] Start game result:`, startResult);
                        if (startResult && startResult.effects) {
                            console.log(`[ADMIN] Executing ${startResult.effects.length} effects`);
                            // Execute the start game effects
                            await gameService._executeEffects(botEngine.tableId, startResult.effects);
                        } else {
                            console.log(`[ADMIN] WARNING: No effects returned from startGame`);
                        }
                    }
                } else {
                    console.log(`[ADMIN] Cannot start - need exactly 3 bot players, have ${finalPlayerCount} players`);
                    socket.emit("error", { message: `Need exactly 3 bots. Currently have ${finalPlayerCount} players.` });
                }

                // Always emit updated state
                gameService.emitGameState(botEngine.tableId);
                gameService.io.emit('lobbyState', gameService.getLobbyState());

                console.log(`[ADMIN] Bot game setup complete`);
            } catch (err) {
                console.error("Error starting bot game:", err);
                socket.emit("error", { message: "Failed to start bot game." });
            }
        });

        socket.on("disconnect", async () => {
            socketIdentityRefreshStopped = true;
            cancelInterval(socketIdentityRefreshTimer);
            const socketUserKey = String(socket.user.id);
            let promotedFallbackSocket = null;
            if (latestSocketIdByUser.get(socketUserKey) === socket.id) {
                // A user may still have an older tab/connection alive. Promote
                // the newest remaining local socket so the safety guard recovers
                // instead of forcing that tab to reconnect before matchmaking.
                let fallbackSocketId = null;
                const connectedSockets = io.sockets?.sockets;
                if (connectedSockets && typeof connectedSockets.values === 'function') {
                    for (const candidate of connectedSockets.values()) {
                        if (candidate.id !== socket.id
                            && candidate.connected !== false
                            && String(candidate.user?.id) === socketUserKey) {
                            fallbackSocketId = candidate.id;
                            promotedFallbackSocket = candidate;
                        }
                    }
                }
                if (fallbackSocketId) latestSocketIdByUser.set(socketUserKey, fallbackSocketId);
                else latestSocketIdByUser.delete(socketUserKey);
            }
            console.log(`Socket disconnected: ${socket.user.username} (ID: ${socket.user.id}, Socket: ${socket.id})`);
            const enginePlayerIsOn = Object.values(gameService.getAllEngines()).find(e => e.players[socket.user.id]);
            if (enginePlayerIsOn) {
                const player = enginePlayerIsOn.players[socket.user.id];
                // Only treat this as a real disconnect if it's still the player's
                // active socket. On a fast reload the replacement socket reconnects
                // first and takes over player.socketId; this older socket's late
                // 'disconnect' must be ignored, or it would mark the freshly
                // returned player offline again (the core intermittency bug).
                if (player && player.socketId === socket.id) {
                    if (promotedFallbackSocket) {
                        // The newest remaining authenticated connection becomes
                        // the live seat controller as well as the matchmaking
                        // controller. This keeps terminal recaps and active-game
                        // reconnect semantics aligned with the socket registry.
                        promotedFallbackSocket.join?.(enginePlayerIsOn.tableId);
                        enginePlayerIsOn.reconnectPlayer(socket.user.id, promotedFallbackSocket);
                        promotedFallbackSocket.data = promotedFallbackSocket.data || {};
                        promotedFallbackSocket.data.trustedAdminObserver = (
                            promotedFallbackSocket.user?.is_admin === true
                            && player.isSpectator === true
                            && player.wasExplicitSpectator === true
                        );
                    } else {
                        enginePlayerIsOn.disconnectPlayer(socket.user.id);
                    }
                    gameService.emitGameState(enginePlayerIsOn.tableId);
                    if (enginePlayerIsOn.tableType === 'quickplay') {
                        gameService.evaluateQuickPlayTable(enginePlayerIsOn.tableId);
                    }
                    gameService.evaluateTerminalCleanup(enginePlayerIsOn.tableId);
                }
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
module.exports.DEFAULT_SOCKET_AUTH_REFRESH_INTERVAL_MS = DEFAULT_SOCKET_AUTH_REFRESH_INTERVAL_MS;
module.exports.emitRedactedStateForSocket = emitRedactedStateForSocket;
module.exports.refreshSocketUserFromDatabase = refreshSocketUserFromDatabase;
module.exports.requireFreshSocketAdmin = requireFreshSocketAdmin;
