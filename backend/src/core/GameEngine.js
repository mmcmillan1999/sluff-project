// backend/src/core/GameEngine.js

const {
    SERVER_VERSION,
    BID_HIERARCHY,
    PLACEHOLDER_ID,
    deck,
    SUITS,
    BID_MULTIPLIERS,
    ROUND_PRESENTATION_ACK_GRACE_MS,
} = require('./constants');
const BotPlayer = require('./BotPlayer');
const { shuffle } = require('../utils/shuffle');
const playHandler = require('./handlers/playHandler');
const scoringHandler = require('./handlers/scoringHandler');
const PlayerList = require('./PlayerList');
const biddingHandler = require('./handlers/biddingHandler');
const { serializeGameState } = require('../serialization/gameStateSerializer');
const { createSettlementSnapshot } = require('../settlement/gameSettlement');

const BOT_NAMES = ["Mike Knight", "Grandma Joe", "Grampa Blane", "Kimba", "Courtney Sr.", "Cliff"];

class GameEngine {
    constructor(tableId, theme, tableName, emitLobbyUpdateCallback, tableType = 'private') {
        this.emitLobbyUpdateCallback = emitLobbyUpdateCallback || (() => {});

        this.tableId = tableId;
        this.tableName = tableName;
        this.theme = theme;
        // 'private' (browsable, invite links, humans only) or 'quickplay'
        // (hidden matchmaking pool, GameService fills seats with bots).
        this.tableType = tableType;
        // Quick Play is a server-owned state machine. The generation changes
        // at every decision/timer boundary so stale socket decisions and timer
        // callbacks cannot mutate a recycled table.
        this.qpPhase = tableType === 'quickplay' ? 'filling' : null;
        this.qpGeneration = 0;
        // Epoch-ms deadline while the table is explicitly seeking a fourth
        // human. This stays server-private; clients only receive the phase.
        this.qpWindowEndsAt = null;
        // Only the dedicated Quick Play fallback path may mark a bot for seat
        // four. The generation binding prevents generic/admin bot actions or a
        // stale matchmaking callback from authorizing a funded 4P start.
        this.qpFallbackBot = null;
        this.serverVersion = SERVER_VERSION;
        this.state = "Waiting for Players";
        this.players = {};
        this.playerOrder = new PlayerList();
        this.scores = {};
        this.gameStarted = false;
        this.gameStartPending = false;
        this.settlement = this._newSettlementState();
        this.gameId = null;
        this.playerMode = null;
        this.dealer = null;
        this.internalTimers = {};
        this.bots = {};
        this._nextBotId = -1;
        this.pendingBotAction = null;
        this._initializeNewRoundState();
    }

    _effects(a = []) { return { effects: a }; }

    _newSettlementState() {
        return { status: 'idle', kind: null, attempts: 0, lastErrorCode: null };
    }

    beginSettlement(kind) {
        this.settlement = { status: 'pending', kind, attempts: 0, lastErrorCode: null };
    }

    completeSettlement() {
        if (!this.settlement) this.settlement = this._newSettlementState();
        this.settlement.status = 'complete';
        this.settlement.lastErrorCode = null;
    }

    failSettlement(errorCode = 'SETTLEMENT_ERROR') {
        if (!this.settlement) this.settlement = this._newSettlementState();
        this.settlement.status = 'failed';
        this.settlement.lastErrorCode = errorCode;
    }

    _createSettlementSnapshot(extra = {}) {
        const players = Object.fromEntries(Object.entries(this.players).map(([id, player]) => [id, {
            userId: player.userId,
            playerName: player.playerName,
            isBot: player.isBot === true,
            isSpectator: player.isSpectator === true,
        }]));
        return createSettlementSnapshot({
            gameId: this.gameId,
            theme: this.theme,
            players,
            scores: { ...this.scores },
            seatingOrderIds: [...this.playerOrder.allIds],
            ...extra,
        });
    }
    
    // =================================================================
    // PUBLIC METHODS
    // =================================================================
    
    startForfeitTimer(requestingUserId, targetPlayerName) {
        const requester = this.players[requestingUserId];
        if (!this.gameStarted || !requester || requester.isSpectator || this.internalTimers.forfeit
            || ['Game Over', 'DrawComplete', 'Draw Resolving'].includes(this.state)) return this._effects();
        const targetPlayer = Object.values(this.players).find(p => p.playerName === targetPlayerName);
        if (!targetPlayer || targetPlayer.isSpectator || targetPlayer.isBot || !targetPlayer.disconnected || targetPlayer.userId === requestingUserId) {
            return this._effects();
        }
        console.log(`[${this.tableId}] Forfeit timer started for ${targetPlayerName} by ${this.players[requestingUserId].playerName}.`);
        this.forfeiture.targetPlayerName = targetPlayerName;
        this.forfeiture.timeLeft = 120;
        return this._effects([
            { type: 'BROADCAST_STATE' },
            { type: 'START_FORFEIT_TIMER', payload: { targetPlayerName } },
        ]);
    }

    forfeitGame(userId) {
        const player = this.players[userId];
        if (!player || player.isSpectator || !this.gameStarted) return this._effects();
        return this._effects(this._resolveForfeit(player.playerName, "voluntary forfeit"));
    }
    
