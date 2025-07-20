// frontend/src/components/game/PlayerHand.js

import React, { useState, useEffect, useCallback } from 'react';
import './PlayerHand.css';
import { RANKS_ORDER, SUIT_SORT_ORDER } from '../../constants';
import { getLegalMoves } from '../../utils/legalMoves'; // We'll create this new utility file

const getSuitLocal = (cardStr) => cardStr.slice(-1);
const getRankLocal = (cardStr) => cardStr.slice(0, -1);

const sortHandBySuit = (handArray) => {
    if (!handArray) return [];
    return [...handArray].sort((a, b) => {
        const suitAIndex = SUIT_SORT_ORDER.indexOf(getSuitLocal(a));
        const suitBIndex = SUIT_SORT_ORDER.indexOf(getSuitLocal(b));
        const rankAIndex = RANKS_ORDER.indexOf(getRankLocal(a));
        const rankBIndex = RANKS_ORDER.indexOf(getRankLocal(b));
        if (suitAIndex !== suitBIndex) return suitAIndex - suitBIndex;
        return rankAIndex - rankBIndex;
    });
};

const PlayerHand = ({
    currentTableState,
    selfPlayerName,
    isSpectator,
    emitEvent,
    renderCard
}) => {
    const [selectedDiscards, setSelectedDiscards] = useState([]);
    const [windowWidth, setWindowWidth] = useState(window.innerWidth);

    const { state, hands, bidWinnerInfo, revealedWidowForFrog, trickTurnPlayerName, currentTrickCards, leadSuitCurrentTrick, trumpSuit, trumpBroken } = currentTableState;
    const myHand = hands[selfPlayerName] || [];

    useEffect(() => {
        const handleResize = () => setWindowWidth(window.innerWidth);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    useEffect(() => {
        if (state !== "Frog Widow Exchange") {
            setSelectedDiscards([]);
        }
    }, [state]);

    const handleToggleFrogDiscard = useCallback((card) => {
        setSelectedDiscards(prev =>
            prev.includes(card) ? prev.filter(c => c !== card) : [...prev, card]
        );
    }, []);

    const handlePlayCard = useCallback((card) => {
        emitEvent("playCard", { card });
    }, [emitEvent]);

    if (state === "Frog Widow Exchange" && bidWinnerInfo?.playerName === selfPlayerName) {
        // Frog discard logic remains the same...
        return (
            <div style={{ backgroundColor: 'rgba(0,0,0,0.7)', padding: '15px', borderRadius: '10px', width: '100%', textAlign: 'center' }}>
                <p style={{color: 'white'}}>You took the widow. Select 3 cards to discard:</p>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '5px', marginBottom: '15px', color: 'white' }}>
                    <span>Revealed Widow:</span>
                    {(revealedWidowForFrog || []).map((card, index) => renderCard(card, { key: `widow-${index}` }))}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '5px', maxHeight: '150px', overflowY: 'auto', padding: '10px', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: '5px' }}>
                    {sortHandBySuit(myHand).map(card => renderCard(card, {
                        key: card,
                        isButton: true,
                        onClick: () => handleToggleFrogDiscard(card),
                        isSelected: selectedDiscards.includes(card)
                    }))}
                </div>
                <button
                    onClick={() => emitEvent("submitFrogDiscards", { discards: selectedDiscards })}
                    className="game-button"
                    disabled={selectedDiscards.length !== 3}
                    style={{ marginTop: '10px' }}>
                    Confirm Discards ({selectedDiscards.length}/3)
                </button>
            </div>
        );
    }

    if (isSpectator || !myHand.length) {
        return (
            <div style={{ textAlign: 'center', padding: '20px', fontStyle: 'italic', flex: 1, color: 'white' }}>
                {isSpectator ? "Spectators cannot see player hands." : "Waiting for next hand..."}
            </div>
        );
    }

    const myHandToDisplay = sortHandBySuit(myHand);
    const isMyTurnToPlay = state === "Playing Phase" && trickTurnPlayerName === selfPlayerName;

    // --- NEW: LEGAL MOVES & DYNAMIC SPACING LOGIC ---
    const isLeading = currentTrickCards.length === 0;
    const legalMoves = getLegalMoves(myHand, isLeading, leadSuitCurrentTrick, trumpSuit, trumpBroken);

    const cardWidth = 70; // Base width of a card in pixels
    const handAreaWidth = windowWidth * 0.85; // Use 85% of screen width for the hand
    const N = myHandToDisplay.length;
    let overlap = 0;
    if (N > 1) {
        const totalCardWidth = N * cardWidth;
        if (totalCardWidth > handAreaWidth) {
            overlap = (totalCardWidth - handAreaWidth) / (N - 1);
        }
    }
    // --- END NEW LOGIC ---

    return (
        <div className="player-hand-container">
            <div className={`player-hand-cards ${isMyTurnToPlay ? 'my-turn' : ''}`}>
                {myHandToDisplay.map((card, index) => {
                    const isLegal = legalMoves.includes(card);
                    return (
                        <div key={card} className="player-hand-card-wrapper" style={{ marginLeft: index > 0 ? `-${overlap}px` : 0 }}>
                            {renderCard(card, {
                                isButton: true,
                                onClick: () => handlePlayCard(card),
                                disabled: isMyTurnToPlay ? !isLegal : true, // Disable if not your turn OR not a legal move
                                large: true,
                                className: isMyTurnToPlay && !isLegal ? 'illegal-move' : '' // Pass className for styling illegal cards
                            })}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default PlayerHand;