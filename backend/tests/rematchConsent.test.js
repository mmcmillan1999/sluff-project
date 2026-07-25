// backend/tests/rematchConsent.test.js
// A rematch is a fresh buy-in, so the table may only reset once every
// present, seated player has explicitly accepted the offer.

const assert = require('assert');
const GameEngine = require('../src/core/GameEngine');

function makeTerminalEngine() {
    const engine = new GameEngine('rematch-test', 'fort-creek', 'Rematch Test Table');
    engine.joinTable({ id: 1, username: 'Alice' }, 's1');
    engine.joinTable({ id: 2, username: 'Bob' }, 's2');
    engine.joinTable({ id: 3, username: 'Carol' }, 's3');
    engine.state = 'Game Over';
    return engine;
}

function runRematchConsentTests() {
    console.log('Running rematch consent tests...');

    let testCounter = 1;
    const pass = (testName) => console.log(`  ✔ Test ${testCounter++}: ${testName}`);

    // --- Offer creation ---
    {
        const engine = new GameEngine('rematch-pregame', 'fort-creek', 'Pre-game');
        engine.joinTable({ id: 1, username: 'Alice' }, 's1');
        engine.requestRematch(1);
        assert.strictEqual(engine.rematchOffer.isActive, false);
        pass('requestRematch is ignored outside terminal states.');
    }

    {
        const engine = makeTerminalEngine();
        engine.requestRematch(1);
        assert.strictEqual(engine.rematchOffer.isActive, true);
        assert.strictEqual(engine.rematchOffer.initiator, 'Alice');
        assert.deepStrictEqual(engine.rematchOffer.votes, { Alice: 'accept', Bob: null, Carol: null });
        assert.strictEqual(engine.state, 'Game Over', 'The table must not reset on the initial request.');
        pass('An offer seeds every seated player and auto-accepts the initiator only.');
    }

    {
        const engine = makeTerminalEngine();
        engine.players[3].disconnected = true;
        engine.requestRematch(1);
        assert.deepStrictEqual(Object.keys(engine.rematchOffer.votes).sort(), ['Alice', 'Bob']);
        pass('Disconnected seats are excluded so the offer cannot wedge.');
    }

    {
        const engine = makeTerminalEngine();
        engine.requestRematch(1);
        engine.requestRematch(2);
        assert.strictEqual(engine.rematchOffer.initiator, 'Alice');
        pass('A second request while an offer is open is a no-op.');
    }

    // --- Voting ---
    {
        const engine = makeTerminalEngine();
        engine.requestRematch(1);
        engine.submitRematchVote(2, 'accept');
        assert.strictEqual(engine.rematchOffer.isActive, true);
        assert.strictEqual(engine.rematchOffer.resolution, null);
        assert.strictEqual(engine.state, 'Game Over', 'A partial acceptance must not reset the table.');
        pass('The offer stays open while any acceptance is outstanding.');

        engine.submitRematchVote(3, 'accept');
        assert.strictEqual(engine.rematchOffer.isActive, false);
        assert.strictEqual(engine.rematchOffer.resolution, 'accepted');
        pass('Unanimous acceptance resolves the offer as accepted.');
    }

    {
        const engine = makeTerminalEngine();
        engine.requestRematch(1);
        engine.submitRematchVote(2, 'decline');
        assert.strictEqual(engine.rematchOffer.isActive, false);
        assert.strictEqual(engine.rematchOffer.resolution, 'declined');
        assert.strictEqual(engine.rematchOffer.cancelReason, 'Bob declined the rematch.');
        assert.strictEqual(engine.state, 'Game Over');
        pass('A single decline cancels the offer without resetting anyone.');

        engine.requestRematch(3);
        assert.strictEqual(engine.rematchOffer.isActive, true);
        assert.strictEqual(engine.rematchOffer.initiator, 'Carol');
        assert.strictEqual(engine.rematchOffer.cancelReason, null);
        pass('A fresh offer can be opened after a decline.');
    }

    {
        const engine = makeTerminalEngine();
        engine.requestRematch(1);
        engine.submitRematchVote(1, 'decline');
        assert.strictEqual(engine.rematchOffer.isActive, true);
        assert.strictEqual(engine.rematchOffer.votes.Alice, 'accept');
        pass('A cast vote cannot be changed.');
    }

    // --- Departures ---
    {
        const engine = makeTerminalEngine();
        engine.requestRematch(1);
        engine.leaveTable(2);
        assert.strictEqual(engine.rematchOffer.isActive, false);
        assert.strictEqual(engine.rematchOffer.resolution, 'cancelled');
        assert.strictEqual(engine.rematchOffer.cancelReason, 'Bob left the table.');
        pass('A participant leaving cancels the open offer.');
    }

    {
        const engine = makeTerminalEngine();
        engine.gameStarted = true;
        engine.gameId = 77;
        engine.requestRematch(1);
        engine.disconnectPlayer(3);
        assert.strictEqual(engine.rematchOffer.isActive, false);
        assert.strictEqual(engine.rematchOffer.resolution, 'cancelled');
        pass('A participant disconnecting cancels the open offer.');
    }

    // --- Reset clears the offer ---
    {
        const engine = makeTerminalEngine();
        engine.requestRematch(1);
        engine.submitRematchVote(2, 'accept');
        engine.submitRematchVote(3, 'accept');
        engine.reset();
        assert.strictEqual(engine.rematchOffer.isActive, false);
        assert.strictEqual(engine.rematchOffer.resolution, null);
        assert.strictEqual(engine.state, 'Ready to Start');
        pass('reset() returns the table to Ready to Start with a clean offer.');
    }

    console.log('All rematch consent tests passed!');
}

module.exports = runRematchConsentTests;
