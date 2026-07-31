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

// Table voice is opt-in and off by default, so every test below that exercises
// the connected behaviour has to turn it on first — the same one-time choice a
// real player makes.
describe('VoiceControls', () => {
    beforeEach(() => {
        voiceHarness.instances.length = 0;
        voiceHarness.behavior.join = async () => undefined;
        voiceHarness.behavior.setMicrophoneMuted = async () => true;
        window.localStorage.setItem('sluff_voice_enabled', 'true');
    });

    afterEach(() => {
        delete document.visibilityState;
        window.localStorage.clear();
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

    test('a device that already refused the microphone is not asked again automatically', async () => {
        const user = userEvent.setup();
        window.localStorage.setItem('sluff_mic_capture_refused', 'true');

        renderVoice();
        const voice = await waitFor(() => voiceHarness.instances[0]);
        const unmuteButton = await screen.findByRole('button', { name: 'Unmute microphone' });
        await waitFor(() => expect(unmuteButton).toBeEnabled());

        // Auto-join stays listen-only: on iOS the automatic getUserMedia
        // seizes the audio session and was killing all game sound.
        expect(voice.join).toHaveBeenCalledTimes(1);
        expect(voice.setMicrophoneMuted).not.toHaveBeenCalled();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();

        // A deliberate tap still asks, and success clears the memory.
        await user.click(unmuteButton);
        await waitFor(() => expect(voice.setMicrophoneMuted).toHaveBeenCalledWith(false));
        await waitFor(() => {
            expect(window.localStorage.getItem('sluff_mic_capture_refused')).toBeNull();
        });
    });

    test('a refused microphone is remembered so the next table stays quiet about it', async () => {
        voiceHarness.behavior.setMicrophoneMuted = async (_voice, muted) => {
            if (!muted) {
                const blocked = new Error('Permission denied');
                blocked.name = 'NotAllowedError';
                throw blocked;
            }
            return true;
        };

        renderVoice();
        expect(await screen.findByRole('alert')).toHaveTextContent(/microphone access was blocked/i);
        expect(window.localStorage.getItem('sluff_mic_capture_refused')).toBe('true');
    });

    test('a granted report alone does not clear the memory — only working capture does', async () => {
        // Site-level 'granted' says nothing about an OS-level mic block
        // (Windows privacy toggle, macOS TCC): capture still fails there, and
        // letting 'granted' clear the flag re-created the doomed attempt plus
        // error banner at every table.
        window.localStorage.setItem('sluff_mic_capture_refused', 'true');
        Object.defineProperty(navigator, 'permissions', {
            configurable: true,
            value: { query: vi.fn(async () => ({ state: 'granted' })) },
        });

        try {
            renderVoice();
            const voice = await waitFor(() => voiceHarness.instances[0]);
            const unmuteButton = await screen.findByRole('button', { name: 'Unmute microphone' });
            await waitFor(() => expect(unmuteButton).toBeEnabled());
            expect(voice.setMicrophoneMuted).not.toHaveBeenCalled();
            expect(window.localStorage.getItem('sluff_mic_capture_refused')).toBe('true');
            expect(screen.getByRole('status')).toHaveTextContent(/mic is off/i);
        } finally {
            delete navigator.permissions;
        }
    });

    test('a prompt that times out is not remembered as a refusal', async () => {
        // The player never answered (or answered too late) — that is not a
        // denial, and remembering it as one silenced slow-to-Allow players
        // forever on Safari, where the Permissions API can never self-heal.
        voiceHarness.behavior.setMicrophoneMuted = async (_voice, muted) => {
            if (!muted) {
                const timeout = new Error('Timed out waiting for microphone permission.');
                timeout.name = 'TimeoutError';
                throw timeout;
            }
            return true;
        };

        renderVoice();
        expect(await screen.findByRole('alert')).toHaveTextContent(/timed out/i);
        expect(window.localStorage.getItem('sluff_mic_capture_refused')).toBeNull();
    });

    test('a device the OS is withholding is remembered like a denial', async () => {
        voiceHarness.behavior.setMicrophoneMuted = async (_voice, muted) => {
            if (!muted) {
                const unreadable = new Error('Could not start audio source');
                unreadable.name = 'NotReadableError';
                throw unreadable;
            }
            return true;
        };

        renderVoice();
        expect(await screen.findByRole('alert')).toHaveTextContent(/could not start/i);
        expect(window.localStorage.getItem('sluff_mic_capture_refused')).toBe('true');
    });

    test("the 'Turn on voice' tap asks even on a device that refused before", async () => {
        const user = userEvent.setup();
        window.localStorage.setItem('sluff_voice_enabled', 'false');
        window.localStorage.setItem('sluff_mic_capture_refused', 'true');

        renderVoice();
        await user.click(screen.getByRole('button', { name: /turn on voice/i }));

        // The tap is the player asking to talk right now — the remembered
        // refusal gates only routine table entries, never this.
        const voice = await waitFor(() => voiceHarness.instances[0]);
        await waitFor(() => expect(voice.setMicrophoneMuted).toHaveBeenCalledWith(false));
        await waitFor(() => {
            expect(window.localStorage.getItem('sluff_mic_capture_refused')).toBeNull();
        });
    });

    test('a table change during the permission check cannot touch the new session', async () => {
        const user = userEvent.setup();
        window.localStorage.setItem('sluff_mic_capture_refused', 'true');
        let resolveFirstQuery;
        const firstQuery = new Promise((resolve) => { resolveFirstQuery = resolve; });
        Object.defineProperty(navigator, 'permissions', {
            configurable: true,
            value: {
                query: vi.fn()
                    .mockReturnValueOnce(firstQuery)
                    .mockResolvedValue({ state: 'prompt' }),
            },
        });

        try {
            const { rerender } = render(<VoiceControls socket={socket} tableId="table-one" />);
            await waitFor(() => expect(voiceHarness.instances).toHaveLength(1));

            // Table change while the first session's permission check hangs.
            rerender(<VoiceControls socket={socket} tableId="table-two" />);
            await waitFor(() => expect(voiceHarness.instances).toHaveLength(2));
            const unmuteButton = await screen.findByRole('button', { name: 'Unmute microphone' });
            await waitFor(() => expect(unmuteButton).toBeEnabled());
            await user.click(unmuteButton);
            await waitFor(() => {
                expect(screen.getByRole('button', { name: 'Mute microphone' })).toBeEnabled();
            });

            // The first session's continuation finally resolves; without the
            // staleness re-check it would stamp 'muted' over a live mic.
            await act(async () => { resolveFirstQuery({ state: 'prompt' }); });
            expect(screen.getByRole('button', { name: 'Mute microphone' })).toBeEnabled();
        } finally {
            delete navigator.permissions;
        }
    });

    test('a browser that reports denied skips the doomed attempt entirely', async () => {
        Object.defineProperty(navigator, 'permissions', {
            configurable: true,
            value: { query: vi.fn(async () => ({ state: 'denied' })) },
        });

        try {
            renderVoice();
            const voice = await waitFor(() => voiceHarness.instances[0]);
            const unmuteButton = await screen.findByRole('button', { name: 'Unmute microphone' });
            await waitFor(() => expect(unmuteButton).toBeEnabled());
            expect(voice.setMicrophoneMuted).not.toHaveBeenCalled();
            expect(window.localStorage.getItem('sluff_mic_capture_refused')).toBe('true');
        } finally {
            delete navigator.permissions;
        }
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

// The whole point of the opt-in: sitting at a table must not reach the
// microphone. These assert the absence of behaviour, which is the guarantee
// Apple 5.1.1/5.1.2 actually cares about.
describe('VoiceControls opt-in gate', () => {
    beforeEach(() => {
        voiceHarness.instances.length = 0;
        voiceHarness.behavior.join = async () => undefined;
        voiceHarness.behavior.setMicrophoneMuted = async () => true;
        window.localStorage.clear();
    });

    afterEach(() => {
        window.localStorage.clear();
    });

    test('is off by default and never constructs a voice session', async () => {
        renderVoice();

        // No VoiceChat at all means no signalling and, crucially, no getUserMedia.
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(voiceHarness.instances).toHaveLength(0);
        expect(screen.getByRole('button', { name: /turn on voice/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /mute microphone/i })).not.toBeInTheDocument();
    });

    test('opting in joins and goes live, and the choice persists', async () => {
        const user = userEvent.setup();
        renderVoice();

        await user.click(screen.getByRole('button', { name: /turn on voice/i }));

        await waitFor(() => expect(voiceHarness.instances).toHaveLength(1));
        const voice = voiceHarness.instances[0];
        expect(voice.join).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(voice.setMicrophoneMuted).toHaveBeenCalledWith(false));
        expect(JSON.parse(window.localStorage.getItem('sluff_voice_enabled'))).toBe(true);
    });

    test('a stored opt-in joins straight away without asking again', async () => {
        window.localStorage.setItem('sluff_voice_enabled', 'true');
        renderVoice();

        await waitFor(() => expect(voiceHarness.instances).toHaveLength(1));
        expect(screen.queryByRole('button', { name: /turn on voice/i })).not.toBeInTheDocument();
    });

    test('corrupt storage fails closed rather than opening the mic', async () => {
        window.localStorage.setItem('sluff_voice_enabled', '{not json');
        renderVoice();

        await new Promise(resolve => setTimeout(resolve, 20));
        expect(voiceHarness.instances).toHaveLength(0);
        expect(screen.getByRole('button', { name: /turn on voice/i })).toBeInTheDocument();
    });

    test('turning voice back off tears the session down', async () => {
        const user = userEvent.setup();
        window.localStorage.setItem('sluff_voice_enabled', 'true');
        renderVoice();

        await waitFor(() => expect(voiceHarness.instances).toHaveLength(1));
        const voice = voiceHarness.instances[0];

        await user.click(screen.getByRole('button', { name: /open voice settings/i }));
        await user.click(screen.getByRole('button', { name: /turn off voice chat/i }));

        await waitFor(() => expect(voice.leave).toHaveBeenCalled());
        expect(screen.getByRole('button', { name: /turn on voice/i })).toBeInTheDocument();
        expect(JSON.parse(window.localStorage.getItem('sluff_voice_enabled'))).toBe(false);
    });
});
