'use strict';

// The socket edge of tournaments (events/gameEvents.js): every tournament
// event reaches the director with the right identity, VIP is read from the
// database rather than the token, a seated player cannot register, a
// registered player cannot take a cash seat, and director errors come back
// as player-facing messages.

const assert = require('node:assert/strict');
const jsonwebtoken = require('jsonwebtoken');
const registerGameHandlers = require('../src/events/gameEvents');
const { TournamentError } = require('../src/tournament/TournamentDirector');

const pass = message => console.log(`  ✓ ${message}`);

function createPool({ vipIds = new Set() } = {}) {
    const users = new Map([
        [7, { id: 7, username: 'Anna', is_admin: false }],
        [8, { id: 8, username: 'Ben', is_admin: false }],
    ]);
    return {
        queries: [],
        async query(text, params = []) {
            const sql = String(text);
            this.queries.push({ sql, params });
            if (/SELECT\s+id,\s*username,\s*is_admin/i.test(sql)) {
                const user = users.get(Number(params[0]));
                return { rows: user ? [{ ...user }] : [] };
            }
            if (/SELECT is_vip FROM users/i.test(sql)) {
                return { rows: [{ is_vip: vipIds.has(Number(params[0])) }] };
            }
            if (/SUM\(amount\)/i.test(sql)) return { rows: [{ tokens: '12.50' }] };
            throw new Error('Unexpected query: ' + sql);
        },
    };
}

function createDirectorStub() {
    const calls = [];
    const inTournament = new Set();
    const stub = {
        calls,
        inTournament,
        failNext: null,
        lobbyState: () => ({ open: { id: 1, name: 'Open one' }, running: [] }),
        tournamentOf: userId => (inTournament.has(Number(userId)) ? { id: 1, status: 'registering' } : null),
        publicState: (t, viewerUserId) => ({ id: t.id, viewer: { userId: viewerUserId } }),
    };
    for (const method of ['create', 'register', 'withdraw', 'findPlayer', 'start', 'cancel', 'quit', 'setFastPlay']) {
        stub[method] = async (...args) => {
            calls.push([method, ...args]);
            if (stub.failNext) {
                const error = stub.failNext;
                stub.failNext = null;
                throw error;
            }
            return { id: 1, status: 'registering', via: method };
        };
    }
    return stub;
}

function createHarness(gameService) {
    let authMiddleware;
    let connectionHandler;
    const io = {
        sockets: { sockets: new Map() },
        use(handler) { authMiddleware = handler; },
        on(event, handler) { if (event === 'connection') connectionHandler = handler; },
        emit() {},
        to() { return { emit() {} }; },
        disconnectSockets() {},
    };
    gameService.io = io;
    registerGameHandlers(io, gameService, { setIntervalFn: () => ({ unref() {} }), clearIntervalFn() {} });
    return {
        async authenticate(socket) {
            return new Promise(resolve => authMiddleware(socket, error => resolve(error)));
        },
        connect(socket) {
            const handlers = {};
            socket.data = socket.data || {};
            socket.emitted = [];
            socket.rooms = new Set();
            socket.on = (event, handler) => { handlers[event] = handler; };
            socket.emit = (event, payload) => { socket.emitted.push({ event, payload }); };
            socket.join = room => socket.rooms.add(room);
            socket.leave = room => socket.rooms.delete(room);
            io.sockets.sockets.set(socket.id, socket);
            connectionHandler(socket);
            return {
                socket,
                received: event => socket.emitted.filter(item => item.event === event),
                async trigger(event, payload) {
                    if (!handlers[event]) throw new Error('No socket handler registered for ' + event);
                    return handlers[event](payload);
                },
            };
        },
    };
}

