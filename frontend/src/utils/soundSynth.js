// frontend/src/utils/soundSynth.js
//
// Procedural sound effects, synthesized in the shared game AudioContext.
// Everything here exists because repeated identical samples read as robotic:
// a synthesized hit can be born with its own tiny pitch, timing, and level,
// the way no two real card flicks or wheel clicks are ever the same.
//
// Three voices live here:
//   cardFlick     — one card leaving the deck: an airy snap plus a paper thup.
//                   Scheduled in a run by scheduleDealSounds to replace the
//                   old 3-second recording (the "scratching a record" one).
//   wheelClick    — the venue wheel's flapper slapping a peg, Price-is-Right
//                   style: a bright clack with a woody knock under it. The
//                   wheel calls this per peg crossing, so the click rate is
//                   the wheel's real speed and the slow final clicks fall
//                   exactly where the tension is.
//   wheelSettle   — the low clunk of the wheel coming to rest.
//
// Every function is defensive: audio is garnish, and a Web Audio quirk on
// some browser must never take the game down with it.

// One second of shared white noise per context, reused by every hit.
const noiseBuffers = new WeakMap();
const noiseBufferFor = (ctx) => {
    let buffer = noiseBuffers.get(ctx);
    if (!buffer) {
        const length = Math.max(1, Math.floor(ctx.sampleRate || 44100));
        buffer = ctx.createBuffer(1, length, ctx.sampleRate || 44100);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
        noiseBuffers.set(ctx, buffer);
    }
    return buffer;
};

const envelope = (ctx, t, peak, attack, decay) => {
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return env;
};

const noiseHit = (ctx, destination, { t, frequency, q, peak, attack, decay, pitch = 1 }) => {
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBufferFor(ctx);
    if (noise.playbackRate) noise.playbackRate.value = pitch;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(frequency, t);
    filter.Q.value = q;
    const env = envelope(ctx, t, peak, attack, decay);
    noise.connect(filter);
    filter.connect(env);
    env.connect(destination);
    // Start somewhere random in the shared buffer so no two hits share grain.
    const offset = Math.random() * 0.5;
    noise.start(t, offset, attack + decay + 0.05);
    noise.onended = () => { try { env.disconnect(); } catch { /* best effort */ } };
};

const toneHit = (ctx, destination, { t, type = 'sine', from, to = null, peak, attack, decay }) => {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    if (to !== null && osc.frequency.exponentialRampToValueAtTime) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + attack + decay);
    }
    const env = envelope(ctx, t, peak, attack, decay);
    osc.connect(env);
    env.connect(destination);
    osc.start(t);
    osc.stop(t + attack + decay + 0.05);
    osc.onended = () => { try { env.disconnect(); } catch { /* best effort */ } };
};

/**
 * One card leaving the deck. Soft by design — 36 of these in a row should
 * read as a practiced dealer, not a stapler.
 */
export const cardFlick = (ctx, destination, { when = 0, pitch = 1, gain = 1 } = {}) => {
    try {
        const t = Math.max(when, ctx.currentTime);
        // The airy snap of the card face sliding off the deck.
        noiseHit(ctx, destination, {
            t,
            frequency: 2400 * pitch,
            q: 0.8,
            peak: 0.32 * gain,
            attack: 0.005,
            decay: 0.045,
            pitch,
        });
        // The paper-weight thup as it lands.
        toneHit(ctx, destination, {
            t: t + 0.012,
            from: 180 * pitch,
            to: 95 * pitch,
            peak: 0.16 * gain,
            attack: 0.004,
            decay: 0.04,
        });
    } catch { /* audio is garnish */ }
};

/**
 * One card played onto the felt. Rounder and darker than the deal flick —
 * a deliberate placement, not a riffle — with the top end kept low because
 * bright noise zips are exactly what read as record scratch in the old
 * sample. Also serves as the score ceremonies' counting tick.
 */
