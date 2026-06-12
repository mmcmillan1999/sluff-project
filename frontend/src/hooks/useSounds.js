import { useState, useEffect, useRef, useCallback } from 'react';

// Web Audio API instead of <audio> elements: short SFX mix OVER background
// audio (YouTube/music keeps playing) instead of seizing the phone's audio
// session — the same approach Howler.js and HTML5 game engines use.
const SOUND_FILES = {
    turnAlert: '/Sounds/turn_alert.mp3',
    cardPlay: '/Sounds/card_play.mp3',
    trickWin: '/Sounds/trick_win.mp3',
    cardDeal: '/Sounds/card_dealing_10s_v3.mp3',
    no_peaking_cheater: '/Sounds/no_peaking_cheater.mp3',
};

const stored = (key, fallback) => {
    try {
        const v = localStorage.getItem(key);
        return v === null ? fallback : JSON.parse(v);
    } catch {
        return fallback;
    }
};

export const useSounds = () => {
    const ctxRef = useRef(null);
    const gainRef = useRef(null);
    const buffersRef = useRef({});
    const enabledRef = useRef(false);

    const [muted, setMuted] = useState(() => stored('sluff_sound_muted', false));
    const [volume, setVolume] = useState(() => stored('sluff_sound_volume', 0.7));
    const mutedRef = useRef(muted);
    const volumeRef = useRef(volume);

    // Persist settings and apply them to the live gain node
    useEffect(() => {
        mutedRef.current = muted;
        volumeRef.current = volume;
        try {
            localStorage.setItem('sluff_sound_muted', JSON.stringify(muted));
            localStorage.setItem('sluff_sound_volume', JSON.stringify(volume));
        } catch { /* private browsing */ }
        if (gainRef.current && ctxRef.current) {
            gainRef.current.gain.setValueAtTime(muted ? 0 : volume, ctxRef.current.currentTime);
        }
    }, [muted, volume]);

    const ensureContext = useCallback(() => {
        if (!ctxRef.current) {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return null;
            ctxRef.current = new Ctx();
            gainRef.current = ctxRef.current.createGain();
            gainRef.current.gain.value = mutedRef.current ? 0 : volumeRef.current;
            gainRef.current.connect(ctxRef.current.destination);

            Object.entries(SOUND_FILES).forEach(async ([name, url]) => {
                try {
                    const res = await fetch(url);
                    const data = await res.arrayBuffer();
                    buffersRef.current[name] = await ctxRef.current.decodeAudioData(data);
                } catch (e) {
                    console.error(`Failed to load sound ${name}:`, e);
                }
            });
        }
        return ctxRef.current;
    }, []);

    const enableSound = useCallback(() => {
        // Must be called from a user gesture (browsers gate audio on interaction)
        const ctx = ensureContext();
        if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
        enabledRef.current = true;
    }, [ensureContext]);

    // Safety net: unlock audio on the FIRST user gesture of any kind, so sound
    // works even on flows that skip the explicit enableSound() call sites
    // (e.g. auto-rejoining a table after a refresh).
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

    const playSound = useCallback((soundName) => {
        // Muted players never touch the audio session at all
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

    const toggleMute = useCallback(() => setMuted(m => !m), []);

    return {
        playSound,
        enableSound,
        soundSettings: { muted, volume, toggleMute, setVolume },
    };
};
