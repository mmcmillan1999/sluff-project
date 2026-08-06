import React from 'react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GameOverPodium, { normalizeTokenSettlement, rankPodiumPlayers } from './GameOverPodium';

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

describe('normalizeTokenSettlement', () => {
    test('shows funded players the same way regardless of internal player type', () => {
        expect(normalizeTokenSettlement({
            buyInCents: 10,
            potCents: 20,
            entries: [
                {
                    playerName: 'Alice',
                    isBot: false,
                    funded: true,
                    grossReturnCents: 20,
                    netChangeCents: 10,
                    tokenOutcome: 'wins'
                },
                {
                    playerName: 'Mike Knight',
                    isBot: true,
                    funded: true,
                    grossReturnCents: 10,
                    netChangeCents: 0,
                    tokenOutcome: 'even'
                }
            ]
        })).toEqual({
            available: true,
            buyInCents: 10,
            potCents: 20,
            entries: [
                {
                    playerName: 'Alice',
                    funded: true,
                    available: true,
                    grossReturnCents: 20,
                    netChangeCents: 10,
                    outcomeLabel: 'Token gain'
                },
                {
                    playerName: 'Mike Knight',
                    funded: true,
                    available: true,
                    grossReturnCents: 10,
                    netChangeCents: 0,
                    outcomeLabel: 'Even'
                }
            ]
        });
    });

    test('uses neutral transaction copy for an entry without a funded buy-in', () => {
        const settlement = normalizeTokenSettlement({
            buyInCents: 10,
            potCents: 20,
            entries: [{
                playerName: 'Courtney Sr.',
                isBot: true,
                funded: false,
                grossReturnCents: 0,
                netChangeCents: 0,
                tokenOutcome: 'not_funded'
            }]
        });

        expect(settlement.entries[0]).toEqual({
            playerName: 'Courtney Sr.',
            funded: false,
            available: true,
            outcomeLabel: 'Even'
        });
    });

    test('distinguishes an absent settlement from failed settlement data', () => {
        expect(normalizeTokenSettlement()).toBeNull();
        expect(normalizeTokenSettlement({ status: 'failed' })).toEqual({
            available: false,
            entries: []
        });
    });

    test('labels a funded partial recovery without calling it no return', () => {
        const settlement = normalizeTokenSettlement({
            buyInCents: 100,
            potCents: 400,
            entries: [{
                playerName: 'Bob',
                funded: true,
                grossReturnCents: 50,
                netChangeCents: -50,
                tokenOutcome: 'loss'
            }]
        });

        expect(settlement.entries[0].outcomeLabel).toBe('Partial return');
    });
});

