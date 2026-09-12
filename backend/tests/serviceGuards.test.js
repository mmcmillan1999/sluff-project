'use strict';

// Guards around the service's timers: the game-loop heartbeat can be
// stopped for a shutdown, a throwing timer follow-up is logged rather than
// rejected unhandled (which would take the process down), and the deal's
// shuffle can be seeded by a test and restored.

const assert = require('node:assert/strict');
const GameService = require('../src/services/GameService');
const { shuffle, setShuffleRandom } = require('../src/utils/shuffle');
const { makeRng } = require('../src/core/bot-strategies/RolloutEstimator');
const { createGameServiceWithoutHeartbeat } = require('./test-helpers');

const pass = message => console.log(`  ✓ ${message}`);
const mockIo = { to: () => ({ emit: () => {} }), emit: () => {}, sockets: { sockets: new Map() } };
const mockPool = {
    query() { return Promise.resolve({ rows: [], rowCount: 0 }); },
    async connect() { return { query: this.query, release() {} }; },
};

async function runServiceGuardTests() {
    {
        // A real heartbeat: kept on the service, unref'd, and stoppable.
        const service = new GameService(mockIo, mockPool, { botAccounts: [] });
        assert.ok(service._heartbeat, 'the heartbeat handle is kept');
        assert.equal(typeof service.stopHeartbeat, 'function');
        service.stopHeartbeat();
        assert.equal(service._heartbeat, null, 'stopped');
        service.stopHeartbeat(); // idempotent
        pass('The game-loop heartbeat is kept and can be stopped for a shutdown.');
    }
    {
        const service = createGameServiceWithoutHeartbeat(GameService, mockIo, mockPool, { botAccounts: [] });
        const tableId = Object.keys(service.engines)[0];
        const quiet = console.error;
        const logged = [];
        console.error = (...args) => logged.push(args.map(String).join(' '));
        let unhandled = null;
        const onUnhandled = reason => { unhandled = reason; };
        process.on('unhandledRejection', onUnhandled);
        service.timerOverride = (callback) => { callback(); };
        try {
            await service._executeEffects(tableId, [{
                type: 'START_TIMER',
                payload: { duration: 0, onTimeout: () => { throw new Error('boom from a timer'); } },
            }]);
            await new Promise(resolve => setImmediate(resolve));
            await new Promise(resolve => setImmediate(resolve));
            assert.equal(unhandled, null, 'the throw never becomes an unhandled rejection');
            assert.ok(logged.some(line => line.includes('[TIMER] Follow-up failed') && line.includes('boom from a timer')), 'it is logged with the table');
        } finally {
            process.off('unhandledRejection', onUnhandled);
            console.error = quiet;
        }
        pass('A throwing timer follow-up is logged, not left to crash the process.');
    }
    {
        const deck = () => Array.from({ length: 20 }, (_, i) => i + 1);
        setShuffleRandom(makeRng(7));
        const first = shuffle(deck());
        setShuffleRandom(makeRng(7));
        const second = shuffle(deck());
        assert.deepEqual(first, second, 'the same seed deals the same order');
        assert.notDeepEqual(first, deck(), 'and it is a real shuffle');
        setShuffleRandom(null);
        const originalRandom = Math.random;
        Math.random = () => 0;
        try {
            // Fisher-Yates with a constant 0 swaps each slot with the head.
            assert.deepEqual(shuffle([1, 2, 3, 4]), [2, 3, 4, 1], 'reset: the shuffle reads Math.random again');
        } finally {
            Math.random = originalRandom;
        }
        pass('The deal can be seeded by a test and restored to Math.random.');
    }
    console.log('Service guard tests passed.');
}

module.exports = runServiceGuardTests;

if (require.main === module) {
    runServiceGuardTests().catch(error => { console.error(error); process.exitCode = 1; });
}
