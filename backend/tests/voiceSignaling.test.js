'use strict';

// Voice chat signaling relay integration test.
//
// Proves (or disproves) that the server-side relay in gameEvents.js delivers
// every voice event between two seated humans: roster on join, peer-joined
// notifications, bidirectional voiceSignal relay with correct fromUserId,
// speaking broadcasts, and cleanup on voiceLeave / socket disconnect. Also
// locks in idempotent joins and authoritative cleanup for table switches,
// explicit leaves, stale seat sockets, and spectator transitions. Non-members
// are rejected and oversized signal payloads are dropped without weakening
// membership checks.

const assert = require('node:assert/strict');
const jsonwebtoken = require('jsonwebtoken');
const registerGameHandlers = require('../src/events/gameEvents');
const { TournamentDirector } = require('../src/tournament/TournamentDirector');

const TABLE_ID = 'voice-table';
const SECOND_TABLE_ID = 'voice-table-two';

function createVoicePool(extraUsers = []) {
    // users.id is SERIAL (int4), so pg returns JS numbers. The voice room is
    // keyed by socket.user.id and looked up via Number(targetUserId); this
    // stub intentionally mirrors the numeric id type.
    const users = new Map([
        [7, { id: 7, username: 'Anna', is_admin: false }],
        [8, { id: 8, username: 'Ben', is_admin: false }],
        [9, { id: 9, username: 'Cara', is_admin: true }],
        ...extraUsers.map(user => [user.id, user]),
    ]);
    return {
        voiceJoinQueries: 0,
        async query(text, params = []) {
            const sql = String(text);
            if (/SELECT\s+id,\s*username,\s*is_admin(?:,\s*sessions_valid_after)?(?:,\s*COALESCE\(untimed_bot_games,\s*FALSE\)\s+AS\s+untimed_bot_games)?\s+FROM\s+users/i.test(sql)) {
                const user = users.get(Number(params[0]));
                return { rows: user ? [{ ...user }] : [] };
            }
            if (/SUM\(amount\)/i.test(sql)) return { rows: [{ tokens: '10.00' }] };
            if (/SELECT chat_muted_until FROM users/i.test(sql)) {
                this.voiceJoinQueries += 1;
                return { rows: [{ chat_muted_until: null }] };
            }
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

function createEngine(tableId, initialPlayers = []) {
    const players = Object.fromEntries(initialPlayers.map(player => [player.userId, { ...player }]));
    const playerOrder = {
        count: initialPlayers.filter(player => !player.isSpectator).length,
        allIds: initialPlayers.filter(player => !player.isSpectator).map(player => player.userId),
        includes(id) { return this.allIds.includes(Number(id)); },
        add(id) {
            const normalizedId = Number(id);
            if (!this.allIds.includes(normalizedId)) this.allIds.push(normalizedId);
            this.count = this.allIds.length;
        },
        remove(id) {
            const normalizedId = Number(id);
            this.allIds = this.allIds.filter(playerId => playerId !== normalizedId);
            this.count = this.allIds.length;
        },
    };
    const scores = Object.fromEntries(initialPlayers
        .filter(player => !player.isSpectator)
        .map(player => [player.playerName, 120]));
    return {
        tableId,
        tableType: 'private',
        state: 'Waiting for Players',
        gameStarted: false,
        gameStartPending: false,
        players,
        playerOrder,
        scores,
        joinTable(user, socketId, tokens, asSpectator = false) {
            players[user.id] = {
                userId: user.id,
                playerName: user.username,
                socketId,
                tokens,
                isSpectator: asSpectator,
                disconnected: false,
            };
            if (!asSpectator) {
                playerOrder.add(user.id);
                scores[user.username] = 120;
            }
        },
        leaveTable(userId) {
            const player = players[userId];
            if (!player) return;
            delete scores[player.playerName];
            delete players[userId];
            playerOrder.remove(userId);
        },
        reconnectPlayer(userId, socket) {
            if (players[userId]) players[userId].socketId = socket.id;
        },
        disconnectPlayer(userId) {
            this.leaveTable(userId);
        },
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
            const packetMiddleware = [];
            socket.data = socket.data || {};
            socket.emitted = [];
            socket.rooms = new Set();
            socket.on = (event, handler) => { handlers[event] = handler; };
            socket.use = handler => { packetMiddleware.push(handler); };
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
                    // Socket.IO's disconnect is a server-side lifecycle event,
                    // not an inbound application packet.
                    if (event !== 'disconnect') {
                        for (const middleware of packetMiddleware) {
                            let allowed = false;
                            middleware([event, payload], () => { allowed = true; });
                            if (!allowed) return;
                        }
                    }
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
        const engine = createEngine(TABLE_ID, [
            { userId: 7, playerName: 'Anna', socketId: null, isSpectator: false },
            { userId: 8, playerName: 'Ben', socketId: null, isSpectator: false },
        ]);
        const secondEngine = createEngine(SECOND_TABLE_ID);
        const engines = { [TABLE_ID]: engine, [SECOND_TABLE_ID]: secondEngine };
        const gameService = {
            pool,
            getAllEngines: () => engines,
            getEngineById: tableId => engines[tableId],
            getLobbyState: () => ({ themes: [] }),
            getStateForSocket: currentEngine => ({
                tableId: currentEngine.tableId,
                players: currentEngine.players,
                playerOrderActive: currentEngine.playerOrder.allIds,
            }),
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
            { tableId: TABLE_ID, userId: 8, playerName: 'Ben' },
            'the existing member is told about the joiner (non-initiator side)',
        );
        assert.equal(connB.received('voicePeerJoined').length, 0, 'the joiner is never notified about itself');
        // Exactly-one-initiator invariant for near-simultaneous joins: the
        // server handles voiceJoin events sequentially, so whoever lands
        // second gets a non-empty roster and initiates; the first gets
        // voicePeerJoined and answers. Nobody waits on the other to offer.
        assert.equal(rosterA.payload.peers.length + rosterB.payload.peers.length, 1);

        // Re-running always-on setup on the same live socket must be harmless.
        // In particular it must not tell the other side to tear down a healthy
        // RTCPeerConnection while this side keeps its existing peer record.
        const peerJoinsAtABeforeDuplicate = connA.received('voicePeerJoined').length;
        await connB.trigger('voiceJoin', { tableId: TABLE_ID });
        assert.deepEqual(
            connB.received('voiceRoster').at(-1).payload,
            { tableId: TABLE_ID, peers: [{ userId: 7, playerName: 'Anna' }] },
            'an idempotent same-socket join still confirms the current roster',
        );
        assert.equal(
            connA.received('voicePeerJoined').length,
            peerJoinsAtABeforeDuplicate,
            'a duplicate same-socket join does not reset healthy peers',
        );

        // --- voiceSignal relays in BOTH directions with correct fromUserId --
        const offer = { sdp: { type: 'offer', sdp: 'v=0 test-offer' } };
        await connB.trigger('voiceSignal', { tableId: TABLE_ID, targetUserId: 7, data: offer });
        assert.deepEqual(
            connA.received('voiceSignal').at(-1).payload,
            { tableId: TABLE_ID, fromUserId: 8, data: offer },
            'joiner to existing member offer relays with the sender identity',
        );

        const answer = { sdp: { type: 'answer', sdp: 'v=0 test-answer' } };
        await connA.trigger('voiceSignal', { tableId: TABLE_ID, targetUserId: 8, data: answer });
        assert.deepEqual(
            connB.received('voiceSignal').at(-1).payload,
            { tableId: TABLE_ID, fromUserId: 7, data: answer },
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
            { tableId: TABLE_ID, fromUserId: 7, data: candidate },
            'ICE candidates relay, and a stringified target id still resolves the numeric room key',
        );

        // --- payload guard: oversized data dropped, membership intact -------
        const signalsAtABefore = connA.received('voiceSignal').length;
        await connB.trigger('voiceSignal', { tableId: TABLE_ID, targetUserId: 7, data: { sdp: 'x'.repeat(30001) } });
        assert.equal(connA.received('voiceSignal').length, signalsAtABefore, 'oversized payloads are not relayed');
        assert.match(connB.received('error').at(-1).payload.message, /Invalid voice payload/i);

        // --- voiceSpeaking broadcasts to everyone but the speaker -----------
        await connA.trigger('voiceSpeaking', { tableId: TABLE_ID, speaking: false });
        assert.deepEqual(connB.received('voiceSpeaking').at(-1).payload,
            { tableId: TABLE_ID, userId: 7, speaking: false },
            'the first reported speaking state is delivered even when initially silent');
        await connA.trigger('voiceSpeaking', { tableId: TABLE_ID, speaking: true });
        assert.deepEqual(
            connB.received('voiceSpeaking').at(-1).payload,
            { tableId: TABLE_ID, userId: 7, speaking: true },
        );
        assert.equal(connA.received('voiceSpeaking').length, 0, 'the speaker is not echoed its own state');
        const speakingUpdates = connB.received('voiceSpeaking').length;
        await connA.trigger('voiceSpeaking', { tableId: TABLE_ID, speaking: true });
        assert.equal(connB.received('voiceSpeaking').length, speakingUpdates,
            'unchanged speaking states do not fan out to the room again');
        await connA.trigger('voiceSpeaking', { tableId: TABLE_ID, speaking: false });
        assert.deepEqual(
            connB.received('voiceSpeaking').at(-1).payload,
            { tableId: TABLE_ID, userId: 7, speaking: false },
        );

        // --- non-members cannot enter or signal into the room ---------------
        await connC.trigger('voiceJoin', { tableId: TABLE_ID });
        assert.equal(connC.received('voiceRoster').length, 0, 'a user not seated at the table cannot join voice');
        assert.match(connC.received('error').at(-1).payload.message, /not at this table/i);
        const signalsAtA = connA.received('voiceSignal').length;
        await connC.trigger('voiceSignal', { tableId: TABLE_ID, targetUserId: 7, data: { sdp: { type: 'offer', sdp: 'x' } } });
        assert.equal(connA.received('voiceSignal').length, signalsAtA, 'non-members cannot signal seated players');

        // --- voiceLeave notifies the room and revokes signaling -------------
        await connA.trigger('voiceLeave', { tableId: TABLE_ID });
        assert.deepEqual(connB.received('voicePeerLeft').at(-1).payload, { tableId: TABLE_ID, userId: 7 });
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

        // --- authoritative table transitions revoke the old voice seat -----
        const peerLeavesAtBBeforeSwitch = connB.received('voicePeerLeft').length;
        await connA.trigger('joinTable', { tableId: SECOND_TABLE_ID });
        assert.equal(engine.players[7], undefined, 'a table switch releases the old game seat');
        assert.equal(secondEngine.players[7]?.socketId, sockA.id, 'the same socket controls the new table seat');
        assert.equal(connB.received('voicePeerLeft').length, peerLeavesAtBBeforeSwitch + 1);
        assert.deepEqual(
            connB.received('voicePeerLeft').at(-1).payload,
            { tableId: TABLE_ID, userId: 7 },
            'switching tables revokes voice at the old table',
        );

        const signalsAtAAfterSwitch = connA.received('voiceSignal').length;
        await connB.trigger('voiceSignal', {
            tableId: TABLE_ID,
            targetUserId: 7,
            data: { sdp: { type: 'offer', sdp: 'stale-table-offer' } },
        });
        assert.equal(
            connA.received('voiceSignal').length,
            signalsAtAAfterSwitch,
            'the old table cannot signal a player after that player switches tables',
        );

        await connA.trigger('joinTable', { tableId: TABLE_ID });
        await connA.trigger('voiceJoin', { tableId: TABLE_ID });
        assert.equal(engine.players[7]?.socketId, sockA.id, 'the player can return to the original table');

        const peerLeavesAtBBeforeExplicitLeave = connB.received('voicePeerLeft').length;
        await connA.trigger('leaveTable', { tableId: TABLE_ID });
        assert.equal(engine.players[7], undefined, 'an explicit leave releases the game seat');
        assert.equal(connB.received('voicePeerLeft').length, peerLeavesAtBBeforeExplicitLeave + 1);
        assert.deepEqual(
            connB.received('voicePeerLeft').at(-1).payload,
            { tableId: TABLE_ID, userId: 7 },
            'an explicit table leave revokes voice without relying on client cleanup',
        );

        await connA.trigger('joinTable', { tableId: TABLE_ID });
        await connA.trigger('voiceJoin', { tableId: TABLE_ID });

        // A room entry is not enough: its socket must still control a live,
        // non-spectator seat at this exact table before signaling is relayed.
        const signalsAtBBeforeStaleTarget = connB.received('voiceSignal').length;
        const peerLeavesAtABeforeStaleTarget = connA.received('voicePeerLeft').length;
        engine.players[8].socketId = 'superseded-ben-socket';
        await connA.trigger('voiceSignal', {
            tableId: TABLE_ID,
            targetUserId: 8,
            data: { sdp: { type: 'offer', sdp: 'stale-target-offer' } },
        });
        assert.equal(
            connB.received('voiceSignal').length,
            signalsAtBBeforeStaleTarget,
            'signaling is not relayed to a stale seat socket',
        );
        assert.equal(connA.received('voicePeerLeft').length, peerLeavesAtABeforeStaleTarget + 1);
        assert.deepEqual(
            connA.received('voicePeerLeft').at(-1).payload,
            { tableId: TABLE_ID, userId: 8 },
            'stale target pruning is visible to the remaining table voice members',
        );

        engine.reconnectPlayer(8, sockB);
        await connB.trigger('voiceJoin', { tableId: TABLE_ID });
        assert.deepEqual(
            connA.received('voicePeerJoined').at(-1).payload,
            { tableId: TABLE_ID, userId: 8, playerName: 'Ben' },
            'a restored target can join voice again on its authoritative socket',
        );

        await connB.trigger('disconnect');
        assert.deepEqual(
            connA.received('voicePeerLeft').at(-1).payload,
            { tableId: TABLE_ID, userId: 8 },
            'a socket disconnect removes the member and notifies the room',
        );

        // --- becoming a spectator also revokes table voice -----------------
        await connC.trigger('joinTable', { tableId: TABLE_ID });
        await connC.trigger('voiceJoin', { tableId: TABLE_ID });
        const peerLeavesAtABeforeSpectator = connA.received('voicePeerLeft').length;
        await connC.trigger('moveToSpectator', { tableId: TABLE_ID });
        assert.equal(engine.players[9]?.isSpectator, true);
        assert.equal(connA.received('voicePeerLeft').length, peerLeavesAtABeforeSpectator + 1);
        assert.deepEqual(
            connA.received('voicePeerLeft').at(-1).payload,
            { tableId: TABLE_ID, userId: 9 },
            'a spectator transition revokes voice without waiting for the client to leave',
        );

        await runTournamentVoiceBudgetTests();
        console.log('Voice chat signaling relay tests passed.');
    } finally {
        if (originalSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = originalSecret;
    }
}

async function runTournamentVoiceBudgetTests() {
    const originalNow = Date.now;
    let now = originalNow();
    Date.now = () => now;
    try {
        const pool = createVoicePool([
            { id: 10, username: 'Dan', is_admin: false },
            { id: 11, username: 'Eva', is_admin: false },
        ]);
        const humans = [
            { userId: 7, username: 'Anna' },
            { userId: 8, username: 'Ben' },
            { userId: 9, username: 'Cara' },
            { userId: 10, username: 'Dan' },
            { userId: 11, username: 'Eva' },
        ];
        const engine = createEngine(TABLE_ID, humans.slice(0, 3).map(human => ({
            userId: human.userId, playerName: human.username, socketId: null, isSpectator: false,
        })));
        const gameActions = [];
        const gameService = {
            pool,
            getAllEngines: () => ({ [TABLE_ID]: engine }),
            getEngineById: tableId => tableId === TABLE_ID ? engine : null,
            getLobbyState: () => ({ themes: [] }),
            emitGameState() {},
            evaluateTerminalCleanup() {},
            startGame: (tableId, userId) => { gameActions.push({ tableId, userId }); },
        };
        const director = new TournamentDirector({ gameService, store: {} });
        // Exercise the real tournament membership and voice-room view; the
        // unrelated lobby/scoreboard serialization can stay out of this fixture.
        director.publicState = tournament => ({ id: tournament.id, status: tournament.status });
        director.lobbyState = () => ({ open: null, running: [] });
        const tournament = {
            id: 42, status: 'running', tables: new Map(),
            entries: new Map(humans.map(human => [human.userId, {
                ...human, isBot: false, status: 'playing', socketId: null,
            }])),
        };
        director.tournaments.set(tournament.id, tournament);
        gameService.tournamentDirector = director;
        const harness = createSocketHarness(gameService);
        director.io = harness.io;
        const roomId = 'tournament-42';
        const connections = [];
        for (const human of humans) {
            const token = jsonwebtoken.sign({ id: human.userId, username: human.username }, process.env.JWT_SECRET);
            const socket = makeSocket(`tourney-${human.userId}`, token);
            assert.equal(await harness.authenticate(socket), undefined);
            const connection = harness.connect(socket);
            await connection.trigger('voiceJoin', { tableId: roomId });
            assert.equal(connection.received('voiceRoster').at(-1).payload.peers.length, connections.length,
                'every tournament joiner receives all existing humans, including other tables');
            if (connections.length === 0) {
                await connection.trigger('voiceSpeaking', { tableId: roomId, speaking: true });
            } else {
                assert.deepEqual(connection.received('voiceSpeaking').at(-1).payload,
                    { tableId: roomId, userId: 7, speaking: true },
                    'a new listener immediately receives an already-speaking peer');
            }
            connections.push(connection);
        }
        assert.equal(connections.reduce((sum, connection) => sum
            + connection.received('voiceRoster').at(-1).payload.peers.length, 0), 10,
        'five humans establish exactly ten distinct peer pairs');

        for (const from of connections) {
            for (const target of connections) {
                if (target === from) continue;
                await from.trigger('voiceSignal', {
                    tableId: roomId, targetUserId: target.socket.user.id,
                    data: { candidate: { candidate: 'candidate:tournament' } },
                });
                assert.equal(target.received('voiceSignal').at(-1).payload.fromUserId, from.socket.user.id);
            }
        }

        const [speaker, listener] = connections;
        await listener.trigger('voiceJoin', { tableId: roomId });
        assert.deepEqual(listener.received('voiceSpeaking').at(-1).payload,
            { tableId: roomId, userId: 7, speaking: true },
            'an idempotent roster refresh also refreshes active speakers');
        const signalCount = () => connections.reduce((sum, connection) => sum + connection.received('voiceSignal').length, 0);
        const signalsBeforeBurst = signalCount();
        for (let index = 0; index < 300; index += 1) {
            await speaker.trigger('voiceSignal', {
                tableId: roomId, targetUserId: connections[1 + index % 4].socket.user.id,
                data: { candidate: { candidate: `candidate:burst-${index}` } },
            });
        }
        const relayed = signalCount() - signalsBeforeBurst;
        assert.ok(relayed >= 200, 'the voice budget tolerates a twenty-peer negotiation burst beyond the game budget');
        assert.ok(relayed < 300, 'voice traffic still has a finite independent rate limit');
        assert.match(speaker.received('error').at(-1).payload.message, /Voice chat is reconnecting too quickly/);

        await speaker.trigger('voiceLeave', { tableId: roomId });
        assert.deepEqual(listener.received('voicePeerLeft').at(-1).payload, { tableId: roomId, userId: 7 },
            'leaving voice remains available after a signaling flood');
        await speaker.trigger('voiceJoin', { tableId: roomId });
        const rostersBeforeFlood = speaker.received('voiceRoster').length;
        const queriesBeforeFlood = pool.voiceJoinQueries;
        for (let index = 0; index < 12; index += 1) {
            await speaker.trigger('voiceJoin', { tableId: roomId });
        }
        const joinsAccepted = speaker.received('voiceRoster').length - rostersBeforeFlood;
        assert.ok(joinsAccepted > 0 && joinsAccepted < 12, 'voice membership changes have their own finite budget');
        assert.equal(pool.voiceJoinQueries - queriesBeforeFlood, joinsAccepted,
            'rate-limited joins do not perform database checks');

        for (let index = 0; index < 60; index += 1) {
            await speaker.trigger('startGame', { tableId: TABLE_ID });
        }
        assert.equal(gameActions.length, 60, 'voice traffic leaves the entire existing game-action burst budget available');
        await speaker.trigger('startGame', { tableId: TABLE_ID });
        assert.equal(gameActions.length, 60, 'game actions retain their existing rate limit');

        now += 1000;
        const beforeRefill = signalCount();
        await speaker.trigger('voiceSignal', {
            tableId: roomId, targetUserId: 8, data: { candidate: { candidate: 'candidate:after-refill' } },
        });
        await speaker.trigger('voiceJoin', { tableId: roomId });
        await speaker.trigger('startGame', { tableId: TABLE_ID });
        assert.equal(signalCount(), beforeRefill + 1, 'voice signaling resumes after its independent refill');
        assert.equal(speaker.received('voiceRoster').length, rostersBeforeFlood + joinsAccepted + 1,
            'voice membership resumes after its independent refill');
        assert.equal(gameActions.length, 61, 'the original game-action refill still works');
    } finally {
        Date.now = originalNow;
    }
}

if (require.main === module) {
    runVoiceSignalingTests().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = runVoiceSignalingTests;
