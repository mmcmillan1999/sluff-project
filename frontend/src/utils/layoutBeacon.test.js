import { describe, expect, it, vi } from 'vitest';
import { createLayoutBeacon, detectLayoutAnomalies } from './layoutBeacon';

const healthy = {
    innerWidth: 390, innerHeight: 750, dvhPx: 750, visualViewportHeight: 750, visualViewportOffsetTop: 0,
    scrollY: 0, gameViewRect: '0,63 390x687', footerRect: '0,600 390x150', handRect: '0,610 390x120',
};

describe('detectLayoutAnomalies', () => {
    it('is quiet on a healthy phone', () => {
        expect(detectLayoutAnomalies(healthy)).toEqual([]);
    });

    it('names a page nudged under the browser bar and a viewport that disagrees with itself', () => {
        expect(detectLayoutAnomalies({ ...healthy, scrollY: 34 })).toEqual(['document-scrolled']);
        expect(detectLayoutAnomalies({ ...healthy, dvhPx: 844 })).toEqual(['dvh-vs-innerHeight']);
        expect(detectLayoutAnomalies({ ...healthy, innerHeight: 844, dvhPx: 844, visualViewportHeight: 750 })).toEqual(['visual-viewport-short']);
    });

    it('does not mistake the keyboard for a bug', () => {
        const withKeyboard = { ...healthy, innerHeight: 844, dvhPx: 844, visualViewportHeight: 480 };
        expect(detectLayoutAnomalies(withKeyboard, { keyboardOpen: true })).toEqual([]);
    });

    it('spots the footer or hand hanging below the visible area', () => {
        expect(detectLayoutAnomalies({ ...healthy, footerRect: '0,700 390x150' })).toEqual(['footer-cut-off']);
        expect(detectLayoutAnomalies({ ...healthy, handRect: '0,720 390x120', appRect: '0,0 390x900' })).toEqual(['hand-cut-off', 'app-overflows']);
    });
});

describe('createLayoutBeacon', () => {
    it('posts a manual report to the error intake with the snapshot as the stack, and rate-limits repeats', () => {
        const fetchFn = vi.fn().mockResolvedValue({ ok: true });
        let clock = 1_000;
        const beacon = createLayoutBeacon({ endpoint: '/api/errors', fetchFn, buildId: 'test-build', now: () => clock });
        expect(beacon.reportNow()).toBe(true);
        expect(fetchFn).toHaveBeenCalledTimes(1);
        const [url, init] = fetchFn.mock.calls[0];
        expect(url).toBe('/api/errors');
        const body = JSON.parse(init.body);
        expect(body.message).toMatch(/^layout: /);
        expect(body.buildId).toBe('test-build');
        const stack = JSON.parse(body.stack);
        expect(stack.reason).toBe('manual');
        expect(stack.snapshot.innerHeight).toBe(window.innerHeight);
        // A settle check on a healthy layout sends nothing.
        expect(beacon.check('settle')).toBe(false);
        // Manual reports are never throttled by the cooldown, only the session cap.
        clock += 1_000;
        expect(beacon.reportNow()).toBe(true);
        expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('stays silent when disabled', () => {
        const fetchFn = vi.fn();
        const beacon = createLayoutBeacon({ endpoint: '/api/errors', fetchFn, enabled: false });
        expect(beacon.reportNow()).toBe(false);
        expect(fetchFn).not.toHaveBeenCalled();
    });
});
