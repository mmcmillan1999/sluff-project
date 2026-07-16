import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getSeason, getSeasons } from '../services/api';
import SeasonRecapsView from './SeasonRecapsView';

vi.mock('../services/api', () => ({
    getSeason: vi.fn(),
    getSeasons: vi.fn(),
}));

const alphaOne = {
    id: 1,
    slug: 'alpha-season-1',
    name: 'Alpha Season 1',
    finalizedAt: '2026-07-15T18:00:00.000Z',
    playerCount: 4,
    rankingMethod: 'wallet_balance',
    rankingLabel: 'Final tokens',
};

const alphaZero = {
    id: 0,
    slug: 'alpha-preview',
    name: 'Alpha Preview',
    finalizedAt: '2026-06-01T18:00:00.000Z',
    playerCount: 1,
    rankingMethod: 'wallet_balance',
    rankingLabel: 'Final tokens',
};

const standings = [
    { rank: 1, displayName: 'McSaddle', wins: 9, losses: 2, washes: 1, gamesPlayed: 12, rankingTokens: 8, walletTokens: 16 },
    { rank: 2, displayName: 'Lady Liberty', wins: 7, losses: 4, washes: 0, gamesPlayed: 11, rankingTokens: 5, walletTokens: 13 },
    { rank: 3, displayName: 'Frog Baron', wins: 6, losses: 5, washes: 1, gamesPlayed: 12, rankingTokens: -1, walletTokens: 7 },
    { rank: 4, displayName: 'Oakley Ace', wins: 3, losses: 8, washes: 0, gamesPlayed: 11, rankingTokens: -4, walletTokens: 4 },
];

beforeEach(() => {
    vi.clearAllMocks();
    getSeasons.mockResolvedValue({ seasons: [alphaZero, alphaOne] });
    getSeason.mockImplementation(async slug => {
        if (slug === alphaOne.slug) return { season: alphaOne, podium: standings.slice(0, 3), standings };
        return {
            season: alphaZero,
            podium: [standings[0]],
            standings: [standings[0]],
        };
    });
});

test('opens the newest finalized season with a 2-1-3 podium and complete frozen standings', async () => {
    render(<SeasonRecapsView onReturnToLobby={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Season Recaps' })).toHaveFocus();
    expect(await screen.findByRole('heading', { name: 'Alpha Season 1' })).toBeInTheDocument();
    expect(getSeason).toHaveBeenCalledWith('alpha-season-1');

    const podium = screen.getByRole('list', { name: 'Alpha Season 1 final podium' });
    const podiumNames = within(podium).getAllByRole('listitem').map(item => item.querySelector('strong').textContent);
    expect(podiumNames).toEqual(['McSaddle', 'Lady Liberty', 'Frog Baron']);
    expect(within(podium).getAllByRole('listitem').map(item => item.className)).toEqual([
        expect.stringContaining('place-1'),
        expect.stringContaining('place-2'),
        expect.stringContaining('place-3'),
    ]);

    const frozenScoreboard = screen.getByRole('heading', { name: 'Frozen scoreboard' }).closest('section');
    expect(within(frozenScoreboard).getByText('4 records')).toBeInTheDocument();
    expect(within(frozenScoreboard).getByText('Oakley Ace')).toBeInTheDocument();
    expect(within(frozenScoreboard).queryByText('Wallet 4.00')).not.toBeInTheDocument();
    expect(screen.getByText(/Ranked by final wallet balance/i)).toBeInTheDocument();
    expect(within(podium).getByText('8.00')).toBeInTheDocument();
    expect(within(podium).queryByText('+8.00')).not.toBeInTheDocument();
});

test('switches between legacy seasons by slug and returns to the lobby', async () => {
    const user = userEvent.setup();
    const onReturnToLobby = vi.fn();
    render(<SeasonRecapsView onReturnToLobby={onReturnToLobby} />);

    const selector = await screen.findByRole('combobox', { name: 'Completed season' });
    await user.selectOptions(selector, 'alpha-preview');
    await waitFor(() => expect(getSeason).toHaveBeenLastCalledWith('alpha-preview'));
    expect(await screen.findByRole('heading', { name: 'Alpha Preview' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Lobby' }));
    expect(onReturnToLobby).toHaveBeenCalledTimes(1);
});

test('offers a retry when the season index cannot be loaded', async () => {
    const user = userEvent.setup();
    getSeasons
        .mockRejectedValueOnce(new Error('Archive unavailable'))
        .mockResolvedValueOnce({ seasons: [alphaOne] });

    render(<SeasonRecapsView onReturnToLobby={vi.fn()} />);

    expect(await screen.findByText('Archive unavailable')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('heading', { name: 'Alpha Season 1' })).toBeInTheDocument();
    expect(getSeasons).toHaveBeenCalledTimes(2);
});

test('preserves unranked archived records without assigning a false position', async () => {
    getSeason.mockResolvedValue({
        season: alphaOne,
        podium: standings.slice(0, 3),
        standings: [
            ...standings,
            {
                rank: null,
                displayName: 'Quiet Card',
                wins: 0,
                losses: 0,
                washes: 0,
                gamesPlayed: 0,
                rankingTokens: 0,
                walletTokens: 8,
            },
        ],
    });

    render(<SeasonRecapsView onReturnToLobby={vi.fn()} />);

    expect(await screen.findByText('Quiet Card')).toBeInTheDocument();
    expect(screen.getByLabelText('Unranked')).toHaveTextContent('—');
    expect(screen.getByText(/Unranked · 0W/i)).toBeInTheDocument();
});
