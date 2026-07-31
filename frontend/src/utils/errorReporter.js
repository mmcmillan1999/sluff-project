// frontend/src/utils/errorReporter.js
//
// First-party crash reporting — the only crash visibility the app has once it
// is on phones we cannot reproduce. No SDK, no identity: message, stack, URL,
// and build id go to our own POST /api/errors, which caps and rate-limits
// everything. Deliberately no user id or username in the payload, so the
// store privacy label's "diagnostics not linked to identity" stays true.
//
// Everything here fails silent: a reporter that can itself break the app, or
// spam the backend from a render loop, is worse than no reporter.

import { getServerUrl } from '../services/api';
import { BUILD_ID } from './clientVersion';

const MAX_REPORTS_PER_SESSION = 10;

export function createErrorReporter({
    endpoint,
    fetchFn,
    buildId = BUILD_ID,
    maxPerSession = MAX_REPORTS_PER_SESSION,
    enabled = true,
} = {}) {
    const seen = new Set();
    let sent = 0;

    const report = (message, stack) => {
        try {
            if (!enabled || sent >= maxPerSession) return false;
            const text = String(message || '').trim();
            if (!text) return false;
            // One report per distinct error per session: a crash loop repeats
            // the same message hundreds of times and teaches nothing new.
            const key = text.slice(0, 120);
            if (seen.has(key)) return false;
            seen.add(key);
            sent += 1;

            const send = fetchFn || (typeof fetch !== 'undefined' ? fetch : null);
            if (!send) return false;
            send(endpoint || `${getServerUrl()}/api/errors`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: text.slice(0, 500),
                    stack: typeof stack === 'string' ? stack.slice(0, 4000) : null,
                    url: typeof window !== 'undefined' ? String(window.location?.pathname || '') : null,
                    buildId,
                }),
                // Survive page unloads — a crash often precedes one.
                keepalive: true,
            }).catch(() => {});
            return true;
        } catch {
            return false;
        }
    };

    return { report };
}

// Dev builds throw loudly in the console where they belong; only real players
// report home.
const isProduction = typeof import.meta !== 'undefined' && import.meta.env
    ? import.meta.env.PROD === true
    : false;

const defaultReporter = createErrorReporter({ enabled: isProduction });

export const reportError = (message, stack) => defaultReporter.report(message, stack);

export function initErrorReporter() {
    if (typeof window === 'undefined') return;
    window.addEventListener('error', (event) => {
        reportError(event?.message, event?.error?.stack);
    });
    window.addEventListener('unhandledrejection', (event) => {
        const reason = event?.reason;
        reportError(
            reason?.message || String(reason || 'Unhandled rejection'),
            reason?.stack,
        );
    });
}
