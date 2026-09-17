// backend/tests/sessionArbiter.test.js
//
// One account, one live client (src/events/sessionArbiter.js). Sept 16 2026:
// a laptop left open kept taking a tournament seat from the same player's
// phone — 211 socket swaps in an hour. These pin the ruling (a deliberate
// open takes the account over, an automatic reconnect never does) and the
// way gameEvents applies it without the table ever seeing the player blink.

'use strict';

const assert = require('node:assert/strict');
const GameService = require('../src/services/GameService');
const registerGameHandlers = require('../src/events/gameEvents');
const {
    OWNER_GRACE_MS,
    arbitrate,
    createSessionRegistry,
    readClientSession,
} = require('../src/events/sessionArbiter');
const { createGameServiceWithoutHeartbeat } = require('./test-helpers');

const PHONE = 'phone-client-0001';
const LAPTOP = 'laptop-client-0001';

function createIo() {
    return {
        emitted: [],
        sockets: { sockets: new Map() },
        to() { return { emit() {} }; },
        emit(event, payload) { this.emitted.push({ event, payload }); },
    };
}

// Sockets that close the way Socket.IO's do: a server-side disconnect(true)
// removes the socket from the registry and runs its 'disconnect' handler
// synchronously, inside the caller.
function createSocketHarness(service, io, handlerOptions = {}) {
    let connectionHandler;
    io.use = () => {};
    io.on = (event, handler) => { if (event === 'connection') connectionHandler = handler; };
    io.disconnectSockets = () => {};
    registerGameHandlers(io, service, {
        setIntervalFn: () => ({ unref() {} }),
        clearIntervalFn: () => {},
        ...handlerOptions,
    });
    return {
        connect(user, id, auth) {
            const handlers = {};
            const close = (reason) => {
                if (!socket.connected) return;
                socket.connected = false;
                io.sockets.sockets.delete(socket.id);
                socket.closedBy = reason;
                return handlers.disconnect?.(reason);
            };
            const socket = {
                id,
                user,
                data: {},
                connected: true,
                closedBy: null,
                handshake: auth ? { auth } : undefined,
                emitted: [],
                rooms: new Set(),
                on(event, handler) { handlers[event] = handler; },
                emit(event, payload) { this.emitted.push({ event, payload }); },
                join(room) { this.rooms.add(room); },
                leave(room) { this.rooms.delete(room); },
                disconnect() { close('server namespace disconnect'); },
            };
            io.sockets.sockets.set(id, socket);
            connectionHandler(socket);
            return {
                socket,
                handlers,
                displacedAs: () => socket.emitted.find(item => item.event === 'sessionDisplaced')?.payload?.reason || null,
                drop: () => close('transport close'),
            };
        },
    };
}

function seatedTable(service, userId, username, { started }) {
    const engine = service.findQuickPlayTable('fort-creek');
    engine.joinTable({ id: userId, username }, 'socket-before-connect', '100.00');
    if (started) engine.gameStarted = true;
    return engine;
}

