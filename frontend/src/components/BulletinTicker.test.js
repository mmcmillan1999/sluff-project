import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BulletinTicker from './BulletinTicker';

describe('BulletinTicker', () => {
    test('opens the bulletin without exposing duplicated animation text to assistive technology', async () => {
        const user = userEvent.setup();
        const onOpen = vi.fn();
        render(<BulletinTicker onOpen={onOpen} />);

        const openButton = screen.getByRole('button', {
            name: 'Open Sluff Bulletin: Alpha Season 1 honors and development news',
        });
        expect(screen.getByText(/Alpha Season 1 honors and Sluff development news/i)).toBeInTheDocument();

        await user.click(openButton);
        expect(onOpen).toHaveBeenCalledTimes(1);
    });

    test('lets the player pause and resume the moving headlines', async () => {
        const user = userEvent.setup();
        const { container } = render(<BulletinTicker onOpen={() => {}} />);
        const track = container.querySelector('.bulletin-ticker-track');

        const pauseButton = screen.getByRole('button', { name: 'Pause bulletin ticker' });
        await user.click(pauseButton);

        expect(screen.getByRole('button', { name: 'Resume bulletin ticker' })).toHaveAttribute('aria-pressed', 'true');
        expect(track).toHaveAttribute('data-paused', 'true');

        await user.click(screen.getByRole('button', { name: 'Resume bulletin ticker' }));
        expect(screen.getByRole('button', { name: 'Pause bulletin ticker' })).toHaveAttribute('aria-pressed', 'false');
        expect(track).toHaveAttribute('data-paused', 'false');
    });
});
