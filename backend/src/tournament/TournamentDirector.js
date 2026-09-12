'use strict';

// The tournament director (the Sluff Tournament whiteboard, Sept 2026).
//
// A tournament is a room of players who all play one round at once, then
// reseat by stack. The director owns registration and the money around it,
// runs the round loop (seat, deal, wait for every table's chip transfer,
// apply busts, reseat), and pays the podium. Each table is an ordinary
// GameEngine in 3- or 4-player mode carrying a `tournament` context: the
// felt is untouched, the engine just never ends the game itself and hands
// the round's result back here through a TOURNAMENT_ROUND_COMPLETE effect.
//
// Settled rules (Matt, 6 Sept 2026): any VIP creates one; the creator sets
// the buy-in (up to 50 tokens), the starting stack (60–240), the seats
// (3–15), the venue and the start rule; humans may go negative on the
// buy-in during alpha; house players are found richest-first and must
// afford it; reseat top with top; the sitting-out fourth seat collects the
// widow share; bust at zero; the final three play to the first bust; prizes
// 50 / 30 / 20 (65 / 35 under six); no ante, no hand cap.

const { seatRound, tableSizes } = require('./seating');
const { rankFinishers, allocatePrizeCents } = require('./prizes');
const { ROUND_PRESENTATION_LOCK_MS, THEMES } = require('../core/constants');
const tournamentClock = require('../core/tournamentClock');
const { pickFavorites, buildWelcomeScript, buildRoundCall } = require('./tournamentWelcome');

const TRICKS_PER_ROUND = 11;
const BIDDING_STATES = new Set([
    'Bidding Phase', 'Awaiting Frog Upgrade Decision', 'Frog Widow Exchange',
    'Trump Selection', 'Bid Announcement', 'AllPassWidowReveal',
]);
const { serializeEngineForResume, restoreEngineFromResume } = require('../serialization/gameResume');

const STARTING_STACKS = Object.freeze([60, 90, 120, 180, 240]);
const START_RULES = Object.freeze(['at_time', 'when_full', 'creator']);
const MAX_BUY_IN_CENTS = 5000;
const MIN_SEATS = 3;
const MAX_SEATS = 15;
const MIN_START_LEAD_MS = 10 * 60 * 1000;
const REGISTRATION_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_BOARD_DELAY_MS = tournamentClock.TOURNAMENT_CLOCK.boardDelayMs;
// After a restart, a running tournament whose snapshot never arrives is
// voided and refunded once this much time has passed (Render boots the
// replacement before the old instance's SIGTERM, so snapshots land late).
const RESUME_GRACE_MS = 10 * 60 * 1000;
// Fast play: once only house players are left, the creator can run the rest
// of the event at this multiple — every wait in the round loop (deal, recap
// hold, board) and every bot beat on its tables is divided by it.
const FAST_PLAY_DIVISOR = 10;
const SNAPSHOT_VERSION = 1;
const TOURNAMENT_VENUE = 'tournament-stage';
const MAX_NAME_LENGTH = 60;
// Chip drain: between rounds every stack drops by this percentage. Rounds
// play at even stakes (insurance math stays plain); the drain does the
// squeezing. Matt, Sept 6 2026, replacing the escalation multiplier.
const DRAIN_PERCENTS = Object.freeze([0, 5, 10, 20]);
const DEFAULT_DRAIN_PERCENT = 10;

class TournamentError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'TournamentError';
        this.code = code;
    }
}

function cleanName(value) {
    if (typeof value !== 'string') return '';
    return value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_NAME_LENGTH);
}

class TournamentDirector {
    constructor({
        gameService,
        store,
        io = null,
        now = () => Date.now(),
        schedule = (fn, ms) => setTimeout(fn, ms),
        cancelSchedule = handle => clearTimeout(handle),
        random = Math.random,
        presentationHoldMs = ROUND_PRESENTATION_LOCK_MS,
        boardDelayMs = DEFAULT_BOARD_DELAY_MS,
        dealDelayMs = tournamentClock.TOURNAMENT_CLOCK.dealDelayMs,
        singleTableDelayMs = tournamentClock.TOURNAMENT_CLOCK.singleTableDelayMs,
        // The call to the felt: round one holds this long before its deal,
        // and speakWelcome(script) — when wired — turns Liam's line into an
        // mp3 for the clients to play over it (see tournamentWelcome.js).
        welcomeHoldMs = tournamentClock.TOURNAMENT_CLOCK.welcomeHoldMs,
        speakWelcome = null,
        welcomeSynthTimeoutMs = 10_000,
        // Rounds two onward hold this long for the ring card and Liam's
        // round call — only when speakRoundCall(text) is wired.
        speakRoundCall = null,
        roundCallHoldMs = tournamentClock.TOURNAMENT_CLOCK.roundCallHoldMs,
        allowNegativeHumans = true,
        venues = [...THEMES.map(theme => theme.id), TOURNAMENT_VENUE],
        log = console,
    } = {}) {
        if (!gameService) throw new TypeError('TournamentDirector requires a gameService');
        if (!store) throw new TypeError('TournamentDirector requires a store');
        this.gameService = gameService;
        this.store = store;
        this.io = io;
        this.now = now;
        this.schedule = schedule;
        this.cancelSchedule = cancelSchedule;
        this.random = random;
        this.presentationHoldMs = presentationHoldMs;
        this.boardDelayMs = boardDelayMs;
        this.dealDelayMs = dealDelayMs;
        this.singleTableDelayMs = singleTableDelayMs;
        this.welcomeHoldMs = welcomeHoldMs;
        this.speakWelcome = typeof speakWelcome === 'function' ? speakWelcome : null;
        this.welcomeSynthTimeoutMs = welcomeSynthTimeoutMs;
        this.speakRoundCall = typeof speakRoundCall === 'function' ? speakRoundCall : null;
        this.roundCallHoldMs = roundCallHoldMs;
        this.allowNegativeHumans = allowNegativeHumans;
        this.venues = venues;
        this.log = log;
        this.tournaments = new Map();
        this.bootAt = this.now();
        this.runningReconciled = false;
    }

    // ------------------------------------------------------------------ reads

    get(tournamentId) {
        return this.tournaments.get(Number(tournamentId)) || null;
    }

    getOpen() {
        return [...this.tournaments.values()].find(t => t.status === 'registering') || null;
    }

    hasRunning() {
        return [...this.tournaments.values()].some(t => t.status === 'running');
    }

    // The tournament a user is registered in or playing, if any.
    tournamentOf(userId) {
        const id = Number(userId);
        for (const t of this.tournaments.values()) {
            if (!['registering', 'running'].includes(t.status)) continue;
            const entry = t.entries.get(id);
            if (entry && ['registered', 'playing'].includes(entry.status)) return t;
        }
        return null;
    }

    isUserInTournament(userId) {
        return this.tournamentOf(userId) !== null;
    }

    // The tournament a user should be watching: like tournamentOf, but a
    // player who has busted out of a running tournament still belongs to
    // its room until it ends.
    tournamentFor(userId) {
        const id = Number(userId);
        for (const t of this.tournaments.values()) {
            if (!['registering', 'running'].includes(t.status)) continue;
            const entry = t.entries.get(id);
            if (entry && !['withdrawn', 'refunded'].includes(entry.status)) return t;
            if (t.creatorUserId === id) return t;
        }
        return null;
    }

    lobbyState() {
        const open = this.getOpen();
        return {
            open: open ? this.publicState(open) : null,
            running: [...this.tournaments.values()]
                .filter(t => t.status === 'running')
                .map(t => this.publicState(t)),
        };
    }

