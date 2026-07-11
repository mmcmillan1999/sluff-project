import { describe, expect, test } from 'vitest';
import {
    deriveTrickPlatePlacement,
    resolveDealerName,
    seatForPlayerName,
    WIDOW_CORNER_BY_DEALER_SEAT,
} from './trickPlatePlacement';

const seats4 = {
    self: 'Bottom',
    opponentLeft: 'Left',
    opponentAcross: 'Top',
    opponentRight: 'Right',
};

const seats3 = {
    self: 'Bottom',
    opponentLeft: 'Left',
    opponentRight: 'Right',
};

const players = {
    1: { userId: 1, playerName: 'Bottom' },
    2: { userId: 2, playerName: 'Left' },
    3: { userId: 3, playerName: 'Top' },
    4: { userId: 4, playerName: 'Right' },
};

const idByName = Object.fromEntries(
    Object.values(players).map(player => [player.playerName, player.userId]),
);

const fourPlayerPlacement = (dealerName, bidderName) => ({
    dealerName,
    bidderName,
    placement: deriveTrickPlatePlacement({
        playerMode: 4,
        seatAssignments: seats4,
        dealer: idByName[dealerName],
        players,
        playerOrderActive: Object.values(seats4)
            .filter(name => name !== dealerName),
        bidderName,
    }),
});

describe('trick plate placement primitives', () => {
    test('maps names to the fixed local-view seats', () => {
        expect(seatForPlayerName('Bottom', seats4)).toBe('bottom');
        expect(seatForPlayerName('Left', seats4)).toBe('left');
        expect(seatForPlayerName('Top', seats4)).toBe('top');
        expect(seatForPlayerName('Right', seats4)).toBe('right');
        expect(seatForPlayerName('Missing', seats4)).toBeNull();
    });

    test('resolves the serialized dealer user id across string/number forms', () => {
        expect(resolveDealerName('2', players)).toBe('Left');
        expect(resolveDealerName(4, players)).toBe('Right');
        expect(resolveDealerName(99, players)).toBeNull();
    });

    test('maps every four-player dealer to the corner beside their left hand', () => {
        expect(WIDOW_CORNER_BY_DEALER_SEAT).toEqual({
            bottom: 'pile-bottom-left',
            left: 'pile-top-left',
            top: 'pile-top-right',
            right: 'pile-bottom-right',
        });

        expect(fourPlayerPlacement('Bottom', 'Left').placement.widowPileClass)
            .toBe('pile-bottom-left');
        expect(fourPlayerPlacement('Left', 'Bottom').placement.widowPileClass)
            .toBe('pile-top-left');
        expect(fourPlayerPlacement('Top', 'Bottom').placement.widowPileClass)
            .toBe('pile-top-right');
        expect(fourPlayerPlacement('Right', 'Bottom').placement.widowPileClass)
            .toBe('pile-bottom-right');
    });
});

describe('three-player trick plate placement', () => {
    const cases = [
        {
            bidderName: 'Bottom',
            active: ['Bottom', 'Left', 'Right'],
            expected: {
                widowPileClass: 'pile-top-left',
                defenderPileClass: 'pile-top-right',
                bidderPileClass: 'pile-bottom-right',
            },
        },
        {
            bidderName: 'Left',
            active: ['Bottom', 'Left', 'Right'],
            expected: {
                widowPileClass: 'pile-top-left',
                defenderPileClass: 'pile-bottom-right',
                bidderPileClass: 'pile-bottom-left',
            },
        },
        {
            bidderName: 'Right',
            active: ['Bottom', 'Left', 'Right'],
            expected: {
                widowPileClass: 'pile-top-left',
                defenderPileClass: 'pile-bottom-left',
                bidderPileClass: 'pile-top-right',
            },
        },
    ];

    test.each(cases)('$bidderName bidder uses the requested widow/team geometry', ({
        bidderName,
        active,
        expected,
    }) => {
        expect(deriveTrickPlatePlacement({
            playerMode: 3,
            seatAssignments: seats3,
            playerOrderActive: active,
            bidderName,
        })).toEqual(expected);
    });

    test('places the widow before a bidder exists', () => {
        expect(deriveTrickPlatePlacement({
            playerMode: 3,
            seatAssignments: seats3,
            playerOrderActive: ['Bottom', 'Left', 'Right'],
        })).toEqual({
            widowPileClass: 'pile-top-left',
            defenderPileClass: null,
            bidderPileClass: null,
        });
    });
});

describe('four-player trick plate placement case table', () => {
    const expectedCases = [
        ['Bottom', 'Left', 'pile-bottom-left', 'pile-top-right', 'pile-top-left'],
        ['Bottom', 'Top', 'pile-bottom-left', 'pile-top-right', 'pile-top-left'],
        ['Bottom', 'Right', 'pile-bottom-left', 'pile-top-left', 'pile-top-right'],
        ['Left', 'Bottom', 'pile-top-left', 'pile-top-right', 'pile-bottom-right'],
        ['Left', 'Top', 'pile-top-left', 'pile-bottom-right', 'pile-top-right'],
        ['Left', 'Right', 'pile-top-left', 'pile-bottom-right', 'pile-top-right'],
        ['Top', 'Bottom', 'pile-top-right', 'pile-top-left', 'pile-bottom-right'],
        ['Top', 'Left', 'pile-top-right', 'pile-bottom-right', 'pile-bottom-left'],
        ['Top', 'Right', 'pile-top-right', 'pile-bottom-left', 'pile-bottom-right'],
        ['Right', 'Bottom', 'pile-bottom-right', 'pile-top-left', 'pile-bottom-left'],
        ['Right', 'Left', 'pile-bottom-right', 'pile-bottom-left', 'pile-top-left'],
        ['Right', 'Top', 'pile-bottom-right', 'pile-bottom-left', 'pile-top-left'],
    ];

    test.each(expectedCases)(
        'dealer %s / bidder %s => widow %s, team %s, bidder %s',
        (dealerName, bidderName, widow, defender, bidder) => {
            const { placement } = fourPlayerPlacement(dealerName, bidderName);
            expect(placement).toEqual({
                widowPileClass: widow,
                defenderPileClass: defender,
                bidderPileClass: bidder,
            });
            expect(new Set(Object.values(placement)).size).toBe(3);
        },
    );

    test('places a dealer-relative widow before bidding starts', () => {
        expect(deriveTrickPlatePlacement({
            playerMode: 4,
            seatAssignments: seats4,
            dealer: 3,
            players,
            playerOrderActive: ['Bottom', 'Left', 'Right'],
        })).toEqual({
            widowPileClass: 'pile-top-right',
            defenderPileClass: null,
            bidderPileClass: null,
        });
    });

    test('fails closed when the four-player dealer cannot be mapped to a seat', () => {
        expect(deriveTrickPlatePlacement({
            playerMode: 4,
            seatAssignments: seats4,
            dealer: 99,
            players,
            playerOrderActive: ['Bottom', 'Left', 'Top'],
            bidderName: 'Bottom',
        }).widowPileClass).toBeNull();
    });
});
