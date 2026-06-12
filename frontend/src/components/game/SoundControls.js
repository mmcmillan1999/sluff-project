// frontend/src/components/game/SoundControls.js
import React from 'react';
import './SoundControls.css';

const SpeakerOnIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
        <path d="M15.5 8.5a5 5 0 0 1 0 7" />
        <path d="M18.5 5.5a9 9 0 0 1 0 13" />
    </svg>
);

const SpeakerOffIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
        <line x1="22" y1="9" x2="16" y2="15" />
        <line x1="16" y1="9" x2="22" y2="15" />
    </svg>
);

const SoundControls = ({ soundSettings, compact = false }) => {
    if (!soundSettings) return null;
    const { muted, volume, toggleMute, setVolume } = soundSettings;

    const handleVolumeChange = (e) => {
        const v = Number(e.target.value) / 100;
        setVolume(v);
        if (muted && v > 0) toggleMute();
    };

    return (
        <div className={`sound-controls${compact ? ' compact' : ''}`}>
            <button
                type="button"
                className="sound-mute-btn"
                onClick={toggleMute}
                aria-label={muted ? 'Unmute game sounds' : 'Mute game sounds'}
                title={muted ? 'Unmute game sounds' : 'Mute game sounds'}
            >
                {muted ? <SpeakerOffIcon /> : <SpeakerOnIcon />}
            </button>
            <input
                type="range"
                min="0"
                max="100"
                value={muted ? 0 : Math.round(volume * 100)}
                onChange={handleVolumeChange}
                className="sound-volume-slider"
                aria-label="Game sound volume"
            />
        </div>
    );
};

export default SoundControls;
