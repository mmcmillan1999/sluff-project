// frontend/src/components/lab/SpinWheel.js
// Standalone lab object: a plain octagonal prize wheel that spins in the
// screen plane like a Wheel of Fortune wheel. No game wiring, no art —
// eight flat wedges, a hub, and a flapper at the top. Grab anywhere on the
// wheel and throw it; it coasts with momentum and settles with a wedge
// squarely under the flapper.
//
// Deliberately 2D (a single rotate()) — the shelved 3D venue drum taught us
// the compositor resamples text under perspective transforms and reads
// blurry; a flat rotation stays crisp.
//
// Hardening carried over from the venue-wheel review:
//   - pointer capture engages only after a real drag starts
//   - one finger drives the wheel; extra touches are ignored
//   - motion state lives in a ref; render closures never go stale
//   - NaN from exotic pointer events can never reach the rotor

import React, { useState, useRef, useCallback, useEffect } from 'react';
import './SpinWheel.css';

export const WEDGE_COUNT = 8;
export const WEDGE_DEG = 360 / WEDGE_COUNT; // 45
// The flapper sits at the top of the wheel (screen angle -90°).
const FLAPPER_DEG = -90;
// Momentum decay per second (velocity *= e^(-FRICTION * dt)). Lower than the
// old venue drum: a fortune wheel should coast long enough to build suspense.
const FRICTION = 1.05;
// Below this angular speed (deg/s) the wheel glides onto the nearest wedge.
const SETTLE_SPEED = 30;
const MAX_SPEED = 3200;
// Angular movement below this counts as a tap/no-op, not a drag.
const DRAG_SLOP_DEG = 3;

const WEDGE_FILLS = ['#3d4451', '#5c6675'];
const RADIUS = 100;      // SVG user units
const LABEL_RADIUS = 66;

const normalizeDelta = (deg) => {
    // Wrap an angular difference into [-180, 180) so crossing the atan2 seam
    // never registers as a full lap.
    let d = deg % 360;
    if (d >= 180) d -= 360;
    if (d < -180) d += 360;
    return d;
};

// Octagon vertex at wedge boundary i (flat edge centered on each wedge).
const vertex = (i) => {
    const a = ((i * WEDGE_DEG) - WEDGE_DEG / 2) * (Math.PI / 180);
    return [RADIUS * Math.cos(a), RADIUS * Math.sin(a)];
};

