// 4-player smoke test: dealer sit-out, deal shape, insurance parties,
// full scripted rounds with dealer rotation, scoring invariants, payouts.
const assert = require('assert');


const GameService = require('../src/services/GameService');
const gameLogic = require('../src/core/logic');
const { createGameServiceWithoutHeartbeat } = require('./test-helpers');

const mockIo = { to: () => ({ emit: () => {} }), emit: () => {}, sockets: { sockets: new Map() } };

const mockPool = {
    queries: [],
    query(text, params) {
        this.queries.push({ text, params });
        if (text.includes('SELECT outcome') && text.includes('FROM game_history')) {
            return Promise.resolve({ rows: [{ outcome: 'In Progress' }], rowCount: 1 });
        }
        if (text.includes('SELECT id FROM users') && text.includes('FOR UPDATE')) {
            return Promise.resolve({ rows: (params[0] || []).map(id => ({ id })), rowCount: params[0]?.length || 0 });
        }
        if (text.includes('UPDATE game_history')) {
            return Promise.resolve({ rows: [], rowCount: 1 });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
    },
    async connect() {
        return {
            query: this.query.bind(this),
            release() {},
        };
    },
};

async function runFourPlayerTests() {
    const timers = [];
    const gameService = createGameServiceWithoutHeartbeat(GameService, mockIo, mockPool);
    gameService.timerOverride = (cb, duration) => { timers.push({ cb, duration }); };
    const drainTimers = async () => { while (timers.length) await timers.shift().cb(); };

    const engine = gameService.getEngineById('table-2');
    const IDS = [101, 102, 103, 104];
    const NAMES = { 101: 'Alice', 102: 'Bob', 103: 'Cara', 104: 'Dave' };
    IDS.forEach((id, i) => engine.joinTable({ id, username: NAMES[id] }, `s${i}`));
    engine.gameStarted = true; engine.gameId = 1; engine.playerMode = 4;
    engine.dealer = 101;
    engine.playerOrder.setTurnOrder(engine.dealer, true);
    engine.state = 'Dealing Pending';
    engine._initializeNewRoundState();
    IDS.forEach(id => { engine.scores[NAMES[id]] = 120; });

    const legalCardFor = (playerId) => {
        const hand = engine.hands[engine.players[playerId].playerName];
        const suitOf = (c) => c.slice(-1);
        if (engine.currentTrickCards.length === 0) {
            const nonTrump = hand.find(c => suitOf(c) !== engine.trumpSuit);
            if (!engine.trumpBroken && nonTrump) return nonTrump;
            return hand[0];
        }
        const lead = engine.leadSuitCurrentTrick;
        const follow = hand.find(c => suitOf(c) === lead);
        if (follow) return follow;
        const trump = hand.find(c => suitOf(c) === engine.trumpSuit);
        return trump || hand[0];
    };

    const playRound = async (roundNum) => {
        const dealerId = engine.dealer;
        const dealerName = engine.players[dealerId].playerName;
        assert.strictEqual(engine.state, 'Dealing Pending', `round ${roundNum} starts at Dealing Pending`);
        await gameService.dealCards('table-2', dealerId);

        // Deal shape
        const turnOrder = engine.playerOrder.turnOrder;
        assert.strictEqual(turnOrder.length, 3, 'exactly 3 active players');
        assert.ok(!turnOrder.includes(dealerId), 'dealer is not in the turn order');
        turnOrder.forEach(id => assert.strictEqual(engine.hands[engine.players[id].playerName].length, 11, '11 cards per active player'));
        assert.strictEqual(engine.hands[dealerName], undefined, 'dealer has no hand');
        assert.strictEqual(engine.widow.length, 3, 'widow has 3 cards');

        // Client state shape
        const cs = engine.getStateForClient();
        assert.strictEqual(cs.playerOrderActive.length, 3, 'playerOrderActive is the active trio');
        assert.strictEqual(cs.seatingOrder.length, 4, 'seatingOrder includes all 4');
        assert.ok(cs.seatingOrder.includes(dealerName), 'seatingOrder includes the dealer');

        // Bid: first bidder takes Heart Solo, others pass
        await gameService.placeBid('table-2', turnOrder[0], 'Heart Solo');
        await gameService.placeBid('table-2', turnOrder[1], 'Pass');
        await gameService.placeBid('table-2', turnOrder[2], 'Pass');
        assert.strictEqual(engine.state, 'Bid Announcement');

        // Insurance: active, exactly 2 defenders, dealer not a party
        assert.strictEqual(engine.insurance.isActive, true, 'insurance active in 4-player');
        const offerNames = Object.keys(engine.insurance.defenderOffers);
        assert.strictEqual(offerNames.length, 2, 'exactly 2 defender offers');
        assert.ok(!offerNames.includes(dealerName), 'dealer has no insurance offer');

        await drainTimers(); // fanfare -> Playing Phase
        assert.strictEqual(engine.state, 'Playing Phase');

        // Play out the full round
        let safety = 200;
        while (engine.state === 'Playing Phase' || engine.state === 'TrickCompleteLinger') {
            if (engine.state === 'TrickCompleteLinger') { await drainTimers(); continue; }
            const turnId = engine.trickTurnPlayerId;
            await gameService.playCard('table-2', turnId, legalCardFor(turnId));
            await drainTimers();
            if (--safety <= 0) throw new Error('round did not terminate');
        }
        assert.ok(['Awaiting Next Round Trigger', 'Game Over'].includes(engine.state), `round ended (state=${engine.state})`);

        // Scoring invariants
        const pc = engine.roundSummary.pointChanges;
        assert.ok(dealerName in pc, 'dealer appears in pointChanges');
        assert.ok(Number.isFinite(pc[dealerName]), 'dealer point change is a number, not NaN');
        assert.ok(pc[dealerName] >= 0, 'dealer can never lose points');
        const sum = Object.values(pc).reduce((a, b) => a + b, 0);
        assert.strictEqual(sum, 0, `round is zero-sum (got ${sum})`);
        const bidderName = engine.players[turnOrder[0]].playerName;
        if (engine.roundSummary.message.includes('failed')) {
            const defenderShare = pc[offerNames[0]];
            assert.strictEqual(pc[dealerName], defenderShare, 'on failure dealer gains a defender-sized share');
            assert.strictEqual(pc[bidderName], -3 * defenderShare, 'bidder pays 3 shares on failure');
        } else if (engine.roundSummary.message.includes('succeeded')) {
            assert.strictEqual(pc[dealerName], 0, 'dealer untouched on success');
        }
        console.log(`  round ${roundNum}: dealer=${dealerName} bidder=${bidderName} -> ${engine.roundSummary.message} dealerChange=${pc[dealerName]}`);
        return dealerId;
    };

    // Play 4 rounds; dealer must rotate through all 4 seats. Scores are
    // topped back up between rounds so Heart Solo swings can't end the game
    // before the rotation completes (test scaffolding only).
    const dealersSeen = [];
    for (let r = 1; r <= 4; r++) {
        dealersSeen.push(await playRound(r));
        IDS.forEach(id => { engine.scores[NAMES[id]] = 120; });
        if (engine.state === 'Game Over') engine.state = 'Awaiting Next Round Trigger';
        engine.roundSummary.presentationReadyAt = Date.now() - 1;
        await gameService.requestNextRound('table-2', engine.roundSummary.dealerOfRoundId);
    }
    assert.strictEqual(new Set(dealersSeen).size, 4, 'all 4 players dealt once across 4 rounds');

    // Payout algorithm (pure ranking math; DB calls fail harmlessly on null pool)
    const mkPlayers = (scores) => {
        const players = {}; let uid = 1;
        for (const [name, score] of Object.entries(scores)) {
            players[uid] = { userId: uid, playerName: name, isBot: false, isSpectator: false }; uid++;
        }
        return players;
    };
    const run = async (scores) => gameService.handleGameOver({
        scores, theme: 'fort-creek', gameId: 99,
        players: mkPlayers(scores),
        playerOrderActive: Object.values(mkPlayers(scores))
    });

    let res = await run({ A: 200, B: 150, C: 100, D: 30 });
    assert.strictEqual(res.gameWinnerName, 'A');
    assert.deepStrictEqual(
        res.tokenSettlement.entries.map(entry => entry.grossReturnCents),
        [250, 100, 50, 0],
        'untied returns are 2.5x / 1x / 0.5x / 0x',
    );
    assert.ok(res.payoutDetails[1].includes('won a net'), '1st wins');
    assert.ok(res.payoutDetails[2].includes('buy-in was returned'), '2nd washes');
    assert.ok(res.payoutDetails[3].includes('recovered 0.50'), '3rd recovers half the buy-in');
    assert.ok(res.payoutDetails[4].includes('lost your buy-in'), '4th loses');

    res = await run({ A: 200, B: 200, C: 100, D: 30 });
    assert.strictEqual(res.gameWinnerName, 'A & B');
    assert.deepStrictEqual(
        res.tokenSettlement.entries.map(entry => entry.grossReturnCents),
        [175, 175, 50, 0],
        'a 1st-2nd tie splits their combined 3.5x return',
    );
    assert.ok(res.payoutDetails[1].includes('won a net'), 'tied 1st still nets a win');
    assert.ok(res.payoutDetails[2].includes('won a net'), 'both tied winners paid');
    assert.ok(res.payoutDetails[3].includes('recovered 0.50'), '3rd still recovers half the buy-in');

    res = await run({ A: 200, B: 150, C: 150, D: 30 });
    assert.deepStrictEqual(
        res.tokenSettlement.entries.map(entry => entry.grossReturnCents),
        [250, 75, 75, 0],
        'a 2nd-3rd tie splits their combined 1.5x return',
    );
    assert.ok(res.payoutDetails[2].includes('recovered 0.75'), '2nd-3rd tie returns three quarters each');
    assert.ok(res.payoutDetails[3].includes('recovered 0.75'), 'both tied players receive the same return');

    res = await run({ A: 200, B: 150, C: 100, D: 100 });
    assert.deepStrictEqual(
        res.tokenSettlement.entries.map(entry => entry.grossReturnCents),
        [250, 100, 25, 25],
        'a 3rd-4th tie splits the half-buy-in third-place return',
    );

    res = await run({ A: 100, B: 100, C: 100, D: 100 });
    assert.ok(res.payoutDetails[1].includes('buy-in was returned'), '4-way tie washes everyone (1 part each)');

    console.log('FOUR-PLAYER SMOKE TEST PASSED');
}

if (require.main === module) {
    runFourPlayerTests().catch(err => {
        console.error(err);
        process.exitCode = 1;
    });
}

module.exports = runFourPlayerTests;