    joinTable(user, socketId, tokens = null, forceSpectator = false) {
        const { id, username } = user;
        
        if (forceSpectator) {
            console.log(`[ADMIN] Forcing spectator mode for ${username} on table ${this.tableId}`);
        }

        const isPlayerAlreadyInGame = !!this.players[id];
        
        if (isPlayerAlreadyInGame) {
            this.invalidateRoundPresentationAcknowledgement(id);
            this.players[id].disconnected = false;
            this.players[id].socketId = socketId;
            if (tokens !== null) this.players[id].tokens = tokens;
            
            // Force spectator mode - handle both conversion cases
            // The funded roster is immutable once its start transaction has
            // been scheduled. Reconnects may adopt a socket, but they cannot
            // change an active seat into a spectator before the commit lands.
            if (forceSpectator && !this.gameStartPending && !this.gameStarted) {
                if (!this.players[id].isSpectator) {
                    this.players[id].isSpectator = true;
                    this.playerOrder.remove(id);
                } else {
                    // Ensure they're not in player order if already spectator
                    if (this.playerOrder.includes(id)) {
                        this.playerOrder.remove(id);
                    }
                }
            }
        } else {
            const activePlayersCount = this.playerOrder.count;
            const playerBase = { userId: id, playerName: username, socketId, tokens };

            // A late arrival while buy-ins are committing may observe, but
            // must not enter the captured/charged active roster.
            if (forceSpectator || this.gameStarted || this.gameStartPending || activePlayersCount >= 4) {
                this.players[id] = { ...playerBase, isSpectator: true, disconnected: false };
            } else {
                this.players[id] = { ...playerBase, isSpectator: false, disconnected: false };
                if (!this.playerOrder.includes(id)) {
                    this.playerOrder.add(id);
                }
            }
        }
        
        if (!this.players[id].isSpectator && this.scores[username] === undefined) {
            this.scores[username] = 120;
        } else if (this.players[id].isSpectator) {
            delete this.scores[username];
        }
        const activePlayersAfterJoin = this.playerOrder.count;
        if (!this.gameStarted) {
            this.state = (activePlayersAfterJoin >= 3) ? "Ready to Start" : "Waiting for Players";
        }

        if (forceSpectator) {
            console.log(`[ADMIN] Spectator join result for ${username}: isSpectator=${this.players[id].isSpectator}, inPlayerOrder=${this.playerOrder.includes(id)}`);
        }
    }

    _addBotPlayer({ allowQuickPlayFourth = false } = {}) {
        if (this.gameStarted || this.gameStartPending || this.playerOrder.count >= 4) return;
        // Quick Play's fourth seat is reserved for a human after the table has
        // explicitly entered its fourth-player search. Only the server-owned,
        // generation-checked fallback method below may cross this boundary.
        if (this.tableType === 'quickplay' && this.playerOrder.count >= 3 && !allowQuickPlayFourth) return;
        const currentBotNames = new Set(Object.values(this.players).filter(p => p.isBot).map(p => p.playerName));
        const availableNames = BOT_NAMES.filter(name => !currentBotNames.has(name));
        if (availableNames.length === 0) return;
        
        const botName = availableNames[Math.floor(Math.random() * availableNames.length)];
        const botId = this._nextBotId--;
        
        this.players[botId] = { userId: botId, playerName: botName, socketId: null, isSpectator: false, disconnected: false, isBot: true, tokens: 'N/A' };
        this.bots[botId] = new BotPlayer(botId, botName, this);
        if (!this.scores[botName]) this.scores[botName] = 120;
        if (!this.playerOrder.includes(botId)) {
            this.playerOrder.add(botId);
        }
        if (this.playerOrder.count >= 3 && !this.gameStarted) this.state = 'Ready to Start';
        return this.players[botId];
    }

    addBotPlayer() {
        return this._addBotPlayer();
    }

    addQuickPlayFallbackBot({ generation, deadline, now } = {}) {
        if (this.tableType !== 'quickplay'
            || this.gameStarted || this.gameStartPending
            || this.qpPhase !== 'seeking_fourth'
            || this.qpGeneration !== generation
            || !Number.isFinite(deadline)
            || !Number.isFinite(now)
            || now < deadline
            || this.qpWindowEndsAt !== deadline
            || this.playerOrder.count !== 3
            || !Object.values(this.players).some(player => !player.isBot && !player.isSpectator)
            || this.qpFallbackBot !== null) return null;

        const bot = this._addBotPlayer({ allowQuickPlayFourth: true });
        if (!bot || this.playerOrder.allIds[3] !== bot.userId) {
            if (bot) this.removeBotPlayer(bot.userId);
            return null;
        }
        this.qpFallbackBot = {
            userId: bot.userId,
            searchGeneration: generation,
            startGeneration: null,
        };
        return bot;
    }

    bindQuickPlayFallbackStart(botId, searchGeneration, startGeneration) {
        const marker = this.qpFallbackBot;
        const fourthPlayerId = this.playerOrder.allIds[3];
        if (this.tableType !== 'quickplay'
            || this.qpPhase !== 'starting_4'
            || this.qpGeneration !== startGeneration
            || !marker
            || marker.userId !== botId
            || marker.searchGeneration !== searchGeneration
            || fourthPlayerId !== botId
            || this.players[botId]?.isBot !== true) return false;
        marker.startGeneration = startGeneration;
        return true;
    }

