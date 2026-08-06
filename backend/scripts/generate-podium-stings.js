// backend/scripts/generate-podium-stings.js
//
// The stings that join podium_loss: the champion's moment on the top step,
// and the deadpan shrug when a draw sends everyone home. Voiced by the same
// premade Liam as the loss sting (eleven_v3), so the podium speaks with one
// voice.
//
// The champion sting is a two-layer build, heart-solo style: an ORIGINAL
// stadium-rock victory anthem (Sound Generation — Matt wanted Queen, and an
// original anthem with that energy is the closest thing we can ship without
// a sync license; no sampled masters, ever) with Liam's proclamation mixed
// over the top (podium_win_mix).
//
// Saves each as the next "<base>_v<n>.mp3" in frontend/public/Sounds (never
// overwrites — audition, then wire the winner in useSounds).
//   node scripts/generate-podium-stings.js                    # everything
//   node scripts/generate-podium-stings.js podium_win_anthem  # one base
//   node scripts/generate-podium-stings.js mix                # remix only:
//     re-blends podium_win_anthem_vA + podium_win_shout_vB (pass numbers
//     via MIX_ANTHEM/MIX_SHOUT env vars; defaults v1+v1).
//
// Requires ELEVENLABS_API_KEY in backend/.env (text_to_speech +
// sound_generation scopes).

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const ffmpeg = require('ffmpeg-static');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const KEY = process.env.ELEVENLABS_API_KEY;
const SOUNDS_DIR = path.resolve(__dirname, '../../frontend/public/Sounds');
const LIAM = 'TX3LPaxmHKxFdv7VOQHJ'; // premade Liam — the podium's voice
const MODEL = 'eleven_v3';

// One entry per candidate take. Several distinct lines per base beats
// re-rolls of one line: Matt auditions writing and delivery together.
const LINES = {
    podium_win: [
        'Ladies and gentlemen... your champion of Sluff! Somebody polish that crown.',
        'And THAT... is how it is done. Take a bow, champ.',
        '[laughs] The table is yours, champ. All hail!',
    ],
    draw_wash: [
        'Nobody wins. Nobody loses. Everybody... goes home.',
        '[sighs] A wash. All that drama... for nothing.',
        'Call it a draw. The cards keep their secrets.',
    ],
};

// The anthem bed: everything that makes a stadium champion moment — big
// guitars, piano, crowd — with an explicitly ORIGINAL melody. The generator
// cannot reproduce an existing recording, which is exactly the point.
const ANTHEM_PROMPT = 'A triumphant stadium rock victory anthem sting — huge electric guitar power '
    + 'chords with grand piano underneath, a soaring completely original champion melody, an arena '
    + 'crowd roaring and singing along wordlessly, slow mighty tempo, epic and glorious like winning '
    + 'the championship, building to one big final chord. Original composition, not any existing song.';
const ANTHEM_SECONDS = 8;
const ANTHEM_VARIANTS = 3;

