// frontend/src/utils/haptics.js
//
// The game's physical layer: every named cue maps a game moment to a
// vibration pattern, the way soundSynth maps them to audio. Fired alongside
// the sound design (useSounds calls into here), so anything that makes a
// noise can also make a nudge.
//
// Platform reality: navigator.vibrate works on Android browsers and is
// simply absent on iOS Safari — iPhones feel nothing until the Capacitor
// shell arrives. The driver seam below already prefers a native Haptics
// plugin when one is present (window.Capacitor), so the day the shell
// ships, these same cues land on the Taptic Engine with crisp impact/
// notification textures instead of buzzer pulses. No call site changes.
//
// Design rules: haptics are garnish — short, sparse, and always optional.
// Everything is try/catch'd and feature-detected; a phone that can't buzz
// plays the same game.

const STORAGE_KEY = 'sluff_haptics_enabled';

// Patterns are Vibration API arrays: [buzz, pause, buzz, ...] in ms.
// Named for the MOMENT, not the motor — the native driver maps the same
// names onto Taptic Engine primitives.
const CUES = {
    // One card meeting the felt: the smallest possible tick.
    cardPlay: [10],
    // A soft double knock: it's your turn.
    turnAlert: [18, 70, 24],
    // Sweeping the trick in: a light, satisfied tap-pair.
    trickWin: [14, 45, 20],
    // Trump broken: one sharp crack with a short tail.
    trumpBroken: [45, 35, 18],
    // The insurance gavel: deal struck.
    dealStruck: [24, 55, 24],
    // Podium stings: the champion's flourish and the loser's single thud.
    podiumWin: [30, 55, 30, 55, 70],
    podiumLoss: [60],
    // The Midnight Special: two horn blasts, then the drive wheels take
    // over — a chug rhythm riding out as the train rolls on.
    midnightSpecial: [180, 110, 260, 340, 35, 70, 35, 70, 35, 70, 35, 70, 35],
};

// Native shell seam: when the Capacitor Haptics plugin is present, prefer
// it. Impact styles by cue weight; selection ticks for the tiny ones.
const NATIVE_STYLES = {
    cardPlay: { kind: 'selection' },
    turnAlert: { kind: 'impact', style: 'LIGHT', repeat: 2, gapMs: 80 },
    trickWin: { kind: 'impact', style: 'LIGHT', repeat: 2, gapMs: 50 },
    trumpBroken: { kind: 'impact', style: 'HEAVY' },
    dealStruck: { kind: 'impact', style: 'MEDIUM', repeat: 2, gapMs: 60 },
    podiumWin: { kind: 'notification', type: 'SUCCESS' },
    podiumLoss: { kind: 'notification', type: 'WARNING' },
    midnightSpecial: { kind: 'impact', style: 'HEAVY', repeat: 3, gapMs: 160 },
};

export const getHapticsEnabled = () => {
    try {
        return window.localStorage.getItem(STORAGE_KEY) !== 'false';
    } catch {
        return true;
    }
};

export const setHapticsEnabled = (enabled) => {
    try {
        window.localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
    } catch { /* storage may be denied; session behavior is unchanged */ }
};

const nativeHaptics = () => (
    typeof window !== 'undefined'
    && window.Capacitor?.isNativePlatform?.()
    && window.Capacitor?.Plugins?.Haptics
) || null;

const canVibrate = () => (
    typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
);

const fireNative = (plugin, cueName) => {
    const spec = NATIVE_STYLES[cueName] || { kind: 'impact', style: 'LIGHT' };
    const once = () => {
        if (spec.kind === 'selection') return plugin.selectionChanged?.() ?? plugin.impact?.({ style: 'LIGHT' });
        if (spec.kind === 'notification') return plugin.notification?.({ type: spec.type });
        return plugin.impact?.({ style: spec.style });
    };
    const repeats = spec.repeat || 1;
    for (let i = 0; i < repeats; i += 1) {
        if (i === 0) once();
        else setTimeout(once, i * (spec.gapMs || 80));
    }
};

/** Fire a named cue. Silently a no-op wherever haptics can't or shouldn't. */
export const haptic = (cueName) => {
    if (!CUES[cueName] || !getHapticsEnabled()) return;
    try {
        const native = nativeHaptics();
        if (native) {
            fireNative(native, cueName);
            return;
        }
        if (canVibrate()) navigator.vibrate(CUES[cueName]);
    } catch { /* haptics are garnish */ }
};

/**
 * The deal, physically: one tiny tick per card at the animation's cadence,
 * a fingertip echo of the audio flick run. Capped ticks and every-other-card
 * pacing keep it a texture rather than a rattle.
 */
export const hapticDealRun = ({ cardCount = 36, staggerMs = 115 } = {}) => {
    if (!getHapticsEnabled()) return;
    try {
        const native = nativeHaptics();
        const tick = native
            ? () => { try { native.selectionChanged?.(); } catch { /* garnish */ } }
            : (canVibrate() ? () => navigator.vibrate(8) : null);
        if (!tick) return;
        const every = 2; // every other card
        const ticks = Math.min(18, Math.floor(cardCount / every));
        for (let i = 0; i < ticks; i += 1) {
            setTimeout(tick, i * staggerMs * every);
        }
    } catch { /* haptics are garnish */ }
};

/**
 * One wheel peg crossing the flapper. Intensity follows wheel speed like
 * the click sound — full-speed pegs thump, dying pegs tick.
 */
export const hapticWheelTick = (intensity = 1) => {
    if (!getHapticsEnabled()) return;
    try {
        const native = nativeHaptics();
        if (native) {
            if (intensity > 0.6) native.impact?.({ style: 'LIGHT' });
            else native.selectionChanged?.();
            return;
        }
        if (canVibrate()) navigator.vibrate(intensity > 0.6 ? 12 : 7);
    } catch { /* haptics are garnish */ }
};

export const HAPTIC_CUES = Object.freeze(Object.keys(CUES));
