import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TableLayout from './TableLayout';

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

const StubActionControls = () => null;

const renderCard = (_card, options = {}) => (
    <div
        key={options.key}
        data-testid="plate-card"
        data-opacity={String(options.style?.opacity ?? 1)}
        data-face-down={String(Boolean(options.isFaceDown))}
    />
);

const layout = (state, seatAssignments = seats3, playerId = 1, presentationProps = {}) => (
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
        {...presentationProps}
    />
);

const plateContainer = (container, baseClass) => (
    container.querySelector(`.${baseClass}`)?.closest('.trick-pile-container')
);

describe('TableLayout plate lifecycle and placement', () => {
    test('exposes semantic anchors for the deck, widow, and seated players', () => {
        const { container } = render(layout(makeState()));

        expect(container.querySelector('.game-table')).toHaveAttribute('data-table-theme', 'fort-creek');
        expect(container.querySelector('.game-table')).toHaveAttribute('data-score-transfer-table', 'plate-test');
        expect(container.querySelector('[data-deal-source="deck"]')).toHaveClass('dealer-deck-pile');
        expect(container.querySelector('[data-deal-target="widow"]')).toHaveClass('widow-base');
        expect(container.querySelector('[data-score-transfer-anchor="widow"]')).toHaveClass('widow-base');
        expect([...container.querySelectorAll('[data-deal-player]')].map(node => node.dataset.dealPlayer))
            .toEqual(['Left', 'Right', 'Bottom']);
    });

    test('retains and shrinks the dealer deck during a Bidding Phase presentation', () => {
        const bidding = makeState({ state: 'Bidding Phase', widowCount: 3 });
        const { container, rerender } = render(layout(
            bidding,
            seats3,
            1,
            { dealPresentationActive: true, dealCardsRemaining: 17 },
        ));

        expect(container.querySelector('[data-deal-source="deck"]')).toBeInTheDocument();
        expect(container.querySelectorAll('.dealer-deck-card-wrapper')).toHaveLength(17);
        expect(screen.queryByRole('button', { name: /deal cards/i })).not.toBeInTheDocument();

        rerender(layout(
            bidding,
            seats3,
            1,
            { dealPresentationActive: true, dealCardsRemaining: 0 },
        ));
        expect(container.querySelector('[data-deal-source="deck"]')).toBeInTheDocument();
        expect(container.querySelectorAll('.dealer-deck-card-wrapper')).toHaveLength(0);

        rerender(layout(bidding));
        expect(container.querySelector('[data-deal-source="deck"]')).not.toBeInTheDocument();
    });

    test('suppresses action controls while the dealing presentation is active', () => {
        render(layout(
            makeState(),
            seats3,
            1,
            { dealPresentationActive: true, suppressActionControls: true },
        ));

        expect(screen.queryByRole('button', { name: /deal cards/i })).not.toBeInTheDocument();
    });

    test('shows the empty three-player widow plate with the deck-local Deal action', () => {
        const { container } = render(layout(makeState()));

        const dealButton = screen.getByRole('button', { name: /deal cards/i });
        expect(dealButton).toHaveClass('dealer-deck-action');
        expect(dealButton.closest('.dealer-deck-container')).not.toBeNull();
        expect(container.querySelector('.dealer-deck-label')).not.toBeInTheDocument();
        expect(screen.queryByText(/is dealing/i)).not.toBeInTheDocument();
        const widow = plateContainer(container, 'widow-base');
        expect(widow).toHaveClass('pile-top-left');
        expect(container.querySelector('.bidder-base')).not.toBeInTheDocument();
        expect(container.querySelector('.defender-base')).not.toBeInTheDocument();
        expect(within(widow).getAllByTestId('plate-card')).toHaveLength(1);
        expect(within(widow).getByTestId('plate-card')).toHaveAttribute('data-opacity', '0.3');
    });

    test.each([
        ['numeric dealer with serialized viewer id', 1, '1'],
        ['serialized dealer with numeric viewer id', '1', 1],
    ])('emits dealCards from the deck for a %s', async (_description, dealer, viewerId) => {
        const user = userEvent.setup();
        const emitEvent = vi.fn();
        render(layout(
            makeState({ dealer }),
            seats3,
            viewerId,
            { emitEvent },
        ));

        await user.click(screen.getByRole('button', { name: /deal cards/i }));

        expect(emitEvent).toHaveBeenCalledTimes(1);
        expect(emitEvent).toHaveBeenCalledWith('dealCards');
    });

    test.each([
        ['nondealer', 2, false],
        ['spectator', 1, true],
    ])('shows only the waiting deck for a %s', (_description, viewerId, isSpectator) => {
        const { container } = render(layout(
            makeState(),
            seats3,
            viewerId,
            { isSpectator },
        ));

        expect(container.querySelector('[data-deal-source="deck"]')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /deal cards/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        expect(screen.queryByText(/is dealing/i)).not.toBeInTheDocument();
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
