// The lobby's tournament announcement: one open tournament, join it or not.
// Shown once per tournament per lobby visit (App.js keeps the dismissal).
import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useModalFocus } from '../../hooks/useModalFocus';
import { startLabel, tokensLabel } from './tournamentFormat';
import { getThemePresentation } from '../../config/themePresentation';
import './tournament.css';

const TournamentPopup = ({ tournament, onJoin, onDismiss, busy = false }) => {
    const dialogRef = useModalFocus(Boolean(tournament), '.tournament-popup-join');

    useEffect(() => {
        if (!tournament) return undefined;
        const closeOnEscape = event => { if (event.key === 'Escape') onDismiss(); };
        document.addEventListener('keydown', closeOnEscape);
        return () => document.removeEventListener('keydown', closeOnEscape);
    }, [onDismiss, tournament]);

    if (!tournament) return null;
    const full = tournament.seatsTaken >= tournament.maxSeats;

    return createPortal(
        <div
            className="tournament-overlay"
            onMouseDown={event => { if (event.target === event.currentTarget) onDismiss(); }}
        >
            <section
                className="tournament-dialog"
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="tournament-popup-title"
                tabIndex="-1"
            >
                <p className="tournament-kicker">Tournament open</p>
                <h2 id="tournament-popup-title">{tournament.name}</h2>
                <ul className="tournament-facts">
                    <li><span className="k">Buy-in</span><span className="v">{tokensLabel(tournament.buyInTokens)}</span></li>
                    <li><span className="k">Starting stack</span><span className="v">{tournament.startingStack}</span></li>
                    <li><span className="k">Seats</span><span className="v">{tournament.seatsTaken} of {tournament.maxSeats}</span></li>
                    <li><span className="k">Venue</span><span className="v">{getThemePresentation(tournament.venue).name}</span></li>
                </ul>
                <p>{startLabel(tournament)}. Hosted by {tournament.creatorName}.</p>
                <div className="tournament-actions">
                    <button type="button" className="tournament-btn secondary" onClick={onDismiss} disabled={busy}>Not now</button>
                    <button type="button" className="tournament-btn tournament-popup-join" onClick={onJoin} disabled={busy || full}>
                        {full ? 'Full' : `Join · ${tokensLabel(tournament.buyInTokens)}`}
                    </button>
                </div>
            </section>
        </div>,
        document.body,
    );
};

export default TournamentPopup;
