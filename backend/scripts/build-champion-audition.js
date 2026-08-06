// backend/scripts/build-champion-audition.js
//
// Matt's audition booth for the personalized champion sting: pulls every
// human username from the database, generates (and DB-caches) each player's
// "All hail your champion, NAME!" line through the same service production
// uses, then writes a local HTML page that plays each line over the
// podium_win_anthem bed with the exact in-game timing (line lands at +1.2s).
//
// Running this doubles as a production cache pre-warm: every existing player
// gets their line generated once, here, instead of at their first podium.
//
// Usage (from backend/):
//   node scripts/build-champion-audition.js            # all human players
//   node scripts/build-champion-audition.js jazzachy   # just some names
//
// Output: backend/scripts/champion-audition/audition.html (open in browser).
// Requires POSTGRES_CONNECT_STRING + ELEVENLABS_API_KEY in backend/.env.

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { getChampionLine, spokenChampionName } = require('../src/services/championLine');

const OUT_DIR = path.resolve(__dirname, 'champion-audition');
const ANTHEM = path.resolve(__dirname, '../../frontend/public/Sounds/podium_win_anthem_v1.mp3');

const escapeHtml = (value) => String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

(async () => {
    if (!process.env.ELEVENLABS_API_KEY) {
        console.error('ELEVENLABS_API_KEY not set in backend/.env');
        process.exit(1);
    }
    const pool = new Pool({
        connectionString: process.env.POSTGRES_CONNECT_STRING,
        ssl: { rejectUnauthorized: false },
    });

    // The cache table normally appears at backend boot (createTables); make
    // sure it exists here too so this script can pre-warm a database the new
    // backend has not deployed to yet. Identical DDL, idempotent.
    await pool.query(`
        CREATE TABLE IF NOT EXISTS champion_lines (
            name_key VARCHAR(80) PRIMARY KEY,
            display_name VARCHAR(80) NOT NULL,
            audio BYTEA NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `);

    const requested = process.argv.slice(2);
    let names;
    if (requested.length) {
        names = requested;
    } else {
        const { rows } = await pool.query(
            `SELECT username FROM users
             WHERE is_bot IS NOT TRUE
             ORDER BY LOWER(username)`,
        );
        names = rows.map(row => row.username);
    }
    console.log(`Generating champion lines for ${names.length} name(s)…`);

    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.copyFileSync(ANTHEM, path.join(OUT_DIR, 'anthem.mp3'));

    const entries = [];
    for (const name of names) {
        const spoken = spokenChampionName(name);
        if (!spoken) {
            console.warn(`  – ${name}: nothing speakable, skipped`);
            continue;
        }
        try {
            const audio = await getChampionLine(pool, name);
            if (!audio) {
                console.warn(`  ✗ ${name}: unavailable`);
                continue;
            }
            const file = `line_${entries.length}.mp3`;
            fs.writeFileSync(path.join(OUT_DIR, file), audio);
            entries.push({ name, spoken, file });
            console.log(`  ✓ ${name} -> "${spoken}" (${(audio.length / 1024).toFixed(1)} KB)`);
        } catch (error) {
            console.warn(`  ✗ ${name}: ${error.message}`);
        }
    }

    const rowsHtml = entries.map(({ name, spoken, file }) => `
        <tr>
            <td class="name">${escapeHtml(name)}</td>
            <td class="spoken">"All hail your champion... ${escapeHtml(spoken)}!"</td>
            <td>
                <button onclick="playFull('${escapeHtml(file)}')">▶ Full sting</button>
                <button onclick="playLine('${escapeHtml(file)}')">▶ Line only</button>
            </td>
        </tr>`).join('');

    fs.writeFileSync(path.join(OUT_DIR, 'audition.html'), `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Champion sting audition</title>
<style>
    body { font-family: 'Segoe UI', sans-serif; background: #14181f; color: #eef3f9; padding: 2rem; }
    h1 { color: #f1c963; }
    p { color: #9cb7d8; max-width: 60ch; }
    table { border-collapse: collapse; margin-top: 1rem; }
    td { padding: 0.45rem 1rem 0.45rem 0; border-bottom: 1px solid #2a3340; }
    .name { font-weight: 600; color: #f8dc92; }
    .spoken { color: #9cb7d8; font-style: italic; }
    button { background: #223047; color: #eef3f9; border: 1px solid #3d5a80; border-radius: 6px;
             padding: 0.35rem 0.8rem; margin-right: 0.4rem; cursor: pointer; }
    button:hover { border-color: #f1c963; }
</style>
</head>
<body>
<h1>All hail your champion…</h1>
<p>“Full sting” plays the anthem bed with the line landing at +1.2s — exactly the
in-game mix. Every line here is already cached in the production database, so
what you hear is what the podium will play.</p>
<table>${rowsHtml}
</table>
<script>
    let active = [];
    const stop = () => { active.forEach(a => { a.pause(); a.currentTime = 0; }); active = []; };
    function playLine(file) {
        stop();
        const line = new Audio(file);
        line.volume = 1.0;
        active = [line];
        line.play();
    }
    function playFull(file) {
        stop();
        const bed = new Audio('anthem.mp3');
        const line = new Audio(file);
        bed.volume = 0.45; line.volume = 1.0; // the 2.2x boost, approximated
        active = [bed, line];
        bed.play();
        setTimeout(() => line.play(), 1200);
    }
</script>
</body>
</html>
`);

    await pool.end();
    console.log(`\nDone: ${entries.length} line(s).`);
    console.log(`Open ${path.join(OUT_DIR, 'audition.html')} in a browser.`);
})();