// Liam's proclamation over the anthem. Original words with the arena energy
// Matt asked for — never lifted lyrics.
const SHOUT_LINES = [
    'THE CHAMPION... OF SLUFF! Tonight... the table belongs to you!',
    'CHAMPIONS stand alone... and tonight, that champion... is YOU!',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function nextVariant(base) {
    const esc = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('^' + esc + '_v(\\d+)\\.', 'i');
    let max = 0;
    for (const f of fs.readdirSync(SOUNDS_DIR)) {
        const m = f.match(re);
        if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return path.join(SOUNDS_DIR, `${base}_v${max + 1}.mp3`);
}

async function tts(text, settings = { stability: 0.5, similarity_boost: 0.75 }) {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${LIAM}`, {
        method: 'POST',
        headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json', accept: 'audio/mpeg' },
        body: JSON.stringify({ text, model_id: MODEL, voice_settings: settings }),
    });
    if (!res.ok) throw new Error(`tts HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) throw new Error(`suspiciously small response (${buf.length} bytes)`);
    return buf;
}

async function soundGen(prompt, duration) {
    const res = await fetch('https://api.elevenlabs.io/v1/sound-generation', {
        method: 'POST',
        headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json', accept: 'audio/mpeg' },
        body: JSON.stringify({ text: prompt, duration_seconds: duration, prompt_influence: 0.45 }),
    });
    if (!res.ok) throw new Error(`sound-gen HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return Buffer.from(await res.arrayBuffer());
}

// Blend a shout over an anthem, heart-solo recipe: the anthem builds first,
// the proclamation lands over its swell, one normalize pass over the whole.
function mixChampion(anthemFile, shoutFile) {
    const out = nextVariant('podium_win_mix');
    const filter =
        '[1:a]adelay=1200|1200,volume=2.2[v];'
        + '[0:a]volume=1.0[c];'
        + '[c][v]amix=inputs=2:duration=longest:dropout_transition=0,dynaudnorm=f=200[out]';
    const ff = spawnSync(ffmpeg, [
        '-y', '-i', anthemFile, '-i', shoutFile,
        '-filter_complex', filter, '-map', '[out]',
        '-codec:a', 'libmp3lame', '-q:a', '4', out,
    ], { encoding: 'utf8' });
    if (ff.status !== 0) throw new Error(`ffmpeg mix failed: ${ff.stderr?.slice(-300)}`);
    console.log(`  ✓ ${path.basename(out)} (${path.basename(anthemFile)} + ${path.basename(shoutFile)})`);
    return out;
}

const inSounds = (name) => path.join(SOUNDS_DIR, name);

(async () => {
    if (!KEY) { console.error('ELEVENLABS_API_KEY not set in backend/.env'); process.exit(1); }
    const requested = process.argv.slice(2);
    const bases = requested.length ? requested : [...Object.keys(LINES), 'podium_win_anthem', 'podium_win_shout', 'mix'];
    for (const base of bases) {
        if (base === 'podium_win_anthem') {
            console.log(`\npodium_win_anthem: ${ANTHEM_VARIANTS} variant(s) @ ${ANTHEM_SECONDS}s`);
            for (let v = 1; v <= ANTHEM_VARIANTS; v++) {
                try {
                    const buf = await soundGen(ANTHEM_PROMPT, ANTHEM_SECONDS);
                    const file = nextVariant('podium_win_anthem');
                    fs.writeFileSync(file, buf);
                    console.log(`  ✓ ${path.basename(file)} (${(buf.length / 1024).toFixed(1)} KB)`);
                } catch (e) {
                    console.error(`  ✗ anthem: ${e.message}`);
                }
                await sleep(800);
            }
            continue;
        }
        if (base === 'podium_win_shout') {
            console.log(`\npodium_win_shout: ${SHOUT_LINES.length} take(s)`);
            for (const text of SHOUT_LINES) {
                try {
                    // High style for the announcer bark, like heart solo's shout.
                    const buf = await tts(text, { stability: 0.3, similarity_boost: 0.8, style: 0.85, use_speaker_boost: true });
                    const file = nextVariant('podium_win_shout');
                    fs.writeFileSync(file, buf);
                    console.log(`  ✓ ${path.basename(file)} (${(buf.length / 1024).toFixed(1)} KB) — "${text}"`);
                } catch (e) {
                    console.error(`  ✗ "${text}": ${e.message}`);
                }
                await sleep(800);
            }
            continue;
        }
        if (base === 'mix') {
            const anthemN = process.env.MIX_ANTHEM || '1';
            const shoutN = process.env.MIX_SHOUT || '1';
            console.log(`\npodium_win_mix: anthem v${anthemN} + shout v${shoutN}`);
            try {
                mixChampion(
                    inSounds(`podium_win_anthem_v${anthemN}.mp3`),
                    inSounds(`podium_win_shout_v${shoutN}.mp3`),
                );
            } catch (e) {
                console.error(`  ✗ mix: ${e.message}`);
            }
            continue;
        }
        const lines = LINES[base];
        if (!lines) { console.warn(`! unknown "${base}"`); continue; }
        console.log(`\n${base}: ${lines.length} candidate take(s)`);
        for (const text of lines) {
            try {
                const buf = await tts(text);
                const file = nextVariant(base);
                fs.writeFileSync(file, buf);
                console.log(`  ✓ ${path.basename(file)} (${(buf.length / 1024).toFixed(1)} KB) — "${text}"`);
            } catch (e) {
                console.error(`  ✗ "${text}": ${e.message}`);
            }
            await sleep(800);
        }
    }
    console.log('\nDone. Audition the *_v*.mp3 takes, then wire the winners in useSounds.');
})();
