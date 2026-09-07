// Layout beacon: when a phone's layout goes wrong (the bottom of the app
// cut off, the page nudged under the browser bar, the viewport disagreeing
// with itself), the menu may be unreachable — so the app reports the
// geometry by itself. Anonymous, like crash reports: it goes to the same
// POST /api/errors intake as a "layout:" message with the viewport
// snapshot as the "stack", and it fails silent.
//
// detectLayoutAnomalies() is pure so the rules can be tested; startLayoutBeacon()
// wires it to the viewport-settle events; reportLayoutNow() is the manual
// trigger (a long press on the header cube) for when nothing else works.
import { onViewportSettle, viewportSnapshot } from './viewportSettle';
import { getServerUrl } from '../services/api';
import { BUILD_ID } from './clientVersion';

const MAX_REPORTS_PER_SESSION = 6;
const SETTLE_GRACE_MS = 1500;
const REPEAT_COOLDOWN_MS = 5 * 60 * 1000;

const parseRect = (rect) => {
    // "left,top widthxheight" as written by viewportSnapshot
    const match = typeof rect === 'string' && rect.match(/^(-?\d+),(-?\d+) (\d+)x(\d+)$/);
    if (!match) return null;
    const [, left, top, width, height] = match.map(Number);
    return { left, top, width, height, bottom: top + height };
};

// The rules. `snapshot` is a viewportSnapshot(); `extras` carries what the
// snapshot does not know (whether a text field has focus: the keyboard is
// not a bug).
export function detectLayoutAnomalies(snapshot, { keyboardOpen = false } = {}) {
    if (!snapshot) return [];
    const found = [];
    // With the keyboard up the visual viewport is legitimately short; judge
    // the boxes against the layout viewport then.
    const visible = !keyboardOpen && Number.isFinite(snapshot.visualViewportHeight) ? snapshot.visualViewportHeight : snapshot.innerHeight;
    if (Number.isFinite(snapshot.scrollY) && snapshot.scrollY > 2) found.push('document-scrolled');
    if (Number.isFinite(snapshot.dvhPx) && Number.isFinite(snapshot.innerHeight) && Math.abs(snapshot.dvhPx - snapshot.innerHeight) > 6) {
        found.push('dvh-vs-innerHeight');
    }
    if (!keyboardOpen && Number.isFinite(snapshot.visualViewportHeight) && Number.isFinite(snapshot.innerHeight)
        && snapshot.innerHeight - snapshot.visualViewportHeight > 40) {
        found.push('visual-viewport-short');
    }
    if (Number.isFinite(snapshot.visualViewportOffsetTop) && snapshot.visualViewportOffsetTop > 2) found.push('visual-viewport-offset');
    for (const [key, rule] of [['gameViewRect', 'game-view-overflows'], ['footerRect', 'footer-cut-off'], ['handRect', 'hand-cut-off'], ['appRect', 'app-overflows']]) {
        const rect = parseRect(snapshot[key]);
        if (rect && rect.height > 0 && rect.bottom > visible + 8) found.push(rule);
    }
    return found;
}

const keyboardOpen = () => {
    if (typeof document === 'undefined') return false;
    const el = document.activeElement;
    if (!el) return false;
    const tag = String(el.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || el.isContentEditable === true;
};

const currentView = () => {
    if (typeof document === 'undefined') return null;
    const container = document.querySelector('.app-content-container');
    const match = container?.className?.match(/app-view-([A-Za-z]+)/);
    return match ? match[1] : (document.body?.classList?.contains('game-active') ? 'gameTable' : null);
};

const appRect = () => {
    if (typeof document === 'undefined') return null;
    const el = document.querySelector('.app-content-container');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`;
};

export function createLayoutBeacon({
    endpoint,
    fetchFn,
    buildId = BUILD_ID,
    maxPerSession = MAX_REPORTS_PER_SESSION,
    enabled = true,
    now = () => Date.now(),
} = {}) {
    const lastSentAt = new Map();
    let sent = 0;

    const send = (reason, anomalies, snapshot) => {
        try {
            if (!enabled || sent >= maxPerSession) return false;
            const view = currentView();
            const signature = `${view}|${reason}|${anomalies.join(',')}`;
            const last = lastSentAt.get(signature);
            if (reason !== 'manual' && Number.isFinite(last) && now() - last < REPEAT_COOLDOWN_MS) return false;
            lastSentAt.set(signature, now());
            sent += 1;
            const doFetch = fetchFn || (typeof fetch !== 'undefined' ? fetch : null);
            if (!doFetch) return false;
            const message = `layout: ${view || 'unknown'} ${reason}${anomalies.length ? ` [${anomalies.join(' ')}]` : ''}`;
            doFetch(endpoint || `${getServerUrl()}/api/errors`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: message.slice(0, 500),
                    stack: JSON.stringify({ view, reason, anomalies, snapshot }).slice(0, 4000),
                    url: typeof window !== 'undefined' ? String(window.location?.pathname || '') : null,
                    buildId,
                }),
                keepalive: true,
            }).catch(() => {});
            return true;
        } catch {
            return false;
        }
    };

    const check = (reason = 'settle') => {
        try {
            const snapshot = viewportSnapshot();
            if (!snapshot) return false;
            snapshot.appRect = appRect();
            const anomalies = detectLayoutAnomalies(snapshot, { keyboardOpen: keyboardOpen() });
            if (reason === 'manual') return send('manual', anomalies, snapshot);
            if (anomalies.length === 0) return false;
            return send(reason, anomalies, snapshot);
        } catch {
            return false;
        }
    };

    let timer = null;
    const start = () => {
        if (typeof window === 'undefined') return () => {};
        const scheduleCheck = () => {
            if (timer) clearTimeout(timer);
            // Let the viewport finish moving before judging it.
            timer = setTimeout(() => { timer = null; check('settle'); }, SETTLE_GRACE_MS);
        };
        const stop = onViewportSettle(scheduleCheck, { immediate: true });
        return () => {
            if (timer) clearTimeout(timer);
            stop();
        };
    };

    return { start, check, reportNow: () => check('manual') };
}

const isProduction = typeof import.meta !== 'undefined' && import.meta.env
    ? import.meta.env.PROD === true
    : false;

const defaultBeacon = createLayoutBeacon({ enabled: isProduction });

export const startLayoutBeacon = () => defaultBeacon.start();
export const reportLayoutNow = () => defaultBeacon.reportNow();
