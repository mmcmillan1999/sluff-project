import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RoundSummaryModal from './RoundSummaryModal';

const baseProps = {
    showModal: true,
    getPlayerNameByUserId: id => String(id),
    renderCard: vi.fn(),
    emitEvent: vi.fn(),
    handleLeaveTable: vi.fn(),
    handleLogout: vi.fn()
};

const cases = [
    {
        label: 'voluntary forfeit',
        playerId: 1,
        forfeit: { forfeitingPlayerName: 'Alice', reason: 'voluntary forfeit' },
        winner: 'Bob & Cara',
        payout: 'You forfeited and lost your buy-in.',
        expectedReason: 'Reason: Voluntary forfeit'
    },
    {
        label: 'disconnect timeout',
        playerId: 2,
        forfeit: { forfeitingPlayerName: 'Alice', reason: 'disconnect timeout' },
        winner: 'Bob',
        payout: 'You received 2.00 tokens after Alice forfeited.',
        expectedReason: 'Reason: Disconnect timer expired'
    }
];

describe.each(cases)('RoundSummaryModal $label summary', ({ playerId, forfeit, winner, payout, expectedReason }) => {
    test('renders minimal settlement data without trick recap fields', () => {
        render(
            <RoundSummaryModal
                {...baseProps}
                playerId={playerId}
                summaryData={{
                    isGameOver: true,
                    forfeit,
                    gameWinner: winner,
                    finalScores: { Alice: 120, Bob: 105, Cara: 95 },
                    payoutDetails: { [playerId]: payout }
                }}
            />
        );

        expect(screen.getByRole('heading', { name: 'Game Ended by Forfeit' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: `${forfeit.forfeitingPlayerName} forfeited the game.` })).toBeInTheDocument();
        expect(screen.getByText(expectedReason)).toBeInTheDocument();
        expect(screen.getByLabelText(`Game winner: ${winner}`)).toBeInTheDocument();
        expect(screen.getByText(payout)).toBeInTheDocument();

        const scoresPanel = screen.getByRole('heading', { name: 'Final Scores' }).closest('.forfeit-scores-panel');
        const scoreTable = within(scoresPanel).getByRole('table');
        expect(within(scoreTable).getByRole('cell', { name: 'Alice' })).toBeInTheDocument();
        expect(within(scoreTable).getByRole('cell', { name: '120' })).toBeInTheDocument();
        expect(within(scoreTable).getByRole('cell', { name: 'Bob' })).toBeInTheDocument();
        expect(within(scoreTable).getByRole('cell', { name: '105' })).toBeInTheDocument();
        expect(screen.queryByText('Trick Point Recap')).not.toBeInTheDocument();
        expect(screen.queryByText(/Insurance Recap/)).not.toBeInTheDocument();
    });
});

describe('RoundSummaryModal staged presentation', () => {
    test('keeps new totals hidden until the player advances to the score ceremony', async () => {
        const user = userEvent.setup();
        const onContinue = vi.fn();
        render(
            <RoundSummaryModal
                {...baseProps}
                playerId={1}
                title="Round Recap"
                continueLabel="Count the Score"
                onContinue={onContinue}
                showScoreTotals={false}
                insurance={{}}
                bidWinnerInfo={{ playerName: 'Alice' }}
                playerOrderActive={['Alice', 'Bob', 'Cara']}
                summaryData={{
                    isGameOver: false,
                    dealerOfRoundId: 1,
                    finalScores: { Alice: 132, Bob: 114, Cara: 114 },
                    pointChanges: { Alice: 12, Bob: -6, Cara: -6 },
                    finalBidderPoints: 72,
                    finalDefenderPoints: 48,
                    bidType: 'Frog',
                    insuranceDealWasMade: false,
                    insuranceHindsight: {},
                    widowForReveal: [],
                    widowPointsValue: 0
                }}
            />
        );

        expect(screen.getByRole('dialog', { name: 'Round Recap' })).toBeInTheDocument();
        expect(screen.queryByText('New Total')).not.toBeInTheDocument();
        expect(screen.queryByText('132')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Count the Score' })).toHaveFocus();
        await user.click(screen.getByRole('button', { name: 'Count the Score' }));
        expect(onContinue).toHaveBeenCalledTimes(1);
    });

    test('can hand a forfeit recap to the podium without exposing final scores early', async () => {
        const user = userEvent.setup();
        const onContinue = vi.fn();
        render(
            <RoundSummaryModal
                {...baseProps}
                playerId={2}
                title="Final Round Recap"
                continueLabel="View Final Standings"
                onContinue={onContinue}
                showScoreTotals={false}
                summaryData={{
                    isGameOver: true,
                    forfeit: { forfeitingPlayerName: 'Alice', reason: 'voluntary forfeit' },
                    gameWinner: 'Bob & Cara',
                    finalScores: { Alice: 120, Bob: 105, Cara: 95 }
                }}
            />
        );

        expect(screen.queryByRole('heading', { name: 'Final Scores' })).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'View Final Standings' }));
        expect(onContinue).toHaveBeenCalledTimes(1);
    });

    test('surfaces a failed final settlement in the recap', () => {
        render(
            <RoundSummaryModal
                {...baseProps}
                playerId={1}
                insurance={{}}
                bidWinnerInfo={{ playerName: 'Alice' }}
                playerOrderActive={['Alice', 'Bob', 'Cara']}
                summaryData={{
                    isGameOver: true,
                    message: 'Game settlement needs administrator review. No partial payout was committed.',
                    finalScores: { Alice: 132, Bob: 114, Cara: -2 },
                    pointChanges: { Alice: 12, Bob: -6, Cara: -122 },
                    finalBidderPoints: 72,
                    finalDefenderPoints: 48,
                    bidType: 'Frog',
                    insuranceDealWasMade: false,
                    insuranceHindsight: {},
                    widowForReveal: [],
                    widowPointsValue: 0
                }}
            />
        );

        expect(screen.getByRole('status')).toHaveTextContent('administrator review');
    });

    test('collapses trick details when the recap closes before a later round', async () => {
        const user = userEvent.setup();
        const props = {
            ...baseProps,
            playerId: 1,
            insurance: {},
            bidWinnerInfo: { playerName: 'Alice' },
            playerOrderActive: ['Alice', 'Bob', 'Cara'],
            summaryData: {
                isGameOver: false,
                dealerOfRoundId: 1,
                finalScores: { Alice: 132, Bob: 114, Cara: 114 },
                pointChanges: { Alice: 12, Bob: -6, Cara: -6 },
                finalBidderPoints: 72,
                finalDefenderPoints: 48,
                bidType: 'Frog',
                insuranceDealWasMade: false,
                insuranceHindsight: {},
                allTricks: {},
                widowForReveal: [],
                widowPointsValue: 0
            }
        };
        const { rerender } = render(<RoundSummaryModal {...props} />);

        await user.click(screen.getByRole('button', { name: 'Show Trick Breakdown' }));
        expect(screen.getByRole('button', { name: 'Hide Trick Breakdown' })).toBeInTheDocument();
        rerender(<RoundSummaryModal {...props} showModal={false} />);
        rerender(<RoundSummaryModal {...props} showModal />);
        expect(screen.getByRole('button', { name: 'Show Trick Breakdown' })).toBeInTheDocument();
    });
});
