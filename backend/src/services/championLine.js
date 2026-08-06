// backend/src/services/championLine.js
//
// The personalized champion sting: Liam proclaiming "All hail your champion,
// NAME!" for the player who actually won. Generated once per name via
// ElevenLabs TTS and cached in champion_lines; the client layers the line
// over the podium_win_anthem bed (see useSounds.playChampionSting), with the
// pre-mixed generic sting as the fallback whenever this returns null.
//
// The name only ever arrives from live engine state (a seated winner's
// registered username or a bot's roster name) — never from request input —
// and is additionally reduced to plain speakable characters before it goes
// anywhere near the TTS prompt, so player-controlled text cannot smuggle
// eleven_v3 audio tags or prompt structure into the voice.

'use strict';

const LIAM = 'TX3LPaxmHKxFdv7VOQHJ'; // premade Liam — the podium's voice
const MODEL = 'eleven_v3';
const MAX_SPOKEN_LENGTH = 40;

/**
 * Reduce a player name to something Liam can actually say:
 * - camelCase and snake_case split into words (MrNoobCrusher -> Mr Noob Crusher)
 * - anything outside letters, digits, spaces, apostrophes, hyphens dropped
 *   (this also strips [ ] brackets, blocking eleven_v3 audio-tag injection)
 * - whitespace collapsed, length capped
 * Returns null when nothing speakable remains.
 */
function spokenChampionName(raw) {
    if (typeof raw !== 'string') return null;
    const spoken = raw
        .replace(/[_.]+/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/([A-Za-z])(\d)/g, '$1 $2')
        .replace(/[^A-Za-z0-9 '\-]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_SPOKEN_LENGTH)
        .trim();
    return spoken.length > 0 ? spoken : null;
}

const nameKey = (raw) => String(raw || '').trim().toLocaleLowerCase().slice(0, 80);

async function generateLine(spoken, fetchImpl) {
    const key = process.env.ELEVENLABS_API_KEY;
    if (!key) return null;
    const doFetch = fetchImpl || fetch;
    const res = await doFetch(`https://api.elevenlabs.io/v1/text-to-speech/${LIAM}`, {
        method: 'POST',
        headers: { 'xi-api-key': key, 'Content-Type': 'application/json', accept: 'audio/mpeg' },
        body: JSON.stringify({
            text: `All hail your champion... ${spoken}!`,
            model_id: MODEL,
            // The announcer bark, same settings as the podium_win shout takes.
            voice_settings: { stability: 0.3, similarity_boost: 0.8, style: 0.85, use_speaker_boost: true },
        }),
    });
    if (!res.ok) throw new Error(`tts HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const audio = Buffer.from(await res.arrayBuffer());
    if (audio.length < 1000) throw new Error(`suspiciously small tts response (${audio.length} bytes)`);
    return audio;
}

/**
 * The champion line for a player name: cache hit, or generate-and-cache.
 * Returns an mp3 Buffer, or null when unavailable (no API key, unspeakable
 * name, TTS failure) — callers fall back to the generic sting on null.
 */
async function getChampionLine(pool, playerName, { fetchImpl } = {}) {
    const spoken = spokenChampionName(playerName);
    const key = nameKey(playerName);
    if (!spoken || !key) return null;

    try {
        const cached = await pool.query(
            'SELECT audio FROM champion_lines WHERE name_key = $1',
            [key],
        );
        if (cached.rows.length > 0) return cached.rows[0].audio;

        const audio = await generateLine(spoken, fetchImpl);
        if (!audio) return null;

        // Concurrent podiums may race the same brand-new name; first write
        // wins and the loser's audio is simply discarded.
        await pool.query(
            `INSERT INTO champion_lines (name_key, display_name, audio)
             VALUES ($1, $2, $3)
             ON CONFLICT (name_key) DO NOTHING`,
            [key, spoken, audio],
        );
        return audio;
    } catch (error) {
        console.error(`[championLine] Unavailable for "${playerName}":`, error.message);
        return null;
    }
}

module.exports = { getChampionLine, spokenChampionName };
