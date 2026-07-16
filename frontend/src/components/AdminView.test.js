import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminView from './AdminView';
import {
    applyAlpha2WalletReset,
    finalizeSeasonRollover,
    getAlpha2WalletResetPreview,
    getSeasonRolloverPreview,
} from '../services/api';

vi.mock('../services/api', () => ({
    getSeasonRolloverPreview: vi.fn(),
    finalizeSeasonRollover: vi.fn(),
    getAlpha2WalletResetPreview: vi.fn(),
    applyAlpha2WalletReset: vi.fn(),
}));

const preview = {
    season: { id: 1, slug: 'alpha-season-1', name: 'Alpha Season 1' },
    nextSeason: { id: 2, slug: 'alpha-season-2', name: 'Alpha Season 2' },
    standings: [
        { rank: 1, username: 'McSaddle' },
        { rank: 2, username: 'Ace High' },
        { rank: 3, username: 'Moonshot' },
        { rank: 4, username: 'Fourth Place' },
    ],
    podium: [
        { rank: 1, username: 'McSaddle' },
        { rank: 2, username: 'Ace High' },
        { rank: 3, username: 'Moonshot' },
    ],
    inProgressGames: 0,
    canFinalize: true,
    previewHash: 'season-one-preview-hash',
};

const renderAdmin = () => {
    const props = {
        onReturnToLobby: vi.fn(),
        handleHardReset: vi.fn(),
    };
    render(<AdminView {...props} />);
    return props;
};

describe('AdminView season rollover', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getSeasonRolloverPreview.mockResolvedValue(preview);
        finalizeSeasonRollover.mockResolvedValue({
            finalizedSeason: { id: 1, name: 'Alpha Season 1' },
            activeSeason: { id: 2, name: 'Alpha Season 2' },
        });
        getAlpha2WalletResetPreview.mockResolvedValue({});
        applyAlpha2WalletReset.mockResolvedValue({});
    });

    test('keeps the one-time wallet reset guarded and does not load either preview automatically', () => {
        renderAdmin();

        expect(screen.getByRole('heading', { name: 'Alpha Season 2 Wallet Reset' })).toBeInTheDocument();
        expect(screen.getByText(/season standings, career records, and archived seasons stay intact/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Review Wallet Reset' })).toBeInTheDocument();
        expect(getAlpha2WalletResetPreview).not.toHaveBeenCalled();
        expect(applyAlpha2WalletReset).not.toHaveBeenCalled();
        expect(screen.getByText(/wallets and career stats are preserved/i)).toBeInTheDocument();
        expect(getSeasonRolloverPreview).not.toHaveBeenCalled();
        expect(finalizeSeasonRollover).not.toHaveBeenCalled();
    });

    test('loads an explicit preview with the destination, archive size, and top three', async () => {
        const user = userEvent.setup();
        renderAdmin();

        await user.click(screen.getByRole('button', { name: 'Review Season Rollover' }));

        expect(await screen.findByText('Alpha Season 1')).toBeInTheDocument();
        expect(screen.getByText('Alpha Season 2')).toBeInTheDocument();
        expect(screen.getByText((_, element) => (
            element.tagName === 'P' && /4 players will be preserved/i.test(element.textContent)
        ))).toBeInTheDocument();
        const podium = screen.getByRole('list', { name: 'Archived podium preview' });
        expect(within(podium).getByText(/McSaddle/)).toBeInTheDocument();
        expect(within(podium).getByText(/Ace High/)).toBeInTheDocument();
        expect(within(podium).getByText(/Moonshot/)).toBeInTheDocument();
        expect(within(podium).queryByText(/Fourth Place/)).not.toBeInTheDocument();
        const finalizeButton = screen.getByRole('button', { name: 'Finalize Alpha Season 1' });
        expect(finalizeButton).toBeDisabled();
        await user.click(screen.getByRole('checkbox', { name: /fresh database backup/i }));
        expect(finalizeButton).toBeEnabled();
        expect(finalizeSeasonRollover).not.toHaveBeenCalled();
    });

    test('blocks finalization while games are in progress and allows a fresh preview', async () => {
        const user = userEvent.setup();
        getSeasonRolloverPreview
            .mockResolvedValueOnce({
                ...preview,
                inProgressGames: 2,
                canFinalize: false,
            })
            .mockResolvedValueOnce(preview);
        renderAdmin();

        await user.click(screen.getByRole('button', { name: 'Review Season Rollover' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('2 games are still in progress');
        expect(screen.getByRole('button', { name: 'Finalize Alpha Season 1' })).toBeDisabled();

        await user.click(screen.getByRole('button', { name: 'Refresh Preview' }));
        await waitFor(() => expect(screen.getByRole('checkbox', { name: /fresh database backup/i })).toBeInTheDocument());
        expect(screen.getByRole('button', { name: 'Finalize Alpha Season 1' })).toBeDisabled();
        expect(getSeasonRolloverPreview).toHaveBeenCalledTimes(2);
    });

    test('requires deliberate confirmation and submits the exact reviewed snapshot', async () => {
        const user = userEvent.setup();
        const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
        renderAdmin();

        await user.click(screen.getByRole('button', { name: 'Review Season Rollover' }));
        await user.click(await screen.findByRole('checkbox', { name: /fresh database backup/i }));
        const finalizeButton = await screen.findByRole('button', { name: 'Finalize Alpha Season 1' });
        await user.click(finalizeButton);
        expect(finalizeSeasonRollover).not.toHaveBeenCalled();

        await user.click(finalizeButton);
        expect(confirm).toHaveBeenLastCalledWith(expect.stringMatching(/permanently archived/i));
        expect(confirm).toHaveBeenLastCalledWith(expect.stringMatching(/wallet balances and career stats will be preserved/i));
        expect(finalizeSeasonRollover).toHaveBeenCalledWith({
            expectedPreviewHash: 'season-one-preview-hash',
            expectedSeasonId: 1,
        });

        expect(await screen.findByRole('status')).toHaveTextContent('Alpha Season 1 is permanently archived');
        expect(screen.getByRole('status')).toHaveTextContent('Alpha Season 2 is now active');
        expect(screen.getByRole('button', { name: 'Rollover Finalized' })).toBeDisabled();
        expect(screen.queryByRole('button', { name: 'Finalize Alpha Season 1' })).not.toBeInTheDocument();
        confirm.mockRestore();
    });

    test('keeps the reviewed preview available when finalization rejects a stale hash', async () => {
        const user = userEvent.setup();
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
        finalizeSeasonRollover.mockRejectedValueOnce(new Error('Preview changed. Refresh before finalizing.'));
        renderAdmin();

        await user.click(screen.getByRole('button', { name: 'Review Season Rollover' }));
        await user.click(await screen.findByRole('checkbox', { name: /fresh database backup/i }));
        await user.click(await screen.findByRole('button', { name: 'Finalize Alpha Season 1' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Preview changed');
        expect(screen.getByRole('button', { name: 'Refresh Preview' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Finalize Alpha Season 1' })).toBeEnabled();
        confirm.mockRestore();
    });
});
