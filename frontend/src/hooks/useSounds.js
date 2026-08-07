import { useState, useEffect, useRef, useCallback } from 'react';
import { isAudioSessionClaimedByVoice } from '../utils/VoiceChat';
import { cardSnap, midnightSpecialScore, scheduleDealSounds, wheelClick, wheelSettle } from '../utils/soundSynth';
import { haptic, hapticDealRun, hapticWheelTick } from '../utils/haptics';

// Short effects and the music bed share one unlocked Web Audio context so they
// mix reliably on mobile. Each channel has its own gain node and preferences.
// The deal and the card play are no longer samples: both are synthesized on
// the context clock (their recordings read as record scratch) with per-hit
// pitch baked in.
const SOUND_FILES = {
    turnAlert: '/Sounds/turn_alert.mp3',
    trickWin: '/Sounds/trick_win.mp3',
    trumpBroken: '/Sounds/trump_broken_v6.mp3',
    bidFrog: '/Sounds/bid_frog_v1.mp3',
    // v2: re-recorded (Liam, eleven_v3, 92% speed) — v1's "Solo bid" was
    // getting misheard as "solo beans".
    bidSolo: '/Sounds/bid_solo_v2.mp3',
    bidHeartSolo: '/Sounds/bid_heart_solo_v1.mp3',
    bidAllPass: '/Sounds/bid_all_pass_v1.mp3',
    bidPass: '/Sounds/bid_pass_v1.mp3',
    suitSpades: '/Sounds/suit_spades_v1.mp3',
    suitClubs: '/Sounds/suit_clubs_v1.mp3',
    suitDiamonds: '/Sounds/suit_diamonds_v1.mp3',
    roundEnd: '/Sounds/round_end_v1.mp3',
    // Matt's temp Midnight Special song (16.08s) — underscores the whole
    // production; the effects bed (horn/chug) is synthesized over it.
    midnightSong: '/Sounds/midnight_special_song_v1.mp3',
    // The podium's voice (all premade Liam, eleven_v3): the needle for the
    // sole bottom step, the champion's greeting on the top step, and the
    // deadpan shrug when a draw sends everyone home with their buy-ins.
    podiumLoss: '/Sounds/podium_loss_v1.mp3',
    // Champion sting fallback: Liam's generic proclamation pre-mixed over
    // the anthem (no sampled masters — see generate-podium-stings.js).
    podiumWin: '/Sounds/podium_win_mix_v1.mp3',
    // The bare anthem bed: playChampionSting layers the winner's
    // personalized line (fetched from the server) over this live.
    podiumWinAnthem: '/Sounds/podium_win_anthem_v1.mp3',
    // v2: Matt's audition pick — "[sighs] A wash. All that drama... for nothing."
    drawWash: '/Sounds/draw_wash_v2.mp3',
    drumroll: '/Sounds/drumroll_v1.mp3',
    no_peaking_cheater: '/Sounds/no_peaking_cheater.mp3',
};

// Per-repeat pitch humanization for the percussive effects that fire many
// times in a row. Sound-design folklore that holds up: identical repeats
// read as a machine; a few percent of random pitch per hit reads as a hand.
// Voice lines and one-shot stings are deliberately absent — shifting speech
// sounds wrong, and a sting that plays once has nothing to vary against.
const PITCH_VARIANCE = {
    trickWin: 0.04,
    turnAlert: 0.025,
};

// Sounds that carry a physical layer: firing the sound fires the matching
// haptic cue (utils/haptics.js). Haptics inherit playSound's gates — an
// in-game mute silences the buzz along with the audio.
const SOUND_HAPTICS = {
    cardPlay: 'cardPlay',
    turnAlert: 'turnAlert',
    trickWin: 'trickWin',
    trumpBroken: 'trumpBroken',
    podiumWin: 'podiumWin',
    podiumLoss: 'podiumLoss',
};

const MUSIC_FILE = '/Music/upbeat-game-loop-v1.mp3';
const DEFAULT_EFFECTS_VOLUME = 0.7;
const DEFAULT_MUSIC_VOLUME = 0.15;
const MUSIC_DEFAULT_VERSION = 2;
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
const volumesMatch = (left, right) => Math.abs(left - right) < 0.0001;


