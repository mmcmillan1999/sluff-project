// Table invite links: build and share https://playsluff.com/join/<tableId>,
// and parse a tableId back out of a URL (page load or native deep link).
import { Capacitor } from '@capacitor/core';

const CANONICAL_ORIGIN = 'https://playsluff.com';

export function getInviteUrl(tableId) {
    // Inside the native shell the web origin is capacitor://localhost, which
    // is meaningless on a friend's device — always hand out the public domain.
    // On the web, keep the current origin so dev/preview links stay local.
    const origin = Capacitor.isNativePlatform() ? CANONICAL_ORIGIN : window.location.origin;
    return `${origin}/join/${tableId}`;
}

// Accepts full URLs (https://playsluff.com/join/table-3, sluff://join/table-3)
// or bare paths (/join/table-3). Also honors a ?join=table-3 query fallback.
export function extractInviteTableId(url) {
    if (!url) return null;
    try {
        const parsed = new URL(url, CANONICAL_ORIGIN);
        const match = parsed.pathname.match(/^\/join\/([A-Za-z0-9_-]+)\/?$/);
        if (match) return match[1];
        const queryId = parsed.searchParams.get('join');
        return queryId && /^[A-Za-z0-9_-]+$/.test(queryId) ? queryId : null;
    } catch {
        return null;
    }
}

// Returns 'shared' | 'dismissed' | 'copied' | 'failed'. On 'failed' the caller
// should surface the URL some other way (e.g. window.prompt).
export async function shareInvite(tableId, tableName) {
    const url = getInviteUrl(tableId);
    if (navigator.share) {
        try {
            await navigator.share({
                title: 'Sluff',
                text: `Come play Sluff with me — join my table${tableName ? ` "${tableName}"` : ''}!`,
                url
            });
            return 'shared';
        } catch (err) {
            // User closed the share sheet — not an error, don't fall through.
            if (err && err.name === 'AbortError') return 'dismissed';
        }
    }
    try {
        await navigator.clipboard.writeText(url);
        return 'copied';
    } catch {
        return 'failed';
    }
}
