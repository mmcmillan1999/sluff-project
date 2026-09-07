// Pure helpers for the tournament screens: how a tournament's public state
// reads from one player's seat. Nothing here says who is a house player;
// the server never sends that and the client never needs it.

import { THEME_PRESENTATION } from '../../config/themePresentation';

export const STARTING_STACKS = [60, 90, 120, 180, 240];
export const MAX_BUY_IN_TOKENS = 50;
export const MIN_SEATS = 3;
export const MAX_SEATS = 15;
export const TOURNAMENT_VENUE = 'tournament-stage';

// Chip drain: between rounds every stack drops by this much.
export const DRAIN_OPTIONS = [
    { value: 0, label: 'Off' },
    { value: 5, label: '5%' },
    { value: 10, label: '10%' },
    { value: 20, label: '20%' },
];

export const drainLabel = (tournament) => {
    const percent = Number(tournament?.drainPercent) || 0;
    return percent > 0 ? `${percent}% between rounds` : 'Off';
};

// The drop everyone just took, while the board shows it (between rounds
// only: the round number on the drain matches the round just finished).
export const currentDrain = (tournament) => {
    const drain = tournament?.lastDrain;
    if (!drain || !tournament || (tournament.tables || []).some(table => !table.finished)) return null;
    return drain.round === tournament.round ? drain : null;
};

export const tableProgressLabel = (table) => {
    if (!table) return '';
    if (table.finished || table.phase === 'done') return 'Done';
    if (table.phase === 'dealing') return 'Dealing';
    if (table.phase === 'bidding') return 'Bidding';
    const total = table.tricksTotal || 11;
    return `Trick ${Math.min(total, (Number(table.trick) || 0) + 1)} of ${total}`;
};

export const VENUE_OPTIONS = [
    TOURNAMENT_VENUE,
    'fort-creek',
    'shirecliff-road',
    'dans-deck',
    'miss-pauls-academy',
].map(id => ({ id, name: THEME_PRESENTATION[id]?.name || id }));

export const ordinal = (place) => {
    const n = Number(place);
    if (!Number.isFinite(n)) return '';
    const suffix = (n % 100 >= 11 && n % 100 <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
    return `${n}${suffix}`;
};

export const formatTokens = (value) => {
    const n = Number(value) || 0;
    return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, '');
};

export const startLabel = (tournament) => {
    if (!tournament) return '';
    if (tournament.startRule === 'when_full') return 'Starts when every seat is taken';
    if (tournament.startRule === 'at_time' && tournament.startsAt) {
        const when = new Date(tournament.startsAt);
        return `Starts at ${when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    }
    return `Starts when ${tournament.creatorName || 'the creator'} says go`;
};

export const statusLabel = (tournament) => ({
    registering: 'Open for registration',
    running: `Round ${tournament?.round || 1}`,
    complete: 'Finished',
    cancelled: 'Cancelled',
    voided: 'Voided',
}[tournament?.status] || '');

// Standings order while a tournament runs: everyone still playing by stack,
// then the busted by the round they went out in (later first), then stack.
// Finished tournaments already carry a place from the server.
export const rankEntries = (entries = []) => {
    const finished = entries.every(entry => entry.place != null);
    const sorted = [...entries].sort((a, b) => {
        if (finished) return (a.place - b.place) || a.username.localeCompare(b.username);
        const aOut = a.status === 'busted';
        const bOut = b.status === 'busted';
        if (aOut !== bOut) return aOut ? 1 : -1;
        if (aOut) return ((b.bustedRound ?? 0) - (a.bustedRound ?? 0)) || (b.stack - a.stack) || a.username.localeCompare(b.username);
        return (b.stack - a.stack) || a.username.localeCompare(b.username);
    });
    return sorted.map((entry, index) => ({ ...entry, rank: finished ? entry.place : index + 1 }));
};

export const describeViewer = (tournament, userId) => {
    if (!tournament) return { me: null, entered: false, isCreator: false, myTable: null, rank: null };
    const id = Number(userId);
    const ranked = rankEntries(tournament.entries || []);
    const me = ranked.find(entry => entry.userId === id) || null;
    const name = me?.username;
    const myTable = name
        ? (tournament.tables || []).find(table => table.seats.includes(name) || (table.sitOuts || []).includes(name)) || null
        : null;
    return {
        me,
        entered: Boolean(me),
        isCreator: tournament.creatorUserId === id,
        myTable,
        rank: me?.rank ?? null,
        ranked,
    };
};

export const latestBust = (tournament) => {
    const busted = (tournament?.entries || []).filter(entry => entry.status === 'busted' && entry.bustedRound != null);
    if (busted.length === 0) return null;
    return busted.sort((a, b) => (b.bustedRound - a.bustedRound) || (b.stack - a.stack))[0];
};

// The four faces of the tournament cube (BrandHeader): the round, the
// leaders, you, and the last player out.
export const tournamentFaces = (tournament, userId, { watchingTableId = null } = {}) => {
    if (!tournament) return [];
    const { me, myTable, rank, ranked } = describeViewer(tournament, userId);
    const watching = watchingTableId
        ? (tournament.tables || []).find(table => table.tableId === watchingTableId) || null
        : null;
    const fieldSize = (tournament.entries || []).length;
    const playing = ranked.filter(entry => entry.status === 'playing');
    const leaders = playing.slice(0, 3);
    const out = latestBust(tournament);
    const faces = [
        {
            key: 'round',
            title: tournament.name,
            sub: tournament.status === 'running'
                ? `Round ${tournament.round} · ${tournament.playersLeft ?? playing.length} of ${fieldSize} left`
                : statusLabel(tournament),
        },
        {
            key: 'leaders',
            title: leaders.length ? leaders.map(entry => `${entry.username} ${entry.stack}`).join(' · ') : 'No leaders yet',
            sub: 'Leaders',
        },
    ];
    if (me) {
        const where = myTable
            ? `Table ${myTable.tableIndex + 1}`
            : (me.status === 'busted' ? `Out in round ${me.bustedRound}` : (me.status === 'finished' ? 'Finished' : 'Reseating'));
        faces.push({ key: 'you', title: `You ${ordinal(rank)} · ${me.stack}`, sub: where });
    }
    if (watching) {
        faces.push({
            key: 'watching',
            title: `Watching Table ${watching.tableIndex + 1} · ${tableProgressLabel(watching).toLowerCase()}`,
            sub: 'Tap for tables and the way back',
        });
    }
    faces.push({
        key: 'out',
        title: out ? `${out.username} out in round ${out.bustedRound}` : 'Nobody out yet',
        sub: out ? 'Latest bust' : 'Everyone is still in',
    });
    // Where the other tables are, so a finished table knows how long the
    // wait is.
    const others = (tournament.tables || []).filter(table => table.tableId !== myTable?.tableId);
    if (tournament.status === 'running' && others.length > 0) {
        faces.push({
            key: 'tables',
            title: others.map(table => `T${table.tableIndex + 1} ${tableProgressLabel(table).toLowerCase()}`).join(' · '),
            sub: 'Other tables',
        });
    }
    return faces;
};
