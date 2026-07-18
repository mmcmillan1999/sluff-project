import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminGameRecoveryCard from './AdminGameRecoveryCard';
import {
    getAbandonedGameRecoveryPreview,
    refundAbandonedGames,
} from '../services/api';

vi.mock('../services/api', () => ({
    getAbandonedGameRecoveryPreview: vi.fn(),
    refundAbandonedGames: vi.fn(),
}));

const preview = {
    generatedAt: '2026-07-18T02:20:00.000Z',
    previewHash: 'a'.repeat(64),
    candidateCount: 2,
    totalRefundCents: 500,
    truncated: false,
    criteria: {
        inactivityMinutes: 10,
        minimumSeasonNumber: 2,
        requiresFundedBuyIn: true,
        requiresNoPayouts: true,
    },
    candidates: [
        {
            gameId: 42,
            tableId: 'qp-fort-creek-1',
            theme: 'fort-creek',
            playerCount: 3,
            seasonId: 2,
            seasonNumber: 2,
            startTime: '2026-07-18T01:00:00.000Z',
            lastActivityAt: '2026-07-18T01:05:00.000Z',
            refundTotalCents: 300,
            fundedPlayers: [
                { userId: 7, username: 'Alice', buyInCents: 100, sourceTransactionId: 101 },
                { userId: 8, username: 'Bob', buyInCents: 100, sourceTransactionId: 102 },
                { userId: 9, username: 'Cara', buyInCents: 100, sourceTransactionId: 103 },
            ],
        },
        {
            gameId: 43,
            tableId: 'qp-shirecliff-road-1',
            theme: 'shirecliff-road',
            playerCount: 2,
            seasonId: 2,
            seasonNumber: 2,
            startTime: '2026-07-18T02:00:00.000Z',
            lastActivityAt: '2026-07-18T02:04:00.000Z',
            refundTotalCents: 200,
            fundedPlayers: [
                { userId: 10, username: 'Drew', buyInCents: 100, sourceTransactionId: 104 },
                { userId: 11, username: 'Evan', buyInCents: 100, sourceTransactionId: 105 },
            ],
        },
    ],
};

