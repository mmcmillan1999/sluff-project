import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import useModalFocus from './useModalFocus';

const ModalHarness = ({ active = true }) => {
    const modalRef = useModalFocus(active);

    return (
        <div ref={modalRef} data-testid="modal" tabIndex={-1}>
            <button type="button">First action</button>
            <button type="button">Last action</button>
        </div>
    );
};

const appendExternalButton = () => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Previously focused';
    button.dataset.modalFocusExternal = 'true';
    document.body.appendChild(button);
    return button;
};

afterEach(() => {
    document.querySelectorAll('[data-modal-focus-external="true"]')
        .forEach(element => element.remove());
});

describe('useModalFocus', () => {
    test('focuses the first action and wraps Tab in both directions', async () => {
        const user = userEvent.setup();
        render(<ModalHarness />);

        const first = screen.getByRole('button', { name: 'First action' });
        const last = screen.getByRole('button', { name: 'Last action' });
        expect(first).toHaveFocus();

        last.focus();
        await user.tab();
        expect(first).toHaveFocus();

        await user.tab({ shift: true });
        expect(last).toHaveFocus();
    });

    test('restores the element that was focused before the modal mounted', () => {
        const previouslyFocused = appendExternalButton();
        previouslyFocused.focus();

        const { unmount } = render(<ModalHarness />);
        expect(screen.getByRole('button', { name: 'First action' })).toHaveFocus();

        unmount();
        expect(previouslyFocused).toHaveFocus();
    });

    test('does not move or trap focus while inactive', async () => {
        const user = userEvent.setup();
        const previouslyFocused = appendExternalButton();
        previouslyFocused.focus();

        render(
            <>
                <ModalHarness active={false} />
                <button type="button">After modal</button>
            </>
        );

        expect(previouslyFocused).toHaveFocus();

        screen.getByRole('button', { name: 'Last action' }).focus();
        await user.tab();
        expect(screen.getByRole('button', { name: 'After modal' })).toHaveFocus();
    });
});
