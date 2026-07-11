import React from 'react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GameOverPodium, { rankPodiumPlayers } from './GameOverPodium';

const baseScores = {
    Alice: 104,
    Bob: 91,
    Cara: 127,
    ScoreAbsorber: 120
};

describe('rankPodiumPlayers', () => {
    test('uses the declared winner for the top step and filters the score absorber', () => {
        const entries = rankPodiumPlayers({ gameWinner: 'Cara', finalScores: baseScores });

        expect(entries.map(entry => entry.name)).toEqual(['Cara', 'Alice', 'Bob']);
        expect(entries.map(entry => entry.rank)).toEqual([1, 2, 3]);
        expect(entries[0]).toMatchObject({ isWinner: true, visualOrder: 2 });
        expect(entries.some(entry => entry.name === 'ScoreAbsorber')).toBe(false);
    });

    test('keeps tied winners together and uses competition ranking below them', () => {
        const entries = rankPodiumPlayers({
            gameWinner: 'Alice & Bob',
            finalScores: { Alice: 118, Bob: 118, Cara: 80, Drew: 80 }
        });

        expect(entries.filter(entry => entry.isWinner).map(entry => entry.rank)).toEqual([1, 1]);
        expect(entries.filter(entry => !entry.isWinner).map(entry => entry.rank)).toEqual([3, 3]);
    });

    test('a forfeit cannot leave the forfeiting high scorer on the top step', () => {
        const entries = rankPodiumPlayers({
            gameWinner: 'Bob & Cara',
            finalScores: { Alice: 150, Bob: 108, Cara: 97 },
            forfeit: { forfeitingPlayerName: 'Alice', reason: 'disconnect timeout' }
        });

        expect(entries.filter(entry => entry.isWinner).map(entry => entry.name)).toEqual(['Bob', 'Cara']);
        expect(entries.find(entry => entry.name === 'Alice')).toMatchObject({ isWinner: false, rank: 3 });
    });

    test('derives every top-score player for a generic tie label', () => {
        const entries = rankPodiumPlayers({
            gameWinner: '3-Way Tie',
            finalScores: { Alice: 120, Bob: 120, Cara: 120 }
        });

        expect(entries).toHaveLength(3);
        expect(entries.every(entry => entry.isWinner && entry.rank === 1)).toBe(true);
    });

    test('falls back to the top score while settlement winner copy is absent', () => {
        const entries = rankPodiumPlayers({
            finalScores: { Alice: 80, Bob: 121, Cara: 94 }
        });

        expect(entries[0]).toMatchObject({ name: 'Bob', isWinner: true, rank: 1 });
    });

    test('preserves an authoritative winner omitted from a partial score map', () => {
        const entries = rankPodiumPlayers({
            gameWinner: 'Cara',
            finalScores: { Alice: 140, Bob: null }
        });

        expect(entries[0]).toMatchObject({ name: 'Cara', score: null, isWinner: true, rank: 1 });
        expect(entries.find(entry => entry.name === 'Bob')).toMatchObject({ score: null });
    });
});

