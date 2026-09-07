// Trump Broken, the "Magma" way: the card that broke trump cracks the felt
// where it landed, molten rock wells up through the cracks and burns a
// ragged hole in the table, embers fly, and the hole cools into a charred
// scar that smoulders for the rest of the round. The banner text rises out
// of the hole with the heat.
//
// Everything is anchored at `origin` (percent of the table oval) so the
// burn happens under the trump card rather than in a banner up top. Sizes
// are in vh like the rest of the felt. Reduced motion skips straight to
// the cooled scar with the text shown plainly.
import React from 'react';
import './TrumpMagma.css';

// Jagged crack polylines radiating from the origin, in "oval units" (the
// SVG viewBox is 0..100 in both axes and stretches to the oval, so the
// cracks bend a little with the table's aspect — like real cracks would).
const CRACKS = [
    [[0, 0], [2.5, -2], [3.5, -5.5], [6.5, -7], [7, -10.5], [10.5, -12.5], [11, -15]],
    [[0, 0], [-3, -1], [-5, -4], [-8.5, -4.5], [-10, -7.5], [-14, -8], [-15.5, -10.5]],
    [[0, 0], [2, 2.5], [4.5, 3.5], [5.5, 7], [9, 8.5], [9.5, 12], [12, 13.5]],
    [[0, 0], [-2.5, 3], [-3.5, 6], [-7, 7], [-8, 10.5], [-11, 12]],
    [[0, 0], [-0.5, -3.5], [1, -6.5], [-1, -9.5], [0.5, -12]],
    [[0, 0], [3.5, 0.5], [6, -1], [9, 0.5], [11.5, -0.5]],
    [[0, 0], [-1.5, 4], [-1, 7.5], [-3, 10]],
];

// Ember sparks: direction (vh) and timing.
const EMBERS = [
    { x: -9, y: -12, delay: 0.55, dur: 1.1, size: 0.9 },
    { x: 7, y: -14, delay: 0.6, dur: 1.3, size: 0.7 },
    { x: 12, y: -6, delay: 0.7, dur: 1.0, size: 0.8 },
    { x: -13, y: -4, delay: 0.65, dur: 1.2, size: 0.6 },
    { x: 3, y: -17, delay: 0.75, dur: 1.4, size: 1.0 },
    { x: -5, y: -15, delay: 0.85, dur: 1.2, size: 0.7 },
    { x: 10, y: -11, delay: 0.9, dur: 1.1, size: 0.6 },
    { x: -10, y: -9, delay: 1.0, dur: 1.0, size: 0.8 },
    { x: 15, y: -2, delay: 1.05, dur: 0.9, size: 0.5 },
    { x: -2, y: -20, delay: 1.15, dur: 1.5, size: 0.9 },
];

const BUBBLES = [
    { x: -2.6, y: 1.2, delay: 0.9, dur: 1.4, size: 2.2 },
    { x: 2.2, y: -0.8, delay: 1.25, dur: 1.2, size: 1.6 },
    { x: 0.4, y: 2.4, delay: 1.6, dur: 1.5, size: 1.9 },
    { x: -1.4, y: -2.2, delay: 2.0, dur: 1.3, size: 1.4 },
];

const pointsFrom = (origin, crack) => crack
    .map(([dx, dy]) => `${(origin.x + dx).toFixed(2)},${(origin.y + dy).toFixed(2)}`)
    .join(' ');

const TrumpMagma = ({ origin = { x: 50, y: 45 }, reducedMotion = false }) => {
    const style = { '--mx': `${origin.x}%`, '--my': `${origin.y}%` };
    return (
        <div className={`trump-magma${reducedMotion ? ' is-still' : ''}`} style={style} data-origin={`${origin.x},${origin.y}`}>
            {/* Cracks: a dark fissure with molten light inside, drawn outward. */}
            <svg className="trump-magma-cracks" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                {CRACKS.map((crack, index) => (
                    <g key={index} className="trump-magma-crack" style={{ '--i': index }}>
                        <polyline className="trump-magma-crack-dark" points={pointsFrom(origin, crack)} pathLength="100" vectorEffect="non-scaling-stroke" />
                        <polyline className="trump-magma-crack-hot" points={pointsFrom(origin, crack)} pathLength="100" vectorEffect="non-scaling-stroke" />
                    </g>
                ))}
            </svg>

            {/* The heat: a glow on the felt around the hole. */}
            <span className="trump-magma-glow" aria-hidden="true" />

            {/* Charred felt around the hole. */}
            <span className="trump-magma-scorch" aria-hidden="true" />

            {/* The hole itself: crust, lava, veins, bubbles. */}
            <span className="trump-magma-hole" aria-hidden="true">
                <span className="trump-magma-crust" />
                <span className="trump-magma-lava" />
                <span className="trump-magma-veins" />
                {BUBBLES.map((bubble, index) => (
                    <span
                        key={index}
                        className="trump-magma-bubble"
                        style={{ '--bx': `${bubble.x}vh`, '--by': `${bubble.y}vh`, '--bd': `${bubble.delay}s`, '--bt': `${bubble.dur}s`, '--bs': `${bubble.size}vh` }}
                    />
                ))}
            </span>

            {/* Embers thrown out of the hole. */}
            {EMBERS.map((ember, index) => (
                <span
                    key={index}
                    className="trump-magma-ember"
                    aria-hidden="true"
                    style={{ '--ex': `${ember.x}vh`, '--ey': `${ember.y}vh`, '--ed': `${ember.delay}s`, '--et': `${ember.dur}s`, '--es': `${ember.size}vh` }}
                />
            ))}

            {/* The words rise out of the hole with the heat. */}
            <div className="trump-magma-text" role="status" aria-live="polite">TRUMP BROKEN!</div>
        </div>
    );
};

export default TrumpMagma;