    removeBotPlayer(botId) {
        if (this.gameStarted || this.gameStartPending) return false;
        const normalizedBotId = Number(botId);
        const botInfo = this.players[normalizedBotId];
        if (!botInfo?.isBot) return false;

        console.log(`[${this.tableId}] Removing bot: ${botInfo.playerName}`);
        this.playerOrder.remove(normalizedBotId);
        delete this.scores[botInfo.playerName];
        delete this.bots[normalizedBotId];
        delete this.players[normalizedBotId];
        if (this.qpFallbackBot?.userId === normalizedBotId) this.qpFallbackBot = null;

        this.playerMode = this.playerOrder.count;
        this.state = this.playerMode >= 3 ? "Ready to Start" : "Waiting for Players";
        return true;
    }

    removeBot() {
        if (this.gameStarted || this.gameStartPending) return;

        const botIds = Object.keys(this.players).filter(id => this.players[id].isBot).map(id => parseInt(id, 10));
        if (botIds.length === 0) return; 

        const botIdToRemove = Math.max(...botIds);
        this.removeBotPlayer(botIdToRemove);
    }

    leaveTable(userId) {
        if (!this.players[userId]) return;

        const playerInfo = this.players[userId];
        const safeLeaveStates = ["Waiting for Players", "Ready to Start"];
        // Terminal states: the game is settled and payouts are done, so leaving
        // must release the seat for real even though gameId is still set —
        // otherwise every reconnect re-seats the player into the finished game.
        const terminalStates = ["DrawComplete", "Game Over"];

        // Once the start effect exists, every active seat is part of an
        // immutable funded roster. An explicit leave becomes a disconnect so
        // the eventual commit can still transition into the exact game that
        // was charged. Spectators are outside that roster and remain removable.
        if (this.gameStartPending && !playerInfo.isSpectator) {
            if (!playerInfo.isBot) {
                playerInfo.disconnected = true;
                playerInfo.socketId = null;
            }
        }
        else if (terminalStates.includes(this.state)) {
            delete this.players[userId];
            if (playerInfo.isBot) delete this.bots[userId];
            this.playerOrder.remove(userId);
        }
        else if (this.gameId) {
            this.disconnectPlayer(userId);
        }
        else if (safeLeaveStates.includes(this.state) || playerInfo.isSpectator) {
            delete this.players[userId];
            if (playerInfo.isBot) delete this.bots[userId];
            this.playerOrder.remove(userId);
        }
    }
    
    disconnectPlayer(userId) {
        const player = this.players[userId];
        if (!player) return;
        if (this.gameStartPending && !player.isSpectator && !player.isBot) {
            console.log(`[${this.tableId}] Player ${player.playerName} disconnected while the game start was committing.`);
            player.disconnected = true;
            player.socketId = null;
        } else if (!this.gameStarted || player.isSpectator) {
            delete this.players[userId];
            if (player.isBot) delete this.bots[userId];
            this.playerOrder.remove(userId);
        } else {
            console.log(`[${this.tableId}] Player ${player.playerName} has disconnected.`);
            player.disconnected = true;
            // Personalized delivery targets socketId directly rather than only
            // the room. Detach an explicit leaver immediately so later state
            // cannot bounce their lobby back to the table. reconnectPlayer()
            // adopts a new socket while preserving the reserved seat.
            player.socketId = null;
        }
    }
    
    // Re-seat a returning player on `socket`. Idempotent and NOT gated on the
    // `disconnected` flag: on a fast reload the new socket can connect before the
    // old socket's 'disconnect' is processed, so the flag may still be false — we
    // must still adopt the new socket id and clear any pending forfeit either way.
    // Returns true if the user had a seat here, false otherwise.
    reconnectPlayer(userId, socket, tokens = null) {
        const player = this.players[userId];
        if (!player) return false;
        // A new socket must prove that it displayed the current presentation;
        // an acknowledgement from the connection it replaces is not reusable.
        this.invalidateRoundPresentationAcknowledgement(userId);
        if (player.disconnected) {
            console.log(`[${this.tableId}] Reconnecting user ${player.playerName}.`);
        }
        player.disconnected = false;
        player.socketId = socket.id;
        if (tokens !== null) player.tokens = tokens;
        if (this.forfeiture.targetPlayerName === player.playerName) {
             this._clearForfeitTimer();
        }
        return true;
    }

