// frontend/src/components/VenueWheel.js
// The lobby's Quick Play venue picker as a Price-is-Right drum: the front
// card is the active choice, its neighbors curve away above and below, and
// pulling the wheel spins it with fidget-spinner momentum. The venue list
// repeats around the drum, so today's few venues loop quickly; as more
// wheels/venues arrive the same drum just gets richer.
//
// Interaction contract:
//   tap the front card    -> quick play that venue
//   tap a neighbor        -> spin it to the front (never an accidental buy-in)
//   drag / flick anywhere -> spin with momentum, then settle on a card
//   ArrowUp / ArrowDown   -> step one card
//   reduced motion        -> steps and settles are instant, no momentum

import React, { useState, useRef, useEffect, useCallback } from 'react';
import './VenueWheel.css';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';

// Degrees between adjacent cards on the drum. The ribbon is virtual (only
// ±VISIBLE_RANGE segments render), so this needn't divide 360 evenly.
export const SEGMENT_DEG = 32;
// Segments rendered either side of the front card.
const VISIBLE_RANGE = 3;
// Angular speed (deg/s) below which momentum hands off to the settle spring.
const SETTLE_SPEED = 80;
// Momentum decay per second (v *= e^(-FRICTION * dt)).
const FRICTION = 1.6;
// Hard ceiling so a violent flick stays readable (deg/s).
const MAX_SPEED = 2400;
// Pointer movement below this many px within the window counts as a tap.
const TAP_SLOP_PX = 7;
const TAP_MS = 350;

const mod = (value, count) => ((value % count) + count) % count;