    // Player-facing state. Never says which entries are house players.
    publicState(t, viewerUserId = null) {
        const entries = [...t.entries.values()]
            .filter(entry => entry.status !== 'withdrawn')
            .map(entry => ({
                userId: entry.userId,
                username: entry.username,
                status: entry.status,
                stack: entry.stack,
                sitOuts: entry.sitOuts,
                place: entry.place,
                prizeTokens: entry.prizeCents / 100,
                bustedRound: entry.bustedRound,
            }))
            .sort((a, b) => (a.place ?? 0) - (b.place ?? 0) || (b.stack - a.stack) || a.username.localeCompare(b.username));
        const nameOf = id => t.entries.get(id)?.username ?? null;
        const tableRows = this._tableRows(t);
        const tables = tableRows.map(table => ({
            tableId: table.tableId,
            tableIndex: table.index,
            playerMode: table.playerMode,
            seats: table.seats.map(nameOf),
            dealer: nameOf(table.dealerUserId),
            sitOuts: table.sitOutUserIds.map(nameOf),
            finished: Boolean(table.result),
            // How far along the table is, so the board and the standings
            // sheet can show the room what it is waiting on.
            ...this._tableProgress(table),
        }));
        const viewer = viewerUserId == null ? null : (() => {
            const entry = t.entries.get(Number(viewerUserId));
            const table = tableRows.find(candidate => (
                candidate.seats.includes(Number(viewerUserId)) || candidate.spectatorUserIds.includes(Number(viewerUserId))
            ));
            return {
                entered: Boolean(entry && entry.status !== 'withdrawn'),
                status: entry?.status ?? null,
                isCreator: t.creatorUserId === Number(viewerUserId),
                tableId: table?.tableId ?? null,
                watchingTableId: entry?.watchingTableId ?? null,
            };
        })();
        return {
            id: t.id,
            name: t.name,
            venue: t.venue,
            buyInTokens: t.buyInCents / 100,
            startingStack: t.startingStack,
            maxSeats: t.maxSeats,
            startRule: t.startRule,
            startsAt: t.startsAt,
            status: t.status,
            round: t.round,
            drainPercent: t.drainPercent || 0,
            // The drop everyone just took between rounds (by name), so the
            // board can show it while the room reseats.
            lastDrain: t.lastDrain,
            // Fast play: on when the creator has sped up a bots-only finish;
            // offered (botsOnly) once no human is still in.
            fastPlay: t.fastPlay === true,
            botsOnly: this._botsOnly(t),
            // Between rounds: how long until the next one opens, so the
            // board can count down instead of leaving the room guessing.
            nextRoundInSeconds: t.nextRoundAt ? Math.max(0, Math.ceil((t.nextRoundAt - this.now()) / 1000)) : null,
            // Tonight's favorites (by tournament record), for the board and
            // the welcome; and, while round one waits on its first deal,
            // the welcome itself: how long until the cards fly, and whether
            // Liam's line is ready to fetch.
            favorites: t.welcome ? [...t.welcome.favorites] : [],
            welcome: this._welcomeState(t),
            // Rounds two onward, while the tables wait on the deal: the
            // round call (how long, and whether Liam's line is ready).
            roundCall: this._roundCallState(t),
            creatorUserId: t.creatorUserId,
            creatorName: t.creatorName,
            seatsTaken: this._seatCount(t),
            playersLeft: this._alive(t).length,
            entries,
            tables,
            closeReason: t.closeReason || null,
            viewer,
        };
    }

    // ---------------------------------------------------------- registration

    async create(creator, settings = {}) {
        if (!creator || creator.is_vip !== true) {
            throw new TournamentError('VIP_REQUIRED', 'Only VIP players can create a tournament right now.');
        }
        if (this.getOpen()) {
            throw new TournamentError('TOURNAMENT_ALREADY_OPEN', 'A tournament is already open for registration.');
        }
        const buyInCents = Math.round(Number(settings.buyInTokens) * 100);
        if (!Number.isInteger(buyInCents) || buyInCents < 0 || buyInCents > MAX_BUY_IN_CENTS) {
            throw new TournamentError('BAD_BUY_IN', 'The buy-in must be between 0 and 50 tokens.');
        }
        const startingStack = Number(settings.startingStack);
        if (!STARTING_STACKS.includes(startingStack)) {
            throw new TournamentError('BAD_STACK', `The starting stack must be one of ${STARTING_STACKS.join(', ')}.`);
        }
        const maxSeats = Number(settings.maxSeats ?? 9);
        if (!Number.isInteger(maxSeats) || maxSeats < MIN_SEATS || maxSeats > MAX_SEATS) {
            throw new TournamentError('BAD_SEATS', `Seats must be between ${MIN_SEATS} and ${MAX_SEATS}.`);
        }
        const startRule = settings.startRule ?? 'creator';
        if (!START_RULES.includes(startRule)) {
            throw new TournamentError('BAD_START_RULE', 'Start rule must be at_time, when_full or creator.');
        }
        let startsAt = null;
        if (startRule === 'at_time') {
            startsAt = new Date(settings.startsAt).getTime();
            if (!Number.isFinite(startsAt) || startsAt < this.now() + MIN_START_LEAD_MS) {
                throw new TournamentError('START_TIME_TOO_SOON', 'A timed start must be at least ten minutes away.');
            }
        }
        const venue = settings.venue ?? TOURNAMENT_VENUE;
        if (!this.venues.includes(venue)) {
            throw new TournamentError('BAD_VENUE', 'That venue is not available.');
        }
        const name = cleanName(settings.name) || `${creator.username}'s Tournament`;
        const drainPercent = settings.drainPercent === undefined
            ? DEFAULT_DRAIN_PERCENT
            : Number(settings.drainPercent);
        if (!DRAIN_PERCENTS.includes(drainPercent)) {
            throw new TournamentError('BAD_DRAIN', `Chip drain must be one of ${DRAIN_PERCENTS.join(', ')} percent.`);
        }

        const { tournamentId, seasonId } = await this.store.createTournament({
            creatorUserId: creator.id, name, venue, buyInCents, startingStack, maxSeats, startRule,
            startsAt: startsAt ? new Date(startsAt) : null,
            drainPercent,
        });
        const t = this._newTournament({
            id: tournamentId, seasonId, creatorUserId: creator.id, creatorName: creator.username,
            name, venue, buyInCents, startingStack, maxSeats, startRule, startsAt, drainPercent, createdAt: this.now(),
        });
        this.tournaments.set(t.id, t);
        this.log.log(`[TOURNAMENT] #${t.id} "${t.name}" opened by ${creator.username}: ${t.buyInCents / 100} tokens, stack ${t.startingStack}, ${t.maxSeats} seats, ${t.startRule}, drain ${t.drainPercent}%.`);
        this._emit(t);
        return this.publicState(t, creator.id);
    }

    async register(tournamentId, user, { socketId = null, tokens = null } = {}) {
        const t = this._registering(tournamentId);
        if (!user || !Number.isInteger(Number(user.id))) throw new TournamentError('BAD_USER', 'Sign in to join a tournament.');
        const userId = Number(user.id);
        if (this.tournamentOf(userId)) throw new TournamentError('ALREADY_ENTERED', 'You are already in a tournament.');
        if (this._seatCount(t) >= t.maxSeats) throw new TournamentError('TOURNAMENT_FULL', 'Every seat is taken.');
        await this.store.addEntry({
            tournamentId: t.id, userId, username: user.username, isBot: false,
            buyInCents: t.buyInCents, allowNegative: this.allowNegativeHumans, startingStack: t.startingStack,
        });
        t.entries.set(userId, this._newEntry({ userId, username: user.username, isBot: false, socketId, tokens, stack: t.startingStack }));
        this._joinRoom(socketId, t);
        this._emit(t);
        if (t.startRule === 'when_full' && this._seatCount(t) >= t.maxSeats) await this._start(t, 'full');
        return this.publicState(t, userId);
    }

    async withdraw(tournamentId, userId) {
        const t = this._registering(tournamentId);
        const entry = t.entries.get(Number(userId));
        if (!entry || entry.status !== 'registered') throw new TournamentError('NOT_ENTERED', 'You are not in this tournament.');
        await this.store.withdrawEntry({ tournamentId: t.id, userId: entry.userId, buyInCents: t.buyInCents });
        entry.status = 'withdrawn';
        if (entry.isBot) t.lease.release(entry.userId);
        this._emit(t);
        return this.publicState(t, userId);
    }

