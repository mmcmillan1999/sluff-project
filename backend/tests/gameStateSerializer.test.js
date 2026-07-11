'use strict';

const assert = require('node:assert/strict');
const { serializeGameState } = require('../src/serialization/gameStateSerializer');

function makeState(overrides = {}) {
    return {
        tableId: 'privacy-test',
        state: 'Playing Phase',
        gameStarted: true,
        playerMode: 3,
        dealer: 1,
        players: {
            1: { userId: 1, playerName: 'Alice', isSpectator: false, socketId: 'alice-socket', tokens: '10.00' },
            2: { userId: 2, playerName: 'Bob', isSpectator: false, socketId: 'bob-socket', tokens: '20.00' },
            3: { userId: 3, playerName: 'Cara', isSpectator: false, socketId: 'cara-socket' },
            99: { userId: 99, playerName: 'Watcher', isSpectator: true, socketId: 'watcher-socket' },
        },
        playerOrderActive: ['Alice', 'Bob', 'Cara'],
        seatingOrder: ['Alice', 'Bob', 'Cara'],
        hands: {
            Alice: ['AS', '10H'],
            Bob: ['6C', 'KD'],
            Cara: ['QH', '7S'],
        },
        widow: ['8D', '9D', 'JD'],
        originalDealtWidow: ['8D', '9D', 'JD'],
        widowDiscardsForFrogBidder: ['6C', '7C', '8C'],
        revealedWidowForFrog: ['8D', '9D', 'JD'],
        currentTrickCards: [{ playerName: 'Bob', card: 'AC' }],
        lastCompletedTrick: {
            winnerName: 'Alice',
            cards: [{ playerName: 'Alice', card: 'AH' }],
        },
        capturedTricks: {
            Alice: [[{ playerName: 'Alice', card: 'AH' }]],
            Bob: [],
            Cara: [],
        },
        roundSummary: null,
        ...overrides,
    };
}

function makeGame(state) {
    return { getStateForClient: () => state };
}

