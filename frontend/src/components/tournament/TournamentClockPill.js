// The shot clock on the felt: your bank for the round, and the red "on the
// clock" state when the room is waiting on this table.
import React from 'react';
import './tournament.css';

const TournamentClockPill = ({ clock, playerName }) => {
    if (!clock) return null;
    const bank = clock.banks?.[playerName];
    const onTheClock = clock.onTheClock === true;
    return (
        <div
            className={`tournament-clock-pill${onTheClock ? ' on-the-clock' : ''}`}
            role="status"
            aria-live="polite"
            data-on-the-clock={onTheClock ? 'true' : 'false'}
        >
            {onTheClock
                ? <span className="tournament-clock-label">On the clock · {clock.freeSeconds?.play ?? 4} s a card</span>
                : <span className="tournament-clock-label">Shot clock · {clock.freeSeconds?.play ?? 6} s a card</span>}
            {Number.isFinite(bank) && (
                <span className="tournament-clock-bank">Bank {bank} s</span>
            )}
        </div>
    );
};

export default TournamentClockPill;
