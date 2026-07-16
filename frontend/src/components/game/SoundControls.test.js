import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SoundControls from './SoundControls';

const makeSettings = overrides => ({
    muted: false,
    volume: 0.7,
    toggleMute: vi.fn(),
    setVolume: vi.fn(),
    musicMuted: false,
    musicVolume: 0.15,
    toggleMusicMute: vi.fn(),
    setMusicVolume: vi.fn(),
    ...overrides,
});

describe('SoundControls', () => {
    test('presents independent, labelled effects and music controls', () => {
        render(<SoundControls soundSettings={makeSettings()} />);

        const controls = screen.getByRole('group', { name: 'Audio controls' });
        expect(controls).toHaveTextContent('Effects');
        expect(controls).toHaveTextContent('Music');
        expect(screen.getByRole('button', { name: 'Mute sound effects' })).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByRole('button', { name: 'Mute music' })).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByRole('slider', { name: 'Sound effects volume' })).toHaveValue('70');
        expect(screen.getByRole('slider', { name: 'Music volume' })).toHaveValue('15');
    });

    test('mute buttons operate only their own audio channel', async () => {
        const user = userEvent.setup();
        const settings = makeSettings();
        render(<SoundControls soundSettings={settings} />);

        await user.click(screen.getByRole('button', { name: 'Mute sound effects' }));
        expect(settings.toggleMute).toHaveBeenCalledTimes(1);
        expect(settings.toggleMusicMute).not.toHaveBeenCalled();

        await user.click(screen.getByRole('button', { name: 'Mute music' }));
        expect(settings.toggleMusicMute).toHaveBeenCalledTimes(1);
        expect(settings.toggleMute).toHaveBeenCalledTimes(1);
    });

    test('moving a muted slider above zero unmutes only that channel', () => {
        const settings = makeSettings({ muted: true, musicMuted: true });
        render(<SoundControls soundSettings={settings} />);

        fireEvent.change(screen.getByRole('slider', { name: 'Sound effects volume' }), {
            target: { value: '25' },
        });
        expect(settings.setVolume).toHaveBeenCalledWith(0.25);
        expect(settings.toggleMute).toHaveBeenCalledTimes(1);
        expect(settings.setMusicVolume).not.toHaveBeenCalled();
        expect(settings.toggleMusicMute).not.toHaveBeenCalled();

        fireEvent.change(screen.getByRole('slider', { name: 'Music volume' }), {
            target: { value: '40' },
        });
        expect(settings.setMusicVolume).toHaveBeenCalledWith(0.4);
        expect(settings.toggleMusicMute).toHaveBeenCalledTimes(1);
        expect(settings.toggleMute).toHaveBeenCalledTimes(1);
    });

    test('does not toggle mute when a slider is moved to zero', () => {
        const settings = makeSettings();
        render(<SoundControls soundSettings={settings} />);

        fireEvent.change(screen.getByRole('slider', { name: 'Music volume' }), {
            target: { value: '0' },
        });
        expect(settings.setMusicVolume).toHaveBeenCalledWith(0);
        expect(settings.toggleMusicMute).not.toHaveBeenCalled();
    });

    test('uses the compact footer layout without removing accessible labels', () => {
        render(<SoundControls soundSettings={makeSettings()} compact />);

        expect(screen.getByRole('group', { name: 'Audio controls' })).toHaveClass('compact');
        expect(screen.getByRole('slider', { name: 'Sound effects volume' })).toBeInTheDocument();
        expect(screen.getByRole('slider', { name: 'Music volume' })).toBeInTheDocument();
    });
});
