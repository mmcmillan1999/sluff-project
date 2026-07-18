// frontend/src/components/game/WidowSpider.js
// Easter egg: a black widow that lives under the widow pile. Two behaviors:
//
// - 'wander': crawls out, ambles the felt ~10s with two nervous pauses,
//   then slips back under the cards.
// - 'chase': darts out and hunts the player's finger/cursor — she pursues
//   the latest pointer position with menacing stutter-lunges, then retreats
//   under the widow.
//
// She emerges from and hides beneath the pile at low z, but while she's out
// she climbs ON TOP of everything on the table (cards, hand, chrome).
// Purely visual — pointer-events none. Ordinary game-state churn doesn't
// touch a run; only the end-of-round presentation (or unmount) cancels her.

import React, { useEffect, useRef } from 'react';
import './WidowSpider.css';

const WANDER_MS = 10000;
const EMERGE_MS = 900;
const HIDE_MS = 800;
const CANCEL_FADE_MS = 300;

const CHASE_EMERGE_MS = 500;
const CHASE_HUNT_MS = 6500;
const CHASE_SPEED = 1350;          // px/s while charging
const LUNGE_RADIUS = 70;           // "got you" distance — she jabs and shakes
const CHASE_MAX_MS = 12000;        // hard safety cap

const findWidowAnchor = () => {
    const pile = document.querySelector('.trick-pile-base.widow-base');
    const rect = pile?.getBoundingClientRect();
    if (rect && rect.width > 0) {
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    // No widow pile mounted (e.g. pre-deal): emerge from its usual corner.
    return { x: window.innerWidth * 0.2, y: window.innerHeight * 0.16 };
};

const buildWanderPath = (start) => {
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
    const delta = ((to - from + 540) % 360) - 180;
    return from + delta * t;
};

const WidowSpider = ({ runId, mode = 'wander', cancelled }) => {
    const elRef = useRef(null);
    const frameRef = useRef(0);
    const cleanupRef = useRef(null);
    const cancelledRef = useRef(false);
    cancelledRef.current = Boolean(cancelled);

    useEffect(() => {
        if (!runId) return undefined;
        if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return undefined;

        const el = elRef.current;
        if (!el) return undefined;

        el.classList.add('is-active');
        let cancelStartedAt = null;

        const finish = () => {
            el.classList.remove('is-active', 'is-walking', 'is-charging', 'is-on-top');
            el.style.opacity = '';
        };

        const applyFrame = (x, y, heading, scale, opacity, { walking = false, charging = false, onTop = false } = {}) => {
            el.style.opacity = String(opacity);
            el.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${heading}deg) scale(${scale})`;
            el.classList.toggle('is-walking', walking);
            el.classList.toggle('is-charging', charging);
            el.classList.toggle('is-on-top', onTop);
        };

        // Shared cancel handling: quick fade wherever she is.
        const handleCancel = (now, tick) => {
            if (cancelledRef.current && cancelStartedAt === null) cancelStartedAt = now;
            if (cancelStartedAt === null) return false;
            const fade = Math.min(1, (now - cancelStartedAt) / CANCEL_FADE_MS);
            el.style.opacity = String(1 - fade);
            if (fade >= 1) {
                finish();
                return true;
            }
            frameRef.current = requestAnimationFrame(tick);
            return true;
        };

        if (mode === 'chase') {
            // --- Chase: pursue the latest pointer position, then retreat ---
            const anchor = findWidowAnchor();
            const target = { x: window.innerWidth / 2, y: window.innerHeight * 0.8 };
            const onPointer = (event) => {
                target.x = event.clientX;
                target.y = event.clientY;
            };
            window.addEventListener('pointermove', onPointer, { passive: true });
            window.addEventListener('pointerdown', onPointer, { passive: true });

            const pos = { ...anchor };
            let heading = 180;
            let lastNow = performance.now();
            const startedAt = lastNow;
            let stutterUntil = 0;
            let nextStutterAt = startedAt + 900;

            const tick = (now) => {
                if (handleCancel(now, tick)) return;
                const dt = Math.min(0.05, (now - lastNow) / 1000);
                lastNow = now;
                const elapsed = now - startedAt;

                const hunting = elapsed < CHASE_EMERGE_MS + CHASE_HUNT_MS;
                const goal = hunting ? target : anchor;
                const dx = goal.x - pos.x;
                const dy = goal.y - pos.y;
                const dist = Math.hypot(dx, dy);

                let scale = 1;
                let opacity = 1;
                let onTop = true;
                let walking = true;

                if (elapsed < CHASE_EMERGE_MS) {
                    // Burst out from under the pile
                    const t = elapsed / CHASE_EMERGE_MS;
                    scale = 0.25 + 0.75 * t;
                    opacity = Math.min(1, t * 2);
                    onTop = false;
                }

                if (!hunting && dist < 24) {
                    // Home: shrink back under the pile
                    const hideStart = el.dataset.hideStart ? Number(el.dataset.hideStart) : now;
                    el.dataset.hideStart = String(hideStart);
                    const t = Math.min(1, (now - hideStart) / 600);
                    applyFrame(anchor.x, anchor.y, heading, 1 - 0.75 * t, 1 - t, { onTop: false });
                    if (t >= 1 || elapsed > CHASE_MAX_MS) {
                        delete el.dataset.hideStart;
                        window.removeEventListener('pointermove', onPointer);
                        window.removeEventListener('pointerdown', onPointer);
                        finish();
                        return;
                    }
                    frameRef.current = requestAnimationFrame(tick);
                    return;
                }

                // Menace stutter: brief freezes between bursts while hunting
                if (hunting && now >= nextStutterAt) {
                    stutterUntil = now + 110;
                    nextStutterAt = now + 800 + Math.random() * 400;
                }
                const frozen = hunting && now < stutterUntil;

                if (dist > 1 && !frozen) {
                    const inLunge = hunting && dist < LUNGE_RADIUS;
                    const speed = inLunge ? 420 : CHASE_SPEED;
                    const step = Math.min(dist, speed * dt);
                    pos.x += (dx / dist) * step;
                    pos.y += (dy / dist) * step;
                    const targetHeading = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
                    heading = shortestArcLerp(heading, targetHeading, 0.35);
                    if (inLunge) {
                        // Attack shake right at the fingertip
                        pos.x += (Math.random() - 0.5) * 5;
                        pos.y += (Math.random() - 0.5) * 5;
                    }
                } else {
                    walking = false;
                }

                applyFrame(pos.x, pos.y, heading, scale, opacity, {
                    walking,
                    charging: hunting && elapsed >= CHASE_EMERGE_MS,
                    onTop,
                });

                if (elapsed > CHASE_MAX_MS) {
                    window.removeEventListener('pointermove', onPointer);
                    window.removeEventListener('pointerdown', onPointer);
                    finish();
                    return;
                }
                frameRef.current = requestAnimationFrame(tick);
            };

            frameRef.current = requestAnimationFrame(tick);
            cleanupRef.current = () => {
                window.removeEventListener('pointermove', onPointer);
                window.removeEventListener('pointerdown', onPointer);
            };
        } else {
            // --- Wander: fixed randomized route, constant crawl speed ---
            const start = findWidowAnchor();
            const points = buildWanderPath(start);

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
            const travelMs = Math.max(1000, WANDER_MS - totalDwell);

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
            const startedAt = performance.now();
            let heading = segments[0]?.angle ?? 0;

            const tick = (now) => {
                if (handleCancel(now, tick)) return;
                const elapsed = now - startedAt;
                if (elapsed >= totalMs) {
                    finish();
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
                    heading = shortestArcLerp(heading, step.segment.angle, 0.14);
                    moving = true;
                }

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

                // On top of the table while out; under the pile at both ends.
                const onTop = elapsed >= EMERGE_MS && elapsed <= totalMs - HIDE_MS;
                applyFrame(x, y, heading, scale, opacity, { walking: moving, onTop });
                frameRef.current = requestAnimationFrame(tick);
            };

            frameRef.current = requestAnimationFrame(tick);
            cleanupRef.current = null;
        }

        return () => {
            cancelAnimationFrame(frameRef.current);
            cleanupRef.current?.();
            cleanupRef.current = null;
            delete el.dataset.hideStart;
            finish();
        };
    }, [runId, mode]);

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