    startGame(requestingUserId, options = {}) {
        if (this.gameStarted || this.gameStartPending) return this._effects();
        if (!this.players[requestingUserId] || this.players[requestingUserId].isSpectator) return this._effects();
        const activePlayerIds = this.playerOrder.allIds;
        let quickPlayFallbackStartGeneration = null;

        if (this.tableType === 'quickplay') {
            const authorization = options.quickPlayStart;
            const expectedMode = this.qpPhase === 'starting_3'
                ? 3
                : this.qpPhase === 'starting_4' ? 4 : null;
            const fourthPlayer = activePlayerIds.length === 4
                ? this.players[activePlayerIds[3]]
                : null;
            const fallbackMarker = this.qpFallbackBot;
            const authorizedFallbackFourth = expectedMode === 4
                && fourthPlayer?.isBot === true
                && authorization?.fallbackBotId === fourthPlayer.userId
                && fallbackMarker?.userId === fourthPlayer.userId
                && fallbackMarker?.startGeneration === authorization?.generation;
            if (authorizedFallbackFourth) {
                quickPlayFallbackStartGeneration = authorization.generation;
            }
            const authorized = authorization
                && authorization.generation === this.qpGeneration
                && authorization.playerMode === expectedMode
                && activePlayerIds.length === expectedMode
                && this.players[requestingUserId].isBot !== true
                && (expectedMode !== 4 || (
                    fourthPlayer
                    && fourthPlayer.isSpectator !== true
                    && (fourthPlayer.isBot !== true || authorizedFallbackFourth)
                ));

            if (!authorized) {
                return this._effects([{
                    type: 'EMIT_TO_SOCKET',
                    payload: {
                        socketId: this.players[requestingUserId].socketId,
                        event: 'gameStartError',
                        data: { message: 'Use the Quick Play table choice to start this game.' },
                    },
                }]);
            }
        }
        if (activePlayerIds.length < 3) {
            return this._effects([{ type: 'EMIT_TO_SOCKET', payload: { socketId: this.players[requestingUserId].socketId, event: 'gameStartError', data: { message: "Need at least 3 players to start." } } }]);
        }
        
        this.playerMode = activePlayerIds.length;
        const startRoster = Object.freeze(activePlayerIds.map(id => {
            const player = this.players[id];
            return Object.freeze({
                userId: id,
                playerName: player.playerName,
                isBot: player.isBot === true,
            });
        }));
        const startRosterIds = Object.freeze(startRoster.map(player => player.userId));
        // Set synchronously before returning the database effect. Socket events
        // can arrive again while that effect awaits PostgreSQL; only this first
        // invocation is allowed to schedule a funded start.
        this.gameStartPending = true;
        
        const effects = [{
            type: 'START_GAME_TRANSACTIONS',
            payload: { 
                table: { tableId: this.tableId, theme: this.theme, playerMode: this.playerMode },
                playerIds: startRoster.filter(player => !player.isBot).map(player => player.userId),
            },
            onSuccess: (gameId, updatedTokens) => {
                this.gameStartPending = false;
                console.log(`[GAME-ENGINE] Setting gameId to: ${gameId}`);
                this.gameId = gameId;
                this.gameStarted = true;
                startRoster.forEach(({ userId, playerName }) => {
                    if (this.scores[playerName] === undefined) this.scores[playerName] = 120;
                    const livePlayer = this.players[userId];
                    if (livePlayer && updatedTokens && updatedTokens[userId] !== undefined) {
                        livePlayer.tokens = updatedTokens[userId];
                    }
                });
                if (this.playerMode === 3 && this.scores[PLACEHOLDER_ID] === undefined) { this.scores[PLACEHOLDER_ID] = 120; }
                const shuffledPlayerIds = shuffle([...startRosterIds]);
                this.dealer = shuffledPlayerIds[0];
                this.playerOrder.setTurnOrder(this.dealer, this.playerMode === 4);
                this._initializeNewRoundState();
                this.state = "Dealing Pending";
            },
            onFailure: (error, brokePlayerName) => {
                this.gameStartPending = false;
                const playersToRemove = new Set(
                    Object.values(this.players)
                        .filter(player => !player.isBot && !player.isSpectator && player.disconnected)
                        .map(player => player.userId),
                );
                if (brokePlayerName) {
                    const brokePlayer = Object.values(this.players).find(p => p.playerName === brokePlayerName);
                    if (brokePlayer) playersToRemove.add(brokePlayer.userId);
                }
                // A pregame disconnect is normally removed immediately. It was
                // preserved only while commit was possible; after rollback it
                // must not remain as a countable/chargeable ghost seat.
                for (const userId of playersToRemove) {
                    delete this.players[userId];
                    this.playerOrder.remove(userId);
                }
                // A failed fallback start must not strand a bot in the reserved
                // fourth seat. Remove exactly the generation-bound fallback;
                // the ordinary matchmaking bots in seats two/three remain.
                const fallbackBotId = quickPlayFallbackStartGeneration !== null
                    && this.qpFallbackBot?.startGeneration === quickPlayFallbackStartGeneration
                    ? this.qpFallbackBot.userId
                    : null;
                if (fallbackBotId !== null) this.removeBotPlayer(fallbackBotId);
                this.gameStarted = false;
                this.gameId = null; 
                this.playerMode = this.playerOrder.count;
                this.state = this.playerMode >= 3 ? "Ready to Start" : "Waiting for Players";
            }
        }];
        
        effects.push({ type: 'SYNC_PLAYER_TOKENS', payload: { playerIds: activePlayerIds } });
        effects.push({ type: 'BROADCAST_STATE' });
        effects.push({ type: 'UPDATE_LOBBY' });
        return this._effects(effects);
    }

    dealCards(requestingUserId) {
        if (this.state !== "Dealing Pending" || requestingUserId !== this.dealer) return this._effects();
        const turnOrder = this.playerOrder.turnOrder;
        const shuffledDeck = shuffle([...deck]);
        turnOrder.forEach((playerId, i) => {
            const playerName = this.players[playerId].playerName;
            this.hands[playerName] = shuffledDeck.slice(i * 11, (i + 1) * 11);
        });
        this.widow = shuffledDeck.slice(11 * turnOrder.length);
        this.originalDealtWidow = [...this.widow];
        this.state = "Bidding Phase";
        this.biddingTurnPlayerId = turnOrder[0];
        return this._effects([{ type: 'BROADCAST_STATE' }]);
    }

    placeBid(userId, bid) {
        const effects = biddingHandler.placeBid(this, userId, bid);
        return this._effects(effects);
    }
    
