// frontend/src/components/SessionScrim.js
// Shown in place of the app when this client has been put down because the
// account is live on another device or tab (utils/clientSession.js). Nothing
// here reconnects on its own — two clients trading the seat back and forth
// is the bug this replaces — so the button is the only way back in.

import React from 'react';
import './SessionScrim.css';

const SessionScrim = ({ reason, onPlayHere }) => (
    <div className="session-scrim" role="alertdialog" aria-modal="true" aria-labelledby="session-scrim-title" aria-describedby="session-scrim-copy">
        <div className="session-scrim__devices" aria-hidden="true">
            <div className="session-scrim__device session-scrim__device--idle" />
            <div className="session-scrim__device session-scrim__device--live" />
        </div>
        <h2 id="session-scrim-title" className="session-scrim__title">
            {reason === 'claimed-elsewhere' ? 'You opened Sluff somewhere else' : 'Sluff is open somewhere else'}
        </h2>
        <p id="session-scrim-copy" className="session-scrim__copy">
            Your account plays from one device or tab at a time, so this one stepped aside.
            Your seat and your tokens are safe.
        </p>
        <button type="button" className="session-scrim__button" onClick={onPlayHere} autoFocus>
            Play here
        </button>
        <p className="session-scrim__note">The other one will step aside instead.</p>
    </div>
);

export default SessionScrim;
