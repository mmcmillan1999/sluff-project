// backend/tests/departedSeatScores.test.js
// Scores are keyed by player name, and the podium ranks whatever is in the
// map. A seat that leaves before the deal must take its score entry with
// it, or its owner shows up on the podium at 120 for a game they never
// played.

const assert = require('assert');
const GameEngine = require('../src/core/GameEngine');

function makeReadyEngine() {
    const engine = new GameEngine('departed-seat', 'fort-creek', 'Departed Seat');
    engine.joinTable({ id: 1, username: 'Alice' }, 's1', 30);
    engine.joinTable({ id: 2, username: 'Bob' }, 's2', 30);
    engine.joinTable({ id: 3, username: 'Carol' }, 's3', 30);
    engine.joinTable({ id: 4, username: 'Dave' }, 's4', 30);
    assert.strictEqual(engine.state, 'Ready to Start');
    assert.deepStrictEqual(Object.keys(engine.scores).sort(), ['Alice', 'Bob', 'Carol', 'Dave']);
    return engine;
}

function runDepartedSeatScoreTests() {
    console.log('Running departed seat score tests...');

    let testCounter = 1;
    const pass = (testName) => console.log(`  ✔ Test ${testCounter++}: ${testName}`);

    {
        const engine = makeReadyEngine();
        engine.leaveTable(4);
        assert.strictEqual(engine.players[4], undefined);
        assert.strictEqual(engine.playerOrder.includes(4), false);
        assert.deepStrictEqual(Object.keys(engine.scores).sort(), ['Alice', 'Bob', 'Carol']);
        pass('Leaving before the deal removes the score entry with the seat.');
    }

    {
        const engine = makeReadyEngine();
        engine.disconnectPlayer(4);
        assert.strictEqual(engine.players[4], undefined);
        assert.deepStrictEqual(Object.keys(engine.scores).sort(), ['Alice', 'Bob', 'Carol']);
        pass('Disconnecting before the deal removes the score entry with the seat.');
    }

    {
        const engine = makeReadyEngine();
        const effect = engine.startGame(1).effects.find(candidate => candidate.type === 'START_GAME_TRANSACTIONS');
        assert.ok(effect, 'the start schedules its buy-in transaction');
        effect.onFailure(new Error('Dave has insufficient tokens.'), 'Dave');
        assert.strictEqual(engine.players[4], undefined);
        assert.deepStrictEqual(Object.keys(engine.scores).sort(), ['Alice', 'Bob', 'Carol']);
        assert.strictEqual(engine.scores.Alice, 120);
        pass('A player dropped by a failed buy-in leaves no score entry behind.');
    }

    {
        const engine = makeReadyEngine();
        engine.leaveTable(4);
        engine.joinTable({ id: 4, username: 'Dave' }, 's4b', 30);
        assert.strictEqual(engine.scores.Dave, 120);
        assert.strictEqual(engine.playerOrder.includes(4), true);
        pass('Coming back after leaving seats the player with a fresh score.');
    }

    {
        const engine = makeReadyEngine();
        engine.joinTable({ id: 5, username: 'Eve' }, 's5', 30);
        assert.strictEqual(engine.players[5].isSpectator, true);
        assert.strictEqual(engine.scores.Eve, undefined);
        engine.leaveTable(5);
        assert.strictEqual(engine.players[5], undefined);
        assert.deepStrictEqual(Object.keys(engine.scores).sort(), ['Alice', 'Bob', 'Carol', 'Dave']);
        pass('A spectator never holds a score entry, coming or going.');
    }

    {
        const engine = makeReadyEngine();
        engine.gameStarted = true;
        engine.gameId = 4242;
        engine.state = 'Playing Phase';
        engine.disconnectPlayer(4);
        assert.strictEqual(engine.players[4].disconnected, true);
        assert.strictEqual(engine.scores.Dave, 120);
        pass('A mid-game disconnect keeps the seat and its score (the seat is reserved).');
    }

    console.log('Departed seat score tests passed.');
}

module.exports = runDepartedSeatScoreTests;

if (require.main === module) {
    runDepartedSeatScoreTests().catch(error => { console.error(error); process.exitCode = 1; });
}
