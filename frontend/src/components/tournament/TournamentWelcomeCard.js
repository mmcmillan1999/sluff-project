// The call to the felt. While round one waits on its first deal, this card
// sits on the felt: which event this is, how big the field is, tonight's
// favorites, and a countdown to the cards — while the sounds hook plays the
// bugle and Liam's line. The server owns the moment: `tournament.welcome`
// exists only while the opening hold is live, so an all-pass redeal later
// in round one never brings the card back.
import React, { useEffect } from 'react';
import { useCountdown } from './useCountdown';
import { fetchTournamentWelcome } from '../../services/api';
import './tournament.css';

const OUT = new Set(['withdrawn', 'refunded']);

const TournamentWelcomeCard = ({ tournament, tableState, playWelcome = null, fetchLine = fetchTournamentWelcome }) => {
    const welcome = tournament?.welcome || null;
    const dealIn = useCountdown(welcome?.dealInSeconds ?? null);
    const tournamentId = tournament?.id ?? null;
    const lineReady = Boolean(welcome?.audio);
    const active = Boolean(welcome) && tableState === 'Dealing Pending';

    // Once on arrival (the bugle, and a first try for the line), and again
    // when the server says the line is ready. The hook plays each part once.
    useEffect(() => {
        if (!active || typeof playWelcome !== 'function' || tournamentId == null) return;
        playWelcome(tournamentId, () => fetchLine(tournamentId));
    }, [active, lineReady, playWelcome, fetchLine, tournamentId]);

    if (!active) return null;
    const players = (tournament.entries || []).filter(entry => !OUT.has(entry.status)).length;
    const tables = (tournament.tables || []).length;
    const favorites = Array.isArray(tournament.favorites) ? tournament.favorites : [];
    return (
        <div className="tournament-welcome-card" role="status" aria-live="polite">
            <p className="tournament-welcome-eyebrow">Tournament #{tournament.id}</p>
            <h2 className="tournament-welcome-name">{tournament.name}</h2>
            <p className="tournament-welcome-field">
                {players} players{tables > 1 ? ` · ${tables} tables` : ''}
            </p>
            {favorites.length > 0 && (
                <p className="tournament-welcome-favorites">
                    <span className="tournament-welcome-label">Tonight's favorite{favorites.length > 1 ? 's' : ''}</span>
                    {favorites.map(name => <span key={name} className="tournament-welcome-favorite">★ {name}</span>)}
                </p>
            )}
            <p className="tournament-welcome-countdown">
                {Number.isFinite(dealIn) && dealIn > 0 ? `Cards fly in ${dealIn} s` : 'Cards fly…'}
            </p>
        </div>
    );
};

export default TournamentWelcomeCard;
