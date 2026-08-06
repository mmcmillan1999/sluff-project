// frontend/src/components/game/MidnightSpecialBanner.js
//
// The Midnight Special, full production. The server proved a run is
// unstoppable; this is the table's answer:
//
//   - the horn sounds (useSounds fires the score on the same timeline)
//   - a steam train chugs onto the felt and runs the PERIMETER of the
//     table — engine and signed cars each following the same rounded-rect
//     path at trailing offsets, so the consist articulates around corners
//     like the real thing (rAF-driven, WidowSpider's school of motion)
//   - smoke puffs off the stack and drifts
//   - the chorus lines appear karaoke-style, and on "shine a light on me"
//     a spotlight veil drops with its beam on the runner's nameplate
//     (found via [data-seat-player]; falls back to center table)
//   - the train and sky fade as the last line rides out
//
// Pure presentation: pointer-events none, play continues underneath,
// reduced-motion gets the title, captions, and spotlight without the train.

import React, { useEffect, useRef, useState } from 'react';
import './MidnightSpecialBanner.css';
import { MIDNIGHT_TIMELINE } from '../../utils/soundSynth';

const SMOKE_EVERY_MS = 110;

const LYRICS = [
    { at: MIDNIGHT_TIMELINE.line1, text: '♪ Let the Midnight Special…' },
    { at: MIDNIGHT_TIMELINE.spotlight, text: '♪ …shine a light on me ♪' },
    { at: MIDNIGHT_TIMELINE.line2, text: '♪ Let the Midnight Special…' },
    { at: MIDNIGHT_TIMELINE.line3, text: '♪ …shine its ever-lovin’ light on me ♪' },
];

// Position (and heading) at parameter s ∈ [0,1) around a rounded rectangle.
const roundedRectPoint = (s, rect, radius) => {
    const w = rect.width - 2 * radius;
    const h = rect.height - 2 * radius;
    const arc = (Math.PI / 2) * radius;
    const perimeter = 2 * w + 2 * h + 4 * arc;
    let d = ((s % 1) + 1) % 1 * perimeter;

    const edges = [
        { len: w, point: (t) => ({ x: rect.x + radius + t, y: rect.y, angle: 0 }) },
        {
            len: arc,
            point: (t) => {
                const a = -Math.PI / 2 + (t / arc) * (Math.PI / 2);
                return {
                    x: rect.x + rect.width - radius + Math.cos(a) * radius,
                    y: rect.y + radius + Math.sin(a) * radius,
                    angle: (a + Math.PI / 2) * (180 / Math.PI),
                };
            },
        },
        { len: h, point: (t) => ({ x: rect.x + rect.width, y: rect.y + radius + t, angle: 90 }) },
        {
            len: arc,
            point: (t) => {
                const a = (t / arc) * (Math.PI / 2);
                return {
                    x: rect.x + rect.width - radius + Math.cos(a) * radius,
                    y: rect.y + rect.height - radius + Math.sin(a) * radius,
                    angle: 90 + (a) * (180 / Math.PI),
                };
            },
        },
        { len: w, point: (t) => ({ x: rect.x + rect.width - radius - t, y: rect.y + rect.height, angle: 180 }) },
        {
            len: arc,
            point: (t) => {
                const a = Math.PI / 2 + (t / arc) * (Math.PI / 2);
                return {
                    x: rect.x + radius + Math.cos(a) * radius,
                    y: rect.y + rect.height - radius + Math.sin(a) * radius,
                    angle: 180 + (a - Math.PI / 2) * (180 / Math.PI),
                };
            },
        },
        { len: h, point: (t) => ({ x: rect.x, y: rect.y + rect.height - radius - t, angle: 270 }) },
        {
            len: arc,
            point: (t) => {
                const a = Math.PI + (t / arc) * (Math.PI / 2);
                return {
                    x: rect.x + radius + Math.cos(a) * radius,
                    y: rect.y + radius + Math.sin(a) * radius,
                    angle: 270 + (a - Math.PI) * (180 / Math.PI),
                };
            },
        },
    ];
    for (const edge of edges) {
        if (d <= edge.len) return edge.point(d);
        d -= edge.len;
    }
    return edges[0].point(0);
};

// Top-view rolling stock: the loop is seen from above (a model railway on
// the felt), so every piece rotates cleanly at any heading and the roof
// signs counter-rotate to stay readable.
const TrainCar = ({ label, refFn }) => (
    <div className="midnight-train__car" ref={refFn}>
        <div className="midnight-train__car-roof">
            <span className="midnight-train__car-sign">{label}</span>
        </div>
    </div>
);

