import { describe, expect, test } from 'vitest';
import {
    CARDS_PER_PLAYER,
    DEAL_CARD_FLIGHT_MS,
    DEAL_CARD_STAGGER_MS,
    WIDOW_CARD_COUNT,
    buildDealSequence,
} from './dealSequence';

describe('buildDealSequence', () => {
    test('builds the 36-step Sluff deal with a widow card after each of the first three circuits', () => {
        const sequence = buildDealSequence(['Player 1', 'Player 2', 'Player 3']);

        expect(sequence).toHaveLength(36);
        expect(sequence.slice(0, 12)).toEqual([
            { type: 'player', playerName: 'Player 1', circuit: 0, playerIndex: 0 },
            { type: 'player', playerName: 'Player 2', circuit: 0, playerIndex: 1 },
            { type: 'player', playerName: 'Player 3', circuit: 0, playerIndex: 2 },
            { type: 'widow', circuit: 0, widowIndex: 0 },
            { type: 'player', playerName: 'Player 1', circuit: 1, playerIndex: 0 },
            { type: 'player', playerName: 'Player 2', circuit: 1, playerIndex: 1 },
            { type: 'player', playerName: 'Player 3', circuit: 1, playerIndex: 2 },
            { type: 'widow', circuit: 1, widowIndex: 1 },
            { type: 'player', playerName: 'Player 1', circuit: 2, playerIndex: 0 },
            { type: 'player', playerName: 'Player 2', circuit: 2, playerIndex: 1 },
            { type: 'player', playerName: 'Player 3', circuit: 2, playerIndex: 2 },
            { type: 'widow', circuit: 2, widowIndex: 2 },
        ]);

        expect(sequence.slice(12).map(event => event.playerName)).toEqual(
            Array.from({ length: 8 }, () => ['Player 1', 'Player 2', 'Player 3']).flat(),
        );
    });

    test('deals eleven destination events to every active player and three to the widow', () => {
        const sequence = buildDealSequence(['Alice', 'Bob', 'Cara']);

        for (const playerName of ['Alice', 'Bob', 'Cara']) {
            expect(sequence.filter(event => event.playerName === playerName)).toHaveLength(11);
        }
        expect(sequence.filter(event => event.type === 'widow')).toHaveLength(3);
        expect(sequence
            .map((event, index) => event.type === 'widow' ? index : null)
            .filter(index => index !== null)).toEqual([3, 7, 11]);
    });

    test('preserves the server-provided active-player order on every circuit', () => {
        const playerOrder = ['Right', 'Bottom', 'Left'];
        const sequence = buildDealSequence(playerOrder, 2, 1);

        expect(sequence).toEqual([
            { type: 'player', playerName: 'Right', circuit: 0, playerIndex: 0 },
            { type: 'player', playerName: 'Bottom', circuit: 0, playerIndex: 1 },
            { type: 'player', playerName: 'Left', circuit: 0, playerIndex: 2 },
            { type: 'widow', circuit: 0, widowIndex: 0 },
            { type: 'player', playerName: 'Right', circuit: 1, playerIndex: 0 },
            { type: 'player', playerName: 'Bottom', circuit: 1, playerIndex: 1 },
            { type: 'player', playerName: 'Left', circuit: 1, playerIndex: 2 },
        ]);
    });

    test('does not invent an event for the sitting dealer in four-player mode', () => {
        const sittingDealer = 'Dealer';
        const activePlayers = ['Left', 'Across', 'Right'];
        const sequence = buildDealSequence(activePlayers);

        expect(sequence.some(event => event.playerName === sittingDealer)).toBe(false);
        expect(new Set(sequence
            .filter(event => event.type === 'player')
            .map(event => event.playerName))).toEqual(new Set(activePlayers));
    });

    test('contains destination metadata only and exports usable timing defaults', () => {
        const sequence = buildDealSequence(['Alice', 'Bob', 'Cara']);
        const totalDuration = ((sequence.length - 1) * DEAL_CARD_STAGGER_MS)
            + DEAL_CARD_FLIGHT_MS;

        expect(CARDS_PER_PLAYER).toBe(11);
        expect(WIDOW_CARD_COUNT).toBe(3);
        expect(DEAL_CARD_STAGGER_MS).toBe(115);
        expect(DEAL_CARD_FLIGHT_MS).toBe(800);
        expect(totalDuration).toBe(4825);
        expect(Math.ceil(DEAL_CARD_FLIGHT_MS / DEAL_CARD_STAGGER_MS)).toBe(7);
        sequence.forEach(event => {
            expect(event).not.toHaveProperty('card');
            expect(event).not.toHaveProperty('cards');
            expect(Object.keys(event)).toEqual(
                event.type === 'player'
                    ? ['type', 'playerName', 'circuit', 'playerIndex']
                    : ['type', 'circuit', 'widowIndex'],
            );
        });
    });
});
