// frontend/src/components/game/WidowSpider.js
// Easter egg: a black widow crawls out from under the widow pile, wanders
// the felt for ~10 seconds (with a couple of nervous pauses), then slips
// back under the cards. Purely visual — pointer-events none, layered below
// played cards and piles so she genuinely emerges from beneath the widow.
// Ordinary game-state churn doesn't touch a run in progress; only the
// end-of-round presentation (or unmount) cancels her early.

import React, { useEffect, useRef } from 'react';
import './WidowSpider.css';

const RUN_MS = 10000;
const EMERGE_MS = 900;
const HIDE_MS = 800;
const CANCEL_FADE_MS = 300;

const findWidowAnchor = () => {
    const pile = document.querySelector('.trick-pile-base.widow-base');
    const rect = pile?.getBoundingClientRect();
    if (rect && rect.width > 0) {
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    // No widow pile mounted (e.g. pre-deal): emerge from its usual corner.
    return { x: window.innerWidth * 0.2, y: window.innerHeight * 0.16 };
};

const buildPath = (start) => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const rand = (lo, hi) => lo + Math.random() * (hi - lo);
    const points = [{ ...start, dwell: 0 }];
    for (let i = 0; i < 4; i += 1) {
        points.push({
            x: rand(w * 0.18, w * 0.82),
            y: rand(h * 0.22, h * 0.62),
            // Two nervous stops mid-wander
            dwell: i === 1 || i === 3 ? rand(450, 850) : 0,
        });
    }
    points.push({ ...start, dwell: 0 });
    return points;
};

const shortestArcLerp = (from, to, t) => {
    let delta = ((to - from + 540) % 360) - 180;
    return from + delta * t;
};

