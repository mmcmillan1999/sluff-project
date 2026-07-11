import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getTokenLedger } from '../services/api';
import TokenLedgerView, {
    formatTokenCents,
    isUnexpectedLedgerEntry,
    normalizeTokenLedgerEntry,
    tokenActivityLabel,
} from './TokenLedgerView';

vi.mock('../services/api', () => ({
    getTokenLedger: vi.fn(),
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
        },
    ],
    nextCursor: 32,
    hasMore: true,
};

beforeEach(() => {
    vi.clearAllMocks();
    getTokenLedger.mockResolvedValue(firstPage);
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
        expect(tokenActivityLabel('admin_adjustment')).toBe('Account adjustment');
        expect(tokenActivityLabel('future_type')).toBe('Token activity');
        expect(isUnexpectedLedgerEntry({ type: 'buy_in', amountCents: -100 })).toBe(false);
        expect(isUnexpectedLedgerEntry({ type: 'buy_in', amountCents: 400 })).toBe(true);
        expect(isUnexpectedLedgerEntry({ type: 'forfeit_loss', amountCents: 0 })).toBe(true);
        expect(isUnexpectedLedgerEntry({ type: 'free_token_mercy', amountCents: 100 })).toBe(false);
        expect(isUnexpectedLedgerEntry({ type: 'free_token_mercy', amountCents: 700 })).toBe(true);
    });

    test('normalizes legacy decimal fields without leaking NaN into the UI', () => {
        expect(normalizeTokenLedgerEntry({
            transaction_id: 7,
            transaction_type: 'buy_in',
            amount: '-0.10',
            balance_after: '8.40',
            game_net: '0.20',
        })).toEqual(expect.objectContaining({
            id: 7,
            type: 'buy_in',
            amountCents: -10,
            balanceAfterCents: 840,
            gameNetCents: 20,
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
});