async function runTournamentEventTests() {
    const originalSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'tournament-events-test-secret';
    try {
        const pool = createPool({ vipIds: new Set([7]) });
        const director = createDirectorStub();
        const liveEngine = {
            tableId: 'table-9',
            tableType: 'private',
            gameStarted: true,
            state: 'Playing Phase',
            players: {},
            playerOrder: { allIds: [], includes: () => false },
        };
        const engines = { 'table-9': liveEngine };
        const gameService = {
            pool,
            tournamentDirector: director,
            getAllEngines: () => engines,
            getEngineById: tableId => engines[tableId],
            getLobbyState: () => ({ themes: [] }),
            getStateForSocket: () => ({}),
            emitGameState() {},
            evaluateQuickPlayTable() {},
            evaluateTerminalCleanup() {},
            isRenameInFlight: () => false,
        };
        const harness = createHarness(gameService);
        const sign = (id, username) => jsonwebtoken.sign({ id, username }, process.env.JWT_SECRET);
        const sockAnna = { id: 'sock-anna', handshake: { auth: { token: sign(7, 'Anna') } }, data: {} };
        const sockBen = { id: 'sock-ben', handshake: { auth: { token: sign(8, 'Ben') } }, data: {} };
        assert.equal(await harness.authenticate(sockAnna), undefined);
        assert.equal(await harness.authenticate(sockBen), undefined);

        director.inTournament.add(8);
        const anna = harness.connect(sockAnna);
        const ben = harness.connect(sockBen);

        assert.deepEqual(anna.received('tournamentLobby').at(-1).payload, { open: { id: 1, name: 'Open one' }, running: [] });
        assert.equal(anna.received('tournamentState').length, 0, 'a player in no tournament gets no tournamentState on connect');
        assert.deepEqual(ben.received('tournamentState').at(-1).payload, { id: 1, viewer: { userId: 8 } }, 'a registered player gets their tournament on connect');
        pass('Connecting pushes the tournament lobby, and your own tournament if you are in one.');

        await anna.trigger('tournamentSync', {});
        assert.equal(anna.received('tournamentLobby').length, 2);
        pass('tournamentSync re-pushes the lobby on request.');

        await ben.trigger('tournamentCreate', { buyInTokens: 1, startingStack: 120 });
        const benCreate = director.calls.find(call => call[0] === 'create' && call[1].id === 8);
        assert.equal(benCreate[1].is_vip, false, 'VIP comes from the database, and Ben is not one');
        await anna.trigger('tournamentCreate', { settings: { buyInTokens: 2, startingStack: 90, maxSeats: 6 } });
        const annaCreate = director.calls.find(call => call[0] === 'create' && call[1].id === 7);
        assert.equal(annaCreate[1].is_vip, true);
        assert.deepEqual(annaCreate[2], { buyInTokens: 2, startingStack: 90, maxSeats: 6 }, 'settings pass through');
        assert.deepEqual(anna.received('tournamentState').at(-1).payload, { id: 1, status: 'registering', via: 'create' });
        pass('tournamentCreate reads VIP fresh from the database and hands the settings to the director.');

        await anna.trigger('tournamentJoin', { tournamentId: '1' });
        const join = director.calls.find(call => call[0] === 'register');
        assert.equal(join[1], 1);
        assert.equal(join[2].id, 7);
        assert.deepEqual(join[3], { socketId: 'sock-anna', tokens: '12.50' }, 'the socket and the live balance travel with the registration');
        pass('tournamentJoin registers with the socket id and the current balance.');

        liveEngine.players[7] = { userId: 7, playerName: 'Anna', isSpectator: false, socketId: 'sock-anna' };
        const before = director.calls.length;
        await anna.trigger('tournamentJoin', { tournamentId: 1 });
        assert.equal(director.calls.length, before, 'no registration while seated at a live table');
        assert.match(anna.received('error').at(-1).payload.message, /Finish your current game/);
        assert.equal(anna.received('tournamentActionFailed').at(-1).payload.code, 'SEATED_ELSEWHERE');
        delete liveEngine.players[7];
        pass('A player mid-game cannot register; the refusal names the reason.');

        for (const [event, method] of [
            ['tournamentLeave', 'withdraw'], ['tournamentFindPlayer', 'findPlayer'], ['tournamentStart', 'start'],
            ['tournamentCancel', 'cancel'], ['tournamentQuit', 'quit'],
        ]) {
            await anna.trigger(event, { tournamentId: 3 });
            const call = director.calls.at(-1);
            assert.deepEqual(call, [method, 3, 7], `${event} reaches director.${method}(3, 7)`);
        }
        await anna.trigger('tournamentFastPlay', { tournamentId: 3, enabled: true });
        assert.deepEqual(director.calls.at(-1), ['setFastPlay', 3, 7, true], 'fast play on reaches the director');
        await anna.trigger('tournamentFastPlay', { tournamentId: 3, enabled: false });
        assert.deepEqual(director.calls.at(-1), ['setFastPlay', 3, 7, false], 'and off again');
        await anna.trigger('tournamentFastPlay', { tournamentId: 3 });
        assert.deepEqual(director.calls.at(-1), ['setFastPlay', 3, 7, true], 'omitting enabled means on');
        pass('Leave, find player, start, cancel, quit and fast play each reach the director with the tournament and the user.');

        director.failNext = new TournamentError('CREATOR_ONLY', 'Only the creator can do that.');
        await anna.trigger('tournamentStart', { tournamentId: 3 });
        assert.equal(anna.received('error').at(-1).payload.message, 'Only the creator can do that.');
        assert.deepEqual(anna.received('tournamentActionFailed').at(-1).payload, { action: 'tournamentStart', code: 'CREATOR_ONLY', message: 'Only the creator can do that.' });
        director.failNext = new Error('database on fire');
        await anna.trigger('tournamentStart', { tournamentId: 3 });
        assert.equal(anna.received('error').at(-1).payload.message, 'The tournament action could not be completed.', 'internal errors never leak');
        pass('Director errors become player-facing messages; internal errors stay generic.');

        await anna.trigger('tournamentJoin', 'nonsense');
        assert.equal(anna.received('error').at(-1).payload.message, 'Invalid tournament request.');
        pass('Malformed payloads are refused.');

        await ben.trigger('joinTable', { tableId: 'table-9' });
        assert.match(ben.received('error').at(-1).payload.message, /in a tournament/);
        await ben.trigger('quickPlay', { theme: 'fort-creek' });
        assert.match(ben.received('error').at(-1).payload.message, /in a tournament/);
        pass('A tournament player cannot take a cash seat or Quick Play until the tournament is over.');
    } finally {
        process.env.JWT_SECRET = originalSecret;
    }
    console.log('Tournament socket event tests passed.');
}

module.exports = runTournamentEventTests;

if (require.main === module) {
    runTournamentEventTests().catch(error => { console.error(error); process.exitCode = 1; });
}
