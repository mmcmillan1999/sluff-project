'use strict';

// Liam's stock lines, cached by their text. The tournament round call
// ("It's round seven, ladies and gentlemen, and there are thirteen players
// remaining with chips.") is one of a few hundred possible sentences, so
// each distinct line is synthesized once, ever, and served from
// announcer_lines after that. The text only ever comes from the server's
// own builders (tournament/tournamentWelcome.js) — never from a request.

const crypto = require('crypto');
const { synthesizeLine } = require('./championLine');

const textKey = text => crypto.createHash('sha1').update(String(text)).digest('hex');

/**
 * The line for `text`: cache hit, or generate-and-cache. Returns an mp3
 * Buffer, or null when unavailable (no key, empty text, TTS failure) —
 * the client opens the round with the bell alone.
 */
async function getAnnouncerLine(pool, text, { fetchImpl } = {}) {
    if (typeof text !== 'string' || text.trim().length === 0) return null;
    const key = textKey(text);
    try {
        const cached = await pool.query('SELECT audio FROM announcer_lines WHERE text_key = $1', [key]);
        if (cached.rows.length > 0) return cached.rows[0].audio;
        const audio = await synthesizeLine(text, { fetchImpl });
        if (!audio) return null;
        await pool.query(
            `INSERT INTO announcer_lines (text_key, text, audio)
             VALUES ($1, $2, $3)
             ON CONFLICT (text_key) DO NOTHING`,
            [key, text, audio],
        );
        return audio;
    } catch (error) {
        console.error(`[announcerLines] Unavailable for "${text.slice(0, 60)}":`, error.message);
        return null;
    }
}

module.exports = { getAnnouncerLine, textKey };
