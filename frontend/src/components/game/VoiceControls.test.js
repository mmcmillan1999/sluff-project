import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VoiceControls from './VoiceControls';

const voiceHarness = vi.hoisted(() => {
    const behavior = {
        join: async () => undefined,
        setMicrophoneMuted: async () => true,
    };
    const instances = [];

    class MockVoiceChat {
        constructor(socket, tableId, options) {
            this.socket = socket;
            this.tableId = tableId;
            this.options = options;
            this.join = vi.fn(() => behavior.join(this));
            this.leave = vi.fn();
            this.setMicrophoneMuted = vi.fn(muted => behavior.setMicrophoneMuted(this, muted));
            this.setVolume = vi.fn();
            this.setMuted = vi.fn();
            instances.push(this);
        }
    }

    return { behavior, instances, MockVoiceChat };
});

vi.mock('../../utils/VoiceChat', () => ({
    default: voiceHarness.MockVoiceChat,
}));

const socket = { id: 'voice-socket', connected: true, on: vi.fn(), off: vi.fn(), emit: vi.fn() };

const renderVoice = (props = {}) => render(
    <VoiceControls socket={socket} tableId="table-one" {...props} />,
);

describe('VoiceControls', () => {
    beforeEach(() => {
        voiceHarness.instances.length = 0;
        voiceHarness.behavior.join = async () => undefined;
        voiceHarness.behavior.setMicrophoneMuted = async () => true;
    });

    afterEach(() => {
        delete document.visibilityState;
    });

    test('joins automatically and attempts to make the microphone live', async () => {
        renderVoice();

        await waitFor(() => expect(voiceHarness.instances).toHaveLength(1));
        const voice = voiceHarness.instances[0];
        expect(voice.join).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(voice.setMicrophoneMuted).toHaveBeenCalledWith(false));

        expect(screen.getByRole('group', { name: 'Table voice controls' })).toBeInTheDocument();
        const liveButton = screen.getByRole('button', { name: 'Mute microphone' });
        expect(liveButton).toHaveAttribute('aria-pressed', 'false');
        expect(liveButton.querySelector('.voice-icon-slash')).toBeNull();
        expect(screen.queryByText(/mic on|mic muted|starting mic/i)).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /join voice|hold to talk|leave voice/i })).not.toBeInTheDocument();

        fireEvent.keyDown(window, { key: 'v' });
        expect(voice.setMicrophoneMuted).toHaveBeenCalledTimes(1);
    });

    test('uses one self control to mute and unmute the microphone', async () => {
        const user = userEvent.setup();
        renderVoice();
        const voice = await waitFor(() => voiceHarness.instances[0]);

        const muteButton = await screen.findByRole('button', { name: 'Mute microphone' });
        await user.click(muteButton);
        await waitFor(() => expect(voice.setMicrophoneMuted).toHaveBeenLastCalledWith(true));
        const mutedButton = screen.getByRole('button', { name: 'Unmute microphone' });
        expect(mutedButton).toHaveAttribute('aria-pressed', 'true');
        expect(mutedButton.querySelector('.voice-icon-slash')).not.toBeNull();
        expect(screen.queryByText(/mic on|mic muted|starting mic/i)).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Unmute microphone' }));
        await waitFor(() => expect(voice.setMicrophoneMuted).toHaveBeenLastCalledWith(false));
        expect(screen.getByRole('button', { name: 'Mute microphone' })).toHaveAttribute('aria-pressed', 'false');
        expect(voice.setMicrophoneMuted.mock.calls).toEqual([[false], [true], [false]]);
    });

    test('keeps receive voice active when microphone permission fails and allows a retry', async () => {
        const user = userEvent.setup();
        let activationAttempts = 0;
        voiceHarness.behavior.setMicrophoneMuted = async (_voice, muted) => {
            if (!muted && activationAttempts++ === 0) {
                const blocked = new Error('Permission denied');
                blocked.name = 'NotAllowedError';
                throw blocked;
            }
            return true;
        };

        renderVoice();
        const voice = await waitFor(() => voiceHarness.instances[0]);

        expect(await screen.findByRole('alert')).toHaveTextContent(/microphone access was blocked/i);
        expect(voice.leave).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Unmute microphone' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Open voice settings' })).toBeEnabled();

        await user.click(screen.getByRole('button', { name: 'Unmute microphone' }));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Mute microphone' })).toBeEnabled());
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(voice.setMicrophoneMuted.mock.calls).toEqual([[false], [false]]);
    });

    test('mutes on backgrounding and never auto-unmutes on return', async () => {
        const user = userEvent.setup();
        renderVoice();
        const voice = await waitFor(() => voiceHarness.instances[0]);
        await screen.findByRole('button', { name: 'Mute microphone' });

        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            value: 'hidden',
        });
        fireEvent(document, new Event('visibilitychange'));
        await waitFor(() => expect(voice.setMicrophoneMuted).toHaveBeenLastCalledWith(true));
        expect(screen.getByRole('button', { name: 'Unmute microphone' })).toBeEnabled();

        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            value: 'visible',
        });
        fireEvent(document, new Event('visibilitychange'));
        expect(voice.setMicrophoneMuted.mock.calls.filter(([muted]) => muted === false)).toHaveLength(1);

        await user.click(screen.getByRole('button', { name: 'Unmute microphone' }));
        await screen.findByRole('button', { name: 'Mute microphone' });
        fireEvent(window, new Event('pagehide'));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Unmute microphone' })).toBeEnabled());
        expect(voice.setMicrophoneMuted).toHaveBeenLastCalledWith(true);
    });

    test('cleans up the exact voice session and ignores a late join from the previous table', async () => {
        let resolveFirstJoin;
        voiceHarness.behavior.join = voice => (
            voice.tableId === 'table-one'
                ? new Promise(resolve => { resolveFirstJoin = resolve; })
                : Promise.resolve()
        );

        const { rerender, unmount } = renderVoice();
        await waitFor(() => expect(voiceHarness.instances).toHaveLength(1));
        const firstVoice = voiceHarness.instances[0];

        rerender(<VoiceControls socket={socket} tableId="table-two" />);
        await waitFor(() => expect(voiceHarness.instances).toHaveLength(2));
        const secondVoice = voiceHarness.instances[1];
        expect(firstVoice.leave).toHaveBeenCalled();
        await waitFor(() => expect(secondVoice.setMicrophoneMuted).toHaveBeenCalledWith(false));

        await act(async () => {
            resolveFirstJoin();
            await Promise.resolve();
        });
        expect(firstVoice.setMicrophoneMuted).not.toHaveBeenCalled();

        unmount();
        expect(secondVoice.leave).toHaveBeenCalled();
    });

    test('keeps the incoming-player mixer compact and fully labelled', async () => {
        const user = userEvent.setup();
        renderVoice();
        const voice = await waitFor(() => voiceHarness.instances[0]);
        await screen.findByRole('button', { name: 'Mute microphone' });

        act(() => {
            voice.options.onPeersChanged([{
                userId: 7,
                playerName: 'Ben',
                connected: true,
                iceState: 'connected',
                microphoneLive: true,
                muted: false,
                volume: 0.85,
            }]);
        });

        await user.click(screen.getByRole('button', { name: 'Open voice settings' }));
        expect(screen.getByRole('button', { name: 'Close voice settings' })).toHaveAttribute('aria-expanded', 'true');
        const mixer = screen.getByRole('group', { name: 'Voice player volumes' });
        expect(mixer).toHaveTextContent('Ben');
        expect(mixer.closest('.voice-popover-stack').parentElement).toBe(document.body);
        expect(screen.getByText(/microphone active/i)).toBeInTheDocument();

        const slider = screen.getByRole('slider', { name: 'Ben volume' });
        expect(slider).toHaveValue('85');
        expect(slider).toHaveAttribute('aria-valuetext', '85 percent');
        fireEvent.change(slider, { target: { value: '120' } });
        expect(voice.setVolume).toHaveBeenCalledWith(7, 1.2);

        await user.click(screen.getByRole('button', { name: 'Mute Ben' }));
        expect(voice.setMuted).toHaveBeenCalledWith(7, true);
    });
});