    chooseTrump(userId, suit) {
        if (this.state !== "Trump Selection" || this.bidWinnerInfo?.userId !== userId || !["S", "C", "D"].includes(suit)) return this._effects();
        this.trumpSuit = suit;
        const fanfareTimer = this._transitionToPlayingPhase();
        return this._effects([{ type: 'BROADCAST_STATE' }, fanfareTimer]);
    }

    submitFrogDiscards(userId, discards) {
        const player = this.players[userId];
        if (!player) {
            console.warn(`[${this.tableId}] submitFrogDiscards REJECTED: Unknown player ${userId}`);
            return this._effects();
        }
        if (this.state !== "Frog Widow Exchange") {
            console.warn(`[${this.tableId}] submitFrogDiscards REJECTED: State is '${this.state}'`);
            return this._effects();
        }
        if (this.bidWinnerInfo?.userId !== userId) {
            console.warn(`[${this.tableId}] submitFrogDiscards REJECTED: User ${userId} is not bidder ${this.bidWinnerInfo?.userId}`);
            return this._effects();
        }
        if (!Array.isArray(discards) || discards.length !== 3 || new Set(discards).size !== 3) {
            console.warn(`[${this.tableId}] submitFrogDiscards REJECTED: Invalid payload ${JSON.stringify(discards)}`);
            return this._effects();
        }
        const currentHand = this.hands[player.playerName] || [];
        if (currentHand.length !== 14 || !discards.every(card => currentHand.includes(card))) {
            console.warn(`[${this.tableId}] submitFrogDiscards REJECTED: One or more cards not in hand of ${player.playerName}. Hand=[${currentHand.join(',')}], discards=[${discards.join(',')}]`);
            return this._effects();
        }
        const discardedCards = new Set(discards);
        const resultingHand = currentHand.filter(card => !discardedCards.has(card));
        if (resultingHand.length !== 11) return this._effects();
        this.widowDiscardsForFrogBidder = [...discards];
        this.hands[player.playerName] = resultingHand;
        const fanfareTimer = this._transitionToPlayingPhase();
        return this._effects([{ type: 'BROADCAST_STATE' }, fanfareTimer]);
    }

    playCard(userId, card) {
        const effects = playHandler.playCard(this, userId, card);
        return this._effects(effects);
    }

    requestNextRound(requestingUserId) {
        if (this.state === "Awaiting Next Round Trigger"
            && requestingUserId === this.roundSummary?.dealerOfRoundId
            && this.isRoundPresentationAdvanceReady()) {
            this._advanceRound();
        }
        return this._effects([{ type: 'BROADCAST_STATE' }]);
    }

    startRoundPresentationWindow(lockDurationMs, now = Date.now()) {
        if (!this.roundSummary || !Number.isFinite(lockDurationMs) || lockDurationMs < 0) return null;
        const presentationReadyAt = now + lockDurationMs;
        this.roundPresentationAcknowledgements.clear();
        this.roundSummary.presentationReadyAt = presentationReadyAt;
        this.roundSummary.presentationForceReadyAt = presentationReadyAt + ROUND_PRESENTATION_ACK_GRACE_MS;
        this.roundSummary.allConnectedHumansPresented = false;
        return presentationReadyAt;
    }

    invalidateRoundPresentationAcknowledgement(userId) {
        this.roundPresentationAcknowledgements?.delete(String(userId));
    }

    isRoundPresentationAdvanceReady(now = Date.now()) {
        const presentationReadyAt = this.roundSummary?.presentationReadyAt;
        // DrawComplete and old/legacy summaries intentionally have no shared
        // presentation fields and retain their previous immediate behavior.
        if (!Number.isFinite(presentationReadyAt)) return true;
        if (now < presentationReadyAt) return false;

        const presentationForceReadyAt = this.roundSummary?.presentationForceReadyAt;
        return this.roundSummary.allConnectedHumansPresented === true
            || (Number.isFinite(presentationForceReadyAt) && now >= presentationForceReadyAt);
    }

    reset() {
        if (this.settlement && !['idle', 'complete'].includes(this.settlement.status)) {
            console.warn(`[${this.tableId}] Reset blocked while ${this.settlement.kind || 'game'} settlement is ${this.settlement.status}.`);
            return this._effects();
        }
        console.log(`[${this.tableId}] Game is being reset by 'Play Again' button.`);
        this.gameStarted = false;
        this.gameStartPending = false;
        this.settlement = this._newSettlementState();
        this.gameId = null;
        this.playerMode = null;
        // A fallback bot belongs only to the completed/failed match that
        // authorized it. It never carries into a rematch decision.
        if (this.tableType === 'quickplay' && this.qpFallbackBot) {
            this.removeBotPlayer(this.qpFallbackBot.userId);
        }
        if (this.tableType === 'quickplay') {
            this.qpPhase = 'filling';
            this.qpGeneration += 1;
        }
        this.qpWindowEndsAt = null;
        this._initializeNewRoundState(); 
        for (const userId in this.players) {
            if (this.players[userId].disconnected) {
                console.log(`[${this.tableId}] Removing disconnected player ${this.players[userId].playerName} during reset.`);
                this.playerOrder.remove(parseInt(userId, 10));
                if (this.players[userId].isBot) {
                    delete this.bots[userId];
                }
                delete this.players[userId];
            }
        }
        this.scores = {};
        // Reset playerOrder to include all remaining players (except those who should stay spectators)
        this.playerOrder = new PlayerList();
        
        for (const userId in this.players) {
            const player = this.players[userId];
            // A spectator never becomes a funded seat merely because somebody
            // else requested a rematch. They must leave/rejoin or use an
            // explicit seating flow before a later game can charge them.
            if (!player.isSpectator && !player.wasExplicitSpectator) {
                player.isSpectator = false;
                this.playerOrder.add(parseInt(userId, 10));
                this.scores[player.playerName] = 120;
            } else {
                player.isSpectator = true;
            }
        }
        this.playerMode = this.playerOrder.count;
        this.state = this.playerMode >= 3 ? "Ready to Start" : "Waiting for Players";
        this.dealer = null;
        console.log(`[${this.tableId}] Reset complete. State is now '${this.state}' with ${this.playerMode} players.`);
        return this._effects([{ type: 'BROADCAST_STATE' }, { type: 'UPDATE_LOBBY' }]);
    }
    
