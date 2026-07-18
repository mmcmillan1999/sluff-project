import React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getTokenLedger, voidLedgerGame } from '../services/api';
import TokenLedgerView, {
    formatTokenCents,
    isUnexpectedLedgerEntry,
    normalizeTokenLedgerEntry,
    tokenActivityLabel,
} from './TokenLedgerView';

vi.mock('../services/api', () => ({
    getTokenLedger: vi.fn(),
    voidLedgerGame: vi.fn(),
}));

const firstPage = {
    currentBalanceCents: 1240,
    entries: [
        {
            id: 33,
            occurredAt: '2026-07-11T18:30:00.000Z',
            type: 'win_payout',
            category: 'game',
            amountCents: 30,
            balanceAfterCents: 1240,
            description: 'Final first-place payout for game #901',
            gameId: 901,
            gameNetCents: 20,
            gameTheme: 'Low Stakes',
            gameOutcome: 'Complete',
            gameCanVoid: true,
            gameVoidStatus: 'eligible',
            gameVoidedAt: null,
        },
        {
            id: 32,
            occurredAt: '2026-07-11T18:00:00.000Z',
            type: 'buy_in',
            category: 'game',
            amountCents: -10,
            balanceAfterCents: 1210,
            description: 'Table buy-in for game #901',
            gameId: 901,
            gameNetCents: 20,
            gameTheme: 'Low Stakes',
            gameOutcome: 'Complete',
            gameCanVoid: true,
            gameVoidStatus: 'eligible',
            gameVoidedAt: null,
        },
    ],
    nextCursor: 32,
    hasMore: true,
};

beforeEach(() => {
    vi.clearAllMocks();
    getTokenLedger.mockResolvedValue(firstPage);
    voidLedgerGame.mockResolvedValue({ gameId: 901, voided: true, alreadyVoided: false });
});