describe('GameOverPodium', () => {
    test('shows a funded automated player as an ordinary token transaction', () => {
        render(
            <GameOverPodium
                gameWinner="Mike Knight"
                finalScores={{ 'Mike Knight': 160, Alice: 80, Bob: -4 }}
                tokenSettlement={{
                    buyInCents: 10,
                    potCents: 30,
                    entries: [
                        {
                            playerName: 'Mike Knight',
                            isBot: true,
                            funded: true,
                            grossReturnCents: 20,
                            netChangeCents: 10,
                            tokenOutcome: 'gain'
                        },
                        {
                            playerName: 'Alice',
                            isBot: false,
                            funded: true,
                            grossReturnCents: 10,
                            netChangeCents: 0,
                            tokenOutcome: 'even'
                        },
                        {
                            playerName: 'Bob',
                            isBot: false,
                            funded: true,
                            grossReturnCents: 0,
                            netChangeCents: -10,
                            tokenOutcome: 'losses'
                        }
                    ]
                }}
                onRematch={vi.fn()}
                onLobby={vi.fn()}
            />
        );

        expect(screen.getByRole('heading', { name: 'Mike Knight Wins' })).toBeInTheDocument();
        const settlement = screen.getByRole('region', { name: 'Token settlement' });
        expect(within(settlement).getByText('0.10 tokens buy-in · 0.30 tokens pot')).toBeInTheDocument();
        const results = within(settlement).getByRole('list', { name: 'Token settlement results' });
        const rows = within(results).getAllByRole('listitem');
        expect(rows).toHaveLength(3);
        expect(within(rows[0]).getByText('Token gain')).toBeInTheDocument();
        expect(within(rows[0]).getByText('0.20 tokens returned · net +0.10 tokens')).toBeInTheDocument();
        expect(within(rows[1]).getByText('Even')).toBeInTheDocument();
        expect(within(rows[1]).getByText('0.10 tokens returned · net 0.00 tokens')).toBeInTheDocument();
        expect(within(rows[2]).getByText('No return')).toBeInTheDocument();
        expect(within(rows[2]).getByText('0.00 tokens returned · net -0.10 tokens')).toBeInTheDocument();
        expect(within(settlement).queryByText(/practice|bot/i)).not.toBeInTheDocument();
    });

    test('uses neutral zero-change copy for a settlement entry without a buy-in', () => {
        render(
            <GameOverPodium
                gameWinner="Alice"
                finalScores={{ Alice: 120, 'Courtney Sr.': 80 }}
                tokenSettlement={{
                    buyInCents: 10,
                    potCents: 10,
                    entries: [
                        {
                            playerName: 'Alice',
                            funded: true,
                            grossReturnCents: 10,
                            netChangeCents: 0,
                            tokenOutcome: 'even'
                        },
                        {
                            playerName: 'Courtney Sr.',
                            isBot: true,
                            funded: false,
                            grossReturnCents: 0,
                            netChangeCents: 0,
                            tokenOutcome: 'not_funded'
                        }
                    ]
                }}
                onRematch={vi.fn()}
                onLobby={vi.fn()}
            />
        );

        const settlement = screen.getByRole('region', { name: 'Token settlement' });
        const rows = within(settlement).getAllByRole('listitem');
        expect(within(rows[1]).getByText('Even')).toBeInTheDocument();
        expect(within(rows[1]).getByText('No token change')).toBeInTheDocument();
        expect(within(settlement).queryByText(/practice|bot|funded/i)).not.toBeInTheDocument();
    });

    test('omits an absent token settlement and reports supplied failed data without guessing', () => {
        const { rerender } = render(
            <GameOverPodium
                gameWinner="Cara"
                finalScores={baseScores}
                onRematch={vi.fn()}
                onLobby={vi.fn()}
            />
        );

        expect(screen.queryByRole('region', { name: 'Token settlement' })).not.toBeInTheDocument();

        rerender(
            <GameOverPodium
                gameWinner="Cara"
                finalScores={baseScores}
                tokenSettlement={{ status: 'failed' }}
                onRematch={vi.fn()}
                onLobby={vi.fn()}
            />
        );

        const settlement = screen.getByRole('region', { name: 'Token settlement' });
        expect(within(settlement).getByRole('status')).toHaveTextContent('unavailable');
        expect(within(settlement).queryByText(/NaN|undefined|Infinity/)).not.toBeInTheDocument();
    });

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

    test('shows the rematch offer roster and turns the primary action into Accept', async () => {
        const user = userEvent.setup();
        const onRematch = vi.fn();
        render(
            <GameOverPodium
                gameWinner="Cara"
                finalScores={baseScores}
                onRematch={onRematch}
                onLobby={vi.fn()}
                selfPlayerName="Alice"
                rematchOffer={{
                    isActive: true,
                    initiator: 'Bob',
                    votes: { Alice: null, Bob: 'accept', Cara: null },
                    resolution: null,
                    cancelReason: null
                }}
            />
        );

        expect(screen.getByText(/offered a rematch/i)).toBeInTheDocument();
        const roster = screen.getByRole('list', { name: 'Rematch acceptances' });
        expect(within(roster).getByText('✓ In')).toBeInTheDocument();
        expect(within(roster).getAllByText('Waiting…')).toHaveLength(2);

        await user.click(screen.getByRole('button', { name: 'Accept Rematch' }));
        expect(onRematch).toHaveBeenCalledTimes(1);
    });

    test('parks the primary action while waiting on other acceptances', () => {
        render(
            <GameOverPodium
                gameWinner="Cara"
                finalScores={baseScores}
                onRematch={vi.fn()}
                onLobby={vi.fn()}
                selfPlayerName="Alice"
                rematchOffer={{
                    isActive: true,
                    initiator: 'Alice',
                    votes: { Alice: 'accept', Bob: null, Cara: null },
                    resolution: null,
                    cancelReason: null
                }}
            />
        );

        expect(screen.getByRole('button', { name: 'Waiting for players…' })).toBeDisabled();
    });

    test('announces a dead offer and allows a fresh rematch request', () => {
        render(
            <GameOverPodium
                gameWinner="Cara"
                finalScores={baseScores}
                onRematch={vi.fn()}
                onLobby={vi.fn()}
                selfPlayerName="Alice"
                rematchOffer={{
                    isActive: false,
                    initiator: 'Alice',
                    votes: { Alice: 'accept', Bob: 'decline', Cara: null },
                    resolution: 'declined',
                    cancelReason: 'Bob declined the rematch.'
                }}
            />
        );

        expect(screen.getByText(/Bob declined the rematch\./)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Rematch' })).toBeEnabled();
    });

    test('requires a voice-disconnect confirmation before leaving when voice is active', async () => {
        const user = userEvent.setup();
        const onLobby = vi.fn();
        render(
            <GameOverPodium
                gameWinner="Cara"
                finalScores={baseScores}
                onRematch={vi.fn()}
                onLobby={onLobby}
                voiceActive
            />
        );

        await user.click(screen.getByRole('button', { name: 'Lobby' }));
        expect(onLobby).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toHaveTextContent(/disconnects you from voice chat/i);

        await user.click(screen.getByRole('button', { name: 'Stay' }));
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(onLobby).not.toHaveBeenCalled();

        await user.click(screen.getByRole('button', { name: 'Lobby' }));
        await user.click(screen.getByRole('button', { name: 'Leave anyway' }));
        expect(onLobby).toHaveBeenCalledTimes(1);
    });

    test('leaves immediately without a warning when voice is not active', async () => {
        const user = userEvent.setup();
        const onLobby = vi.fn();
        render(
            <GameOverPodium
                gameWinner="Cara"
                finalScores={baseScores}
                onRematch={vi.fn()}
                onLobby={onLobby}
            />
        );

        await user.click(screen.getByRole('button', { name: 'Lobby' }));
        expect(onLobby).toHaveBeenCalledTimes(1);
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

    const roundHistory = [
        { roundNumber: 1, bidType: 'Solo', bidderName: 'Cara', bidderCardPoints: 72, dealExecuted: false, pointChanges: { Cara: 24, Alice: -12, Bob: -12 } },
        { roundNumber: 2, bidType: 'Frog', bidderName: 'Alice', bidderCardPoints: 55, dealExecuted: true, pointChanges: { Alice: -8, Bob: 4, Cara: 4 } },
    ];

    test('shows a collapsed round-by-round panel that expands with per-player deltas', async () => {
        const user = userEvent.setup();
        render(
            <GameOverPodium
                gameWinner="Cara"
                finalScores={baseScores}
                roundHistory={roundHistory}
                onRematch={vi.fn()}
                onLobby={vi.fn()}
            />
        );

        const toggle = screen.getByRole('button', { name: /Round-by-round/ });
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('table')).not.toBeInTheDocument();

        await user.click(toggle);
        expect(toggle).toHaveAttribute('aria-expanded', 'true');

        const table = screen.getByRole('table');
        // Column order follows the podium standings (Cara, Alice, Bob)
        const headers = within(table).getAllByRole('columnheader').map(h => h.textContent);
        expect(headers).toEqual(['Rd', 'Bid', 'Cara', 'Alice', 'Bob']);
        expect(within(table).getByText('+24')).toBeInTheDocument();
        expect(within(table).queryByText('H.Solo')).not.toBeInTheDocument();
        expect(within(table).getByText('Solo')).toBeInTheDocument();
        expect(within(table).getByText('Frog')).toBeInTheDocument();
        // Insurance marker present on the dealt round
        expect(within(table).getByLabelText('insurance deal')).toBeInTheDocument();
    });

    test('omits the round-by-round panel when no history is provided', () => {
        render(
            <GameOverPodium
                gameWinner="Cara"
                finalScores={baseScores}
                onRematch={vi.fn()}
                onLobby={vi.fn()}
            />
        );
        expect(screen.queryByRole('button', { name: /Round-by-round/ })).not.toBeInTheDocument();
    });

    test('honors Midnight Special riders on the podium and in the history', async () => {
        const user = userEvent.setup();
        const riddenHistory = [
            { roundNumber: 1, bidType: 'Solo', bidderName: 'Cara', bidderCardPoints: 72, dealExecuted: false, pointChanges: { Cara: 24, Alice: -12, Bob: -12 }, midnightSpecial: 'Cara' },
            { roundNumber: 2, bidType: 'Frog', bidderName: 'Alice', bidderCardPoints: 55, dealExecuted: false, pointChanges: { Alice: -8, Bob: 4, Cara: 4 } },
            { roundNumber: 3, bidType: 'Heart Solo', bidderName: 'Cara', bidderCardPoints: 80, dealExecuted: false, pointChanges: { Cara: 30, Alice: -15, Bob: -15 }, midnightSpecial: 'Cara' },
        ];
        render(
            <GameOverPodium
                gameWinner="Cara"
                finalScores={baseScores}
                roundHistory={riddenHistory}
                onRematch={vi.fn()}
                onLobby={vi.fn()}
            />
        );

        // Cara rode twice: her podium step wears the train with a tally.
        const badge = screen.getByLabelText('Rode the Midnight Special 2 times');
        expect(badge).toHaveTextContent('🚂 ×2');
        // Nobody else gets a badge for zero rides.
        expect(screen.queryByLabelText('Rode the Midnight Special')).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /Round-by-round/ }));
        const table = screen.getByRole('table');
        expect(within(table).getAllByLabelText('Cara rode the Midnight Special')).toHaveLength(2);
    });

    test('omits the ride badge entirely when no round had a Special', () => {
        render(
            <GameOverPodium
                gameWinner="Cara"
                finalScores={baseScores}
                roundHistory={roundHistory}
                onRematch={vi.fn()}
                onLobby={vi.fn()}
            />
        );
        expect(screen.queryByLabelText(/Rode the Midnight Special/)).not.toBeInTheDocument();
    });
});

