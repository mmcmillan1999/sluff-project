// backend/scripts/build-audition.js
//
// Scans frontend/public/Sounds for generated "<name>_v<n>.mp3" variants and
// writes frontend/public/sound-audition.html — a simple page to click through
// and compare them. Re-run after each generation batch.
//
//   node scripts/build-audition.js
//   then open frontend/public/sound-audition.html in a browser
//   (or, with the dev server running, http://localhost:3000/sound-audition.html)

const fs = require('fs');
const path = require('path');

const SOUNDS_DIR = path.resolve(__dirname, '../../frontend/public/Sounds');
const OUT_HTML = path.resolve(__dirname, '../../frontend/public/sound-audition.html');

const EXT = /_v\d+\.(mp3|webm|ogg|wav|m4a)$/i;

// Sounds we want to record but may not have any variants for yet. They always
// get a section (with just a record row) so they're auditionable from the start.
const PLANNED = ['bid_frog', 'bid_solo', 'bid_heart_solo', 'bid_all_pass'];

const files = fs.readdirSync(SOUNDS_DIR).filter((f) => EXT.test(f));
const groups = {};
for (const f of files) {
    const base = f.replace(EXT, '');
    (groups[base] = groups[base] || []).push(f);
}
for (const base of PLANNED) {
    if (!groups[base]) groups[base] = [];
}
for (const base of Object.keys(groups)) {
    groups[base].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

const sections = Object.keys(groups).sort().map((base) => {
    const rows = groups[base].map((f) => `
      <div class="row">
        <span class="name">${f}</span>
        <audio controls preload="none" src="Sounds/${f}"></audio>
        <textarea class="fb" data-file="${f}" placeholder="What do you like / dislike? Keep, redo, tweak…"></textarea>
      </div>`).join('');
    const recRow = `
      <div class="row rec" data-base="${base}">
        <span class="name">🎙 record new variant</span>
        <button class="recBtn">● Record</button>
        <audio class="recPlay" controls preload="none" style="display:none"></audio>
        <button class="saveBtn" style="display:none">💾 Save to Sounds</button>
        <span class="recStatus"></span>
      </div>`;
    return `<section><h2>${base}</h2>${rows}${recRow}</section>`;
}).join('\n');

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sluff — Sound Audition</title>
  <style>
    body { font-family: system-ui, sans-serif; background:#1f2a24; color:#eee; margin:0; padding:24px; }
    h1 { margin:0 0 4px; }
    p.hint { color:#9fb3a8; margin:0 0 24px; }
    section { background:#28342d; border:1px solid #3a4a40; border-radius:10px; padding:16px 20px; margin:0 0 18px; }
    h2 { margin:0 0 12px; color:#7fd6a8; font-size:1.1rem; text-transform:none; }
    .row { display:flex; align-items:center; gap:14px; padding:6px 0; border-top:1px solid #344039; }
    .row:first-of-type { border-top:none; }
    .name { width:170px; font-size:0.85rem; color:#cfe; }
    audio { flex:0 0 240px; height:34px; }
    textarea.fb { flex:1; min-height:34px; resize:vertical; background:#1f2a24; color:#eee;
      border:1px solid #3a4a40; border-radius:6px; padding:6px 8px; font-family:inherit; font-size:0.85rem; }
    textarea.fb:focus { outline:none; border-color:#7fd6a8; }
    .toolbar { position:sticky; top:0; background:#1f2a24; padding:8px 0 16px; z-index:10; display:flex; gap:10px; align-items:center; }
    button { background:#7fd6a8; color:#11201a; border:none; border-radius:7px; padding:9px 16px;
      font-weight:600; font-size:0.9rem; cursor:pointer; }
    button.ghost { background:transparent; color:#9fb3a8; border:1px solid #3a4a40; }
    button:hover { filter:brightness(1.08); }
    #status { color:#9fb3a8; font-size:0.85rem; }
    .row.rec { border-top:1px dashed #4a5a50; }
    .row.rec .name { color:#e8b97f; }
    .recBtn { background:#e07a5f; color:#fff; padding:7px 14px; }
    .recBtn.recording { background:#c0392b; animation:pulse 1s infinite; }
    @keyframes pulse { 50% { filter:brightness(1.4); } }
    .saveBtn { background:#7fd6a8; }
    .recStatus { color:#9fb3a8; font-size:0.85rem; }
  </style>
</head>
<body>
  <h1>Sluff — Sound Audition</h1>
  <p class="hint">${files.length} variant file(s). Type notes under each sound — they auto-save in this browser. When done, click <b>Copy all feedback</b> and paste it back to me.</p>
  <div class="toolbar">
    <button id="copyBtn">📋 Copy all feedback</button>
    <button id="clearBtn" class="ghost">Clear all</button>
    <span id="status"></span>
  </div>
  ${sections || '<p>No <code>*_v*.mp3</code> variants found yet.</p>'}
  <script>
    const KEY = 'sluff-sound-feedback';
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    const boxes = Array.from(document.querySelectorAll('textarea.fb'));
    boxes.forEach((t) => {
      const f = t.dataset.file;
      if (saved[f]) t.value = saved[f];
      t.addEventListener('input', () => {
        const store = JSON.parse(localStorage.getItem(KEY) || '{}');
        if (t.value.trim()) store[f] = t.value; else delete store[f];
        localStorage.setItem(KEY, JSON.stringify(store));
        setStatus('Saved');
      });
    });
    function setStatus(msg) {
      const s = document.getElementById('status');
      s.textContent = msg;
      clearTimeout(setStatus._t);
      setStatus._t = setTimeout(() => { s.textContent = ''; }, 1500);
    }
    function buildReport() {
      const lines = ['Sound audition feedback:', ''];
      let any = false;
      boxes.forEach((t) => {
        if (t.value.trim()) { lines.push('- ' + t.dataset.file + ': ' + t.value.trim()); any = true; }
      });
      return any ? lines.join('\\n') : '';
    }
    document.getElementById('copyBtn').addEventListener('click', async () => {
      const report = buildReport();
      if (!report) { setStatus('No feedback entered yet.'); return; }
      try {
        await navigator.clipboard.writeText(report);
        setStatus('Copied to clipboard — paste it back to me.');
      } catch (e) {
        // Fallback: show it for manual copy
        window.prompt('Copy this feedback:', report);
      }
    });
    document.getElementById('clearBtn').addEventListener('click', () => {
      if (!confirm('Clear all feedback notes?')) return;
      localStorage.removeItem(KEY);
      boxes.forEach((t) => { t.value = ''; });
      setStatus('Cleared');
    });

    // ---- Microphone recording per section ----
    const recExt = (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm'))
      ? 'webm'
      : ((typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/ogg')) ? 'ogg' : 'webm');

    document.querySelectorAll('.row.rec').forEach((row) => {
      const base = row.dataset.base;
      const recBtn = row.querySelector('.recBtn');
      const saveBtn = row.querySelector('.saveBtn');
      const player = row.querySelector('.recPlay');
      const status = row.querySelector('.recStatus');
      let recorder = null, chunks = [], blob = null, stream = null;

      function say(msg) { status.textContent = msg; }

      recBtn.addEventListener('click', async () => {
        if (recorder && recorder.state === 'recording') {
          recorder.stop();
          return;
        }
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          say('Mic not supported in this browser.');
          return;
        }
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (e) {
          say('Mic permission denied.');
          return;
        }
        chunks = [];
        recorder = new MediaRecorder(stream);
        recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
        recorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          blob = new Blob(chunks, { type: 'audio/' + recExt });
          player.src = URL.createObjectURL(blob);
          player.style.display = '';
          saveBtn.style.display = '';
          recBtn.textContent = '● Record again';
          recBtn.classList.remove('recording');
          say('Recorded — preview, then Save.');
        };
        recorder.start();
        recBtn.textContent = '■ Stop';
        recBtn.classList.add('recording');
        saveBtn.style.display = 'none';
        say('Recording…');
      });

      saveBtn.addEventListener('click', async () => {
        if (!blob) return;
        say('Saving…');
        try {
          const res = await fetch('/__save-sound?base=' + encodeURIComponent(base) + '&ext=' + recExt, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: blob,
          });
          const data = await res.json();
          if (data.ok) {
            say('Saved as ' + data.file + ' ✓  (re-run build-audition.js to list it permanently)');
            saveBtn.style.display = 'none';
          } else {
            say('Save failed: ' + (data.error || 'unknown'));
          }
        } catch (e) {
          say('Save failed (is the dev server running?). Downloading instead.');
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = base + '_new.' + recExt;
          a.click();
        }
      });
    });
  </script>
</body>
</html>`;

fs.writeFileSync(OUT_HTML, html);
console.log(`Wrote ${path.relative(process.cwd(), OUT_HTML)} listing ${files.length} variant(s) across ${Object.keys(groups).length} sound(s).`);
