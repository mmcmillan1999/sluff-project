'use strict';

// The call to the felt: what Liam says when a tournament starts, and who
// counts as a favorite. Pure — the director feeds it the roster and each
// entrant's record, and hands the text to the TTS the champion line uses.
//
// Every fragment a player controls (usernames, the event's name) is reduced
// to plain speakable characters before it reaches the prompt, the same
// guard that keeps eleven_v3 audio tags out of the champion line. Nothing
// here says which entrants are house players: favorites come from the
// record alone, and the word "house" never appears.

const { spokenChampionName } = require('../services/championLine');

const FAVORITES_COUNT = 3;
// Read every name up to this many; past it, read the first NAMED_WHEN_MORE
// and count the rest so the line fits inside the hold.
const MAX_NAMED = 9;
const NAMED_WHEN_MORE = 8;
const MAX_TITLE_LENGTH = 60;

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

// Numbers read as words, so the voice never spells them out.
function numberWord(n) {
    const value = Number(n);
    if (!Number.isInteger(value) || value < 0 || value > 99) return String(n);
    if (value < 20) return ONES[value];
    return TENS[Math.floor(value / 10)] + (value % 10 ? `-${ONES[value % 10]}` : '');
}

function countWord(n) {
    const word = numberWord(n);
    return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * The round call, rounds two onward. The bell says "ding ding"; Liam says
 * the rest, over the ring card, while the deal holds.
 */
function buildRoundCall({ round, playersLeft }) {
    const left = Number(playersLeft);
    const remaining = left === 1 ? 'is one player' : `are ${numberWord(left)} players`;
    return `It's round ${numberWord(round)}, ladies and gentlemen, and there ${remaining} remaining with chips.`;
}

// The event's name, reduced like a player name but a little longer and
// allowed its commas and apostrophes ("Mcsaddle's Tournament").
function spokenTitle(raw) {
    if (typeof raw !== 'string') return null;
    const spoken = raw
        .replace(/[_]+/g, ' ')
        .replace(/[^A-Za-z0-9 ',\-]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_TITLE_LENGTH)
        .trim()
        .replace(/[,\-\s]+$/, '');
    return spoken.length > 0 ? spoken : null;
}

function listWithAnd(items) {
    if (items.length <= 1) return items.join('');
    if (items.length === 2) return `${items[0]} and ${items[1]}`;
    return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function podiumRate(record) {
    return record.played > 0 ? record.podiums / record.played : 0;
}

/**
 * Tonight's favorites: the entrants with the best podium rate (podiums per
 * tournament played), up to three. A player needs at least one podium to be
 * a favorite; ties go to more podiums, then to the name. An empty list
 * means the line skips the favorites clause rather than inventing one.
 *
 * @param {Array<{userId:number, username:string}>} entries
 * @param {Map<number, {played:number, podiums:number}>} records
 */
function pickFavorites(entries, records, { count = FAVORITES_COUNT } = {}) {
    return entries
        .map(entry => ({ entry, record: records.get(Number(entry.userId)) || { played: 0, podiums: 0 } }))
        .filter(({ record }) => record.played > 0 && record.podiums > 0)
        .sort((a, b) => (
            podiumRate(b.record) - podiumRate(a.record)
            || b.record.podiums - a.record.podiums
            || a.entry.username.localeCompare(b.entry.username)
        ))
        .slice(0, count)
        .map(({ entry }) => entry.username);
}

/**
 * Liam's line. `entries` is the field in the order it should be read (host
 * first); `favorites` the names pickFavorites chose.
 */
function buildWelcomeScript({ id, name, entries, favorites = [] }) {
    const roster = entries.map(entry => spokenChampionName(entry.username)).filter(Boolean);
    const read = roster.length > MAX_NAMED
        ? [...roster.slice(0, NAMED_WHEN_MORE), `${roster.length - NAMED_WHEN_MORE} more`]
        : roster;
    const spokenFavorites = favorites.map(spokenChampionName).filter(Boolean);
    const title = spokenTitle(name);
    const parts = [`Welcome to Sluff Tournament number ${Number(id)}...`];
    if (title) parts.push(`${title}.`);
    if (read.length > 0) parts.push(`Tonight at the tables: ${listWithAnd(read)}.`);
    if (spokenFavorites.length > 0) {
        parts.push(`Tonight's favorite${spokenFavorites.length > 1 ? 's' : ''}... ${listWithAnd(spokenFavorites)}.`);
    }
    parts.push(`${countWord(roster.length)} player${roster.length === 1 ? '' : 's'}. One champion. Take your seats.`);
    return parts.join(' ');
}

// How long round one holds for the welcome: the bugle and the gap before
// Liam starts, his line at the announcer's pace, then the bell and the ring
// card with the felt to themselves — never less than the floor, never past
// the ceiling. Sized to the script so a nine-name field is not cut off
// mid-sentence and a three-name field is not left waiting.
const BUGLE_MS = 3_600;
const WORDS_PER_SECOND = 2.5;
const PAUSE_MS = 450;        // each "..." in the script
const RING_CARD_LEAD_MS = 3_500;
const HOLD_CEILING_MS = 30_000;

function welcomeHoldFor(script, floorMs = 18_000) {
    const text = typeof script === 'string' ? script : '';
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    const pauses = (text.match(/\.\.\./g) || []).length;
    const speechMs = Math.round((words / WORDS_PER_SECOND) * 1000) + pauses * PAUSE_MS;
    const total = BUGLE_MS + speechMs + RING_CARD_LEAD_MS;
    return Math.min(HOLD_CEILING_MS, Math.max(floorMs, Math.ceil(total / 500) * 500));
}

module.exports = { pickFavorites, buildWelcomeScript, buildRoundCall, welcomeHoldFor, numberWord, spokenTitle, listWithAnd, FAVORITES_COUNT, MAX_NAMED, NAMED_WHEN_MORE };