const VenueWheel = ({
    themes = [],
    userTokens = 0,
    pendingThemeId = null,
    onPlay,
}) => {
    const [rotation, setRotation] = useState(0);
    const [radiusPx, setRadiusPx] = useState(260);
    const prefersReducedMotion = usePrefersReducedMotion();
    const viewportRef = useRef(null);
    const rootRef = useRef(null);
    // After a keyboard step, focus follows the new front card once the wheel
    // rests — otherwise the focused slot recycles out of the DOM and arrow
    // keys go dead.
    const focusFrontOnRestRef = useRef(false);

    // All motion bookkeeping lives in one ref so pointer handlers and the
    // rAF loop never fight React's render cycle over stale values.
    const motionRef = useRef({
        rotation: 0,
        velocity: 0,
        target: null,        // settle destination (deg) once momentum fades
        raf: null,
        lastT: null,
        dragging: false,
        wasDrag: false,      // suppresses the click that follows a real drag
        wasSpinning: false,  // this pointerdown arrested a coasting wheel
        captured: false,     // pointer capture engages only once a drag is real
        pointerId: null,
        lastY: 0,
        totalDy: 0,
        downAt: 0,
        samples: [],         // recent {t, rotation} for release velocity
        radiusPx: 260,
    });

    // Radius from the real rendered card height so drag distance matches
    // surface travel. Measured from the slot's untransformed offsetHeight —
    // computing from window.innerHeight would disagree with CSS vh on mobile
    // (vh is the large viewport; innerHeight tracks the URL bar).
    useEffect(() => {
        const measure = () => {
            const slot = viewportRef.current?.querySelector('.venue-wheel-slot');
            const cardHeight = slot?.offsetHeight || window.innerHeight * 0.11;
            const measured =
                (cardHeight / 2) / Math.tan((SEGMENT_DEG / 2) * (Math.PI / 180));
            motionRef.current.radiusPx = measured;
            setRadiusPx(measured);
        };
        measure();
        window.addEventListener('resize', measure);
        return () => window.removeEventListener('resize', measure);
    }, []);

    // If the venue list itself changes shape (a new wheel of venues arrives
    // from the server), the angle-to-venue mapping changes with it — reset to
    // the top rather than silently swapping what's up front.
    const themesSignature = themes.map(theme => theme.id).join('|');
    useEffect(() => {
        const motion = motionRef.current;
        if (motion.raf !== null) cancelAnimationFrame(motion.raf);
        motion.raf = null;
        motion.lastT = null;
        motion.target = null;
        motion.velocity = 0;
        motion.rotation = 0;
        setRotation(0);
    }, [themesSignature]);

    const applyRotation = useCallback((value) => {
        motionRef.current.rotation = value;
        setRotation(value);
    }, []);

    const stopLoop = useCallback(() => {
        const motion = motionRef.current;
        if (motion.raf !== null) {
            cancelAnimationFrame(motion.raf);
            motion.raf = null;
        }
        motion.lastT = null;
    }, []);

    // One shared loop covers both momentum and the settle spring.
    const startLoop = useCallback(() => {
        const motion = motionRef.current;
        if (motion.raf !== null) return;

        const step = (t) => {
            motion.raf = null;
            if (motion.lastT === null) motion.lastT = t;
            const dt = Math.min(0.05, Math.max(0.001, (t - motion.lastT) / 1000));
            motion.lastT = t;

            if (motion.target === null) {
                // Momentum: coast and decay until slow enough to settle.
                motion.rotation += motion.velocity * dt;
                motion.velocity *= Math.exp(-FRICTION * dt);
                if (Math.abs(motion.velocity) < SETTLE_SPEED) {
                    motion.target = Math.round(motion.rotation / SEGMENT_DEG) * SEGMENT_DEG;
                }
                setRotation(motion.rotation);
            } else {
                // Settle: exponential approach onto the nearest card.
                const remaining = motion.target - motion.rotation;
                if (Math.abs(remaining) < 0.05) {
                    applyRotation(motion.target);
                    motion.velocity = 0;
                    motion.target = null;
                    motion.lastT = null;
                    return; // at rest — loop ends
                }
                motion.rotation += remaining * Math.min(1, dt * 12);
                setRotation(motion.rotation);
            }
            motion.raf = requestAnimationFrame(step);
        };
        motion.raf = requestAnimationFrame(step);
    }, [applyRotation]);

    useEffect(() => stopLoop, [stopLoop]); // never leave a loop running on unmount

    const settleTo = useCallback((targetDeg) => {
        const motion = motionRef.current;
        motion.velocity = 0;
        if (prefersReducedMotion) {
            stopLoop();
            motion.target = null;
            applyRotation(targetDeg);
            return;
        }
        motion.target = targetDeg;
        startLoop();
    }, [prefersReducedMotion, applyRotation, startLoop, stopLoop]);

    const handlePointerDown = (event) => {
        if (!themes.length) return;
        const motion = motionRef.current;
        if (motion.dragging) return; // one finger drives the wheel; ignore extras
        motion.wasSpinning = motion.raf !== null;
        stopLoop();               // grabbing a spinning wheel arrests it
        motion.target = null;
        motion.velocity = 0;
        motion.dragging = true;
        motion.wasDrag = false;
        motion.captured = false;
        motion.pointerId = event.pointerId;
        motion.lastY = event.clientY;
        motion.totalDy = 0;
        motion.downAt = performance.now();
        motion.samples = [{ t: motion.downAt, rotation: motion.rotation }];
        // Deliberately NOT capturing the pointer yet: while captured, browsers
        // retarget the follow-up click to the viewport, which would kill the
        // card's own PLAY NOW click. Capture engages once a real drag starts.
    };

    const handlePointerMove = (event) => {
        const motion = motionRef.current;
        if (!motion.dragging || event.pointerId !== motion.pointerId) return;
        const dy = event.clientY - motion.lastY;
        if (!Number.isFinite(dy)) return; // defensive: never let NaN reach the drum
        motion.lastY = event.clientY;
        motion.totalDy += Math.abs(dy);
        if (!motion.wasDrag && motion.totalDy > TAP_SLOP_PX) {
            motion.wasDrag = true;
            // A real drag: now the wheel owns this pointer until release.
            if (!motion.captured) {
                motion.captured = true;
                try {
                    viewportRef.current?.setPointerCapture?.(event.pointerId);
                } catch { /* jsdom and some webviews lack pointer capture */ }
            }
        }

        // Surface travel: pulling down brings the card above down to front.
        const degPerPx = 180 / (Math.PI * motion.radiusPx);
        applyRotation(motion.rotation - dy * degPerPx);

        const now = performance.now();
        motion.samples.push({ t: now, rotation: motion.rotation });
        while (motion.samples.length > 2 && now - motion.samples[0].t > 100) {
            motion.samples.shift();
        }
    };

    const handlePointerUp = (event) => {
        const motion = motionRef.current;
        if (!motion.dragging || event.pointerId !== motion.pointerId) return;
        motion.dragging = false;

        const now = performance.now();
        const isTap = !motion.wasDrag && (now - motion.downAt) < TAP_MS;
        if (isTap) {
            const nearest = Math.round(motion.rotation / SEGMENT_DEG) * SEGMENT_DEG;
            if (motion.wasSpinning) {
                // The tap's job was arresting the spin — glide onto the
                // nearest card and make sure the trailing click can't buy in.
                motion.wasDrag = true;
                settleTo(nearest);
            } else if (motion.rotation !== nearest) {
                // Finger wobble under the slop left us fractionally off-grid;
                // snap back invisibly so the click lands on a resting wheel.
                applyRotation(nearest);
            }
            return; // let the card's own click handler decide
        }

        if (prefersReducedMotion) {
            settleTo(Math.round(motion.rotation / SEGMENT_DEG) * SEGMENT_DEG);
            return;
        }

        // Release velocity from the last ~100ms of travel.
        const oldest = motion.samples[0];
        const dtSec = (now - oldest.t) / 1000;
        const velocity = dtSec > 0.008 ? (motion.rotation - oldest.rotation) / dtSec : 0;
        motion.velocity = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, velocity));

        if (Math.abs(motion.velocity) < SETTLE_SPEED) {
            settleTo(Math.round(motion.rotation / SEGMENT_DEG) * SEGMENT_DEG);
        } else {
            motion.target = null;
            startLoop();
        }
    };

    const handleKeyDown = (event) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        const centerK = Math.round(motionRef.current.rotation / SEGMENT_DEG);
        focusFrontOnRestRef.current = true;
        settleTo((centerK + step) * SEGMENT_DEG);
    };

    // Hand keyboard focus to the new front card once a stepped wheel rests;
    // without this the focused slot recycles out of the DOM after a few
    // steps and arrow keys stop reaching the wheel.
    useEffect(() => {
        const motion = motionRef.current;
        if (!focusFrontOnRestRef.current) return;
        if (motion.raf !== null || motion.dragging) return;
        focusFrontOnRestRef.current = false;
        rootRef.current?.querySelector('.venue-wheel-slot.is-front .qp-card')?.focus();
    }, [rotation]);

    if (!themes.length) {
        return <p className="loading-text">Loading tables...</p>;
    }

    const count = themes.length;
    const motion = motionRef.current;
    const centerK = Math.round(rotation / SEGMENT_DEG);
    const centeredTheme = themes[mod(centerK, count)];
    const atRest = motion.raf === null && !motion.dragging;

    const slots = [];
    for (let k = centerK - VISIBLE_RANGE; k <= centerK + VISIBLE_RANGE; k += 1) {
        const theme = themes[mod(k, count)];
        const angle = k * SEGMENT_DEG - rotation;
        const isFront = k === centerK;
        const canAfford = parseFloat(userTokens) >= theme.cost;
        const isPending = pendingThemeId === theme.id;
        const actionLabel = isPending
            ? 'Seating you'
            : (canAfford ? 'Play now' : 'Need tokens');

        slots.push(
            <div
                key={k}
                className={`venue-wheel-slot${isFront ? ' is-front' : ''}`}
                style={{
                    transform: `rotateX(${-angle}deg) translateZ(${radiusPx}px)`,
                    opacity: Math.max(0, Math.cos(angle * (Math.PI / 180))),
                    zIndex: 100 - Math.round(Math.abs(angle)),
                }}
            >
                <button
                    type="button"
                    // aria-disabled (not disabled): a disabled button would
                    // swallow the pointer events the wheel drags with.
                    aria-disabled={isFront ? (!canAfford || isPending) : undefined}
                    tabIndex={isFront ? 0 : -1}
                    className={
                        `qp-card qp-${theme.id}`
                        + `${canAfford ? '' : ' qp-disabled'}`
                        + `${isPending ? ' qp-pending' : ''}`
                    }
                    data-theme={theme.id}
                    aria-label={isFront
                        ? `${theme.name}, ${theme.cost} token buy-in. ${actionLabel}.`
                        : `Spin ${theme.name} to the front`}
                    onClick={(event) => {
                        if (motion.wasDrag) {
                            motion.wasDrag = false;      // suppression is one-shot
                            // Keyboard/AT activations have detail 0 and never
                            // follow a drag release — let them through.
                            if (event.detail !== 0) return;
                        }
                        if (!isFront) {
                            settleTo(k * SEGMENT_DEG);
                            return;
                        }
                        // Live reads (not render-time): a wobbly tap renders
                        // mid-drag and would otherwise bake in a stale "moving"
                        // verdict that swallows every later PLAY NOW tap.
                        if (!canAfford || isPending || motion.raf !== null || motion.dragging) return;
                        onPlay(theme.id);
                    }}
                >
                    <span className="qp-card-copy">
                        <span className="qp-card-name">{theme.name}</span>
                        <span className="qp-card-cost">
                            <img src="/Sluff_Token_v2.webp" alt="" className="tab-token-icon" /> {theme.cost}
                        </span>
                    </span>
                    <span className="qp-play-pill">
                        {isPending ? 'SEATING YOU…' : canAfford ? 'PLAY NOW ▶' : 'NEED TOKENS'}
                    </span>
                </button>
            </div>
        );
    }

    return (
        <div
            className="venue-wheel"
            ref={rootRef}
            role="group"
            aria-label="Choose a venue — swipe or use arrow keys to spin"
            onKeyDown={handleKeyDown}
        >
            <div
                className="venue-wheel-viewport"
                ref={viewportRef}
                data-centered-theme={centeredTheme.id}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
            >
                {/* Pulled back one radius so the front card sits exactly on
                    the screen plane at its natural size. */}
                <div
                    className="venue-wheel-drum"
                    style={{ transform: `translateZ(${-radiusPx}px)` }}
                >
                    {slots}
                </div>
                <div className="venue-wheel-shade venue-wheel-shade-top" aria-hidden="true" />
                <div className="venue-wheel-shade venue-wheel-shade-bottom" aria-hidden="true" />
            </div>
            {/* Announce only once settled — announcing every venue crossed
                during a spin would spam screen readers. */}
            <span className="venue-wheel-live" aria-live="polite">
                {atRest ? `${centeredTheme.name} is up front` : ''}
            </span>
        </div>
    );
};

export default VenueWheel;
