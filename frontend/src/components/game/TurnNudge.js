// frontend/src/components/game/TurnNudge.js
import React from 'react';
import { createPortal } from 'react-dom';
import './TurnNudge.css';

const ANNOUNCEMENTS = {
    play: 'Your turn to play a card.',
    bid: 'Your turn to bid.',
    frogUpgrade: 'Your decision: upgrade Frog to Heart Solo?',
    trump: 'Your turn to choose trump.',
    frogDiscard: 'Your turn to return three cards to the widow.'
};

/**
 * The peripheral half of the call-up. A rim light rides the viewport edge so
 * it lands in peripheral vision without covering a single pixel of table
 * information — the player who is slow because they are *thinking* still gets
 * to study the trick. The pointed cues (beacon, card wave, prompt glow) live
 * on whichever surface owns the decision.
 *
 * The live region renders at every level so screen readers see a text change
 * rather than a node insertion, which they announce far more reliably.
 */
const TurnNudge = ({ level = 0, kind, team }) => {
    const classes = [
        'turn-nudge-rim',
        team ? `turn-nudge-rim--${team}` : '',
        level >= 2 ? 'turn-nudge-rim--urgent' : ''
    ].filter(Boolean).join(' ');

    // The rim is portalled to <body> so a transformed ancestor can never turn
    // its position:fixed into position:absolute, and so it layers against the
    // root stacking order rather than the felt's.
    const rim = level > 0 && typeof document !== 'undefined'
        ? createPortal(<div className={classes} aria-hidden="true" />, document.body, 'turn-nudge-rim')
        : null;

    return (
        <>
            {rim}
            <p className="turn-nudge-announcement" role="status" aria-live="polite">
                {level > 0 ? (ANNOUNCEMENTS[kind] || 'Your turn.') : ''}
            </p>
        </>
    );
};

/**
 * The pointed half: a tab that sits in the gutter above the player's hand and
 * points down at it. This is the only place in the app that ever says the
 * words "your move" — the table has always announced whose turn it is by
 * omission ("Brandi is bidding…") and never by naming yours.
 */
export const TurnBeacon = ({ level = 0, countdown = null }) => {
    if (!level) return null;
    // The countdown appears only near the deadline: a full-window number reads
    // as a shot clock, which is more pressure than a nudge should apply. Near
    // zero it flips to warning the player what is about to happen, because an
    // auto-play that was never announced reads as the game moving your cards.
    const showCountdown = Number.isFinite(countdown) && countdown <= 20;
    return (
        <span
            className={`turn-nudge-beacon ${level >= 2 ? 'turn-nudge-beacon--urgent' : ''}`}
            aria-hidden="true"
        >
            {showCountdown ? `Your move · ${Math.max(countdown, 0)}s` : 'Your move'}
        </span>
    );
};

export default TurnNudge;