export const cardSnap = (ctx, destination, { when = 0, pitch = 1, gain = 1 } = {}) => {
    try {
        const t = Math.max(when, ctx.currentTime);
        // The card face brushing the felt.
        noiseHit(ctx, destination, {
            t,
            frequency: 1450 * pitch,
            q: 1.1,
            peak: 0.3 * gain,
            attack: 0.004,
            decay: 0.05,
            pitch,
        });
        // The weight of the card landing.
        toneHit(ctx, destination, {
            t: t + 0.008,
            from: 225 * pitch,
            to: 115 * pitch,
            peak: 0.22 * gain,
            attack: 0.005,
            decay: 0.055,
        });
    } catch { /* audio is garnish */ }
};

/**
 * Schedule a full deal as individual flicks on the context clock, matched to
 * the deal animation's cadence. Per-card pitch (±6%), timing (±8ms), and
 * level (±20%) jitter is the whole point: a steady march of similar-but-
 * never-identical hits instead of one looped sample.
 */
export const scheduleDealSounds = (ctx, destination, {
    count = 36,
    staggerMs = 115,
    startAt = null,
} = {}) => {
    try {
        const t0 = Math.max(Number(startAt) || 0, ctx.currentTime + 0.03);
        const step = Math.max(0.02, staggerMs / 1000);
        for (let i = 0; i < count; i += 1) {
            const jitter = (Math.random() * 2 - 1) * 0.008;
            const pitch = 1 + (Math.random() * 2 - 1) * 0.06;
            const gain = 0.8 + Math.random() * 0.2;
            cardFlick(ctx, destination, {
                when: t0 + i * step + jitter,
                pitch,
                gain,
            });
        }
        return count;
    } catch {
        return 0;
    }
};

/**
 * The flapper slapping a peg — the Price is Right voice. `intensity` (0..1)
 * follows wheel speed: full pulls crack, the dying clicks tap.
 */
export const wheelClick = (ctx, destination, { when = 0, intensity = 1, pitch = 1 } = {}) => {
    try {
        const t = Math.max(when, ctx.currentTime);
        const level = Math.min(1, Math.max(0.1, intensity));
        // The bright slap of the flapper tip.
        noiseHit(ctx, destination, {
            t,
            frequency: 2100 * pitch,
            q: 1.8,
            peak: 0.4 * level,
            attack: 0.002,
            decay: 0.022,
            pitch,
        });
        // The woody body of the peg under it.
        toneHit(ctx, destination, {
            t,
            type: 'triangle',
            from: 620 * pitch,
            to: 340 * pitch,
            peak: 0.22 * level,
            attack: 0.002,
            decay: 0.03,
        });
    } catch { /* audio is garnish */ }
};

// --- The Midnight Special score -----------------------------------------
// A full celebration cue, synthesized end to end. "Midnight Special" is a
// traditional (public domain) song; this is our own instrumental
// arrangement of its chorus, so there is no licensing exposure. If Matt
// ever records or licenses a cover, swap the melody block for a buffer
// played against the same MIDNIGHT_TIMELINE — the animation reads its cues
// from these numbers, so sound and picture stay in step.

// Seconds from cue start. The banner component drives captions, the
// spotlight, and the train fade from the same table.
export const MIDNIGHT_TIMELINE = {
    horn: 0,
    trainEnter: 1.0,
    line1: 4.6,        // "Let the Midnight Special"
    spotlight: 6.9,    // "shine a light on me" — light hits the runner
    line2: 9.6,        // "Let the Midnight Special"
    line3: 11.9,       // "shine its ever-lovin' light on me"
    fade: 14.8,
    total: 16.8,
};

const NOTE = { D4: 293.66, E4: 329.63, G4: 392.0, A4: 440.0, B4: 493.88, C5: 523.25 };

/**
 * The whole number: a powerful two-blast steam horn, the drive-wheel chug
 * underneath, and a whistle-organ lead singing the traditional chorus
 * melody on cue.
 */
