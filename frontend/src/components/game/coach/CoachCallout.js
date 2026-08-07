// frontend/src/components/game/coach/CoachCallout.js
//
// The proximity-anchored teaching primitive: a small speech card that
// attaches to a REAL element on the felt (a seat plate, the hand, a pile),
// with an optional pointing hand and an optional spotlight veil that dims
// everything except the thing being talked about. Replaces far-away banner
// copy with tips that sit next to the action they describe.
//
// Design rules: never block play — the callout and veil are
// pointer-events:none except the dismiss button; it dies on its own timer,
// when dismissed, or when its anchor leaves the DOM. Honors
// prefers-reduced-motion (no bob, no fade).

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePrefersReducedMotion } from '../../../hooks/usePrefersReducedMotion';
import './CoachCallout.css';

const EDGE_MARGIN_VW = 4;

const anchorRect = (anchor) => {
    try {
        const el = typeof anchor === 'string' ? document.querySelector(anchor) : anchor;
        const rect = el?.getBoundingClientRect?.();
        return rect && rect.width > 0 ? rect : null;
    } catch {
        return null;
    }
};

const CoachCallout = ({
    anchor,
    side = 'top',            // preferred side of the anchor; flips near edges
    pointer = 'hand',        // 'hand' | 'none'
    spotlight = false,
    autoDismissMs = 8000,
    onDismiss,
    children,
}) => {
    const prefersReducedMotion = usePrefersReducedMotion();
    const [layout, setLayout] = useState(null);
    const cardRef = useRef(null);
    // Timer callbacks live in refs so re-renders never restart the clock
    // (the emitEvent-identity lesson, applied preemptively).
    const dismissRef = useRef(onDismiss);
    dismissRef.current = onDismiss;

    // Measure the anchor and place the card. Re-measures on resize and on a
    // short interval — table elements move (piles pulse, seats shift) and a
    // stale position reads as pointing at nothing.
    useLayoutEffect(() => {
        let cancelled = false;
        const place = () => {
            if (cancelled) return;
            const rect = anchorRect(anchor);
            if (!rect) {
                setLayout(current => (current ? null : current));
                return;
            }
            const vw = window.innerWidth / 100;
            const margin = EDGE_MARGIN_VW * vw;
            const anchorX = rect.left + rect.width / 2;
            const preferAbove = side === 'top';
            const flip = preferAbove ? rect.top < window.innerHeight * 0.25 : rect.bottom > window.innerHeight * 0.75;
            const above = preferAbove ? !flip : flip;
            // The card is centered on the anchor, so clamping its CENTER to
            // the margin still let half of it hang off a phone screen. Clamp
            // by the card's real half-width once it has rendered (first pass
            // falls back to the margin; the re-place below corrects it).
            const halfCard = Math.max(margin, (cardRef.current?.offsetWidth || 0) / 2 + 8);
            setLayout({
                anchorX: Math.min(Math.max(anchorX, halfCard), window.innerWidth - halfCard),
                anchorY: above ? rect.top : rect.bottom,
                above,
                // The hand tracks the anchor, not the card — but an anchor
                // half off a phone screen must not drag it out of view.
                spotX: Math.min(Math.max(anchorX, 16), window.innerWidth - 16),
                spotY: rect.top + rect.height / 2,
                spotR: Math.max(rect.width, rect.height) * 0.75,
            });
        };
        place();
        // The first pass ran before the card existed, so its width was
        // unknown and an edge anchor still clipped: re-place immediately
        // after paint with the measured card.
        const remeasure = requestAnimationFrame(place);
        const interval = setInterval(place, 400);
        window.addEventListener('resize', place);
        return () => {
            cancelled = true;
            cancelAnimationFrame(remeasure);
            clearInterval(interval);
            window.removeEventListener('resize', place);
        };
    }, [anchor, side]);

    // Anchor vanished (state moved on): the lesson leaves with it.
    useEffect(() => {
        if (layout !== null) return undefined;
        const grace = setTimeout(() => {
            if (!anchorRect(anchor)) dismissRef.current?.({ reason: 'anchor-gone' });
        }, 900);
        return () => clearTimeout(grace);
    }, [layout, anchor]);

    useEffect(() => {
        if (!Number.isFinite(autoDismissMs) || autoDismissMs <= 0) return undefined;
        const timer = setTimeout(() => dismissRef.current?.({ reason: 'timeout' }), autoDismissMs);
        return () => clearTimeout(timer);
    }, [autoDismissMs]);

    if (!layout) return null;

    const cardStyle = {
        left: `${layout.anchorX}px`,
        top: layout.above ? undefined : `${layout.anchorY + 12}px`,
        bottom: layout.above ? `${window.innerHeight - layout.anchorY + 12}px` : undefined,
    };

    return createPortal(
        <div className={`coach-callout-root${prefersReducedMotion ? ' coach-reduced-motion' : ''}`} aria-live="polite">
            {spotlight && (
                <div
                    className="coach-spotlight"
                    style={{
                        '--coach-spot-x': `${layout.spotX}px`,
                        '--coach-spot-y': `${layout.spotY}px`,
                        '--coach-spot-r': `${layout.spotR}px`,
                    }}
                    aria-hidden="true"
                />
            )}
            {pointer === 'hand' && (
                <span
                    className={`coach-pointer${layout.above ? '' : ' coach-pointer--below'}`}
                    style={{ left: `${layout.spotX}px`, top: `${layout.anchorY}px` }}
                    aria-hidden="true"
                >
                    👆
                </span>
            )}
            <div className="coach-callout" style={cardStyle} role="status" ref={cardRef}>
                <div className="coach-callout-body">{children}</div>
                <button
                    type="button"
                    className="coach-callout-dismiss"
                    onClick={() => dismissRef.current?.({ reason: 'dismissed' })}
                    aria-label="Dismiss tip"
                >
                    ×
                </button>
            </div>
        </div>,
        document.body,
    );
};

export default CoachCallout;
