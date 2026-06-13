// backend/scripts/generate-sounds.js
//
// Generate game SFX with the ElevenLabs Sound Effects API and drop them into
// frontend/public/Sounds as <name>_v<n>.mp3 variants (never overwrites the
// existing files, so we can audition before replacing anything).
//
// Usage (from backend/):
//   node scripts/generate-sounds.js                 # generate every spec below
//   node scripts/generate-sounds.js trump_broken    # just one
//   node scripts/generate-sounds.js card_play trick_win
//
// Requires ELEVENLABS_API_KEY in backend/.env.

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const API_URL = 'https://api.elevenlabs.io/v1/sound-generation';
const KEY = process.env.ELEVENLABS_API_KEY;
const OUT_DIR = path.resolve(__dirname, '../../frontend/public/Sounds');

// Each spec: a tuned prompt, target length, and how many variants to generate
// (variants give us round-robin so the same event never sounds identical twice).
const SPECS = {
    trump_broken: {
        variants: 4,
        duration: 0.8,
        prompt: 'A single sharp glassy crack with a short low resonant tail, decisive and tense, like breaking through a barrier — clean and punchy, a card-game accent for the dramatic moment trump is first played. Dry, no music.',
    },
    card_play: {
        variants: 3,
        duration: 0.5,
        prompt: 'A crisp soft playing card placed firmly onto a felt table — a single light flick and tap, tactile and satisfying, very short and dry, no music.',
    },
    trick_win: {
        variants: 3,
        duration: 0.9,
        prompt: 'A short satisfying card-game reward — cards being swept up together with a subtle warm positive tone, light and pleasant, under one second, no music.',
    },
    turn_alert: {
        variants: 2,
        duration: 0.6,
        prompt: "A soft friendly notification chime signalling it's your turn in a card game — gentle, clear, warm, not alarming, very short, no music.",
    },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function generateOne(name, spec, variant) {
    const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
            'xi-api-key': KEY,
            'Content-Type': 'application/json',
            accept: 'audio/mpeg',
        },
        body: JSON.stringify({
            text: spec.prompt,
            duration_seconds: spec.duration,
            prompt_influence: 0.4,
        }),
    });

    if (!res.ok) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) {
        throw new Error(`suspiciously small response (${buf.length} bytes) — likely an error payload`);
    }
    const file = path.join(OUT_DIR, `${name}_v${variant}.mp3`);
    fs.writeFileSync(file, buf);
    return { file, kb: (buf.length / 1024).toFixed(1) };
}

(async () => {
    if (!KEY) {
        console.error('ELEVENLABS_API_KEY not set in backend/.env');
        process.exit(1);
    }
    const requested = process.argv.slice(2);
    const names = requested.length ? requested : Object.keys(SPECS);

    for (const name of names) {
        const spec = SPECS[name];
        if (!spec) {
            console.warn(`! unknown sound "${name}" — skipping (known: ${Object.keys(SPECS).join(', ')})`);
            continue;
        }
        console.log(`\n${name}: generating ${spec.variants} variant(s) @ ${spec.duration}s`);
        for (let v = 1; v <= spec.variants; v++) {
            try {
                const { file, kb } = await generateOne(name, spec, v);
                console.log(`  ✓ ${path.basename(file)} (${kb} KB)`);
            } catch (e) {
                console.error(`  ✗ ${name}_v${v}: ${e.message}`);
            }
            await sleep(800); // be gentle on rate limits
        }
    }
    console.log('\nDone. Audition the *_v*.mp3 files in frontend/public/Sounds.');
})();