    updateInsuranceSetting(userId, settingType, value) {
        const player = this.players[userId];
        const insuranceStates = ['Bid Announcement', 'Playing Phase', 'TrickCompleteLinger'];
        if (!player || player.isSpectator || !insuranceStates.includes(this.state)
            || this.drawRequest.isActive || !this.insurance.isActive || this.insurance.dealExecuted) return this._effects();
        const multiplier = this.insurance.bidMultiplier;
        const parsedValue = parseInt(value, 10);
        if (isNaN(parsedValue)) return this._effects();
        if (settingType === 'bidderRequirement' && player.playerName === this.insurance.bidderPlayerName) {
            const minReq = -120 * multiplier;
            const maxReq = 120 * multiplier;
            if (parsedValue >= minReq && parsedValue <= maxReq) {
                this.insurance.bidderRequirement = parsedValue;
            }
        } else if (settingType === 'defenderOffer' && this.insurance.defenderOffers.hasOwnProperty(player.playerName)) {
            const minOffer = -60 * multiplier;
            const maxOffer = 60 * multiplier;
            if (parsedValue >= minOffer && parsedValue <= maxOffer) {
                this.insurance.defenderOffers[player.playerName] = parsedValue;
            }
        } else { return this._effects(); }
        const sumOfOffers = Object.values(this.insurance.defenderOffers || {}).reduce((sum, offer) => sum + (offer || 0), 0);
        if (this.insurance.bidderRequirement <= sumOfOffers) {
            this.insurance.dealExecuted = true;
            this.insurance.executedDetails = {
                agreement: {
                    bidderPlayerName: this.insurance.bidderPlayerName,
                    bidderRequirement: this.insurance.bidderRequirement,
                    // The defenders' actual offers are binding.  If they
                    // overshoot the bidder's ask, crediting this exact total
                    // keeps the agreement zero-sum without rewriting an offer.
                    bidderSettlement: sumOfOffers,
                    defenderOffers: { ...this.insurance.defenderOffers }
                }
            };
        }
        return this._effects([{ type: 'BROADCAST_STATE' }]);
    }

    requestDraw(userId) {
        const player = this.players[userId];
        if (!player || player.isSpectator || this.drawRequest.isActive || this.state !== 'Playing Phase') return this._effects();
        
        console.log(`[${this.tableId}] Draw requested by ${player.playerName}.`);
        this.drawRequest.isActive = true;
        this.drawRequest.initiator = player.playerName;
        this.drawRequest.votes = {};
        const activePlayers = this.playerOrder.allIds.map(id => this.players[id]);
        activePlayers.forEach(p => {
            if (!p.isSpectator) {
                this.drawRequest.votes[p.playerName] = (p.playerName === player.playerName) ? 'wash' : null;
            }
        });
        this.drawRequest.timer = 30;

        this.internalTimers.drawTimer = setInterval(() => {
            if (this.drawRequest.isActive) {
                this.drawRequest.timer--;
                if (this.drawRequest.timer <= 0) {
                    console.log(`[${this.tableId}] Draw request timed out.`);
                    clearInterval(this.internalTimers.drawTimer);
                    delete this.internalTimers.drawTimer;
                    this.drawRequest.isActive = false;
                    this.drawRequest.timer = 0;
                    this.state = 'Playing Phase';
                }
                this.emitLobbyUpdateCallback([{ type: 'BROADCAST_STATE' }]);
            } else {
                clearInterval(this.internalTimers.drawTimer);
                delete this.internalTimers.drawTimer;
            }
        }, 1000);

        return this._effects([{ type: 'BROADCAST_STATE' }]);
    }