export const midnightSpecialScore = (ctx, destination, { when = 0 } = {}) => {
    try {
        const t0 = Math.max(when, ctx.currentTime);

        // The horn: a real locomotive chord is a dense minor cluster. Two
        // blasts — a short warning and the long departure — with the tail
        // sagging as the steam gives out.
        const hornChord = [233, 277, 311, 370];
        const blast = (start, length, peak) => {
            for (const freq of hornChord) {
                const osc = ctx.createOscillator();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(freq, start);
                if (osc.frequency.exponentialRampToValueAtTime) {
                    osc.frequency.exponentialRampToValueAtTime(freq * 0.93, start + length);
                }
                const filter = ctx.createBiquadFilter();
                filter.type = 'lowpass';
                filter.frequency.setValueAtTime(1400, start);
                const env = envelope(ctx, start, peak, 0.05, length);
                osc.connect(filter);
                filter.connect(env);
                env.connect(destination);
                osc.start(start);
                osc.stop(start + length + 0.1);
                osc.onended = () => { try { env.disconnect(); } catch { /* best effort */ } };
            }
        };
        blast(t0 + MIDNIGHT_TIMELINE.horn, 0.55, 0.1);
        blast(t0 + MIDNIGHT_TIMELINE.horn + 0.8, 1.7, 0.12);

        // The chug: steady eighth-note drive from the moment the train rolls
        // on until the fade, accented in pairs like real side rods.
        const chugStart = MIDNIGHT_TIMELINE.trainEnter;
        const chugEnd = MIDNIGHT_TIMELINE.fade;
        for (let s = chugStart; s < chugEnd; s += 0.21) {
            const beat = Math.round((s - chugStart) / 0.21);
            noiseHit(ctx, destination, {
                t: t0 + s,
                frequency: 240,
                q: 0.9,
                peak: beat % 2 === 0 ? 0.055 : 0.035,
                attack: 0.01,
                decay: 0.08,
            });
        }

        // The chorus, as a whistle-organ lead: triangle body + a quiet upper
        // octave for shine. Traditional melody, our arrangement.
        const sing = (start, notes) => {
            let cursor = t0 + start;
            for (const [freq, length] of notes) {
                for (const [mult, peak] of [[1, 0.11], [2, 0.03]]) {
                    const osc = ctx.createOscillator();
                    osc.type = 'triangle';
                    osc.frequency.setValueAtTime(freq * mult, cursor);
                    const env = envelope(ctx, cursor, peak, 0.05, length * 0.92);
                    osc.connect(env);
                    env.connect(destination);
                    osc.start(cursor);
                    osc.stop(cursor + length + 0.1);
                    osc.onended = () => { try { env.disconnect(); } catch { /* best effort */ } };
                }
                cursor += length;
            }
        };
        const { D4, E4, G4, A4, B4, C5 } = NOTE;
        // "Let the Mid-night Spe-cial"
        const call = [[D4, 0.3], [G4, 0.42], [G4, 0.3], [A4, 0.42], [B4, 0.85]];
        // "shine a light on me"
        const answer = [[B4, 0.34], [A4, 0.34], [G4, 0.5], [E4, 0.5], [G4, 1.1]];
        // "shine its ev-er-lov-in' light on me"
        const finale = [
            [B4, 0.3], [C5, 0.3], [B4, 0.3], [A4, 0.3],
            [G4, 0.42], [A4, 0.42], [E4, 0.5], [G4, 1.5],
        ];
        sing(MIDNIGHT_TIMELINE.line1, call);
        sing(MIDNIGHT_TIMELINE.spotlight, answer);
        sing(MIDNIGHT_TIMELINE.line2, call);
        sing(MIDNIGHT_TIMELINE.line3, finale);

        // A last far-off horn as the train fades.
        blast(t0 + MIDNIGHT_TIMELINE.fade + 0.2, 1.2, 0.05);
    } catch { /* audio is garnish */ }
};

/**
 * The wheel coming to rest: one low, satisfied clunk.
 */
export const wheelSettle = (ctx, destination, { when = 0 } = {}) => {
    try {
        const t = Math.max(when, ctx.currentTime);
        toneHit(ctx, destination, {
            t,
            from: 150,
            to: 95,
            peak: 0.4,
            attack: 0.006,
            decay: 0.18,
        });
        noiseHit(ctx, destination, {
            t,
            frequency: 420,
            q: 0.7,
            peak: 0.14,
            attack: 0.004,
            decay: 0.08,
        });
    } catch { /* audio is garnish */ }
};
