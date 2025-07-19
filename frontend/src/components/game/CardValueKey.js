import React, { useState } from 'react';
import { CARD_POINT_VALUES } from '../../constants';
import './KeyAndModal.css';

/**
 * A static UI component to display the point values of cards.
 */
const CardValueKey = () => {
    const [expanded, setExpanded] = useState(false);
    // Sort the cards by point value for a logical display
    const sortedCards = Object.entries(CARD_POINT_VALUES).sort(([, a], [, b]) => b - a);

    return (
        <div
            className="card-value-key-container"
            onClick={() => setExpanded(!expanded)}
        >
            <h4 className="card-value-key-title">
                Card Points {expanded ? '▲' : '▼'}
            </h4>
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