import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AccountSettingsModal from './AccountSettingsModal';
import { changeUsername, deleteAccount } from '../services/api';

vi.mock('../services/api', () => ({
    changeUsername: vi.fn(),
    deleteAccount: vi.fn(),
}));

const ME = { username: 'McSaddle', username_next_change_at: null };

const renderModal = (props = {}) => render(
    <AccountSettingsModal
        show
        user={ME}
        onClose={vi.fn()}
        onUsernameChanged={vi.fn()}
        onAccountDeleted={vi.fn()}
        {...props}
    />
);

describe('AccountSettingsModal — rename', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    test('submits a new name and reports the next unlock', async () => {
        const user = userEvent.setup();
        const onUsernameChanged = vi.fn();
        changeUsername.mockResolvedValue({
            username: 'Ace McGraw',
            nextChangeAllowedAt: new Date(Date.now() + 7 * 86400000).toISOString(),
        });

        renderModal({ onUsernameChanged });
        await user.type(screen.getByLabelText('New username'), 'Ace McGraw');
        await user.click(screen.getByRole('button', { name: 'Save username' }));

        await waitFor(() => expect(changeUsername).toHaveBeenCalledWith('Ace McGraw'));
        expect(onUsernameChanged).toHaveBeenCalledWith('Ace McGraw');
        expect(await screen.findByText("You're now Ace McGraw.")).toBeInTheDocument();
        // The cooldown it just started is reflected without a reload.
        expect(screen.getByLabelText('New username')).toBeDisabled();
    });

    test('a live cooldown disables the form and says when it lifts', () => {
        renderModal({
            user: { ...ME, username_next_change_at: new Date(Date.now() + 3 * 86400000).toISOString() },
        });

        expect(screen.getByText(/you can change it again in 3 days/i)).toBeInTheDocument();
        expect(screen.getByLabelText('New username')).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Save username' })).toBeDisabled();
    });

    test('an expired cooldown leaves the form usable', () => {
        renderModal({
            user: { ...ME, username_next_change_at: new Date(Date.now() - 1000).toISOString() },
        });
        expect(screen.getByLabelText('New username')).toBeEnabled();
    });

    test('surfaces the server refusal instead of a generic failure', async () => {
        const user = userEvent.setup();
        changeUsername.mockRejectedValue(Object.assign(new Error('That username is already taken.'), {
            code: 'USERNAME_TAKEN',
        }));

        renderModal();
        await user.type(screen.getByLabelText('New username'), 'McSaddle2');
        await user.click(screen.getByRole('button', { name: 'Save username' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('That username is already taken.');
    });
});

describe('AccountSettingsModal — deletion', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    test('deletion needs the exact username and a password before it arms', async () => {
        const user = userEvent.setup();
        renderModal();

        await user.click(screen.getByRole('button', { name: 'Delete my account' }));
        const confirm = screen.getByRole('button', { name: 'Permanently delete' });
        expect(confirm).toBeDisabled();

        await user.type(screen.getByLabelText(/type/i), 'mcsaddle'); // wrong case
        await user.type(screen.getByLabelText('Enter your password'), 'hunter22');
        expect(confirm).toBeDisabled();

        await user.clear(screen.getByLabelText(/type/i));
        await user.type(screen.getByLabelText(/type/i), 'McSaddle');
        expect(confirm).toBeEnabled();
    });

    test('confirming deletes the account and hands off to the caller', async () => {
        const user = userEvent.setup();
        const onAccountDeleted = vi.fn();
        deleteAccount.mockResolvedValue({ deleted: true });

        renderModal({ onAccountDeleted });
        await user.click(screen.getByRole('button', { name: 'Delete my account' }));
        await user.type(screen.getByLabelText(/type/i), 'McSaddle');
        await user.type(screen.getByLabelText('Enter your password'), 'hunter22');
        await user.click(screen.getByRole('button', { name: 'Permanently delete' }));

        await waitFor(() => expect(deleteAccount).toHaveBeenCalledWith('hunter22'));
        expect(onAccountDeleted).toHaveBeenCalled();
    });

    test('a rejected password clears the field and keeps the account', async () => {
        const user = userEvent.setup();
        const onAccountDeleted = vi.fn();
        deleteAccount.mockRejectedValue(new Error('That password is incorrect.'));

        renderModal({ onAccountDeleted });
        await user.click(screen.getByRole('button', { name: 'Delete my account' }));
        await user.type(screen.getByLabelText(/type/i), 'McSaddle');
        await user.type(screen.getByLabelText('Enter your password'), 'wrong-one');
        await user.click(screen.getByRole('button', { name: 'Permanently delete' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('That password is incorrect.');
        expect(onAccountDeleted).not.toHaveBeenCalled();
        expect(screen.getByLabelText('Enter your password')).toHaveValue('');
    });

    test('backing out returns to the un-armed state', async () => {
        const user = userEvent.setup();
        renderModal();

        await user.click(screen.getByRole('button', { name: 'Delete my account' }));
        await user.type(screen.getByLabelText('Enter your password'), 'hunter22');
        await user.click(screen.getByRole('button', { name: 'Keep my account' }));

        expect(screen.getByRole('button', { name: 'Delete my account' })).toBeInTheDocument();
        expect(screen.queryByLabelText('Enter your password')).not.toBeInTheDocument();
        expect(deleteAccount).not.toHaveBeenCalled();
    });
});
