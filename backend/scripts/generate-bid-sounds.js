// backend/scripts/generate-bid-sounds.js
//
// Generates the four bidding-phase accents into frontend/public/Sounds:
//   bid_frog       - a low, slow bullfrog "rrrribbit"            (Sound Generation)
//   bid_solo       - a plain female voice: "Solo bid."           (Text-to-Speech)
//   bid_heart_solo - a stunned-arena announcer: "HEART SOLO!"    (TTS shout mixed over a crowd+fanfare SFX)
//   bid_all_pass   - a comedic sad-trombone "womp womp womp waahh" (Sound Generation)
//
// Saves each as the next "<base>_v<n>.mp3" (never overwrites). Re-run for new variants.
//   node scripts/generate-bid-sounds.js                 # all four
//   node scripts/generate-bid-sounds.js frog all_pass   # subset
//
// Requires ELEVENLABS_API_KEY in backend/.env (sound_generation + text_to_speech).

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const ffmpeg = require('ffmpeg-static');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const KEY = process.env.ELEVENLABS_API_KEY;
const SOUNDS_DIR = path.resolve(__dirname, '../../frontend/public/Sounds');

// Premade ElevenLabs voices (usable without voices_read permission).
const VOICES = {
    rachel: '21m00Tcm4TlvDq8ikWAM', // calm female
    adam: 'pNInz6obpgDQGcFmaJgB',   // deep male narrator — good for the big shout
};

async function soundGen(prompt, duration) {
    const res = await fetch('https://api.elevenlabs.io/v1/sound-generation', {
        method: 'POST',
        headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json', accept: 'audio/mpeg' },
        body: JSON.stringify({ text: prompt, duration_seconds: duration, prompt_influence: 0.45 }),
    });
    if (!res.ok) throw new Error(`sound-gen HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return Buffer.from(await res.arrayBuffer());
}

async function tts(voiceId, text, settings) {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json', accept: 'audio/mpeg' },
        body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', voice_settings: settings }),
    });
    if (!res.ok) throw new Error(`tts HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return Buffer.from(await res.arrayBuffer());
}

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

function save(base, buf) {
    const file = nextVariant(base);
    fs.writeFileSync(file, buf);
    console.log(`  ✓ ${path.basename(file)} (${(buf.length / 1024).toFixed(1)} KB)`);
}

// Output base filename per maker key (defaults to "bid_<key>").
const BASES = {
    suit_spades: 'suit_spades',
    suit_clubs: 'suit_clubs',
    suit_diamonds: 'suit_diamonds',
    round_end: 'round_end',
};

const makers = {
    async pass() {
        // A single soft wooden table knock — the classic card-table "knock = pass".
        return soundGen(
            'A single soft knuckle knock on a solid wooden table — one quick quiet tap, dry and close-miked, short, no music.',
            1,
        );
    },
    async suit_spades() {
        return tts(VOICES.rachel, 'Spades.', { stability: 0.55, similarity_boost: 0.75, style: 0.25, use_speaker_boost: true });
    },
    async suit_clubs() {
        return tts(VOICES.rachel, 'Clubs.', { stability: 0.55, similarity_boost: 0.75, style: 0.25, use_speaker_boost: true });
    },
    async suit_diamonds() {
        return tts(VOICES.rachel, 'Diamonds.', { stability: 0.55, similarity_boost: 0.75, style: 0.25, use_speaker_boost: true });
    },
    async round_end() {
        // Mario-flag vibe without copying the actual tune: an original retro win jingle.
        return soundGen(
            'A triumphant retro 8-bit "level complete" victory fanfare — a short ascending celebratory chiptune flourish that resolves on a bright happy chord, like clearing a video game stage, upbeat and rewarding.',
            3.5,
        );
    },
    async frog() {
        return soundGen(
            'A single large bullfrog croak, very low and slow, deep and wet and resonant — a long "rrrrribbit" — natural pond ambience, clear and prominent, dry, no music.',
            2,
        );
    },
    async all_pass() {
        return soundGen(
            'The classic comedic "sad trombone" failure sting — a descending wah-wah-wah-waaah womp trombone, brassy, funny, like a game-show losing horn, dry, no music.',
            2.5,
        );
    },
    async solo() {
        return tts(VOICES.rachel, 'Solo bid.', { stability: 0.5, similarity_boost: 0.75, style: 0.2, use_speaker_boost: true });
    },
    async heart_solo() {
        // Two ingredients, then mixed: the announcer shout on top of a stunned arena.
        const shout = await tts(VOICES.adam, 'HEART... SOLO!', { stability: 0.3, similarity_boost: 0.8, style: 0.85, use_speaker_boost: true });
        const crowd = await soundGen(
            'A massive stadium erupts — a stunned, gasping crowd swelling into a huge roar and cheers, with a triumphant brass fanfare blast through giant arena amplifiers, grand, epic and dramatic, like a championship moment.',
            5,
        );
        const tmp = os.tmpdir();
        const shoutF = path.join(tmp, 'hs_shout.mp3');
        const crowdF = path.join(tmp, 'hs_crowd.mp3');
        fs.writeFileSync(shoutF, shout);
        fs.writeFileSync(crowdF, crowd);
        const out = nextVariant('bid_heart_solo');
        // Crowd swells first; the announcer lands ~0.9s in over the peak. Boost the
        // shout so it cuts through, then normalize the whole thing.
        const filter =
            '[1:a]adelay=900|900,volume=2.2[v];' +
            '[0:a]volume=1.0[c];' +
            '[c][v]amix=inputs=2:duration=longest:dropout_transition=0,dynaudnorm=f=200[out]';
        const ff = spawnSync(ffmpeg, ['-y', '-i', crowdF, '-i', shoutF, '-filter_complex', filter, '-map', '[out]', '-codec:a', 'libmp3lame', '-q:a', '4', out], { encoding: 'utf8' });
        try { fs.unlinkSync(shoutF); fs.unlinkSync(crowdF); } catch { /* best effort */ }
        if (ff.status !== 0) throw new Error(`ffmpeg mix failed: ${ff.stderr?.slice(-300)}`);
        console.log(`  ✓ ${path.basename(out)} (mixed shout + crowd)`);
        return null; // already written
    },
};

(async () => {
    if (!KEY) { console.error('ELEVENLABS_API_KEY not set in backend/.env'); process.exit(1); }
    const requested = process.argv.slice(2);
    const names = requested.length ? requested : Object.keys(makers);
    for (const name of names) {
        const make = makers[name];
        if (!make) { console.warn(`! unknown "${name}" (known: ${Object.keys(makers).join(', ')})`); continue; }
        console.log(`\n${BASES[name] || `bid_${name}`}:`);
        try {
            const buf = await make();
            if (buf) save(BASES[name] || `bid_${name}`, buf);
        } catch (e) {
            console.error(`  ✗ ${name}: ${e.message}`);
        }
    }
    console.log('\nDone. Audition them in sound-audition.html.');
})();
