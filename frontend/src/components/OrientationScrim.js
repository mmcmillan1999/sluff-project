// frontend/src/components/OrientationScrim.js
// Full-screen "rotate your device" overlay shown only on landscape phones.
// Sluff's game layout is portrait-only by design (see CLAUDE.md); phone
// landscape is blocked here rather than half-supported. Visibility is pure
// CSS (orientation + pointer + max-height media query), so this renders
// unconditionally and costs nothing on other devices.

import React from 'react';
import './OrientationScrim.css';

const OrientationScrim = () => (
    <div className="orientation-scrim" role="status">
        <div className="orientation-scrim__phone" aria-hidden="true">
            <div className="orientation-scrim__phone-screen" />
            <div className="orientation-scrim__phone-button" />
        </div>
        <h2 className="orientation-scrim__title">Rotate your device</h2>
        <p className="orientation-scrim__copy">Sluff plays upright &mdash; turn your phone back to portrait.</p>
    </div>
);

export default OrientationScrim;
