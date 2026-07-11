import React, { useState } from 'react';
import { CARD_POINT_VALUES } from '../../constants';
import './KeyAndModal.css';

/** Display the canonical card-point values from the shared rules constants. */
const CardValueKey = ({ defaultExpanded = false, embedded = false }) => {
    const [expanded, setExpanded] = useState(defaultExpanded);
    const sortedCards = Object.entries(CARD_POINT_VALUES).sort(([, a], [, b]) => b - a);

    return (
        <div className={`card-value-key-container ${embedded ? 'is-embedded' : ''}`}>
            <button
                type="button"
                className="card-value-key-title"
                onClick={() => setExpanded(value => !value)}
                aria-expanded={expanded}
            >
                Card Points <span aria-hidden="true">{expanded ? '▲' : '▼'}</span>
            </button>
            {expanded && (
                <div className="card-value-key-list">
                    {sortedCards.map(([rank, value]) => (
                        <p key={rank} className="card-value-key-item">
                            <strong>{rank}:</strong> {value} pts
                        </p>
                    ))}
                </div>
            )}
        </div>
    );
};

export default CardValueKey;
