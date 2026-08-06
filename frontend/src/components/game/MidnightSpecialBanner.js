// frontend/src/components/game/MidnightSpecialBanner.js
//
// The Midnight Special celebration: when the server proves a player's run
// is unstoppable, a night sky sweeps the table and the train crosses it.
// Pure presentation — pointer-events pass through, play continues under it.

import React from 'react';
import './MidnightSpecialBanner.css';

const MidnightSpecialBanner = ({ playerName }) => {
    if (!playerName) return null;
    return (
        <div className="midnight-special" role="status" aria-live="assertive">
            <div className="midnight-special__sky">
                <span className="midnight-special__moon" aria-hidden="true">🌙</span>
                <span className="midnight-special__train" aria-hidden="true">🚂💨</span>
            </div>
            <div className="midnight-special__title">THE MIDNIGHT SPECIAL</div>
            <div className="midnight-special__subtitle">
                {playerName} has left the station
            </div>
        </div>
    );
};

export default MidnightSpecialBanner;
