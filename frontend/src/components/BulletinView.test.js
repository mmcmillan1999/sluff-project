import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BulletinView from './BulletinView';

describe('BulletinView', () => {
    test('keeps Alpha Season 1 honors provisional while celebrating McSaddle', () => {
        render(<BulletinView onReturnToLobby={() => {}} />);

        expect(screen.getByRole('heading', { name: /first Sluff season/i })).toBeInTheDocument();
        expect(screen.getByText('McSaddle')).toBeInTheDocument();
        expect(screen.getAllByText('To be crowned')).toHaveLength(3);
        expect(screen.getByText(/only after the season is officially closed/i)).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /first Sluff season/i })).toHaveFocus();
    });

    test('shows the development journal and returns to the lobby', async () => {
        const user = userEvent.setup();
        const onReturnToLobby = vi.fn();
        render(<BulletinView onReturnToLobby={onReturnToLobby} />);

        expect(screen.getByRole('heading', { name: /build so far/i })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Every token accounted for' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'The table comes alive' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'A safer foundation' })).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Lobby' }));
        expect(onReturnToLobby).toHaveBeenCalledTimes(1);
    });
});
