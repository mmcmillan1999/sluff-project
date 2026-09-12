// The ring card. A tournament round opens on the felt in Dealing Pending a
// beat before the cards fly; in that beat a boxing round card walks across
// the table — ding ding, ROUND N held up on a placard, gone as the deal
// starts. From round two the server holds the deal a few seconds longer and
// Liam calls the round over the card ("It's round seven, ladies and
// gentlemen, and there are thirteen players remaining with chips"); the
// card stays up for the whole call. One card per round: an all-pass redeal
// reopens the same round and gets no card. Round one's card comes at the
// end of the welcome hold, a few seconds before the first deal.
import React, { useEffect, useRef, useState } from 'react';
import { useCountdown } from './useCountdown';
import { fetchTournamentRoundCall } from '../../services/api';
import './tournament.css';

export const RING_CARD_MS = 2400;
// Round one: seconds before the first deal that the card walks on.
export const ROUND_ONE_LEAD_S = 3;

const TournamentRoundCard = ({
    tableTournament,
    tableState,
    welcome = null,
    roundCall = null,
    playRoundBell = null,
    playRoundCall = null,
    fetchLine = fetchTournamentRoundCall,
    hold = false,
}) => {
    const round = Number(tableTournament?.roundNumber) || 0;
    const tournamentId = tableTournament?.tournamentId ?? null;
    const key = tournamentId != null && round > 0 ? `${tournamentId}:${round}` : null;
    const pending = tableState === 'Dealing Pending';
    const dealIn = useCountdown(welcome?.dealInSeconds ?? null);
    // The round call belongs to this round only; a stale one is ignored.
    const call = roundCall && Number(roundCall.round) === round ? roundCall : null;
    const lineReady = Boolean(call?.audio);
    const holdMs = call ? Math.max(RING_CARD_MS, (Number(call.dealInSeconds) || 0) * 1000) : RING_CARD_MS;
    const [showing, setShowing] = useState(null);
    const shownRef = useRef(null);

    // Walk on once per round: the bell, or the bell and Liam's call.
    useEffect(() => {
        if (!key || !pending || shownRef.current === key) return;
        // Round one waits for the welcome to finish; the card walks on for
        // the last few seconds of the hold.
        if (round === 1 && welcome && Number.isFinite(dealIn) && dealIn > ROUND_ONE_LEAD_S) return;
        shownRef.current = key;
        setShowing(key);
        if (call && typeof playRoundCall === 'function') playRoundCall(key, () => fetchLine(tournamentId));
        else if (typeof playRoundBell === 'function') playRoundBell();
    }, [key, pending, round, welcome, dealIn, call, playRoundCall, playRoundBell, fetchLine, tournamentId]);

    // Liam's line lands when the server says it is ready; the hook plays it once.
    useEffect(() => {
        if (!showing || !call || !lineReady || typeof playRoundCall !== 'function') return;
        playRoundCall(key, () => fetchLine(tournamentId));
    }, [showing, call, lineReady, key, playRoundCall, fetchLine, tournamentId]);

    // Off again as the cards fly, or when the hold runs out.
    useEffect(() => {
        if (showing && !pending && !hold) setShowing(null);
    }, [showing, pending, hold]);
    useEffect(() => {
        if (!showing || hold) return undefined;
        const timer = setTimeout(() => setShowing(null), holdMs);
        return () => clearTimeout(timer);
    }, [showing, hold, holdMs]);

    if (!showing) return null;
    return (
        <div
            className={`ring-card${hold ? ' is-held' : ''}`}
            style={{ animationDuration: `${holdMs}ms` }}
            role="status"
            aria-live="polite"
            aria-label={`Round ${round}`}
        >
            <svg className="ring-card-art" viewBox="0 0 320 440" aria-hidden="true">
                {/* The arm and the glove, from below the felt's edge. */}
                <rect x="138" y="352" width="44" height="100" rx="18" fill="#e9b892" />
                <rect x="126" y="338" width="68" height="26" rx="9" fill="#f6f2e8" stroke="#1a1a1a" strokeWidth="4" />
                <ellipse cx="160" cy="312" rx="56" ry="44" fill="#c8102e" stroke="#1a1a1a" strokeWidth="5" />
                <ellipse cx="207" cy="292" rx="19" ry="24" fill="#c8102e" stroke="#1a1a1a" strokeWidth="5" />
                <ellipse cx="141" cy="298" rx="16" ry="10" fill="#ff5d70" opacity="0.75" />
                {/* The placard. */}
                <rect x="40" y="26" width="240" height="266" rx="10" fill="#fbf7ea" stroke="#1a1a1a" strokeWidth="6" />
                <rect x="56" y="42" width="208" height="234" rx="5" fill="none" stroke="#c8102e" strokeWidth="4" />
                <text x="160" y="112" textAnchor="middle" className="ring-card-word">ROUND</text>
                <text x="160" y="248" textAnchor="middle" className="ring-card-number">{round}</text>
            </svg>
        </div>
    );
};

export default TournamentRoundCard;
