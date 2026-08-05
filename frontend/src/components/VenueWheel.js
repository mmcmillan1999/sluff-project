// frontend/src/components/VenueWheel.js
// The lobby's Quick Play venue picker: a Price-is-Right style octagonal
// wheel seen edge-on. Eight rim faces carry the venue art (each venue on
// two opposite faces, so one half-pull passes the whole catalog); pull or
// flick the rim to spin with momentum, and it settles with a venue squarely
// front and center. A fixed PLAY panel below the wheel always shows the
// front venue's name, buy-in, and state.
//
// Two hard-won rules from the shelved 3D drum (branch venue-wheel-experiment):
//   1. Faces are flat planes and the front face rests at an identity
//      transform, so the art stays crisp — no perspective resampling.
//   2. The wheel NEVER buys in. Spinning and paying are different controls:
//      the wheel only selects, the static button below it plays. That
//      removes the entire accidental-buy-in class of bugs (tap-vs-drag
//      races, pointer-capture click retargeting, stale closures).
//
// Motion architecture (phone-tested): the faces hold STATIC transforms and
// only the rotor spins, written imperatively in the rAF/pointer hot path —
// zero React renders per frame. React state changes only when the front
// face changes or the wheel starts/stops moving. Driving all eight face
// transforms through per-frame renders shimmered badly on mobile GPUs.
//
// Interaction hardening carried over from the adversarial reviews:
//   pointer capture engages only after a real drag starts; one finger
//   drives the wheel; a mouse released off-scene is caught via buttons===0
//   (never applied to touch — some mobile browsers report 0 mid-contact);
//   a changed venue list resets during render, not a frame later.

import React, { useState, useRef, useEffect, useCallback } from 'react';
import './VenueWheel.css';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';

// Eight faces suits 1/2/4/8 venues exactly (each venue appears 8/n times,
// evenly spaced). Other counts still work — the CTA always matches the
// front face — but representation goes uneven, and venues beyond the first
// eight would never appear: revisit FACE_COUNT when the catalog grows.
export const FACE_COUNT = 8;
export const FACE_DEG = 360 / FACE_COUNT; // 45
// Momentum decay per second (v *= e^(-FRICTION * dt)).
const FRICTION = 1.05;
// Angular speed (deg/s) below which momentum hands off to the settle glide.
const SETTLE_SPEED = 30;
const MAX_SPEED = 3200;
// Pointer travel below this many px counts as a tap (ignored), not a drag.
const DRAG_SLOP_PX = 6;

const mod = (value, count) => ((value % count) + count) % count;

// Two pegs per face: the flapper voice clicks every 22.5°, so a full pull
// chatters like the Big Wheel and the dying spin taps out one peg at a time
// right where the tension is.
const PEG_DEG = FACE_DEG / 2;
// The flapper can only slap so fast; below this spacing extra crossings fold
// into one harder click instead of white noise.
const MIN_TICK_GAP_MS = 28;

