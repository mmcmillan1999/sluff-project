// backend/tests/gameResume.test.js
//
// Deploy-survival snapshots and human reaction-time logging:
//   - a live game serializes, restores into a fresh engine, and keeps playing
//   - transient timer states normalize to their settled equivalents
//   - settling/terminal games refuse to serialize
//   - restore never clobbers a table humans have claimed meanwhile
//   - GameService claims snapshot rows single-shot and restores them
//   - human card plays emit LOG_PLAY_TIMING with server-measured think time;
//     bot plays never do

const assert = require('assert');
const GameEngine = require('../src/core/GameEngine');
const GameService = require('../src/services/GameService');
const PlayerList = require('../src/core/PlayerList');
const { PLACEHOLDER_ID } = require('../src/core/constants');
const { getLegalMoves } = require('../src/core/legalMoves');
const {
    serializeEngineForResume,
    restoreEngineFromResume,
} = require('../src/serialization/gameResume');
const { createGameServiceWithoutHeartbeat } = require('./test-helpers');

const mockIo = { to: () => ({ emit: () => {} }), emit: () => {}, sockets: { sockets: new Map() } };

function newEngine() {
    return new GameEngine('resume-table', 'fort-creek', 'Resume Test', () => {});
}

// Seat the given players, force-start (no database), deal, and run bidding so
// `bidderId` holds a Solo with spades trump. Ends in Bid Announcement.
function driveToPlayingPhase(engine, seats) {
    for (const seat of seats) {
        if (seat.isBot) {
            const bot = engine.addBotPlayer();
            seat.id = bot.userId;
        } else {
            engine.joinTable({ id: seat.id, username: seat.name }, `sock-${seat.id}`);
        }
    }
    const allIds = engine.playerOrder.allIds;
    engine.playerMode = 3;
    engine.gameStarted = true;
    engine.gameId = 4242;
    engine.scores[PLACEHOLDER_ID] = 120;
    // Dealer = last seat, so the first seat leads the bidding and the round.
    engine.dealer = allIds[allIds.length - 1];
    engine.playerOrder.setTurnOrder(engine.dealer, false);
    engine._initializeNewRoundState();
    engine.state = 'Dealing Pending';
    engine.dealCards(engine.dealer);

    const [bidder, ...passers] = engine.playerOrder.turnOrder;
    engine.placeBid(bidder, 'Solo');
    for (const passer of passers) engine.placeBid(passer, 'Pass');
    engine.chooseTrump(bidder, 'S');
    assert.strictEqual(engine.state, 'Bid Announcement');
    return bidder;
}

function legalCardFor(engine, userId) {
    const name = engine.players[userId].playerName;
    const isLeading = engine.currentTrickCards.length === 0;
    return getLegalMoves(
        engine.hands[name], isLeading, engine.leadSuitCurrentTrick,
        engine.trumpSuit, engine.trumpBroken,
    )[0];
}

