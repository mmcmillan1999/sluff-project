import { act, renderHook } from '@testing-library/react';
import { NUDGE_AT_MS, URGENT_AT_MS, useTurnNudge } from './useTurnNudge';

describe('useTurnNudge', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    const advance = (ms) => act(() => { vi.advanceTimersByTime(ms); });

    test('stays calm until the action has sat untouched for five seconds', () => {
        const { result } = renderHook(() => useTurnNudge({ actionKey: 'play|1' }));

        expect(result.current).toBe(0);
        advance(NUDGE_AT_MS - 500);
        expect(result.current).toBe(0);
        advance(600);
        expect(result.current).toBe(1);
    });

    test('escalates once more at fifteen seconds and stays there', () => {
        const { result } = renderHook(() => useTurnNudge({ actionKey: 'play|1' }));

        advance(URGENT_AT_MS + 250);
        expect(result.current).toBe(2);
        advance(10000);
        expect(result.current).toBe(2);
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
        expect(result.current).toBe(1);

        act(() => { window.dispatchEvent(new Event('pointerdown')); });
        advance(250);
        expect(result.current).toBe(0);

        advance(NUDGE_AT_MS - 1000);
        expect(result.current).toBe(0);
        advance(1500);
        expect(result.current).toBe(1);
    });

    test('a new decision restarts the clock from calm', () => {
        const { result, rerender } = renderHook(
            ({ actionKey }) => useTurnNudge({ actionKey }),
            { initialProps: { actionKey: 'play|1' } }
        );

        advance(URGENT_AT_MS + 250);
        expect(result.current).toBe(2);

        rerender({ actionKey: 'play|2' });
        expect(result.current).toBe(0);
        advance(NUDGE_AT_MS + 250);
        expect(result.current).toBe(1);
    });

    test('no pending action means no clock at all', () => {
        const onEscalate = vi.fn();
        const { result } = renderHook(() => useTurnNudge({ actionKey: null, onEscalate }));

        advance(URGENT_AT_MS * 2);
        expect(result.current).toBe(0);
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
