// The physical layer: cues buzz where the platform can, prefer the native
// Taptic driver when the shell provides one, and vanish silently everywhere
// else. Haptics are garnish — no cue may ever throw.

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    haptic,
    hapticDealRun,
    hapticWheelTick,
    buzz,
    getHapticsEnabled,
    setHapticsEnabled,
    HAPTIC_CUES,
} from './haptics';

describe('haptics', () => {
    beforeEach(() => {
        window.localStorage.clear();
        delete window.Capacitor;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
        delete navigator.vibrate;
        delete window.Capacitor;
    });

    test('fires vibration patterns on platforms that support it', () => {
        navigator.vibrate = vi.fn();
        haptic('trumpBroken');
        expect(navigator.vibrate).toHaveBeenCalledTimes(1);
        const [pattern] = navigator.vibrate.mock.calls[0];
        expect(Array.isArray(pattern)).toBe(true);
        expect(pattern.length).toBeGreaterThan(0);
    });

    test('is a silent no-op without vibration support (iOS Safari)', () => {
        expect(() => {
            for (const cue of HAPTIC_CUES) haptic(cue);
            hapticDealRun();
            hapticWheelTick(1);
        }).not.toThrow();
    });

    test('unknown cues and the disabled setting both stay silent', () => {
        navigator.vibrate = vi.fn();
        haptic('notARealCue');
        expect(navigator.vibrate).not.toHaveBeenCalled();

        expect(getHapticsEnabled()).toBe(true);
        setHapticsEnabled(false);
        expect(getHapticsEnabled()).toBe(false);
        haptic('turnAlert');
        hapticWheelTick(1);
        hapticDealRun();
        expect(navigator.vibrate).not.toHaveBeenCalled();

        setHapticsEnabled(true);
        haptic('turnAlert');
        expect(navigator.vibrate).toHaveBeenCalledTimes(1);
    });

    test('prefers the native Capacitor driver when the shell provides one', () => {
        navigator.vibrate = vi.fn();
        const impact = vi.fn();
        const notification = vi.fn();
        const selectionChanged = vi.fn();
        window.Capacitor = {
            isNativePlatform: () => true,
            Plugins: { Haptics: { impact, notification, selectionChanged } },
        };

        haptic('trumpBroken');
        expect(impact).toHaveBeenCalledWith({ style: 'HEAVY' });
        haptic('podiumWin');
        expect(notification).toHaveBeenCalledWith({ type: 'SUCCESS' });
        haptic('cardPlay');
        expect(selectionChanged).toHaveBeenCalledTimes(1);
        expect(navigator.vibrate).not.toHaveBeenCalled();
    });

    test('the deal run ticks at the animation cadence, capped and paced', () => {
        vi.useFakeTimers();
        navigator.vibrate = vi.fn();
        hapticDealRun({ cardCount: 36, staggerMs: 115 });
        vi.runAllTimers();
        // Every other card, capped at 18 ticks.
        expect(navigator.vibrate).toHaveBeenCalledTimes(18);
        expect(navigator.vibrate).toHaveBeenCalledWith(8);
    });

    test('wheel detents follow intensity like the click track', () => {
        navigator.vibrate = vi.fn();
        hapticWheelTick(1);
        hapticWheelTick(0.2);
        expect(navigator.vibrate.mock.calls.map(([ms]) => ms)).toEqual([12, 7]);
    });

    test('buzz plays custom escalation shapes on web and native alike', () => {
        vi.useFakeTimers();
        navigator.vibrate = vi.fn();
        buzz({ pattern: [30, 70, 30, 70, 30], nativeStyle: 'Heavy', nativeTaps: 3 });
        expect(navigator.vibrate).toHaveBeenCalledWith([30, 70, 30, 70, 30]);

        const impact = vi.fn();
        window.Capacitor = {
            isNativePlatform: () => true,
            Plugins: { Haptics: { impact } },
        };
        buzz({ pattern: [18, 90, 18], nativeStyle: 'Medium', nativeTaps: 2 });
        vi.runAllTimers();
        expect(impact.mock.calls).toEqual([[{ style: 'MEDIUM' }], [{ style: 'MEDIUM' }]]);
        expect(navigator.vibrate).toHaveBeenCalledTimes(1);

        setHapticsEnabled(false);
        buzz({ pattern: [50] });
        expect(impact).toHaveBeenCalledTimes(2);
        expect(navigator.vibrate).toHaveBeenCalledTimes(1);
    });
});