    // The creator's "Find player": seat the top-ranked house player who can
    // cover the buy-in. Richest first, the same pick Quick Play makes for the
    // high tables. Nothing here reaches players' screens except a new name.
    async findPlayer(tournamentId, requesterId) {
        const t = this._registering(tournamentId);
        this._creatorOnly(t, requesterId);
        if (this._seatCount(t) >= t.maxSeats) throw new TournamentError('TOURNAMENT_FULL', 'Every seat is taken.');
        const profiles = Array.isArray(this.gameService.botAccounts) ? this.gameService.botAccounts : [];
        const balances = profiles.length > 0
            ? await this.store.loadBotBalances(profiles.map(profile => profile.id))
            : new Map();
        const candidates = profiles
            .filter(profile => !t.entries.has(profile.id) || t.entries.get(profile.id).status === 'withdrawn')
            .filter(profile => (balances.get(profile.id) ?? -Infinity) >= t.buyInCents)
            .sort((a, b) => (balances.get(b.id) - balances.get(a.id)) || (a.id - b.id));
        for (const profile of candidates) {
            if (!t.lease.acquire(profile.id)) continue; // seated at a live table elsewhere
            try {
                await this.store.addEntry({
                    tournamentId: t.id, userId: profile.id, username: profile.username, isBot: true,
                    buyInCents: t.buyInCents, allowNegative: false, startingStack: t.startingStack,
                });
            } catch (error) {
                t.lease.release(profile.id);
                if (error.code === 'INSUFFICIENT_TOKENS') continue;
                throw error;
            }
            t.entries.set(profile.id, this._newEntry({ userId: profile.id, username: profile.username, isBot: true, stack: t.startingStack }));
            this._emit(t);
            if (t.startRule === 'when_full' && this._seatCount(t) >= t.maxSeats) await this._start(t, 'full');
            return this.publicState(t, requesterId);
        }
        throw new TournamentError('NO_HOUSE_PLAYER_AVAILABLE', 'No one is available at this buy-in right now.');
    }

    async start(tournamentId, requesterId) {
        const t = this._registering(tournamentId);
        this._creatorOnly(t, requesterId);
        if (this._seatCount(t) < MIN_SEATS) throw new TournamentError('NOT_ENOUGH_PLAYERS', 'A tournament needs at least three players.');
        await this._start(t, 'creator');
        return this.publicState(t, requesterId);
    }

    async cancel(tournamentId, requesterId, reason = 'Cancelled by the creator.') {
        const t = this._registering(tournamentId);
        if (requesterId !== null) this._creatorOnly(t, requesterId);
        await this._refundAndClose(t, 'cancelled', reason);
        return this.publicState(t, requesterId);
    }

    // Fast play: the creator, once only house players are left, runs the rest
    // of the event at FAST_PLAY_DIVISOR× — the room's waits and every bot's
    // beat at its tables. Off again the same way. While a human is still in,
    // the event stays at normal speed.
    setFastPlay(tournamentId, requesterId, enabled = true) {
        const t = this.get(tournamentId);
        if (!t || t.status !== 'running') throw new TournamentError('NOT_RUNNING', 'That tournament is not running.');
        this._creatorOnly(t, requesterId);
        const on = enabled !== false;
        if (on && !this._botsOnly(t)) {
            throw new TournamentError('HUMANS_STILL_PLAYING', 'Fast play is for when only house players are left.');
        }
        if (t.fastPlay !== on) {
            t.fastPlay = on;
            this._applyFastPlay(t);
            this.log.log(`[TOURNAMENT] #${t.id} fast play ${on ? `on (${FAST_PLAY_DIVISOR}×)` : 'off'}.`);
            this._emit(t);
        }
        return this.publicState(t, requesterId);
    }

    // A running tournament that cannot go on (a crash without a snapshot,
    // every human gone for an hour): void it and give every buy-in back.
    async voidTournament(tournamentId, reason = 'The tournament could not continue.') {
        const t = this.get(tournamentId);
        if (!t || t.status !== 'running') throw new TournamentError('NOT_RUNNING', 'That tournament is not running.');
        await this._refundAndClose(t, 'voided', reason);
        return this.publicState(t);
    }

    // Leaving mid-tournament is a bust at your current place: the seat is
    // played by the house for the rest of the round, then the player is out.
    async quit(tournamentId, userId) {
        const t = this.get(tournamentId);
        if (!t || t.status !== 'running') throw new TournamentError('NOT_RUNNING', 'That tournament is not running.');
        const entry = t.entries.get(Number(userId));
        if (!entry || entry.status !== 'playing') throw new TournamentError('NOT_PLAYING', 'You are not playing in this tournament.');
        entry.quit = true;
        for (const table of t.tables.values()) {
            const engine = this.gameService.getEngineById(table.tableId);
            if (engine?.players?.[entry.userId]) engine.leaveTable(entry.userId);
        }
        if (t.tables.size === 0) {
            // Between rounds: the bust applies now, and the field is recounted
            // at the next reseat.
            entry.status = 'busted';
            entry.bustedRound = t.round;
            if (this._alive(t).length < 3 && !t.pendingTimer) await this._finish(t);
        }
        this._emit(t);
        return this.publicState(t, userId);
    }

    // Timed starts and stale registrations. Driven by GameService's heartbeat.
    async tick() {
        const now = this.now();
        for (const t of [...this.tournaments.values()]) {
            if (t.status === 'running') {
                if (t.roundCompleteAt && t.tables.size > 0 && this._presentationReleased(t, now)) {
                    if (t.pendingTimer) {
                        this.cancelSchedule(t.pendingTimer);
                        t.pendingTimer = null;
                    }
                    await this._finishRound(t);
                    continue;
                }
                await this._dealDueTables(t, now);
                // Every table's trick count rides the tournament state, so
                // the board and the standings sheet can show how far along
                // the room is. Broadcast only when something moved.
                const signature = this._progressSignature(t);
                if (signature !== t.lastProgressSignature) {
                    t.lastProgressSignature = signature;
                    this._emit(t);
                }
                continue;
            }
            if (t.status !== 'registering') continue;
            if (t.startRule === 'at_time' && now >= t.startsAt) {
                if (this._seatCount(t) >= MIN_SEATS) await this._start(t, 'time');
                else await this._refundAndClose(t, 'cancelled', 'Not enough players at the start time.');
                continue;
            }
            if (now - t.createdAt >= REGISTRATION_TTL_MS) {
                await this._refundAndClose(t, 'cancelled', 'Registration expired.');
            }
        }
        // A tournament left running in the database by the previous process
        // gets the length of the resume sweep to reappear; after that it is
        // voided and every buy-in returned.
        if (!this.runningReconciled && now - this.bootAt >= RESUME_GRACE_MS) {
            this.runningReconciled = true;
            const live = [...this.tournaments.values()].filter(t => t.status === 'running').map(t => t.id);
            try {
                const voided = await this.store.voidRunningExcept(live, 'The tournament could not be resumed after a restart.');
                if (voided.length > 0) this.log.log(`[TOURNAMENT] Voided ${voided.length} unresumed tournament(s): #${voided.join(', #')}.`);
            } catch (error) {
                this.log.error('[TOURNAMENT] Could not reconcile running tournaments:', error.message);
            }
        }
    }

    // A socket (re)connected: remember it for seating and, if the player is
    // at a live table right now, put them back in that seat.
    bindSocket(userId, socket) {
        const t = this.tournamentFor(userId);
        if (!t || !socket) return false;
        const entry = t.entries.get(Number(userId));
        if (entry) entry.socketId = socket.id;
        socket.join?.(this._roomName(t));
        for (const table of t.tables.values()) {
            const engine = this.gameService.getEngineById(table.tableId);
            if (!engine?.players?.[entry.userId]) continue;
            socket.join?.(table.tableId);
            engine.reconnectPlayer(entry.userId, socket);
            this.gameService.emitGameState(table.tableId);
        }
        socket.emit?.('tournamentState', this.publicState(t, userId));
        return true;
    }

