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
const SNAPSHOT_VERSION = 1;
const TOURNAMENT_VENUE = 'tournament-stage';
const MAX_NAME_LENGTH = 60;
// Escalation: the percentage by which every round's stakes grow.
const ESCALATION_PERCENTS = Object.freeze([0, 5, 10, 20]);
const DEFAULT_ESCALATION_PERCENT = 10;

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
            escalationPercent: t.escalationPercent || 0,
            stakesMultiplier: this._stakesMultiplier(t, t.round),
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
        const escalationPercent = settings.escalationPercent === undefined
            ? DEFAULT_ESCALATION_PERCENT
            : Number(settings.escalationPercent);
        if (!ESCALATION_PERCENTS.includes(escalationPercent)) {
            throw new TournamentError('BAD_ESCALATION', `Escalation must be one of ${ESCALATION_PERCENTS.join(', ')} percent.`);
        }

        const { tournamentId, seasonId } = await this.store.createTournament({
            creatorUserId: creator.id, name, venue, buyInCents, startingStack, maxSeats, startRule,
            startsAt: startsAt ? new Date(startsAt) : null,
            escalationPercent,
        });
        const t = this._newTournament({
            id: tournamentId, seasonId, creatorUserId: creator.id, creatorName: creator.username,
            name, venue, buyInCents, startingStack, maxSeats, startRule, startsAt, escalationPercent, createdAt: this.now(),
        });
        this.tournaments.set(t.id, t);
        this.log.log(`[TOURNAMENT] #${t.id} "${t.name}" opened by ${creator.username}: ${t.buyInCents / 100} tokens, stack ${t.startingStack}, ${t.maxSeats} seats, ${t.startRule}, escalation ${t.escalationPercent}%.`);
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
                escalationPercent: tournament.escalationPercent || 0,
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
                escalationPercent: t.escalationPercent || 0,
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
            escalationPercent: meta.escalationPercent || 0,
        });
        t.status = 'running';
        t.startedAt = meta.startedAt;
        t.round = Number(meta.round) || 0;
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
            this._schedule(t, () => this._startRound(t), this.boardDelayMs);
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
                        engine.tournamentDealDueAt = this.now() + this.dealDelayMs;
                    }
                    this.gameService._rebindSocketsForEngine?.(engine);
                    this.gameService.emitGameState(table.tableId);
                }
            }
            t.tables.set(table.tableId, table);
        }
        if ([...t.tables.values()].every(table => table.result)) {
            t.roundCompleteAt = meta.roundCompleteAt || this.now();
            this._schedule(t, () => this._finishRound(t), this.presentationHoldMs);
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
        await this._startRound(t);
    }

    async _startRound(t) {
        if (t.status !== 'running') return;
        t.pendingTimer = null;
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
                    escalationPercent: t.escalationPercent || 0,
                    pointMultiplier: this._stakesMultiplier(t, t.round),
                },
                seats: seats.map(entry => this._seatInfo(entry)),
                spectators: spectators.map(entry => this._seatInfo(entry)),
                stacks,
                dealerUserId: table.dealerUserId,
                playerMode: table.playerMode,
            });
            if (table.playerMode === 3) t.entries.get(table.dealerUserId).deals += 1;
            for (const id of table.sitOutUserIds) t.entries.get(id).sitOuts += 1;
            for (const entry of [...seats, ...spectators]) this._joinRoom(entry.socketId, t, tableId);
            t.tables.set(tableId, { ...table, tableId, result: null });
            // The table opens on every screen first; the cards fly after the
            // deal delay, so the clients see Dealing Pending and animate.
            engine.tournamentDealDueAt = this.now() + this.dealDelayMs;
            this.gameService.emitGameState(tableId);
            this._scheduleDeal(t, tableId);
        }
        t.lastProgressSignature = null;
        await this.store.updateStatus(t.id, 'running', { currentRound: t.round });
        this._emit(t);
    }

    _scheduleDeal(t, tableId) {
        this.schedule(() => this._dealIfPending(t, tableId).catch(error => {
            this.log.error(`[TOURNAMENT] #${t.id} deal failed at ${tableId}:`, error);
        }), this.dealDelayMs);
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
                engine.tournamentDealDueAt = now + this.dealDelayMs;
                continue;
            }
            if (now >= engine.tournamentDealDueAt) await this._dealIfPending(t, tableId);
        }
    }

    _stakesMultiplier(t, round) {
        const percent = Number(t.escalationPercent) || 0;
        if (percent <= 0 || !round || round <= 1) return 1;
        return Number(((1 + percent / 100) ** (round - 1)).toFixed(2));
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
        if (!t || !['registering', 'running'].includes(t.status)) return null;
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
            this._schedule(t, () => this._finishRound(t), this.presentationHoldMs);
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
        this._emit(t);
        this._schedule(t, () => this._startRound(t), keepSeated ? this.singleTableDelayMs : this.boardDelayMs);
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
            reuseTableId: null,
            heldTable: null,
            lastProgressSignature: null,
            escalationPercent: Number(fields.escalationPercent) || 0,
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

    _releaseLeases(t) {
        for (const entry of t.entries.values()) {
            if (entry.isBot) t.lease.release(entry.userId);
        }
    }

    _schedule(t, fn, delayMs) {
        if (t.pendingTimer) this.cancelSchedule(t.pendingTimer);
        t.pendingTimer = this.schedule(() => {
            t.pendingTimer = null;
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
    SNAPSHOT_VERSION,
    ESCALATION_PERCENTS,
    DEFAULT_ESCALATION_PERCENT,
};