function runGameStateSerializerTests() {
    {
        const rawState = makeState();
        const result = serializeGameState(makeGame(rawState), { userId: '2' });

        assert.deepEqual(result.hands, { Bob: ['6C', 'KD'] }, 'a player sees only their own hand');
        assert.deepEqual(result.widow, [], 'the live widow is hidden');
        assert.deepEqual(result.originalDealtWidow, [], 'the original widow is hidden');
        assert.deepEqual(result.widowDiscardsForFrogBidder, [], 'Frog discards are hidden');
        assert.deepEqual(result.revealedWidowForFrog, ['8D', '9D', 'JD'], 'the intentional Frog reveal stays public');
        assert.equal(result.currentTrickCards[0].card, 'AC', 'cards played to the current trick stay public');
        assert.equal(result.lastCompletedTrick.cards[0].card, 'AH', 'completed trick cards stay public');
        assert.equal(result.players[1].socketId, undefined, 'socket routing details are stripped');
        assert.equal(result.players[1].tokens, undefined, 'another player\'s token balance is stripped');
        assert.equal(result.players[2].tokens, '20.00', 'the viewer may receive their own token balance');

        result.hands.Bob.push('JH');
        result.players[1].playerName = 'Changed';
        assert.deepEqual(rawState.hands.Bob, ['6C', 'KD'], 'serialization does not mutate engine hands');
        assert.equal(rawState.players[1].playerName, 'Alice', 'serialization does not mutate engine players');
        assert.equal(rawState.players[1].socketId, 'alice-socket', 'redaction does not mutate routing state');
    }

    {
        const rawState = makeState();
        const spectator = serializeGameState(makeGame(rawState), { userId: 99, isAdmin: true });
        assert.deepEqual(spectator.hands, {}, 'a normal spectator sees no hands');
        assert.deepEqual(spectator.originalDealtWidow, [], 'an admin spectator is redacted by default');

        const spoofedTrustedViewer = serializeGameState(makeGame(rawState), {
            userId: 99,
            trustedAdminObserver: true,
        });
        assert.deepEqual(spoofedTrustedViewer.hands, {}, 'trusted observer opt-in alone is insufficient');
        assert.deepEqual(spoofedTrustedViewer.widow, [], 'a non-admin trusted flag cannot expose the widow');
    }

    {
        const rawState = makeState();
        const trustedObserver = serializeGameState(makeGame(rawState), {
            userId: 99,
            isAdmin: true,
            trustedAdminObserver: true,
        });

        assert.deepEqual(trustedObserver.hands, rawState.hands, 'an explicitly trusted admin observer sees all hands');
        assert.deepEqual(trustedObserver.widow, rawState.widow, 'an explicitly trusted admin observer sees the widow');
        assert.deepEqual(
            trustedObserver.widowDiscardsForFrogBidder,
            rawState.widowDiscardsForFrogBidder,
            'an explicitly trusted admin observer sees Frog discards',
        );
        assert.notStrictEqual(trustedObserver.hands, rawState.hands, 'trusted state is still a detached copy');
    }

    {
        const fourPlayerState = makeState({
            playerMode: 4,
            dealer: 4,
            players: {
                1: { userId: 1, playerName: 'Alice', isSpectator: false },
                2: { userId: 2, playerName: 'Bob', isSpectator: false },
                3: { userId: 3, playerName: 'Cara', isSpectator: false },
                4: { userId: 4, playerName: 'Drew', isSpectator: false },
                99: { userId: 99, playerName: 'Watcher', isSpectator: true },
            },
            playerOrderActive: ['Alice', 'Bob', 'Cara'],
            seatingOrder: ['Alice', 'Bob', 'Cara', 'Drew'],
            hands: {
                Alice: ['AS'],
                Bob: ['KS'],
                Cara: ['QS'],
            },
        });

        const dealer = serializeGameState(makeGame(fourPlayerState), { userId: '4' });
        assert.deepEqual(dealer.hands, {}, 'the sitting dealer cannot see active players hands');
        assert.deepEqual(dealer.originalDealtWidow, ['8D', '9D', 'JD'], 'the sitting dealer may peek at the original widow');
        assert.deepEqual(dealer.widowDiscardsForFrogBidder, ['6C', '7C', '8C'], 'the sitting dealer may peek at Frog discards');

        const activePlayer = serializeGameState(makeGame(fourPlayerState), { userId: 1 });
        assert.deepEqual(activePlayer.originalDealtWidow, [], 'an active four-player participant cannot peek');

        const malformedActiveDealerState = makeState({
            ...fourPlayerState,
            playerOrderActive: ['Alice', 'Bob', 'Cara', 'Drew'],
        });
        const activeDealer = serializeGameState(makeGame(malformedActiveDealerState), { userId: 4 });
        assert.deepEqual(activeDealer.widow, [], 'dealer privilege requires actually sitting out');

        const spectatorDealerState = makeState({
            ...fourPlayerState,
            players: {
                ...fourPlayerState.players,
                4: { userId: 4, playerName: 'Drew', isSpectator: true },
            },
        });
        const spectatorDealer = serializeGameState(makeGame(spectatorDealerState), { userId: 4 });
        assert.deepEqual(spectatorDealer.widow, [], 'a spectator never inherits dealer peek privilege');
    }

    {
        const allPassState = makeState({ state: 'AllPassWidowReveal' });
        const allPassViewer = serializeGameState(makeGame(allPassState), { userId: 2 });
        assert.deepEqual(allPassViewer.originalDealtWidow, ['8D', '9D', 'JD'], 'all-pass widow reveal is public');
        assert.deepEqual(allPassViewer.widow, ['8D', '9D', 'JD'], 'the public widow remains available to existing UI');
        assert.deepEqual(allPassViewer.hands, { Bob: ['6C', 'KD'] }, 'public widow does not make hands public');

        const summaryState = makeState({
            state: 'Awaiting Next Round Trigger',
            roundSummary: { widowForReveal: ['6C', '7C', '8C'] },
        });
        const summaryViewer = serializeGameState(makeGame(summaryState), { userId: 3 });
        assert.deepEqual(summaryViewer.widowDiscardsForFrogBidder, ['6C', '7C', '8C'], 'widow fields are public once scoring reveals them');
        assert.deepEqual(summaryViewer.roundSummary.widowForReveal, ['6C', '7C', '8C'], 'the public scoring summary is preserved');
        assert.deepEqual(summaryViewer.hands, { Cara: ['QH', '7S'] }, 'round end still does not reveal hands');
    }

    {
        assert.throws(
            () => serializeGameState({}, { userId: 1 }),
            /requires a game state provider/,
            'invalid callers fail closed',
        );
    }

    console.log('Game-state serializer privacy tests passed.');
}

if (require.main === module) {
    runGameStateSerializerTests();
}

module.exports = runGameStateSerializerTests;