    // Boot: rebuild open registrations and claim any tournament snapshots
    // the previous instance saved on its way out. A running tournament with
    // no snapshot yet is left alone for the length of the resume sweep
    // (tick() voids and refunds it after that).
    async restore() {
        this.bootAt = this.now();
        this.runningReconciled = false;
        const open = await this.store.loadRegistering();
        for (const { tournament, entries } of open) {
            const t = this._newTournament({
                id: tournament.tournamentId, seasonId: tournament.seasonId,
                creatorUserId: tournament.creatorUserId, creatorName: tournament.creatorName,
                name: tournament.name, venue: tournament.venue, buyInCents: tournament.buyInCents,
                startingStack: tournament.startingStack, maxSeats: tournament.maxSeats,
                startRule: tournament.startRule, startsAt: tournament.startsAt, createdAt: tournament.createdAt,
                drainPercent: tournament.drainPercent || 0,
            });
            for (const entry of entries) {
                if (entry.isBot && !t.lease.acquire(entry.userId)) continue;
                t.entries.set(entry.userId, this._newEntry({
                    userId: entry.userId, username: entry.username, isBot: entry.isBot, stack: t.startingStack,
                }));
            }
            this.tournaments.set(t.id, t);
        }
        const snapshots = await this.restoreSnapshots();
        return { registering: open.length, ...snapshots };
    }

    // ------------------------------------------------- deploy survival

    // SIGTERM: save every running tournament — the room, every stack, and
    // each live table mid-trick — so the replacement instance can pick the
    // round up where it stopped.
    async snapshotForShutdown() {
        let saved = 0;
        for (const t of this.tournaments.values()) {
            if (t.status !== 'running') continue;
            try {
                await this.store.saveSnapshot(t.id, this._snapshotOf(t));
                saved += 1;
                this.log.log(`[SHUTDOWN] Snapshotted tournament #${t.id} (round ${t.round}, ${t.tables.size} table(s)).`);
            } catch (error) {
                this.log.error(`[SHUTDOWN] Tournament snapshot failed for #${t.id}:`, error.message);
            }
        }
        return { saved };
    }

    _snapshotOf(t) {
        const tables = [...t.tables.values()].map(table => {
            const engine = this.gameService.getEngineById(table.tableId);
            return {
                index: table.index,
                playerMode: table.playerMode,
                seats: [...table.seats],
                dealerUserId: table.dealerUserId,
                sitOutUserIds: [...table.sitOutUserIds],
                spectatorUserIds: [...table.spectatorUserIds],
                tableId: table.tableId,
                result: table.result || null,
                engine: engine && !table.result ? serializeEngineForResume(engine) : null,
            };
        });
        return JSON.parse(JSON.stringify({
            v: SNAPSHOT_VERSION,
            savedAt: this.now(),
            tournament: {
                id: t.id, seasonId: t.seasonId, creatorUserId: t.creatorUserId, creatorName: t.creatorName,
                name: t.name, venue: t.venue, buyInCents: t.buyInCents, startingStack: t.startingStack,
                maxSeats: t.maxSeats, startRule: t.startRule, startsAt: t.startsAt, createdAt: t.createdAt,
                startedAt: t.startedAt, round: t.round, roundCompleteAt: t.roundCompleteAt || null,
                drainPercent: t.drainPercent || 0,
                fastPlay: t.fastPlay === true,
                favorites: t.welcome ? [...t.welcome.favorites] : [],
            },
            entries: [...t.entries.values()].map(entry => ({
                userId: entry.userId, username: entry.username, isBot: entry.isBot, status: entry.status,
                stack: entry.stack, sitOuts: entry.sitOuts, deals: entry.deals, bustedRound: entry.bustedRound,
                place: entry.place, prizeCents: entry.prizeCents, quit: entry.quit === true,
            })),
            phase: t.tables.size > 0 ? 'round' : 'between',
            tables,
        }));
    }

    // Claim and rebuild saved tournaments. Runs at boot and on the resume
    // sweep, because the old instance's snapshot usually lands after this
    // process is already serving.
    async restoreSnapshots() {
        let rows;
        try {
            rows = await this.store.claimSnapshots();
        } catch (error) {
            this.log.error('[RESUME] Tournament snapshot scan failed:', error.message);
            return { restored: 0, claimed: 0 };
        }
        let restored = 0;
        for (const row of rows) {
            const id = Number(row.tournamentId);
            if (this.tournaments.has(id)) continue; // live here already
            if (row.status !== 'running') {
                this.log.log(`[RESUME] Skipping tournament #${id}: already ${row.status}.`);
                continue;
            }
            if (Number(row.ageMs) > RESUME_GRACE_MS) {
                this.log.log(`[RESUME] Skipping tournament #${id}: snapshot too old.`);
                continue;
            }
            try {
                await this._restoreFromSnapshot(row.snapshot);
                restored += 1;
                this.log.log(`[RESUME] Restored tournament #${id}.`);
            } catch (error) {
                this.log.error(`[RESUME] Tournament #${id} could not be restored:`, error);
            }
        }
        return { restored, claimed: rows.length };
    }

    async _restoreFromSnapshot(snapshot) {
        if (snapshot?.v !== SNAPSHOT_VERSION) throw new Error(`Unknown tournament snapshot version ${snapshot?.v}`);
        const meta = snapshot.tournament;
        const t = this._newTournament({
            id: Number(meta.id), seasonId: meta.seasonId, creatorUserId: meta.creatorUserId, creatorName: meta.creatorName,
            name: meta.name, venue: meta.venue, buyInCents: meta.buyInCents, startingStack: meta.startingStack,
            maxSeats: meta.maxSeats, startRule: meta.startRule, startsAt: meta.startsAt, createdAt: meta.createdAt,
            drainPercent: meta.drainPercent ?? meta.escalationPercent ?? 0,
        });
        t.status = 'running';
        t.startedAt = meta.startedAt;
        t.round = Number(meta.round) || 0;
        t.fastPlay = meta.fastPlay === true;
        // The favorites outlive a restart; the welcome's hold and audio do not.
        t.welcome = Array.isArray(meta.favorites) && meta.favorites.length > 0
            ? { favorites: [...meta.favorites], script: null, audio: null, audioState: 'none', dealAt: null }
            : null;
        for (const saved of snapshot.entries || []) {
            const entry = this._newEntry({ userId: saved.userId, username: saved.username, isBot: saved.isBot, stack: saved.stack });
            Object.assign(entry, {
                status: saved.status, sitOuts: saved.sitOuts, deals: saved.deals, bustedRound: saved.bustedRound,
                place: saved.place, prizeCents: saved.prizeCents, quit: saved.quit === true,
            });
            if (entry.isBot) t.lease.acquire(entry.userId);
            t.entries.set(entry.userId, entry);
        }
        this.tournaments.set(t.id, t);

        if (snapshot.phase !== 'round' || !Array.isArray(snapshot.tables) || snapshot.tables.length === 0) {
            // Between rounds: the room was on the board. Reseat after the
            // usual board delay.
            const boardDelay = this._delay(t, this.boardDelayMs);
            t.nextRoundAt = this.now() + boardDelay;
            this._schedule(t, () => this._startRound(t), boardDelay);
            this._emit(t);
            return;
        }

        t.tables = new Map();
        for (const saved of snapshot.tables) {
            const table = {
                index: saved.index, playerMode: saved.playerMode, seats: [...saved.seats], dealerUserId: saved.dealerUserId,
                sitOutUserIds: [...(saved.sitOutUserIds || [])], spectatorUserIds: [...(saved.spectatorUserIds || [])],
                tableId: saved.tableId, result: saved.result || null,
            };
            if (!table.result) {
                const engine = this.gameService.createTournamentEngine({
                    tableId: table.tableId, venue: t.venue, tableName: `${t.name} · Table ${table.index + 1}`, leaseController: t.lease,
                });
                const restored = saved.engine ? restoreEngineFromResume(engine, saved.engine) : false;
                if (!restored) {
                    // A table that cannot come back washes its round: nobody's
                    // stack moves and the room reseats around it.
                    this.gameService.destroyTournamentEngine(table.tableId);
                    table.result = this._washResult(t, table);
                    this.log.log(`[RESUME] Tournament #${t.id} table ${table.index + 1} could not be restored; its round is a wash.`);
                } else {
                    // A deal that was pending (a round just opened, or an
                    // all-pass redeal) is dealt after the usual delay so the
                    // returning clients see it fly.
                    if (engine.state === 'Dealing Pending') {
                        engine.tournamentDealDueAt = this.now() + this._delay(t, this.dealDelayMs);
                    }
                    engine.setFastPlay(this._speed(t));
                    this.gameService._rebindSocketsForEngine?.(engine);
                    this.gameService.emitGameState(table.tableId);
                }
            }
            t.tables.set(table.tableId, table);
        }
        if ([...t.tables.values()].every(table => table.result)) {
            t.roundCompleteAt = meta.roundCompleteAt || this.now();
            this._schedule(t, () => this._finishRound(t), this._delay(t, this.presentationHoldMs));
        }
        this._emit(t);
    }

