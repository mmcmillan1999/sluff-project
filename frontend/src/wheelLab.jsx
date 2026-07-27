// frontend/src/wheelLab.jsx
// Dev-only wheel lab: a standalone page for spinning-wheel experiments,
// served by `npm run dev` at /wheel.html. Nothing here touches the game —
// it's a sandbox for tuning how a wheel should feel before it earns a place
// in the product. (Like harness.html, this entry is never bundled into the
// production build, which only includes index.html.)

import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/oswald/400.css';
import '@fontsource/oswald/600.css';
import SpinWheel from './components/lab/SpinWheel.js';
import SpinWheelRim from './components/lab/SpinWheelRim.js';

// ?view=flat — the original face-on octagon; default is the rim view
// (the octagon rotated 90° about Y, seen edge-on like the big wheel).
const flatView = new URLSearchParams(window.location.search).get('view') === 'flat';

const page = {
    minHeight: '100vh',
    margin: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '2vh',
    background: '#171a20',
    color: '#e8ebf2',
    fontFamily: "'Oswald', system-ui, sans-serif",
};

const WheelLab = () => (
    <div style={page}>
        <h1 style={{ margin: 0, fontWeight: 600, letterSpacing: '0.08em', fontSize: 'clamp(1.1rem, 3.5vh, 1.8rem)' }}>
            WHEEL LAB
        </h1>
        <p style={{ margin: 0, opacity: 0.6, fontSize: 'clamp(0.8rem, 2vh, 1rem)' }}>
            {flatView ? 'Grab the wheel and throw it.' : 'Pull the rim down and let it rip.'}
        </p>
        {flatView ? <SpinWheel /> : <SpinWheelRim />}
        <p style={{ margin: 0, opacity: 0.35, fontSize: '0.75rem' }}>
            {flatView ? 'rim view: /wheel.html' : 'flat view: /wheel.html?view=flat'}
        </p>
    </div>
);

document.body.style.margin = '0';
document.body.style.background = '#171a20';
ReactDOM.createRoot(document.getElementById('root')).render(<WheelLab />);
