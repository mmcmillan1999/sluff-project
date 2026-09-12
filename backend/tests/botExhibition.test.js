// backend/tests/botExhibition.test.js
// The bot exhibition keeps one continuous 3-bot game on a designated table,
// rotating in a fresh random trio each game and yielding to humans.

const assert = require('assert');
const GameService = require('../src/services/GameService');
const {
    createBotExhibitionManager,
    evaluateExhibitionFundingGate,
    DEFAULT_EXHIBITION_FUNDING_GATE,
} = require('../src/maintenance/botExhibition');
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
        assert.deepStrictEqual(manager.tableIds, ['table-10'], 'legacy single-table form still works');
        const [result] = await manager.runNow();
        assert.strictEqual(result.status, 'started');
        assert.strictEqual(result.tableId, 'table-10');

        // A tick that throws is contained and reported, never unhandled.
        gameService.ensureExhibitionGame = async () => { throw new Error('boom'); };
        const [failed] = await manager.runNow();
        assert.strictEqual(failed.status, 'error');
        pass('Manager validates config, runs ticks, and contains errors.');
    }

    {
        // Multi-table: one manager keeps games going on both stakes tables,
        // and a failure on one table never blocks the other's tick.
        const { gameService, starts } = makeService();
        const manager = createBotExhibitionManager({ gameService });
        assert.deepStrictEqual(manager.tableIds, ['table-10', 'table-20'], 'defaults cover both stakes tables');

        const results = await manager.runNow();
        assert.deepStrictEqual(results.map(r => r.status), ['started', 'started']);
        assert.deepStrictEqual(starts, ['table-10', 'table-20']);
        for (const tableId of manager.tableIds) {
            const engine = gameService.getEngineById(tableId);
            assert.strictEqual(engine.playerOrder.count, 3);
            assert.ok(engine.playerOrder.allIds.every(id => engine.players[id].isBot));
        }

        const original = gameService.ensureExhibitionGame.bind(gameService);
        gameService.ensureExhibitionGame = async (tableId) => {
            if (tableId === 'table-10') throw new Error('boom');
            return original(tableId);
        };
        const mixed = await manager.runNow();
        assert.strictEqual(mixed[0].status, 'error');
        assert.notStrictEqual(mixed[1].status, 'error', 'second table still ticks after the first fails');
        pass('Runs both stakes tables and isolates per-table failures.');
    }

    {
        // Funding gate, pure: sum the richest N, pause strictly above the cap.
        const gate = { topBots: 3, capTokens: 100 };
        assert.deepStrictEqual(DEFAULT_EXHIBITION_FUNDING_GATE, gate);

        const rich = evaluateExhibitionFundingGate(new Map([[1, 60], [2, 30], [3, 20], [4, 0]]), gate);
        assert.strictEqual(rich.paused, true);
        assert.strictEqual(rich.total, 110);
        assert.deepStrictEqual(rich.richest.map(b => b.botId), [1, 2, 3]);

        const poor = evaluateExhibitionFundingGate(new Map([[1, 40], [2, 30], [3, 25], [4, 5]]), gate);
        assert.strictEqual(poor.paused, false);
        assert.strictEqual(poor.total, 95);

        const boundary = evaluateExhibitionFundingGate(new Map([[1, 50], [2, 30], [3, 20]]), gate);
        assert.strictEqual(boundary.paused, false, 'exactly the cap still runs; only "over" pauses');

        // It is the richest that count, not the first listed, and a lone
        // whale is enough.
        const whale = evaluateExhibitionFundingGate(new Map([[1, 1], [2, 1], [3, 1], [4, 200]]), gate);
        assert.strictEqual(whale.paused, true);
        assert.strictEqual(whale.total, 202);

        // Unknown balances (no persistent bot roster) never block.
        const unknown = evaluateExhibitionFundingGate(null, gate);
        assert.strictEqual(unknown.known, false);
        assert.strictEqual(unknown.paused, false);

        assert.throws(() => evaluateExhibitionFundingGate(new Map(), { topBots: 0, capTokens: 100 }), /topBots/);
        assert.throws(() => evaluateExhibitionFundingGate(new Map(), { topBots: 3, capTokens: -1 }), /capTokens/);
        pass('Funding gate sums the richest bots and pauses only over the cap.');
    }

    {
        // The gate governs starts only: a running game is never cut, an idle
        // trio is cleared while paused, and unknown balances never block.
        const gate = { topBots: 3, capTokens: 100 };
        const { gameService, starts } = makeService();
        const engine = gameService.getEngineById('table-10');

        gameService._loadAllBotBalances = async () => new Map([[1, 60], [2, 30], [3, 20]]);
        const paused = await gameService.ensureExhibitionGame('table-10', { fundingGate: gate });
        assert.strictEqual(paused.status, 'bots_funded');
        assert.strictEqual(paused.total, 110);
        assert.strictEqual(paused.capTokens, 100);
        assert.strictEqual(starts.length, 0);
        assert.strictEqual(engine.playerOrder.count, 0);

        gameService._loadAllBotBalances = async () => new Map([[1, 40], [2, 30], [3, 25]]);
        const resumed = await gameService.ensureExhibitionGame('table-10', { fundingGate: gate });
        assert.strictEqual(resumed.status, 'started');
        assert.strictEqual(starts.length, 1);

        // The bots got rich mid-game: the game runs to its end untouched.
        gameService._loadAllBotBalances = async () => new Map([[1, 500], [2, 500], [3, 500]]);
        const running = await gameService.ensureExhibitionGame('table-10', { fundingGate: gate });
        assert.strictEqual(running.status, 'game_running');
        assert.strictEqual(engine.playerOrder.count, 3);

        // Game over, trio still parked at the table, gate closed: the seats
        // are freed instead of holding three bots idle.
        engine.gameStarted = false;
        engine.gameId = null;
        engine.state = 'Ready to Start';
        const parked = await gameService.ensureExhibitionGame('table-10', { fundingGate: gate });
        assert.strictEqual(parked.status, 'bots_funded');
        assert.strictEqual(engine.playerOrder.count, 0);
        assert.strictEqual(starts.length, 1);

        gameService._loadAllBotBalances = async () => null;
        const unknown = await gameService.ensureExhibitionGame('table-10', { fundingGate: gate });
        assert.strictEqual(unknown.status, 'started');

        // No gate passed (direct callers, older tests): unchanged behaviour.
        const { gameService: ungated, starts: ungatedStarts } = makeService();
        ungated._loadAllBotBalances = async () => new Map([[1, 999]]);
        assert.strictEqual((await ungated.ensureExhibitionGame('table-10')).status, 'started');
        assert.strictEqual(ungatedStarts.length, 1);
        pass('Gate blocks starts only, clears a parked trio, never cuts a running game.');
    }

    {
        // The manager carries its gate into every tick and validates it.
        const { gameService } = makeService();
        const seen = [];
        gameService.ensureExhibitionGame = async (tableId, options) => {
            seen.push([tableId, options && options.fundingGate]);
            return { status: 'started' };
        };
        const manager = createBotExhibitionManager({ gameService, fundingGate: { topBots: 2, capTokens: 50 } });
        assert.deepStrictEqual(manager.fundingGate, { topBots: 2, capTokens: 50 });
        await manager.runNow();
        assert.deepStrictEqual(seen, [
            ['table-10', { topBots: 2, capTokens: 50 }],
            ['table-20', { topBots: 2, capTokens: 50 }],
        ]);

        const defaults = createBotExhibitionManager({ gameService });
        assert.deepStrictEqual(defaults.fundingGate, { topBots: 3, capTokens: 100 });
        assert.throws(() => createBotExhibitionManager({ gameService, fundingGate: { topBots: 0, capTokens: 100 } }), /topBots/);
        assert.throws(() => createBotExhibitionManager({ gameService, fundingGate: { topBots: 3, capTokens: NaN } }), /capTokens/);
        pass('Manager passes its funding gate to every tick and validates it.');
    }

    console.log('All bot exhibition tests passed!');
}

module.exports = runBotExhibitionTests;

if (require.main === module) {
    runBotExhibitionTests().catch(error => { console.error(error); process.exitCode = 1; });
}