    _washResult(t, table) {
        const scores = {};
        for (const userId of [...table.seats, ...table.spectatorUserIds]) {
            const entry = t.entries.get(Number(userId));
            if (entry) scores[entry.username] = entry.stack;
        }
        return {
            tournamentId: t.id, roundNumber: t.round, tableIndex: table.index, tableId: table.tableId,
            scores, pointChanges: {}, bidType: null, bidderName: null, dealExecuted: false, allPassRedeals: 0, wash: true,
        };
    }

    // --------------------------------------------------------- the round loop

    async _start(t, how) {
        if (t.status !== 'registering') return;
        t.status = 'running';
        t.startedAt = this.now();
        for (const entry of t.entries.values()) {
            if (entry.status !== 'registered') continue;
            entry.status = 'playing';
            entry.stack = t.startingStack;
        }
        await this.store.updateStatus(t.id, 'running', { startedAt: new Date(t.startedAt) });
        this.log.log(`[TOURNAMENT] #${t.id} "${t.name}" started (${how}) with ${this._alive(t).length} players.`);
        await this._prepareWelcome(t);
        await this._startRound(t);
    }

    async _startRound(t) {
        if (t.status !== 'running') return;
        t.pendingTimer = null;
        t.nextRoundAt = null;
        this._unwatchAll(t);
        t.round += 1;
        const alive = this._alive(t);
        const plan = seatRound(
            alive.map(entry => ({ userId: entry.userId, stack: entry.stack, sitOuts: entry.sitOuts, deals: entry.deals })),
            { random: this.random },
        );
        // One table left and it is still standing: the room stays seated and
        // the next round opens in place, no trip to the board.
        const reuseTableId = plan.length === 1 && t.reuseTableId && this.gameService.getEngineById(t.reuseTableId)
            ? t.reuseTableId
            : null;
        if (t.reuseTableId && !reuseTableId) this.gameService.destroyTournamentEngine(t.reuseTableId);
        t.reuseTableId = null;
        t.heldTable = null;
        t.tables = new Map();
        // Round one holds for the welcome before its deal; every later round
        // opens on the ordinary deal delay.
        const roundCall = t.round >= 2 ? this._prepareRoundCall(t) : null;
        const openDelayMs = t.round === 1 && t.welcome
            ? Math.max(this.dealDelayMs, this.welcomeHoldMs)
            : (roundCall ? Math.max(this.dealDelayMs, this.roundCallHoldMs) : this.dealDelayMs);
        for (const table of plan) {
            const tableId = reuseTableId || `tn-${t.id}-r${t.round}-t${table.index + 1}`;
            const seats = table.seats.map(id => t.entries.get(id));
            // Anyone still at a reused table but out of the tournament keeps
            // a spectator's seat so they can watch the rest.
            const watchers = reuseTableId
                ? [...t.entries.values()].filter(entry => entry.status === 'busted'
                    && !table.seats.includes(entry.userId)
                    && !table.spectatorUserIds.includes(entry.userId)
                    && Boolean(this._socket(entry.socketId)))
                : [];
            const spectators = [...table.spectatorUserIds.map(id => t.entries.get(id)), ...watchers];
            const stacks = {};
            for (const entry of [...seats, ...spectators]) stacks[entry.userId] = entry.stack;
            const engine = reuseTableId
                ? this.gameService.getEngineById(tableId)
                : this.gameService.createTournamentEngine({
                    tableId,
                    venue: t.venue,
                    tableName: `${t.name} · Table ${table.index + 1}`,
                    leaseController: t.lease,
                });
            engine.startTournamentRound({
                tournament: {
                    tournamentId: t.id,
                    name: t.name,
                    roundNumber: t.round,
                    tableIndex: table.index,
                    drainPercent: t.drainPercent || 0,
                },
                seats: seats.map(entry => this._seatInfo(entry)),
                spectators: spectators.map(entry => this._seatInfo(entry)),
                stacks,
                dealerUserId: table.dealerUserId,
                playerMode: table.playerMode,
            });
            engine.setFastPlay(this._speed(t));
            if (table.playerMode === 3) t.entries.get(table.dealerUserId).deals += 1;
            for (const id of table.sitOutUserIds) t.entries.get(id).sitOuts += 1;
            for (const entry of [...seats, ...spectators]) this._joinRoom(entry.socketId, t, tableId);
            t.tables.set(tableId, { ...table, tableId, result: null });
            // The table opens on every screen first; the cards fly after the
            // deal delay, so the clients see Dealing Pending and animate.
            engine.tournamentDealDueAt = this.now() + this._delay(t, openDelayMs);
            this.gameService.emitGameState(tableId);
            this._scheduleDeal(t, tableId, openDelayMs);
        }
        if (t.welcome && t.round === 1) t.welcome.dealAt = this.now() + this._delay(t, openDelayMs);
        if (roundCall) roundCall.dealAt = this.now() + this._delay(t, openDelayMs);
        t.lastProgressSignature = null;
        await this.store.updateStatus(t.id, 'running', { currentRound: t.round });
        this._emit(t);
    }

    _scheduleDeal(t, tableId, delayMs = this.dealDelayMs) {
        this.schedule(() => this._dealIfPending(t, tableId).catch(error => {
            this.log.error(`[TOURNAMENT] #${t.id} deal failed at ${tableId}:`, error);
        }), this._delay(t, delayMs));
    }

    async _dealIfPending(t, tableId) {
        if (t.status !== 'running' || !t.tables.has(tableId)) return false;
        const engine = this.gameService.getEngineById(tableId);
        if (!engine || engine.state !== 'Dealing Pending') return false;
        engine.tournamentDealDueAt = null;
        await this.gameService._performAction(tableId, current => current.dealCards(current.dealer));
        return true;
    }

    // Deals that fall due on the heartbeat: the all-pass redeal, and any
    // opening deal whose scheduled step was lost with the process.
    async _dealDueTables(t, now) {
        for (const tableId of t.tables.keys()) {
            const engine = this.gameService.getEngineById(tableId);
            if (!engine || engine.state !== 'Dealing Pending') continue;
            if (!Number.isFinite(engine.tournamentDealDueAt)) {
                engine.tournamentDealDueAt = now + this._delay(t, this.dealDelayMs);
                continue;
            }
            if (now >= engine.tournamentDealDueAt) await this._dealIfPending(t, tableId);
        }
    }

    // Between rounds every live stack drops by the tournament's percentage,
    // rounded up so the smallest stack still feels it. Applied after the
    // round's chips have moved and before busts, so a drop to nothing is a
    // bust like any other.
    _applyDrain(t) {
        const percent = Number(t.drainPercent) || 0;
        if (percent <= 0) {
            t.lastDrain = null;
            return null;
        }
        const drops = {};
        const changes = {};
        for (const entry of this._alive(t)) {
            if (entry.stack <= 0) continue;
            const drop = Math.ceil(entry.stack * percent / 100);
            entry.stack -= drop;
            drops[entry.username] = drop;
            changes[entry.userId] = -drop;
        }
        t.lastDrain = { round: t.round, percent, drops };
        return { percent, changes };
    }

    // Between rounds a lone table that is being kept still shows on the
    // board (finished), so nobody is bounced off the felt.
    _tableRows(t) {
        if (t.tables.size > 0) return [...t.tables.values()];
        return t.heldTable ? [t.heldTable] : [];
    }

    _tableProgress(table) {
        const done = { phase: 'done', trick: TRICKS_PER_ROUND, tricksTotal: TRICKS_PER_ROUND };
        if (table.result) return done;
        const engine = this.gameService.getEngineById(table.tableId);
        if (!engine) return done;
        const state = engine.state;
        let phase = 'playing';
        if (state === 'Dealing Pending') phase = 'dealing';
        else if (BIDDING_STATES.has(state)) phase = 'bidding';
        else if (state === 'Awaiting Next Round Trigger') phase = 'done';
        return { phase, trick: Number(engine.tricksPlayedCount) || 0, tricksTotal: TRICKS_PER_ROUND };
    }

