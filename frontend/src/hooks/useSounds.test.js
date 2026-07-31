import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useSounds } from './useSounds';
import VoiceChat, { resetAudioSessionAccountingForTests } from '../utils/VoiceChat';

const MUSIC_URL = '/Music/upbeat-game-loop-v1.mp3';

const makeGainNode = () => {
    const gain = {
        value: 0,
        cancelScheduledValues: vi.fn(),
        setValueAtTime: vi.fn((value) => { gain.value = value; }),
        linearRampToValueAtTime: vi.fn((value) => { gain.value = value; }),
        setTargetAtTime: vi.fn((value) => { gain.value = value; }),
    };
    return { gain, connect: vi.fn() };
};

const contexts = [];

class MockAudioContext {
    constructor() {
        this.state = 'suspended';
        this.currentTime = 4;
        this.destination = { kind: 'destination' };
        this.gains = [];
        this.sources = [];
        this.decodeAudioData = vi.fn((data, onSuccess) => {
            queueMicrotask(() => onSuccess({ decodedUrl: data.url }));
        });
        this.resume = vi.fn(() => {
            this.state = 'running';
            return Promise.resolve();
        });
        this.suspend = vi.fn(() => {
            this.state = 'suspended';
            return Promise.resolve();
        });
        this.close = vi.fn(() => {
            this.state = 'closed';
            return Promise.resolve();
        });
        contexts.push(this);
    }

    createGain() {
        const node = makeGainNode();
        this.gains.push(node);
        return node;
    }

    createBuffer() {
        return { silent: true };
    }

    createBufferSource() {
        const source = {
            buffer: null,
            loop: false,
            connect: vi.fn(),
            disconnect: vi.fn(),
            start: vi.fn(),
            stop: vi.fn(),
            onended: null,
        };
        this.sources.push(source);
        return source;
    }
}

const successfulResponse = url => Promise.resolve({
    ok: true,
    status: 200,
    arrayBuffer: () => Promise.resolve({ url }),
});
const successfulFetch = vi.fn(successfulResponse);

describe('useSounds music channel', () => {
    let errorSpy;

    beforeEach(() => {
        contexts.length = 0;
        localStorage.clear();
        successfulFetch.mockReset();
        successfulFetch.mockImplementation(successfulResponse);
        vi.stubGlobal('AudioContext', MockAudioContext);
        vi.stubGlobal('fetch', successfulFetch);
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        errorSpy.mockRestore();
        vi.unstubAllGlobals();
    });

    test('migrates the original automatic level to fifteen percent and inherits legacy mute', () => {
        localStorage.setItem('sluff_sound_volume', JSON.stringify(0.6));
        localStorage.setItem('sluff_sound_muted', JSON.stringify(true));
        localStorage.setItem('sluff_music_volume', JSON.stringify(0.3));

        const { result } = renderHook(() => useSounds({ musicActive: true }));

        expect(result.current.soundSettings).toMatchObject({
            muted: true,
            volume: 0.6,
            musicMuted: true,
            musicVolume: 0.15,
        });
        expect(localStorage.getItem('sluff_music_muted')).toBe('true');
        expect(localStorage.getItem('sluff_music_volume')).toBe('0.15');
        expect(localStorage.getItem('sluff_music_default_version')).toBe('2');
    });

    test('preserves a deliberately customized music level', () => {
        localStorage.setItem('sluff_sound_volume', JSON.stringify(0.7));
        localStorage.setItem('sluff_music_volume', JSON.stringify(0.22));

        const { result } = renderHook(() => useSounds({ musicActive: true }));

        expect(result.current.soundSettings.musicVolume).toBe(0.22);
        expect(localStorage.getItem('sluff_music_volume')).toBe('0.22');
        expect(localStorage.getItem('sluff_music_default_version')).toBe('2');
    });

    test('starts one persistent loop and changes channel gains without restarting it', async () => {
        localStorage.setItem('sluff_sound_volume', JSON.stringify(0.8));

        const { result, rerender, unmount } = renderHook(
            ({ active }) => useSounds({ musicActive: active }),
            { initialProps: { active: true }, wrapper: React.StrictMode }
        );

        act(() => result.current.enableSound());
        const ctx = contexts[0];

        await waitFor(() => {
            expect(ctx.sources.filter(source => source.loop)).toHaveLength(1);
        });

        const effectsGain = ctx.gains[0];
        const musicGain = ctx.gains[1];
        const musicSource = ctx.sources.find(source => source.loop);
        expect(effectsGain.gain.value).toBe(0.8);
        expect(musicGain.gain.value).toBe(0.15);
        expect(musicSource.buffer).toEqual({ decodedUrl: MUSIC_URL });
        expect(musicSource.connect).toHaveBeenCalledWith(musicGain);
        expect(musicSource.start).toHaveBeenCalledTimes(1);

        rerender({ active: false });
        expect(musicGain.gain.value).toBe(0);
        rerender({ active: true });
        expect(musicGain.gain.value).toBe(0.15);
        expect(ctx.sources.filter(source => source.loop)).toHaveLength(1);
        expect(musicSource.start).toHaveBeenCalledTimes(1);

        act(() => result.current.soundSettings.setMusicVolume(0.25));
        expect(musicGain.gain.value).toBe(0.25);
        act(() => result.current.soundSettings.toggleMusicMute());
        expect(musicGain.gain.value).toBe(0);
        expect(effectsGain.gain.value).toBe(0.8);
        act(() => result.current.soundSettings.toggleMute());
        expect(effectsGain.gain.value).toBe(0);
        act(() => result.current.soundSettings.toggleMusicMute());
        expect(musicGain.gain.value).toBe(0.25);
        expect(effectsGain.gain.value).toBe(0);

        unmount();
        expect(musicSource.stop).toHaveBeenCalledTimes(1);
        expect(ctx.close).toHaveBeenCalledTimes(1);
    });

    test('suspends while hidden and resumes the unlocked context on return', () => {
        const originalVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');
        const { result } = renderHook(() => useSounds({ musicActive: true }));
        act(() => result.current.enableSound());
        const ctx = contexts[0];

        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
        act(() => document.dispatchEvent(new Event('visibilitychange')));
        expect(ctx.suspend).toHaveBeenCalledTimes(1);

        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
        act(() => document.dispatchEvent(new Event('visibilitychange')));
        expect(ctx.resume).toHaveBeenCalledTimes(2);

        if (originalVisibility) {
            Object.defineProperty(document, 'visibilityState', originalVisibility);
        } else {
            delete document.visibilityState;
        }
    });

    test('keeps effects usable when the music asset fails', async () => {
        fetch.mockImplementation(url => {
            if (url === MUSIC_URL) return Promise.reject(new Error('music unavailable'));
            return Promise.resolve({
                ok: true,
                status: 200,
                arrayBuffer: () => Promise.resolve({ url }),
            });
        });

        const { result } = renderHook(() => useSounds({ musicActive: true }));
        act(() => result.current.enableSound());
        const ctx = contexts[0];

        await waitFor(() => {
            expect(ctx.decodeAudioData).toHaveBeenCalledTimes(16);
            expect(errorSpy).toHaveBeenCalledWith(
                'Failed to load background music:',
                expect.any(Error)
            );
        });

        act(() => result.current.playSound('cardPlay'));
        const effectSource = ctx.sources.find(
            source => source.buffer?.decodedUrl === '/Sounds/card_play.mp3'
        );
        expect(effectSource).toBeDefined();
        expect(effectSource.connect).toHaveBeenCalledWith(ctx.gains[0]);
        expect(effectSource.start).toHaveBeenCalledTimes(1);
        expect(ctx.sources.some(source => source.loop)).toBe(false);
    });
});

