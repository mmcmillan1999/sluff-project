import React from 'react';
import { render, screen } from '@testing-library/react';
import PlayerSeat from './PlayerSeat';

vi.mock('./ScoreChipStack', () => ({
    default: ({ score, playerName, seatPosition, animationScope }) => (
        <div
            data-testid="score-chip-stack"
            data-score={score ?? 'missing'}
            data-player-name={playerName}
            data-seat-position={seatPosition}
            data-animation-scope={animationScope ?? 'missing'}
        />
    ),
}));

const createTableState = (scores = { 'River Ace': 87 }) => ({
    tableId: 'table-7',
    state: 'Awaiting Next Round Trigger',
    players: {
        7: {
            userId: 7,
            playerName: 'River Ace',
            tokens: '9.00',
            disconnected: false,
        },
    },
    scores,
    bidWinnerInfo: null,
    playerOrderActive: ['River Ace'],
    trickTurnPlayerName: null,
    forfeiture: null,
    dealer: null,
    trumpSuit: null,
    trumpBroken: false,
    playerMode: 3,
    gameStarted: false,
    roundSummary: { presentationReadyAt: 12345 },
});

test('renders score chips beside the unclipped name-only plaque', () => {
    const { container } = render(
        <PlayerSeat
            playerName="River Ace"
            currentTableState={createTableState()}
            isSelf={false}
            emitEvent={vi.fn()}
            renderCard={vi.fn()}
            seatPosition="left"
        />,
    );

    const plaque = container.querySelector('.player-seat');
    const stack = screen.getByTestId('score-chip-stack');

    expect(plaque).toHaveTextContent('River Ace');
    expect(plaque).not.toHaveTextContent(/Points:/i);
    expect(screen.queryByAltText('Tokens')).not.toBeInTheDocument();
    expect(stack).toHaveAttribute('data-score', '87');
    expect(stack).toHaveAttribute('data-player-name', 'River Ace');
    expect(stack).toHaveAttribute('data-seat-position', 'left');
    expect(stack).toHaveAttribute('data-animation-scope', 'table-7:12345');
    expect(stack.parentElement).toBe(plaque.parentElement);
    expect(stack.parentElement).toHaveClass('player-seat-wrapper-left');
});

test('passes an absent score through without inventing a starting value', () => {
    render(
        <PlayerSeat
            playerName="River Ace"
            currentTableState={createTableState({})}
            isSelf={false}
            emitEvent={vi.fn()}
            renderCard={vi.fn()}
            seatPosition="top"
        />,
    );

    expect(screen.getByTestId('score-chip-stack')).toHaveAttribute('data-score', 'missing');
});

test('disables score motion outside the authoritative round presentation states', () => {
    const state = createTableState();
    state.state = 'Ready to Start';

    render(
        <PlayerSeat
            playerName="River Ace"
            currentTableState={state}
            isSelf={false}
            emitEvent={vi.fn()}
            renderCard={vi.fn()}
            seatPosition="bottom"
        />,
    );

    expect(screen.getByTestId('score-chip-stack')).toHaveAttribute('data-animation-scope', 'missing');
});