async function runSessionArbiterTests() {
    console.log('Running session arbiter tests...');
    let testCounter = 1;
    const pass = (name) => console.log(`  ✔ Test ${testCounter++}: ${name}`);

    // ---- The ruling (pure) ----

    {
        assert.deepEqual(readClientSession({ handshake: { auth: { clientId: PHONE, intent: 'claim' } } }),
            { clientId: PHONE, intent: 'claim' });
        assert.deepEqual(readClientSession({ handshake: { auth: { clientId: PHONE, intent: 'takeover' } } }),
            { clientId: PHONE, intent: 'resume' }, 'anything but "claim" is a resume');
        for (const bad of [undefined, '', 'short', 'has spaces in it', 'x'.repeat(65), 12345678, { id: PHONE }]) {
            assert.equal(readClientSession({ handshake: { auth: { clientId: bad } } }).clientId, null);
        }
        assert.deepEqual(readClientSession({}), { clientId: null, intent: 'resume' });
        assert.deepEqual(readClientSession(undefined), { clientId: null, intent: 'resume' });
        pass('The handshake is read defensively: a malformed client id is a legacy socket.');
    }

    {
        const others = [{ socketId: 'a', clientId: LAPTOP }, { socketId: 'b', clientId: null }];
        const ruling = arbitrate({ clientId: null, intent: 'claim', others, owner: { clientId: LAPTOP, goneAt: null } });
        assert.equal(ruling.verdict, 'legacy');
        assert.deepEqual(ruling.displace, []);
        pass('A socket from a build without a client id is never arbitrated.');
    }

    {
        const others = [
            { socketId: 'laptop-1', clientId: LAPTOP },
            { socketId: 'old-build', clientId: null },
            { socketId: 'phone-zombie', clientId: PHONE },
        ];
        const ruling = arbitrate({ clientId: PHONE, intent: 'claim', others, owner: { clientId: LAPTOP, goneAt: null }, now: 5000 });
        assert.equal(ruling.verdict, 'accept');
        assert.equal(ruling.basis, 'claim');
        assert.deepEqual([...ruling.displace].sort(), ['laptop-1', 'old-build', 'phone-zombie']);
        assert.deepEqual(ruling.owner, { clientId: PHONE, goneAt: null });
        pass('A claim displaces every other client, the standing owner included, and takes ownership.');
    }

    {
        const owner = { clientId: PHONE, goneAt: null };
        const ruling = arbitrate({ clientId: LAPTOP, intent: 'resume', others: [{ socketId: 'phone-1', clientId: PHONE }], owner, now: 5000 });
        assert.equal(ruling.verdict, 'park');
        assert.deepEqual(ruling.displace, []);
        assert.equal(ruling.owner, owner, 'a parked connection changes nothing');

        const againstOldBuild = arbitrate({ clientId: LAPTOP, intent: 'resume', others: [{ socketId: 'old', clientId: null }], owner: null });
        assert.equal(againstOldBuild.verdict, 'park', 'an old-build socket is still a live client');
        pass('An automatic reconnect never takes the account from a live client it does not own.');
    }

    {
        const first = arbitrate({ clientId: LAPTOP, intent: 'resume', others: [], owner: null, now: 1000 });
        assert.equal(first.basis, 'sole');
        assert.deepEqual(first.owner, { clientId: LAPTOP, goneAt: null }, 'alone with no owner: it becomes the owner');

        const zombie = arbitrate({ clientId: PHONE, intent: 'resume', others: [{ socketId: 'phone-zombie', clientId: PHONE }], owner: { clientId: PHONE, goneAt: null }, now: 1000 });
        assert.equal(zombie.verdict, 'accept');
        assert.deepEqual(zombie.displace, ['phone-zombie'], 'its own stale socket is closed, never a reason to park');
        pass('A client alone on the account is accepted and replaces its own stale socket.');
    }

    {
        const goneAt = 100_000;
        const owner = { clientId: PHONE, goneAt };
        // The laptop wakes up inside the phone's blip: accepted, but only
        // keeping the seat warm.
        const warm = arbitrate({ clientId: LAPTOP, intent: 'resume', others: [], owner, now: goneAt + 5000 });
        assert.equal(warm.verdict, 'accept');
        assert.equal(warm.owner, owner, 'the phone still owns the account');
        // The phone comes back inside the grace and takes it back.
        const back = arbitrate({ clientId: PHONE, intent: 'resume', others: [{ socketId: 'laptop-1', clientId: LAPTOP }], owner, now: goneAt + OWNER_GRACE_MS });
        assert.equal(back.verdict, 'accept');
        assert.equal(back.basis, 'owner');
        assert.deepEqual(back.displace, ['laptop-1']);
        assert.deepEqual(back.owner, { clientId: PHONE, goneAt: null });
        // One millisecond past the grace the absence was real: the laptop,
        // where the player has been since, is not thrown out by a phone
        // reconnecting in a pocket.
        const late = arbitrate({ clientId: PHONE, intent: 'resume', others: [{ socketId: 'laptop-1', clientId: LAPTOP }], owner, now: goneAt + OWNER_GRACE_MS + 1 });
        assert.equal(late.verdict, 'park');
        const inherit = arbitrate({ clientId: LAPTOP, intent: 'resume', others: [], owner, now: goneAt + OWNER_GRACE_MS + 1 });
        assert.deepEqual(inherit.owner, { clientId: LAPTOP, goneAt: null }, 'a lapsed owner is replaced by whoever is alone on the account');
        pass(`The owner's own reconnect wins for ${OWNER_GRACE_MS / 1000} s after it drops, and not a moment longer.`);
    }

    {
        let now = 1_000;
        const registry = createSessionRegistry({ now: () => now });
        assert.equal(registry.arbitrate(7, { clientId: PHONE, intent: 'claim' }, []).verdict, 'accept');
        registry.noteDisconnect(7, PHONE, true);
        assert.equal(registry.ownerOf(7).goneAt, null, 'another socket of the same client is still up');
        registry.noteDisconnect(7, LAPTOP, false);
        assert.equal(registry.ownerOf(7).goneAt, null, 'a different client closing is not the owner leaving');
        registry.noteDisconnect(7, null, false);
        assert.equal(registry.ownerOf(7).goneAt, null, 'legacy sockets never touch ownership');
        now = 2_000;
        registry.noteDisconnect(7, PHONE, false);
        assert.equal(registry.ownerOf(7).goneAt, 2_000);
        now = 3_000;
        registry.noteDisconnect(7, PHONE, false);
        assert.equal(registry.ownerOf(7).goneAt, 2_000, 'the grace clock starts once');
        assert.equal(registry.arbitrate(7, { clientId: LAPTOP, intent: 'resume' }, [{ socketId: 's', clientId: PHONE }]).verdict, 'park');
        assert.equal(registry.ownerOf(7).clientId, PHONE, 'a parked ruling is not stored');
        assert.equal(registry.ownerOf(8), null, 'accounts are independent');
        pass('The registry stores accepted rulings per account and starts the grace clock on the last close.');
    }

    // ---- Applied to live sockets (gameEvents) ----

    const account = { id: 22, username: 'Two Devices', is_admin: false };
    const recorded = [];
    const pool = {
        query: async (sql, params) => {
            if (/funnel_events/.test(String(sql))) recorded.push(params);
            return { rows: [{ tokens: '100.00' }], rowCount: 1 };
        },
    };
    const newWorld = ({ started }) => {
        const io = createIo();
        const service = createGameServiceWithoutHeartbeat(GameService, io, pool);
        let now = 1_000_000;
        const harness = createSocketHarness(service, io, { nowFn: () => now });
        const engine = seatedTable(service, account.id, account.username, { started });
        return { io, service, harness, engine, advance(ms) { now += ms; } };
    };

    {
        // The Sept 16 shape: playing on the phone, a laptop left open.
        const { harness, engine, io } = newWorld({ started: true });
        const phone = harness.connect(account, 'phone-1', { clientId: PHONE, intent: 'claim' });
        assert.equal(engine.players[22].socketId, 'phone-1');

        for (let attempt = 1; attempt <= 3; attempt++) {
            const laptop = harness.connect(account, `laptop-auto-${attempt}`, { clientId: LAPTOP, intent: 'resume' });
            assert.equal(laptop.displacedAs(), 'active-elsewhere');
            assert.equal(laptop.socket.connected, false, 'the server closes it, so the client does not reconnect by itself');
            assert.equal(io.sockets.sockets.has(laptop.socket.id), false);
            assert.deepEqual(Object.keys(laptop.handlers), [], 'a parked socket is wired to nothing');
            assert.equal(laptop.socket.rooms.size, 0);
        }
        assert.equal(engine.players[22].socketId, 'phone-1', 'the phone keeps its seat through every automatic reconnect');
        assert.equal(engine.players[22].disconnected, false);
        assert.equal(phone.displacedAs(), null);
        assert.equal(phone.socket.connected, true);
        pass('A laptop left open cannot take the seat from the phone, however often it reconnects.');

        // The player walks over to the laptop and taps "Play here".
        const laptop = harness.connect(account, 'laptop-play-here', { clientId: LAPTOP, intent: 'claim' });
        assert.equal(engine.players[22].socketId, 'laptop-play-here');
        assert.equal(engine.players[22].disconnected, false, 'the table never sees the player leave');
        assert.equal(laptop.displacedAs(), null);
        assert.equal(phone.displacedAs(), 'claimed-elsewhere');
        assert.equal(phone.socket.connected, false);
        assert.equal(phone.socket.closedBy, 'server namespace disconnect');
        // And the phone's automatic reconnects are now the ones parked.
        const phoneAuto = harness.connect(account, 'phone-auto', { clientId: PHONE, intent: 'resume' });
        assert.equal(phoneAuto.displacedAs(), 'active-elsewhere');
        assert.equal(engine.players[22].socketId, 'laptop-play-here');
        pass('"Play here" moves the seat in one step and the other client is put down.');
    }

    {
        // Before the deal a disconnect REMOVES the seat, so the order matters:
        // the new socket must hold the seat before the old one is closed.
        const { harness, engine } = newWorld({ started: false });
        harness.connect(account, 'phone-1', { clientId: PHONE, intent: 'claim' });
        harness.connect(account, 'laptop-1', { clientId: LAPTOP, intent: 'claim' });
        assert.ok(engine.players[22], 'the unstarted seat survives the takeover');
        assert.equal(engine.players[22].socketId, 'laptop-1');
        assert.equal(engine.playerOrder.includes(22), true);
        pass('Taking over a seat at a table that has not started does not vacate it.');
    }

    {
        const { harness, engine, advance } = newWorld({ started: true });
        const phone = harness.connect(account, 'phone-1', { clientId: PHONE, intent: 'claim' });
        await phone.drop(); // network blip; nothing else is connected
        assert.equal(engine.players[22].disconnected, true);

        advance(5_000);
        const laptop = harness.connect(account, 'laptop-woke', { clientId: LAPTOP, intent: 'resume' });
        assert.equal(laptop.displacedAs(), null, 'alone on the account: it may hold the seat');
        assert.equal(engine.players[22].socketId, 'laptop-woke');

        advance(5_000);
        const phoneBack = harness.connect(account, 'phone-2', { clientId: PHONE, intent: 'resume' });
        assert.equal(phoneBack.displacedAs(), null);
        assert.equal(engine.players[22].socketId, 'phone-2', 'the owner takes its seat back');
        assert.equal(engine.players[22].disconnected, false);
        assert.equal(laptop.displacedAs(), 'claimed-elsewhere');
        pass('A phone back from a blip reclaims the seat from a laptop that woke during the gap.');

        await phoneBack.drop();
        advance(OWNER_GRACE_MS + 1);
        const laptopLater = harness.connect(account, 'laptop-later', { clientId: LAPTOP, intent: 'resume' });
        assert.equal(laptopLater.displacedAs(), null);
        const phonePocket = harness.connect(account, 'phone-3', { clientId: PHONE, intent: 'resume' });
        assert.equal(phonePocket.displacedAs(), 'active-elsewhere', 'a long-gone owner does not evict where the player is now');
        assert.equal(engine.players[22].socketId, 'laptop-later');
        pass('Past the grace, ownership follows the client the player actually moved to.');
    }

    {
        // A reconnect that beats its own predecessor's timeout: same client,
        // so the stale socket is closed quietly and never parks the new one.
        const { harness, engine } = newWorld({ started: true });
        const stale = harness.connect(account, 'phone-stale', { clientId: PHONE, intent: 'claim' });
        const recordedBefore = recorded.length;
        const fresh = harness.connect(account, 'phone-fresh', { clientId: PHONE, intent: 'resume' });
        assert.equal(fresh.displacedAs(), null);
        assert.equal(stale.socket.connected, false);
        assert.equal(engine.players[22].socketId, 'phone-fresh');
        assert.equal(engine.players[22].disconnected, false);
        assert.equal(recorded.length, recordedBefore, 'an ordinary reconnect is not counted as a second device');
        pass('A client is never parked by its own stale socket.');
    }

    {
        // Builds from before this existed send no client id: untouched.
        const { harness, engine } = newWorld({ started: true });
        const older = harness.connect(account, 'old-build-1');
        const newer = harness.connect(account, 'old-build-2');
        assert.equal(older.displacedAs(), null);
        assert.equal(newer.displacedAs(), null);
        assert.equal(older.socket.connected, true, 'legacy sockets still coexist, newest holding the seat');
        assert.equal(engine.players[22].socketId, 'old-build-2');
        // A current client claiming the account puts both down.
        harness.connect(account, 'phone-1', { clientId: PHONE, intent: 'claim' });
        assert.equal(older.displacedAs(), 'claimed-elsewhere');
        assert.equal(newer.displacedAs(), 'claimed-elsewhere');
        assert.equal(engine.players[22].socketId, 'phone-1');
        pass('Old-build sockets keep newest-wins among themselves and yield to a current client.');
    }

    {
        const other = { id: 23, username: 'Someone Else', is_admin: false };
        const { harness } = newWorld({ started: true });
        const mine = harness.connect(account, 'phone-1', { clientId: PHONE, intent: 'claim' });
        const theirs = harness.connect(other, 'their-phone', { clientId: PHONE, intent: 'claim' });
        assert.equal(mine.displacedAs(), null, 'another account sharing a client id changes nothing');
        assert.equal(theirs.displacedAs(), null);
        pass('Arbitration is per account.');
    }

    {
        await Promise.resolve();
        const names = recorded.map(params => params[0]);
        assert.ok(names.includes('session_parked'));
        assert.ok(names.includes('session_displaced'));
        assert.ok(recorded.every(params => /^u\d+ /.test(params[1]) && params[1].length <= 64));
        pass('Every parked and displaced connection leaves a funnel_events row to count.');
    }

    console.log('All session arbiter tests passed.');
}

if (require.main === module) {
    runSessionArbiterTests().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}

module.exports = runSessionArbiterTests;
