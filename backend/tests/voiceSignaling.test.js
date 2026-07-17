'use strict';

// Voice chat signaling relay integration test.
//
// Proves (or disproves) that the server-side relay in gameEvents.js delivers
// every voice event between two seated humans: roster on join, peer-joined
// notifications, bidirectional voiceSignal relay with correct fromUserId,
// speaking broadcasts, and cleanup on voiceLeave / socket disconnect. Also
// locks in the guard semantics: non-members are rejected and oversized
// signal payloads are dropped without weakening membership checks.

const assert = require('node:assert/strict');
const jsonwebtoken = require('jsonwebtoken');
const registerGameHandlers = require('../src/events/gameEvents');

const TABLE_ID = 'voice-table';

function createVoicePool() {
    // users.id is SERIAL (int4), so pg returns JS numbers. The voice room is
    // keyed by socket.user.id and looked up via Number(targetUserId); this
    // stub intentionally mirrors the numeric id type.
    const users = new Map([
        [7, { id: 7, username: 'Anna', is_admin: false }],
        [8, { id: 8, username: 'Ben', is_admin: false }],
        [9, { id: 9, username: 'Cara', is_admin: false }],
    ]);
    return {
        async query(text, params = []) {
            const sql = String(text);
            if (/SELECT\s+id,\s*username,\s*is_admin\s+FROM\s+users/i.test(sql)) {
                const user = users.get(Number(params[0]));
                return { rows: user ? [{ ...user }] : [] };
            }
            if (/SUM\(amount\)/i.test(sql)) return { rows: [{ tokens: '10.00' }] };
            if (/INSERT\s+INTO\s+lobby_chat_messages/i.test(sql)) {
                return { rows: [{ id: 1, username: 'System', message: '', created_at: new Date(0).toISOString() }] };
            }
            throw new Error('Unexpected voice signaling test query: ' + sql);
        },
    };
}

function createIntervalController() {
    return {
        setIntervalFn() {
            return { unref() {} };
        },
        clearIntervalFn() {},
    };
}

function createEngine() {
    const players = {
        7: { userId: 7, playerName: 'Anna', socketId: null, isSpectator: false },
        8: { userId: 8, playerName: 'Ben', socketId: null, isSpectator: false },
    };
    return {
        tableId: TABLE_ID,
        tableType: 'private',
        state: 'Waiting for Players',
        gameStarted: false,
        gameStartPending: false,
        players,
        playerOrder: {
            count: 2,
            allIds: [7, 8],
            includes(id) { return this.allIds.includes(Number(id)); },
        },
        reconnectPlayer(userId, socket) {
            if (players[userId]) players[userId].socketId = socket.id;
        },
        disconnectPlayer(userId) {
            if (players[userId]) players[userId].socketId = null;
        },
        leaveTable() {},
    };
}

function createSocketHarness(gameService) {
    let authMiddleware;
    let connectionHandler;
    const io = {
        sockets: { sockets: new Map() },
        use(handler) { authMiddleware = handler; },
        on(event, handler) {
            if (event === 'connection') connectionHandler = handler;
        },
        emit() {},
        // The voice relay addresses peers with io.to(socketId).emit(...).
        // Route those emissions into the target stub socket's inbox.
        to(socketId) {
            return {
                emit(event, payload) {
                    const target = io.sockets.sockets.get(socketId);
                    if (target) target.emit(event, payload);
                },
            };
        },
        disconnectSockets() {},
    };
    gameService.io = io;
    registerGameHandlers(io, gameService, createIntervalController());

    return {
        io,
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
            socket.disconnect = () => { socket.disconnected = true; };
            io.sockets.sockets.set(socket.id, socket);
            connectionHandler(socket);
            return {
                socket,
                received(event) {
                    return socket.emitted.filter(item => item.event === event);
                },
                async trigger(event, payload) {
                    if (!handlers[event]) throw new Error('No socket handler registered for ' + event);
                    return handlers[event](payload);
                },
            };
        },
    };
}