    _progressSignature(t) {
        return this._tableRows(t)
            .map(table => {
                const progress = this._tableProgress(table);
                return `${table.tableId}:${progress.phase}:${progress.trick}`;
            })
            .join('|');
    }

    // The tournament-wide voice room, shaped like a table for the signaling
    // relay (events/socketActionGuard.js): every human in the tournament is
    // a member for the whole event, so the mesh survives every reseat.
    voiceRoomView(tournamentId) {
        const t = this.get(tournamentId);
        // The room stays open through the podium: players keep talking on the
        // summary until they leave for the lobby.
        if (!t || !['registering', 'running', 'complete'].includes(t.status)) return null;
        const players = {};
        for (const entry of t.entries.values()) {
            if (entry.isBot || ['withdrawn', 'refunded'].includes(entry.status)) continue;
            players[entry.userId] = {
                userId: entry.userId,
                playerName: entry.username,
                socketId: entry.socketId || null,
                isSpectator: false,
                isBot: false,
                disconnected: !this._socket(entry.socketId),
            };
        }
        const director = this;
        return {
            tableId: this._roomName(t),
            tournamentVoiceRoom: true,
            players,
            reconnectPlayer(userId, socket) { return director.bindSocket(userId, socket); },
        };
    }

    // From GameService, when a tournament table's round has been scored.
    async onTableComplete(payload) {
        const t = this.get(payload?.tournamentId);
        if (!t || t.status !== 'running' || payload.roundNumber !== t.round) return;
        const table = t.tables.get(payload.tableId);
        if (!table || table.result) return;
        table.result = payload;
        this._applyPacePressure(t);
        this._emit(t);
        if ([...t.tables.values()].every(candidate => candidate.result)) {
            // Let the round summary play out on every screen before the room
            // is reseated; the presentation lock is the same one games use,
            // and tick() releases it early once every table's ceremony is
            // acknowledged.
            t.roundCompleteAt = this.now();
            this._schedule(t, () => this._finishRound(t), this._delay(t, this.presentationHoldMs));
        }
    }

    // Pace pressure: once most tables have finished the round, the tables
    // still playing go on the clock (core/tournamentClock.js). With two
    // tables that means as soon as the other one is done; with more, when
    // two-thirds are done.
    _applyPacePressure(t) {
        const tables = [...t.tables.values()];
        const total = tables.length;
        const done = tables.filter(table => table.result).length;
        if (total < 2 || done === total) return false;
        const threshold = total === 2 ? 1 : Math.ceil(total * 2 / 3);
        if (done < threshold) return false;
        let flipped = false;
        for (const table of tables) {
            if (table.result) continue;
            const engine = this.gameService.getEngineById(table.tableId);
            if (tournamentClock.setOnTheClock(engine, true)) {
                flipped = true;
                this.gameService.emitGameState(table.tableId);
            }
        }
        if (flipped) this.log.log(`[TOURNAMENT] #${t.id} round ${t.round}: ${total - done} table(s) on the clock.`);
        return flipped;
    }

    // Every table's round summary has been acknowledged (or its clock has
    // run out), so the room need not sit out the rest of the hold.
    _presentationReleased(t, now = this.now()) {
        if (!t.roundCompleteAt) return false;
        for (const table of t.tables.values()) {
            const engine = this.gameService.getEngineById(table.tableId);
            if (!engine) continue;
            if (!engine.isRoundPresentationAdvanceReady(now)) return false;
        }
        return true;
    }

    async _finishRound(t) {
        if (t.status !== 'running' || t.tables.size === 0) return;
        t.pendingTimer = null;
        t.roundCompleteAt = null;
        this._unwatchAll(t);
        // The welcome belongs to the opening; its audio is not kept past it.
        if (t.welcome && t.round === 1) {
            t.welcome.audio = null;
            if (t.welcome.audioState === 'ready') t.welcome.audioState = 'spent';
        }
        // The round call belongs to the round that just ended.
        t.roundCall = null;
        // Player names are the engine's keys; the tournament's own roster is
        // the authority for turning them back into ids (a table restored
        // after a deploy may have no engine at all).
        const idByName = new Map([...t.entries.values()].map(entry => [entry.username, entry.userId]));
        const roundTables = [];
        for (const table of t.tables.values()) {
            const changes = {};
            for (const [name, score] of Object.entries(table.result?.scores || {})) {
                const userId = idByName.get(name);
                const entry = userId == null ? null : t.entries.get(userId);
                if (!entry) continue;
                changes[userId] = Number(score) - entry.stack;
            }
            // Two players sharing the widow seat split the sitting-out
            // dealer's share of a failed bid between them.
            if (table.spectatorUserIds.length > 0) {
                const dealerGain = Math.max(0, changes[table.dealerUserId] || 0);
                const share = Math.floor(dealerGain / (table.spectatorUserIds.length + 1));
                for (const spectatorId of table.spectatorUserIds) {
                    changes[spectatorId] = share;
                    changes[table.dealerUserId] -= share;
                }
            }
            for (const [userId, delta] of Object.entries(changes)) {
                t.entries.get(Number(userId)).stack += delta;
            }
            roundTables.push({
                tableIndex: table.index,
                playerMode: table.playerMode,
                seating: [...table.seats],
                dealerUserId: table.dealerUserId,
                sitOutUserIds: [...table.sitOutUserIds],
                bidType: table.result?.bidType ?? null,
                bidderUserId: idByName.get(table.result?.bidderName) ?? null,
                dealExecuted: Boolean(table.result?.dealExecuted),
                pointChanges: changes,
                allPassRedeals: table.result?.allPassRedeals || 0,
            });
        }
        const finishedTables = [...t.tables.values()];
        t.tables = new Map();
        const drain = this._applyDrain(t);
        const busted = this._applyBusts(t);
        const alive = this._alive(t);
        // One table, still a tournament: keep the room seated and reopen the
        // next round in place instead of sending everyone to the board.
        const keepSeated = finishedTables.length === 1
            && alive.length >= MIN_SEATS
            && tableSizes(alive.length).length === 1
            && Boolean(this.gameService.getEngineById(finishedTables[0].tableId));
        if (!keepSeated) {
            for (const table of finishedTables) this.gameService.destroyTournamentEngine(table.tableId);
        }
        t.reuseTableId = keepSeated ? finishedTables[0].tableId : null;
        t.heldTable = keepSeated ? finishedTables[0] : null;
        if (busted.length > 0) {
            this.log.log(`[TOURNAMENT] #${t.id} round ${t.round}: out — ${busted.map(entry => entry.username).join(', ')}.`);
        }
        await this.store.saveRound({
            tournamentId: t.id,
            roundNumber: t.round,
            tables: roundTables,
            drain,
            entryUpdates: [...t.entries.values()]
                .filter(entry => entry.status !== 'withdrawn')
                .map(entry => ({
                    userId: entry.userId, stack: entry.stack, sitOuts: entry.sitOuts, deals: entry.deals,
                    status: entry.status, bustedRound: entry.bustedRound,
                })),
        });
        if (alive.length < MIN_SEATS) {
            await this._finish(t);
            return;
        }
        const delay = this._delay(t, keepSeated ? this.singleTableDelayMs : this.boardDelayMs);
        t.nextRoundAt = this.now() + delay;
        this._emit(t);
        this._schedule(t, () => this._startRound(t), delay);
    }