async function runGameResumeTests() {
    console.log('Running game resume and play-timing tests...');
    let testCounter = 1;
    const pass = (name) => console.log(`  ✔ Test ${testCounter++}: ${name}`);

    // 1) PlayerList restores both orderings verbatim.
    {
        const list = new PlayerList();
        list.restore([7, 3, 9], [3, 9, 7]);
        assert.deepStrictEqual(list.allIds, [7, 3, 9]);
        assert.deepStrictEqual(list.turnOrder, [3, 9, 7]);
        assert.strictEqual(list.count, 3);
        pass('PlayerList.restore preserves join and turn order.');
    }

    // 2) Human play emits LOG_PLAY_TIMING with server-side think time; the
    //    following bot play does not.
    {
        const engine = newEngine();
        const bidder = driveToPlayingPhase(engine, [
            { id: 501, name: 'Human' }, { isBot: true }, { isBot: true },
        ]);
        assert.strictEqual(bidder, 501, 'human should lead the round');
        engine.state = 'Playing Phase';
        engine.turnStartedAt = Date.now() - 1500;

        const { effects } = engine.playCard(501, legalCardFor(engine, 501));
        const timing = effects.find(e => e.type === 'LOG_PLAY_TIMING');
        assert.ok(timing, 'human play must log timing');
        assert.strictEqual(timing.payload.userId, 501);
        assert.strictEqual(timing.payload.actionType, 'play_card');
        assert.strictEqual(timing.payload.trickNumber, 1);
        assert.ok(timing.payload.ms >= 1400 && timing.payload.ms < 10000,
            `think time should reflect the stamp, got ${timing.payload.ms}`);

        const botId = engine.trickTurnPlayerId;
        assert.ok(engine.players[botId].isBot);
        const botResult = engine.playCard(botId, legalCardFor(engine, botId));
        assert.ok(!botResult.effects.some(e => e.type === 'LOG_PLAY_TIMING'),
            'bot plays must not log timing');
        pass('Human plays log server-measured think time; bot plays are excluded.');
    }

    // 3) Mid-trick round trip: serialize, restore into a fresh engine, and
    //    the game continues exactly where it stopped.
    {
        const engine = newEngine();
        driveToPlayingPhase(engine, [
            { id: 501, name: 'Human' }, { isBot: true }, { isBot: true },
        ]);
        engine.state = 'Playing Phase';
        engine.turnStartedAt = Date.now();
        engine.playCard(501, legalCardFor(engine, 501));

        const snapshot = JSON.parse(JSON.stringify(serializeEngineForResume(engine)));
        assert.ok(snapshot, 'mid-trick game must serialize');

        const restoredEngine = newEngine();
        assert.strictEqual(restoreEngineFromResume(restoredEngine, snapshot), true);
        assert.strictEqual(restoredEngine.gameStarted, true);
        assert.strictEqual(restoredEngine.gameId, 4242);
        assert.strictEqual(restoredEngine.state, 'Playing Phase');
        assert.deepStrictEqual(restoredEngine.hands, engine.hands);
        assert.deepStrictEqual(restoredEngine.scores, engine.scores);
        assert.deepStrictEqual(restoredEngine.playerOrder.turnOrder, engine.playerOrder.turnOrder);
        assert.strictEqual(restoredEngine.currentTrickCards.length, 1);
        assert.strictEqual(restoredEngine.trickTurnPlayerId, engine.trickTurnPlayerId);
        assert.deepStrictEqual(restoredEngine.insurance, engine.insurance);
        assert.strictEqual(restoredEngine.players[501].disconnected, true,
            'restored humans await reconnection');
        assert.strictEqual(restoredEngine.players[501].socketId, null);
        const botIds = Object.keys(restoredEngine.bots);
        assert.strictEqual(botIds.length, 2, 'bot players are re-instantiated');

        // Play continues: the next seat can legally act on the restored state.
        const nextId = restoredEngine.trickTurnPlayerId;
        const nextName = restoredEngine.players[nextId].playerName;
        const before = restoredEngine.hands[nextName].length;
        restoredEngine.playCard(nextId, legalCardFor(restoredEngine, nextId));
        assert.strictEqual(restoredEngine.hands[nextName].length, before - 1);
        pass('Mid-trick snapshot restores fully and play continues.');
    }

    // 4) TrickCompleteLinger normalizes to the post-linger playing state.
    {
        const engine = newEngine();
        driveToPlayingPhase(engine, [
            { id: 501, name: 'Human' }, { isBot: true }, { isBot: true },
        ]);
        engine.state = 'Playing Phase';
        engine.turnStartedAt = Date.now();
        for (let i = 0; i < 3; i++) {
            const turnId = engine.trickTurnPlayerId;
            engine.playCard(turnId, legalCardFor(engine, turnId));
        }
        assert.strictEqual(engine.state, 'TrickCompleteLinger');

        const snapshot = JSON.parse(JSON.stringify(serializeEngineForResume(engine)));
        assert.strictEqual(snapshot.state, 'Playing Phase');
        assert.deepStrictEqual(snapshot.currentTrickCards, []);
        assert.strictEqual(snapshot.trickTurnPlayerId, engine.trickLeaderId,
            'the trick winner leads after restore');

        const restoredEngine = newEngine();
        assert.strictEqual(restoreEngineFromResume(restoredEngine, snapshot), true);
        assert.strictEqual(restoredEngine.tricksPlayedCount, 1);
        const winnerId = restoredEngine.trickTurnPlayerId;
        const winnerName = restoredEngine.players[winnerId].playerName;
        const before = restoredEngine.hands[winnerName].length;
        restoredEngine.playCard(winnerId, legalCardFor(restoredEngine, winnerId));
        assert.strictEqual(restoredEngine.hands[winnerName].length, before - 1);
        pass('A linger snapshot restores as "winner leads the next trick".');
    }

    // 5) Non-resumable states refuse to serialize.
    {
        const engine = newEngine();
        driveToPlayingPhase(engine, [
            { id: 501, name: 'Human' }, { isBot: true }, { isBot: true },
        ]);
        engine.state = 'Game Over';
        assert.strictEqual(serializeEngineForResume(engine), null);
        engine.state = 'Playing Phase';
        engine.beginSettlement('normal');
        assert.strictEqual(serializeEngineForResume(engine), null);
        engine.settlement = engine._newSettlementState();
        engine.gameStartPending = true;
        assert.strictEqual(serializeEngineForResume(engine), null);
        pass('Terminal, settling, and start-pending games are never snapshotted.');
    }

    // 6) Restore refuses a table a human has claimed in the meantime.
    {
        const engine = newEngine();
        driveToPlayingPhase(engine, [
            { id: 501, name: 'Human' }, { isBot: true }, { isBot: true },
        ]);
        engine.state = 'Playing Phase';
        const snapshot = JSON.parse(JSON.stringify(serializeEngineForResume(engine)));

        const occupied = newEngine();
        occupied.joinTable({ id: 777, username: 'NewArrival' }, 'sock-777');
        assert.strictEqual(restoreEngineFromResume(occupied, snapshot), false);
        assert.ok(occupied.players[777], 'the seated human keeps the table');
        pass('Restore never clobbers a table humans took while the snapshot waited.');
    }

    // 7) GameService claims a snapshot row and restores the game in place.
    {
        const source = newEngine();
        driveToPlayingPhase(source, [
            { id: 501, name: 'HumanA' }, { id: 502, name: 'HumanB' }, { id: 503, name: 'HumanC' },
        ]);
        source.state = 'Playing Phase';
        const snapshot = JSON.parse(JSON.stringify(serializeEngineForResume(source)));

        const queries = [];
        const fakePool = {
            query: async (sql, params) => {
                queries.push({ sql, params });
                if (/SELECT s\.game_id/.test(sql)) {
                    return { rows: [{ game_id: 4242, table_id: 'table-3', outcome: 'In Progress', age_ms: 5000 }] };
                }
                if (/DELETE FROM live_game_snapshots/.test(sql)) {
                    return { rows: [{ snapshot }] };
                }
                return { rows: [] };
            },
        };
        const gameService = createGameServiceWithoutHeartbeat(GameService, mockIo, null);
        gameService.pool = fakePool;

        const result = await gameService.restorePendingSnapshots();
        assert.strictEqual(result.restored, 1);
        const engine = gameService.getEngineById('table-3');
        assert.strictEqual(engine.gameStarted, true);
        assert.strictEqual(engine.gameId, 4242);
        assert.strictEqual(engine.state, 'Playing Phase');
        assert.strictEqual(engine.players[501].disconnected, true);

        // The claim is single-shot: a settled or vanished row restores nothing.
        fakePool.query = async (sql) => {
            if (/SELECT s\.game_id/.test(sql)) return { rows: [] };
            return { rows: [] };
        };
        const second = await gameService.restorePendingSnapshots();
        assert.strictEqual(second.restored, 0);
        pass('GameService restores a claimed snapshot into the live table map.');
    }

    // 8) The sweep never claims the snapshot of a game THIS instance is
    //    running — at shutdown that race destroyed the row the successor
    //    needed (live-fire test two, Aug 5 2026).
    {
        const queries = [];
        const fakePool = {
            query: async (sql) => {
                queries.push(sql);
                if (/SELECT s\.game_id/.test(sql)) {
                    return { rows: [{ game_id: 4242, table_id: 'table-3', outcome: 'In Progress', age_ms: 500 }] };
                }
                return { rows: [] };
            },
        };
        const gameService = createGameServiceWithoutHeartbeat(GameService, mockIo, null);
        gameService.pool = fakePool;
        const engine = gameService.getEngineById('table-3');
        engine.gameStarted = true;
        engine.gameId = 4242;

        const result = await gameService.restorePendingSnapshots();
        assert.strictEqual(result.restored, 0);
        assert.ok(!queries.some(sql => /DELETE FROM live_game_snapshots/.test(sql)),
            'a snapshot of a locally-live game must never be claimed');
        pass('The sweep leaves this instance’s own live-game snapshot for the successor.');
    }

    // 9) Shutdown snapshots only games with human participants.
    {
        const humanGame = newEngine();
        driveToPlayingPhase(humanGame, [
            { id: 501, name: 'Human' }, { isBot: true }, { isBot: true },
        ]);
        humanGame.state = 'Playing Phase';
        const botGame = newEngine();
        driveToPlayingPhase(botGame, [
            { isBot: true }, { isBot: true }, { isBot: true },
        ]);
        botGame.state = 'Playing Phase';
        botGame.gameId = 9999;

        const writes = [];
        const fakePool = {
            query: async (sql, params) => {
                if (/INSERT INTO live_game_snapshots/.test(sql)) writes.push(params[0]);
                return { rows: [] };
            },
        };
        const gameService = createGameServiceWithoutHeartbeat(GameService, mockIo, null);
        gameService.pool = fakePool;
        gameService.engines = { 'table-1': humanGame, 'table-2': botGame };

        const result = await gameService.snapshotLiveGamesForShutdown();
        assert.strictEqual(result.saved, 1);
        assert.deepStrictEqual(writes, [4242], 'only the human game is snapshotted');
        pass('Shutdown persists human games and lets bot-only games restart.');
    }

    // 10) The seat guard self-heals when the registered connection is gone
    //     (post-resume race, live-fire test three) but still rejects while a
    //     registered socket is actually connected.
    {
        const { authorizeTableAction } = require('../src/events/socketActionGuard');
        const gameService = createGameServiceWithoutHeartbeat(GameService, mockIo, null);
        const engine = gameService.getEngineById('table-5');
        engine.joinTable({ id: 501, username: 'Human' }, 'dead-socket-id');
        engine.players[501].socketId = 'dead-socket-id'; // no such live socket

        const errors = [];
        const actingSocket = {
            id: 'fresh-socket-id',
            user: { id: 501 },
            join: () => {},
            emit: (event, payload) => { if (event === 'error') errors.push(payload.message); },
        };
        const healed = authorizeTableAction(actingSocket, gameService, { tableId: 'table-5' });
        assert.ok(healed, 'the owner’s live socket must be adopted, not rejected');
        assert.strictEqual(engine.players[501].socketId, 'fresh-socket-id');
        assert.strictEqual(errors.length, 0);

        // Hijack protection intact: a connected registered socket keeps the seat.
        mockIo.sockets.sockets.set('live-socket-id', { id: 'live-socket-id', connected: true });
        engine.players[501].socketId = 'live-socket-id';
        const rejected = authorizeTableAction(actingSocket, gameService, { tableId: 'table-5' });
        assert.strictEqual(rejected, null);
        assert.match(errors[0], /no longer controls/);
        mockIo.sockets.sockets.delete('live-socket-id');
        pass('Seat guard adopts the owner’s socket when the registered one is dead.');
    }

    console.log('All game resume tests passed!');
}

if (require.main === module) {
    runGameResumeTests().catch(error => { console.error(error); process.exitCode = 1; });
}

module.exports = runGameResumeTests;