describe('TokenLedgerView formatting', () => {
    test('formats signed cents and maps every persisted transaction type', () => {
        expect(formatTokenCents(125)).toBe('1.25');
        expect(formatTokenCents(125, { signed: true })).toBe('+1.25');
        expect(formatTokenCents(-10, { signed: true, suffix: true })).toBe('-0.10 tokens');
        expect(formatTokenCents('not-cents')).toBe('—');

        expect(tokenActivityLabel('buy_in')).toBe('Game buy-in');
        expect(tokenActivityLabel('win_payout')).toBe('Game payout');
        expect(tokenActivityLabel('wash_payout')).toBe('Buy-in returned');
        expect(tokenActivityLabel('forfeit_loss')).toBe('Forfeit loss');
        expect(tokenActivityLabel('forfeit_payout')).toBe('Forfeit payout');
        expect(tokenActivityLabel('free_token_mercy')).toBe('Mercy token');
        expect(tokenActivityLabel('abandoned_refund')).toBe('Abandoned-game refund');
        expect(tokenActivityLabel('game_void_reversal')).toBe('Voided-game adjustment');
        expect(tokenActivityLabel('admin_adjustment')).toBe('Account adjustment');
        expect(tokenActivityLabel('future_type')).toBe('Token activity');
        expect(isUnexpectedLedgerEntry({ type: 'buy_in', amountCents: -100 })).toBe(false);
        expect(isUnexpectedLedgerEntry({ type: 'buy_in', amountCents: 400 })).toBe(true);
        expect(isUnexpectedLedgerEntry({ type: 'forfeit_loss', amountCents: 0 })).toBe(true);
        expect(isUnexpectedLedgerEntry({ type: 'free_token_mercy', amountCents: 100 })).toBe(false);
        expect(isUnexpectedLedgerEntry({ type: 'free_token_mercy', amountCents: 700 })).toBe(true);
        expect(isUnexpectedLedgerEntry({ type: 'game_void_reversal', amountCents: 100 })).toBe(false);
        expect(isUnexpectedLedgerEntry({ type: 'game_void_reversal', amountCents: -200 })).toBe(false);
    });

    test('normalizes legacy decimal fields without leaking NaN into the UI', () => {
        expect(normalizeTokenLedgerEntry({
            transaction_id: 7,
            transaction_type: 'buy_in',
            amount: '-0.10',
            balance_after: '8.40',
            game_net: '0.20',
            game_can_void: true,
            game_void_status: 'eligible',
        })).toEqual(expect.objectContaining({
            id: 7,
            type: 'buy_in',
            amountCents: -10,
            balanceAfterCents: 840,
            gameNetCents: 20,
            gameCanVoid: true,
            gameVoidStatus: 'eligible',
        }));
    });

    test('shows raw legacy entries with a warning and visible description', async () => {
        getTokenLedger.mockResolvedValueOnce({
            currentBalanceCents: 400,
            entries: [{
                id: 517,
                occurredAt: '2025-07-20T12:00:00.000Z',
                type: 'buy_in',
                amountCents: 400,
                balanceAfterCents: 400,
                description: 'Legacy game return',
                gameId: 140,
                gameNetCents: 400,
            }],
            nextCursor: null,
            hasMore: false,
        });
        render(<TokenLedgerView onReturnToLobby={vi.fn()} />);

        const heading = await screen.findByRole('heading', { name: 'Legacy / unexpected entry' });
        const card = heading.closest('article');
        expect(within(card).getByText('+4.00')).toBeInTheDocument();
        expect(within(card).getByText('Legacy game return')).toBeInTheDocument();
        expect(within(card).getByText(/do not match today's accounting rules/i)).toBeInTheDocument();
    });
});

describe('TokenLedgerView', () => {
    test('shows current balance, raw signed entries, running balances, and game context', async () => {
        render(<TokenLedgerView onReturnToLobby={vi.fn()} />);

        await screen.findByRole('heading', { name: 'Game payout' });
        const balanceCard = screen.getByText('Current balance').closest('section');
        expect(within(balanceCard).getByText('12.40')).toBeInTheDocument();
        expect(getTokenLedger).toHaveBeenCalledWith({ limit: 25, cursor: null, category: 'all' });

        const payout = screen.getByRole('heading', { name: 'Game payout' }).closest('article');
        expect(within(payout).getByText('+0.30')).toBeInTheDocument();
        expect(within(payout).getByText(/Balance after/)).toHaveTextContent('Balance after 12.40');
        expect(within(payout).getByText('Game #901 · Low Stakes · Complete')).toBeInTheDocument();
        expect(within(payout).getByText('Game net +0.20')).toBeInTheDocument();
        expect(within(payout).getByText('Final first-place payout for game #901')).toBeInTheDocument();

        const buyIn = screen.getByRole('heading', { name: 'Game buy-in' }).closest('article');
        expect(within(buyIn).getByText('-0.10')).toBeInTheDocument();
        expect(within(buyIn).getByText(/Balance after/)).toHaveTextContent('Balance after 12.10');
    });

    test('resets the cursor and asks the server for the selected category', async () => {
        const user = userEvent.setup();
        getTokenLedger
            .mockResolvedValueOnce(firstPage)
            .mockResolvedValueOnce({ currentBalanceCents: 1240, entries: [], nextCursor: null, hasMore: false });
        render(<TokenLedgerView onReturnToLobby={vi.fn()} />);

        await screen.findByRole('heading', { name: 'Game payout' });
        await user.selectOptions(screen.getByLabelText('Show'), 'refund');

        await waitFor(() => expect(getTokenLedger).toHaveBeenLastCalledWith({
            limit: 25,
            cursor: null,
            category: 'refund',
        }));
        expect(await screen.findByRole('heading', { name: 'No token activity yet' })).toBeInTheDocument();
    });

    test('loads older activity explicitly and does not duplicate a repeated boundary row', async () => {
        const user = userEvent.setup();
        getTokenLedger
            .mockResolvedValueOnce(firstPage)
            .mockResolvedValueOnce({
                currentBalanceCents: 1240,
                entries: [
                    firstPage.entries[1],
                    {
                        id: 31,
                        occurredAt: '2026-07-10T18:00:00.000Z',
                        type: 'free_token_mercy',
                        amountCents: 100,
                        balanceAfterCents: 1220,
                        description: 'Mercy token requested by user',
                        gameId: null,
                        gameNetCents: null,
                    },
                ],
                nextCursor: null,
                hasMore: false,
            });
        render(<TokenLedgerView onReturnToLobby={vi.fn()} />);

        await user.click(await screen.findByRole('button', { name: 'Load older activity' }));
        await waitFor(() => expect(getTokenLedger).toHaveBeenLastCalledWith({
            limit: 25,
            cursor: 32,
            category: 'all',
        }));
        expect(await screen.findByRole('heading', { name: 'Mercy token' })).toBeInTheDocument();
        expect(screen.getAllByRole('heading', { name: 'Game buy-in' })).toHaveLength(1);
        expect(screen.queryByRole('button', { name: 'Load older activity' })).not.toBeInTheDocument();
    });

    test('keeps loaded activity when an older page fails and retries the same cursor', async () => {
        const user = userEvent.setup();
        getTokenLedger
            .mockResolvedValueOnce(firstPage)
            .mockRejectedValueOnce(new Error('Older activity is temporarily unavailable.'))
            .mockResolvedValueOnce({
                currentBalanceCents: 1240,
                entries: [],
                nextCursor: null,
                hasMore: false,
            });
        render(<TokenLedgerView onReturnToLobby={vi.fn()} />);

        await user.click(await screen.findByRole('button', { name: 'Load older activity' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Older activity is temporarily unavailable.');
        expect(screen.getByRole('heading', { name: 'Game payout' })).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Try again' }));
        await waitFor(() => expect(getTokenLedger).toHaveBeenLastCalledWith({
            limit: 25,
            cursor: 32,
            category: 'all',
        }));
        expect(screen.getByRole('heading', { name: 'Game payout' })).toBeInTheDocument();
    });

    test('offers retry after an initial error and refresh replaces the visible page', async () => {
        const user = userEvent.setup();
        getTokenLedger
            .mockRejectedValueOnce(new Error('Ledger unavailable.'))
            .mockResolvedValueOnce(firstPage)
            .mockResolvedValueOnce({ currentBalanceCents: 1300, entries: [], nextCursor: null, hasMore: false });
        render(<TokenLedgerView onReturnToLobby={vi.fn()} />);

        expect(await screen.findByRole('alert')).toHaveTextContent('Ledger unavailable.');
        await user.click(screen.getByRole('button', { name: 'Try again' }));
        expect(await screen.findByRole('heading', { name: 'Game payout' })).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Refresh token ledger' }));
        expect(await screen.findByText('13.00')).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Game payout' })).not.toBeInTheDocument();
    });

    test('offers one per-game action, explains the oath, and supports cancel and Escape', async () => {
        const user = userEvent.setup();
        render(<TokenLedgerView onReturnToLobby={vi.fn()} />);

        const voidButtons = await screen.findAllByRole('button', { name: 'Void Game #901' });
        expect(voidButtons).toHaveLength(1);

        await user.click(voidButtons[0]);
        let dialog = screen.getByRole('dialog', { name: 'Scout’s honor?' });
        expect(within(dialog).getByText('I do solemnly swear that Game #901 should not count.')).toBeInTheDocument();
        expect(within(dialog).getByText(/Every buy-in will be returned, every payout will be taken back/i)).toBeInTheDocument();
        expect(within(dialog).getByText(/season and lifetime result will be removed for everyone/i)).toBeInTheDocument();
        expect(within(dialog).getByText(/This cannot be undone/i)).toBeInTheDocument();
        await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Keep the game' })).toHaveFocus());

        await user.click(within(dialog).getByRole('button', { name: 'Keep the game' }));
        expect(screen.queryByRole('dialog', { name: 'Scout’s honor?' })).not.toBeInTheDocument();
        expect(voidLedgerGame).not.toHaveBeenCalled();

        await user.click(screen.getByRole('button', { name: 'Void Game #901' }));
        dialog = screen.getByRole('dialog', { name: 'Scout’s honor?' });
        await user.keyboard('{Escape}');
        expect(dialog).not.toBeInTheDocument();
        expect(voidLedgerGame).not.toHaveBeenCalled();
    });

    test('keeps the modal open on an API error and prevents a duplicate submission', async () => {
        const user = userEvent.setup();
        let rejectVoid;
        voidLedgerGame.mockImplementationOnce(() => new Promise((_resolve, reject) => {
            rejectVoid = reject;
        }));
        render(<TokenLedgerView onReturnToLobby={vi.fn()} />);

        await user.click(await screen.findByRole('button', { name: 'Void Game #901' }));
        const confirmButton = screen.getByRole('button', { name: 'Scout’s honor — void it.' });
        await user.click(confirmButton);

        expect(confirmButton).toBeDisabled();
        await user.click(confirmButton);
        expect(voidLedgerGame).toHaveBeenCalledTimes(1);
        expect(voidLedgerGame).toHaveBeenCalledWith(901);

        await act(async () => {
            rejectVoid(new Error('The table record is temporarily locked.'));
        });
        expect(await screen.findByRole('alert')).toHaveTextContent('The table record is temporarily locked.');
        expect(screen.getByRole('dialog', { name: 'Scout’s honor?' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Scout’s honor — void it.' })).toBeEnabled();
    });

    test('refreshes the first page after success and shows one durable Voided status', async () => {
        const user = userEvent.setup();
        const voidedPage = {
            ...firstPage,
            currentBalanceCents: 1220,
            entries: firstPage.entries.map(entry => ({
                ...entry,
                gameCanVoid: false,
                gameVoidStatus: 'voided',
                gameVoidedAt: '2026-07-11T19:00:00.000Z',
            })),
        };
        getTokenLedger
            .mockResolvedValueOnce(firstPage)
            .mockResolvedValueOnce(voidedPage);
        render(<TokenLedgerView onReturnToLobby={vi.fn()} />);

        await user.click(await screen.findByRole('button', { name: 'Void Game #901' }));
        await user.click(screen.getByRole('button', { name: 'Scout’s honor — void it.' }));

        await waitFor(() => expect(voidLedgerGame).toHaveBeenCalledWith(901));
        expect(await screen.findByRole('status')).toHaveTextContent(
            'Game #901 was voided. Everyone’s tokens and records have been restored.',
        );
        await waitFor(() => expect(getTokenLedger).toHaveBeenLastCalledWith({
            limit: 25,
            cursor: null,
            category: 'all',
        }));
        expect(screen.getAllByText('Voided')).toHaveLength(1);
        expect(screen.queryByRole('button', { name: 'Void Game #901' })).not.toBeInTheDocument();
        expect(screen.getByText('12.20')).toBeInTheDocument();
    });
});
