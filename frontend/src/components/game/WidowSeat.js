// WidowSeat.js
// Widow seat component that follows same conventions as PlayerSeat
import React from 'react';
import './WidowSeat.css';

const WidowSeat = ({ 
    currentTableState,
    renderCard,
    seatPosition = 'top',
    // Accept all the same props as PlayerSeat for consistency
    playerName,
    isSelf,
    emitEvent,
    showTrumpIndicator,
    trumpIndicatorPuck
}) => {
    const { widowCards } = currentTableState;
    
    // Note: Visibility checks are now handled in TableLayout.js
    // This component just renders when called
    
    return (
        <div className="player-seat-wrapper">
            <div className="widow-seat-container">
                <div className="widow-seat-plate">
                    <div className="widow-name-row">
                        <div className="widow-name">WIDOW</div>
                    </div>
                    
                    {/* Widow cards display */}
                    {widowCards && widowCards.length > 0 && (
                        <div className="widow-cards-container">
                            {widowCards.map((card, index) => (
                                <div key={index} className="widow-card">
                                    {renderCard ? renderCard(card, index, 'widow') : (
                                        <div className="widow-card-placeholder">{card}</div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default WidowSeat;