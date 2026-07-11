import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TableLayout from './TableLayout';

vi.mock('./PlayerSeatPositioner', () => ({
    default: () => null,
}));

vi.mock('./ScoreProgressBar', () => ({
    default: () => null,
}));

vi.mock('../../hooks/useViewport', () => ({
    useViewport: () => ({ width: 390, height: 844, orientation: 'portrait' }),
}));

vi.mock('../../hooks/usePrefersReducedMotion', () => ({
    usePrefersReducedMotion: () => true,
}));

const players = {
    1: { userId: 1, playerName: 'Bottom' },
    2: { userId: 2, playerName: 'Left' },
    3: { userId: 3, playerName: 'Top' },
    4: { userId: 4, playerName: 'Right' },
};

const seats3 = {
    self: 'Bottom',
    opponentLeft: 'Left',
    opponentRight: 'Right',
};

const seats4 = {
    ...seats3,
    opponentAcross: 'Top',
};

const makeState = (overrides = {}) => ({
    tableId: 'plate-test',
    tableName: 'Plate test',
    theme: 'fort-creek',
    state: 'Dealing Pending',
    gameStarted: true,
    playerMode: 3,
    dealer: 1,
    players,
    playerOrderActive: ['Bottom', 'Left', 'Right'],
    capturedTricks: {},
    currentTrickCards: [],
    lastCompletedTrick: null,
    bidWinnerInfo: null,
    widow: [],
    originalDealtWidow: [],
    widowCount: 0,
    roundSummary: null,
    trumpBroken: false,
    scores: {},
    ...overrides,
});

const StubActionControls = ({ currentTableState, playerId }) => (
    currentTableState.state === 'Dealing Pending'
        && String(currentTableState.dealer) === String(playerId)
        ? <button type="button">Deal Cards</button>
        : null
);

const renderCard = (_card, options = {}) => (
    <div
        key={options.key}
        data-testid="plate-card"
        data-opacity={String(options.style?.opacity ?? 1)}
        data-face-down={String(Boolean(options.isFaceDown))}
    />
);

const layout = (state, seatAssignments = seats3, playerId = 1) => (
    <TableLayout
        currentTableState={state}
        seatAssignments={seatAssignments}
        isSpectator={false}
        renderCard={renderCard}
        PlayerSeat={() => null}
        ActionControls={StubActionControls}
        selfPlayerName={seatAssignments.self}
        playerId={playerId}
        emitEvent={vi.fn()}
        handleLeaveTable={vi.fn()}
        playSound={vi.fn()}
        dropZoneRef={React.createRef()}
    />
);

const plateContainer = (container, baseClass) => (
    container.querySelector(`.${baseClass}`)?.closest('.trick-pile-container')
);

describe('TableLayout plate lifecycle and placement', () => {
    test('shows the empty three-player widow plate with Deal Cards at top-left', () => {
        const { container } = render(layout(makeState()));

        expect(screen.getByRole('button', { name: 'Deal Cards' })).toBeInTheDocument();
        const widow = plateContainer(container, 'widow-base');
        expect(widow).toHaveClass('pile-top-left');
        expect(container.querySelector('.bidder-base')).not.toBeInTheDocument();
        expect(container.querySelector('.defender-base')).not.toBeInTheDocument();
        expect(within(widow).getAllByTestId('plate-card')).toHaveLength(1);
        expect(within(widow).getByTestId('plate-card')).toHaveAttribute('data-opacity', '0.3');
    });

    test('keeps the pre-bid plate in place and visibly receives the public widow count', () => {
        const initial = makeState();
        const { container, rerender } = render(layout(initial));

        rerender(layout(makeState({ state: 'Bidding Phase', widowCount: 3 })));

        const widow = plateContainer(container, 'widow-base');
        expect(widow).toHaveClass('pile-top-left');
        expect(within(widow).getAllByTestId('plate-card')).toHaveLength(3);
        expect(container.querySelector('.bidder-base')).not.toBeInTheDocument();
        expect(container.querySelector('.defender-base')).not.toBeInTheDocument();
    });

    test('places the team between left and right while keeping the bidder adjacent', () => {
        const { container } = render(layout(makeState({
            state: 'Playing Phase',
            widowCount: 3,
            bidWinnerInfo: { playerName: 'Bottom', bid: 'Heart Solo' },
            capturedTricks: { Bottom: [], Left: [], Right: [] },
        })));

        expect(plateContainer(container, 'widow-base')).toHaveClass('pile-top-left');
        expect(plateContainer(container, 'defender-base')).toHaveClass('pile-top-right');
        expect(plateContainer(container, 'bidder-base')).toHaveClass('pile-bottom-right');
    });

    test('moves the empty four-player widow from a bottom dealer left hand to a top dealer left hand', () => {
        const bottomDealer = makeState({
            playerMode: 4,
            playerOrderActive: ['Left', 'Top', 'Right'],
        });
        const { container, rerender } = render(layout(bottomDealer, seats4));

        expect(plateContainer(container, 'widow-base')).toHaveClass('pile-bottom-left');

        rerender(layout(makeState({
            playerMode: 4,
            dealer: 3,
            playerOrderActive: ['Bottom', 'Left', 'Right'],
        }), seats4));

        expect(plateContainer(container, 'widow-base')).toHaveClass('pile-top-right');
    });

    test('anchors the sitting dealer widow peek to the relocated widow corner', async () => {
        const user = userEvent.setup();
        const { container } = render(layout(makeState({
            state: 'Bidding Phase',
            playerMode: 4,
            playerOrderActive: ['Left', 'Top', 'Right'],
            widowCount: 3,
            originalDealtWidow: ['6H', '7H', '8H'],
        }), seats4));

        await user.click(screen.getByRole('button', {
            name: 'Widow pile. Reveal if you are the sitting dealer',
        }));

        expect(container.querySelector('.last-trick-overlay-container'))
            .toHaveClass('pile-bottom-left');
        expect(screen.getByRole('heading', { name: 'Widow' })).toBeInTheDocument();
    });

    test('removes the widow plate when the table returns to the pregame state', () => {
        const { container, rerender } = render(layout(makeState()));
        expect(container.querySelector('.widow-base')).toBeInTheDocument();

        rerender(layout(makeState({
            state: 'Ready to Start',
            gameStarted: false,
            dealer: null,
        })));

        expect(container.querySelector('.widow-base')).not.toBeInTheDocument();
    });
});