// iOS WebKit parks a context in the non-standard 'interrupted' state when the
// system takes the audio session (a mic permission prompt, a phone call,
// Siri). Every recovery path must treat it exactly like 'suspended', or the
// game goes silent until page reload.
describe('useSounds iOS interruption recovery', () => {
    let originalVisibility;

    beforeEach(() => {
        contexts.length = 0;
        localStorage.clear();
        resetAudioSessionAccountingForTests();
        successfulFetch.mockReset();
        successfulFetch.mockImplementation(successfulResponse);
        vi.stubGlobal('AudioContext', MockAudioContext);
        vi.stubGlobal('fetch', successfulFetch);
        originalVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    });

    afterEach(() => {
        if (originalVisibility) {
            Object.defineProperty(document, 'visibilityState', originalVisibility);
        } else {
            delete document.visibilityState;
        }
        vi.unstubAllGlobals();
    });

    test('declares the playback audio session so the iOS silent switch cannot mute the game', () => {
        Object.defineProperty(navigator, 'audioSession', {
            configurable: true,
            value: { type: 'auto' },
        });
        try {
            const { result } = renderHook(() => useSounds());
            act(() => result.current.enableSound());
            expect(navigator.audioSession.type).toBe('playback');
        } finally {
            delete navigator.audioSession;
        }
    });

    test('a fully muted game stays off the media channel and returns on unmute', () => {
        // Claiming 'playback' pauses the player's own music app; a game whose
        // every channel is muted has no business doing that.
        localStorage.setItem('sluff_sound_muted', JSON.stringify(true));
        localStorage.setItem('sluff_music_muted', JSON.stringify(true));
        Object.defineProperty(navigator, 'audioSession', {
            configurable: true,
            value: { type: 'auto' },
        });
        try {
            const { result } = renderHook(() => useSounds({ musicActive: true }));
            act(() => result.current.enableSound());
            expect(navigator.audioSession.type).toBe('ambient');

            act(() => result.current.soundSettings.toggleMute());
            expect(navigator.audioSession.type).toBe('playback');
        } finally {
            delete navigator.audioSession;
        }
    });

    test('never downgrades an active capture declaration', () => {
        // Per the Audio Session spec, moving the type off play-and-record
        // under live capture ENDS the microphone track. VoiceChat owns that
        // declaration; this hook must keep its hands off until released.
        // Fully muted settings make the hook WANT 'ambient', so each
        // assertion below proves restraint (and then the listener) actually
        // ran rather than passing by coincidence.
        localStorage.setItem('sluff_sound_muted', JSON.stringify(true));
        localStorage.setItem('sluff_music_muted', JSON.stringify(true));
        Object.defineProperty(navigator, 'audioSession', {
            configurable: true,
            value: { type: 'play-and-record' },
        });
        try {
            const { result } = renderHook(() => useSounds());
            act(() => result.current.enableSound());
            expect(navigator.audioSession.type).toBe('play-and-record');

            // The release announcement hands control back to the hook, which
            // then applies its own (fully muted -> 'ambient') preference.
            act(() => {
                navigator.audioSession.type = 'playback';
                window.dispatchEvent(new Event('sluff:audio-session-released'));
            });
            expect(navigator.audioSession.type).toBe('ambient');
        } finally {
            delete navigator.audioSession;
        }
    });

    test('a live listen-only voice session pins the media channel over the mute preference', async () => {
        // Peer voice plays through VoiceChat's WebAudio graph, so even a
        // fully muted game must not drop the session to 'ambient' while a
        // voice room is joined — 'ambient' hands peer audio to the silent
        // switch.
        localStorage.setItem('sluff_sound_muted', JSON.stringify(true));
        localStorage.setItem('sluff_music_muted', JSON.stringify(true));
        Object.defineProperty(navigator, 'audioSession', {
            configurable: true,
            value: { type: 'auto' },
        });
        const socket = { emit: vi.fn(), on: vi.fn(), off: vi.fn(), connected: true };
        const voice = new VoiceChat(socket, 'table-7');
        try {
            await voice.join();
            const { result } = renderHook(() => useSounds({ musicActive: true }));
            act(() => result.current.enableSound());
            expect(navigator.audioSession.type).toBe('playback');

            // Leaving voice releases the claim; the muted game may now yield
            // the media channel back to the player's own music app.
            act(() => voice.leave());
            expect(navigator.audioSession.type).toBe('ambient');
        } finally {
            voice.leave();
            delete navigator.audioSession;
        }
    });

    test('resumes the moment the context reports interrupted', () => {
        const { result } = renderHook(() => useSounds());
        act(() => result.current.enableSound());
        const ctx = contexts[0];
        expect(ctx.resume).toHaveBeenCalledTimes(1);

        ctx.state = 'interrupted';
        act(() => ctx.onstatechange());
        expect(ctx.resume).toHaveBeenCalledTimes(2);
    });

    test('playSound revives an interrupted context instead of playing into a frozen clock', async () => {
        const { result } = renderHook(() => useSounds());
        act(() => result.current.enableSound());
        const ctx = contexts[0];
        await waitFor(() => {
            expect(ctx.decodeAudioData.mock.calls.length).toBeGreaterThanOrEqual(16);
        });

        ctx.state = 'interrupted';
        act(() => result.current.playSound('cardPlay'));
        expect(ctx.resume).toHaveBeenCalledTimes(2);
    });

    test('the gesture safety net stays armed after the first unlock', () => {
        renderHook(() => useSounds());
        act(() => window.dispatchEvent(new Event('pointerdown')));
        const ctx = contexts[0];
        const silentSources = () => ctx.sources.filter(source => source.buffer?.silent).length;
        expect(ctx.resume).toHaveBeenCalledTimes(1);
        expect(silentSources()).toBe(1);

        // Before this net became persistent, the listeners removed themselves
        // on the first gesture and a later interruption was unrecoverable by
        // touch.
        ctx.state = 'interrupted';
        act(() => window.dispatchEvent(new Event('pointerdown')));
        expect(ctx.resume).toHaveBeenCalledTimes(2);
        // The iOS silent-buffer unlock runs once, not per gesture — a
        // persistent listener must not mean per-tap Web Audio churn.
        expect(silentSources()).toBe(1);
    });

    test('returning to the foreground revives an interrupted context', () => {
        const { result } = renderHook(() => useSounds());
        act(() => result.current.enableSound());
        const ctx = contexts[0];

        ctx.state = 'interrupted';
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
        act(() => document.dispatchEvent(new Event('visibilitychange')));
        expect(ctx.resume).toHaveBeenCalledTimes(2);
    });

    test('does not fight the deliberate suspend while backgrounded', () => {
        const { result } = renderHook(() => useSounds());
        act(() => result.current.enableSound());
        const ctx = contexts[0];

        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
        act(() => document.dispatchEvent(new Event('visibilitychange')));
        expect(ctx.suspend).toHaveBeenCalledTimes(1);

        // The suspend fires a state change; resuming here would undo it.
        act(() => ctx.onstatechange());
        expect(ctx.resume).toHaveBeenCalledTimes(1);
    });
});