    submitDrawVote(userId, vote) {
        const player = this.players[userId];
        if (!player || !this.drawRequest.isActive || !['wash', 'split', 'no'].includes(vote) || this.drawRequest.votes[player.playerName] !== null) {
            return this._effects();
        }
        
        console.log(`[${this.tableId}] ${player.playerName} voted to ${vote}.`);
        this.drawRequest.votes[player.playerName] = vote;
        
        const clearDrawTimer = () => {
            if (this.internalTimers.drawTimer) {
                clearInterval(this.internalTimers.drawTimer);
                delete this.internalTimers.drawTimer;
            }
        };

        if (vote === 'no') {
            clearDrawTimer();
            this.drawRequest.isActive = false;
            this.state = "DrawDeclined";
            console.log(`[${this.tableId}] Draw declined.`);

            return this._effects([
                { type: 'BROADCAST_STATE' },
                { type: 'START_TIMER', payload: {
                    duration: 3000,
                    onTimeout: (engineRef) => {
                        if (engineRef.state !== "DrawDeclined") return [];
                        engineRef.state = "Playing Phase";
                        return [{ type: 'BROADCAST_STATE' }];
                    }
                }}
            ]);
        }

        const allVotes = Object.values(this.drawRequest.votes);
        if (allVotes.some(v => v === null)) {
            return this._effects([{ type: 'BROADCAST_STATE' }]);
        }
        
        clearDrawTimer();
        this.drawRequest.isActive = false;
        // Settlement is asynchronous.  Leave Playing Phase immediately so a
        // card or second draw transition cannot race the database operation.
        this.state = 'Draw Resolving';
        const outcome = allVotes.includes('split') ? 'split' : 'wash';
        this.beginSettlement('draw');
        console.log(`[${this.tableId}] Draw accepted with outcome: ${outcome}.`);

        return this._effects([{
            type: 'HANDLE_DRAW_OUTCOME',
            payload: this._createSettlementSnapshot({ outcome }),
            onComplete: (summary) => {
                this.roundSummary = summary;
                this.state = "DrawComplete";
            }
        }]);
    }

    _initializeNewRoundState() {
        this.roundPresentationAcknowledgements = new Set();
        this.hands = {}; this.widow = []; this.originalDealtWidow = [];
        this.biddingTurnPlayerId = null; this.currentHighestBidDetails = null; this.playersWhoPassedThisRound = [];
        this.bidWinnerInfo = null; this.trumpSuit = null; this.trumpBroken = false; this.originalFrogBidderId = null; this.soloBidMadeAfterFrog = false; this.revealedWidowForFrog = []; this.widowDiscardsForFrogBidder = [];
        this.trickTurnPlayerId = null; this.trickLeaderId = null; this.currentTrickCards = []; this.leadSuitCurrentTrick = null; this.lastCompletedTrick = null; this.tricksPlayedCount = 0; this.capturedTricks = {}; this.roundSummary = null; 
        this.insurance = { isActive: false, bidMultiplier: null, bidderPlayerName: null, bidderRequirement: 0, defenderOffers: {}, dealExecuted: false, executedDetails: null };
        this.forfeiture = { targetPlayerName: null, timeLeft: null }; this.drawRequest = { isActive: false, initiator: null, votes: {}, timer: null };
        this.drawCountdown = null;
        Object.values(this.players).forEach(p => {
            if (p.playerName && this.scores[p.playerName] !== undefined) {
                this.capturedTricks[p.playerName] = [];
            }
        });
        this.bidderCardPoints = 0; this.defenderCardPoints = 0;
        this.allCardsPlayedThisRound = [];
    }
    
    _clearForfeitTimer() {
        if (this.internalTimers.forfeit) {
            clearInterval(this.internalTimers.forfeit);
            delete this.internalTimers.forfeit;
        }
        this.forfeiture = { targetPlayerName: null, timeLeft: null };
    }

    _resolveForfeit(forfeitingPlayerName, reason) {
        const forfeitingPlayer = Object.values(this.players).find(p => p.playerName === forfeitingPlayerName);
        if (!this.gameStarted || !forfeitingPlayer || forfeitingPlayer.isSpectator || ['Game Over', 'DrawComplete', 'Draw Resolving'].includes(this.state)) {
            return [];
        }
        console.log(`[${this.tableId}] Forfeit by ${forfeitingPlayerName} (${reason})`);
        this._clearForfeitTimer();
        if (this.internalTimers.drawTimer) {
            clearInterval(this.internalTimers.drawTimer);
            delete this.internalTimers.drawTimer;
        }
        this.drawRequest.isActive = false;
        this.state = "Game Over";
        this.beginSettlement('forfeit');
        this.roundSummary = {
            message: `${forfeitingPlayerName} forfeited the game.`,
            finalScores: { ...this.scores },
            isGameOver: true,
            gameWinner: null,
            payoutDetails: {},
            forfeit: { forfeitingPlayerName, reason },
            // GameService stamps this after asynchronous settlement, immediately
            // before the first result broadcast reaches clients.
            presentationReadyAt: null,
            presentationForceReadyAt: null,
            allConnectedHumansPresented: false,
        };
        return [
            {
                type: 'HANDLE_FORFEIT',
                payload: this._createSettlementSnapshot({
                    forfeitingPlayerName,
                    reason,
                }),
            },
            { type: 'SYNC_PLAYER_TOKENS', payload: { playerIds: Object.keys(this.players) } },
            { type: 'BROADCAST_STATE' },
            { type: 'UPDATE_LOBBY' },
        ];
    }
    