    // ---- Watching another table while yours is done ----------------------
    // A player whose table has finished the round (or who is out) may sit in
    // as a spectator at a table still playing. The seat is a spectator entry
    // on that engine (hands stay hidden: the engine serializes per viewer),
    // and it is removed the moment the room reseats.
    watchTable(tournamentId, userId, tableId, socket) {
        const t = this.get(tournamentId);
        if (!t || t.status !== 'running') throw new TournamentError('NOT_RUNNING', 'That tournament is not running.');
        const entry = t.entries.get(Number(userId));
        if (!entry || ['withdrawn', 'refunded'].includes(entry.status)) throw new TournamentError('NOT_ENTERED', 'You are not in this tournament.');
        const table = t.tables.get(tableId);
        if (table && (table.seats.includes(entry.userId) || table.spectatorUserIds.includes(entry.userId))) {
            throw new TournamentError('OWN_TABLE', 'That is your own table.');
        }
        if (!table || table.result) throw new TournamentError('TABLE_DONE', 'That table has finished its round.');
        const own = this._ownTable(t, entry.userId);
        if (own && !own.result) {
            const ownEngine = this.gameService.getEngineById(own.tableId);
            if (ownEngine && ownEngine.state !== 'Awaiting Next Round Trigger') {
                throw new TournamentError('STILL_PLAYING', 'Finish your own round first.');
            }
        }
        const engine = this.gameService.getEngineById(tableId);
        if (!engine) throw new TournamentError('TABLE_DONE', 'That table has finished its round.');
        if (entry.watchingTableId && entry.watchingTableId !== tableId) this._unwatch(t, entry, { announce: false });
        if (socket) entry.socketId = socket.id;
        engine.players[entry.userId] = {
            userId: entry.userId,
            playerName: entry.username,
            socketId: entry.socketId || null,
            tokens: null,
            isSpectator: true,
            disconnected: false,
            isBot: false,
            untimedBotGames: false,
        };
        entry.watchingTableId = tableId;
        socket?.join?.(tableId);
        this.gameService.emitGameState(tableId);
        return this.publicState(t, entry.userId);
    }

    unwatchTable(tournamentId, userId) {
        const t = this.get(tournamentId);
        if (!t) throw new TournamentError('NOT_FOUND', 'No such tournament.');
        const entry = t.entries.get(Number(userId));
        if (!entry) throw new TournamentError('NOT_ENTERED', 'You are not in this tournament.');
        this._unwatch(t, entry, { announce: true });
        return this.publicState(t, entry.userId);
    }

    _unwatch(t, entry, { announce }) {
        const tableId = entry.watchingTableId;
        entry.watchingTableId = null;
        if (!tableId) return;
        const engine = this.gameService.getEngineById(tableId);
        if (engine?.players?.[entry.userId]?.isSpectator) delete engine.players[entry.userId];
        this._socket(entry.socketId)?.leave?.(tableId);
        if (!announce) return;
        // Back to their own (finished) table, if it is still standing.
        const own = this._ownTable(t, entry.userId);
        if (own && this.gameService.getEngineById(own.tableId)) this.gameService.emitGameState(own.tableId);
    }

    _unwatchAll(t) {
        for (const entry of t.entries.values()) {
            if (entry.watchingTableId) this._unwatch(t, entry, { announce: false });
        }
    }

    _ownTable(t, userId) {
        return this._tableRows(t).find(table => table.seats.includes(userId) || table.spectatorUserIds.includes(userId)) || null;
    }

    _applyBusts(t) {
        const busted = [];
        for (const entry of this._alive(t)) {
            if (entry.stack > 0 && !entry.quit) continue;
            entry.status = 'busted';
            entry.bustedRound = t.round;
            busted.push(entry);
        }
        return busted;
    }

    async _finish(t) {
        if (t.status !== 'running') return;
        const survivors = this._alive(t).map(entry => ({ userId: entry.userId, stack: entry.stack }));
        const busted = [...t.entries.values()]
            .filter(entry => entry.status === 'busted')
            .map(entry => ({ userId: entry.userId, stack: entry.stack, bustedRound: entry.bustedRound }));
        const placings = rankFinishers({ survivors, busted });
        const fieldSize = this._starters(t).length;
        const potCents = t.buyInCents * fieldSize;
        const prizes = allocatePrizeCents(placings, potCents, fieldSize);
        const results = placings.map(placing => ({
            userId: placing.userId,
            place: placing.place,
            prizeCents: prizes.get(placing.userId) || 0,
            stack: placing.stack,
            bustedRound: placing.bustedRound,
        }));
        t.status = 'complete';
        t.endedAt = this.now();
        for (const result of results) {
            const entry = t.entries.get(result.userId);
            entry.status = 'finished';
            entry.place = result.place;
            entry.prizeCents = result.prizeCents;
        }
        await this.store.finish({ tournamentId: t.id, fieldSize, buyInCents: t.buyInCents, results, endedAt: new Date(t.endedAt) });
        this._releaseLeases(t);
        const podium = results.filter(result => result.place <= 3)
            .map(result => `${result.place}. ${t.entries.get(result.userId).username} (${result.prizeCents / 100})`);
        this.log.log(`[TOURNAMENT] #${t.id} "${t.name}" finished after ${t.round} rounds: ${podium.join(' · ')}.`);
        this._emit(t);
    }

    async _refundAndClose(t, status, reason) {
        if (t.pendingTimer) {
            this.cancelSchedule(t.pendingTimer);
            t.pendingTimer = null;
        }
        for (const table of t.tables.values()) this.gameService.destroyTournamentEngine(table.tableId);
        this._dropHeldTable(t);
        t.tables = new Map();
        const refunds = [...t.entries.values()]
            .filter(entry => !['withdrawn', 'refunded'].includes(entry.status))
            .map(entry => ({ userId: entry.userId, cents: t.buyInCents }));
        t.status = status;
        t.endedAt = this.now();
        t.closeReason = reason;
        await this.store.refundAll({ tournamentId: t.id, status, refunds, reason });
        for (const refund of refunds) t.entries.get(refund.userId).status = 'refunded';
        this._releaseLeases(t);
        this.log.log(`[TOURNAMENT] #${t.id} "${t.name}" ${status}: ${reason} (${refunds.length} buy-in(s) refunded).`);
        this._emit(t);
    }

    // ---------------------------------------------------------- the welcome

    // The call to the felt. Runs once, as the tournament starts: the field
    // in reading order (host first, then as they registered), each player's
    // tournament record for the favorites, and Liam's line. The audio is
    // generated in the background — the start never waits on the TTS; the
    // line lands when it lands and the clients play it if the felt is still
    // waiting on its first deal.
    async _prepareWelcome(t) {
        const field = this._alive(t);
        const ordered = [
            ...field.filter(entry => entry.userId === t.creatorUserId),
            ...field.filter(entry => entry.userId !== t.creatorUserId),
        ];
        let records = new Map();
        try {
            records = await this.store.loadTournamentRecords(ordered.map(entry => entry.userId));
        } catch (error) {
            this.log.error(`[TOURNAMENT] #${t.id} could not load records for the favorites:`, error.message);
        }
        const favorites = pickFavorites(ordered, records);
        const script = buildWelcomeScript({ id: t.id, name: t.name, entries: ordered, favorites });
        const welcome = { favorites, script, audio: null, audioState: this.speakWelcome ? 'pending' : 'none', dealAt: null };
        t.welcome = welcome;
        if (!this.speakWelcome) return;
        const timeout = new Promise(resolve => {
            this.schedule(() => resolve(null), this.welcomeSynthTimeoutMs);
        });
        Promise.race([Promise.resolve().then(() => this.speakWelcome(script)), timeout])
            .then(audio => {
                if (t.welcome !== welcome) return;
                if (audio) {
                    welcome.audio = audio;
                    welcome.audioState = 'ready';
                    this._emit(t);
                } else {
                    welcome.audioState = 'failed';
                    this.log.log(`[TOURNAMENT] #${t.id} welcome line unavailable; the felt opens with the fanfare alone.`);
                }
            })
            .catch(error => {
                if (t.welcome === welcome) welcome.audioState = 'failed';
                this.log.error(`[TOURNAMENT] #${t.id} welcome line failed:`, error.message);
            });
    }

    // Player-facing: only while round one is still waiting on its first deal.
    _welcomeState(t) {
        if (!t.welcome || t.round !== 1 || !t.welcome.dealAt) return null;
        const now = this.now();
        if (now >= t.welcome.dealAt) return null;
        return {
            dealInSeconds: Math.max(0, Math.ceil((t.welcome.dealAt - now) / 1000)),
            audio: t.welcome.audioState === 'ready',
        };
    }

    // Liam's line for an entrant of the tournament; null for anyone else,
    // and once the opening has passed.
    welcomeAudioFor(tournamentId, userId) {
        const t = this.get(tournamentId);
        if (!t || !t.welcome || !t.welcome.audio) return null;
        return this._entrantAudio(t, userId, t.welcome.audio);
    }