const MidnightSpecialBanner = ({ playerName }) => {
    const [phase, setPhase] = useState({ lyric: null, spotlight: false, fading: false });
    const engineRef = useRef(null);
    const carRefs = useRef([]);
    const smokeLayerRef = useRef(null);
    const spotRef = useRef({ x: null, y: null });

    // Phase cues (captions, spotlight, fade) run on plain timers so they
    // work identically with and without the animation loop.
    useEffect(() => {
        if (!playerName) return undefined;
        const timers = LYRICS.map(({ at, text }) => setTimeout(
            () => setPhase(prev => ({ ...prev, lyric: text })), at * 1000,
        ));
        timers.push(setTimeout(
            () => setPhase(prev => ({ ...prev, spotlight: true })),
            MIDNIGHT_TIMELINE.spotlight * 1000,
        ));
        timers.push(setTimeout(
            () => setPhase(prev => ({ ...prev, fading: true })),
            MIDNIGHT_TIMELINE.fade * 1000,
        ));

        // Aim the beam at the runner's nameplate.
        const seat = document.querySelector(`[data-seat-player="${CSS.escape(playerName)}"]`);
        const rect = seat?.getBoundingClientRect();
        spotRef.current = rect && rect.width > 0
            ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
            : { x: window.innerWidth / 2, y: window.innerHeight * 0.55 };

        return () => timers.forEach(clearTimeout);
    }, [playerName]);

    // The train itself: engine + cars along the table perimeter.
    useEffect(() => {
        if (!playerName) return undefined;
        if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return undefined;

        // The rail bed is the TABLE, not the viewport — the felt element's
        // bounds keep the loop off the header and out of the player's hand.
        const felt = document.querySelector('.game-table')?.getBoundingClientRect();
        const bounds = felt && felt.width > 0
            ? felt
            : { x: 0, y: window.innerHeight * 0.08, width: window.innerWidth, height: window.innerHeight * 0.72 };
        const inset = { x: bounds.width * 0.055, y: bounds.height * 0.075 };
        const rect = {
            x: bounds.x + inset.x,
            y: bounds.y + inset.y,
            width: bounds.width - inset.x * 2,
            height: bounds.height - inset.y * 2,
        };
        const radius = Math.min(rect.width, rect.height) * 0.16;
        // Couple the cars by PIXEL length, not perimeter fraction — a
        // laptop's huge loop must not stretch the consist apart.
        const perimeterPx = 2 * (rect.width - 2 * radius)
            + 2 * (rect.height - 2 * radius)
            + 2 * Math.PI * radius;
        const carSpacing = (window.innerHeight * 0.105) / perimeterPx;

        const startedAt = performance.now();
        let lastSmokeAt = 0;
        let raf = 0;

        const tick = (now) => {
            const elapsed = (now - startedAt) / 1000;
            const running = elapsed >= MIDNIGHT_TIMELINE.trainEnter;
            const total = MIDNIGHT_TIMELINE.total;
            if (elapsed >= total) return;

            if (running) {
                // ~1.7 laps between entering and the end of the fade.
                const runT = (elapsed - MIDNIGHT_TIMELINE.trainEnter)
                    / (total - MIDNIGHT_TIMELINE.trainEnter);
                const s = 0.02 + runT * 1.7;
                const fadeIn = Math.min(1, (elapsed - MIDNIGHT_TIMELINE.trainEnter) / 0.8);
                const fadeOut = elapsed > MIDNIGHT_TIMELINE.fade
                    ? Math.max(0, 1 - (elapsed - MIDNIGHT_TIMELINE.fade) / (total - MIDNIGHT_TIMELINE.fade))
                    : 1;
                const opacity = fadeIn * fadeOut;

                const place = (el, param) => {
                    if (!el) return null;
                    const p = roundedRectPoint(param, rect, radius);
                    el.style.opacity = String(opacity);
                    el.style.transform =
                        `translate3d(${p.x}px, ${p.y}px, 0) translate(-50%, -50%) rotate(${p.angle}deg)`;
                    // Roof signs stay painted ALONG the car (like real rolling
                    // stock) and only flip 180° when the heading would render
                    // them upside-down — never askew from the car's fit.
                    const heading = ((p.angle % 360) + 360) % 360;
                    el.style.setProperty(
                        '--sign-flip',
                        heading > 90 && heading <= 270 ? '180deg' : '0deg',
                    );
                    return p;
                };
                const enginePos = place(engineRef.current, s);
                carRefs.current.forEach((car, i) => place(car, s - carSpacing * (i + 1)));

                // Smoke off the stack.
                if (enginePos && now - lastSmokeAt > SMOKE_EVERY_MS && smokeLayerRef.current && fadeOut > 0.3) {
                    lastSmokeAt = now;
                    const puff = document.createElement('span');
                    puff.className = 'midnight-smoke';
                    puff.style.left = `${enginePos.x}px`;
                    puff.style.top = `${enginePos.y}px`;
                    smokeLayerRef.current.appendChild(puff);
                    puff.addEventListener('animationend', () => puff.remove());
                }
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => {
            cancelAnimationFrame(raf);
            if (smokeLayerRef.current) smokeLayerRef.current.innerHTML = '';
        };
    }, [playerName]);

    if (!playerName) return null;
    const spot = spotRef.current;

    return (
        <div className={`midnight-special${phase.fading ? ' is-fading' : ''}`} role="status" aria-live="assertive">
            <div className="midnight-special__nightfall" />
            <div className="midnight-special__moon" aria-hidden="true">🌙</div>

            <div className="midnight-special__titles">
                <div className="midnight-special__title">THE MIDNIGHT SPECIAL</div>
                {phase.lyric
                    ? <div className="midnight-special__lyric" key={phase.lyric}>{phase.lyric}</div>
                    : <div className="midnight-special__subtitle">{playerName} has left the station</div>}
            </div>

            {phase.spotlight && spot.x !== null && (
                <div
                    className="midnight-special__spotlight"
                    style={{ '--spot-x': `${spot.x}px`, '--spot-y': `${spot.y}px` }}
                />
            )}

            <div className="midnight-special__smoke-layer" ref={smokeLayerRef} aria-hidden="true" />

            <div className="midnight-train" aria-hidden="true">
                <div className="midnight-train__engine" ref={engineRef}>
                    <span className="midnight-train__beam" />
                    <div className="midnight-train__boiler">
                        <span className="midnight-train__smokebox" />
                        <span className="midnight-train__stack" />
                        <span className="midnight-train__cab-roof" />
                    </div>
                </div>
                <TrainCar label="MIDNIGHT" refFn={(el) => { carRefs.current[0] = el; }} />
                <TrainCar label="SPECIAL" refFn={(el) => { carRefs.current[1] = el; }} />
            </div>
        </div>
    );
};

export default MidnightSpecialBanner;
export const MIDNIGHT_SPECIAL_TOTAL_MS = MIDNIGHT_TIMELINE.total * 1000;
