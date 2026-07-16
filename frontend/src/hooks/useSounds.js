import { useState, useEffect, useRef, useCallback } from 'react';

// Short effects and the music bed share one unlocked Web Audio context so they
// mix reliably on mobile. Each channel has its own gain node and preferences.
const SOUND_FILES = {
    turnAlert: '/Sounds/turn_alert.mp3',
    cardPlay: '/Sounds/card_play.mp3',
    trickWin: '/Sounds/trick_win.mp3',
    cardDeal: '/Sounds/card_dealing_3s_v1.mp3',
    trumpBroken: '/Sounds/trump_broken_v6.mp3',
    bidFrog: '/Sounds/bid_frog_v1.mp3',
    bidSolo: '/Sounds/bid_solo_v1.mp3',
    bidHeartSolo: '/Sounds/bid_heart_solo_v1.mp3',
    bidAllPass: '/Sounds/bid_all_pass_v1.mp3',
    bidPass: '/Sounds/bid_pass_v1.mp3',
    suitSpades: '/Sounds/suit_spades_v1.mp3',
    suitClubs: '/Sounds/suit_clubs_v1.mp3',
    suitDiamonds: '/Sounds/suit_diamonds_v1.mp3',
    roundEnd: '/Sounds/round_end_v1.mp3',
    drumroll: '/Sounds/drumroll_v1.mp3',
    no_peaking_cheater: '/Sounds/no_peaking_cheater.mp3',
};

const MUSIC_FILE = '/Music/upbeat-game-loop-v1.mp3';
const DEFAULT_EFFECTS_VOLUME = 0.7;
const GAIN_RAMP_SECONDS = 0.12;

const clampVolume = (value) => {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? Math.min(1, Math.max(0, numericValue)) : 0;
};

const stored = (key, fallback, validate = () => true) => {
    try {
        const value = localStorage.getItem(key);
        if (value === null) return fallback;
        const parsed = JSON.parse(value);
        return validate(parsed) ? parsed : fallback;
    } catch {
        return fallback;
    }
};

const storedBoolean = (key, fallback) => stored(key, fallback, value => typeof value === 'boolean');
const storedVolume = (key, fallback) => clampVolume(stored(
    key,
    fallback,
    value => typeof value === 'number' && Number.isFinite(value)
));

// Safari has historically supported only the callback form, while modern
// browsers return a promise. Resolve either API without decoding twice.
const decodeAudio = (ctx, data) => new Promise((resolve, reject) => {
    let result;
    try {
        result = ctx.decodeAudioData(data, resolve, reject);
    } catch (error) {
        reject(error);
        return;
    }
    if (result && typeof result.then === 'function') result.then(resolve, reject);
});

const setGain = (gainNode, ctx, target, { immediate = false } = {}) => {
    if (!gainNode || !ctx) return;
    const gain = gainNode.gain;
    const value = clampVolume(target);
    const now = Number.isFinite(ctx.currentTime) ? ctx.currentTime : 0;

    if (immediate) {
        gain.value = value;
        return;
    }

    // A short ramp prevents clicks when a view, mute button, or slider changes.
    if (typeof gain.cancelScheduledValues === 'function') gain.cancelScheduledValues(now);
    if (typeof gain.setValueAtTime === 'function') gain.setValueAtTime(gain.value, now);
    if (typeof gain.linearRampToValueAtTime === 'function') {
        gain.linearRampToValueAtTime(value, now + GAIN_RAMP_SECONDS);
    } else if (typeof gain.setTargetAtTime === 'function') {
        gain.setTargetAtTime(value, now, GAIN_RAMP_SECONDS / 3);
    } else {
        gain.value = value;
    }
};

