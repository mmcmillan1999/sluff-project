// backend/tests/championLine.test.js
// The personalized champion sting service: names reduced to speakable text
// (and stripped of anything that could smuggle TTS tags), cached one
// generation per name, and every failure mode collapsing to null so the
// client's generic sting always covers.

const assert = require('assert');
const { getChampionLine, spokenChampionName } = require('../src/services/championLine');

function makePool({ cached = null } = {}) {
    const calls = { selects: 0, inserts: 0 };
    return {
        calls,
        async query(sql, params) {
            if (/^SELECT/i.test(sql.trim())) {
                calls.selects += 1;
                return { rows: cached ? [{ audio: cached }] : [] };
            }
            calls.inserts += 1;
            calls.lastInsert = params;
            return { rows: [] };
        },
    };
}

const okFetch = (audio) => async () => ({
    ok: true,
    arrayBuffer: async () => audio,
});

async function runChampionLineTests() {
    console.log('Running champion line tests...');
    let testCounter = 1;
    const pass = (name) => console.log(`  ✔ Test ${testCounter++}: ${name}`);
    const originalKey = process.env.ELEVENLABS_API_KEY;
    process.env.ELEVENLABS_API_KEY = 'test-key';

    try {
        // --- Name reduction ---
        assert.strictEqual(spokenChampionName('jazzachy'), 'jazzachy');
        assert.strictEqual(spokenChampionName('MrNoobCrusher'), 'Mr Noob Crusher');
        assert.strictEqual(spokenChampionName('cool_dude99'), 'cool dude 99');
        assert.strictEqual(
            spokenChampionName('[laughs] evil [whispers]name'),
            'laughs evil whispersname',
            'brackets are stripped so audio tags cannot survive as tags',
        );
        assert.strictEqual(spokenChampionName('🚂🚂🚂'), null, 'nothing speakable -> null');
        assert.strictEqual(spokenChampionName(''), null);
        assert.strictEqual(spokenChampionName(null), null);
        assert.ok(spokenChampionName('x'.repeat(200)).length <= 40, 'length capped');
        pass('Names reduce to speakable text; tags, emoji, and lengths are tamed.');

        // --- Cache hit skips generation entirely ---
        {
            const cachedAudio = Buffer.from('cached-mp3-bytes-longer-than-nothing');
            const pool = makePool({ cached: cachedAudio });
            let generated = false;
            const line = await getChampionLine(pool, 'jazzachy', {
                fetchImpl: async () => { generated = true; throw new Error('must not be called'); },
            });
            assert.strictEqual(line, cachedAudio);
            assert.strictEqual(generated, false);
            assert.strictEqual(pool.calls.inserts, 0);
            pass('A cached name never touches the TTS API again.');
        }

        // --- First sight generates, stores, returns ---
        {
            const fresh = new ArrayBuffer(2048);
            const pool = makePool();
            const line = await getChampionLine(pool, 'MrNoobCrusher', { fetchImpl: okFetch(fresh) });
            assert.ok(Buffer.isBuffer(line) && line.length === 2048);
            assert.strictEqual(pool.calls.inserts, 1);
            assert.strictEqual(pool.calls.lastInsert[0], 'mrnoobcrusher', 'keyed case-insensitively');
            assert.strictEqual(pool.calls.lastInsert[1], 'Mr Noob Crusher', 'stores the spoken form');
            pass('A new champion generates once and lands in the cache.');
        }

        // --- Every failure mode is a quiet null ---
        {
            const pool = makePool();
            assert.strictEqual(
                await getChampionLine(pool, 'jazzachy', {
                    fetchImpl: async () => ({ ok: false, status: 500, text: async () => 'boom' }),
                }),
                null,
                'TTS failure -> null',
            );
            assert.strictEqual(await getChampionLine(pool, '🚂', { fetchImpl: okFetch(new ArrayBuffer(2048)) }), null, 'unspeakable -> null');
            delete process.env.ELEVENLABS_API_KEY;
            assert.strictEqual(await getChampionLine(pool, 'jazzachy', { fetchImpl: okFetch(new ArrayBuffer(2048)) }), null, 'no API key -> null');
            pass('No key, no speakable name, or a failed TTS all fall back quietly.');
        }
    } finally {
        if (originalKey === undefined) delete process.env.ELEVENLABS_API_KEY;
        else process.env.ELEVENLABS_API_KEY = originalKey;
    }

    console.log('Champion line tests passed.');
}

module.exports = runChampionLineTests;

if (require.main === module) {
    runChampionLineTests().catch(error => { console.error(error); process.exitCode = 1; });
}
