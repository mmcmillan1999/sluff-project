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
// Interaction hardening carried over from the experiment's review:
//   pointer capture engages only after a real drag starts; one finger
//   drives the wheel; motion state lives in a ref; a changed venue list
//   resets the wheel instead of silently swapping the front face.

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

const VenueWheel = ({
    themes = [],
    userTokens = 0,
    pendingThemeId = null,
    onPlay,
}) => {
    const [spin, setSpin] = useState(0);
    // Face height measured from the rendered face (11vh via CSS) — computing
    // from window.innerHeight would disagree with CSS vh on mobile.
    const [metrics, setMetrics] = useState({ apothem: 200, faceH: 84 });
    const prefersReducedMotion = usePrefersReducedMotion();
    const sceneRef = useRef(null);

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
    });

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

    const applySpin = useCallback((value) => {
        motionRef.current.spin = value;
        setSpin(value);
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
                motion.spin += motion.velocity * dt;
                motion.velocity *= Math.exp(-FRICTION * dt);
                if (Math.abs(motion.velocity) < SETTLE_SPEED) {
                    motion.target = Math.round(motion.spin / FACE_DEG) * FACE_DEG;
                }
                setSpin(motion.spin);
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
                    return; // at rest
                }
                motion.spin += remaining * Math.min(1, dt * 8);
                setSpin(motion.spin);
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
        // Abandon any in-flight drag too — its samples and pointer latch
        // describe a wheel that no longer exists.
        motion.dragging = false;
        motion.wasDrag = false;
        motion.captured = false;
        motion.pointerId = null;
        motion.samples = [];
        motion.totalDy = 0;
        setSpin(0);
    }

    const settleTo = useCallback((targetDeg) => {
        const motion = motionRef.current;
        motion.velocity = 0;
        if (prefersReducedMotion) {
            stopLoop();
            motion.target = null;
            applySpin(targetDeg);
            return;
        }
        motion.target = targetDeg;
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
        // Capture engages only once a real drag starts: capturing on
        // pointerdown would retarget the follow-up click in real browsers.
    };

    const handlePointerMove = (event) => {
        const motion = motionRef.current;
        if (!motion.dragging || event.pointerId !== motion.pointerId) return;
        if (event.buttons === 0) {
            // Mouse released outside the scene before the drag crossed the
            // capture slop: this hover move is the pointerup we never got.
            // (Touch always reports buttons=1 while contacting, and gets
            // implicit capture anyway.)
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

    const handlePointerUp = (event) => {
        const motion = motionRef.current;
        if (!motion.dragging || event.pointerId !== motion.pointerId) return;
        motion.dragging = false;
        if (!motion.wasDrag) {
            // A tap on the wheel is a no-op (playing lives on the button
            // below); just make sure sub-slop wobble leaves us on-grid.
            const nearest = Math.round(motion.spin / FACE_DEG) * FACE_DEG;
            if (motion.spin !== nearest) applySpin(nearest);
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
        startLoop();
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

    const motion = motionRef.current;
    const atRest = motion.raf === null && !motion.dragging;
    const frontIndex = mod(Math.round(spin / FACE_DEG), FACE_COUNT);
    const frontTheme = themes[frontIndex % themes.length];
    const canAfford = parseFloat(userTokens) >= frontTheme.cost;
    const isPending = pendingThemeId === frontTheme.id;
    const playable = atRest && canAfford && !isPending;

    const faces = [];
    for (let i = 0; i < FACE_COUNT; i += 1) {
        // Angle 0 faces the viewer; negative angles sit above and roll down
        // when the rim is pulled. Each venue rides two opposite faces.
        const angle = i * FACE_DEG - spin;
        const theme = themes[i % themes.length];
        faces.push(
            <div
                key={i}
                className={`venue-wheel-face${mod(Math.round(angle), 360) === 0 ? ' is-front' : ''}`}
                data-theme={theme.id}
                style={{
                    marginTop: `${-metrics.faceH / 2}px`,
                    transform: `rotateX(${-angle}deg) translateZ(${metrics.apothem}px)`,
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
                data-at-rest={atRest ? 'true' : 'false'}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
            >
                <div
                    className="venue-wheel-rotor"
                    style={{ transform: `translateZ(${-metrics.apothem}px)` }}
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
                {atRest ? `${frontTheme.name}, ${frontTheme.cost} token buy-in, is up front` : ''}
            </span>
        </div>
    );
};

export default VenueWheel;
