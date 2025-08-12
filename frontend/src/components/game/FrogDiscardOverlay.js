// frontend/src/components/game/FrogDiscardOverlay.js
import React from 'react';
import './FrogDiscardOverlay.css';

const FrogDiscardOverlay = ({ 
    isOpen, 
    cards, 
    selectedCards, 
    onSelectCard, 
    onConfirm, 
    renderCard 
}) => {
    if (!isOpen || !cards || cards.length === 0) return null;
    
    return (
        <div className="frog-overlay-backdrop">
            <div className="frog-overlay-container">
                <div className="frog-overlay-header">
                    <h3>Select 3 Cards to Return to Widow</h3>
                    <p>You received 3 cards from the widow. Choose 3 cards to put back.</p>
                </div>
                
                <div className="frog-overlay-cards">
                    {cards.map((card) => (
                        <div 
                            key={card}
                            className={`frog-overlay-card ${selectedCards.includes(card) ? 'selected' : ''}`}
                            onClick={() => onSelectCard(card)}
                        >
                            {renderCard(card, { small: true, responsive: false })}
                            {selectedCards.includes(card) && (
                                <div className="frog-overlay-checkmark">✓</div>
                            )}
                        </div>
                    ))}
                </div>
                
                <div className="frog-overlay-footer">
                    <span className="frog-overlay-count">
                        {selectedCards.length} of 3 cards selected
                    </span>
                    <button 
                        className="frog-overlay-confirm"
                        onClick={onConfirm}
                        disabled={selectedCards.length !== 3}
                    >
                        Confirm Selection
                    </button>
                </div>
            </div>
        </div>
    );
};

export default FrogDiscardOverlay;