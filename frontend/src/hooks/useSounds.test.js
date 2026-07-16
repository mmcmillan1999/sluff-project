import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useSounds } from './useSounds';

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

    test('defaults music to half the hydrated effects volume and inherits legacy mute', () => {
        localStorage.setItem('sluff_sound_volume', JSON.stringify(0.6));
        localStorage.setItem('sluff_sound_muted', JSON.stringify(true));

        const { result } = renderHook(() => useSounds({ musicActive: true }));

        expect(result.current.soundSettings).toMatchObject({
            muted: true,
            volume: 0.6,
            musicMuted: true,
            musicVolume: 0.3,
        });
        expect(localStorage.getItem('sluff_music_muted')).toBe('true');
        expect(localStorage.getItem('sluff_music_volume')).toBe('0.3');
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
        expect(musicGain.gain.value).toBe(0.4);
        expect(musicSource.buffer).toEqual({ decodedUrl: MUSIC_URL });
        expect(musicSource.connect).toHaveBeenCalledWith(musicGain);
        expect(musicSource.start).toHaveBeenCalledTimes(1);

        rerender({ active: false });
        expect(musicGain.gain.value).toBe(0);
        rerender({ active: true });
        expect(musicGain.gain.value).toBe(0.4);
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
