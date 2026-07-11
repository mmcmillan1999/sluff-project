import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DrawVoteModal from './DrawVoteModal';

const failedDrawState = {
    state: 'DrawComplete',
    settlement: { status: 'failed' },
    playerId: 1,
    players: {
        1: { userId: 1, playerName: 'Alice' },
        2: { userId: 2, playerName: 'Bob' },
        3: { userId: 3, playerName: 'Cara' }
    },
    drawRequest: { votes: {} },
    roundSummary: {
        settlementFailed: true,
        drawOutcome: 'Settlement Failed',
        message: 'Draw settlement needs administrator review. No partial payout was committed.',
        // Even stale payout-shaped data must never appear on the failure path.
        payouts: { Alice: { totalReturn: 10 } }
    }
};

describe('DrawVoteModal terminal settlement recovery', () => {
    test('shows a review-only failed draw outcome with Lobby as the sole action', async () => {
        const user = userEvent.setup();
        const handleLeaveTable = vi.fn();
        render(
            <DrawVoteModal
                show
                currentTableState={failedDrawState}
                onVote={vi.fn()}
                handleLeaveTable={handleLeaveTable}
            />
        );

        expect(screen.getByRole('heading', { name: 'Draw Settlement Needs Review' })).toBeInTheDocument();
        expect(screen.getByText(failedDrawState.roundSummary.message)).toBeInTheDocument();
        expect(screen.queryByText(/Draw Succeeded/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/Payouts are as follows/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/Received .* tokens/i)).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /reset|rematch/i })).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Exit to Lobby' }));
        expect(handleLeaveTable).toHaveBeenCalledTimes(1);
    });
});