    // The round call, rounds two onward: Liam names the round and how many
    // players still hold chips, over the ring card, while the deal holds.
    // Lines repeat across events (a few hundred possible sentences), so the
    // voice service caches them by text — a cached line is ready before the
    // felt opens; a fresh one lands a few seconds in. Never blocks the round.
    _prepareRoundCall(t) {
        if (!this.speakRoundCall) return null;
        const playersLeft = this._alive(t).length;
        const text = buildRoundCall({ round: t.round, playersLeft });
        const roundCall = { round: t.round, playersLeft, text, audio: null, audioState: 'pending', dealAt: null };
        t.roundCall = roundCall;
        const timeout = new Promise(resolve => {
            this.schedule(() => resolve(null), this.welcomeSynthTimeoutMs);
        });
        Promise.race([Promise.resolve().then(() => this.speakRoundCall(text)), timeout])
            .then(audio => {
                if (t.roundCall !== roundCall) return;
                if (audio) {
                    roundCall.audio = audio;
                    roundCall.audioState = 'ready';
                    this._emit(t);
                } else {
                    roundCall.audioState = 'failed';
                }
            })
            .catch(error => {
                if (t.roundCall === roundCall) roundCall.audioState = 'failed';
                this.log.error(`[TOURNAMENT] #${t.id} round ${t.round} call failed:`, error.message);
            });
        return roundCall;
    }

    // Player-facing: only while the round's tables are waiting on the deal.
    _roundCallState(t) {
        const call = t.roundCall;
        if (!call || call.round !== t.round || !call.dealAt) return null;
        const now = this.now();
        if (now >= call.dealAt) return null;
        return {
            round: call.round,
            playersLeft: call.playersLeft,
            dealInSeconds: Math.max(0, Math.ceil((call.dealAt - now) / 1000)),
            audio: call.audioState === 'ready',
        };
    }

    roundCallAudioFor(tournamentId, userId) {
        const t = this.get(tournamentId);
        if (!t || !t.roundCall || !t.roundCall.audio) return null;
        return this._entrantAudio(t, userId, t.roundCall.audio);
    }

    _entrantAudio(t, userId, audio) {
        const entry = t.entries.get(Number(userId));
        if (!entry || ['withdrawn', 'refunded'].includes(entry.status)) return null;
        return audio;
    }

    // ------------------------------------------------------------- helpers

    _newTournament(fields) {
        return {
            ...fields,
            status: 'registering',
            startedAt: null,
            endedAt: null,
            closeReason: null,
            round: 0,
            roundCompleteAt: null,
            fastPlay: false,
            pendingStep: null,
            reuseTableId: null,
            heldTable: null,
            nextRoundAt: null,
            lastProgressSignature: null,
            drainPercent: Number(fields.drainPercent) || 0,
            lastDrain: null,
            welcome: null,
            roundCall: null,
            entries: new Map(),
            tables: new Map(),
            lease: this.gameService.createBotSeatLease(`tn-${fields.id}`),
            pendingTimer: null,
        };
    }

    _newEntry({ userId, username, isBot, socketId = null, tokens = null, stack }) {
        return {
            userId: Number(userId), username, isBot: Boolean(isBot), socketId, tokens,
            status: 'registered', stack, sitOuts: 0, deals: 0, bustedRound: null, place: null, prizeCents: 0, quit: false,
            watchingTableId: null,
        };
    }

    _seatInfo(entry) {
        const connected = !entry.isBot && Boolean(this._socket(entry.socketId));
        return {
            userId: entry.userId,
            playerName: entry.username,
            isBot: entry.isBot,
            socketId: connected ? entry.socketId : null,
            connected,
            tokens: entry.tokens,
        };
    }

    _registering(tournamentId) {
        const t = this.get(tournamentId);
        if (!t) throw new TournamentError('NOT_FOUND', 'That tournament does not exist.');
        if (t.status !== 'registering') throw new TournamentError('NOT_OPEN', 'That tournament is not open for registration.');
        return t;
    }

    _creatorOnly(t, requesterId) {
        if (t.creatorUserId !== Number(requesterId)) throw new TournamentError('CREATOR_ONLY', 'Only the creator can do that.');
    }

    _seatCount(t) {
        return [...t.entries.values()].filter(entry => entry.status !== 'withdrawn').length;
    }

    _starters(t) {
        return [...t.entries.values()].filter(entry => !['withdrawn', 'refunded'].includes(entry.status));
    }

    _alive(t) {
        return [...t.entries.values()].filter(entry => entry.status === 'playing');
    }

    // Nobody but house players still in. A quitter is out for good even
    // though the house plays their seat to the end of the round.
    _botsOnly(t) {
        const stillIn = this._alive(t).filter(entry => entry.quit !== true);
        return stillIn.length > 0 && stillIn.every(entry => entry.isBot);
    }

    _speed(t) {
        return t.fastPlay === true ? FAST_PLAY_DIVISOR : 1;
    }

    // A wait in the round loop at the tournament's current speed.
    _delay(t, ms) {
        return Math.max(0, Math.ceil(ms / this._speed(t)));
    }

    // Every live table takes the new speed, a deal still pending falls due
    // sooner, and the step already on the clock (the recap hold, the board)
    // is re-timed from what is left of it.
    _applyFastPlay(t) {
        const now = this.now();
        const speed = this._speed(t);
        for (const table of t.tables.values()) {
            const engine = this.gameService.getEngineById(table.tableId);
            if (!engine) continue;
            engine.setFastPlay(speed);
            if (engine.state === 'Dealing Pending' && Number.isFinite(engine.tournamentDealDueAt) && speed > 1) {
                engine.tournamentDealDueAt = now + Math.ceil(Math.max(0, engine.tournamentDealDueAt - now) / speed);
            }
        }
        if (t.pendingTimer && t.pendingStep) {
            const remaining = Math.max(0, t.pendingStep.dueAt - now);
            this._schedule(t, t.pendingStep.fn, speed > 1 ? Math.ceil(remaining / speed) : remaining);
        }
    }

    _releaseLeases(t) {
        for (const entry of t.entries.values()) {
            if (entry.isBot) t.lease.release(entry.userId);
        }
    }

    _schedule(t, fn, delayMs) {
        if (t.pendingTimer) this.cancelSchedule(t.pendingTimer);
        t.pendingStep = { fn, dueAt: this.now() + delayMs };
        t.pendingTimer = this.schedule(() => {
            t.pendingTimer = null;
            t.pendingStep = null;
            // Returned so a test scheduler can await the step; setTimeout
            // ignores it.
            return Promise.resolve().then(fn).catch(error => {
                this.log.error(`[TOURNAMENT] #${t.id} step failed:`, error);
            });
        }, delayMs);
    }

    _roomName(t) {
        return `tournament-${t.id}`;
    }

    _dropHeldTable(t) {
        if (t.reuseTableId) this.gameService.destroyTournamentEngine(t.reuseTableId);
        t.reuseTableId = null;
        t.heldTable = null;
    }

    _socket(socketId) {
        if (!socketId) return null;
        return this.io?.sockets?.sockets?.get?.(socketId) || null;
    }

    _joinRoom(socketId, t, tableId = null) {
        const socket = this._socket(socketId);
        if (!socket) return;
        socket.join?.(this._roomName(t));
        if (tableId) socket.join?.(tableId);
    }

    _emit(t) {
        if (!this.io) return;
        try {
            this.io.to?.(this._roomName(t))?.emit?.('tournamentState', this.publicState(t));
            this.io.emit?.('tournamentLobby', this.lobbyState());
        } catch (error) {
            this.log.error(`[TOURNAMENT] Broadcast failed for #${t.id}:`, error.message);
        }
    }
}

module.exports = {
    TournamentDirector,
    TournamentError,
    STARTING_STACKS,
    START_RULES,
    MAX_BUY_IN_CENTS,
    MIN_SEATS,
    MAX_SEATS,
    TOURNAMENT_VENUE,
    REGISTRATION_TTL_MS,
    MIN_START_LEAD_MS,
    RESUME_GRACE_MS,
    FAST_PLAY_DIVISOR,
    SNAPSHOT_VERSION,
    DRAIN_PERCENTS,
    DEFAULT_DRAIN_PERCENT,
};
