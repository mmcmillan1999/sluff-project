import React, { useState, useEffect, useCallback } from 'react';
import { RANKS_ORDER, SUIT_SORT_ORDER } from '../../constants';

// Helper function for card sorting
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

    const { state, hands, bidWinnerInfo, revealedWidowForFrog } = currentTableState;
    const myHand = hands[selfPlayerName] || [];

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
        return (
            <div style={{ backgroundColor: 'rgba(0,0,0,0.7)', padding: '15px', borderRadius: '10px', width: '100%', textAlign: 'center' }}>
                <p style={{color: 'white'}}>You took the widow. Select 3 cards from your hand to discard:</p>
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
    const isMyTurnToPlay = state === "Playing Phase" && currentTableState.trickTurnPlayerName === selfPlayerName;

    return (
        <div style={{ flexGrow: 1, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            {/* --- MODIFICATION: Added a className for responsive styling --- */}
            <div className="player-hand-cards">
                {myHandToDisplay.map((card, index) => renderCard(card, {
                    key: card,
                    isButton: true,
                    onClick: () => handlePlayCard(card),
                    disabled: !isMyTurnToPlay,
                    style: { animation: `fadeIn 0.5s ease-out forwards`, animationDelay: `${index * 0.05}s`, opacity: 0 }
                }))}
            </div>
        </div>
    );
};

export default PlayerHand;