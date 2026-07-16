// frontend/src/components/game/SoundControls.js
import React, { useId } from 'react';
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

const MusicOnIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 18V5l10-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="16" cy="16" r="3" />
    </svg>
);

const MusicOffIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 14.5V5l10-2v9" />
        <circle cx="6" cy="18" r="3" />
        <line x1="14" y1="14" x2="21" y2="21" />
        <line x1="21" y1="14" x2="14" y2="21" />
    </svg>
);

const toPercent = value => {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return 0;
    return Math.round(Math.min(1, Math.max(0, numericValue)) * 100);
};

const VolumeRow = ({
    label,
    accessibleLabel,
    muted,
    volume,
    toggleMute,
    setVolume,
    OnIcon,
    OffIcon,
}) => {
    const sliderId = useId();
    const muteLabel = `${muted ? 'Unmute' : 'Mute'} ${accessibleLabel.toLowerCase()}`;

    const handleVolumeChange = event => {
        const nextVolume = Number(event.target.value) / 100;
        setVolume(nextVolume);
        if (muted && nextVolume > 0) toggleMute();
    };

    return (
        <div className="sound-control-row">
            <label className="sound-control-label" htmlFor={sliderId}>{label}</label>
            <button
                type="button"
                className="sound-mute-btn"
                onClick={toggleMute}
                aria-label={muteLabel}
                title={muteLabel}
                aria-pressed={muted}
            >
                {muted ? <OffIcon /> : <OnIcon />}
            </button>
            <input
                id={sliderId}
                type="range"
                min="0"
                max="100"
                value={muted ? 0 : toPercent(volume)}
                onChange={handleVolumeChange}
                className="sound-volume-slider"
                aria-label={`${accessibleLabel} volume`}
            />
        </div>
    );
};

const SoundControls = ({ soundSettings, compact = false }) => {
    if (!soundSettings) return null;
    const {
        muted = false,
        volume = 0.7,
        toggleMute = () => {},
        setVolume = () => {},
        musicMuted = false,
        musicVolume = 0.35,
        toggleMusicMute = () => {},
        setMusicVolume = () => {},
    } = soundSettings;

    return (
        <div
            className={`sound-controls${compact ? ' compact' : ''}`}
            role="group"
            aria-label="Audio controls"
        >
            <VolumeRow
                label="Effects"
                accessibleLabel="Sound effects"
                muted={muted}
                volume={volume}
                toggleMute={toggleMute}
                setVolume={setVolume}
                OnIcon={SpeakerOnIcon}
                OffIcon={SpeakerOffIcon}
            />
            <VolumeRow
                label="Music"
                accessibleLabel="Music"
                muted={musicMuted}
                volume={musicVolume}
                toggleMute={toggleMusicMute}
                setVolume={setMusicVolume}
                OnIcon={MusicOnIcon}
                OffIcon={MusicOffIcon}
            />
        </div>
    );
};

export default SoundControls;