// iOS WebKit parks a context in the (once non-standard) 'interrupted' state
// whenever the system takes the audio session — a microphone permission
// prompt, a phone call, Siri, another app. It resumes exactly like
// 'suspended', and a resume() issued mid-interruption is queued by WebKit to
// settle when the interruption ends. Checking for 'suspended' alone left
// every interrupted context silent until page reload.
const isResumable = (ctx) => ctx.state === 'suspended' || ctx.state === 'interrupted';

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
        const storedMusicVolume = storedVolume('sluff_music_volume', effectsVolume / 2);
        const musicDefaultVersion = stored(
            'sluff_music_default_version',
            1,
            value => Number.isInteger(value) && value > 0
        );
        const usesOriginalAutomaticDefault = musicDefaultVersion < MUSIC_DEFAULT_VERSION
            && (
                volumesMatch(storedMusicVolume, effectsVolume / 2)
                || volumesMatch(storedMusicVolume, DEFAULT_EFFECTS_VOLUME / 2)
            );
        hydratedSettingsRef.current = {
            effectsMuted,
            effectsVolume,
            // Respect an existing global mute on the first music-enabled build.
            musicMuted: storedBoolean('sluff_music_muted', effectsMuted),
            // Migrate the original automatic half-effects default once, while
            // retaining any music level the player deliberately customized.
            musicVolume: usesOriginalAutomaticDefault
                ? DEFAULT_MUSIC_VOLUME
                : storedMusicVolume,
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

    // iOS routes Web Audio to the RINGER channel by default, so a phone with
    // the silent switch on plays no game audio at all — while sound then
    // "appears" the moment mic capture flips the session to play-and-record,
    // which the switch does not govern. Declaring the 'playback' session type
    // (Audio Session API, iOS 17+) moves the game to the media channel, where
    // every real game lives. Two deliberate boundaries: a fully muted game
    // drops to 'ambient' so it stops pausing the player's own music app, and
    // 'play-and-record' is never touched — per the spec, downgrading the type
    // under live capture ENDS the microphone track (VoiceChat owns that
    // declaration and announces when it releases it). No-op off iOS.
    const syncAudioSession = useCallback(() => {
        try {
            const session = navigator.audioSession;
            if (!session || session.type === 'play-and-record') return;
            const effectsAudible = !mutedRef.current && volumeRef.current > 0;
            const musicAudible = musicActiveRef.current
                && !musicMutedRef.current && musicVolumeRef.current > 0;
            // A live voice session (even listen-only, even capture-idle) pins
            // the media channel: peer audio plays through WebAudio too, and
            // 'ambient' would hand it back to the silent switch.
            const desired = effectsAudible || musicAudible || isAudioSessionClaimedByVoice()
                ? 'playback'
                : 'ambient';
            if (session.type !== desired) session.type = desired;
        } catch { /* best effort */ }
    }, []);

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
            syncAudioSession();
            ctx = new Ctx();
            const effectsGain = ctx.createGain();
            setGain(effectsGain, ctx, mutedRef.current ? 0 : volumeRef.current, { immediate: true });
            effectsGain.connect(ctx.destination);

            ctxRef.current = ctx;
            gainRef.current = effectsGain;

            // Recover the moment an iOS interruption releases the session,
            // instead of waiting for the next tap or visibility flip. The
            // hidden check keeps this from fighting the deliberate
            // suspend-while-backgrounded below.
            ctx.onstatechange = () => {
                if (disposedRef.current || ctxRef.current !== ctx) return;
                if (!enabledRef.current || document.visibilityState === 'hidden') return;
                if (isResumable(ctx)) ctx.resume().catch(() => {});
            };

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
    }, [desiredMusicGain, loadEffects, loadMusic, syncAudioSession]);

    const enableSound = useCallback(() => {
        // Must be called from a user gesture (browsers gate audio on interaction).
        const ctx = ensureContext();
        if (!ctx) return;
        if (isResumable(ctx)) ctx.resume().catch(() => {});
        if (enabledRef.current) return;

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
        syncAudioSession();
    }, [muted, volume, syncAudioSession]);

    // Persist and apply music activity/preferences without restarting its loop.
    useEffect(() => {
        try {
            localStorage.setItem('sluff_music_muted', JSON.stringify(musicMuted));
            localStorage.setItem('sluff_music_volume', JSON.stringify(musicVolume));
            localStorage.setItem('sluff_music_default_version', JSON.stringify(MUSIC_DEFAULT_VERSION));
        } catch { /* private browsing */ }
        setGain(
            musicGainRef.current,
            ctxRef.current,
            musicActive && !musicMuted ? musicVolume : 0
        );
        syncAudioSession();
    }, [musicActive, musicMuted, musicVolume, syncAudioSession]);

    // VoiceChat announces when the page-global capture declaration is fully
    // released; only then may this hook's preference apply again.
    useEffect(() => {
        window.addEventListener('sluff:audio-session-released', syncAudioSession);
        return () => window.removeEventListener('sluff:audio-session-released', syncAudioSession);
    }, [syncAudioSession]);

    // Pause the shared context while backgrounded and resume it after a mobile
    // app/tab returns. Once unlocked, resuming no longer requires another tap.
    useEffect(() => {
        const resumeIfNeeded = () => {
            const ctx = ctxRef.current;
            if (ctx && isResumable(ctx) && enabledRef.current) {
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
    // Stays armed for the page's life: after the first unlock (which makes
    // repeat calls nearly free) it doubles as the gesture-side recovery for a
    // context that iOS interrupted mid-game.
    useEffect(() => {
        const unlock = () => enableSound();
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
            if (ctx) ctx.onstatechange = null;
            if (ctx && ctx.state !== 'closed' && typeof ctx.close === 'function') {
                ctx.close().catch(() => {});
            }
        };
    }, []);

    // `tailMs` plays only the final slice of a clip, so a clip written as a build
    // (the drumroll) still crests on cue when the animation it scores is shorter
    // than the recording.
    const playSound = useCallback((soundName, { tailMs } = {}) => {
        if (mutedRef.current) return;
        if (!enabledRef.current) {
            console.warn(`[sound] "${soundName}" skipped — audio not unlocked yet (no user gesture)`);
            return;
        }
        if (SOUND_HAPTICS[soundName]) haptic(SOUND_HAPTICS[soundName]);
        const ctx = ctxRef.current;
        // The card play is a synthesized voice: every card lands with its own
        // pitch, and there is no sample left to scratch.
        if (soundName === 'cardPlay') {
            if (!ctx || !gainRef.current) return;
            if (isResumable(ctx)) ctx.resume().catch(() => {});
            cardSnap(ctx, gainRef.current, {
                pitch: 1 + (Math.random() * 2 - 1) * 0.07,
            });
            return;
        }
        const buffer = buffersRef.current[soundName];
        if (!ctx || !buffer) {
            console.warn(`[sound] "${soundName}" skipped — ${!ctx ? 'no audio context' : 'buffer not loaded'}`);
            return;
        }
        if (isResumable(ctx)) ctx.resume().catch(() => {});
        const source = ctx.createBufferSource();
        source.buffer = buffer;

        // Humanize repeats: each firing of a varied sound is born a few
        // percent sharp or flat of the last one.
        const variance = PITCH_VARIANCE[soundName] || 0;
        if (variance > 0 && source.playbackRate) {
            source.playbackRate.value = 1 + (Math.random() * 2 - 1) * variance;
        }

        const duration = Number(buffer.duration);
        const trimTo = Number(tailMs) / 1000;
        const offset = Number.isFinite(duration) && Number.isFinite(trimTo) && trimTo > 0 && trimTo < duration
            ? duration - trimTo
            : 0;

        if (offset > 0) {
            // Dropping in mid-clip would click, so ramp the entry over a few frames.
            const entry = ctx.createGain();
            setGain(entry, ctx, 0, { immediate: true });
            setGain(entry, ctx, 1);
            entry.connect(gainRef.current);
            source.connect(entry);
            source.onended = () => { try { entry.disconnect(); } catch { /* best effort */ } };
        } else {
            source.connect(gainRef.current);
        }
        source.start(0, offset);
    }, []);

    // Shared preamble for the synthesized voices: same mute/unlock gates as
    // playSound, returning the live context or null.
    const synthContext = useCallback(() => {
        if (mutedRef.current || !enabledRef.current) return null;
        const ctx = ctxRef.current;
        if (!ctx || !gainRef.current) return null;
        if (isResumable(ctx)) ctx.resume().catch(() => {});
        return ctx;
    }, []);

    // The deal, synthesized: one flick per card at the animation's cadence,
    // each with its own pitch/timing/level. Replaces the old 3s recording.
    const playDealSounds = useCallback(({ cardCount = 36, staggerMs = 115 } = {}) => {
        const ctx = synthContext();
        if (!ctx) return;
        scheduleDealSounds(ctx, gainRef.current, { count: cardCount, staggerMs });
        hapticDealRun({ cardCount, staggerMs });
    }, [synthContext]);

    // The venue wheel's flapper — called per peg crossing, intensity follows
    // wheel speed, so the click track IS the wheel's motion.
    const playWheelTick = useCallback((intensity = 1) => {
        const ctx = synthContext();
        if (!ctx) return;
        wheelClick(ctx, gainRef.current, {
            intensity,
            pitch: 1 + (Math.random() * 2 - 1) * 0.05,
        });
        // The flapper in the fingertips: haptic detents at the wheel's speed.
        hapticWheelTick(intensity);
    }, [synthContext]);

    const playWheelSettle = useCallback(() => {
        const ctx = synthContext();
        if (!ctx) return;
        wheelSettle(ctx, gainRef.current);
    }, [synthContext]);

    // The personalized champion sting. GameTableView prefetches the winner's
    // line the moment the game ends (the server speaks only the name it
    // knows won); by podium time it is decoded and ready to ride the anthem.
    //
    // gameKey must identify THIS game's ending, not just the table: this
    // hook lives at the app level and survives rematches, so a table-keyed
    // cache once hailed the PREVIOUS game's champion by name.
    const championLineRef = useRef({ key: null, buffer: null });
    const prefetchChampionLine = useCallback(async (gameKey, fetchLine) => {
        const ctx = ctxRef.current;
        if (!ctx || !gameKey || typeof fetchLine !== 'function') return;
        if (championLineRef.current.key === gameKey) return; // once per game
        // Reset FIRST: a stale buffer from an earlier game must never
        // outlive the key change, even if this fetch fails or returns 204.
        championLineRef.current = { key: gameKey, buffer: null };
        try {
            const bytes = await fetchLine();
            if (!bytes || championLineRef.current.key !== gameKey) return;
            const buffer = await new Promise((resolve, reject) => {
                // Callback form for Safari's older decodeAudioData.
                ctx.decodeAudioData(bytes, resolve, reject);
            });
            if (championLineRef.current.key === gameKey) {
                championLineRef.current.buffer = buffer;
            }
        } catch { /* fallback sting covers it */ }
    }, []);

    // Play the champion moment: the anthem bed with the personalized line
    // landing over its swell (same 1.2s pocket as the pre-mixed sting), or
    // the generic mix when no personalized line arrived.
    const playChampionSting = useCallback(() => {
        const ctx = synthContext();
        if (!ctx) return;
        const line = championLineRef.current.buffer;
        const anthem = buffersRef.current.podiumWinAnthem;
        if (!line || !anthem) {
            playSound('podiumWin');
            return;
        }
        haptic('podiumWin');
        const bed = ctx.createBufferSource();
        bed.buffer = anthem;
        bed.connect(gainRef.current);
        bed.start(0);
        const shout = ctx.createBufferSource();
        shout.buffer = line;
        // The proclamation cuts through the bed, like the pre-mixed recipe.
        const boost = ctx.createGain();
        boost.gain.value = 2.2;
        shout.connect(boost);
        boost.connect(gainRef.current);
        shout.onended = () => { try { boost.disconnect(); } catch { /* best effort */ } };
        shout.start(ctx.currentTime + 1.2);
    }, [synthContext, playSound]);

    // The Midnight Special — the full production: Matt's song clip from
    // the first frame, with the synthesized horn and chug bedded over it,
    // all on the shared clock the animation reads.
    const playMidnightSpecial = useCallback(() => {
        const ctx = synthContext();
        if (!ctx) return;
        const song = buffersRef.current.midnightSong;
        if (song) {
            const source = ctx.createBufferSource();
            source.buffer = song;
            source.connect(gainRef.current);
            source.start(0);
        }
        midnightSpecialScore(ctx, gainRef.current);
        // The horn in the hand, then the drive wheels.
        haptic('midnightSpecial');
    }, [synthContext]);

    const toggleMute = useCallback(() => setMuted(current => !current), []);
    const toggleMusicMute = useCallback(() => setMusicMuted(current => !current), []);

    return {
        playSound,
        playDealSounds,
        playWheelTick,
        playWheelSettle,
        playMidnightSpecial,
        prefetchChampionLine,
        playChampionSting,
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