    // Enter the "Bid Announcement" window: everything about the round is set up
    // (trump, trick leader, insurance), but play is held while clients run the
    // bid-winner VS splash. Returns a START_TIMER effect the caller must include
    // in its returned effects; the timer flips the state to "Playing Phase".
    _transitionToPlayingPhase() {
        this.state = "Bid Announcement";
        this.tricksPlayedCount = 0;
        this.trumpBroken = false;
        this.currentTrickCards = [];
        this.leadSuitCurrentTrick = null;
        this.lastCompletedTrick = null;
        this.trickLeaderId = this.bidWinnerInfo.userId;
        this.trickTurnPlayerId = this.bidWinnerInfo.userId;
        // Insurance runs whenever the round has exactly 3 active players —
        // which is every round in both 3-player and 4-player mode (the
        // 4-player dealer sits out and is not a party to insurance).
        if (this.playerMode === 3 || this.playerMode === 4) {
            this.insurance.isActive = true;
            const multiplier = BID_MULTIPLIERS[this.bidWinnerInfo.bid];
            this.insurance.bidMultiplier = multiplier;
            this.insurance.bidderPlayerName = this.bidWinnerInfo.playerName;
            this.insurance.bidderRequirement = 120 * multiplier;
            console.log(`[INSURANCE] Activated for ${this.bidWinnerInfo.playerName} with bid ${this.bidWinnerInfo.bid} (multiplier: ${multiplier})`);

            const activePlayerNames = this.playerOrder.turnOrder
                .map(id => this.players[id]?.playerName)
                .filter(Boolean);
            const defenders = activePlayerNames.filter(name => name !== this.bidWinnerInfo.playerName);

            defenders.forEach(defName => { this.insurance.defenderOffers[defName] = -60 * multiplier; });
        }

        // 6s covers the condensed client splash (1.7s breather + 3s animation)
        // plus a 1.3s scheduling/network margin. Guarded so a reset/forfeit during the window
        // doesn't get yanked back into play.
        return { type: 'START_TIMER', payload: {
            duration: 6000,
            onTimeout: (engineRef) => {
                if (engineRef.state !== "Bid Announcement") return [];
                engineRef.state = "Playing Phase";
                return [{ type: 'BROADCAST_STATE' }];
            }
        }};
    }
    
    _advanceRound() {
        if (!this.gameStarted) return;
        const roster = this.playerOrder.allIds;
        const oldDealerIndex = roster.indexOf(this.dealer);
        this.dealer = roster[(oldDealerIndex + 1) % roster.length];

        if (!this.players[this.dealer]) {
            console.error(`[${this.tableId}] FATAL: Could not find new dealer. Resetting table.`);
            this.reset();
            return;
        }
        
        this.playerOrder.setTurnOrder(this.dealer, this.playerMode === 4);
        this._initializeNewRoundState();
        this.state = "Dealing Pending";
    }

    _getRawStateForClient() {
        const activeTurnOrder = this.gameStarted ? this.playerOrder.turnOrder : this.playerOrder.allIds;
        const state = {
            tableId: this.tableId, tableName: this.tableName, theme: this.theme, state: this.state, players: this.players,
            serverTime: Date.now(),
            tableType: this.tableType, qpPhase: this.qpPhase, qpGeneration: this.qpGeneration,
            // The randomized fallback deadline is deliberately not disclosed;
            // clients render a neutral searching state until a seat is filled.
            qpWindowEndsAt: null,
            playerOrderActive: activeTurnOrder.map(id => this.players[id]?.playerName).filter(Boolean),
            // Full seating roster in join order (includes the sitting-out dealer
            // in 4-player). Clients derive fixed seats from this, not from
            // playerOrderActive, which shrinks to 3 in a 4-player round.
            seatingOrder: this.playerOrder.allIds.map(id => this.players[id]?.playerName).filter(Boolean),
            dealer: this.dealer, hands: this.hands, widow: this.widow,
            // The stack size is public presentation state. Card identities are
            // still removed per viewer by gameStateSerializer.
            widowCount: Array.isArray(this.widow) ? this.widow.length : 0,
            originalDealtWidow: this.originalDealtWidow, scores: this.scores, currentHighestBidDetails: this.currentHighestBidDetails, bidWinnerInfo: this.bidWinnerInfo, gameStarted: this.gameStarted, trumpSuit: this.trumpSuit, currentTrickCards: this.currentTrickCards, tricksPlayedCount: this.tricksPlayedCount, leadSuitCurrentTrick: this.leadSuitCurrentTrick, trumpBroken: this.trumpBroken, capturedTricks: this.capturedTricks, roundSummary: this.roundSummary, lastCompletedTrick: this.lastCompletedTrick, playersWhoPassedThisRound: this.playersWhoPassedThisRound.map(id => this.players[id]?.playerName), playerMode: this.playerMode, serverVersion: this.serverVersion, insurance: this.insurance, forfeiture: this.forfeiture, drawRequest: this.drawRequest, originalFrogBidderId: this.originalFrogBidderId, soloBidMadeAfterFrog: this.soloBidMadeAfterFrog, revealedWidowForFrog: this.revealedWidowForFrog, widowDiscardsForFrogBidder: this.widowDiscardsForFrogBidder,
            bidderCardPoints: this.bidderCardPoints, defenderCardPoints: this.defenderCardPoints,
            drawCountdown: this.drawCountdown,
            settlement: this.settlement,
        };
        state.biddingTurnPlayerName = this.players[this.biddingTurnPlayerId]?.playerName;
        state.trickTurnPlayerName = this.players[this.trickTurnPlayerId]?.playerName;
        return state;
    }

    // Fail closed for legacy callers: without an authenticated viewer context,
    // no private hand or widow is serialized.  Socket delivery passes a
    // server-derived context so each player receives their own allowed view.
    getStateForClient(viewerContext = {}) {
        return serializeGameState(this, viewerContext);
    }
}

module.exports = GameEngine;
