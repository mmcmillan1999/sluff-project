import React, { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FeedbackModal from './FeedbackModal';

const FeedbackHarness = () => {
    const [show, setShow] = useState(false);
    return (
        <>
            <button type="button" onClick={() => setShow(true)}>Open feedback</button>
            <FeedbackModal
                show={show}
                onClose={() => setShow(false)}
                onSubmit={vi.fn().mockResolvedValue(undefined)}
                gameContext={null}
            />
        </>
    );
};

describe('FeedbackModal game context', () => {
    test('submits sanitized game diagnostics without the personalized hand', async () => {
        const user = userEvent.setup();
        const onSubmit = vi.fn().mockResolvedValue(undefined);
        render(
            <FeedbackModal
                show
                onClose={() => {}}
                onSubmit={onSubmit}
                gameContext={{
                    tableId: 'table-12',
                    tableName: 'Classic Twelve',
                    state: 'Bidding Phase',
                    playerMode: 4,
                    scores: { Alice: 120, Bob: 120, Cara: 120, Drew: 120 },
                    hands: { Alice: ['PRIVATE-ACE'] },
                    widow: ['PRIVATE-WIDOW'],
                    players: {
                        1: {
                            userId: 1,
                            playerName: 'Alice',
                            isSpectator: false,
                            socketId: 'PRIVATE-SOCKET',
                            tokens: '42.00',
                        },
                    },
                }}
            />,
        );

        await user.type(screen.getByPlaceholderText('Please be as detailed as possible...'), 'The bid prompt stalled.');
        await user.click(screen.getByRole('button', { name: 'Submit' }));

        expect(onSubmit).toHaveBeenCalledWith({
            feedback_text: 'The bid prompt stalled.',
            game_state_json: {
                tableId: 'table-12',
                tableName: 'Classic Twelve',
                state: 'Bidding Phase',
                playerMode: 4,
                scores: { Alice: 120, Bob: 120, Cara: 120, Drew: 120 },
                players: {
                    1: { userId: 1, playerName: 'Alice', isSpectator: false },
                },
            },
        });
        expect(await screen.findByText(/submitted successfully/i)).toBeInTheDocument();
        expect(screen.getByRole('status')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    });

    test('still lets the player omit game diagnostics entirely', async () => {
        const user = userEvent.setup();
        const onSubmit = vi.fn().mockResolvedValue(undefined);
        render(
            <FeedbackModal
                show
                onClose={() => {}}
                onSubmit={onSubmit}
                gameContext={{ tableId: 'table-12', hands: { Alice: ['PRIVATE-ACE'] } }}
            />,
        );

        await user.click(screen.getByRole('checkbox'));
        await user.type(screen.getByPlaceholderText('Please be as detailed as possible...'), 'General suggestion');
        await user.click(screen.getByRole('button', { name: 'Submit' }));

        expect(onSubmit).toHaveBeenCalledWith({ feedback_text: 'General suggestion' });
    });

    test('focuses the dialog and restores the opener when Escape closes it', async () => {
        const user = userEvent.setup();
        render(<FeedbackHarness />);

        const opener = screen.getByRole('button', { name: 'Open feedback' });
        await user.click(opener);

        expect(screen.getByRole('dialog', { name: 'Submit Feedback' })).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Please be as detailed as possible...')).toHaveFocus();

        await user.keyboard('{Escape}');
        expect(screen.queryByRole('dialog', { name: 'Submit Feedback' })).not.toBeInTheDocument();
        expect(opener).toHaveFocus();
    });
});
