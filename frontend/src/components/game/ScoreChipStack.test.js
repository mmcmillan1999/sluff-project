import React from 'react';
import { act, render, screen } from '@testing-library/react';
import ScoreChipStack, { formatScoreChipValue, getScoreChipLayout } from './ScoreChipStack';

describe('getScoreChipLayout', () => {
    test.each([
        [1, 1],
        [29, 1],
        [30, 1],
        [40, 1],
        [41, 2],
        [80, 2],
        [81, 3],
        [120, 3],
        [121, 4],
        [160, 4],
        [161, 5],
        [200, 5],
        [201, 6],
        [9999, 6],
    ])('maps %s points to %s bounded stack(s)', (score, stackCount) => {
        expect(getScoreChipLayout(score).stackCount).toBe(stackCount);
    });

    test('keeps missing values distinct and makes non-positive totals busted', () => {
        expect(getScoreChipLayout(undefined)).toMatchObject({
            score: null,
            displayScore: '—',
            state: 'unavailable',
            stackCount: 0,
        });
        expect(getScoreChipLayout(-12)).toMatchObject({
            score: -12,
            displayScore: '-12',
            state: 'busted',
            stackCount: 1,
        });
    });

    test('distinguishes a loose chip from the first short stack', () => {
        expect(getScoreChipLayout(29)).toMatchObject({
            state: 'loose',
            stackLayers: [1],
        });
        expect(getScoreChipLayout(30)).toMatchObject({
            state: 'banked',
            stackLayers: [3],
        });
    });

    test('formats score math like the recap ceremony', () => {
        expect(formatScoreChipValue(0.1 + 0.2)).toBe('0.3');
        expect(formatScoreChipValue(-12.5)).toBe('-12.5');
    });
});

