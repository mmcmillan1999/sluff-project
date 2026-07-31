'use strict';

// Does a bid-winning bot always get the first card of the round?
//
// The rule is that the bid winner leads trick one, and _transitionToPlayingPhase
// sets both trickLeaderId and trickTurnPlayerId to bidWinnerInfo.userId. But
// reaching that function is not a single path: Solo and Heart Solo detour
// through Trump Selection, Frog detours through the widow exchange, and a Frog
// bid can be upgraded mid-auction. Each detour is a state a bot has to act in
// on its own, and any one of them stalling would leave the round stuck BEFORE
// the lead rather than handing it to the wrong player.
//
// So this walks every bid type, in 3- and 4-player mode, with the bot winning,
// and asserts the bot holds the lead when Playing Phase opens.

const assert = require('assert');
const GameService = require('../src/services/GameService');
const { createGameServiceWithoutHeartbeat } = require('./test-helpers');

const mockIo = { to: () => ({ emit: () => {} }), emit: () => {}, sockets: { sockets: new Map() } };
const mockPool = {
    query() { return Promise.resolve({ rows: [], rowCount: 0 }); },
    async connect() { return { query: () => Promise.resolve({ rows: [], rowCount: 0 }), release() {} }; },
};

const BID_TYPES = ['Frog', 'Solo', 'Heart Solo'];

function buildTable(playerMode) {
    const gameService = createGameServiceWithoutHeartbeat(GameService, mockIo, mockPool);
    const timers = [];
    gameService.timerOverride = (cb, duration) => { timers.push({ cb, duration }); };

    const tableId = playerMode === 4 ? 'table-2' : 'table-1';
    const engine = gameService.getEngineById(tableId);
    const ids = playerMode === 4 ? [101, 102, 103, 104] : [101, 102, 103];
    const names = { 101: 'Alice', 102: 'BotBidder', 103: 'Cara', 104: 'Dave' };

    ids.forEach((id, i) => engine.joinTable({ id, username: names[id] }, `s${i}`));
    engine.gameStarted = true;
    engine.gameId = 1;
    engine.playerMode = playerMode;
    engine.dealer = playerMode === 4 ? 104 : 103;
    engine.playerOrder.setTurnOrder(engine.dealer, playerMode === 4);
    engine.state = 'Dealing Pending';
    engine._initializeNewRoundState();
    ids.forEach(id => { engine.scores[names[id]] = 120; });

    return { gameService, engine, tableId, timers,
             drain: async () => { while (timers.length) await timers.shift().cb(engine); } };
}

/** Drive the auction so `winnerId` takes the bid, then finish any detour. */
async function winTheBidWith(gameService, engine, tableId, winnerId, bid, drain) {
    await gameService.dealCards(tableId, engine.dealer);
    assert.strictEqual(engine.state, 'Bidding Phase', 'dealing opens the auction');

    // Everyone passes except the intended winner.
    let guard = 0;
    while (engine.state === 'Bidding Phase' && guard++ < 12) {
        const turnId = engine.biddingTurnPlayerId;
        if (turnId == null) break;
        await gameService.placeBid(tableId, turnId, turnId === winnerId ? bid : 'Pass');
    }
    assert.ok(guard < 12, 'the auction terminated');

    // A Frog bid re-offers the original bidder an upgrade; decline it so the
    // bid under test is the one that actually stands.
    if (engine.state === 'Awaiting Frog Upgrade Decision') {
        await gameService.placeBid(tableId, engine.biddingTurnPlayerId, 'Pass');
    }

    assert.ok(engine.bidWinnerInfo, 'someone won the bid');
    assert.strictEqual(Number(engine.bidWinnerInfo.userId), winnerId, 'the intended player won');

    // Detour 1: Solo and Heart Solo pick trump before play opens.
    if (engine.state === 'Trump Selection') {
        await gameService.chooseTrump(tableId, winnerId, 'C');
    }

    // Detour 2: Frog swaps three cards with the widow first.
    if (engine.state === 'Frog Widow Exchange') {
        const hand = engine.hands[engine.players[winnerId].playerName];
        await gameService.submitFrogDiscards(tableId, winnerId, hand.slice(0, 3));
    }

    // Bid Announcement holds the table for the winner splash; the timer opens play.
    assert.strictEqual(engine.state, 'Bid Announcement',
        `every bid type lands on Bid Announcement (bid: ${bid})`);
    await drain();
}

async function testBidWinnerLeadsFirstTrick() {
    for (const playerMode of [3, 4]) {
        for (const bid of BID_TYPES) {
            const { gameService, engine, tableId, drain } = buildTable(playerMode);
            const winnerId = 102;
            const winnerName = engine.players[winnerId].playerName;

            await winTheBidWith(gameService, engine, tableId, winnerId, bid, drain);

            assert.strictEqual(engine.state, 'Playing Phase',
                `${playerMode}p ${bid}: play opens after the announcement`);
            assert.strictEqual(Number(engine.trickTurnPlayerId), winnerId,
                `${playerMode}p ${bid}: the bid winner is on turn for trick one`);
            assert.strictEqual(Number(engine.trickLeaderId), winnerId,
                `${playerMode}p ${bid}: the bid winner leads trick one`);
            assert.strictEqual(engine.currentTrickCards.length, 0,
                `${playerMode}p ${bid}: nobody has played ahead of the winner`);
            assert.strictEqual(engine.tricksPlayedCount, 0, `${playerMode}p ${bid}: fresh round`);

            // The name the client keys its "your turn" cues on must agree with
            // the id the engine enforces, or the winner is told to wait while
            // the server waits for them.
            const wireState = engine.getStateForClient();
            assert.strictEqual(wireState.trickTurnPlayerName, winnerName,
                `${playerMode}p ${bid}: the broadcast names the bid winner as on turn`);
        }
    }
    console.log(`  bid winner leads trick one across ${BID_TYPES.length} bids x 2 player modes`);
}


async function testEverySeatCanWinAndLead() {
    // The winner must lead whether they bid first, last, or from the middle —
    // turn order after the auction is derived from the dealer, not from who bid.
    for (const winnerId of [101, 102, 103]) {
        const { gameService, engine, tableId, drain } = buildTable(3);
        const winnerName = engine.players[winnerId].playerName;
        await winTheBidWith(gameService, engine, tableId, winnerId, 'Solo', drain);

        assert.strictEqual(Number(engine.trickTurnPlayerId), winnerId,
            `seat ${winnerName} leads after winning from their position in the order`);
    }
    console.log('  every seat leads after winning, regardless of bidding position');
}

async function testDealerSittingOutNeverLeads() {
    // 4-player: the dealer sits the round out entirely, so they can neither win
    // the bid nor hold the lead.
    const { gameService, engine, tableId, drain } = buildTable(4);
    await winTheBidWith(gameService, engine, tableId, 102, 'Solo', drain);

    assert.ok(!engine.playerOrder.turnOrder.includes(engine.dealer),
        'the 4-player dealer is out of the turn order');
    assert.notStrictEqual(Number(engine.trickTurnPlayerId), Number(engine.dealer),
        'the sitting-out dealer never holds the lead');
    console.log('  the 4-player sitting-out dealer never receives the lead');
}

async function run() {
    await testBidWinnerLeadsFirstTrick();
    await testEverySeatCanWinAndLead();
    await testDealerSittingOutNeverLeads();
    console.log('Bid-winner lead tests passed.');
}

if (require.main === module) {
    run().catch(error => { console.error(error); process.exit(1); });
}

module.exports = run;
