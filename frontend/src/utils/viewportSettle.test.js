import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onViewportSettle, resetStrayScroll, viewportSnapshot } from './viewportSettle';

const setViewport = (width, height) => {
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
};

describe('onViewportSettle', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        setViewport(390, 844);
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('fires on resize, then again only while the size keeps changing', () => {
        const callback = vi.fn();
        const stop = onViewportSettle(callback);
        expect(callback).not.toHaveBeenCalled();

        // A rotation: the browser reports the old size during the event and the
        // new size a few frames later.
        window.dispatchEvent(new Event('resize'));
        expect(callback).toHaveBeenCalledTimes(1);
        setViewport(844, 390);
        vi.advanceTimersByTime(120);
        expect(callback).toHaveBeenCalledTimes(2);
        // Nothing moved since: the later settle checks stay quiet.
        vi.advanceTimersByTime(1000);
        expect(callback).toHaveBeenCalledTimes(2);

        stop();
        window.dispatchEvent(new Event('resize'));
        expect(callback).toHaveBeenCalledTimes(2);
    });

    it('also listens to orientation, page show and a tab becoming visible', () => {
        const callback = vi.fn();
        const stop = onViewportSettle(callback);
        window.dispatchEvent(new Event('orientationchange'));
        window.dispatchEvent(new Event('pageshow'));
        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        expect(callback).toHaveBeenCalledTimes(3);
        stop();
    });

    it('can measure once on subscribe', () => {
        const callback = vi.fn();
        const stop = onViewportSettle(callback, { immediate: true });
        expect(callback).toHaveBeenCalledTimes(1);
        stop();
    });
});

describe('resetStrayScroll', () => {
    it('scrolls a strayed game view back to the top, and leaves other views alone', () => {
        const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
        Object.defineProperty(window, 'scrollY', { value: 12, configurable: true });
        document.body.classList.remove('game-active');
        expect(resetStrayScroll()).toBe(false);
        document.body.classList.add('game-active');
        expect(resetStrayScroll()).toBe(true);
        expect(scrollTo).toHaveBeenCalledWith(0, 0);
        Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
        expect(resetStrayScroll()).toBe(false);
        document.body.classList.remove('game-active');
        scrollTo.mockRestore();
    });
});

describe('viewportSnapshot', () => {
    it('is flat, scalar and names the felt boxes it could find', () => {
        const el = document.createElement('div');
        el.className = 'game-view';
        document.body.appendChild(el);
        const snapshot = viewportSnapshot();
        expect(snapshot.innerHeight).toBe(window.innerHeight);
        expect(typeof snapshot.orientation).toBe('string');
        expect(snapshot.gameViewRect).toMatch(/^-?\d+,-?\d+ \d+x\d+$/);
        expect(snapshot.footerRect).toBeNull();
        for (const value of Object.values(snapshot)) {
            expect(['string', 'number', 'boolean']).toContain(value === null ? 'string' : typeof value);
        }
        el.remove();
    });
});
