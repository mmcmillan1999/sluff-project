import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ActionControls from './ActionControls';

const makeState = (overrides = {}) => ({
    tableId: 'table-1',
    tableName: 'Test table',
    tableType: 'private',
    state: 'Waiting for Players',
    dealer: 2,
    players: {
        1: { userId: 1, playerName: 'Alice', isSpectator: false, disconnected: false },
        2: { userId: 2, playerName: 'Bartholomew-With-An-Exceptionally-Long-Name', isSpectator: false, disconnected: false },
        3: { userId: 3, playerName: 'Cara', isSpectator: false, disconnected: false }
    },
    ...overrides
});

const renderCard = (card, options = {}) => options.isButton ? (
    <button type="button" aria-label={`Choose ${card}`} onClick={options.onClick}>{card}</button>
) : <span data-testid="prompt-card">{card}</span>;

const defaultProps = {
    playerId: 1,
    selfPlayerName: 'Alice',
    isSpectator: false,
    emitEvent: vi.fn(),
    handleLeaveTable: vi.fn(),
    renderCard,
    isAdmin: false
};

const renderControls = (state, props = {}) => render(
    <ActionControls {...defaultProps} {...props} currentTableState={state} />
);

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
});

describe('ActionControls portrait prompt presentation', () => {
    const passiveCases = [
        {
            name: 'dealer wait',
            state: makeState({ state: 'Dealing Pending' }),
            expected: /Bartholomew-With-An-Exceptionally-Long-Name.*deal/i
        },
        {
            name: 'bid wait',
            state: makeState({ state: 'Bidding Phase', biddingTurnPlayerName: 'Bartholomew-With-An-Exceptionally-Long-Name' }),
            expected: /Bartholomew-With-An-Exceptionally-Long-Name.*bidding/i
        },
        {
            name: 'Frog decision wait',
            state: makeState({ state: 'Awaiting Frog Upgrade Decision', biddingTurnPlayerName: 'Cara' }),
            expected: /Cara.*deciding/i
        },
        {
            name: 'trump wait',
            state: makeState({ state: 'Trump Selection', bidWinnerInfo: { userId: 3, playerName: 'Cara' } }),
            expected: /Cara.*choosing trump/i
        }
    ];

    test.each(passiveCases)('uses a compact status pill for $name', ({ state, expected }) => {
        const { container } = renderControls(state);

        expect(screen.getByRole('status')).toHaveTextContent(expected);
        expect(container.querySelector('.action-prompt--status')).toBeInTheDocument();
        expect(container.querySelector('.action-prompt__player-name')).toBeInTheDocument();
        expect(container.querySelector('.action-prompt__player-name')).toHaveAttribute('title');
        expect(screen.queryByText(state.state)).not.toBeInTheDocument();
    });

    test('lays the four active bids out in an accessible 2 by 2 choice grid', () => {
        const state = makeState({
            state: 'Bidding Phase',
            biddingTurnPlayerName: 'Alice',
            currentHighestBidDetails: { bid: 'Frog' }
        });
        const { container } = renderControls(state);

        expect(screen.getByRole('region', { name: 'Bidding controls' })).toHaveAttribute('data-prompt-variant', 'choice');
        expect(screen.getByRole('region', { name: 'Bidding controls' })).toHaveClass('action-prompt--portrait-docked');
        expect(screen.getByRole('heading', { name: 'Choose your bid' })).toBeInTheDocument();
        const grid = container.querySelector('.action-prompt__button-grid--bids');
        expect(grid).toBeInTheDocument();
        expect(grid.querySelectorAll('button')).toHaveLength(4);
        expect(screen.getByRole('button', { name: 'Frog, 1 times scoring multiplier' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Solo, 2 times scoring multiplier' })).toBeEnabled();
        grid.querySelectorAll('button').forEach(button => {
            expect(button).toHaveClass('action-prompt__button');
        });
    });

    test('keeps Frog upgrade actions concise and touch-target classed', () => {
        renderControls(makeState({
            state: 'Awaiting Frog Upgrade Decision',
            biddingTurnPlayerName: 'Alice'
        }));

        expect(screen.getByRole('region', { name: 'Frog upgrade decision' })).toHaveAttribute('data-prompt-variant', 'choice');
        expect(screen.getByRole('button', { name: /Heart Solo/ })).toHaveClass('action-prompt__button');
        expect(screen.getByRole('button', { name: 'Keep Frog' })).toHaveClass('action-prompt__button');
    });

    test('uses the portrait card panel for trump without exposing a raw state label', async () => {
        const user = userEvent.setup();
        const emitEvent = vi.fn();
        renderControls(makeState({
            state: 'Trump Selection',
            bidWinnerInfo: { userId: 1, playerName: 'Alice' }
        }), { emitEvent });

        expect(screen.getByRole('region', { name: 'Choose trump suit' })).toHaveAttribute('data-prompt-variant', 'card');
        expect(screen.queryByText('Trump Selection')).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Choose ?D' }));
        expect(emitEvent).toHaveBeenCalledWith('chooseTrump', { suit: 'D' });
    });
});

describe('ActionControls Quick Play decisions', () => {
    test('emits the generation-scoped first-click decision and locks both choices locally', async () => {
        const user = userEvent.setup();
        const emitEvent = vi.fn();
        const decisionState = makeState({
            tableType: 'quickplay',
            state: 'Ready to Start',
            qpPhase: 'decision_pending',
            qpGeneration: 7
        });
        const { rerender } = renderControls(decisionState, { emitEvent });

        const seekButton = screen.getByRole('button', { name: 'Look for a 4th' });
        await user.click(seekButton);

        expect(emitEvent).toHaveBeenCalledTimes(1);
        expect(emitEvent).toHaveBeenCalledWith('quickPlayDecision', { choice: 'seek4', generation: 7 });
        expect(screen.getByRole('button', { name: 'Start 3-Player' })).toBeDisabled();
        expect(seekButton).toBeDisabled();

        rerender(
            <ActionControls
                {...defaultProps}
                emitEvent={emitEvent}
                currentTableState={{ ...decisionState, qpGeneration: 8 }}
            />
        );

        expect(await screen.findByRole('button', { name: 'Start 3-Player' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Look for a 4th' })).toBeEnabled();
    });

    test('requires an explicit generation-scoped start for a retained four-player roster', async () => {
        const user = userEvent.setup();
        const emitEvent = vi.fn();
        const players = {
            ...makeState().players,
            4: { userId: 4, playerName: 'Drew', isSpectator: false, disconnected: false }
        };
        renderControls(makeState({
            tableType: 'quickplay',
            state: 'Ready to Start',
            players,
            qpPhase: 'decision_pending',
            qpGeneration: 18
        }), { emitEvent });

        expect(screen.getByRole('heading', { name: 'Four seats are ready' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Start 3-Player' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Look for a 4th' })).not.toBeInTheDocument();
        const startButton = screen.getByRole('button', { name: 'Start 4-Player' });
        await user.click(startButton);

        expect(emitEvent).toHaveBeenCalledWith('quickPlayDecision', { choice: 'start4', generation: 18 });
        expect(startButton).toBeDisabled();
    });

    test('a server rejection signal re-enables the same authoritative decision', async () => {
        const user = userEvent.setup();
        const decisionState = makeState({
            tableType: 'quickplay',
            state: 'Ready to Start',
            qpPhase: 'decision_pending',
            qpGeneration: 12
        });
        const { rerender } = renderControls(decisionState, {
            quickPlayDecisionRejectionNonce: 0
        });

        await user.click(screen.getByRole('button', { name: 'Start 3-Player' }));
        expect(screen.getByRole('button', { name: 'Start 3-Player' })).toBeDisabled();

        rerender(
            <ActionControls
                {...defaultProps}
                currentTableState={decisionState}
                quickPlayDecisionRejectionNonce={1}
            />
        );
        expect(await screen.findByRole('button', { name: 'Start 3-Player' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Look for a 4th' })).toBeEnabled();
    });

    test('shows a finite fourth-player countdown and promises to return to the decision', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-10T18:00:00Z'));
        const deadline = Date.now() + 5200;
        renderControls(makeState({
            tableType: 'quickplay',
            state: 'Ready to Start',
            qpPhase: 'seeking_fourth',
            qpGeneration: 2,
            qpWindowEndsAt: deadline
        }));

        expect(screen.getByRole('heading', { name: 'Looking for a 4th · 6s' })).toBeInTheDocument();
        expect(screen.getByText('If no one joins, the table will choose again.')).toBeInTheDocument();

        act(() => {
            vi.advanceTimersByTime(1100);
        });
        expect(screen.getByRole('heading', { name: 'Looking for a 4th · 5s' })).toBeInTheDocument();
    });

    test.each([
        ['starting_3', 'Starting a 3-player game…'],
        ['starting_4', 'Starting a 4-player game…']
    ])('maps %s to a compact status instead of internal state text', (qpPhase, copy) => {
        renderControls(makeState({
            tableType: 'quickplay',
            state: 'Ready to Start',
            qpPhase,
            qpGeneration: 4
        }));

        expect(screen.getByRole('status')).toHaveTextContent(copy);
        expect(screen.queryByText(qpPhase)).not.toBeInTheDocument();
    });

    test('gives spectators the same polished presentation map without decision controls', () => {
        renderControls(makeState({
            tableType: 'quickplay',
            state: 'Ready to Start',
            qpPhase: 'decision_pending',
            qpGeneration: 3
        }), { isSpectator: true });

        expect(screen.getByRole('status')).toHaveTextContent('Seated players are choosing');
        expect(screen.queryByRole('button', { name: 'Start 3-Player' })).not.toBeInTheDocument();
        expect(screen.queryByText('Ready to Start')).not.toBeInTheDocument();
    });
});

describe('ActionControls dedicated-state suppression', () => {
    test.each([
        'Bid Announcement',
        'Playing Phase',
        'TrickCompleteLinger',
        'Awaiting Next Round Trigger',
        'Game Over',
        'Draw Resolving',
        'DrawComplete',
        'DrawDeclined'
    ])('does not cover the table during %s', (state) => {
        const { container } = renderControls(makeState({ state }));
        expect(container.querySelector('.action-prompt-container')).not.toBeInTheDocument();
        expect(screen.queryByText(state)).not.toBeInTheDocument();
    });

    test('never falls back to exposing an unknown internal state name', () => {
        const { container } = renderControls(makeState({ state: 'Internal Transition Sentinel' }));
        expect(container).toBeEmptyDOMElement();
    });
});
