    // backend/src/services/GameService.js

    const GameEngine = require('../core/GameEngine');
    const transactionManager = require('../data/transactionManager');
    const { loadBotBalances } = require('../data/botAccounts');
    const { THEMES, TABLE_COSTS, SERVER_VERSION, ROUND_PRESENTATION_LOCK_MS } = require('../core/constants');
    const AdaptiveInsuranceStrategy = require('../core/bot-strategies/AdaptiveInsuranceStrategy');

    const MAX_SETTLEMENT_ATTEMPTS = 3;
    // Settled tables remain available while a human is connected so players can
    // read the recap and explicitly choose a rematch or leave. Truly empty
    // tables recycle quickly; disconnected human seats get a mobile-friendly
    // reconnect grace before the table is reclaimed.
    const TERMINAL_EMPTY_CLEANUP_DELAY_MS = 5_000;
    const TERMINAL_DISCONNECTED_CLEANUP_DELAY_MS = 120_000;
    const TERMINAL_QUICKPLAY_DISCONNECTED_CLEANUP_DELAY_MS = 60_000;
    const QUICKPLAY_FOURTH_FALLBACK_MIN_DELAY_MS = 8_000;
    const QUICKPLAY_FOURTH_FALLBACK_MAX_DELAY_MS = 15_000;
    const TRANSIENT_SETTLEMENT_CODES = new Set([
        '40001', // serialization failure
        '40P01', // deadlock detected
        '53300', // too many connections
        '57P01', // admin shutdown
        '08000', '08003', '08006', '08001', '08004', '08007', '08P01',
    ]);

    const isTransientSettlementError = error => (
        error?.transient === true
        || TRANSIENT_SETTLEMENT_CODES.has(error?.code)
        || (typeof error?.code === 'string' && error.code.startsWith('08'))
    );

    class GameService {
        constructor(io, pool, { botAccounts = [] } = {}) {
            this.io = io;
            this.pool = pool;
            this.botAccounts = Array.isArray(botAccounts) ? botAccounts : [];
            // Process-local seat ownership prevents one persistent bot account
            // from acting at multiple tables in this server instance. Database
            // row locks still protect its balance, but a rolling deploy with
            // overlapping processes can temporarily have one lease per process;
            // cross-process leasing is intentionally outside this safeguard.
            this.botSeatLeases = new Map();
            this.botSeatLeaseEpoch = 0;
            this.engines = {};
            this.qpGenerationCounter = 0;
            this.terminalCleanupTimers = {};
            this.roundAdvanceTimers = {};
            this.adaptiveInsurance = new AdaptiveInsuranceStrategy(pool, io);
            this._initializeEngines();

            // --- THE NEW GAME LOOP HEARTBEAT ---
            // This runs every 1.5 seconds to check if any bots need to act.
            setInterval(() => {
                for (const tableId in this.engines) {
                    const engine = this.engines[tableId];
                    if (engine.gameStarted) {
                        this._triggerBots(tableId);
                    }
                }
            }, 1500);
        }

        _initializeEngines() {
            // Every full engine generation gets fresh opaque owners. Stale
            // callbacks from discarded engines therefore cannot release a
            // lease acquired by the replacement generation.
            if (!(this.botSeatLeases instanceof Map)) this.botSeatLeases = new Map();
            if (!Number.isSafeInteger(this.botSeatLeaseEpoch)) this.botSeatLeaseEpoch = 0;
            this.botSeatLeases.clear();
            this.botSeatLeaseEpoch += 1;
            let tableCounter = 1;
            THEMES.forEach(theme => {
                for (let i = 0; i < theme.count; i++) {
                    const tableId = `table-${tableCounter}`;
                    const tableNumber = i + 1;
                    const tableName = `${theme.name} #${tableNumber}`;
                    const processTimerEffects = (effects = []) => this._executeEffects(tableId, effects);
                    this.engines[tableId] = new GameEngine(
                        tableId,
                        theme.id,
                        tableName,
                        processTimerEffects,
                        'private',
                        this.botAccounts,
                        this._createBotSeatLeaseController(tableId),
                    );
                    tableCounter++;
                }
            });
            // Quick-play matchmaking pool: hidden from the lobby list, entered
            // only through the "Play Now" button. 3 per theme is plenty for now.
            const QP_TABLES_PER_THEME = 3;
            THEMES.forEach(theme => {
                for (let i = 1; i <= QP_TABLES_PER_THEME; i++) {
                    const tableId = `qp-${theme.id}-${i}`;
                    const tableName = `${theme.name} Quick Play`;
                    const processTimerEffects = (effects = []) => this._executeEffects(tableId, effects);
                    this.engines[tableId] = new GameEngine(
                        tableId,
                        theme.id,
                        tableName,
                        processTimerEffects,
                        'quickplay',
                        this.botAccounts,
                        this._createBotSeatLeaseController(tableId),
                    );
                    this.engines[tableId].qpGeneration = ++this.qpGenerationCounter;
                }
            });
            this.qpTimers = {};
            console.log(`${Object.keys(this.engines).length} in-memory game engines initialized (${tableCounter - 1} private + quick-play pool).`);
        }

        _createBotSeatLeaseController(tableId) {
            const owner = Object.freeze({
                tableId,
                epoch: this.botSeatLeaseEpoch,
                nonce: Symbol(`bot-seat:${tableId}`),
            });
            return Object.freeze({
                acquire: (botUserId) => {
                    if (!Number.isInteger(botUserId) || botUserId <= 0) return false;
                    const currentOwner = this.botSeatLeases.get(botUserId);
                    if (currentOwner && currentOwner !== owner) return false;
                    this.botSeatLeases.set(botUserId, owner);
                    return true;
                },
                release: (botUserId) => {
                    if (this.botSeatLeases.get(botUserId) !== owner) return false;
                    this.botSeatLeases.delete(botUserId);
                    return true;
                },
            });
        }

        getEngineById(tableId) {
            return Object.prototype.hasOwnProperty.call(this.engines, tableId)
                ? this.engines[tableId]
                : undefined;
        }
        getAllEngines() { return this.engines; }
        hasActiveOrPendingGame() {
            return Object.values(this.engines).some(engine => (
                engine.gameStartPending === true
                || engine.gameStarted === true
            ));
        }

        getStateForSocket(engineOrTableId, socket) {
            const engine = typeof engineOrTableId === 'string'
                ? this.getEngineById(engineOrTableId)
                : engineOrTableId;
            if (!engine || !socket) return null;

            const userId = socket.user?.id
                ?? Object.values(engine.players).find(player => player.socketId === socket.id)?.userId;
            const state = engine.getStateForClient({
                userId,
                isAdmin: socket.user?.is_admin === true,
                trustedAdminObserver: socket.data?.trustedAdminObserver === true,
            });
            // This is deliberately added after viewer-safe serialization. The
            // acknowledgement Set remains server-only, while each recipient
            // learns only whether their own current presentation was recorded.
            state.viewerRoundPresentationAcknowledged = Boolean(
                Number.isFinite(engine.roundSummary?.presentationReadyAt)
                && userId !== undefined
                && userId !== null
                && engine.roundPresentationAcknowledgements instanceof Set
                && engine.roundPresentationAcknowledgements.has(String(userId))
            );
            return state;
        }

        emitGameState(tableId) {
            const engine = this.getEngineById(tableId);
            if (!engine) return;

            // Connection and roster changes all converge here. Recompute the
            // acknowledgement quorum before any client receives authoritative
            // state so disconnects stop blocking immediately and reconnects
            // become blocking again until the replacement socket acknowledges.
            this.recomputeRoundPresentationReadiness(tableId);

            // Emit a separately serialized object to each authenticated seat.
            // A room-wide payload can never safely contain a player's hand.
            for (const player of Object.values(engine.players)) {
                if (player.isBot || !player.socketId) continue;
                const recipient = this.io.sockets?.sockets?.get(player.socketId);
                if (!recipient) continue;
                recipient.emit('gameState', this.getStateForSocket(engine, recipient));
            }
        }

        _activeConnectedPresentationHumans(engine) {
            const activeIds = new Set((engine?.playerOrder?.allIds || []).map(String));
            return Object.values(engine?.players || {}).filter(player => (
                !player.isBot
                && !player.isSpectator
                && activeIds.has(String(player.userId))
                && this._isTerminalHumanConnected(player)
            ));
        }

        recomputeRoundPresentationReadiness(tableId) {
            const engine = this.getEngineById(tableId);
            const summary = engine?.roundSummary;
            const presentationReadyAt = summary?.presentationReadyAt;
            if (!engine || !Number.isFinite(presentationReadyAt)) {
                this._clearRoundAdvanceTimer(tableId);
                return { active: false, changed: false, allConnectedHumansPresented: null };
            }

            if (!(engine.roundPresentationAcknowledgements instanceof Set)) {
                engine.roundPresentationAcknowledgements = new Set();
            }
            const connectedHumans = this._activeConnectedPresentationHumans(engine);
            const allConnectedHumansPresented = connectedHumans.every(player => (
                engine.roundPresentationAcknowledgements.has(String(player.userId))
            ));
            const changed = summary.allConnectedHumansPresented !== allConnectedHumansPresented;
            summary.allConnectedHumansPresented = allConnectedHumansPresented;
            const readiness = {
                active: true,
                changed,
                connectedHumanCount: connectedHumans.length,
                acknowledgedHumanCount: connectedHumans.filter(player => (
                    engine.roundPresentationAcknowledgements.has(String(player.userId))
                )).length,
                allConnectedHumansPresented,
            };
            this._reconcileAutomaticNextRoundTimer(tableId, readiness);
            return readiness;
        }

        _roundAdvanceNow() {
            return typeof this.roundAdvanceNowOverride === 'function'
                ? this.roundAdvanceNowOverride()
                : Date.now();
        }

        _clearRoundAdvanceTimer(tableId) {
            const timers = this.roundAdvanceTimers || (this.roundAdvanceTimers = {});
            const record = timers[tableId];
            if (!record) return;
            if (record.handle !== undefined && record.handle !== null) clearTimeout(record.handle);
            delete timers[tableId];
        }

        _clearRoundAdvanceTimers() {
            for (const tableId of Object.keys(this.roundAdvanceTimers || {})) {
                this._clearRoundAdvanceTimer(tableId);
            }
            this.roundAdvanceTimers = {};
        }

        _reconcileAutomaticNextRoundTimer(tableId, readiness = null) {
            const engine = this.getEngineById(tableId);
            const summary = engine?.roundSummary;
            const presentationReadyAt = Number(summary?.presentationReadyAt);
            if (!engine || engine.state !== 'Awaiting Next Round Trigger'
                || !Number.isFinite(presentationReadyAt)) {
                this._clearRoundAdvanceTimer(tableId);
                return { status: 'inactive' };
            }

            const now = this._roundAdvanceNow();
            const allConnectedHumansPresented = readiness?.allConnectedHumansPresented
                ?? summary.allConnectedHumansPresented === true;
            const presentationForceReadyAt = Number(summary.presentationForceReadyAt);
            const mode = allConnectedHumansPresented ? 'quorum' : 'force';
            const dueAt = allConnectedHumansPresented
                ? Math.max(now, presentationReadyAt)
                : (Number.isFinite(presentationForceReadyAt)
                    ? Math.max(now, presentationForceReadyAt)
                    : null);
            if (!Number.isFinite(dueAt)) {
                this._clearRoundAdvanceTimer(tableId);
                return { status: 'inactive' };
            }

            const timers = this.roundAdvanceTimers || (this.roundAdvanceTimers = {});
            const existing = timers[tableId];
            if (existing
                && existing.engine === engine
                && existing.summary === summary
                && existing.presentationReadyAt === presentationReadyAt
                && existing.mode === mode) {
                return { status: 'scheduled', dueAt: existing.dueAt };
            }

            this._clearRoundAdvanceTimer(tableId);
            const record = {
                engine,
                summary,
                presentationReadyAt,
                mode,
                dueAt,
                handle: null,
            };
            timers[tableId] = record;
            const timerFn = this.roundAdvanceTimerOverride || setTimeout;
            record.handle = timerFn(async () => {
                const currentTimers = this.roundAdvanceTimers || {};
                if (currentTimers[tableId] !== record) return;
                delete currentTimers[tableId];

                // Re-fetch and check both engine and summary identity. A reset,
                // replacement engine, or newer presentation can never be
                // advanced by an old callback, even if timestamps collide.
                const current = this.getEngineById(tableId);
                if (current !== record.engine
                    || current?.state !== 'Awaiting Next Round Trigger'
                    || current.roundSummary !== record.summary
                    || current.roundSummary?.presentationReadyAt !== record.presentationReadyAt) {
                    this._reconcileAutomaticNextRoundTimer(tableId);
                    return;
                }

                if (!current.isRoundPresentationAdvanceReady(this._roundAdvanceNow())) {
                    this._reconcileAutomaticNextRoundTimer(tableId);
                    return;
                }

                // Use the dealer captured in authoritative server state. The
                // existing engine boundary still validates it and advances only
                // as far as Dealing Pending; dealing remains a separate action.
                const dealerOfRoundId = current.roundSummary.dealerOfRoundId;
                await this.requestNextRound(tableId, dealerOfRoundId);
                this._reconcileAutomaticNextRoundTimer(tableId);
            }, Math.max(0, dueAt - now));
            record.handle?.unref?.();
            return { status: 'scheduled', dueAt };
        }

        ackRoundPresentation(tableId, userId, presentationReadyAt, socketId) {
            const engine = this.getEngineById(tableId);
            const summary = engine?.roundSummary;
            if (!engine || !summary || !Number.isFinite(summary.presentationReadyAt)
                || presentationReadyAt !== summary.presentationReadyAt) {
                return { accepted: false, reason: 'stale_presentation' };
            }

            const normalRoundCanAck = engine.state === 'Awaiting Next Round Trigger'
                && engine.settlement?.status === 'idle';
            const terminalCanAck = engine.state === 'Game Over'
                && engine.settlement?.status === 'complete';
            if (!normalRoundCanAck && !terminalCanAck) {
                return { accepted: false, reason: 'presentation_not_acknowledgeable' };
            }

            const player = engine.players?.[userId];
            if (!player || player.isBot || player.isSpectator
                || !engine.playerOrder.includes(userId)
                || player.disconnected || !socketId || player.socketId !== socketId
                || !this._isTerminalHumanConnected(player)) {
                return { accepted: false, reason: 'ineligible_player' };
            }

            const acknowledgementKey = String(userId);
            const alreadyAcknowledged = engine.roundPresentationAcknowledgements.has(acknowledgementKey);
            if (!alreadyAcknowledged) {
                engine.roundPresentationAcknowledgements.add(acknowledgementKey);
            }
            const readiness = this.recomputeRoundPresentationReadiness(tableId);
            // Duplicate delivery is expected on unreliable mobile links. Keep
            // it idempotent and do not turn retries into table-wide broadcast
            // amplification. A real acknowledgement or quorum change still
            // publishes authoritative state immediately.
            if (!alreadyAcknowledged || readiness.changed) {
                this.emitGameState(tableId);
            }
            return {
                accepted: true,
                alreadyAcknowledged,
                presentationReadyAt: summary.presentationReadyAt,
                allConnectedHumansPresented: readiness.allConnectedHumansPresented,
            };
        }

        getLobbyState() {
            const groupedByTheme = THEMES.map(theme => {
                const themeTables = Object.values(this.engines)
                    .filter(engine => engine.theme === theme.id && engine.tableType !== 'quickplay')
                    .map(engine => {
                        const activePlayers = Object.values(engine.players).filter(p => !p.isSpectator);
                        return {
                            tableId: engine.tableId,
                            tableName: engine.tableName,
                            state: engine.state,
                            playerCount: activePlayers.length,
                            players: activePlayers.map(p => ({ userId: p.userId, playerName: p.playerName }))
                        };
                    });
                return { ...theme, cost: TABLE_COSTS[theme.id] || 0, tables: themeTables };
            });
            return { themes: groupedByTheme, serverVersion: SERVER_VERSION };
        }

        // ===================== QUICK PLAY MATCHMAKER =====================
        // Fill to three, stop for an explicit table-wide decision, then either
        // freeze/start that roster or seek one human fourth. If no human claims
        // the seat before a private randomized 8-15s deadline, a narrowly
        // authorized fallback bot takes seat four and the 4P game starts.

        _humanCount(engine) {
            return Object.values(engine.players).filter(p => !p.isBot && !p.isSpectator).length;
        }

        _quickPlayNow() {
            return typeof this.nowOverride === 'function' ? this.nowOverride() : Date.now();
        }

        _quickPlayFourthFallbackDelay() {
            const randomFn = typeof this.quickPlayRandomOverride === 'function'
                ? this.quickPlayRandomOverride
                : Math.random;
            const sample = Number(randomFn());
            // Math.random() is [0, 1). Reject malformed test/runtime sources
            // rather than allowing an out-of-range matchmaking deadline.
            const unit = Number.isFinite(sample) && sample >= 0 && sample < 1
                ? sample
                : Math.random();
            const inclusiveRange = QUICKPLAY_FOURTH_FALLBACK_MAX_DELAY_MS
                - QUICKPLAY_FOURTH_FALLBACK_MIN_DELAY_MS + 1;
            return QUICKPLAY_FOURTH_FALLBACK_MIN_DELAY_MS
                + Math.floor(unit * inclusiveRange);
        }

        async _loadAffordableQuickPlayBotBalances(engine) {
            // Empty bot rosters are retained for lightweight unit/local engines,
            // whose negative-id bots never touch the funded ledger. Production
            // always supplies persistent bot principals.
            if (this.botAccounts.length === 0) return null;

            const balances = await loadBotBalances(
                this.pool,
                this.botAccounts.map(profile => profile.id),
            );
            const buyInCents = Math.round(Number(TABLE_COSTS[engine.theme] || 0) * 100);
            return new Map([...balances].filter(([, tokens]) => (
                Math.round(Number(tokens) * 100) >= buyInCents
            )));
        }

        _quickPlayMatchmakingNotice(engine, code = 'HIGH_STAKES_POOL_THIN') {
            const currentCostCents = Math.round(Number(TABLE_COSTS[engine.theme] || 0) * 100);
            const recommendedTheme = THEMES
                .filter(theme => Math.round(Number(TABLE_COSTS[theme.id] || 0) * 100) < currentCostCents)
                .sort((left, right) => TABLE_COSTS[right.id] - TABLE_COSTS[left.id])[0] || null;
            return {
                code,
                recommendedThemeId: recommendedTheme?.id || null,
                recommendedTableName: recommendedTheme?.name || null,
            };
        }

        _quickPlayMatchmakingMessage(engine) {
            const recommendation = this._quickPlayMatchmakingNotice(engine);
            return recommendation.recommendedTableName
                ? `We couldn't fill this table. Try ${recommendation.recommendedTableName} while more high rollers arrive.`
                : "We couldn't fill this table yet. Please keep waiting or try again shortly.";
        }

        _normalizeQuickPlayFallbackMarker(engine) {
            if (!engine?.qpFallbackBot
                || engine.playerOrder.allIds[3] === engine.qpFallbackBot.userId) return false;
            engine.qpFallbackBot = null;
            return true;
        }

        _clearQuickPlayTimer(tableId, kind) {
            const timers = this.qpTimers[tableId];
            const record = timers?.[kind];
            if (!record) return;
            const handle = Object.prototype.hasOwnProperty.call(record, 'handle')
                ? record.handle
                : record;
            if (handle !== undefined && handle !== null) clearTimeout(handle);
            timers[kind] = null;
        }

        _advanceQuickPlayPhase(engine, phase, windowEndsAt = null) {
            this._clearQuickPlayTimer(engine.tableId, 'fill');
            this._clearQuickPlayTimer(engine.tableId, 'window');
            const serviceGeneration = Number.isSafeInteger(this.qpGenerationCounter)
                ? this.qpGenerationCounter
                : 0;
            const engineGeneration = Number.isSafeInteger(engine.qpGeneration)
                ? engine.qpGeneration
                : 0;
            this.qpGenerationCounter = Math.max(serviceGeneration, engineGeneration) + 1;
            engine.qpGeneration = this.qpGenerationCounter;
            engine.qpPhase = phase;
            engine.qpWindowEndsAt = windowEndsAt;
            engine.qpMatchmakingNotice = null;
            return engine.qpGeneration;
        }

        canAcceptQuickPlayHuman(engine) {
            if (!engine || engine.tableType !== 'quickplay' || engine.gameStarted || engine.gameStartPending) return false;
            if (engine.qpPhase === 'filling') return engine.playerOrder.count < 3;
            if (engine.qpPhase === 'seeking_fourth') {
                return engine.playerOrder.count === 3
                    && Number.isFinite(engine.qpWindowEndsAt)
                    && this._quickPlayNow() < engine.qpWindowEndsAt;
            }
            return false;
        }

        findQuickPlayTable(themeId) {
            const pool = Object.values(this.engines).filter(engine => (
                engine.theme === themeId && this.canAcceptQuickPlayHuman(engine)
            ));
            const seekingFourth = pool.find(engine => engine.qpPhase === 'seeking_fourth');
            if (seekingFourth) return seekingFourth;
            // Prefer a table already filling with at least one human...
            const filling = pool.find(engine => this._humanCount(engine) > 0);
            if (filling) return filling;
            // ...else a completely fresh table...
            const empty = pool.find(engine => engine.playerOrder.count === 0);
            if (empty) return empty;
            // ...else anything not started with an open seat (bots-only leftovers).
            return pool[0] || null;
        }

        // Intentionally synchronous: callers finish balance/auth I/O first,
        // then select and mutate the target table in one JavaScript turn.
        claimQuickPlaySeat(themeId, user, socketId, tokens) {
            const existingEngine = Object.values(this.engines).find(engine => engine.players[user.id]);
            if (existingEngine?.tableType === 'quickplay'
                && existingEngine.theme === themeId
                && !existingEngine.gameStarted
                && !existingEngine.gameStartPending) {
                existingEngine.reconnectPlayer(user.id, { id: socketId }, tokens);
                return existingEngine;
            }

            const engine = this.findQuickPlayTable(themeId);
            if (!engine || !this.canAcceptQuickPlayHuman(engine)) return null;
            engine.joinTable(user, socketId, tokens, false);
            const player = engine.players[user.id];
            if (!player || player.isSpectator || !engine.playerOrder.includes(user.id)) {
                if (player?.isSpectator && !engine.gameStarted && !engine.gameStartPending) {
                    delete engine.players[user.id];
                }
                return null;
            }
            this.evaluateQuickPlayTable(engine.tableId, { restartFill: true });
            return engine;
        }

        // restartFill: true when a human just took a seat — their arrival
        // restarts the next seat's 5-10s window from zero.
        evaluateQuickPlayTable(tableId, { restartFill = false } = {}) {
            const engine = this.engines[tableId];
            if (!engine || engine.tableType !== 'quickplay') return;
            const timers = this.qpTimers[tableId] || (this.qpTimers[tableId] = {});
            const timerFn = this.timerOverride || setTimeout;

            if (engine.gameStarted || engine.gameStartPending) {
                this._clearQuickPlayTimer(tableId, 'fill');
                this._clearQuickPlayTimer(tableId, 'window');
                engine.qpWindowEndsAt = null;
                return;
            }

            const humans = this._humanCount(engine);
            const seated = engine.playerOrder.count;

            if (humans === 0) {
                // Abandoned mid-fill: sweep the bots so the table returns to the
                // pool clean. (Seated humans who merely disconnected pre-game are
                // removed by disconnectPlayer, so 0 humans really means empty.)
                this._advanceQuickPlayPhase(engine, 'filling');
                let guard = 8;
                while (guard-- > 0 && Object.values(engine.players).some(p => p.isBot)) engine.removeBot();
                if (engine.playerOrder.count === 0) engine.state = 'Waiting for Players';
                this.emitGameState(tableId);
                return;
            }

            if (seated < 3) {
                if (engine.qpPhase !== 'filling' || restartFill) {
                    this._advanceQuickPlayPhase(engine, 'filling');
                }
                if (!timers.fill) {
                    const delay = 5000 + Math.floor(Math.random() * 5000);
                    const generation = engine.qpGeneration;
                    const expectedSeats = seated;
                    const record = { generation, expectedSeats, handle: null };
                    timers.fill = record;
                    record.handle = timerFn(async () => {
                        if (timers.fill === record) timers.fill = null;
                        let eng = this.engines[tableId];
                        if (!eng || eng.gameStarted || eng.gameStartPending
                            || eng.qpPhase !== 'filling'
                            || eng.qpGeneration !== generation
                            || eng.playerOrder.count !== expectedSeats
                            || this._humanCount(eng) < 1
                            || eng.playerOrder.count >= 3) return;

                        let eligibleBotBalances;
                        let noticeCode = 'HIGH_STAKES_POOL_THIN';
                        try {
                            eligibleBotBalances = await this._loadAffordableQuickPlayBotBalances(eng);
                        } catch (error) {
                            noticeCode = 'MATCHMAKING_TEMPORARILY_UNAVAILABLE';
                            eligibleBotBalances = new Map();
                            console.error(`[QUICKPLAY] Could not verify funded bot seats for ${tableId}.`, error);
                        }

                        // The ledger read yielded. Revalidate the exact engine,
                        // roster, phase, and timer generation before taking a
                        // seat so a human arrival/reset always wins the race.
                        eng = this.engines[tableId];
                        if (!eng || eng.gameStarted || eng.gameStartPending
                            || eng.qpPhase !== 'filling'
                            || eng.qpGeneration !== generation
                            || eng.playerOrder.count !== expectedSeats
                            || this._humanCount(eng) < 1
                            || eng.playerOrder.count >= 3) return;

                        let bot = null;
                        try {
                            bot = eng.addBotPlayer({ eligibleBotBalances });
                        } catch (error) {
                            console.error(`[QUICKPLAY] Could not fill a funded seat on ${tableId}.`, error);
                        }
                        if (!bot) {
                            // Keep accepting human arrivals and quietly retry in
                            // another normal fill window. The durable client
                            // notice gives the waiting player an immediate,
                            // lower-stakes alternative without exposing bots.
                            this.evaluateQuickPlayTable(tableId, { restartFill: true });
                            const waitingEngine = this.engines[tableId];
                            if (waitingEngine === eng
                                && waitingEngine.qpPhase === 'filling'
                                && waitingEngine.playerOrder.count === expectedSeats) {
                                waitingEngine.qpMatchmakingNotice = this._quickPlayMatchmakingNotice(
                                    waitingEngine,
                                    noticeCode,
                                );
                                this.emitGameState(tableId);
                            }
                            return;
                        }
                        eng.qpMatchmakingNotice = null;
                        this.emitGameState(tableId);
                        this.evaluateQuickPlayTable(tableId, { restartFill: true });
                    }, delay);
                }
                return;
            }

            if (seated === 3) {
                this._clearQuickPlayTimer(tableId, 'fill');
                if (engine.qpPhase === 'seeking_fourth') return;
                if (engine.qpPhase !== 'decision_pending') {
                    this._advanceQuickPlayPhase(engine, 'decision_pending');
                    this.emitGameState(tableId);
                }
                return;
            }

            const fourthPlayer = engine.players[engine.playerOrder.allIds[3]];
            if (seated === 4
                && engine.qpPhase === 'seeking_fourth'
                && Number.isFinite(engine.qpWindowEndsAt)
                && this._quickPlayNow() < engine.qpWindowEndsAt
                && fourthPlayer?.isBot !== true) {
                const generation = this._advanceQuickPlayPhase(engine, 'starting_4');
                this.emitGameState(tableId);
                void this._startQuickPlayGame(tableId, generation, 4);
                return;
            }

            // A terminal reset may retain an intact four-human roster. Starting
            // it again would charge every player without fresh consent, so it
            // returns to an explicit, generation-scoped 4P decision. The same
            // recovery handles a rolled-back 4P start transaction.
            if (seated === 4 && fourthPlayer?.isBot !== true
                && engine.qpPhase !== 'decision_pending') {
                this._advanceQuickPlayPhase(engine, 'decision_pending');
                this.emitGameState(tableId);
            }
        }

        quickPlayDecision(tableId, userId, choice, generation) {
            const engine = this.engines[tableId];
            const player = engine?.players[userId];
            const seated = engine?.playerOrder.count;
            const fourthPlayer = seated === 4
                ? engine.players[engine.playerOrder.allIds[3]]
                : null;
            if (!engine || engine.tableType !== 'quickplay'
                || !player || player.isBot || player.isSpectator || player.disconnected
                || engine.gameStarted || engine.gameStartPending
                || engine.qpPhase !== 'decision_pending'
                || engine.qpGeneration !== generation
                || ![3, 4].includes(seated)
                || this._humanCount(engine) < 1
                || (seated === 4 && (fourthPlayer?.isBot || fourthPlayer?.isSpectator))) {
                return { accepted: false, reason: 'stale_or_ineligible' };
            }

            if ((choice === 'start3' && seated === 3) || (choice === 'start4' && seated === 4)) {
                const playerMode = seated;
                const startGeneration = this._advanceQuickPlayPhase(engine, `starting_${playerMode}`);
                this.emitGameState(tableId);
                void this._startQuickPlayGame(tableId, startGeneration, playerMode);
                return { accepted: true, choice, generation: startGeneration };
            }

            if (choice === 'seek4' && seated === 3) {
                const fallbackDelay = this._quickPlayFourthFallbackDelay();
                const deadline = this._quickPlayNow() + fallbackDelay;
                const searchGeneration = this._advanceQuickPlayPhase(engine, 'seeking_fourth', deadline);
                const timers = this.qpTimers[tableId] || (this.qpTimers[tableId] = {});
                const timerFn = this.timerOverride || setTimeout;
                const expectedHumans = this._humanCount(engine);
                const expectedRoster = [...engine.playerOrder.allIds];
                const record = {
                    engine,
                    generation: searchGeneration,
                    deadline,
                    fallbackDelay,
                    expectedRoster,
                    handle: null,
                };
                timers.window = record;
                const currentSearchEngine = () => {
                    const current = this.engines[tableId];
                    if (timers.window !== record
                        || !current || current !== record.engine
                        || current.gameStarted || current.gameStartPending
                        || current.qpPhase !== 'seeking_fourth'
                        || current.qpGeneration !== searchGeneration
                        || current.playerOrder.count !== 3
                        || current.playerOrder.allIds.some((id, index) => id !== expectedRoster[index])
                        || this._humanCount(current) !== expectedHumans
                        || current.qpWindowEndsAt !== deadline
                    ) return null;
                    return current;
                };
                const expireSearch = async () => {
                    let current = currentSearchEngine();
                    if (!current) return;
                    const remaining = deadline - this._quickPlayNow();
                    if (remaining > 0) {
                        record.handle = timerFn(expireSearch, remaining);
                        return;
                    }

                    let eligibleBotBalances;
                    let noticeCode = 'HIGH_STAKES_POOL_THIN';
                    try {
                        eligibleBotBalances = await this._loadAffordableQuickPlayBotBalances(current);
                    } catch (error) {
                        noticeCode = 'MATCHMAKING_TEMPORARILY_UNAVAILABLE';
                        eligibleBotBalances = new Map();
                        console.error(`[QUICKPLAY] Could not verify a funded fourth seat for ${tableId}.`, error);
                    }
                    current = currentSearchEngine();
                    if (!current) return;

                    let fallbackBot = null;
                    try {
                        fallbackBot = current.addQuickPlayFallbackBot({
                            generation: searchGeneration,
                            deadline,
                            now: this._quickPlayNow(),
                            eligibleBotBalances,
                        });
                    } catch (error) {
                        console.error(`[QUICKPLAY] Could not create a fourth-seat fallback on ${tableId}.`, error);
                    }
                    if (!fallbackBot) {
                        this._advanceQuickPlayPhase(current, 'decision_pending');
                        current.qpMatchmakingNotice = this._quickPlayMatchmakingNotice(
                            current,
                            noticeCode,
                        );
                        this.emitGameState(tableId);
                        return;
                    }
                    const startGeneration = this._advanceQuickPlayPhase(current, 'starting_4');
                    if (!current.bindQuickPlayFallbackStart(
                        fallbackBot.userId,
                        searchGeneration,
                        startGeneration,
                    )) {
                        current.removeBotPlayer(fallbackBot.userId);
                        this._advanceQuickPlayPhase(current, 'decision_pending');
                        this.emitGameState(tableId);
                        return;
                    }
                    this.emitGameState(tableId);
                    void this._startQuickPlayGame(tableId, startGeneration, 4, fallbackBot.userId);
                };
                record.handle = timerFn(expireSearch, fallbackDelay);
                this.emitGameState(tableId);
                return { accepted: true, choice, generation: searchGeneration };
            }

            return { accepted: false, reason: 'invalid_choice' };
        }

        _recoverQuickPlayFallbackStart(tableId, engine, generation, expectedPhase, fallbackBotId) {
            const current = this.engines[tableId];
            // Recover only the exact unchanged fallback generation. Never
            // mutate a newer table or a transaction still marked pending.
            if (fallbackBotId === null
                || current !== engine
                || current.gameStarted
                || current.gameStartPending
                || current.qpPhase !== expectedPhase
                || current.qpGeneration !== generation
                || current.qpFallbackBot?.userId !== fallbackBotId
                || current.qpFallbackBot?.startGeneration !== generation) return false;
            current.removeBotPlayer(fallbackBotId);
            this._advanceQuickPlayPhase(current, 'decision_pending');
            this.emitGameState(tableId);
            return true;
        }

        async _startQuickPlayGame(tableId, generation, playerMode, fallbackBotId = null) {
            const engine = this.engines[tableId];
            const expectedPhase = playerMode === 3 ? 'starting_3' : 'starting_4';
            if (!engine || engine.gameStarted || engine.gameStartPending
                || engine.qpPhase !== expectedPhase
                || engine.qpGeneration !== generation
                || engine.playerOrder.count !== playerMode) return;
            const fourthPlayerId = playerMode === 4 ? engine.playerOrder.allIds[3] : null;
            if (fallbackBotId !== null && (
                fourthPlayerId !== fallbackBotId
                || engine.players[fallbackBotId]?.isBot !== true
                || engine.qpFallbackBot?.userId !== fallbackBotId
                || engine.qpFallbackBot?.startGeneration !== generation
            )) return;
            const firstHuman = Object.values(engine.players).find(p => !p.isBot && !p.isSpectator);
            if (!firstHuman) { this.evaluateQuickPlayTable(tableId); return; }

            const expectedRoster = [...engine.playerOrder.allIds];
            const fundedBotIds = expectedRoster.filter(id => (
                Number.isInteger(id)
                && id > 0
                && engine.players[id]?.isBot === true
            ));
            if (fundedBotIds.length > 0 && this.botAccounts.length > 0) {
                let affordableBotBalances;
                let noticeCode = 'HIGH_STAKES_POOL_THIN';
                try {
                    affordableBotBalances = await this._loadAffordableQuickPlayBotBalances(engine);
                } catch (error) {
                    noticeCode = 'MATCHMAKING_TEMPORARILY_UNAVAILABLE';
                    affordableBotBalances = new Map();
                    console.error(`[QUICKPLAY] Could not recheck bot buy-ins before starting ${tableId}.`, error);
                }

                const current = this.engines[tableId];
                if (current !== engine
                    || current.gameStarted || current.gameStartPending
                    || current.qpPhase !== expectedPhase
                    || current.qpGeneration !== generation
                    || current.playerOrder.count !== playerMode
                    || current.playerOrder.allIds.some((id, index) => id !== expectedRoster[index])) return;

                const unaffordableBotIds = fundedBotIds.filter(id => !affordableBotBalances.has(id));
                if (unaffordableBotIds.length > 0) {
                    for (const botId of unaffordableBotIds) current.removeBotPlayer(botId);
                    // If an earlier bot seat was removed, the funded fourth may
                    // slide into the ordinary three-seat roster. It is still a
                    // valid funded bot, but no longer the generation-bound
                    // fourth-seat fallback.
                    this._normalizeQuickPlayFallbackMarker(current);
                    const nextPhase = current.playerOrder.count >= 3 ? 'decision_pending' : 'filling';
                    this._advanceQuickPlayPhase(current, nextPhase);
                    if (nextPhase === 'filling') {
                        this.evaluateQuickPlayTable(tableId, { restartFill: true });
                    }
                    current.qpMatchmakingNotice = this._quickPlayMatchmakingNotice(current, noticeCode);
                    this.emitGameState(tableId);
                    return;
                }
            }

            engine.qpWindowEndsAt = null;
            try {
                await this.startGame(tableId, firstHuman.userId, {
                    quickPlayStart: { generation, playerMode, fallbackBotId },
                });
            } catch (error) {
                console.error(`[QUICKPLAY] Start rejected for ${tableId}.`, error);
                this._recoverQuickPlayFallbackStart(
                    tableId,
                    engine,
                    generation,
                    expectedPhase,
                    fallbackBotId,
                );
                return;
            }
            if (!engine.gameStarted) {
                const fundingRecovery = engine.qpFundingShortageRecovery;
                if (fundingRecovery?.startGeneration === generation) {
                    engine.qpFundingShortageRecovery = null;
                    this.evaluateQuickPlayTable(tableId);
                    const current = this.engines[tableId];
                    if (current === engine
                        && !current.gameStarted
                        && !current.gameStartPending
                        && this._humanCount(current) > 0) {
                        this._normalizeQuickPlayFallbackMarker(current);
                        current.qpMatchmakingNotice = this._quickPlayMatchmakingNotice(
                            current,
                            fundingRecovery.code,
                        );
                        this.emitGameState(tableId);
                    }
                    return;
                }
                if (this._recoverQuickPlayFallbackStart(
                    tableId,
                    engine,
                    generation,
                    expectedPhase,
                    fallbackBotId,
                )) return;
                this.evaluateQuickPlayTable(tableId);
            }
        }
        // =================================================================

        async playCard(tableId, userId, card) {
            await this._performAction(tableId, (engine) => engine.playCard(userId, card));
        }
        
        async startGame(tableId, requestingUserId, options = {}) {
            await this._performAction(tableId, (engine) => engine.startGame(requestingUserId, options));
            if (this.engines[tableId]?.tableType === 'quickplay') this.evaluateQuickPlayTable(tableId);
        }
        
        async dealCards(tableId, requestingUserId) {
            await this._performAction(tableId, (engine) => engine.dealCards(requestingUserId));
        }

        async placeBid(tableId, userId, bid) {
            await this._performAction(tableId, (engine) => engine.placeBid(userId, bid));
        }

        async chooseTrump(tableId, userId, suit) {
            await this._performAction(tableId, (engine) => engine.chooseTrump(userId, suit));
        }

        async submitFrogDiscards(tableId, userId, discards) {
            await this._performAction(tableId, (engine) => engine.submitFrogDiscards(userId, discards));
        }

        async requestNextRound(tableId, userId) {
            await this._performAction(tableId, (engine) => engine.requestNextRound(userId));
        }

        async submitDrawVote(tableId, userId, vote) {
            await this._performAction(tableId, (engine) => engine.submitDrawVote(userId, vote));
        }

        async requestDraw(tableId, userId) {
            await this._performAction(tableId, (engine) => {
                const result = engine.requestDraw(userId);
                if (engine.drawRequest.isActive && engine.pendingBotAction) {
                    clearTimeout(engine.pendingBotAction);
                    engine.pendingBotAction = null;
                }
                return result;
            });
        }

        async updateInsuranceSetting(tableId, userId, settingType, value) {
            await this._performAction(tableId, (engine) => engine.updateInsuranceSetting(userId, settingType, value));
        }

        async forfeitGame(tableId, userId) {
            await this._performAction(tableId, (engine) => engine.forfeitGame(userId));
        }

        async startForfeitTimer(tableId, userId, targetPlayerName) {
            await this._performAction(tableId, (engine) => engine.startForfeitTimer(userId, targetPlayerName));
        }

        async resetGame(tableId) {
            const engine = this.getEngineById(tableId);
            const isTerminal = engine
                && (engine.state === 'Game Over' || engine.state === 'DrawComplete');
            const terminalSettlementBlocked = isTerminal
                && engine.settlement
                && engine.settlement.status !== 'complete';
            if (!engine || terminalSettlementBlocked
                || (isTerminal && !engine.isRoundPresentationAdvanceReady())) {
                return false;
            }
            await this._performAction(tableId, (engine) => engine.reset());
            if (this.engines[tableId]?.tableType === 'quickplay') {
                this.evaluateQuickPlayTable(tableId);
            }
            this.evaluateTerminalCleanup(tableId);
            return true;
        }
        
        async handleGameOver(payload) {
            return transactionManager.handleNormalGameTransactions(this.pool, payload);
        }

        async handleDrawOutcome(payload) {
            const { outcome, ...tableData } = payload;
            return transactionManager.handleDrawTransactions(this.pool, tableData, outcome);
        }

        async handleForfeit(payload) {
            return transactionManager.handleForfeitTransactions(this.pool, payload);
        }

        async _runSettlementWithRetry(engine, kind, operation) {
            if (!engine.settlement || engine.settlement.kind !== kind) {
                engine.beginSettlement(kind);
            }

            let lastError = null;
            for (let attempt = 1; attempt <= MAX_SETTLEMENT_ATTEMPTS; attempt++) {
                engine.settlement.status = 'pending';
                engine.settlement.attempts = attempt;
                try {
                    const result = await operation();
                    engine.completeSettlement();
                    return { ok: true, result };
                } catch (error) {
                    lastError = error;
                    engine.settlement.lastErrorCode = error?.code || 'SETTLEMENT_ERROR';
                    const shouldRetry = attempt < MAX_SETTLEMENT_ATTEMPTS
                        && isTransientSettlementError(error);
                    if (!shouldRetry) break;
                    await this._waitForSettlementRetry(attempt);
                }
            }

            engine.failSettlement(lastError?.code || 'SETTLEMENT_ERROR');
            return { ok: false, error: lastError };
        }

        async _waitForSettlementRetry(attempt) {
            if (this.settlementRetryDelayOverride) {
                await this.settlementRetryDelayOverride(attempt);
                return;
            }
            const delay = attempt === 1 ? 100 : 400;
            await new Promise(resolve => setTimeout(resolve, delay));
        }

        resetAllEngines() {
            console.log("[ADMIN] Resetting all game engines to initial state.");
            this._clearQuickPlayTimers();
            this._clearTerminalCleanupTimers();
            this._clearRoundAdvanceTimers();
            this.engines = {};
            this._initializeEngines();
            this.io.emit('lobbyState', this.getLobbyState());
        }

        _clearQuickPlayTimers() {
            for (const timers of Object.values(this.qpTimers || {})) {
                const fillHandle = timers?.fill && Object.prototype.hasOwnProperty.call(timers.fill, 'handle')
                    ? timers.fill.handle
                    : timers?.fill;
                const windowHandle = timers?.window && Object.prototype.hasOwnProperty.call(timers.window, 'handle')
                    ? timers.window.handle
                    : timers?.window;
                if (fillHandle !== undefined && fillHandle !== null) clearTimeout(fillHandle);
                if (windowHandle !== undefined && windowHandle !== null) clearTimeout(windowHandle);
            }
            this.qpTimers = {};
        }

        _terminalHumanPlayers(engine) {
            return Object.values(engine?.players || {})
                .filter(player => !player.isBot && !player.isSpectator);
        }

        _isTerminalHumanConnected(player) {
            if (!player || player.isBot || player.disconnected || !player.socketId) return false;
            const connectedSockets = this.io?.sockets?.sockets;
            if (!connectedSockets || typeof connectedSockets.get !== 'function') return true;
            const socket = connectedSockets.get(player.socketId);
            return !!socket && socket.connected !== false;
        }

        _terminalConnectivity(engine) {
            const humans = this._terminalHumanPlayers(engine);
            return {
                humans,
                connectedHumans: humans.filter(player => this._isTerminalHumanConnected(player)),
            };
        }

        _clearTerminalCleanupTimer(tableId) {
            const timers = this.terminalCleanupTimers || (this.terminalCleanupTimers = {});
            const record = timers[tableId];
            if (!record) return;
            if (record.handle !== undefined && record.handle !== null) clearTimeout(record.handle);
            delete timers[tableId];
        }

        _clearTerminalCleanupTimers() {
            for (const tableId of Object.keys(this.terminalCleanupTimers || {})) {
                this._clearTerminalCleanupTimer(tableId);
            }
            this.terminalCleanupTimers = {};
        }

        _resetAbandonedTerminalTable(tableId, engine, terminalState, terminalGameId) {
            // Socket bookkeeping is authoritative for terminal retention. If a
            // disconnect event was lost, reconcile the stale player flag before
            // reset so GameEngine removes the abandoned human seat.
            for (const player of this._terminalHumanPlayers(engine)) {
                if (!this._isTerminalHumanConnected(player)) {
                    player.disconnected = true;
                    player.socketId = null;
                }
            }

            console.log(`[CLEANUP] Reclaiming abandoned ${terminalState} table ${tableId}.`);
            engine.reset();
            if (engine.state === terminalState && engine.gameId === terminalGameId) return;

            this.emitGameState(tableId);
            this.io.emit('lobbyState', this.getLobbyState());

            if (engine.tableType === 'quickplay') {
                this.evaluateQuickPlayTable(tableId);
                return;
            }

            // Preserve the admin bot-table testing loop, but revalidate that no
            // human joined during the delay before starting another bot game.
            const activePlayers = Object.values(engine.players).filter(player => !player.isSpectator);
            const allBots = activePlayers.length >= 3 && activePlayers.every(player => player.isBot);
            if (allBots) {
                setTimeout(() => {
                    const current = this.getEngineById(tableId);
                    const currentActivePlayers = Object.values(current?.players || {})
                        .filter(player => !player.isSpectator);
                    if (current === engine
                        && current.state === 'Ready to Start'
                        && currentActivePlayers.length >= 3
                        && currentActivePlayers.every(player => player.isBot)) {
                        console.log(`[BOT] Starting new bot-only game on table ${tableId}`);
                        const firstBot = currentActivePlayers[0];
                        this._performAction(tableId, eng => eng.startGame(firstBot.userId));
                    }
                }, 3000);
            }
        }

        evaluateTerminalCleanup(tableId) {
            const engine = this.getEngineById(tableId);
            const terminalState = engine?.state;
            const isTerminal = terminalState === 'Game Over' || terminalState === 'DrawComplete';
            if (!engine || !isTerminal || engine.settlement?.status !== 'complete') {
                this._clearTerminalCleanupTimer(tableId);
                return { status: 'inactive' };
            }

            const { humans, connectedHumans } = this._terminalConnectivity(engine);
            if (connectedHumans.length > 0) {
                this._clearTerminalCleanupTimer(tableId);
                return { status: 'held', connectedHumans: connectedHumans.length };
            }

            const kind = humans.length === 0 ? 'empty' : 'disconnected';
            const delay = kind === 'empty'
                ? TERMINAL_EMPTY_CLEANUP_DELAY_MS
                : (engine.tableType === 'quickplay'
                    ? TERMINAL_QUICKPLAY_DISCONNECTED_CLEANUP_DELAY_MS
                    : TERMINAL_DISCONNECTED_CLEANUP_DELAY_MS);
            const terminalGameId = engine.gameId;
            const timers = this.terminalCleanupTimers || (this.terminalCleanupTimers = {});
            const existing = timers[tableId];
            if (existing
                && existing.engine === engine
                && existing.terminalState === terminalState
                && existing.terminalGameId === terminalGameId
                && existing.kind === kind) {
                return { status: 'scheduled', kind, delay };
            }

            this._clearTerminalCleanupTimer(tableId);
            const record = {
                engine,
                terminalState,
                terminalGameId,
                kind,
                delay,
                handle: null,
            };
            timers[tableId] = record;
            const timerFn = this.terminalCleanupTimerOverride || setTimeout;
            record.handle = timerFn(() => {
                const currentTimers = this.terminalCleanupTimers || {};
                if (currentTimers[tableId] !== record) return;
                delete currentTimers[tableId];

                const current = this.getEngineById(tableId);
                if (current !== engine
                    || current.state !== terminalState
                    || current.gameId !== terminalGameId
                    || current.settlement?.status !== 'complete') return;

                const currentConnectivity = this._terminalConnectivity(current);
                if (currentConnectivity.connectedHumans.length > 0) return;
                const currentKind = currentConnectivity.humans.length === 0 ? 'empty' : 'disconnected';
                if (currentKind !== kind) {
                    this.evaluateTerminalCleanup(tableId);
                    return;
                }

                this._resetAbandonedTerminalTable(tableId, current, terminalState, terminalGameId);
            }, delay);
            record.handle?.unref?.();
            console.log(`[CLEANUP] ${terminalState} table ${tableId} is ${kind}; cleanup scheduled in ${delay}ms.`);
            return { status: 'scheduled', kind, delay };
        }

        async _performAction(tableId, actionFn) {
            const engine = this.getEngineById(tableId);
            if (!engine) return;

            const result = actionFn(engine);
            if (result && result.effects) {
                await this._executeEffects(tableId, result.effects);
            }
        }
        
        async _executeEffects(tableId, effects = []) {
            if (!effects || effects.length === 0) return;
            const engine = this.getEngineById(tableId);

            for (const effect of effects) {
                switch (effect.type) {
                    case 'BROADCAST_STATE':
                        this.emitGameState(tableId);
                        // --- THE FIX: No longer call _triggerBots here. ---
                        
                        // Log insurance hindsight values for bots when round ends
                        if (engine.roundSummary && engine.roundSummary.insuranceHindsight && engine.gameId) {
                            console.log(`[Insurance] Round ended with hindsight data for game ${engine.gameId}`);
                            console.log(`[Insurance] Insurance was active:`, engine.insurance.isActive);
                            console.log(`[Insurance] Deal executed:`, engine.insurance.dealExecuted);
                            console.log(`[Insurance] Hindsight data:`, engine.roundSummary.insuranceHindsight);
                            // Store the hindsight data before setTimeout since roundSummary might be cleared
                            const hindsightDataSnapshot = { ...engine.roundSummary.insuranceHindsight };
                            setTimeout(async () => {
                                for (const botId in engine.bots) {
                                    const bot = engine.bots[botId];
                                    const hindsightData = hindsightDataSnapshot[bot.playerName];
                                    if (hindsightData) {
                                        console.log(`[Insurance] Bot ${bot.playerName} hindsight:`, hindsightData);
                                        // Log the decision
                                        await this.adaptiveInsurance.logInsuranceDecision(
                                            engine.gameId,
                                            bot.playerName,
                                            engine,
                                            engine.insurance.dealExecuted,
                                            hindsightData.hindsightValue
                                        );
                                        
                                        // Bots no longer chat about their insurance hindsight
                                        // (July 2026) — the decision logging above still runs.
                                    }
                                }
                            }, 3000); // Delay so it appears after round summary
                        }
                        break;
                    case 'EMIT_TO_SOCKET':
                        this.io.to(effect.payload.socketId).emit(effect.payload.event, effect.payload.data);
                        break;
                    case 'EMIT_TO_TABLE':
                        this.io.to(tableId).emit(effect.payload.event, effect.payload.data || {});
                        break;
                    case 'UPDATE_LOBBY':
                        this.io.emit('lobbyState', this.getLobbyState());
                        break;
                    case 'START_TIMER': {
                        const timerFn = this.timerOverride || setTimeout;
                        timerFn(async () => {
                            const followUpEffects = effect.payload.onTimeout(engine);
                            if (followUpEffects && followUpEffects.length > 0) {
                                await this._executeEffects(tableId, followUpEffects);
                            }
                        }, effect.payload.duration);
                        break;
                    }
                    case 'SYNC_PLAYER_TOKENS':
                        Object.values(engine.players).forEach(p => {
                            if (!p.isBot && p.socketId) {
                                const playerSocket = this.io.sockets.sockets.get(p.socketId);
                                if (playerSocket) playerSocket.emit("requestUserSync");
                            }
                        });
                        break;
                    case 'HANDLE_GAME_OVER': {
                        const settlement = await this._runSettlementWithRetry(
                            engine,
                            'normal',
                            () => this.handleGameOver(effect.payload),
                        );
                        if (settlement.ok && engine.roundSummary) {
                            engine.roundSummary.gameWinner = settlement.result.gameWinnerName;
                            engine.roundSummary.payoutDetails = settlement.result.payoutDetails;
                            engine.roundSummary.tokenSettlement = settlement.result.tokenSettlement;
                            if (effect.onComplete) effect.onComplete(settlement.result);
                        } else if (engine.roundSummary) {
                            console.error(`[SERVICE] Normal settlement failed for game ${effect.payload.gameId}:`, settlement.error);
                            engine.roundSummary.message = 'Game settlement needs administrator review. No partial payout was committed.';
                        }
                        if (engine.roundSummary) {
                            // Start the shared presentation clock after the
                            // settlement await, just before clients first see it.
                            engine.startRoundPresentationWindow(ROUND_PRESENTATION_LOCK_MS);
                        }
                        this.emitGameState(tableId);
                        this.evaluateTerminalCleanup(tableId);
                        break;
                    }
                    case 'HANDLE_DRAW_OUTCOME': {
                        const settlement = await this._runSettlementWithRetry(
                            engine,
                            'draw',
                            () => this.handleDrawOutcome(effect.payload),
                        );
                        if (settlement.ok) {
                            if (effect.onComplete) effect.onComplete(settlement.result);
                        } else {
                            console.error(`[SERVICE] Draw settlement failed for game ${effect.payload.gameId}:`, settlement.error);
                            // Draw Resolving is only an in-flight state. Even a
                            // failed settlement must reach a stable terminal UI
                            // so players can read the failure and leave; the
                            // failed settlement itself continues to block reset
                            // and automated terminal cleanup.
                            engine.state = 'DrawComplete';
                            engine.roundSummary = {
                                isGameOver: true,
                                settlementFailed: true,
                                drawOutcome: 'Settlement Failed',
                                message: 'Draw settlement needs administrator review. No partial payout was committed.',
                                payouts: {},
                                finalScores: { ...engine.scores },
                            };
                        }
                        this.emitGameState(tableId);
                        this.evaluateTerminalCleanup(tableId);
                        break;
                    }
                    case 'HANDLE_FORFEIT': {
                        const settlement = await this._runSettlementWithRetry(
                            engine,
                            'forfeit',
                            () => this.handleForfeit(effect.payload),
                        );
                        if (settlement.ok && engine.roundSummary) {
                            engine.roundSummary.gameWinner = settlement.result.gameWinnerName;
                            engine.roundSummary.payoutDetails = settlement.result.payoutDetails;
                            engine.roundSummary.tokenSettlement = settlement.result.tokenSettlement;
                        } else if (engine.roundSummary) {
                            console.error(`[SERVICE] Forfeit settlement failed for game ${effect.payload.gameId}:`, settlement.error);
                            engine.roundSummary.message = 'Forfeit settlement needs administrator review. No partial payout was committed.';
                        }
                        if (engine.roundSummary) {
                            // No final trick/widow animation on a forfeit; this
                            // brief window only protects delivery of its reason.
                            engine.startRoundPresentationWindow(1_000);
                        }
                        this.emitGameState(tableId);
                        this.evaluateTerminalCleanup(tableId);
                        break;
                    }
                    case 'START_FORFEIT_TIMER': {
                        if (engine.internalTimers.forfeit) break;
                        const { targetPlayerName } = effect.payload;
                        engine.internalTimers.forfeit = setInterval(async () => {
                            const currentEngine = this.getEngineById(tableId);
                            const target = Object.values(currentEngine?.players || {})
                                .find(player => player.playerName === targetPlayerName);
                            if (!currentEngine || !target?.disconnected || currentEngine.forfeiture.targetPlayerName !== targetPlayerName) {
                                currentEngine?._clearForfeitTimer();
                                if (currentEngine) this.emitGameState(tableId);
                                return;
                            }

                            currentEngine.forfeiture.timeLeft -= 1;
                            if (currentEngine.forfeiture.timeLeft <= 0) {
                                currentEngine._clearForfeitTimer();
                                const followUp = currentEngine._resolveForfeit(targetPlayerName, 'disconnect timeout');
                                await this._executeEffects(tableId, followUp);
                            } else {
                                this.emitGameState(tableId);
                            }
                        }, 1000);
                        break;
                    }
                    case 'START_GAME_TRANSACTIONS': {
                        let startResult;
                        try {
                            // Mercy is its own durable ledger event. Grant it
                            // before the buy-in transaction so an underfunded
                            // bot still receives its hourly +1 even when the
                            // selected table remains too expensive to enter.
                            for (const botUserId of effect.payload.botPlayerIds || []) {
                                await transactionManager.handleAutomaticBotMercyToken(
                                    this.pool,
                                    botUserId,
                                );
                            }
                            startResult = await transactionManager.startGameTransaction(
                                this.pool,
                                effect.payload.table,
                                effect.payload.playerIds,
                            );
                        } catch (err) {
                            const insufficientFundsMatch = err.message.match(/(.+) has insufficient tokens/);
                            const brokePlayerName = insufficientFundsMatch ? insufficientFundsMatch[1] : null;
                            const brokePlayer = brokePlayerName
                                ? Object.values(engine.players).find(player => player.playerName === brokePlayerName)
                                : null;
                            const quickPlayBotFundingShortage = engine.tableType === 'quickplay'
                                && brokePlayer?.isBot === true;
                            if (effect.onFailure) effect.onFailure(err, brokePlayerName);
                            if (quickPlayBotFundingShortage) {
                                // A cross-process race can drain a bot after our
                                // live preflight but before the database locks
                                // its row. Keep that hidden implementation
                                // detail out of the player-facing error.
                                engine.qpFundingShortageRecovery = {
                                    startGeneration: engine.qpGeneration,
                                    code: 'HIGH_STAKES_POOL_THIN',
                                };
                                engine.qpMatchmakingNotice = this._quickPlayMatchmakingNotice(engine);
                                this.io.to(tableId).emit('error', {
                                    message: this._quickPlayMatchmakingMessage(engine),
                                });
                            } else {
                                this.io.to(tableId).emit('gameStartFailed', {
                                    message: err.message,
                                    kickedPlayer: brokePlayerName,
                                });
                            }
                            break;
                        }

                        // The database commit is already durable here. Keep
                        // transition failures out of the transaction-failure
                        // path: claiming a rollback or allowing a retry would
                        // risk charging the same roster twice.
                        try {
                            if (effect.onSuccess) {
                                effect.onSuccess(startResult.gameId, startResult.updatedTokens);
                            }
                        } catch (err) {
                            console.error(
                                `[CRITICAL] Game ${startResult.gameId} committed for table ${tableId}, but the in-memory start transition failed. Manual recovery is required.`,
                                err,
                            );
                        }
                        break;
                    }
                }
            }
        }

        _triggerBots(tableId) {
            const engine = this.getEngineById(tableId);
            if (!engine || engine.pendingBotAction) return;
        
            // Helper function to check if game is human vs bot only
            const isHumanVsBotOnly = () => {
                const humanPlayers = Object.values(engine.players).filter(p => !p.isBot && !p.isSpectator);
                return humanPlayers.length === 1;
            };
        
            let turnActionTaken = false;
        
            const scheduleTurnAction = (actionFn, delay, ...args) => {
                turnActionTaken = true;
                engine.pendingBotAction = setTimeout(async () => {
                    engine.pendingBotAction = null;
                    await actionFn.call(this, tableId, ...args);
                    // Re-trigger bot check after action completes
                    setTimeout(() => {
                        this._triggerBots(tableId);
                    }, 100);
                }, delay);
            };
        
            // Terminal-state cleanup — must run regardless of whether bots are
            // seated. (This used to live inside the bot loop, so human-only
            // tables never self-cleaned, and a completed draw had no cleanup
            // path at all: the table sat in DrawComplete forever and re-seated
            // its players into the finished game on every reconnect.)
            if (engine.state === 'Game Over' || engine.state === 'DrawComplete') {
                this.evaluateTerminalCleanup(tableId);
                return; // finished table — no bot turns to take
            }

            for (const botId in engine.bots) {
                if (turnActionTaken) break;
        
                const bot = engine.bots[botId];
                const botUserId = bot.userId;
                const isCourtney = bot.playerName === "Courtney Sr.";
                const standardDelay = isCourtney ? 2000 : 1000;
                const playDelay = isCourtney ? 2400 : 1200;
                const presentationReadyAt = Number(engine.roundSummary?.presentationReadyAt);
                const legacyRoundEndDelay = isCourtney ? 20000 : 14000;
                const roundEndDelay = Number.isFinite(presentationReadyAt)
                    ? Math.max(500, presentationReadyAt - Date.now() + (isCourtney ? 1500 : 750))
                    : legacyRoundEndDelay;
        
                if (engine.state === 'Dealing Pending' && engine.dealer == botUserId) {
                    scheduleTurnAction(this.dealCards, standardDelay, botUserId);
                } else if (engine.state === 'Awaiting Next Round Trigger') {
                    // Check if this bot should trigger next round
                    if (engine.roundSummary && engine.roundSummary.dealerOfRoundId == botUserId) {
                        console.log(`[BOT] ${bot.playerName} scheduling next round trigger as dealer`);
                        scheduleTurnAction(this.requestNextRound, roundEndDelay, botUserId);
                    } else if (!engine.roundSummary) {
                        // Round summary not ready yet, will retry on next interval
                        console.log(`[BOT] Waiting for round summary to be set before next round trigger`);
                    }
                } else if (engine.state === 'Bidding Phase' && engine.biddingTurnPlayerId == botUserId) {
                    const bid = bot.decideBid();
                    console.log(`[BOT-BID] ${bot.playerName} is bidding: ${bid}`);
                    scheduleTurnAction(this.placeBid, standardDelay, botUserId, bid);
                } else if (engine.state === 'Awaiting Frog Upgrade Decision' && engine.biddingTurnPlayerId == botUserId) {
                    const bid = bot.decideFrogUpgrade();
                    scheduleTurnAction(this.placeBid, standardDelay, botUserId, bid);
                } else if (engine.state === 'Trump Selection' && engine.bidWinnerInfo?.userId == botUserId && !engine.trumpSuit) {
                    const suit = bot.chooseTrump();
                    scheduleTurnAction(this.chooseTrump, standardDelay, botUserId, suit);
                } else if (engine.state === 'Frog Widow Exchange' && engine.bidWinnerInfo?.userId == botUserId && engine.widowDiscardsForFrogBidder.length === 0) {
                    const discards = bot.submitFrogDiscards();
                    scheduleTurnAction(this.submitFrogDiscards, standardDelay, botUserId, discards);
                } else if (engine.state === 'Playing Phase' && !engine.drawRequest.isActive && engine.trickTurnPlayerId == botUserId) {
                    const card = bot.playCard();
                    if (card) {
                        scheduleTurnAction(this.playCard, playDelay, botUserId, card);
                    }
                }
            }
        
            if (engine.drawRequest.isActive) {
                let delay = 2000;
                for (const botId in engine.bots) {
                    const bot = engine.bots[botId];
                    if (engine.drawRequest.votes[bot.playerName] === null) {
                        setTimeout(async () => {
                            const currentEngine = this.getEngineById(tableId);
                            if (currentEngine && currentEngine.drawRequest.isActive && currentEngine.drawRequest.votes[bot.playerName] === null) {
                                const vote = bot.decideDrawVote();
                                await this.submitDrawVote(tableId, bot.userId, vote);
                            }
                        }, delay);
                        delay += 1500;
                    }
                }
            }

            if (engine.state === 'Playing Phase' && !engine.drawRequest.isActive && engine.insurance.isActive && !engine.insurance.dealExecuted) {
                console.log(`[INSURANCE] Processing insurance for table ${tableId} - ${Object.keys(engine.bots).length} bots`);
                let insuranceDelay = 500;
                for (const botId in engine.bots) {
                    const bot = engine.bots[botId];
                    setTimeout(async () => {
                        const currentEngine = this.getEngineById(tableId);
                        if (currentEngine && currentEngine.insurance.isActive && !currentEngine.insurance.dealExecuted) {
                            console.log(`[INSURANCE] Bot ${bot.playerName} making insurance decision`);
                            // Use adaptive strategy instead of fixed strategy
                            const decision = await this.adaptiveInsurance.calculateInsuranceMove(currentEngine, bot);
                            if (decision) {
                                currentEngine.updateInsuranceSetting(bot.userId, decision.settingType, decision.value);
                                this.emitGameState(tableId);
                                
                                // Log the decision for learning
                                console.log(`[INSURANCE] Logging decision for ${bot.playerName}, gameId: ${currentEngine.gameId}`);
                                if (currentEngine.gameId) {
                                    await this.adaptiveInsurance.logInsuranceDecision(
                                        currentEngine.gameId,
                                        bot.playerName,
                                        currentEngine,
                                        false, // deal not executed yet
                                        null // hindsight value will be calculated later
                                    );
                                } else {
                                    console.log(`[INSURANCE] WARNING: No gameId available for logging`);
                                }
                            }
                        }
                    }, insuranceDelay);
                    insuranceDelay += 750;
                }
            }
        }
    }

    module.exports = GameService;
    module.exports.TERMINAL_EMPTY_CLEANUP_DELAY_MS = TERMINAL_EMPTY_CLEANUP_DELAY_MS;
    module.exports.TERMINAL_DISCONNECTED_CLEANUP_DELAY_MS = TERMINAL_DISCONNECTED_CLEANUP_DELAY_MS;
    module.exports.TERMINAL_QUICKPLAY_DISCONNECTED_CLEANUP_DELAY_MS = TERMINAL_QUICKPLAY_DISCONNECTED_CLEANUP_DELAY_MS;
    module.exports.QUICKPLAY_FOURTH_FALLBACK_MIN_DELAY_MS = QUICKPLAY_FOURTH_FALLBACK_MIN_DELAY_MS;
    module.exports.QUICKPLAY_FOURTH_FALLBACK_MAX_DELAY_MS = QUICKPLAY_FOURTH_FALLBACK_MAX_DELAY_MS;