function makeSocket(id, token) {
    return { id, handshake: { auth: { token } }, data: {} };
}

async function runVoiceSignalingTests() {
    const originalSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'voice-signaling-test-secret';
    try {
        const pool = createVoicePool();
        const engine = createEngine();
        const gameService = {
            pool,
            getAllEngines: () => ({ [TABLE_ID]: engine }),
            getEngineById: tableId => (tableId === TABLE_ID ? engine : undefined),
            getLobbyState: () => ({ themes: [] }),
            getStateForSocket: () => ({}),
            emitGameState() {},
            evaluateQuickPlayTable() {},
            evaluateTerminalCleanup() {},
        };
        const harness = createSocketHarness(gameService);

        const sign = (id, username) => jsonwebtoken.sign({ id, username }, process.env.JWT_SECRET);
        const sockA = makeSocket('sock-anna', sign(7, 'Anna'));
        const sockB = makeSocket('sock-ben', sign(8, 'Ben'));
        const sockC = makeSocket('sock-cara', sign(9, 'Cara'));

        assert.equal(await harness.authenticate(sockA), undefined);
        assert.equal(await harness.authenticate(sockB), undefined);
        assert.equal(await harness.authenticate(sockC), undefined);
        assert.equal(typeof sockA.user.id, 'number', 'socket identity ids are numeric (SERIAL int4)');

        const connA = harness.connect(sockA);
        const connB = harness.connect(sockB);
        const connC = harness.connect(sockC);
        assert.equal(engine.players[7].socketId, sockA.id, 'Anna is seated on her live socket');
        assert.equal(engine.players[8].socketId, sockB.id, 'Ben is seated on his live socket');

        // --- join order: first joiner sees an empty roster ------------------
        await connA.trigger('voiceJoin', { tableId: TABLE_ID });
        const rosterA = connA.received('voiceRoster').at(-1);
        assert.ok(rosterA, 'the first joiner receives a voiceRoster');
        assert.deepEqual(rosterA.payload, { tableId: TABLE_ID, peers: [] });
        assert.equal(connA.received('voicePeerJoined').length, 0);

        // --- second joiner: roster names the first, first is notified -------
        await connB.trigger('voiceJoin', { tableId: TABLE_ID });
        const rosterB = connB.received('voiceRoster').at(-1);
        assert.deepEqual(
            rosterB.payload,
            { tableId: TABLE_ID, peers: [{ userId: 7, playerName: 'Anna' }] },
            'the second joiner receives the existing member in its roster (it becomes the sole initiator)',
        );
        assert.deepEqual(
            connA.received('voicePeerJoined').at(-1).payload,
            { userId: 8, playerName: 'Ben' },
            'the existing member is told about the joiner (non-initiator side)',
        );
        assert.equal(connB.received('voicePeerJoined').length, 0, 'the joiner is never notified about itself');
        // Exactly-one-initiator invariant for near-simultaneous joins: the
        // server handles voiceJoin events sequentially, so whoever lands
        // second gets a non-empty roster and initiates; the first gets
        // voicePeerJoined and answers. Nobody waits on the other to offer.
        assert.equal(rosterA.payload.peers.length + rosterB.payload.peers.length, 1);

        // --- voiceSignal relays in BOTH directions with correct fromUserId --
        const offer = { sdp: { type: 'offer', sdp: 'v=0 test-offer' } };
        await connB.trigger('voiceSignal', { tableId: TABLE_ID, targetUserId: 7, data: offer });
        assert.deepEqual(
            connA.received('voiceSignal').at(-1).payload,
            { fromUserId: 8, data: offer },
            'joiner to existing member offer relays with the sender identity',
        );

        const answer = { sdp: { type: 'answer', sdp: 'v=0 test-answer' } };
        await connA.trigger('voiceSignal', { tableId: TABLE_ID, targetUserId: 8, data: answer });
        assert.deepEqual(
            connB.received('voiceSignal').at(-1).payload,
            { fromUserId: 7, data: answer },
            'existing member to joiner answer relays with the sender identity',
        );

        const candidate = {
            candidate: {
                candidate: 'candidate:1 1 udp 2122260223 192.0.2.10 54321 typ host',
                sdpMid: '0',
                sdpMLineIndex: 0,
            },
        };
        await connA.trigger('voiceSignal', { tableId: TABLE_ID, targetUserId: '8', data: candidate });
        assert.deepEqual(
            connB.received('voiceSignal').at(-1).payload,
            { fromUserId: 7, data: candidate },
            'ICE candidates relay, and a stringified target id still resolves the numeric room key',
        );

        // --- payload guard: oversized data dropped, membership intact -------
        const signalsAtABefore = connA.received('voiceSignal').length;
        await connB.trigger('voiceSignal', { tableId: TABLE_ID, targetUserId: 7, data: { sdp: 'x'.repeat(30001) } });
        assert.equal(connA.received('voiceSignal').length, signalsAtABefore, 'oversized payloads are not relayed');
        assert.match(connB.received('error').at(-1).payload.message, /Invalid voice payload/i);

        // --- voiceSpeaking broadcasts to everyone but the speaker -----------
        await connA.trigger('voiceSpeaking', { tableId: TABLE_ID, speaking: true });
        assert.deepEqual(connB.received('voiceSpeaking').at(-1).payload, { userId: 7, speaking: true });
        assert.equal(connA.received('voiceSpeaking').length, 0, 'the speaker is not echoed its own state');
        await connA.trigger('voiceSpeaking', { tableId: TABLE_ID, speaking: false });
        assert.deepEqual(connB.received('voiceSpeaking').at(-1).payload, { userId: 7, speaking: false });

        // --- non-members cannot enter or signal into the room ---------------
        await connC.trigger('voiceJoin', { tableId: TABLE_ID });
        assert.equal(connC.received('voiceRoster').length, 0, 'a user not seated at the table cannot join voice');
        assert.match(connC.received('error').at(-1).payload.message, /not at this table/i);
        const signalsAtA = connA.received('voiceSignal').length;
        await connC.trigger('voiceSignal', { tableId: TABLE_ID, targetUserId: 7, data: { sdp: { type: 'offer', sdp: 'x' } } });
        assert.equal(connA.received('voiceSignal').length, signalsAtA, 'non-members cannot signal seated players');

        // --- voiceLeave notifies the room and revokes signaling -------------
        await connA.trigger('voiceLeave', { tableId: TABLE_ID });
        assert.deepEqual(connB.received('voicePeerLeft').at(-1).payload, { userId: 7 });
        const signalsAtBBefore = connB.received('voiceSignal').length;
        await connA.trigger('voiceSignal', { tableId: TABLE_ID, targetUserId: 8, data: { sdp: { type: 'offer', sdp: 'x' } } });
        assert.equal(connB.received('voiceSignal').length, signalsAtBBefore, 'members who left voice can no longer signal');

        // --- rejoin works and socket disconnect cleans up the room ----------
        await connA.trigger('voiceJoin', { tableId: TABLE_ID });
        assert.deepEqual(
            connA.received('voiceRoster').at(-1).payload.peers,
            [{ userId: 8, playerName: 'Ben' }],
            'a rejoining member sees the remaining roster and initiates again',
        );
        await connB.trigger('disconnect');
        assert.deepEqual(
            connA.received('voicePeerLeft').at(-1).payload,
            { userId: 8 },
            'a socket disconnect removes the member and notifies the room',
        );

        console.log('Voice chat signaling relay tests passed.');
    } finally {
        if (originalSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = originalSecret;
    }
}

if (require.main === module) {
    runVoiceSignalingTests().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = runVoiceSignalingTests;