describe('GameOverPodium stings', () => {
    const scores = { Cara: 127, Alice: 104, Bob: 91 };

    test('the sole real winner is greeted with the champion sting, once', () => {
        const playSound = vi.fn();
        const { rerender } = render(
            <GameOverPodium
                gameWinner="Cara"
                finalScores={scores}
                selfPlayerName="Cara"
                playSound={playSound}
            />
        );
        expect(playSound).toHaveBeenCalledTimes(1);
        expect(playSound).toHaveBeenCalledWith('podiumWin');

        rerender(
            <GameOverPodium
                gameWinner="Cara"
                finalScores={scores}
                selfPlayerName="Cara"
                playSound={playSound}
                statusMessage="Settled."
            />
        );
        expect(playSound).toHaveBeenCalledTimes(1);
    });

    test('the champion sting prefers the personalized line when provided', () => {
        const playSound = vi.fn();
        const playChampionSting = vi.fn();
        render(
            <GameOverPodium
                gameWinner="Cara"
                finalScores={scores}
                selfPlayerName="Cara"
                playSound={playSound}
                playChampionSting={playChampionSting}
            />
        );
        expect(playChampionSting).toHaveBeenCalledTimes(1);
        expect(playSound).not.toHaveBeenCalled();
    });

    test('a victory by forfeit gets no champion fanfare', () => {
        const playSound = vi.fn();
        render(
            <GameOverPodium
                gameWinner="Cara & Alice"
                finalScores={scores}
                forfeit={{ forfeitingPlayerName: 'Bob' }}
                selfPlayerName="Cara"
                playSound={playSound}
            />
        );
        expect(playSound).not.toHaveBeenCalled();
    });

    test('a shared victory stays quiet — the line is written for one champion', () => {
        const playSound = vi.fn();
        render(
            <GameOverPodium
                gameWinner="Cara & Alice"
                finalScores={{ Cara: 127, Alice: 127, Bob: 66 }}
                selfPlayerName="Cara"
                playSound={playSound}
            />
        );
        expect(playSound).not.toHaveBeenCalled();
    });

    test('plays once for the local player who lost, and only once', () => {
        const playSound = vi.fn();
        const { rerender } = render(
            <GameOverPodium
                gameWinner="Cara"
                finalScores={scores}
                selfPlayerName="Bob"
                playSound={playSound}
            />
        );
        expect(playSound).toHaveBeenCalledTimes(1);
        expect(playSound).toHaveBeenCalledWith('podiumLoss');

        rerender(
            <GameOverPodium
                gameWinner="Cara"
                finalScores={scores}
                selfPlayerName="Bob"
                playSound={playSound}
                statusMessage="Settled."
            />
        );
        expect(playSound).toHaveBeenCalledTimes(1);
    });

    test('a spectator with no entry of their own hears nothing', () => {
        const playSound = vi.fn();
        render(
            <GameOverPodium
                gameWinner="Cara"
                finalScores={scores}
                selfPlayerName={null}
                playSound={playSound}
            />
        );
        expect(playSound).not.toHaveBeenCalled();
    });

    test('the wash player (2nd of 3) is spared — only dead last is stung', () => {
        const playSound = vi.fn();
        render(
            <GameOverPodium
                gameWinner="Cara"
                finalScores={scores}
                selfPlayerName="Alice"
                playSound={playSound}
            />
        );
        expect(playSound).not.toHaveBeenCalled();
    });

    test('in 4-player only 4th place is stung, not 2nd or 3rd', () => {
        const fourScores = { Cara: 140, Alice: 118, Bob: 102, Dana: 66 };
        for (const [name, expected] of [['Alice', 0], ['Bob', 0], ['Dana', 1]]) {
            const playSound = vi.fn();
            const { unmount } = render(
                <GameOverPodium
                    gameWinner="Cara"
                    finalScores={fourScores}
                    selfPlayerName={name}
                    playSound={playSound}
                />
            );
            expect(playSound).toHaveBeenCalledTimes(expected);
            unmount();
        }
    });

    test('a shared bottom rank stays silent for both', () => {
        const tiedBottom = { Cara: 150, Alice: 85, Bob: 85 };
        for (const name of ['Alice', 'Bob']) {
            const playSound = vi.fn();
            const { unmount } = render(
                <GameOverPodium
                    gameWinner="Cara"
                    finalScores={tiedBottom}
                    selfPlayerName={name}
                    playSound={playSound}
                />
            );
            expect(playSound).not.toHaveBeenCalled();
            unmount();
        }
    });

    test('the forfeiter is spared the needle', () => {
        // A voluntary forfeiter stays seated and sees this podium; every
        // other player is ranked a winner, so without the explicit guard
        // they would be the one non-winner and get stung on their way out.
        const playSound = vi.fn();
        render(
            <GameOverPodium
                gameWinner="Cara & Alice"
                finalScores={scores}
                forfeit={{ forfeitingPlayerName: 'Bob' }}
                selfPlayerName="Bob"
                playSound={playSound}
            />
        );
        expect(playSound).not.toHaveBeenCalled();
    });

    test('a full tie shames nobody', () => {
        const playSound = vi.fn();
        render(
            <GameOverPodium
                gameWinner="3-Way Tie"
                finalScores={{ Cara: 100, Alice: 100, Bob: 100 }}
                selfPlayerName="Bob"
                playSound={playSound}
            />
        );
        expect(playSound).not.toHaveBeenCalled();
    });

    test('waits for the podium to actually show', () => {
        const playSound = vi.fn();
        const { rerender } = render(
            <GameOverPodium
                show={false}
                gameWinner="Cara"
                finalScores={scores}
                selfPlayerName="Bob"
                playSound={playSound}
            />
        );
        expect(playSound).not.toHaveBeenCalled();

        rerender(
            <GameOverPodium
                show
                gameWinner="Cara"
                finalScores={scores}
                selfPlayerName="Bob"
                playSound={playSound}
            />
        );
        expect(playSound).toHaveBeenCalledTimes(1);
    });
});
