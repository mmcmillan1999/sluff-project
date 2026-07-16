import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AuthContainer from './AuthContainer';

vi.mock('./ClaudeLanding.js', () => ({
    default: ({ inviteTableId, onRegister, onLogin }) => (
        <section>
            <h1>Public Sluff landing</h1>
            {inviteTableId && <p>Invite: {inviteTableId}</p>}
            <button type="button" onClick={onRegister}>Create account</button>
            <button type="button" onClick={onLogin}>Open login</button>
        </section>
    ),
}));

vi.mock('./Login.js', () => ({
    default: ({ onSwitchToRegister, onSwitchToForgotPassword }) => (
        <section>
            <h1>Login screen</h1>
            <button type="button" onClick={onSwitchToRegister}>Register instead</button>
            <button type="button" onClick={onSwitchToForgotPassword}>Forgot password</button>
        </section>
    ),
}));

vi.mock('./Register.js', () => ({
    default: ({ onSwitchToLogin }) => (
        <section>
            <h1>Register screen</h1>
            <button type="button" onClick={onSwitchToLogin}>Login instead</button>
        </section>
    ),
}));

vi.mock('./VerifyEmail.js', () => ({
    default: () => <h1>Verify email screen</h1>,
}));

vi.mock('./RequestPasswordReset.js', () => ({
    default: () => <h1>Forgot password screen</h1>,
}));

vi.mock('./ResetPassword.js', () => ({
    default: () => <h1>Reset password screen</h1>,
}));

describe('AuthContainer front-door routing', () => {
    beforeEach(() => {
        window.history.replaceState({}, '', '/');
    });

    test('starts at the public landing and navigates into registration', async () => {
        const user = userEvent.setup();
        render(<AuthContainer onLoginSuccess={vi.fn()} />);

        expect(screen.getByRole('heading', { name: 'Public Sluff landing' })).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Create account' }));

        expect(window.location.pathname).toBe('/register');
        expect(screen.getByRole('heading', { name: 'Register screen' })).toBeInTheDocument();
    });

    test('keeps an invitation through auth navigation and responds to browser history', async () => {
        const user = userEvent.setup();
        window.history.replaceState({}, '', '/join/table-7');
        render(<AuthContainer onLoginSuccess={vi.fn()} inviteTableId="table-7" />);

        expect(screen.getByText('Invite: table-7')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Open login' }));

        expect(window.location.pathname).toBe('/login');
        expect(window.location.search).toBe('?join=table-7');
        expect(screen.getByRole('status')).toHaveTextContent(/invited you to their table/i);

        act(() => {
            window.history.pushState({}, '', '/join/table-7');
            window.dispatchEvent(new PopStateEvent('popstate'));
        });
        expect(screen.getByRole('heading', { name: 'Public Sluff landing' })).toBeInTheDocument();
    });

    test.each([
        ['/login', 'Login screen'],
        ['/register', 'Register screen'],
        ['/forgot', 'Forgot password screen'],
        ['/verify-email?token=verify-token', 'Verify email screen'],
        ['/reset-password?token=reset-token', 'Reset password screen'],
    ])('honors the %s deep link', (url, heading) => {
        window.history.replaceState({}, '', url);
        render(<AuthContainer onLoginSuccess={vi.fn()} />);
        expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
    });
});
