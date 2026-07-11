import React, { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HowToPlayModal from './HowToPlayModal';

const RulesHarness = () => {
    const [show, setShow] = useState(false);
    return (
        <>
            <button type="button" onClick={() => setShow(true)}>Open rules</button>
            <HowToPlayModal show={show} onClose={() => setShow(false)} />
        </>
    );
};

describe('HowToPlayModal', () => {
    test('renders canonical bid multipliers and the deliberate-flick rule', async () => {
        const user = userEvent.setup();
        render(<RulesHarness />);

        await user.click(screen.getByRole('button', { name: 'Open rules' }));
        const dialog = screen.getByRole('dialog', { name: 'How to Play' });

        expect(within(dialog).getByText((_, element) => element.tagName === 'STRONG' && element.textContent === 'Frog 1×')).toBeInTheDocument();
        expect(within(dialog).getByText((_, element) => element.tagName === 'STRONG' && element.textContent === 'Solo 2×')).toBeInTheDocument();
        expect(within(dialog).getByText((_, element) => element.tagName === 'STRONG' && element.textContent === 'Heart Solo 3×')).toBeInTheDocument();
        expect(within(dialog).getByText(/deliberately flick a legal card/i)).toBeInTheDocument();
        expect(within(dialog).getByText(/not truly thrown settles back into your hand/i)).toBeInTheDocument();
    });

    test('Escape closes the dialog and restores focus to its opener', async () => {
        const user = userEvent.setup();
        render(<RulesHarness />);

        const opener = screen.getByRole('button', { name: 'Open rules' });
        await user.click(opener);
        expect(screen.getByRole('button', { name: 'Close How to Play' })).toHaveFocus();

        await user.keyboard('{Escape}');

        expect(screen.queryByRole('dialog', { name: 'How to Play' })).not.toBeInTheDocument();
        expect(opener).toHaveFocus();
    });

    test('offers a clearly priced guided replay and closes after it starts', async () => {
        const user = userEvent.setup();
        const onStartGuidedGame = vi.fn().mockResolvedValue(undefined);
        const onClose = vi.fn();
        render(
            <HowToPlayModal
                show
                onClose={onClose}
                onStartGuidedGame={onStartGuidedGame}
            />
        );

        expect(screen.getByText(/guided Academy game · 0\.10 coin/i)).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Play Guided Game' }));

        expect(onStartGuidedGame).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    test('does not cancel a guided launch while its durable start is pending', async () => {
        const user = userEvent.setup();
        let resolveStart;
        const onStartGuidedGame = vi.fn(() => new Promise(resolve => { resolveStart = resolve; }));
        const onClose = vi.fn();
        render(
            <HowToPlayModal
                show
                onClose={onClose}
                onStartGuidedGame={onStartGuidedGame}
            />
        );

        await user.click(screen.getByRole('button', { name: 'Play Guided Game' }));
        await user.keyboard('{Escape}');
        expect(onClose).not.toHaveBeenCalled();

        resolveStart();
        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    });
});
