import React from 'react';

/**
 * A simple modal that instructs iOS users on how to add the app
 * to their home screen for a fullscreen experience.
 */
const IosPwaPrompt = ({ show, onClose }) => {
    if (!show) {
        return null;
    }

    const shareIcon = (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
            <polyline points="16 6 12 2 8 6" />
            <line x1="12" y1="2" x2="12" y2="15" />
        </svg>
    );

    const plusIcon = (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
    );

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" style={{maxWidth: '350px'}} onClick={e => e.stopPropagation()}>
                <h3 style={{fontFamily: 'Oswald, sans-serif'}}>Get the Full App Experience</h3>
                <p>To play in fullscreen without the address bar, add this game to your Home Screen:</p>
                <ol style={{textAlign: 'left', paddingLeft: '25px'}}>
                    <li style={{marginBottom: '10px'}}>Tap the <strong>Share</strong> icon {shareIcon} in your browser's toolbar.</li>
                    <li style={{marginBottom: '10px'}}>Scroll down and tap on <strong>"Add to Home Screen"</strong> {plusIcon}.</li>
                </ol>
                <button onClick={onClose} className="game-button" style={{marginTop: '10px'}}>Got It</button>
            </div>
        </div>
    );
};

export default IosPwaPrompt;