describe('GameOverPodium', () => {
    test('renders an accessible persistent three-player victory dialog', () => {
        const { container } = render(
            <GameOverPodium
                gameWinner="Cara"
                finalScores={baseScores}
                onRematch={vi.fn()}
                onLobby={vi.fn()}
            />
        );

        const dialog = screen.getByRole('dialog', { name: 'Cara Wins' });
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(screen.getByRole('heading', { name: 'Cara Wins' })).toBeInTheDocument();
        const standings = within(dialog).getByRole('list', { name: 'Final standings' });
        expect(within(standings).getAllByRole('listitem')).toHaveLength(3);
        expect(container.querySelector('[data-player-name="Cara"]')).toHaveAttribute('data-rank', '1');
        expect(container.querySelector('.game-over-podium__confetti')).toHaveAttribute('aria-hidden', 'true');
        expect(container.querySelectorAll('.game-over-podium__confetti-piece')).toHaveLength(16);
        expect(screen.getByRole('button', { name: 'Rematch' })).toHaveFocus();
    });

    test('contains long names in a four-player podium while preserving the full title', () => {
        const longName = 'Bartholomew-With-An-Exceptionally-Long-Name';
        const { container } = render(
            <GameOverPodium
                gameWinner={longName}
                finalScores={{
                    [longName]: 140,
                    Alice: 110,
                    Bob: 92,
                    Cara: 75
                }}
                onRematch={vi.fn()}
                onLobby={vi.fn()}
            />
        );

        const name = screen.getByTitle(longName);
        expect(name).toHaveClass('game-over-podium__name');
        expect(container.querySelectorAll('.game-over-podium__contestant')).toHaveLength(4);
        expect(container.querySelector('.game-over-podium__stage').style.getPropertyValue('--podium-count')).toBe('4');
    });

    test('shows forfeit-safe shared winners and the forfeiture context', () => {
        const { container } = render(
            <GameOverPodium
                gameWinner="Bob & Cara"
                finalScores={{ Alice: 150, Bob: 108, Cara: 97 }}
                forfeit={{ forfeitingPlayerName: 'Alice', reason: 'voluntary forfeit' }}
                onRematch={vi.fn()}
                onLobby={vi.fn()}
            />
        );

        expect(screen.getByRole('heading', { name: 'Victory by Forfeit' })).toBeInTheDocument();
        expect(screen.getByText('Alice forfeited. Bob & Cara take the top step.')).toBeInTheDocument();
        expect(container.querySelector('[data-player-name="Bob"]')).toHaveAttribute('data-rank', '1');
        expect(container.querySelector('[data-player-name="Cara"]')).toHaveAttribute('data-rank', '1');
        expect(container.querySelector('[data-player-name="Alice"]')).toHaveAttribute('data-rank', '3');
    });

    test('invokes the explicit Rematch and Lobby actions', async () => {
        const user = userEvent.setup();
        const onRematch = vi.fn();
        const onLobby = vi.fn();
        const firstRender = render(
            <GameOverPodium
                gameWinner="Cara"
                finalScores={baseScores}
                onRematch={onRematch}
                onLobby={onLobby}
            />
        );

        await user.click(screen.getByRole('button', { name: 'Rematch' }));
        expect(onRematch).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('button', { name: 'Lobby' })).toBeDisabled();
        firstRender.unmount();

        render(
            <GameOverPodium
                gameWinner="Cara"
                finalScores={baseScores}
                onRematch={onRematch}
                onLobby={onLobby}
            />
        );
        await user.click(screen.getByRole('button', { name: 'Lobby' }));
        expect(onLobby).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    test('locks both terminal actions after the first rapid choice', async () => {
        const user = userEvent.setup();
        const onRematch = vi.fn();
        const onLobby = vi.fn();
        render(
            <GameOverPodium
                gameWinner="Cara"
                finalScores={baseScores}
                onRematch={onRematch}
                onLobby={onLobby}
            />
        );

        const rematch = screen.getByRole('button', { name: 'Rematch' });
        await user.dblClick(rematch);
        expect(onRematch).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('button', { name: 'Lobby' })).toBeDisabled();
        expect(onLobby).not.toHaveBeenCalled();
    });

    test('releases a rejected Rematch submission after authoritative readiness changes', async () => {
        const user = userEvent.setup();
        const onRematch = vi.fn();
        const onLobby = vi.fn();
        const { rerender } = render(
            <GameOverPodium
                gameWinner="Cara"
                finalScores={baseScores}
                onRematch={onRematch}
                onLobby={onLobby}
            />
        );

        await user.click(screen.getByRole('button', { name: 'Rematch' }));
        expect(onRematch).toHaveBeenCalledTimes(1);

        rerender(
            <GameOverPodium
                gameWinner="Cara"
                finalScores={baseScores}
                onRematch={onRematch}
                onLobby={onLobby}
                actionsDisabled
            />
        );
        expect(screen.getByRole('button', { name: 'Rematch' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Lobby' })).toBeEnabled();

        rerender(
            <GameOverPodium
                gameWinner="Cara"
                finalScores={baseScores}
                onRematch={onRematch}
                onLobby={onLobby}
                actionsDisabled={false}
            />
        );
        await user.click(screen.getByRole('button', { name: 'Rematch' }));
        expect(onRematch).toHaveBeenCalledTimes(2);
    });

    test('has no auto-dismiss timer', () => {
        vi.useFakeTimers();
        render(
            <GameOverPodium
                gameWinner="Cara"
                finalScores={baseScores}
                onRematch={vi.fn()}
                onLobby={vi.fn()}
            />
        );

        act(() => vi.advanceTimersByTime(10 * 60 * 1000));
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        vi.useRealTimers();
    });

    test('can stay unmounted until the terminal state is ready', () => {
        const { container } = render(
            <GameOverPodium
                show={false}
                gameWinner="Cara"
                finalScores={baseScores}
                onRematch={vi.fn()}
                onLobby={vi.fn()}
            />
        );

        expect(container).toBeEmptyDOMElement();
    });

    test('shows settlement status and disables rematch when no safe callback is available', () => {
        render(
            <GameOverPodium
                gameWinner="Cara"
                finalScores={baseScores}
                statusMessage="Final settlement needs administrator review."
                onLobby={vi.fn()}
            />
        );

        expect(screen.getByRole('status')).toHaveTextContent('administrator review');
        expect(screen.getByRole('button', { name: 'Rematch' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Lobby' })).toBeEnabled();
    });
});