describe('AdminGameRecoveryCard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getAbandonedGameRecoveryPreview.mockResolvedValue(preview);
        refundAbandonedGames.mockResolvedValue({
            requestedGameCount: 1,
            refundedGameCount: 1,
            refundedPlayerCount: 3,
            refundedSourceCount: 3,
            refundTotalCents: 300,
            results: [{ gameId: 42, status: 'abandoned_refunded' }],
            errors: [],
        });
    });

    test('states the fixed safety filters and never loads data automatically', () => {
        render(<AdminGameRecoveryCard />);

        expect(screen.getByText('Season 2+')).toBeInTheDocument();
        expect(screen.getByText('Inactive more than 10 minutes')).toBeInTheDocument();
        expect(screen.getByText('Funded buy-ins only')).toBeInTheDocument();
        expect(screen.getByText('No payout, refund, or adjustment rows')).toBeInTheDocument();
        expect(screen.getByText(/Alpha Season 1 are always excluded/i)).toBeInTheDocument();
        expect(getAbandonedGameRecoveryPreview).not.toHaveBeenCalled();
        expect(refundAbandonedGames).not.toHaveBeenCalled();
    });

    test('shows every affected player and recalculates the reviewed selection', async () => {
        const user = userEvent.setup();
        render(<AdminGameRecoveryCard />);

        await user.click(screen.getByRole('button', { name: 'Review Abandoned Games' }));
        const firstRefunds = await screen.findByRole('list', { name: 'Refunds for game #42' });
        expect(within(firstRefunds).getByText('Alice')).toBeInTheDocument();
        expect(within(firstRefunds).getByText('Bob')).toBeInTheDocument();
        expect(within(firstRefunds).getByText('Cara')).toBeInTheDocument();
        expect(firstRefunds.closest('.game-recovery-preview')).not.toHaveAttribute('aria-live');
        const selectAll = screen.getByRole('checkbox', { name: 'Select every eligible game' });
        expect(selectAll).not.toHaveProperty('indeterminate', true);
        expect(screen.getByText((_, element) => (
            element.classList.contains('game-recovery-selection')
            && /Selected: 2 games, 5 buy-in refunds for 5 players, 5\.00 tokens/.test(
                element.textContent.replace(/\s+/g, ' '),
            )
        ))).toBeInTheDocument();

        await user.click(screen.getByRole('checkbox', { name: 'Select game #43' }));
        expect(selectAll).toHaveProperty('indeterminate', true);
        expect(selectAll).toHaveAttribute('aria-checked', 'mixed');
        expect(screen.getByText((_, element) => (
            element.classList.contains('game-recovery-selection')
            && /Selected: 1 game, 3 buy-in refunds for 3 players, 3\.00 tokens/.test(
                element.textContent.replace(/\s+/g, ' '),
            )
        ))).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Refund Selected Games' })).toBeDisabled();

        await user.click(screen.getByRole('checkbox', { name: /fresh database backup/i }));
        expect(screen.getByRole('button', { name: 'Refund Selected Games' })).toBeEnabled();
    });

    test('renders duplicate buy-in charges independently and counts unique players honestly', async () => {
        const user = userEvent.setup();
        getAbandonedGameRecoveryPreview.mockResolvedValueOnce({
            ...preview,
            candidateCount: 1,
            totalRefundCents: 350,
            candidates: [{
                ...preview.candidates[0],
                refundTotalCents: 350,
                fundedPlayers: [
                    { userId: 7, username: 'Alice', buyInCents: 150, sourceTransactionIds: [101, 105] },
                    { userId: 8, username: 'Bob', buyInCents: 100, sourceTransactionIds: [102] },
                    { userId: 9, username: 'Cara', buyInCents: 100, sourceTransactionIds: [103] },
                ],
                sourceBuyIns: [
                    { userId: 7, username: 'Alice', buyInCents: 100, sourceTransactionId: 101 },
                    { userId: 7, username: 'Alice', buyInCents: 50, sourceTransactionId: 105 },
                    { userId: 8, username: 'Bob', buyInCents: 100, sourceTransactionId: 102 },
                    { userId: 9, username: 'Cara', buyInCents: 100, sourceTransactionId: 103 },
                ],
            }],
        });
        render(<AdminGameRecoveryCard />);

        await user.click(screen.getByRole('button', { name: 'Review Abandoned Games' }));
        const refunds = await screen.findByRole('list', { name: 'Refunds for game #42' });
        expect(within(refunds).getAllByText('Alice')).toHaveLength(2);
        expect(screen.getByText((_, element) => (
            element.classList.contains('game-recovery-selection')
            && /Selected: 1 game, 4 buy-in refunds for 3 players, 3\.50 tokens/.test(
                element.textContent.replace(/\s+/g, ' '),
            )
        ))).toBeInTheDocument();
    });

    test('confirms and submits the exact reviewed game ids and preview hash', async () => {
        const user = userEvent.setup();
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
        render(<AdminGameRecoveryCard />);

        await user.click(screen.getByRole('button', { name: 'Review Abandoned Games' }));
        await user.click(await screen.findByRole('checkbox', { name: 'Select game #43' }));
        await user.click(screen.getByRole('checkbox', { name: /fresh database backup/i }));
        await user.click(screen.getByRole('button', { name: 'Refund Selected Games' }));

        expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/1 game, 3 buy-in refunds for 3 players, 3\.00 total tokens/i));
        expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/revalidate every selected game/i));
        expect(refundAbandonedGames).toHaveBeenCalledWith({
            gameIds: [42],
            expectedPreviewHash: 'a'.repeat(64),
        });
        const receipt = await screen.findByRole('status');
        expect(receipt).toHaveTextContent('1 of 1 selected game refunded');
        expect(receipt).toHaveTextContent('3 buy-in refunds issued');
        expect(receipt).toHaveTextContent('3.00 tokens returned');
        confirm.mockRestore();
    });

    test('reports a partial batch as an alert with every unresolved game status', async () => {
        const user = userEvent.setup();
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
        refundAbandonedGames.mockResolvedValueOnce({
            requestedGameCount: 2,
            refundedGameCount: 1,
            refundedSourceCount: 3,
            refundedPlayerCount: 3,
            refundTotalCents: 300,
            results: [
                { gameId: 42, status: 'abandoned_refunded', alreadyReconciled: false },
                { gameId: 43, status: 'retry_later', reason: 'lock_timeout' },
            ],
            errors: [],
        });
        render(<AdminGameRecoveryCard />);

        await user.click(screen.getByRole('button', { name: 'Review Abandoned Games' }));
        await user.click(await screen.findByRole('checkbox', { name: /fresh database backup/i }));
        await user.click(screen.getByRole('button', { name: 'Refund Selected Games' }));

        const warning = await screen.findByRole('alert');
        expect(warning).toHaveTextContent('Recovery batch needs review');
        expect(warning).toHaveTextContent('1 of 2 selected games refunded');
        expect(warning).not.toHaveTextContent('Abandoned-game recovery complete');
        const unresolved = within(warning).getByRole('list', { name: 'Games requiring review' });
        expect(unresolved).toHaveTextContent('Game #43');
        expect(unresolved).toHaveTextContent('Retry later');
        expect(warning).toHaveTextContent('Refresh the preview before issuing any further refunds');
        confirm.mockRestore();
    });

    test('reports an all-failed batch as an alert with game ids and error statuses', async () => {
        const user = userEvent.setup();
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
        const rejected = new Error('Refund results are unknown. Refresh before retrying.');
        rejected.recoveryResult = {
            message: rejected.message,
            requestedGameCount: 2,
            refundedGameCount: 0,
            refundedSourceCount: 0,
            refundedPlayerCount: 0,
            refundTotalCents: 0,
            results: [],
            errors: [
                { gameId: 42, code: 'RECOVERY_ERROR' },
                { gameId: 43, code: 'LOCK_TIMEOUT' },
            ],
        };
        refundAbandonedGames.mockRejectedValueOnce(rejected);
        render(<AdminGameRecoveryCard />);

        await user.click(screen.getByRole('button', { name: 'Review Abandoned Games' }));
        await user.click(await screen.findByRole('checkbox', { name: /fresh database backup/i }));
        await user.click(screen.getByRole('button', { name: 'Refund Selected Games' }));

        const warning = await screen.findByRole('alert');
        expect(warning).toHaveTextContent('0 of 2 selected games refunded');
        const unresolved = within(warning).getByRole('list', { name: 'Games requiring review' });
        expect(unresolved).toHaveTextContent('Game #42');
        expect(unresolved).toHaveTextContent('Recovery error');
        expect(unresolved).toHaveTextContent('Game #43');
        expect(unresolved).toHaveTextContent('Lock timeout');
        expect(warning).toHaveTextContent('Refresh before retrying');
        confirm.mockRestore();
    });

    test('locks the reviewed selection while a refund request is in flight', async () => {
        const user = userEvent.setup();
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
        let resolveRefund;
        refundAbandonedGames.mockImplementationOnce(() => new Promise(resolve => {
            resolveRefund = resolve;
        }));
        render(<AdminGameRecoveryCard />);

        await user.click(screen.getByRole('button', { name: 'Review Abandoned Games' }));
        await user.click(await screen.findByRole('checkbox', { name: 'Select game #43' }));
        await user.click(screen.getByRole('checkbox', { name: /fresh database backup/i }));
        await user.click(screen.getByRole('button', { name: 'Refund Selected Games' }));

        expect(screen.getByRole('checkbox', { name: 'Select every eligible game' })).toBeDisabled();
        expect(screen.getByRole('checkbox', { name: 'Select game #42' })).toBeDisabled();
        expect(screen.getByRole('checkbox', { name: /fresh database backup/i })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Issuing Refunds...' })).toBeDisabled();

        await act(async () => {
            resolveRefund({
                requestedGameCount: 1,
                refundedGameCount: 1,
                refundedSourceCount: 3,
                refundedPlayerCount: 3,
                refundTotalCents: 300,
                results: [{ gameId: 42, status: 'abandoned_refunded', alreadyReconciled: false }],
                errors: [],
            });
        });
        expect(await screen.findByRole('status')).toHaveTextContent('recovery complete');
        confirm.mockRestore();
    });

    test('keeps the reviewed games visible when a stale preview is rejected', async () => {
        const user = userEvent.setup();
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
        refundAbandonedGames.mockRejectedValueOnce(new Error('The recovery candidates changed. Refresh and review again.'));
        render(<AdminGameRecoveryCard />);

        await user.click(screen.getByRole('button', { name: 'Review Abandoned Games' }));
        await user.click(await screen.findByRole('checkbox', { name: /fresh database backup/i }));
        await user.click(screen.getByRole('button', { name: 'Refund Selected Games' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('recovery candidates changed');
        expect(screen.getByText('Game #42')).toBeInTheDocument();
        const acknowledgement = screen.getByRole('checkbox', { name: /fresh database backup/i });
        const refundButton = screen.getByRole('button', { name: 'Refund Selected Games' });
        expect(acknowledgement).not.toBeChecked();
        expect(acknowledgement).toBeDisabled();
        expect(refundButton).toBeDisabled();

        await user.click(acknowledgement);
        await user.click(refundButton);
        expect(refundAbandonedGames).toHaveBeenCalledTimes(1);

        await user.click(screen.getByRole('button', { name: 'Refresh Preview' }));
        await waitFor(() => expect(
            screen.getByRole('checkbox', { name: /fresh database backup/i }),
        ).toBeEnabled());
        expect(getAbandonedGameRecoveryPreview).toHaveBeenCalledTimes(2);
        confirm.mockRestore();
    });

    test('presents a clean empty state without offering an execute action', async () => {
        const user = userEvent.setup();
        getAbandonedGameRecoveryPreview.mockResolvedValueOnce({
            ...preview,
            candidateCount: 0,
            totalRefundCents: 0,
            candidates: [],
        });
        render(<AdminGameRecoveryCard />);

        await user.click(screen.getByRole('button', { name: 'Review Abandoned Games' }));
        expect(await screen.findByRole('status')).toHaveTextContent('No Season 2+ games');
        expect(screen.queryByRole('button', { name: 'Refund Selected Games' })).not.toBeInTheDocument();
        await waitFor(() => expect(getAbandonedGameRecoveryPreview).toHaveBeenCalledOnce());
    });
});
