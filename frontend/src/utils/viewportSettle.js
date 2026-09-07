// Mobile viewports move under the page: Safari's bottom bar collapses and
// returns, a rotation reports the OLD dimensions for a few frames, the
// keyboard comes and goes, a backgrounded tab resumes with a different bar
// state. Everything in the game view that measures window.innerHeight has
// to re-measure on all of those, and then once more after the numbers have
// settled — a single `resize` listener catches the first frame only, which
// is how a rotate-and-back left plates and cards "in the wrong spot".
//
// onViewportSettle(callback): calls back on every viewport event, then
// again on a short settle schedule while the size keeps changing. Returns
// an unsubscribe. The callback receives no arguments and should re-read
// the window itself.
const SETTLE_DELAYS_MS = [120, 360, 900];

const viewportKey = () => {
    if (typeof window === 'undefined') return '';
    const vv = window.visualViewport;
    return `${window.innerWidth}x${window.innerHeight}|${vv ? `${Math.round(vv.width)}x${Math.round(vv.height)}@${Math.round(vv.offsetTop)}` : ''}`;
};

export function onViewportSettle(callback, { immediate = false } = {}) {
    if (typeof window === 'undefined') return () => {};
    let timers = [];
    let lastKey = viewportKey();
    const clearTimers = () => {
        timers.forEach(clearTimeout);
        timers = [];
    };
    const fire = () => {
        lastKey = viewportKey();
        callback();
    };
    const kick = () => {
        clearTimers();
        fire();
        // The dimensions a mobile browser reports during the event are often
        // the previous ones; re-read after the platform has settled.
        timers = SETTLE_DELAYS_MS.map(delay => setTimeout(() => {
            if (viewportKey() !== lastKey) fire();
        }, delay));
    };
    const onVisibility = () => {
        if (document.visibilityState === 'visible') kick();
    };
    window.addEventListener('resize', kick);
    window.addEventListener('orientationchange', kick);
    window.addEventListener('pageshow', kick);
    document.addEventListener('visibilitychange', onVisibility);
    const vv = window.visualViewport;
    vv?.addEventListener?.('resize', kick);
    if (immediate) kick();
    return () => {
        clearTimers();
        window.removeEventListener('resize', kick);
        window.removeEventListener('orientationchange', kick);
        window.removeEventListener('pageshow', kick);
        document.removeEventListener('visibilitychange', onVisibility);
        vv?.removeEventListener?.('resize', kick);
    };
}

// The game view is a fixed-height, non-scrolling shell, but iOS can still
// nudge the document by a few pixels when its toolbar collapses or the
// keyboard closes, which shows as the felt's bottom edge being cut off.
// Put it back whenever the game is on screen.
export function resetStrayScroll() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return false;
    if (!document.body?.classList?.contains('game-active')) return false;
    const strayed = (window.scrollY || 0) > 0 || (document.documentElement?.scrollTop || 0) > 0;
    if (!strayed) return false;
    try {
        window.scrollTo(0, 0);
    } catch {
        return false;
    }
    return true;
}

// A flat, scalar-only picture of the viewport for bug reports: what the
// browser says the visible area is versus what the layout is using.
export function viewportSnapshot() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return null;
    const rect = (selector) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`;
    };
    const vv = window.visualViewport;
    let standalone = false;
    try {
        standalone = window.navigator?.standalone === true
            || window.matchMedia?.('(display-mode: standalone)')?.matches === true;
    } catch { /* matchMedia unavailable */ }
    let dvhPx = null;
    try {
        if (typeof CSS !== 'undefined' && CSS.supports?.('height', '100dvh')) {
            const probe = document.createElement('div');
            probe.style.cssText = 'position:fixed;top:0;left:0;height:100dvh;width:0;pointer-events:none;visibility:hidden;';
            document.body.appendChild(probe);
            dvhPx = Math.round(probe.getBoundingClientRect().height);
            probe.remove();
        }
    } catch { /* leave null */ }
    return {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        clientHeight: document.documentElement?.clientHeight ?? null,
        dvhPx,
        visualViewportHeight: vv ? Math.round(vv.height) : null,
        visualViewportOffsetTop: vv ? Math.round(vv.offsetTop) : null,
        screenHeight: window.screen?.height ?? null,
        scrollY: Math.round(window.scrollY || 0),
        orientation: window.screen?.orientation?.type || (window.innerHeight >= window.innerWidth ? 'portrait' : 'landscape'),
        standalone,
        devicePixelRatio: window.devicePixelRatio ?? null,
        userAgent: String(window.navigator?.userAgent || '').slice(0, 160),
        gameViewRect: rect('.game-view'),
        footerRect: rect('.game-footer'),
        handRect: rect('.player-hand-container'),
        bottomSeatRect: rect('.player-seat-wrapper-bottom'),
        headerRect: rect('.advertising-header, header'),
    };
}