describe('ScoreChipStack', () => {
    test('shows the exact score while keeping decorative chips out of the accessibility tree', () => {
        const { container } = render(
            <ScoreChipStack score={120} playerName="River Ace" seatPosition="left" />,
        );

        const bank = screen.getByRole('img', { name: 'River Ace score: 120 points' });
        expect(bank).toHaveAttribute('data-stack-count', '3');
        expect(bank).toHaveClass('score-chip-bank--left');
        expect(bank).toHaveTextContent('120');
        expect(container.querySelector('.score-chip-stage')).toHaveAttribute('aria-hidden', 'true');
        const stacks = container.querySelectorAll('.score-chip-stack');
        const layers = container.querySelectorAll('.score-chip-layer');
        expect(stacks).toHaveLength(3);
        expect(layers).toHaveLength(11);
        expect(stacks[0].querySelectorAll('.score-chip-layer')).toHaveLength(3);
        expect(stacks[1].querySelectorAll('.score-chip-layer')).toHaveLength(5);
        expect(stacks[2].querySelectorAll('.score-chip-layer')).toHaveLength(3);

        // Layers rise strictly by one chip thickness (0.42vh) with only a
        // small alternating horizontal jitter — the card-pile riser look.
        const firstPileLayers = stacks[0].querySelectorAll('.score-chip-layer');
        expect(firstPileLayers[0]).toHaveStyle({
            '--chip-settle-x': '-0.07vh',
            '--chip-settle-y': '0.00vh',
        });
        expect(firstPileLayers[1]).toHaveStyle({
            '--chip-settle-x': '0.07vh',
            '--chip-settle-y': '-0.42vh',
        });
        expect(bank.querySelector('.score-chip-total').parentElement).toHaveClass('score-chip-layer--score');
    });

    test('uses the numbered top face as the single loose or busted chip', () => {
        const { container, rerender } = render(
            <ScoreChipStack score={29} playerName="River Ace" />,
        );

        expect(container.querySelectorAll('.score-chip-layer')).toHaveLength(1);
        const scoreLayer = container.querySelector('.score-chip-total').parentElement;
        expect(scoreLayer).toHaveClass('score-chip-layer--score');
        expect(scoreLayer).toHaveStyle({ zIndex: '40' });

        rerender(<ScoreChipStack score={-4} playerName="River Ace" />);
        expect(container.querySelectorAll('.score-chip-layer')).toHaveLength(1);
        expect(container.querySelector('.score-chip-bank')).toHaveClass('score-chip-bank--busted');
    });

    test('animates only real score changes and labels the signed delta', () => {
        vi.useFakeTimers();
        const { container, rerender } = render(
            <ScoreChipStack
                score={87}
                playerName="River Ace"
                seatPosition="bottom"
                animationScope="table-1:round-1"
            />,
        );

        expect(container.querySelector('.score-chip-bank')).not.toHaveClass('score-chip-bank--gain');

        rerender(
            <ScoreChipStack
                score={87}
                playerName="River Ace"
                seatPosition="bottom"
                animationScope="table-1:round-1"
            />,
        );
        expect(container.querySelector('.score-chip-delta')).not.toBeInTheDocument();

        rerender(
            <ScoreChipStack
                score={99}
                playerName="River Ace"
                seatPosition="bottom"
                animationScope="table-1:round-1"
            />,
        );
        expect(container.querySelector('.score-chip-bank')).toHaveClass('score-chip-bank--gain');
        expect(container.querySelector('.score-chip-delta')).toHaveTextContent('+12');

        act(() => vi.advanceTimersByTime(1450));
        expect(container.querySelector('.score-chip-delta')).not.toBeInTheDocument();
        vi.useRealTimers();
    });

    test('uses loss motion for a lower authoritative total', () => {
        const { container, rerender } = render(
            <ScoreChipStack score={54} playerName="River Ace" animationScope="table-1:round-1" />,
        );

        rerender(
            <ScoreChipStack score={48} playerName="River Ace" animationScope="table-1:round-1" />,
        );
        expect(container.querySelector('.score-chip-bank')).toHaveClass('score-chip-bank--loss');
        expect(container.querySelector('.score-chip-delta')).toHaveTextContent('-6');
    });

    test('establishes a reconnect snapshot without a false gain animation', () => {
        const { container, rerender } = render(
            <ScoreChipStack score={undefined} playerName="River Ace" />,
        );

        rerender(<ScoreChipStack score={120} playerName="River Ace" />);
        expect(container.querySelector('.score-chip-bank')).not.toHaveClass('score-chip-bank--gain');
        expect(container.querySelector('.score-chip-delta')).not.toBeInTheDocument();
        expect(screen.getByRole('img', { name: 'River Ace score: 120 points' })).toBeInTheDocument();
    });

    test('snaps quietly when a rematch clears the round animation scope', () => {
        const { container, rerender } = render(
            <ScoreChipStack score={240} playerName="River Ace" animationScope="table-1:round-9" />,
        );

        rerender(<ScoreChipStack score={120} playerName="River Ace" animationScope={null} />);
        expect(container.querySelector('.score-chip-bank')).not.toHaveClass('score-chip-bank--loss');
        expect(container.querySelector('.score-chip-delta')).not.toBeInTheDocument();
        expect(screen.getByRole('img', { name: 'River Ace score: 120 points' })).toBeInTheDocument();
    });

    test('establishes a fresh baseline when the player assigned to a seat changes', () => {
        const { container, rerender } = render(
            <ScoreChipStack score={87} playerName="River Ace" animationScope="table-1:round-1" />,
        );

        rerender(
            <ScoreChipStack score={142} playerName="Prairie Moon" animationScope="table-1:round-1" />,
        );
        expect(container.querySelector('.score-chip-bank')).not.toHaveClass('score-chip-bank--gain');
        expect(container.querySelector('.score-chip-delta')).not.toBeInTheDocument();
    });

    test('clears an active delta if the score becomes unavailable', () => {
        vi.useFakeTimers();
        const { container, rerender } = render(
            <ScoreChipStack score={87} playerName="River Ace" animationScope="table-1:round-1" />,
        );

        rerender(
            <ScoreChipStack score={99} playerName="River Ace" animationScope="table-1:round-1" />,
        );
        expect(container.querySelector('.score-chip-delta')).toHaveTextContent('+12');

        rerender(
            <ScoreChipStack score={undefined} playerName="River Ace" animationScope="table-1:round-1" />,
        );
        expect(container.querySelector('.score-chip-bank')).not.toHaveClass('score-chip-bank--gain');
        expect(container.querySelector('.score-chip-delta')).not.toBeInTheDocument();

        act(() => vi.runOnlyPendingTimers());
        vi.useRealTimers();
    });

    test('keeps a long exact score visible on the top chip', () => {
        render(<ScoreChipStack score={1234567} playerName="River Ace" />);

        const bank = screen.getByRole('img', { name: 'River Ace score: 1234567 points' });
        expect(bank).toHaveTextContent('1234567');
        expect(bank.querySelector('.score-chip-total')).toHaveClass('score-chip-total--tiny');
    });
});
