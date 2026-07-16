import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getSeason, getSeasons } from '../services/api';
import BulletinView from './BulletinView';

vi.mock('../services/api', () => ({
    getSeason: vi.fn(),
    getSeasons: vi.fn(),
}));

beforeEach(() => {
    vi.clearAllMocks();
    getSeasons.mockResolvedValue({ seasons: [] });
});

describe('BulletinView', () => {
    test('keeps the pre-rollover copy provisional while celebrating McSaddle', () => {
        render(<BulletinView onReturnToLobby={() => {}} />);

        expect(screen.getByRole('heading', { name: /nearing its official close/i })).toBeInTheDocument();
        expect(screen.getByText('McSaddle')).toBeInTheDocument();
        expect(screen.getAllByText('See archive')).toHaveLength(3);
        expect(screen.getByText(/only after the season is safely frozen/i)).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /nearing its official close/i })).toHaveFocus();
    });

    test('shows finalized podium names from the archive and opens Season Recaps', async () => {
        const user = userEvent.setup();
        const onOpenSeasonRecaps = vi.fn();
        getSeasons.mockResolvedValue({
            seasons: [{ slug: 'alpha-season-1', name: 'Alpha Season 1', finalizedAt: '2026-07-16T00:00:00Z' }],
        });
        getSeason.mockResolvedValue({
            season: { slug: 'alpha-season-1', name: 'Alpha Season 1', finalizedAt: '2026-07-16T00:00:00Z' },
            podium: [
                { rank: 1, displayName: 'McSaddle' },
                { rank: 2, displayName: 'Lady Liberty' },
                { rank: 3, displayName: 'Frog Baron' },
            ],
            standings: [],
        });

        render(<BulletinView onReturnToLobby={() => {}} onOpenSeasonRecaps={onOpenSeasonRecaps} />);

        expect(await screen.findByRole('group', { name: 'Alpha Season 1 final podium' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /belongs in the history books/i })).toBeInTheDocument();
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
