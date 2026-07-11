import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { getLeaderboard } from '../services/api';
import LeaderboardView from './LeaderboardView';

vi.mock('../services/api', () => ({
    getLeaderboard: vi.fn(),
}));

beforeEach(() => {
    vi.clearAllMocks();
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
});

test('labels persistent bot competitors without marking human players', async () => {
    render(
        <LeaderboardView
            user={{ username: 'Human Player', is_admin: false }}
            onReturnToLobby={vi.fn()}
        />,
    );

    const botName = await screen.findByText('Mike Knight');
    const botRow = botName.closest('tr');
    expect(within(botRow).getByLabelText('Bot player')).toHaveTextContent('BOT');
    expect(botName.closest('td')).toHaveAttribute('title', 'Mike Knight (Bot)');

    const humanRows = screen.getAllByText('Human Player').map(node => node.closest('tr'));
    expect(humanRows.length).toBeGreaterThan(0);
    for (const humanRow of humanRows) {
        expect(within(humanRow).queryByLabelText('Bot player')).not.toBeInTheDocument();
    }
});
