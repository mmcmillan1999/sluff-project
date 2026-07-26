// backend/tests/botExhibition.test.js
// The bot exhibition keeps one continuous 3-bot game on a designated table,
// rotating in a fresh random trio each game and yielding to humans.

const assert = require('assert');
const GameService = require('../src/services/GameService');
const { createBotExhibitionManager } = require('../src/maintenance/botExhibition');
const { createGameServiceWithoutHeartbeat, withControlledTimeouts } = require('./test-helpers');

const mockIo = { to: () => ({ emit: () => {} }), emit: () => {}, sockets: { sockets: new Map() } };

// The funded start path (buy-ins, mercy) is covered by fundedBots.test.js;
// these tests own the exhibition orchestration, so the start action is
// stubbed to flip the engine into a started game.
function makeService() {
    const gameService = createGameServiceWithoutHeartbeat(GameService, mockIo, null);
    const starts = [];
    gameService._performAction = async (tableId) => {
        const engine = gameService.getEngineById(tableId);
        starts.push(tableId);
        engine.gameStarted = true;
        engine.gameId = starts.length;
    };
    return { gameService, starts };
}

async function runBotExhibitionTests() {
    console.log('Running bot exhibition tests...');

    let testCounter = 1;
    const pass = (testName) => console.log(`  ✔ Test ${testCounter++}: ${testName}`);

    {
        const { gameService, starts } = makeService();
        const result = await gameService.ensureExhibitionGame('table-10');
        const engine = gameService.getEngineById('table-10');

        assert.strictEqual(result.status, 'started');
        assert.strictEqual(result.bots.length, 3);
        assert.strictEqual(engine.isExhibitionTable, true);
        assert.strictEqual(engine.playerOrder.count, 3);
        assert.ok(engine.playerOrder.allIds.every(id => engine.players[id].isBot));
        assert.deepStrictEqual(starts, ['table-10']);
        pass('Seeds a trio of bots and starts a game.');
    }

    {
        const { gameService, starts } = makeService();
        const engine = gameService.getEngineById('table-10');
        engine.joinTable({ id: 900, username: 'HumanPlayer' }, 'socket-h');

        const result = await gameService.ensureExhibitionGame('table-10');
        assert.strictEqual(result.status, 'humans_seated');
        assert.strictEqual(starts.length, 0);
        assert.strictEqual(
            Object.values(engine.players).filter(p => p.isBot).length,
            0,
            'no bots seated while a human holds the table',
        );
        pass('Backs off while a human is seated.');
    }

    {
        const { gameService, starts } = makeService();
        await gameService.ensureExhibitionGame('table-10');
        const result = await gameService.ensureExhibitionGame('table-10');
        assert.strictEqual(result.status, 'game_running');
        assert.strictEqual(starts.length, 1);
        pass('No-op while the exhibition game is running.');
    }

    {
        const { gameService, starts } = makeService();
        await gameService.ensureExhibitionGame('table-10');
        const engine = gameService.getEngineById('table-10');
        const firstTrioIds = [...engine.playerOrder.allIds];

        // Simulate the game finishing and terminal cleanup resetting the table.
        engine.gameStarted = false;
        engine.gameId = null;
        engine.state = 'Ready to Start';

        const result = await gameService.ensureExhibitionGame('table-10');
        const secondTrioIds = [...engine.playerOrder.allIds];

        assert.strictEqual(result.status, 'started');
        assert.strictEqual(starts.length, 2);
        assert.strictEqual(secondTrioIds.length, 3);
        // Synthetic bot ids are never reused, so a rotated line-up always
        // carries fresh ids even when the same names are re-drawn.
        assert.ok(
            secondTrioIds.every(id => !firstTrioIds.includes(id)),
            'the line-up is re-seated between games',
        );
        pass('Rotates in a fresh trio between games.');
    }

    {
        const { gameService, starts } = makeService();
        const engine = gameService.getEngineById('table-10');
        engine.state = 'Bidding Phase';

        const result = await gameService.ensureExhibitionGame('table-10');
        assert.strictEqual(result.status, 'busy');
        assert.strictEqual(starts.length, 0);
        pass('Leaves unexpected table states alone.');
    }

    {
        // The built-in all-bots restart must defer to the exhibition manager
        // (which rotates the trio) instead of restarting the same line-up.
        const gameService = createGameServiceWithoutHeartbeat(GameService, mockIo, null);
        const setupTerminalBotTable = (tableId, isExhibition) => {
            const engine = gameService.getEngineById(tableId);
            engine.addBotPlayer();
            engine.addBotPlayer();
            engine.addBotPlayer();
            engine.gameStarted = true;
            engine.gameId = 7;
            engine.state = 'Game Over';
            engine.isExhibitionTable = isExhibition;
            return engine;
        };

        await withControlledTimeouts(async ({ timers }) => {
            const plain = setupTerminalBotTable('table-8', false);
            gameService._resetAbandonedTerminalTable('table-8', plain, 'Game Over', 7);
            assert.strictEqual(timers.length, 1, 'plain bot tables schedule their own restart');

            const exhibition = setupTerminalBotTable('table-9', true);
            gameService._resetAbandonedTerminalTable('table-9', exhibition, 'Game Over', 7);
            assert.strictEqual(timers.length, 1, 'exhibition tables leave the restart to the manager');
        });
        pass('Built-in bot restart is suppressed on exhibition tables.');
    }

    {
        const { gameService } = makeService();
        assert.throws(
            () => createBotExhibitionManager({}),
            /requires gameService/,
        );
        assert.throws(
            () => createBotExhibitionManager({ gameService, intervalMs: 1000 }),
            /at least/,
        );

        const manager = createBotExhibitionManager({ gameService, tableId: 'table-10' });
        const result = await manager.runNow();
        assert.strictEqual(result.status, 'started');

        // A tick that throws is contained and reported, never unhandled.
        gameService.ensureExhibitionGame = async () => { throw new Error('boom'); };
        const failed = await manager.runNow();
        assert.strictEqual(failed.status, 'error');
        pass('Manager validates config, runs ticks, and contains errors.');
    }

    console.log('All bot exhibition tests passed!');
}

module.exports = runBotExhibitionTests;