const WidowSpider = ({ runId, cancelled }) => {
    const elRef = useRef(null);
    const frameRef = useRef(0);
    const runStateRef = useRef(null);
    const cancelledRef = useRef(false);
    cancelledRef.current = Boolean(cancelled);

    useEffect(() => {
        if (!runId) return undefined;
        if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return undefined;

        const el = elRef.current;
        if (!el) return undefined;

        const start = findWidowAnchor();
        const points = buildPath(start);

        // Constant crawl speed across the whole route, dwells excluded.
        const segments = [];
        let totalLength = 0;
        let totalDwell = 0;
        for (let i = 1; i < points.length; i += 1) {
            const dx = points[i].x - points[i - 1].x;
            const dy = points[i].y - points[i - 1].y;
            const length = Math.hypot(dx, dy) || 1;
            const angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90; // sprite faces up
            segments.push({ from: points[i - 1], to: points[i], length, angle, dwell: points[i].dwell || 0 });
            totalLength += length;
            totalDwell += points[i].dwell || 0;
        }
        const travelMs = Math.max(1000, RUN_MS - totalDwell);

        // Timeline of alternating crawl/dwell intervals per segment.
        const timeline = [];
        let cursor = 0;
        for (const segment of segments) {
            const duration = (segment.length / totalLength) * travelMs;
            timeline.push({ kind: 'crawl', segment, start: cursor, end: cursor + duration });
            cursor += duration;
            if (segment.dwell) {
                timeline.push({ kind: 'dwell', segment, start: cursor, end: cursor + segment.dwell });
                cursor += segment.dwell;
            }
        }
        const totalMs = cursor;

        runStateRef.current = {
            startedAt: performance.now(),
            heading: segments[0]?.angle ?? 0,
            cancelAt: null,
        };
        el.classList.add('is-active');

        const tick = (now) => {
            const run = runStateRef.current;
            if (!run) return;

            if (cancelledRef.current && run.cancelAt === null) run.cancelAt = now;
            if (run.cancelAt !== null) {
                const fade = Math.min(1, (now - run.cancelAt) / CANCEL_FADE_MS);
                el.style.opacity = String(1 - fade);
                if (fade >= 1) {
                    el.classList.remove('is-active');
                    runStateRef.current = null;
                    return;
                }
                frameRef.current = requestAnimationFrame(tick);
                return;
            }

            const elapsed = now - run.startedAt;
            if (elapsed >= totalMs) {
                el.classList.remove('is-active');
                runStateRef.current = null;
                return;
            }

            const step = timeline.find(entry => elapsed < entry.end) || timeline[timeline.length - 1];
            let x;
            let y;
            let moving = false;
            if (step.kind === 'dwell') {
                x = step.segment.to.x;
                y = step.segment.to.y;
            } else {
                const t = Math.min(1, (elapsed - step.start) / (step.end - step.start));
                x = step.segment.from.x + (step.segment.to.x - step.segment.from.x) * t;
                y = step.segment.from.y + (step.segment.to.y - step.segment.from.y) * t;
                run.heading = shortestArcLerp(run.heading, step.segment.angle, 0.14);
                moving = true;
            }

            // Emerge and hide: scale + fade at the route's ends.
            let scale = 1;
            let opacity = 1;
            if (elapsed < EMERGE_MS) {
                const t = elapsed / EMERGE_MS;
                scale = 0.25 + 0.75 * t;
                opacity = Math.min(1, t * 2);
            } else if (elapsed > totalMs - HIDE_MS) {
                const t = (totalMs - elapsed) / HIDE_MS;
                scale = 0.25 + 0.75 * t;
                opacity = Math.min(1, t * 2);
            }

            el.style.opacity = String(opacity);
            el.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${run.heading}deg) scale(${scale})`;
            el.classList.toggle('is-walking', moving);

            frameRef.current = requestAnimationFrame(tick);
        };

        frameRef.current = requestAnimationFrame(tick);

        return () => {
            cancelAnimationFrame(frameRef.current);
            runStateRef.current = null;
            el.classList.remove('is-active', 'is-walking');
        };
    }, [runId]);

    return (
        <div className="widow-spider" ref={elRef} aria-hidden="true">
            <svg viewBox="-20 -20 40 40" className="widow-spider-svg">
                {/* Legs: four pairs, animated groups alternate for the walk cycle */}
                <g className="spider-legs spider-legs--a" stroke="#0c0c0e" strokeWidth="1.5" strokeLinecap="round" fill="none">
                    <path d="M -4 -4 Q -12 -10 -15 -16" />
                    <path d="M -5 2 Q -14 3 -18 8" />
                    <path d="M 4 -2 Q 13 -6 17 -12" />
                    <path d="M 5 4 Q 13 8 15 14" />
                </g>
                <g className="spider-legs spider-legs--b" stroke="#0c0c0e" strokeWidth="1.5" strokeLinecap="round" fill="none">
                    <path d="M -4 -2 Q -13 -6 -17 -12" />
                    <path d="M -5 4 Q -13 8 -15 14" />
                    <path d="M 4 -4 Q 12 -10 15 -16" />
                    <path d="M 5 2 Q 14 3 18 8" />
                </g>
                {/* Cephalothorax + bulbous abdomen */}
                <circle cx="0" cy="-5" r="4.2" fill="#151517" />
                <ellipse cx="0" cy="4.5" rx="6.5" ry="8" fill="#0d0d10" />
                <ellipse cx="0" cy="1.5" rx="6.5" ry="3.4" fill="rgba(255,255,255,0.06)" />
                {/* Red hourglass */}
                <path d="M 0 2.4 L -2.2 -0.6 L 2.2 -0.6 Z M 0 2.6 L -2.2 5.8 L 2.2 5.8 Z" fill="#c81e1e" transform="translate(0 1.4)" />
                {/* Eyes glint */}
                <circle cx="-1.4" cy="-8" r="0.7" fill="#3a3a40" />
                <circle cx="1.4" cy="-8" r="0.7" fill="#3a3a40" />
            </svg>
        </div>
    );
};

export default WidowSpider;
