// frontend/src/components/game/McMillanCrest.js
// Original SVG interpretation of the Clan MacMillan crest badge for the
// McMillan deck skin: a dexter and a sinister hand brandishing a two-handed
// sword within a strap-and-buckle band bearing the clan motto, with holly
// sprigs (the plant badge). Drawn from the heraldic blazon, not copied from
// any published rendering.

import React from 'react';

const McMillanCrest = ({ className }) => (
    <svg
        className={className}
        viewBox="0 0 100 100"
        role="img"
        aria-label="McMillan crest card back"
    >
        <defs>
            <path
                id="mcm-motto-arc"
                d="M 50 50 m -33.5 0 a 33.5 33.5 0 1 1 67 0"
                fill="none"
            />
            <radialGradient id="mcm-field" cx="50%" cy="42%" r="65%">
                <stop offset="0%" stopColor="#1d3a63" />
                <stop offset="100%" stopColor="#101f38" />
            </radialGradient>
            <linearGradient id="mcm-blade" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#8f9aa8" />
                <stop offset="45%" stopColor="#eef2f7" />
                <stop offset="55%" stopColor="#eef2f7" />
                <stop offset="100%" stopColor="#7b8694" />
            </linearGradient>
        </defs>

        {/* Strap-and-buckle band */}
        <circle cx="50" cy="50" r="46" fill="#2f2213" />
        <circle cx="50" cy="50" r="46" fill="none" stroke="#c9a84c" strokeWidth="1.6" />
        <circle cx="50" cy="50" r="37.5" fill="none" stroke="#c9a84c" strokeWidth="1.2" />
        {/* Buckle at the base of the strap */}
        <rect x="44" y="88.6" width="12" height="7" rx="1.4" fill="#c9a84c" />
        <rect x="46.4" y="90.6" width="7.2" height="3" rx="0.8" fill="#2f2213" />
        <rect x="49.2" y="87.2" width="1.6" height="5.2" rx="0.8" fill="#e8d391" />

        {/* Motto on the strap */}
        <text
            fill="#e8d391"
            fontFamily="'Oswald', sans-serif"
            fontSize="6.1"
            fontWeight="600"
            letterSpacing="1.15"
        >
            <textPath href="#mcm-motto-arc" startOffset="50%" textAnchor="middle">
                MISERIS · SUCCURRERE · DISCO
            </textPath>
        </text>

        {/* Inner field */}
        <circle cx="50" cy="50" r="36.5" fill="url(#mcm-field)" />

        {/* Holly sprigs — the clan plant badge */}
        <g fill="#2e7d54" stroke="#173b28" strokeWidth="0.5">
            <path d="M 26 66 q -5 -2 -6 -7 q 5 0 7 4 q 2 -5 7 -5 q -1 5 -5 7 q 4 2 4 7 q -5 -1 -7 -6 z" />
            <path d="M 74 66 q 5 -2 6 -7 q -5 0 -7 4 q -2 -5 -7 -5 q 1 5 5 7 q -4 2 -4 7 q 5 -1 7 -6 z" />
        </g>
        <g fill="#b22222" stroke="#5f1717" strokeWidth="0.4">
            <circle cx="27.5" cy="70.5" r="1.7" />
            <circle cx="31" cy="72.5" r="1.7" />
            <circle cx="72.5" cy="70.5" r="1.7" />
            <circle cx="69" cy="72.5" r="1.7" />
        </g>

        {/* Two-handed sword, point uppermost */}
        <g>
            {/* Blade */}
            <polygon points="50,16 52.4,22 52.4,58 47.6,58 47.6,22" fill="url(#mcm-blade)" stroke="#4c5560" strokeWidth="0.5" />
            <line x1="50" y1="22" x2="50" y2="57" stroke="#9aa5b1" strokeWidth="0.5" />
            {/* Cross-guard with dropped quillons */}
            <path
                d="M 36 58 q 2 -2.4 5 -2.4 h 18 q 3 0 5 2.4 l -2.2 2.4 q -1.6 -1.6 -3.4 -1.6 h -16.8 q -1.8 0 -3.4 1.6 z"
                fill="#c9a84c"
                stroke="#8a6d23"
                strokeWidth="0.6"
            />
            {/* Grip and pommel */}
            <rect x="48" y="60.5" width="4" height="12.5" rx="1.4" fill="#5d3a1a" stroke="#3a2410" strokeWidth="0.5" />
            <line x1="48.2" y1="63.6" x2="51.8" y2="63.6" stroke="#3a2410" strokeWidth="0.6" />
            <line x1="48.2" y1="67" x2="51.8" y2="67" stroke="#3a2410" strokeWidth="0.6" />
            <line x1="48.2" y1="70.4" x2="51.8" y2="70.4" stroke="#3a2410" strokeWidth="0.6" />
            <circle cx="50" cy="76.4" r="3" fill="#c9a84c" stroke="#8a6d23" strokeWidth="0.6" />
        </g>

        {/* Dexter and sinister hands grasping the grip, cuffed sleeves */}
        <g stroke="#7c5a34" strokeWidth="0.5">
            <path
                d="M 36.5 62 q 5 -1.6 9.5 0.6 q 2.6 1.4 2.6 3.4 q 0 2 -2.6 2.6 q -4.8 1.2 -9.5 -1.4 q 2 -1.2 2 -2.6 q 0 -1.4 -2 -2.6 z"
                fill="#e8c39a"
            />
            <path
                d="M 63.5 62 q -5 -1.6 -9.5 0.6 q -2.6 1.4 -2.6 3.4 q 0 2 2.6 2.6 q 4.8 1.2 9.5 -1.4 q -2 -1.2 -2 -2.6 q 0 -1.4 2 -2.6 z"
                fill="#e8c39a"
            />
        </g>
        {/* Sleeve cuffs */}
        <rect x="31.5" y="60.6" width="5.4" height="8.6" rx="1.4" fill="#8a1f1f" stroke="#4d0f0f" strokeWidth="0.5" />
        <rect x="63.1" y="60.6" width="5.4" height="8.6" rx="1.4" fill="#8a1f1f" stroke="#4d0f0f" strokeWidth="0.5" />
        {/* Knuckle lines suggesting gripping fingers */}
        <g stroke="#b98d5e" strokeWidth="0.5" fill="none">
            <path d="M 41 63.4 q 3 -0.8 5.6 0.4" />
            <path d="M 41 65.4 q 3 -0.6 5.6 0.4" />
            <path d="M 59 63.4 q -3 -0.8 -5.6 0.4" />
            <path d="M 59 65.4 q -3 -0.6 -5.6 0.4" />
        </g>
    </svg>
);

export default McMillanCrest;
