import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getCurrentSeasonStandings } from '../services/api';
import BulletinView from './BulletinView';

vi.mock('../services/api', () => ({
    getCurrentSeasonStandings: vi.fn(),
}));

beforeEach(() => {
    vi.clearAllMocks();
    getCurrentSeasonStandings.mockResolvedValue({
        season: { name: 'Alpha Season 2' },
        standings: [],
    });
});

describe('BulletinView', () => {
    test('welcomes players to Season 2 while preserving the Season 1 champion', async () => {
        render(<BulletinView onReturnToLobby={() => {}} />);

        expect(screen.getByRole('heading', { name: /season 2 is live/i })).toBeInTheDocument();
        expect(screen.getByText('McSaddle')).toBeInTheDocument();
        expect(await screen.findByRole('group', { name: 'Alpha Season 2 live top three' })).toBeInTheDocument();
        expect(screen.getAllByText('Up for grabs')).toHaveLength(3);
        expect(screen.getByRole('heading', { name: /season 2 is live/i })).toHaveFocus();
    });

    test('shows the live Season 2 podium and opens Season Recaps', async () => {
        const user = userEvent.setup();
        const onOpenSeasonRecaps = vi.fn();
        getCurrentSeasonStandings.mockResolvedValue({
            season: { name: 'Alpha Season 2' },
            standings: [
                { rank: 1, displayName: 'McSaddle' },
                { rank: 2, displayName: 'Lady Liberty' },
                { rank: 3, displayName: 'Frog Baron' },
            ],
        });

        render(<BulletinView onReturnToLobby={() => {}} onOpenSeasonRecaps={onOpenSeasonRecaps} />);

        expect(await screen.findByRole('group', { name: 'Alpha Season 2 live top three' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /season 2 is live/i })).toBeInTheDocument();
        expect(screen.getByText('Lady Liberty')).toBeInTheDocument();
        expect(screen.getByText('Frog Baron')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'View Season Recaps' }));
        expect(onOpenSeasonRecaps).toHaveBeenCalledTimes(1);
    });

    test('shows the development journal and returns to the lobby', async () => {
        const user = userEvent.setup();
        const onReturnToLobby = vi.fn();
        render(<BulletinView onReturnToLobby={onReturnToLobby} />);

        expect(screen.getByRole('heading', { name: /build so far/i })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Every token accounted for' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'The table comes alive' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'A safer foundation' })).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Lobby' }));
        expect(onReturnToLobby).toHaveBeenCalledTimes(1);
    });
});
