import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getCurrentSeasonStandings, getLeaderboard, getPlayerProfile } from '../services/api';
import LeaderboardView from './LeaderboardView';

vi.mock('../services/api', () => ({
    getCurrentSeasonStandings: vi.fn(),
    getLeaderboard: vi.fn(),
    getPlayerProfile: vi.fn(),
}));

beforeEach(() => {
    vi.clearAllMocks();
    getCurrentSeasonStandings.mockResolvedValue({
        season: {
            slug: 'alpha-season-2',
            name: 'Alpha Season 2',
            rankingMethod: 'game_token_net',
            rankingLabel: 'Season +/-',
        },
        standings: [
            {
                rank: 1,
                username: 'Mike Knight',
                wins: 4,
                losses: 2,
                washes: 0,
                gamesPlayed: 6,
                rankingTokens: 3,
                walletTokens: 11,
                isBot: true,
            },
            {
                rank: 2,
                username: 'Human Player',
                wins: 2,
                losses: 1,
                washes: 0,
                gamesPlayed: 3,
                rankingTokens: 1,
                walletTokens: 9,
                isBot: false,
            },
        ],
    });
    getLeaderboard.mockResolvedValue([
        {
            username: 'Mike Knight',
            wins: 4,
            losses: 2,
            washes: 0,
            tokens: '11.00',
            isBot: true,
        },
        {
            username: 'Human Player',
            wins: 2,
            losses: 1,
            washes: 0,
            tokens: '9.00',
            isBot: false,
        },
    ]);
    getPlayerProfile.mockResolvedValue({
        player: {
            username: 'Mike Knight',
            wins: 4,
            losses: 2,
            washes: 0,
            totalGames: 6,
            winRate: 66.7,
        },
        headToHead: {
            isSelf: false,
            gamesPlayed: 2,
            wins: 1,
            losses: 1,
            ties: 0,
            winRate: 50,
        },
    });
});

test('presents every competitor as an ordinary leaderboard player', async () => {
    render(
        <LeaderboardView
            user={{ username: 'Human Player', is_admin: false }}
            onReturnToLobby={vi.fn()}
        />,
    );

    const botName = await screen.findByText('Mike Knight');
    expect(screen.getByRole('heading', { name: 'Alpha Season 2' })).toBeInTheDocument();
    const botRow = botName.closest('tr');
    expect(within(botRow).queryByText(/bot/i)).not.toBeInTheDocument();
    expect(botName.closest('td')).toHaveAttribute('title', 'Mike Knight');

    const humanRows = screen.getAllByText('Human Player').map(node => node.closest('tr'));
    expect(humanRows.length).toBeGreaterThan(0);
    for (const humanRow of humanRows) {
        expect(within(humanRow).queryByLabelText('Bot player')).not.toBeInTheDocument();
    }
});

test('separates season movement from wallet value and labels inactive players unranked', async () => {
    getCurrentSeasonStandings.mockResolvedValue({
        season: { slug: 'alpha-season-2', name: 'Alpha Season 2', rankingMethod: 'game_token_net', rankingLabel: 'Season +/-' },
        standings: [{
            rank: null,
            username: 'Human Player',
            wins: 0,
            losses: 0,
            washes: 0,
            gamesPlayed: 0,
            rankingTokens: 0,
            walletTokens: 8,
        }],
    });

    render(
        <LeaderboardView
            user={{ username: 'Human Player', is_admin: false }}
            onReturnToLobby={vi.fn()}
        />,
    );

    expect(await screen.findByText('Unranked until 1 settled game')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Unranked').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Wallet 8.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Season +/-').length).toBeGreaterThan(0);
});

test('falls back to the legacy array leaderboard during a rolling deploy', async () => {
    getCurrentSeasonStandings.mockRejectedValue(new Error('Not found'));
    getLeaderboard.mockResolvedValue([
        {
            username: 'Mike Knight',
            wins: 4,
            losses: 2,
            washes: 0,
            tokens: '11.00',
        },
        {
            username: 'Human Player',
            wins: 0,
            losses: 0,
            washes: 0,
            tokens: '8.00',
            rank: null,
            rankingTokens: '0.00',
            walletTokens: '8.00',
        },
    ]);

    render(
        <LeaderboardView
            user={{ username: 'Human Player', is_admin: false }}
            onReturnToLobby={vi.fn()}
        />,
    );

    expect(await screen.findByRole('heading', { name: 'Live standings' })).toBeInTheDocument();
    expect(screen.getByText(/legacy standings while season records finish loading/i)).toBeInTheDocument();
    expect(screen.getAllByLabelText('Unranked').length).toBeGreaterThan(0);
    expect(getLeaderboard).toHaveBeenCalledTimes(1);
});

test('shows a season win rate column and colour-codes wins, losses and washes', async () => {
    const user = userEvent.setup();
    render(
        <LeaderboardView
            user={{ username: 'Human Player', is_admin: false }}
            onReturnToLobby={vi.fn()}
        />,
    );

    const botName = await screen.findByText('Mike Knight');
    expect(screen.getAllByRole('columnheader', { name: 'Win%' }).length).toBeGreaterThan(0);
    const botRow = botName.closest('tr');
    // 4 wins of 6 games: the win rate column, green.
    const winRate = within(botRow).getByText('67%');
    expect(winRate).toHaveClass('leaderboard-stat--win');
    // Totals view: each figure carries its colour class.
    expect(within(botRow).getByText('4')).toHaveClass('leaderboard-stat--win');
    expect(within(botRow).getByText('2')).toHaveClass('leaderboard-stat--loss');
    expect(within(botRow).getByText('0')).toHaveClass('leaderboard-stat--wash');

    // Percent view: every figure gets its own % sign, not only the last one.
    await user.click(screen.getByRole('button', { name: '%' }));
    expect(within(botRow).getByText('33%')).toHaveClass('leaderboard-stat--loss');
    expect(within(botRow).getByText('0%')).toHaveClass('leaderboard-stat--wash');
    expect(within(botRow).getAllByText('67%')).toHaveLength(2);
});

test('opens a player profile from a leaderboard name without exposing an account id', async () => {
    const user = userEvent.setup();
    render(
        <LeaderboardView
            user={{ username: 'Human Player', is_admin: false }}
            onReturnToLobby={vi.fn()}
        />,
    );

    await user.click(await screen.findByRole('button', { name: "View Mike Knight's player profile" }));

    expect(getPlayerProfile).toHaveBeenCalledWith('Mike Knight');
    expect(await screen.findByText('Your matchup')).toBeInTheDocument();
    expect(screen.getByText('50.0%')).toBeInTheDocument();
});

test('routes administrators to the guarded admin panel without a direct token reset', async () => {
    const handleShowAdmin = vi.fn();
    const user = userEvent.setup();
    render(
        <LeaderboardView
            user={{ username: 'Human Player', is_admin: true }}
            onReturnToLobby={vi.fn()}
            handleShowAdmin={handleShowAdmin}
        />,
    );

    await screen.findByText('Mike Knight');
    expect(screen.queryByRole('button', { name: /reset all tokens/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Admin Panel' }));
    expect(handleShowAdmin).toHaveBeenCalledOnce();
});
