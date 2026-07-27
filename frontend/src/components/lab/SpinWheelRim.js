// frontend/src/components/lab/SpinWheelRim.js
// The lab octagon rotated 90° about the Y axis: you now face its RIM, like
// a contestant at the Price-is-Right big wheel. The octagon becomes a
// prism — eight flat rim faces carry the numbers, the axle is horizontal,
// and you pull the rim down (or up) to spin it. Same fidget-spinner
// momentum as the flat wheel.
//
// At exactly 90° the octagonal side plates are edge-on and invisible, so
// only the rim faces render. The rotor is pulled back by one apothem so
// the front face sits on the screen plane at natural size (the venue-drum
// lesson: that keeps the resting number crisp).

import React, { useState, useRef, useCallback, useEffect } from 'react';
import './SpinWheelRim.css';

export const FACE_COUNT = 8;
export const FACE_DEG = 360 / FACE_COUNT; // 45
const FRICTION = 1.05;
const SETTLE_SPEED = 30;
const MAX_SPEED = 3200;
const DRAG_SLOP_PX = 6;

// The four venues, each on two opposite faces of the octagon (i and i+4).
// The art is authored at 1600x400 (4:1), which is also the face's aspect,
// so each panel shows essentially frame-perfect.
const VENUES = [
    { id: 'miss-pauls-academy', name: 'Academy' },
    { id: 'fort-creek', name: 'Fort Creek' },
    { id: 'shirecliff-road', name: 'Shirecliff' },
    { id: 'dans-deck', name: 'Eaglewood' },
];

const mod = (value, count) => ((value % count) + count) % count;

const SpinWheelRim = () => {
    const [spin, setSpin] = useState(0);
    const [metrics, setMetrics] = useState({ apothem: 220, faceH: 180 });
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
        apothem: 220,
    });

    // Octagon geometry from the face height: faces are lobby-panel height
    // (11vh) at the art's native 4:1 aspect, and the wheel's radius follows.
    useEffect(() => {
        const measure = () => {
            const faceH = window.innerHeight * 0.11;
            const apothem = (faceH / 2) / Math.tan(Math.PI / FACE_COUNT);
            motionRef.current.apothem = apothem;
            setMetrics({ apothem, faceH });
        };
        measure();
        window.addEventListener('resize', measure);
        return () => window.removeEventListener('resize', measure);
    }, []);

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
                if (Math.abs(remaining) < 0.05) {
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

    const handlePointerDown = (event) => {
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
    };

    const handlePointerMove = (event) => {
        const motion = motionRef.current;
        if (!motion.dragging || event.pointerId !== motion.pointerId) return;
        const dy = event.clientY - motion.lastY;
        if (!Number.isFinite(dy)) return;
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
        // toward you, exactly like pulling the big wheel.
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
            const nearest = Math.round(motion.spin / FACE_DEG) * FACE_DEG;
            if (motion.spin !== nearest) applySpin(nearest);
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

    const motion = motionRef.current;
    const atRest = motion.raf === null && !motion.dragging;
    const frontIndex = mod(Math.round(spin / FACE_DEG), FACE_COUNT);

    const frontVenue = VENUES[mod(frontIndex, VENUES.length)];

    const faces = [];
    for (let i = 0; i < FACE_COUNT; i += 1) {
        // Same slot math as the venue drum: angle 0 faces the viewer,
        // negative angles sit above and roll down when the rim is pulled.
        const angle = i * FACE_DEG - spin;
        const venue = VENUES[i % VENUES.length];
        faces.push(
            <div
                key={i}
                className={
                    `rim-face rim-face-${venue.id}`
                    + `${mod(Math.round(angle), 360) === 0 ? ' is-front' : ''}`
                }
                style={{
                    height: `${metrics.faceH}px`,
                    marginTop: `${-metrics.faceH / 2}px`,
                    transform: `rotateX(${-angle}deg) translateZ(${metrics.apothem}px)`,
                }}
            />
        );
    }

    return (
        <div className="rim-wheel">
            <div className="rim-wheel-flapper" aria-hidden="true" />
            <div
                className="rim-wheel-scene"
                ref={sceneRef}
                style={{ height: `${metrics.apothem * 2}px` }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                data-front={frontIndex + 1}
                data-at-rest={atRest ? 'true' : 'false'}
            >
                <div
                    className="rim-wheel-rotor"
                    style={{ transform: `translateZ(${-metrics.apothem}px)` }}
                >
                    {faces}
                </div>
            </div>
            <p className="rim-wheel-readout">
                {atRest ? `Landed on ${frontVenue.name}` : `…${frontVenue.name}`}
            </p>
        </div>
    );
};

export default SpinWheelRim;
