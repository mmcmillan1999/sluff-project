// Tournament links: build and share https://playsluff.com/tournament/<id>,
// and parse a tournament id back out of a URL (page load or native deep
// link). The same shape as tableInvites.js, for the same reasons.
import { Capacitor } from '@capacitor/core';
import { formatTokens } from '../components/tournament/tournamentFormat';

const CANONICAL_ORIGIN = 'https://playsluff.com';

export function getTournamentInviteUrl(tournamentId) {
    const origin = Capacitor.isNativePlatform() ? CANONICAL_ORIGIN : window.location.origin;
    return `${origin}/tournament/${tournamentId}`;
}

// Accepts full URLs (https://playsluff.com/tournament/12, sluff://tournament/12)
// or bare paths (/tournament/12). Also honors a ?tournament=12 query fallback.
export function extractInviteTournamentId(url) {
    if (!url) return null;
    try {
        const parsed = new URL(url, CANONICAL_ORIGIN);
        const match = parsed.pathname.match(/^\/tournament\/(\d{1,12})\/?$/);
        if (match) return Number(match[1]);
        const queryId = parsed.searchParams.get('tournament');
        return queryId && /^\d{1,12}$/.test(queryId) ? Number(queryId) : null;
    } catch {
        return null;
    }
}

export function tournamentInviteText(tournament) {
    if (!tournament) return 'Come play in a Sluff tournament with me!';
    const stakes = `${formatTokens(tournament.buyInTokens)} token buy-in, ${tournament.startingStack} chips`;
    if (tournament.status === 'running') {
        return `Sluff tournament "${tournament.name}" is under way (${stakes}). Come watch!`;
    }
    return `Come play in my Sluff tournament — "${tournament.name}" (${stakes}). Registration is open!`;
}

// Returns 'shared' | 'dismissed' | 'copied' | 'failed'. On 'failed' the caller
// should surface the URL some other way (e.g. window.prompt).
export async function shareTournamentInvite(tournament) {
    const url = getTournamentInviteUrl(tournament.id);
    if (navigator.share) {
        try {
            await navigator.share({ title: 'Sluff', text: tournamentInviteText(tournament), url });
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
