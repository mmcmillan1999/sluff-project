// backend/scripts/voice-change.js
//
// Run an existing recording through ElevenLabs Speech-to-Speech (voice changer):
// keeps the words/timing of the source clip but re-voices it as a target voice.
// Output is saved as the next "<base>_v<n>.mp3" in frontend/public/Sounds.
//
// Usage (from backend/):
//   node scripts/voice-change.js <sourceFile> <base> [voiceId]
//   node scripts/voice-change.js trump_broken_v5.webm trump_broken VR6AewLTigWG4xSOukaG
//
// Requires ELEVENLABS_API_KEY in backend/.env (needs the speech_to_speech permission).

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ffmpeg = require('ffmpeg-static');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const KEY = process.env.ELEVENLABS_API_KEY;
const SOUNDS_DIR = path.resolve(__dirname, '../../frontend/public/Sounds');
const MODEL = 'eleven_english_sts_v2';

const [, , srcArg, baseArg, voiceArg] = process.argv;
const VOICE = voiceArg || 'VR6AewLTigWG4xSOukaG'; // Arnold — deep male, good gruff base

async function main() {
    if (!KEY) throw new Error('ELEVENLABS_API_KEY not set in backend/.env');
    if (!srcArg || !baseArg) throw new Error('usage: node scripts/voice-change.js <sourceFile> <base> [voiceId]');

    const src = path.isAbsolute(srcArg) ? srcArg : path.join(SOUNDS_DIR, srcArg);
    if (!fs.existsSync(src)) throw new Error(`source not found: ${src}`);

    // Transcode to mono 44.1k wav so the API gets a clean, supported input.
    const wav = path.join(__dirname, '_vc_src.wav');
    const ff = spawnSync(ffmpeg, ['-y', '-i', src, '-ar', '44100', '-ac', '1', wav], { encoding: 'utf8' });
    if (ff.status !== 0) throw new Error(`ffmpeg failed: ${ff.stderr?.slice(-300)}`);

    const buf = fs.readFileSync(wav);
    const fd = new FormData();
    fd.append('audio', new Blob([buf], { type: 'audio/wav' }), 'src.wav');
    fd.append('model_id', MODEL);
    fd.append('remove_background_noise', 'true');

    console.log(`Sending ${path.basename(src)} -> voice ${VOICE} (${MODEL})…`);
    const res = await fetch(`https://api.elevenlabs.io/v1/speech-to-speech/${VOICE}`, {
        method: 'POST',
        headers: { 'xi-api-key': KEY },
        body: fd,
    });
    if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`);
    }
    const out = Buffer.from(await res.arrayBuffer());
    fs.unlinkSync(wav);

    // Pick the next free variant number for this base.
    const esc = baseArg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('^' + esc + '_v(\\d+)\\.', 'i');
    let max = 0;
    for (const f of fs.readdirSync(SOUNDS_DIR)) {
        const m = f.match(re);
        if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    const name = `${baseArg}_v${max + 1}.mp3`;
    fs.writeFileSync(path.join(SOUNDS_DIR, name), out);
    console.log(`✓ wrote ${name} (${(out.length / 1024).toFixed(1)} KB)`);
}

main().catch((e) => {
    console.error('✗', e.message);
    process.exit(1);
});
