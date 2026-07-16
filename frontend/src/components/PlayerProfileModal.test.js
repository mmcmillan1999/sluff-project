import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getPlayerProfile } from '../services/api';
import PlayerProfileModal from './PlayerProfileModal';

vi.mock('../services/api', () => ({
    getPlayerProfile: vi.fn(),
}));

const opponentProfile = {
    player: {
        username: 'River Ace',
        wins: 8,
        losses: 5,
        washes: 1,
        totalGames: 14,
        winRate: 57.1,
    },
    headToHead: {
        isSelf: false,
        gamesPlayed: 8,
        wins: 5,
        losses: 2,
        ties: 1,
        winRate: 62.5,
    },
};

beforeEach(() => {
    vi.clearAllMocks();
    getPlayerProfile.mockResolvedValue(opponentProfile);
});

test('shows career and head-to-head records for another player', async () => {
    render(
        <PlayerProfileModal
            playerName="River Ace"
            currentUsername="Me"
            onClose={vi.fn()}
        />,
    );

    expect(screen.getByRole('dialog', { name: 'Player profile for River Ace' })).toBeInTheDocument();
    expect(screen.getByText('Shuffling the record book…')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'River Ace' })).toBeInTheDocument();
    expect(screen.getByText('62.5%')).toBeInTheDocument();
    expect(screen.getByText('Your win rate against River Ace')).toBeInTheDocument();
    expect(screen.getByText('Ties')).toBeInTheDocument();
});

test('uses a self profile state without inventing a comparison record', async () => {
    getPlayerProfile.mockResolvedValue({
        player: {
            username: 'Me',
            wins: 0,
            losses: 0,
            washes: 0,
            totalGames: 0,
            winRate: null,
        },
        headToHead: {
            isSelf: true,
            gamesPlayed: 0,
            wins: 0,
            losses: 0,
            ties: 0,
            winRate: null,
        },
    });

    render(
        <PlayerProfileModal
            playerName="Me"
            currentUsername="Me"
            onClose={vi.fn()}
        />,
    );

    expect(await screen.findByText('Your Sluff profile')).toBeInTheDocument();
    expect(screen.getByText('Fresh to the table')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText(/This is your public table record/)).toBeInTheDocument();
    expect(screen.queryByText('Your matchup')).not.toBeInTheDocument();
});

test('explains an empty matchup instead of displaying a misleading zero-percent rate', async () => {
    getPlayerProfile.mockResolvedValue({
        ...opponentProfile,
        headToHead: {
            isSelf: false,
            gamesPlayed: 0,
            wins: 0,
            losses: 0,
            ties: 0,
            winRate: null,
        },
    });

    render(
        <PlayerProfileModal
            playerName="River Ace"
            currentUsername="Me"
            onClose={vi.fn()}
        />,
    );

    expect(await screen.findByText('No shared games yet')).toBeInTheDocument();
    expect(screen.queryByText('0.0%')).not.toBeInTheDocument();
});

test('offers a retry after an API error and closes with Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    getPlayerProfile
        .mockRejectedValueOnce(new Error('The record book is sleeping.'))
        .mockResolvedValueOnce(opponentProfile);

    render(
        <PlayerProfileModal
            playerName="River Ace"
            currentUsername="Me"
            onClose={onClose}
        />,
    );

    expect(await screen.findByText('The record book is sleeping.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'River Ace' })).toBeInTheDocument();
    expect(getPlayerProfile).toHaveBeenCalledTimes(2);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
});
