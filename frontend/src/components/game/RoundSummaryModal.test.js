import React from 'react';
import { render, screen, within } from '@testing-library/react';
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
