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
    expect(screen.getAllByText('Lifetime')).toHaveLength(2);
    expect(screen.queryByText('Current season')).not.toBeInTheDocument();
});

test('shows current-season and lifetime matchup records together', async () => {
    getPlayerProfile.mockResolvedValue({
        ...opponentProfile,
        currentSeasonHeadToHead: {
            season: {
                id: 2,
                number: 2,
                slug: 'alpha-season-2',
                displayName: 'Alpha Season 2',
            },
            isSelf: false,
            gamesPlayed: 4,
            wins: 3,
            losses: 1,
            ties: 0,
            winRate: 75,
        },
    });

    render(
        <PlayerProfileModal
            playerName="River Ace"
            currentUsername="Me"
            onClose={vi.fn()}
        />,
    );

    expect(await screen.findByRole('heading', { name: 'River Ace' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Current season record against River Ace' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Lifetime record against River Ace' })).toBeInTheDocument();
    expect(screen.getByText('Current season and lifetime')).toBeInTheDocument();
    expect(screen.getByText('Alpha Season 2 · 4 games together')).toBeInTheDocument();
    expect(screen.getByText('75.0%')).toBeInTheDocument();
    expect(screen.getByText('Your current-season win rate against River Ace')).toBeInTheDocument();
    expect(screen.getByText('62.5%')).toBeInTheDocument();
    expect(screen.getByText('Your win rate against River Ace')).toBeInTheDocument();
});

test('shows a new-season empty state without hiding the lifetime matchup', async () => {
    getPlayerProfile.mockResolvedValue({
        ...opponentProfile,
        currentSeasonHeadToHead: {
            season: { displayName: 'Alpha Season 2' },
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

    expect(await screen.findByText('No shared games this season')).toBeInTheDocument();
    expect(screen.getByText('62.5%')).toBeInTheDocument();
    expect(screen.queryByText('0.0%')).not.toBeInTheDocument();
});

test('accepts a nested currentSeason matchup during a rolling deployment', async () => {
    getPlayerProfile.mockResolvedValue({
        ...opponentProfile,
        headToHead: {
            ...opponentProfile.headToHead,
            currentSeason: {
                season: { displayName: 'Alpha Season 2' },
                isSelf: false,
                gamesPlayed: 1,
                wins: 1,
                losses: 0,
                ties: 0,
                winRate: 100,
            },
        },
    });

    render(
        <PlayerProfileModal
            playerName="River Ace"
            currentUsername="Me"
            onClose={vi.fn()}
        />,
    );

    expect(await screen.findByText('100.0%')).toBeInTheDocument();
    expect(screen.getByText('Alpha Season 2 · 1 game together')).toBeInTheDocument();
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
