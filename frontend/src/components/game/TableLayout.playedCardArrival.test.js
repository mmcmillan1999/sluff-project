import React from 'react';
import { render } from '@testing-library/react';
import TableLayout from './TableLayout';
import { ARRIVAL_MS } from './playedCardArrival';

const { motionPreference } = vi.hoisted(() => ({
    motionPreference: { reduced: false },
}));

vi.mock('./ScoreProgressBar', () => ({
    default: () => null,
}));

vi.mock('../../hooks/useViewport', () => ({
    useViewport: () => ({ width: 390, height: 844, orientation: 'portrait' }),
}));

vi.mock('../../hooks/usePrefersReducedMotion', () => ({
    usePrefersReducedMotion: () => motionPreference.reduced,
}));

const players = {
    1: { userId: 1, playerName: 'Bottom' },
    2: { userId: 2, playerName: 'Left' },
    3: { userId: 3, playerName: 'Top' },
    4: { userId: 4, playerName: 'Right' },
};

const seats4 = {
    self: 'Bottom',
    opponentLeft: 'Left',
    opponentAcross: 'Top',
    opponentRight: 'Right',
};

const bidder = { userId: 2, playerName: 'Left', bid: 'Solo' };

const makeState = (overrides = {}) => ({
    tableId: 'arrival-test',
    tableName: 'Arrival test',
    theme: 'fort-creek',
    state: 'Playing Phase',
    gameStarted: true,
    playerMode: 4,
    dealer: 4,
    players,
    playerOrderActive: ['Bottom', 'Left', 'Top'],
    capturedTricks: {},
    currentTrickCards: [],
    lastCompletedTrick: null,
    bidWinnerInfo: bidder,
    currentHighestBidDetails: bidder,
    widow: [],
    originalDealtWidow: [],
    widowCount: 0,
    roundSummary: null,
    trumpBroken: false,
    scores: {},
    ...overrides,
});

const renderCard = (card, options = {}) => (
    <div key={options.key} data-testid="felt-card" data-card={card || ''} />
);

const layout = (state, isSpectator = false) => (
    <TableLayout
        currentTableState={state}
        seatAssignments={seats4}
        isSpectator={isSpectator}
        renderCard={renderCard}
        PlayerSeat={() => null}
        ActionControls={() => null}
        selfPlayerName={isSpectator ? 'Watcher' : 'Bottom'}
        playerId={isSpectator ? 99 : 1}
        emitEvent={vi.fn()}
        handleLeaveTable={vi.fn()}
        playSound={vi.fn()}
        dropZoneRef={React.createRef()}
    />
);

const animatedSeats = (animate) => animate.mock.instances
    .map((element) => element.closest('[data-played-card-slot]')?.dataset.playedCardSlot);

describe('opponent played cards fly in from their seats', () => {
    let animate;

    beforeEach(() => {
        motionPreference.reduced = false;
        animate = vi.fn(function mockAnimate() {
            return { playState: 'running', addEventListener: vi.fn(), cancel: vi.fn() };
        });
        Element.prototype.animate = animate;
    });

    afterEach(() => {
        delete Element.prototype.animate;
    });

    test('cards already on the felt at mount do not fly (reconnect, spectating)', () => {
        render(layout(makeState({
            currentTrickCards: [{ playerName: 'Left', card: 'KH' }, { playerName: 'Top', card: '9H' }],
        })));
        expect(animate).not.toHaveBeenCalled();
    });

    test('a newly played opponent card flies in from its seat, and the turn is not gated on it', () => {
        const { container, rerender } = render(layout(makeState({
            currentTrickCards: [{ playerName: 'Left', card: 'KH' }],
        })));

        rerender(layout(makeState({
            currentTrickCards: [{ playerName: 'Left', card: 'KH' }, { playerName: 'Top', card: '9H' }],
            trickTurnPlayerName: 'Bottom',
        })));

        expect(animate).toHaveBeenCalledTimes(1);
        expect(animatedSeats(animate)).toEqual(['top']);
        const [, options] = animate.mock.calls[0];
        expect(options.duration).toBe(ARRIVAL_MS);
        // The arriving element is the inner wrapper, inside the magnet's
        // .trick-card-fly, so the two transforms compose.
        const arriving = animate.mock.instances[0];
        expect(arriving).toHaveClass('trick-card-arrive');
        expect(arriving.parentElement).toHaveClass('trick-card-fly');
        expect(arriving.dataset.arrivalPlayer).toBe('Top');
        // The slot is raised above the seat plates for the flight.
        expect(container.querySelector('[data-played-card-slot="top"]').style.zIndex).toBe('30');
        // Nothing about the fly-in touches the card itself.
        expect(container.querySelectorAll('[data-testid="felt-card"][data-card="9H"]')).toHaveLength(1);
    });

    test('the local player\'s own card never flies in (PlayerHand already animated it)', () => {
        const { rerender } = render(layout(makeState()));
        rerender(layout(makeState({
            currentTrickCards: [{ playerName: 'Bottom', card: 'AC' }],
        })));
        expect(animate).not.toHaveBeenCalled();

        rerender(layout(makeState({
            currentTrickCards: [{ playerName: 'Bottom', card: 'AC' }, { playerName: 'Left', card: 'KH' }],
        })));
        expect(animatedSeats(animate)).toEqual(['left']);
    });

    test('a spectator sees every seat\'s card fly in, the bottom one included', () => {
        const { rerender } = render(layout(makeState(), true));
        rerender(layout(makeState({
            currentTrickCards: [{ playerName: 'Bottom', card: 'AC' }],
        }), true));
        expect(animatedSeats(animate)).toEqual(['bottom']);
    });

    test('the completed trick does not re-fly when the linger swaps in lastCompletedTrick', () => {
        const trick = [
            { playerName: 'Bottom', card: 'AC' },
            { playerName: 'Left', card: 'KH' },
            { playerName: 'Top', card: '9H' },
        ];
        const { rerender } = render(layout(makeState({ currentTrickCards: trick.slice(0, 2) })));
        rerender(layout(makeState({ currentTrickCards: trick })));
        expect(animatedSeats(animate)).toEqual(['top']);

        rerender(layout(makeState({
            state: 'TrickCompleteLinger',
            currentTrickCards: trick,
            lastCompletedTrick: { cards: trick, winnerName: 'Left' },
        })));
        expect(animate).toHaveBeenCalledTimes(1);
    });

    test('once the felt clears, the same card played later flies in again', () => {
        const play = [{ playerName: 'Left', card: 'KH' }];
        const { rerender } = render(layout(makeState()));
        rerender(layout(makeState({ currentTrickCards: play })));
        rerender(layout(makeState({ currentTrickCards: [] })));
        rerender(layout(makeState({ currentTrickCards: play })));
        expect(animatedSeats(animate)).toEqual(['left', 'left']);
    });

    test('respects prefers-reduced-motion', () => {
        motionPreference.reduced = true;
        const { rerender } = render(layout(makeState()));
        rerender(layout(makeState({
            currentTrickCards: [{ playerName: 'Left', card: 'KH' }],
        })));
        expect(animate).not.toHaveBeenCalled();
    });

    test('running arrivals are cancelled when the table unmounts', () => {
        const { rerender, unmount } = render(layout(makeState()));
        rerender(layout(makeState({
            currentTrickCards: [{ playerName: 'Left', card: 'KH' }],
        })));
        const animation = animate.mock.results[0].value;
        unmount();
        expect(animation.cancel).toHaveBeenCalled();
    });
});
