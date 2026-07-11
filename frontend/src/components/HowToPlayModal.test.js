import React, { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
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
});
