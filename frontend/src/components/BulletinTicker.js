import React, { useState } from 'react';
import { bulletinTickerItems } from './BulletinContent';
import './BulletinTicker.css';

const TickerGroup = () => (
    <span className="bulletin-ticker-group">
        {bulletinTickerItems.map(item => (
            <span className="bulletin-ticker-item" key={item}>{item}</span>
        ))}
    </span>
);

const BulletinTicker = ({ onOpen }) => {
    const [isPaused, setIsPaused] = useState(false);

    return (
        <section className="bulletin-ticker" aria-label="Sluff news ticker">
            <button
                type="button"
                className="bulletin-ticker-label"
                onClick={onOpen}
                aria-label="Open Sluff Bulletin from Sluff Wire"
            >
                Sluff Wire
            </button>
            <button
                type="button"
                className="bulletin-ticker-link"
                onClick={onOpen}
                aria-label="Open Sluff Bulletin: Alpha Season 2 standings and development news"
            >
                <span className="bulletin-visually-hidden">
                    Alpha Season 2 standings and Sluff development news. Open the Bulletin for details.
                </span>
                <span className="bulletin-ticker-viewport" aria-hidden="true">
                    <span className="bulletin-ticker-track" data-paused={isPaused ? 'true' : 'false'}>
                        <TickerGroup />
                        <TickerGroup />
                    </span>
                </span>
            </button>
            <button
                type="button"
                className="bulletin-ticker-pause"
                onClick={() => setIsPaused(current => !current)}
                aria-label={isPaused ? 'Resume bulletin ticker' : 'Pause bulletin ticker'}
                aria-pressed={isPaused}
            >
                {isPaused ? (
                    <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                ) : (
                    <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 5h4v14H7zm6 0h4v14h-4z" /></svg>
                )}
            </button>
        </section>
    );
};

export default BulletinTicker;
