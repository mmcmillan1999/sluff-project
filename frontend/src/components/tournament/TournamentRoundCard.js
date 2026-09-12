// The ring card. A tournament round opens on the felt in Dealing Pending a
// beat before the cards fly; in that beat the ring girl walks the round
// card across the table — ding ding, ROUND N held overhead, gone as the
// deal starts. From round two the server holds the deal a few seconds longer and
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
    // () => true while an announcer line is still playing.
    announcerBusy = null,
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
        // Round one waits for the welcome to finish: the card walks on for
        // the last few seconds of the hold, and not while Liam is still
        // talking — though never later than the last second before the deal.
        if (round === 1 && welcome && Number.isFinite(dealIn)) {
            if (dealIn > ROUND_ONE_LEAD_S) return;
            if (dealIn > 1 && typeof announcerBusy === 'function' && announcerBusy()) return;
        }
        shownRef.current = key;
        setShowing(key);
        if (call && typeof playRoundCall === 'function') playRoundCall(key, () => fetchLine(tournamentId));
        else if (typeof playRoundBell === 'function') playRoundBell();
    }, [key, pending, round, welcome, dealIn, call, playRoundCall, playRoundBell, fetchLine, tournamentId, announcerBusy]);

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
            <svg className="ring-card-art" viewBox="0 0 320 620" aria-hidden="true">
                {/* The ring girl: hair behind the head first, then the legs
                    (two strides the stylesheet swaps as she walks), the
                    dress, the head, the arms up to the card, the placard,
                    and last her hands over its edge. */}
                <path d="M116 322 C108 268 212 268 204 322 C208 356 198 396 186 408 L134 408 C122 396 112 356 116 322 Z" fill="#2a1a12" />
                <g className="ring-girl-stride ring-girl-stride--a">
                    <path d="M150 500 L140 588" stroke="#e8b48a" strokeWidth="22" strokeLinecap="round" />
                    <path d="M172 500 L188 584" stroke="#d99f74" strokeWidth="22" strokeLinecap="round" />
                    <path d="M124 594 L154 592 L150 606 L132 608 Z" fill="#c8102e" stroke="#1a1a1a" strokeWidth="3" strokeLinejoin="round" />
                    <path d="M176 588 L206 586 L204 600 L184 602 Z" fill="#c8102e" stroke="#1a1a1a" strokeWidth="3" strokeLinejoin="round" />
                </g>
                <g className="ring-girl-stride ring-girl-stride--b">
                    <path d="M150 500 L134 584" stroke="#d99f74" strokeWidth="22" strokeLinecap="round" />
                    <path d="M172 500 L180 588" stroke="#e8b48a" strokeWidth="22" strokeLinecap="round" />
                    <path d="M118 588 L148 586 L146 600 L126 602 Z" fill="#c8102e" stroke="#1a1a1a" strokeWidth="3" strokeLinejoin="round" />
                    <path d="M166 594 L196 592 L194 606 L174 608 Z" fill="#c8102e" stroke="#1a1a1a" strokeWidth="3" strokeLinejoin="round" />
                </g>
                <path d="M126 374 Q160 394 194 374 L198 404 Q186 430 182 436 L196 464 L208 506 L112 506 L124 464 L138 436 Q134 430 122 404 Z" fill="#c8102e" stroke="#1a1a1a" strokeWidth="4" strokeLinejoin="round" />
                <path d="M152 384 Q142 440 130 500" stroke="#ff5d70" strokeWidth="6" strokeLinecap="round" opacity="0.55" fill="none" />
                <rect x="150" y="350" width="20" height="28" rx="8" fill="#e8b48a" />
                <circle cx="160" cy="330" r="27" fill="#e8b48a" stroke="#1a1a1a" strokeWidth="4" />
                <path d="M132 322 C136 290 186 286 192 318 C176 306 148 306 132 322 Z" fill="#2a1a12" />
                <path d="M150 343 Q160 351 170 343" stroke="#c8102e" strokeWidth="3.5" strokeLinecap="round" fill="none" />
                <path d="M138 380 L104 324 L70 294" stroke="#e8b48a" strokeWidth="16" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                <path d="M182 380 L216 324 L250 294" stroke="#e8b48a" strokeWidth="16" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                {/* The placard. */}
                <rect x="40" y="26" width="240" height="266" rx="10" fill="#fbf7ea" stroke="#1a1a1a" strokeWidth="6" />
                <rect x="56" y="42" width="208" height="234" rx="5" fill="none" stroke="#c8102e" strokeWidth="4" />
                <text x="160" y="112" textAnchor="middle" className="ring-card-word">ROUND</text>
                <text x="160" y="248" textAnchor="middle" className="ring-card-number">{round}</text>
                <circle cx="68" cy="291" r="10" fill="#e8b48a" stroke="#1a1a1a" strokeWidth="3" />
                <circle cx="252" cy="291" r="10" fill="#e8b48a" stroke="#1a1a1a" strokeWidth="3" />
            </svg>
        </div>
    );
};

export default TournamentRoundCard;
