import { act, renderHook } from '@testing-library/react';
import { ACTIVITY_PING_MS, NUDGE_AT_MS, URGENT_AT_MS, useTurnNudge } from './useTurnNudge';

describe('useTurnNudge', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    const advance = (ms) => act(() => { vi.advanceTimersByTime(ms); });

    test('stays calm until the action has sat untouched for five seconds', () => {
        const { result } = renderHook(() => useTurnNudge({ actionKey: 'play|1' }));

        expect(result.current.level).toBe(0);
        advance(NUDGE_AT_MS - 500);
        expect(result.current.level).toBe(0);
        advance(600);
        expect(result.current.level).toBe(1);
    });

    test('escalates once more at fifteen seconds and stays there', () => {
        const { result } = renderHook(() => useTurnNudge({ actionKey: 'play|1' }));

        advance(URGENT_AT_MS + 250);
        expect(result.current.level).toBe(2);
        advance(10000);
        expect(result.current.level).toBe(2);
    });

    test('fires the sound-and-haptic callback once per level, never per tick', () => {
        const onEscalate = vi.fn();
        renderHook(() => useTurnNudge({ actionKey: 'play|1', onEscalate }));

        advance(NUDGE_AT_MS + 250);
        expect(onEscalate.mock.calls).toEqual([[1]]);

        advance(3000);
        expect(onEscalate).toHaveBeenCalledTimes(1);

        advance(URGENT_AT_MS);
        expect(onEscalate.mock.calls).toEqual([[1], [2]]);
    });

    test('a player who is touching the screen restarts the clock', () => {
        const { result } = renderHook(() => useTurnNudge({ actionKey: 'play|1' }));

        advance(NUDGE_AT_MS + 250);
        expect(result.current.level).toBe(1);

        act(() => { window.dispatchEvent(new Event('pointerdown')); });
        advance(250);
        expect(result.current.level).toBe(0);

        advance(NUDGE_AT_MS - 1000);
        expect(result.current.level).toBe(0);
        advance(1500);
        expect(result.current.level).toBe(1);
    });

    test('a new decision restarts the clock from calm', () => {
        const { result, rerender } = renderHook(
            ({ actionKey }) => useTurnNudge({ actionKey }),
            { initialProps: { actionKey: 'play|1' } }
        );

        advance(URGENT_AT_MS + 250);
        expect(result.current.level).toBe(2);

        rerender({ actionKey: 'play|2' });
        expect(result.current.level).toBe(0);
        advance(NUDGE_AT_MS + 250);
        expect(result.current.level).toBe(1);
    });

    test('no pending action means no clock at all', () => {
        const onEscalate = vi.fn();
        const { result } = renderHook(() => useTurnNudge({ actionKey: null, onEscalate }));

        advance(URGENT_AT_MS * 2);
        expect(result.current.level).toBe(0);
        expect(result.current.afkSecondsLeft).toBe(null);
        expect(onEscalate).not.toHaveBeenCalled();
    });

    test('unmounting stops the clock and drops its listeners', () => {
        const onEscalate = vi.fn();
        const removeSpy = vi.spyOn(window, 'removeEventListener');
        const { unmount } = renderHook(() => useTurnNudge({ actionKey: 'play|1', onEscalate }));

        unmount();
        const removed = removeSpy.mock.calls.map(([type]) => type);
        ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(type => {
            expect(removed).toContain(type);
        });

        advance(URGENT_AT_MS * 2);
        expect(onEscalate).not.toHaveBeenCalled();
        removeSpy.mockRestore();
    });
});

describe('useTurnNudge AFK countdown and activity pings', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    const advance = (ms) => act(() => { vi.advanceTimersByTime(ms); });

    test('counts down only once the nudge shows, from the server anchor', () => {
        const { result } = renderHook(() => useTurnNudge({
            actionKey: 'play|1',
            afkTimeoutMs: 45000,
        }));

        // Level 0: nothing displays it, so publishing it would just force a
        // render per second on a calm table.
        advance(300);
        expect(result.current.afkSecondsLeft).toBe(null);

        advance(NUDGE_AT_MS);
        expect(result.current.level).toBe(1);
        expect(result.current.afkSecondsLeft).toBe(40);
        advance(20000);
        expect(result.current.afkSecondsLeft).toBe(20);
        advance(30000);
        expect(result.current.afkSecondsLeft).toBe(0);
    });

    test('input hides the countdown and re-anchors it to the ping', () => {
        const { result } = renderHook(() => useTurnNudge({
            actionKey: 'play|1',
            afkTimeoutMs: 45000,
        }));

        advance(30250);
        expect(result.current.afkSecondsLeft).toBe(15);

        // The touch pings the server (extending its clock) and resets the
        // nudge, so the countdown disappears rather than lying.
        act(() => { window.dispatchEvent(new Event('pointerdown')); });
        advance(300);
        expect(result.current.level).toBe(0);
        expect(result.current.afkSecondsLeft).toBe(null);

        // Idle again: the anchor is the PING (the last thing the server
        // heard), so the window restarts from there.
        advance(NUDGE_AT_MS);
        expect(result.current.level).toBe(1);
        expect(result.current.afkSecondsLeft).toBe(40);
    });

    test('a later server deadline wins over the local anchor', () => {
        const serverDeadline = Date.now() + 60000;
        const { result } = renderHook(() => useTurnNudge({
            actionKey: 'play|1',
            afkTimeoutMs: 45000,
            afkDeadline: serverDeadline,
        }));

        advance(NUDGE_AT_MS + 250);
        expect(result.current.afkSecondsLeft).toBe(55);
    });

    test('no timeout config means no countdown', () => {
        const { result } = renderHook(() => useTurnNudge({ actionKey: 'play|1' }));
        advance(NUDGE_AT_MS + 1000);
        expect(result.current.level).toBe(1);
        expect(result.current.afkSecondsLeft).toBe(null);
    });

    test('activity pings are throttled, not per-touch', () => {
        const onActivity = vi.fn();
        renderHook(() => useTurnNudge({ actionKey: 'play|1', onActivity }));

        // A burst of touches within the throttle window pings once.
        act(() => {
            window.dispatchEvent(new Event('pointerdown'));
            window.dispatchEvent(new Event('pointerdown'));
            window.dispatchEvent(new Event('pointerdown'));
        });
        expect(onActivity).toHaveBeenCalledTimes(1);

        advance(ACTIVITY_PING_MS + 100);
        act(() => { window.dispatchEvent(new Event('pointerdown')); });
        expect(onActivity).toHaveBeenCalledTimes(2);
    });

    test('no pings fire without input, even while idle-escalating', () => {
        const onActivity = vi.fn();
        renderHook(() => useTurnNudge({ actionKey: 'play|1', onActivity }));

        advance(URGENT_AT_MS * 3);
        // An idle player must never look active to the server, or the AFK
        // backstop could never fire at all.
        expect(onActivity).not.toHaveBeenCalled();
    });
});
