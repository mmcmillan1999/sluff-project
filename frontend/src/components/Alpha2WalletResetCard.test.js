import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Alpha2WalletResetCard from './Alpha2WalletResetCard';
import {
    applyAlpha2WalletReset,
    getAlpha2WalletResetPreview,
} from '../services/api';

vi.mock('../services/api', () => ({
    getAlpha2WalletResetPreview: vi.fn(),
    applyAlpha2WalletReset: vi.fn(),
}));

const preview = {
    season: { id: 2, slug: 'alpha-season-2', name: 'Alpha Season 2' },
    targetTokens: '8.00',
    accounts: [
        { username: 'Low', beforeTokens: '3.00', afterTokens: '8.00' },
        { username: 'Even', beforeTokens: '8.00', afterTokens: '8.00' },
        { username: 'High', beforeTokens: '14.00', afterTokens: '8.00' },
    ],
    summary: {
        accountCount: 3,
        changedAccountCount: 2,
        oldSupply: '25.00',
        newSupply: '24.00',
        minted: '5.00',
        burned: '6.00',
        net: '-1.00',
    },
    currentSeasonGameCount: 0,
    canApply: true,
    alreadyApplied: false,
    previewHash: 'alpha-two-wallet-preview-hash',
};

describe('Alpha2WalletResetCard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getAlpha2WalletResetPreview.mockResolvedValue(preview);
        applyAlpha2WalletReset.mockResolvedValue({
            operation: { seasonId: 2, targetTokens: '8.00' },
            accounts: preview.accounts,
            summary: preview.summary,
            alreadyApplied: false,
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    test('does not fetch or mutate until the admin deliberately requests a preview', () => {
        render(<Alpha2WalletResetCard />);

        expect(screen.getByText(/set every account wallet to 8 tokens/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Review Wallet Reset' })).toBeEnabled();
        expect(getAlpha2WalletResetPreview).not.toHaveBeenCalled();
        expect(applyAlpha2WalletReset).not.toHaveBeenCalled();
    });

    test('shows complete accounting and requires acknowledgement plus browser confirmation', async () => {
        const user = userEvent.setup();
        const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
        render(<Alpha2WalletResetCard />);

        await user.click(screen.getByRole('button', { name: 'Review Wallet Reset' }));

        expect(await screen.findByText('Every wallet → 8.00 tokens')).toBeInTheDocument();
        const summary = screen.getByLabelText('Wallet reset totals');
        expect(summary).toHaveTextContent('Accounts3');
        expect(summary).toHaveTextContent('Balances changing2');
        expect(summary).toHaveTextContent('Current supply25.00');
        expect(summary).toHaveTextContent('Supply after reset24.00');
        expect(summary).toHaveTextContent('Minted+5.00');
        expect(summary).toHaveTextContent('Burned-6.00');
        expect(summary).toHaveTextContent('Net supply change-1.00');

        const applyButton = screen.getByRole('button', { name: 'Reset Every Wallet to 8' });
        expect(applyButton).toBeDisabled();
        await user.click(screen.getByRole('checkbox', { name: /fresh database backup/i }));
        expect(applyButton).toBeEnabled();

        await user.click(applyButton);
        expect(applyAlpha2WalletReset).not.toHaveBeenCalled();
        await user.click(applyButton);

        expect(confirm).toHaveBeenLastCalledWith(expect.stringMatching(/change 2 of 3 account balances/i));
        expect(confirm).toHaveBeenLastCalledWith(expect.stringMatching(/cannot be automatically undone/i));
        expect(applyAlpha2WalletReset).toHaveBeenCalledWith({
            expectedPreviewHash: 'alpha-two-wallet-preview-hash',
            expectedSeasonId: 2,
        });
        expect(await screen.findByRole('status')).toHaveTextContent('wallet reset complete');
        expect(screen.getByRole('button', { name: 'Wallet Reset Applied' })).toBeDisabled();
        expect(screen.queryByRole('button', { name: 'Reset Every Wallet to 8' })).not.toBeInTheDocument();
        confirm.mockRestore();
    });

    test('blocks while a game is active and refreshes to a fresh reviewed snapshot', async () => {
        const user = userEvent.setup();
        getAlpha2WalletResetPreview
            .mockResolvedValueOnce({
                ...preview,
                currentSeasonGameCount: 1,
                canApply: false,
            })
            .mockResolvedValueOnce(preview);
        render(<Alpha2WalletResetCard />);

        await user.click(screen.getByRole('button', { name: 'Review Wallet Reset' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('1 game has already started in Alpha Season 2');
        expect(screen.getByRole('button', { name: 'Reset Every Wallet to 8' })).toBeDisabled();

        await user.click(screen.getByRole('button', { name: 'Refresh Preview' }));
        expect(await screen.findByRole('checkbox', { name: /fresh database backup/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Reset Every Wallet to 8' })).toBeDisabled();
        expect(getAlpha2WalletResetPreview).toHaveBeenCalledTimes(2);
    });

    test('keeps retries safe after a stale preview error', async () => {
        const user = userEvent.setup();
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        applyAlpha2WalletReset.mockRejectedValueOnce(new Error('Preview changed. Refresh before resetting wallets.'));
        render(<Alpha2WalletResetCard />);

        await user.click(screen.getByRole('button', { name: 'Review Wallet Reset' }));
        await user.click(await screen.findByRole('checkbox', { name: /fresh database backup/i }));
        await user.click(screen.getByRole('button', { name: 'Reset Every Wallet to 8' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Preview changed');
        expect(screen.getByRole('checkbox', { name: /fresh database backup/i })).not.toBeChecked();
        expect(screen.getByRole('button', { name: 'Reset Every Wallet to 8' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Refresh Preview' })).toBeEnabled();
    });

    test('renders an already-completed preview as permanently disabled', async () => {
        const user = userEvent.setup();
        getAlpha2WalletResetPreview.mockResolvedValueOnce({ ...preview, alreadyApplied: true, canApply: false });
        render(<Alpha2WalletResetCard />);

        await user.click(screen.getByRole('button', { name: 'Review Wallet Reset' }));

        expect(await screen.findByRole('status')).toHaveTextContent('wallet reset complete');
        expect(screen.getByRole('button', { name: 'Wallet Reset Applied' })).toBeDisabled();
        expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
        expect(applyAlpha2WalletReset).not.toHaveBeenCalled();
    });
});
