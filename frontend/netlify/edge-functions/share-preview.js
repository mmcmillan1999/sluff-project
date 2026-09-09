// Link previews for shared Sluff links.
//
// Messaging apps fetch a link's HTML without running the app, so every path
// used to preview as the generic landing page. This edge function runs in
// front of the SPA shell for tournament and table invite links and rewrites
// the Open Graph / Twitter tags so the preview names the event: the
// tournament's title, host, stakes and seats (from the backend's public
// preview endpoint), or a "seat saved for you" card for a table link.
// Anything that goes wrong falls back to the generic invite copy, and the
// page itself is never touched beyond the <head> tags.

const BACKEND = 'https://sluff-backend.onrender.com';
const SITE = 'https://playsluff.com';
const FETCH_TIMEOUT_MS = 1500;

const escapeAttr = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const tokens = (value) => {
    const n = Number(value) || 0;
    return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, '');
};

const startLabel = (preview) => {
    if (preview.startRule === 'when_full') return 'starts when every seat is taken';
    if (preview.startRule === 'at_time' && preview.startsAt) {
        const when = new Date(preview.startsAt);
        if (!Number.isNaN(when.getTime())) {
            return `starts ${when.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/Denver' })} MT`;
        }
    }
    return `starts when ${preview.creatorName || 'the host'} says go`;
};

const describeTournament = (preview) => {
    const stakes = `${tokens(preview.buyInTokens)} token buy-in · ${preview.startingStack} chips`;
    if (preview.status === 'registering') {
        const seats = `${preview.seatsTaken} of ${preview.maxSeats} seats taken`;
        return `${preview.creatorName ? `${preview.creatorName} is hosting. ` : ''}${stakes} · ${seats} · ${startLabel(preview)}.`;
    }
    if (preview.status === 'running') {
        return `Under way · round ${preview.round} · ${preview.playersLeft} still in · ${stakes}.`;
    }
    if (preview.status === 'complete') {
        return `Finished after ${preview.round} rounds · ${stakes}.`;
    }
    return `${stakes}.`;
};

async function fetchTournamentPreview(id) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        const response = await fetch(`${BACKEND}/api/tournaments/${id}/preview`, { signal: controller.signal });
        if (!response.ok) return null;
        return await response.json();
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

// Replace the content of one <meta property="..."> / <meta name="..."> tag,
// whatever whitespace the shell's formatting puts between its attributes.
const setMeta = (html, attr, key, value) => html.replace(
    new RegExp(`(<meta\\s+${attr}="${key}"\\s+content=")[^"]*(")`, 'g'),
    `$1${escapeAttr(value)}$2`,
);

export default async (request, context) => {
    const response = await context.next();
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return response;

    const url = new URL(request.url);
    const tournamentMatch = url.pathname.match(/^\/tournament\/(\d{1,12})\/?$/);
    const tableMatch = url.pathname.match(/^\/join\/([A-Za-z0-9_-]{1,100})\/?$/);
    if (!tournamentMatch && !tableMatch) return response;

    let meta;
    if (tableMatch) {
        meta = {
            title: 'A seat is saved for you at Sluff',
            description: 'A friend saved you a seat at their Sluff table. Create a free account and jump in — no download, a game in under a minute.',
            image: `${SITE}/sluff-table-preview-v1.png`,
            alt: 'Sluff — a seat is saved for you',
        };
    } else {
        meta = {
            title: 'You’re invited to a Sluff tournament',
            description: 'A friend wants you in their Sluff tournament. Create a free account and register — no download, free to play.',
            image: `${SITE}/sluff-tournament-preview-v1.png`,
            alt: 'Sluff — you’re invited to a tournament',
        };
        const preview = await fetchTournamentPreview(tournamentMatch[1]);
        if (preview && preview.name) {
            meta.title = `${preview.name} · Sluff Tournament`;
            meta.description = describeTournament(preview);
            meta.alt = `Sluff tournament: ${preview.name}`;
        }
    }

    let html = await response.text();
    html = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeAttr(meta.title)}</title>`);
    html = setMeta(html, 'name', 'description', meta.description);
    html = setMeta(html, 'property', 'og:title', meta.title);
    html = setMeta(html, 'property', 'og:description', meta.description);
    html = setMeta(html, 'property', 'og:url', `${SITE}${url.pathname}`);
    html = setMeta(html, 'property', 'og:image', meta.image);
    html = setMeta(html, 'property', 'og:image:secure_url', meta.image);
    html = setMeta(html, 'property', 'og:image:alt', meta.alt);
    html = setMeta(html, 'name', 'twitter:title', meta.title);
    html = setMeta(html, 'name', 'twitter:description', meta.description);
    html = setMeta(html, 'name', 'twitter:image', meta.image);
    html = setMeta(html, 'name', 'twitter:image:alt', meta.alt);

    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.set('cache-control', 'no-cache, must-revalidate');
    return new Response(html, { status: response.status, headers });
};

export const config = { path: ['/tournament/*', '/join/*'] };