const SpinWheel = () => {
    const [rotation, setRotation] = useState(0);
    const wheelRef = useRef(null);

    const motionRef = useRef({
        rotation: 0,
        velocity: 0,
        target: null,
        raf: null,
        lastT: null,
        dragging: false,
        wasDrag: false,
        captured: false,
        pointerId: null,
        lastPointerDeg: 0,
        totalTravelDeg: 0,
        samples: [],
    });

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

    const startLoop = useCallback(() => {
        const motion = motionRef.current;
        if (motion.raf !== null) return;

        const step = (t) => {
            motion.raf = null;
            if (motion.lastT === null) motion.lastT = t;
            const dt = Math.min(0.05, Math.max(0.001, (t - motion.lastT) / 1000));
            motion.lastT = t;

            if (motion.target === null) {
                motion.rotation += motion.velocity * dt;
                motion.velocity *= Math.exp(-FRICTION * dt);
                if (Math.abs(motion.velocity) < SETTLE_SPEED) {
                    // Glide onto the alignment that puts a wedge center
                    // squarely under the flapper. The flapper angle is itself
                    // a wedge multiple, so that's simply the nearest 45°.
                    motion.target = Math.round(motion.rotation / WEDGE_DEG) * WEDGE_DEG;
                }
                setRotation(motion.rotation);
            } else {
                const remaining = motion.target - motion.rotation;
                if (Math.abs(remaining) < 0.05) {
                    applyRotation(motion.target);
                    motion.velocity = 0;
                    motion.target = null;
                    motion.lastT = null;
                    return; // at rest
                }
                motion.rotation += remaining * Math.min(1, dt * 8);
                setRotation(motion.rotation);
            }
            motion.raf = requestAnimationFrame(step);
        };
        motion.raf = requestAnimationFrame(step);
    }, [applyRotation]);

    useEffect(() => stopLoop, [stopLoop]);

    // Screen-space angle of a pointer event around the wheel's center.
    const pointerDeg = (event) => {
        const rect = wheelRef.current.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        return Math.atan2(event.clientY - cy, event.clientX - cx) * (180 / Math.PI);
    };

    const handlePointerDown = (event) => {
        const motion = motionRef.current;
        if (motion.dragging) return; // one finger drives the wheel
        stopLoop();                  // grabbing arrests a spin
        motion.target = null;
        motion.velocity = 0;
        motion.dragging = true;
        motion.wasDrag = false;
        motion.captured = false;
        motion.pointerId = event.pointerId;
        motion.lastPointerDeg = pointerDeg(event);
        motion.totalTravelDeg = 0;
        motion.samples = [{ t: performance.now(), rotation: motion.rotation }];
    };

    const handlePointerMove = (event) => {
        const motion = motionRef.current;
        if (!motion.dragging || event.pointerId !== motion.pointerId) return;

        const deg = pointerDeg(event);
        const delta = normalizeDelta(deg - motion.lastPointerDeg);
        if (!Number.isFinite(delta)) return;
        motion.lastPointerDeg = deg;
        motion.totalTravelDeg += Math.abs(delta);
        if (!motion.wasDrag && motion.totalTravelDeg > DRAG_SLOP_DEG) {
            motion.wasDrag = true;
            if (!motion.captured) {
                motion.captured = true;
                try {
                    wheelRef.current?.setPointerCapture?.(event.pointerId);
                } catch { /* environments without pointer capture */ }
            }
        }

        applyRotation(motion.rotation + delta);

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
        if (!motion.wasDrag) {
            // A tap: snap back onto the grid in case of sub-slop wobble.
            const nearest = Math.round(motion.rotation / WEDGE_DEG) * WEDGE_DEG;
            if (motion.rotation !== nearest) applyRotation(nearest);
            return;
        }

        const now = performance.now();
        const oldest = motion.samples[0];
        const dtSec = (now - oldest.t) / 1000;
        const velocity = dtSec > 0.008 ? (motion.rotation - oldest.rotation) / dtSec : 0;
        motion.velocity = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, velocity));
        motion.target = null;
        startLoop();
    };

    // Which wedge is under the flapper right now.
    const winner = ((Math.round((FLAPPER_DEG - rotation) / WEDGE_DEG) % WEDGE_COUNT) + WEDGE_COUNT) % WEDGE_COUNT;
    const motion = motionRef.current;
    const atRest = motion.raf === null && !motion.dragging;

    const wedges = [];
    for (let k = 0; k < WEDGE_COUNT; k += 1) {
        const [x1, y1] = vertex(k);
        const [x2, y2] = vertex(k + 1);
        const labelAngle = k * WEDGE_DEG;
        const lx = LABEL_RADIUS * Math.cos(labelAngle * (Math.PI / 180));
        const ly = LABEL_RADIUS * Math.sin(labelAngle * (Math.PI / 180));
        wedges.push(
            <g key={k}>
                <path
                    d={`M 0 0 L ${x1} ${y1} L ${x2} ${y2} Z`}
                    fill={WEDGE_FILLS[k % 2]}
                    stroke="#20242c"
                    strokeWidth="1.2"
                />
                <text
                    x={lx}
                    y={ly}
                    transform={`rotate(${labelAngle + 90} ${lx} ${ly})`}
                    className="spin-wheel-label"
                    textAnchor="middle"
                    dominantBaseline="central"
                >
                    {k + 1}
                </text>
            </g>
        );
    }

    return (
        <div className="spin-wheel">
            <div className="spin-wheel-flapper" aria-hidden="true" />
            <div
                className="spin-wheel-disc"
                ref={wheelRef}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                data-winner={winner + 1}
                data-at-rest={atRest ? 'true' : 'false'}
            >
                <svg
                    viewBox="-104 -104 208 208"
                    className="spin-wheel-svg"
                    style={{ transform: `rotate(${rotation}deg)` }}
                >
                    {wedges}
                    <circle r="14" fill="#20242c" stroke="#8a93a5" strokeWidth="2" />
                </svg>
            </div>
            <p className="spin-wheel-readout">
                {atRest ? `Landed on ${winner + 1}` : `…${winner + 1}`}
            </p>
        </div>
    );
};

export default SpinWheel;