export const useSounds = ({ musicActive = false } = {}) => {
    const hydratedSettingsRef = useRef(null);
    if (!hydratedSettingsRef.current) {
        const effectsMuted = storedBoolean('sluff_sound_muted', false);
        const effectsVolume = storedVolume('sluff_sound_volume', DEFAULT_EFFECTS_VOLUME);
        hydratedSettingsRef.current = {
            effectsMuted,
            effectsVolume,
            // Respect an existing global mute on the first music-enabled build.
            musicMuted: storedBoolean('sluff_music_muted', effectsMuted),
            musicVolume: storedVolume('sluff_music_volume', effectsVolume / 2),
        };
    }

    const initialSettings = hydratedSettingsRef.current;
    const [muted, setMuted] = useState(initialSettings.effectsMuted);
    const [volume, setVolumeState] = useState(initialSettings.effectsVolume);
    const [musicMuted, setMusicMuted] = useState(initialSettings.musicMuted);
    const [musicVolume, setMusicVolumeState] = useState(initialSettings.musicVolume);

    const ctxRef = useRef(null);
    const gainRef = useRef(null);
    const musicGainRef = useRef(null);
    const buffersRef = useRef({});
    const musicSourceRef = useRef(null);
    const musicLoadPromiseRef = useRef(null);
    const enabledRef = useRef(false);
    const disposedRef = useRef(false);
    const mutedRef = useRef(muted);
    const volumeRef = useRef(volume);
    const musicMutedRef = useRef(musicMuted);
    const musicVolumeRef = useRef(musicVolume);
    const musicActiveRef = useRef(Boolean(musicActive));

    // Keep event callbacks and asynchronous decoders on the latest settings.
    mutedRef.current = muted;
    volumeRef.current = volume;
    musicMutedRef.current = musicMuted;
    musicVolumeRef.current = musicVolume;
    musicActiveRef.current = Boolean(musicActive);

    const desiredMusicGain = useCallback(() => (
        musicActiveRef.current && !musicMutedRef.current ? musicVolumeRef.current : 0
    ), []);

    const startMusicLoop = useCallback((ctx, buffer) => {
        if (
            disposedRef.current
            || ctxRef.current !== ctx
            || !musicGainRef.current
            || musicSourceRef.current
        ) return;

        let source;
        try {
            source = ctx.createBufferSource();
            source.buffer = buffer;
            source.loop = true;
            source.connect(musicGainRef.current);
            // Set the ref before start() so repeated async completion cannot
            // create two loops under React StrictMode or rapid gestures.
            musicSourceRef.current = source;
            source.onended = () => {
                if (musicSourceRef.current === source) musicSourceRef.current = null;
            };
            source.start(0);
        } catch (error) {
            if (musicSourceRef.current === source) musicSourceRef.current = null;
            try { source?.disconnect(); } catch { /* best effort */ }
            console.error('Failed to start background music:', error);
        }
    }, []);

    const loadMusic = useCallback((ctx) => {
        if (musicLoadPromiseRef.current || !musicGainRef.current) return;

        musicLoadPromiseRef.current = (async () => {
            try {
                const response = await fetch(MUSIC_FILE);
                if (!response.ok) throw new Error(`fetch ${response.status}`);
                const buffer = await decodeAudio(ctx, await response.arrayBuffer());
                if (disposedRef.current || ctxRef.current !== ctx) return;
                startMusicLoop(ctx, buffer);
            } catch (error) {
                // Music is optional: a bad asset or decode must never disable SFX.
                if (!disposedRef.current && ctxRef.current === ctx) {
                    console.error('Failed to load background music:', error);
                }
            }
        })();
    }, [startMusicLoop]);

    const loadEffects = useCallback((ctx) => {
        Object.entries(SOUND_FILES).forEach(async ([name, url]) => {
            try {
                const response = await fetch(url);
                if (!response.ok) throw new Error(`fetch ${response.status}`);
                const buffer = await decodeAudio(ctx, await response.arrayBuffer());
                if (!disposedRef.current && ctxRef.current === ctx) {
                    buffersRef.current[name] = buffer;
                }
            } catch (error) {
                if (!disposedRef.current && ctxRef.current === ctx) {
                    console.error(`Failed to load sound ${name}:`, error);
                }
            }
        });
    }, []);

    const ensureContext = useCallback(() => {
        if (ctxRef.current) return ctxRef.current;

        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;

        let ctx;
        try {
            ctx = new Ctx();
            const effectsGain = ctx.createGain();
            setGain(effectsGain, ctx, mutedRef.current ? 0 : volumeRef.current, { immediate: true });
            effectsGain.connect(ctx.destination);

            ctxRef.current = ctx;
            gainRef.current = effectsGain;

            // Build the music branch separately so a music-specific Web Audio
            // failure leaves the already-connected effects channel usable.
            try {
                const musicGain = ctx.createGain();
                setGain(musicGain, ctx, desiredMusicGain(), { immediate: true });
                musicGain.connect(ctx.destination);
                musicGainRef.current = musicGain;
                loadMusic(ctx);
            } catch (error) {
                console.error('Failed to initialize background music:', error);
            }

            loadEffects(ctx);
        } catch (error) {
            console.error('Failed to initialize game audio:', error);
            try { ctx?.close?.(); } catch { /* best effort */ }
            ctxRef.current = null;
            gainRef.current = null;
            musicGainRef.current = null;
            return null;
        }

        return ctx;
    }, [desiredMusicGain, loadEffects, loadMusic]);

    const enableSound = useCallback(() => {
        // Must be called from a user gesture (browsers gate audio on interaction).
        const ctx = ensureContext();
        if (!ctx) return;
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});

        // iOS needs a real (silent) buffer started inside the gesture to unlock
        // the audio session; resume() alone is insufficient on older versions.
        try {
            const silent = ctx.createBuffer(1, 1, 22050);
            const source = ctx.createBufferSource();
            source.buffer = silent;
            source.connect(ctx.destination);
            source.start(0);
        } catch { /* unlock is best-effort */ }
        enabledRef.current = true;
    }, [ensureContext]);

    const setVolume = useCallback((nextValue) => {
        setVolumeState(current => clampVolume(
            typeof nextValue === 'function' ? nextValue(current) : nextValue
        ));
    }, []);

    const setMusicVolume = useCallback((nextValue) => {
        setMusicVolumeState(current => clampVolume(
            typeof nextValue === 'function' ? nextValue(current) : nextValue
        ));
    }, []);

    // Persist and apply the effects channel independently.
    useEffect(() => {
        try {
            localStorage.setItem('sluff_sound_muted', JSON.stringify(muted));
            localStorage.setItem('sluff_sound_volume', JSON.stringify(volume));
        } catch { /* private browsing */ }
        setGain(gainRef.current, ctxRef.current, muted ? 0 : volume);
    }, [muted, volume]);

    // Persist and apply music activity/preferences without restarting its loop.
    useEffect(() => {
        try {
            localStorage.setItem('sluff_music_muted', JSON.stringify(musicMuted));
            localStorage.setItem('sluff_music_volume', JSON.stringify(musicVolume));
        } catch { /* private browsing */ }
        setGain(
            musicGainRef.current,
            ctxRef.current,
            musicActive && !musicMuted ? musicVolume : 0
        );
    }, [musicActive, musicMuted, musicVolume]);

    // Pause the shared context while backgrounded and resume it after a mobile
    // app/tab returns. Once unlocked, resuming no longer requires another tap.
    useEffect(() => {
        const resumeIfNeeded = () => {
            const ctx = ctxRef.current;
            if (ctx && ctx.state === 'suspended' && enabledRef.current) {
                ctx.resume().catch(() => {});
            }
        };
        const handleVisibility = () => {
            const ctx = ctxRef.current;
            if (!ctx || !enabledRef.current) return;
            if (document.visibilityState === 'hidden') {
                if (ctx.state === 'running' && typeof ctx.suspend === 'function') {
                    ctx.suspend().catch(() => {});
                }
            } else {
                resumeIfNeeded();
            }
        };

        document.addEventListener('visibilitychange', handleVisibility);
        window.addEventListener('focus', resumeIfNeeded);
        return () => {
            document.removeEventListener('visibilitychange', handleVisibility);
            window.removeEventListener('focus', resumeIfNeeded);
        };
    }, []);

    // Safety net for refresh/rejoin flows that skip explicit enableSound calls.
    useEffect(() => {
        const unlock = () => {
            enableSound();
            window.removeEventListener('pointerdown', unlock);
            window.removeEventListener('keydown', unlock);
            window.removeEventListener('touchstart', unlock);
        };
        window.addEventListener('pointerdown', unlock);
        window.addEventListener('keydown', unlock);
        window.addEventListener('touchstart', unlock);
        return () => {
            window.removeEventListener('pointerdown', unlock);
            window.removeEventListener('keydown', unlock);
            window.removeEventListener('touchstart', unlock);
        };
    }, [enableSound]);

    // Close the page-lifetime audio graph on a real unmount. The initial
    // StrictMode effect probe occurs before a gesture can create the context.
    useEffect(() => {
        disposedRef.current = false;
        return () => {
            disposedRef.current = true;
            enabledRef.current = false;

            const source = musicSourceRef.current;
            musicSourceRef.current = null;
            try { source?.stop(0); } catch { /* already stopped */ }
            try { source?.disconnect(); } catch { /* best effort */ }

            const ctx = ctxRef.current;
            ctxRef.current = null;
            gainRef.current = null;
            musicGainRef.current = null;
            buffersRef.current = {};
            musicLoadPromiseRef.current = null;
            if (ctx && ctx.state !== 'closed' && typeof ctx.close === 'function') {
                ctx.close().catch(() => {});
            }
        };
    }, []);

    const playSound = useCallback((soundName) => {
        if (mutedRef.current) return;
        if (!enabledRef.current) {
            console.warn(`[sound] "${soundName}" skipped — audio not unlocked yet (no user gesture)`);
            return;
        }
        const ctx = ctxRef.current;
        const buffer = buffersRef.current[soundName];
        if (!ctx || !buffer) {
            console.warn(`[sound] "${soundName}" skipped — ${!ctx ? 'no audio context' : 'buffer not loaded'}`);
            return;
        }
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(gainRef.current);
        source.start(0);
    }, []);

    const toggleMute = useCallback(() => setMuted(current => !current), []);
    const toggleMusicMute = useCallback(() => setMusicMuted(current => !current), []);

    return {
        playSound,
        enableSound,
        soundSettings: {
            muted,
            volume,
            toggleMute,
            setVolume,
            musicMuted,
            musicVolume,
            toggleMusicMute,
            setMusicVolume,
        },
    };
};