const VenueWheel = ({
    themes = [],
    userTokens = 0,
    pendingThemeId = null,
    onPlay,
    // Optional { tick(intensity), settle() } — the wheel is fully functional
    // silent, so tests and audio-less environments pass nothing.
    wheelAudio = null,
}) => {
    // React state is deliberately coarse: which segment fronts the wheel,
    // and whether it is at rest. The continuous rotation lives in the ref
    // and is applied straight to the rotor's style.
    const [frontK, setFrontK] = useState(0);
    const [resting, setResting] = useState(true);
    // Face height measured from the rendered face (11vh via CSS) — computing
    // from window.innerHeight would disagree with CSS vh on mobile.
    const [metrics, setMetrics] = useState({ apothem: 200, faceH: 84 });
    const prefersReducedMotion = usePrefersReducedMotion();
    const sceneRef = useRef(null);
    const rotorRef = useRef(null);

    const motionRef = useRef({
        spin: 0,
        velocity: 0,
        target: null,
        raf: null,
        lastT: null,
        dragging: false,
        wasDrag: false,
        captured: false,
        pointerId: null,
        lastY: 0,
        totalDy: 0,
        samples: [],
        apothem: 200,
        notifiedK: 0,
        lastPegIndex: 0,
        lastTickAt: 0,
        spunSinceRest: false,
    });

    // The audio hooks ride a ref so the imperative hot path never needs to
    // rebuild its callbacks when the parent re-renders.
    const wheelAudioRef = useRef(wheelAudio);
    wheelAudioRef.current = wheelAudio;

    // Re-measure when the wheel first gains faces: on a fresh login the
    // themes arrive after mount, and locking the innerHeight fallback in
    // would reinstate the vh-vs-visible-viewport mismatch on mobile.
    const hasThemes = themes.length > 0;
    useEffect(() => {
        const measure = () => {
            const face = sceneRef.current?.querySelector('.venue-wheel-face');
            const faceH = face?.offsetHeight || window.innerHeight * 0.11;
            const apothem = (faceH / 2) / Math.tan(Math.PI / FACE_COUNT);
            motionRef.current.apothem = apothem;
            setMetrics({ apothem, faceH });
        };
        measure();
        window.addEventListener('resize', measure);
        return () => window.removeEventListener('resize', measure);
    }, [hasThemes]);

    // touch-action: none SHOULD reserve every gesture that starts on the
    // wheel, but iOS tracks touch-action per compositor layer and drops the
    // region while the layer is animating — a finger landing on a SPINNING
    // wheel could still scroll the page. Swallowing the raw touch events
    // with non-passive listeners is the house-proven backstop (PlayerHand
    // does the same for card drags). Pointer events are unaffected.
    useEffect(() => {
        const scene = sceneRef.current;
        if (!scene) return undefined;
        const swallow = (event) => event.preventDefault();
        scene.addEventListener('touchstart', swallow, { passive: false });
        scene.addEventListener('touchmove', swallow, { passive: false });
        return () => {
            scene.removeEventListener('touchstart', swallow);
            scene.removeEventListener('touchmove', swallow);
        };
    }, [hasThemes]);

    // Hot path: write the rotor transform directly; touch React state only
    // when the front segment actually changes.
    const applySpin = useCallback((value) => {
        const motion = motionRef.current;
        motion.spin = value;
        if (rotorRef.current) {
            rotorRef.current.style.transform =
                `translateZ(${-motion.apothem}px) rotateX(${value}deg)`;
        }
        // Peg crossings drive the flapper: the click track IS the rotation,
        // so it slows and lands exactly with the wheel.
        const pegIndex = Math.floor(value / PEG_DEG);
        if (pegIndex !== motion.lastPegIndex) {
            const crossed = Math.abs(pegIndex - motion.lastPegIndex);
            motion.lastPegIndex = pegIndex;
            const audio = wheelAudioRef.current;
            if (audio?.tick) {
                const now = performance.now();
                if (now - motion.lastTickAt >= MIN_TICK_GAP_MS) {
                    motion.lastTickAt = now;
                    audio.tick(Math.min(1, 0.35 + crossed * 0.25));
                }
            }
        }
        const k = Math.round(value / FACE_DEG);
        if (k !== motion.notifiedK) {
            motion.notifiedK = k;
            setFrontK(k);
        }
    }, []);

    const stopLoop = useCallback(() => {
        const motion = motionRef.current;
        if (motion.raf !== null) {
            cancelAnimationFrame(motion.raf);
            motion.raf = null;
        }
        motion.lastT = null;
    }, []);

    const startLoop = useCallback(() => {
        const motion = motionRef.current;
        if (motion.raf !== null) return;

        const step = (t) => {
            motion.raf = null;
            if (motion.lastT === null) motion.lastT = t;
            const dt = Math.min(0.05, Math.max(0.001, (t - motion.lastT) / 1000));
            motion.lastT = t;

            if (motion.target === null) {
                applySpin(motion.spin + motion.velocity * dt);
                motion.velocity *= Math.exp(-FRICTION * dt);
                if (Math.abs(motion.velocity) < SETTLE_SPEED) {
                    motion.target = Math.round(motion.spin / FACE_DEG) * FACE_DEG;
                }
            } else {
                const remaining = motion.target - motion.spin;
                // 0.4° is sub-pixel at this radius: end the glide (and free
                // the CTA) the moment the wheel LOOKS settled, not frames
                // later when the exponential tail crosses an invisible line.
                if (Math.abs(remaining) < 0.4) {
                    applySpin(motion.target);
                    motion.velocity = 0;
                    motion.target = null;
                    motion.lastT = null;
                    setResting(true);
                    // The settle clunk — only after real motion, never on
                    // the sub-slop snap of an ignored tap.
                    if (motion.spunSinceRest) {
                        motion.spunSinceRest = false;
                        wheelAudioRef.current?.settle?.();
                    }
                    return; // at rest
                }
                applySpin(motion.spin + remaining * Math.min(1, dt * 8));
            }
            motion.raf = requestAnimationFrame(step);
        };
        motion.raf = requestAnimationFrame(step);
    }, [applySpin]);

    useEffect(() => stopLoop, [stopLoop]);

    // A changed venue list changes the face mapping: reset to the top
    // rather than silently swapping what's up front. Done DURING render
    // (React's state-adjustment pattern), so not even one committed frame
    // maps the old rotation onto the new catalog with the CTA armed.
    const themesSignature = themes.map(theme => theme.id).join('|');
    const [appliedSignature, setAppliedSignature] = useState(themesSignature);
    if (appliedSignature !== themesSignature) {
        setAppliedSignature(themesSignature);
        const motion = motionRef.current;
        if (motion.raf !== null) cancelAnimationFrame(motion.raf);
        motion.raf = null;
        motion.lastT = null;
        motion.target = null;
        motion.velocity = 0;
        motion.spin = 0;
        motion.notifiedK = 0;
        // Abandon any in-flight drag too — its samples and pointer latch
        // describe a wheel that no longer exists.
        motion.dragging = false;
        motion.wasDrag = false;
        motion.captured = false;
        motion.pointerId = null;
        motion.samples = [];
        motion.totalDy = 0;
        motion.lastPegIndex = 0;
        motion.spunSinceRest = false;
        setFrontK(0);
        setResting(true);
    }

    const settleTo = useCallback((targetDeg) => {
        const motion = motionRef.current;
        motion.velocity = 0;
        if (prefersReducedMotion) {
            stopLoop();
            motion.target = null;
            applySpin(targetDeg);
            setResting(true);
            return;
        }
        motion.target = targetDeg;
        motion.spunSinceRest = true;
        setResting(false);
        startLoop();
    }, [prefersReducedMotion, applySpin, startLoop, stopLoop]);

    const handlePointerDown = (event) => {
        if (!themes.length) return;
        const motion = motionRef.current;
        if (motion.dragging) return; // one hand on the wheel
        stopLoop();                  // grabbing arrests a spin
        motion.target = null;
        motion.velocity = 0;
        motion.dragging = true;
        motion.wasDrag = false;
        motion.captured = false;
        motion.pointerId = event.pointerId;
        motion.lastY = event.clientY;
        motion.totalDy = 0;
        motion.samples = [{ t: performance.now(), spin: motion.spin }];
        setResting(false);
        // Capture engages only once a real drag starts: capturing on
        // pointerdown would retarget the follow-up click in real browsers.
    };

    const handlePointerUp = (event) => {
        const motion = motionRef.current;
        if (!motion.dragging || event.pointerId !== motion.pointerId) return;
        motion.dragging = false;
        if (!motion.wasDrag) {
            // A tap on the wheel is a no-op (playing lives on the button
            // below); just make sure sub-slop wobble leaves us on-grid.
            const nearest = Math.round(motion.spin / FACE_DEG) * FACE_DEG;
            if (motion.spin !== nearest) applySpin(nearest);
            setResting(true);
            return;
        }

        if (prefersReducedMotion) {
            settleTo(Math.round(motion.spin / FACE_DEG) * FACE_DEG);
            return;
        }

        const now = performance.now();
        const oldest = motion.samples[0];
        const dtSec = (now - oldest.t) / 1000;
        const velocity = dtSec > 0.008 ? (motion.spin - oldest.spin) / dtSec : 0;
        motion.velocity = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, velocity));
        motion.target = null;
        motion.spunSinceRest = true;
        startLoop();
    };

    const handlePointerMove = (event) => {
        const motion = motionRef.current;
        if (!motion.dragging || event.pointerId !== motion.pointerId) return;
        if (event.buttons === 0 && event.pointerType !== 'touch') {
            // Mouse/pen released outside the scene before the drag crossed
            // the capture slop: this hover move is the pointerup we never
            // got. NEVER applied to touch — several mobile browsers report
            // buttons 0 mid-contact, which would kill every touch drag.
            handlePointerUp(event);
            return;
        }
        const dy = event.clientY - motion.lastY;
        if (!Number.isFinite(dy)) return; // never let NaN reach the rotor
        motion.lastY = event.clientY;
        motion.totalDy += Math.abs(dy);
        if (!motion.wasDrag && motion.totalDy > DRAG_SLOP_PX) {
            motion.wasDrag = true;
            if (!motion.captured) {
                motion.captured = true;
                try {
                    sceneRef.current?.setPointerCapture?.(event.pointerId);
                } catch { /* environments without pointer capture */ }
            }
        }

        // Surface travel on the rim: pulling down rolls the upper face
        // toward you, like pulling the big wheel.
        const degPerPx = 180 / (Math.PI * motion.apothem);
        applySpin(motion.spin - dy * degPerPx);

        const now = performance.now();
        motion.samples.push({ t: now, spin: motion.spin });
        while (motion.samples.length > 2 && now - motion.samples[0].t > 100) {
            motion.samples.shift();
        }
    };

    const handleKeyDown = (event) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        const centerK = Math.round(motionRef.current.spin / FACE_DEG);
        settleTo((centerK + step) * FACE_DEG);
    };

    if (!themes.length) {
        return <p className="loading-text">Loading tables...</p>;
    }

    const frontIndex = mod(frontK, FACE_COUNT);
    const frontTheme = themes[frontIndex % themes.length];
    const canAfford = parseFloat(userTokens) >= frontTheme.cost;
    const isPending = pendingThemeId === frontTheme.id;
    const playable = resting && canAfford && !isPending;

    const faces = [];
    for (let i = 0; i < FACE_COUNT; i += 1) {
        // Faces are STATIC: face i lives permanently at -i·45° on the drum
        // and the rotor's single rotateX carries the spin. Each venue rides
        // two opposite faces.
        const theme = themes[i % themes.length];
        faces.push(
            <div
                key={i}
                className={`venue-wheel-face${resting && i === frontIndex ? ' is-front' : ''}`}
                data-theme={theme.id}
                style={{
                    marginTop: `${-metrics.faceH / 2}px`,
                    transform: `rotateX(${-i * FACE_DEG}deg) translateZ(${metrics.apothem}px)`,
                }}
            />
        );
    }

    return (
        <div
            className="venue-wheel"
            role="group"
            aria-label="Choose a venue — swipe the wheel or use arrow keys"
            onKeyDown={handleKeyDown}
        >
            <div
                className="venue-wheel-scene"
                ref={sceneRef}
                tabIndex={0}
                // Slider semantics: a discrete venue selector operated with
                // the arrow keys; valuetext narrates the front venue.
                role="slider"
                aria-orientation="vertical"
                aria-label="Venue wheel"
                aria-valuemin={0}
                aria-valuemax={themes.length - 1}
                aria-valuenow={frontIndex % themes.length}
                aria-valuetext={`${frontTheme.name}, ${frontTheme.cost} token buy-in`}
                style={{ height: `${metrics.apothem * 2}px` }}
                data-front-theme={frontTheme.id}
                data-at-rest={resting ? 'true' : 'false'}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
            >
                <div
                    className="venue-wheel-rotor"
                    ref={rotorRef}
                    style={{
                        transform: `translateZ(${-metrics.apothem}px) rotateX(${motionRef.current.spin}deg)`,
                    }}
                >
                    {faces}
                </div>
            </div>
            {/* The fixed CTA: the wheel selects, this button plays. It is a
                real button with a real disabled state — nothing here ever
                needs to survive a drag gesture. */}
            <button
                type="button"
                className={`venue-wheel-cta${isPending ? ' is-pending' : ''}`}
                data-theme={frontTheme.id}
                aria-label={`${frontTheme.name}, ${frontTheme.cost} token buy-in. ${isPending ? 'Seating you' : canAfford ? 'Play now' : 'Need tokens'}.`}
                disabled={!playable}
                onClick={() => {
                    if (!playable) return;
                    onPlay(frontTheme.id);
                }}
            >
                <span className="venue-wheel-cta-name">{frontTheme.name}</span>
                <span className="venue-wheel-cta-cost">
                    <img src="/Sluff_Token_v2.webp" alt="" className="tab-token-icon" /> {frontTheme.cost}
                </span>
                <span className="venue-wheel-cta-action">
                    {isPending ? 'SEATING YOU…' : canAfford ? 'PLAY NOW ▶' : 'NEED TOKENS'}
                </span>
            </button>
            <span className="venue-wheel-live" aria-live="polite">
                {resting ? `${frontTheme.name}, ${frontTheme.cost} token buy-in, is up front` : ''}
            </span>
        </div>
    );
};

export default VenueWheel;
