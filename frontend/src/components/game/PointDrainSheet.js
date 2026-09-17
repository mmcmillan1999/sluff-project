// frontend/src/components/game/PointDrainSheet.js
//
// Where a player proposes a point drain to the table (game menu → "Speed up
// the game"). Picking here only PROPOSES: every seat then has thirty seconds
// to agree (PointDrainVote). The choices and the recommendation come from the
// server's state, so the two can never drift apart.

import React, { useEffect, useState } from 'react';
import { formatPercent } from './PointDrainVote';
import './PointDrainVote.css';

const FALLBACK_OPTIONS = [5, 7.5, 10, 15, 20];

// Measured on simulated games (Sept 2026): the drain barely touches a short
// game and cuts the long ones hard — at 10% a fifteen-round game ends in nine.
const NOTES = { 5: 'Gentle', 15: 'Fast', 20: 'Fastest' };

const PointDrainSheet = ({ show, pointDrain, onPropose, onClose }) => {
    const options = pointDrain?.options?.length ? pointDrain.options : FALLBACK_OPTIONS;
    const recommended = pointDrain?.recommended ?? 10;
    const current = Number(pointDrain?.percent) || 0;
    const firstChoice = current === recommended ? null : recommended;
    const [choice, setChoice] = useState(firstChoice);

    useEffect(() => {
        if (show) setChoice(firstChoice);
    }, [show, firstChoice]);

    useEffect(() => {
        if (!show) return undefined;
        const onKey = (event) => { if (event.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [show, onClose]);

    if (!show) return null;

    const noteFor = (percent) => {
        if (percent === current) return { text: 'Playing now', className: '' };
        if (percent === recommended) return { text: 'Recommended', className: ' point-drain-option-note--recommended' };
        return { text: NOTES[percent] || '', className: '' };
    };

    return (
        <div className="point-drain-sheet-overlay" onClick={onClose}>
            <div
                className="point-drain-sheet"
                role="dialog"
                aria-modal="true"
                aria-labelledby="point-drain-sheet-title"
                onClick={event => event.stopPropagation()}
            >
                <h3 id="point-drain-sheet-title">Speed up the game</h3>
                <p className="point-drain-sheet-copy">
                    After every round, every score drops by the percentage the table agrees on, so the game
                    ends sooner — the long ones most of all. Nobody can lose their last point this way.
                    {current > 0 ? ` The table is playing at ${formatPercent(current)} now.` : ''}
                </p>
                <div className="point-drain-options" role="radiogroup" aria-label="Score drop after each round">
                    {options.map((percent) => {
                        const note = noteFor(percent);
                        return (
                            <button
                                key={percent}
                                type="button"
                                role="radio"
                                aria-checked={choice === percent}
                                disabled={percent === current}
                                className="point-drain-option"
                                onClick={() => setChoice(percent)}
                            >
                                <span>{formatPercent(percent)} a round</span>
                                <span className={`point-drain-option-note${note.className}`}>{note.text}</span>
                            </button>
                        );
                    })}
                    {current > 0 && (
                        <button
                            type="button"
                            role="radio"
                            aria-checked={choice === 0}
                            className="point-drain-option"
                            onClick={() => setChoice(0)}
                        >
                            <span>Stop dropping scores</span>
                            <span className="point-drain-option-note">Back to normal</span>
                        </button>
                    )}
                </div>
                <p className="point-drain-sheet-copy">Everyone at the table has to agree. The game keeps going while they decide.</p>
                <div className="point-drain-sheet-actions">
                    <button type="button" className="point-drain-btn point-drain-btn--no" onClick={onClose}>CANCEL</button>
                    <button
                        type="button"
                        className="point-drain-btn point-drain-btn--propose"
                        disabled={choice === null}
                        onClick={() => onPropose(choice)}
                    >
                        ASK THE TABLE
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PointDrainSheet;
