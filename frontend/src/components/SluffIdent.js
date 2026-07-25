// frontend/src/components/SluffIdent.js
// Boot ident: the full SLUFF logo erupts from a pinprick to fill the screen
// while a realistic ace of clubs tumbles around the screen; as the card
// overlaps its docking spot it dissolves and the logo's stylized card
// emerges through it — impact dip, gold light sweep, hold, fade to app.
//
// Pure SVG so the pinprick-to-fullscreen zoom stays razor sharp at any
// viewport. Tap/click skips. prefers-reduced-motion gets a plain fade.

import React, { useEffect, useRef, useState } from 'react';
import './SluffIdent.css';

export const IDENT_TOTAL_MS = 3900;
export const IDENT_FADE_MS = 850;
export const IDENT_REDUCED_TOTAL_MS = 1400;

const ClubPip = ({ x, y, scale = 1, fill = '#fff', className }) => (
    <g className={className} transform={`translate(${x} ${y}) scale(${scale})`} fill={fill}>
        <circle cx="0" cy="-8" r="7.2" />
        <circle cx="-7.4" cy="3" r="7.2" />
        <circle cx="7.4" cy="3" r="7.2" />
        <path d="M -2.4 5 Q 0 14 -6.5 18 L 6.5 18 Q 0 14 2.4 5 Z" />
    </g>
);

const SluffIdent = ({ onDone, hold = false }) => {
    const [leaving, setLeaving] = useState(false);
    const doneRef = useRef(false);
    const reduced = typeof window !== 'undefined'
        && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);

    useEffect(() => {
        if (hold) return undefined;
        const holdMs = reduced ? IDENT_REDUCED_TOTAL_MS : IDENT_TOTAL_MS;
        const leaveTimer = setTimeout(() => setLeaving(true), holdMs);
        return () => clearTimeout(leaveTimer);
    }, [hold, reduced]);

    useEffect(() => {
        if (!leaving) return undefined;
        const doneTimer = setTimeout(() => {
            if (doneRef.current) return;
            doneRef.current = true;
            onDone?.();
        }, IDENT_FADE_MS);
        return () => clearTimeout(doneTimer);
    }, [leaving, onDone]);

    const skip = () => {
        if (!hold) setLeaving(true);
    };

    return (
        <div
            className={`sluff-ident${leaving ? ' is-leaving' : ''}${reduced ? ' is-reduced' : ''}${hold ? ' is-held' : ''}`}
            onPointerDown={skip}
            role="presentation"
            aria-hidden="true"
            data-testid="sluff-ident"
        >
            <div className="sluff-ident__stage">
                {/* A real ace of clubs tumbles around the screen BEHIND the
                    logo, slides in under the logo's card, and dissolves
                    there — the logo stays fully drawn on top the whole time,
                    so the card's exit reads as slipping into the mark.
                    Geometry least-squares-fit to SluffLogo.png's pixels so
                    the ace docks exactly on the logo card: 247x327 rect
                    centered at (436.6, 192), rotated 12.26deg. Fit residuals
                    against the traced edges are ~1px. */}
                <svg className="sluff-ident__layer sluff-ident__card-svg" viewBox="0 0 600 400">
                    <g transform="rotate(12.26 436.6 192)">
                        {/* Drawn as a classic white ace; a timed CSS invert
                            flips it to the dark negative in the last 0.2s
                            before it docks. */}
                        <rect
                            x="313.1"
                            y="28.5"
                            width="247"
                            height="327"
                            rx="30"
                            fill="#fdfcf6"
                            stroke="#1c1c20"
                            strokeWidth="3"
                        />
                        <text
                            x="349"
                            y="104"
                            textAnchor="middle"
                            fontFamily="'Merriweather', serif"
                            fontWeight="700"
                            fontSize="48"
                            fill="#15151a"
                        >
                            A
                        </text>
                        <ClubPip x={349} y={134} scale={0.7} fill="#15151a" className="sluff-ident__card-suit" />
                        <ClubPip x={436.6} y={190} scale={2.2} fill="#15151a" className="sluff-ident__card-suit" />
                        <g transform="rotate(180 436.6 192)">
                            <text
                                x="349"
                                y="104"
                                textAnchor="middle"
                                fontFamily="'Merriweather', serif"
                                fontWeight="700"
                                fontSize="48"
                                fill="#15151a"
                            >
                                A
                            </text>
                            <ClubPip x={349} y={134} scale={0.7} fill="#15151a" className="sluff-ident__card-suit" />
                        </g>
                    </g>
                </svg>

                {/* Logo layer — the real SluffLogo.png grows from a pinprick */}
                <img
                    className="sluff-ident__layer sluff-ident__logo"
                    src="/SluffLogo.png"
                    alt=""
                    draggable="false"
                />
            </div>
        </div>
    );
};

export default SluffIdent;
