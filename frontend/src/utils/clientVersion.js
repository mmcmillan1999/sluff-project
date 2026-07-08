// Deployed-build staleness check. __BUILD_ID__ is injected by vite.config.js
// at build time and the identical id is written to build/version.json. If the
// version.json served by the host stops matching the id compiled into this
// bundle, a newer frontend has been deployed and this client should reload.
/* global __BUILD_ID__ */

export const BUILD_ID = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : null;

export async function newBuildAvailable() {
    if (!BUILD_ID) return false; // dev/test bundle — nothing to compare against
    try {
        const res = await fetch(`/version.json?_=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return false;
        const data = await res.json();
        return !!data.buildId && data.buildId !== BUILD_ID;
    } catch {
        // Offline, or a host (dev server / native shell) without version.json —
        // never force a reload on uncertainty.
        return false;
    }
}
