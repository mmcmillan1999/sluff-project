import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PublicLanding from './PublicLanding';

describe('PublicLanding', () => {
    test('welcomes a new visitor into Alpha Season 2', async () => {
        const user = userEvent.setup();
        const onRegister = vi.fn();
        const onLogin = vi.fn();

        render(<PublicLanding onRegister={onRegister} onLogin={onLogin} />);

        expect(screen.getByRole('heading', { name: /pick your card\. send it\./i })).toBeInTheDocument();
        expect(screen.getByText(/Now playing · Alpha Season 2/i)).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /take your first seat at the Academy/i })).toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: /join Alpha Season 2/i })).toHaveLength(2);
        expect(screen.queryByRole('status')).not.toBeInTheDocument();

        await user.click(screen.getAllByRole('button', { name: /join Alpha Season 2/i })[0]);
        expect(onRegister).toHaveBeenCalledTimes(1);

        await user.click(screen.getByRole('button', { name: 'Sign in' }));
        expect(onLogin).toHaveBeenCalledTimes(1);
    });

    test('recognizes an invited player and keeps the table-focused call to action', async () => {
        const user = userEvent.setup();
        const onRegister = vi.fn();

        render(
            <PublicLanding
                inviteTableId="table-7"
                onRegister={onRegister}
                onLogin={vi.fn()}
            />
        );

        expect(screen.getByRole('status')).toHaveTextContent(/seat waiting at a Sluff table/i);
        expect(screen.getAllByRole('button', { name: /join your table/i })).toHaveLength(2);
        expect(screen.getByRole('heading', { name: /your seat is waiting/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /join Alpha Season 2/i })).not.toBeInTheDocument();

        await user.click(screen.getAllByRole('button', { name: /join your table/i })[1]);
        expect(onRegister).toHaveBeenCalledTimes(1);
    });
});
