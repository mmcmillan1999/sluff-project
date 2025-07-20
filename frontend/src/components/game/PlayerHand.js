// frontend/src/components/game/PlayerHand.js

import React, { useState, useEffect, useCallback } from 'react';
import './PlayerHand.css';
import { RANKS_ORDER, SUIT_SORT_ORDER } from '../../constants';
import { getLegalMoves } from '../../utils/legalMoves';

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
        // ... (Frog discard logic is unchanged)
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
    
    const isLeading = currentTrickCards.length === 0;
    const legalMoves = getLegalMoves(myHand, isLeading, leadSuitCurrentTrick, trumpSuit, trumpBroken);

    // --- NEW SMARTER OVERLAP LOGIC ---
    const cardWidth = 65;
    const handAreaWidth = windowWidth * 0.95;
    const N = myHandToDisplay.length;

    let finalOverlapLegal;
    let finalOverlapIllegal;

    if (N <= 6) {
        // If 6 or fewer cards, don't overlap them.
        finalOverlapLegal = 0;
        finalOverlapIllegal = 0;
    } else {
        const legalCardCount = isMyTurnToPlay ? legalMoves.length : N;
        const illegalCardCount = N - legalCardCount;
        
        // Define base overlaps
        const legalOverlap = 28;  // Legal cards are less overlapped
        const illegalOverlap = 45; // Illegal cards are more overlapped

        // Calculate the ideal width of the hand with these base overlaps
        const totalWidth = (legalCardCount * (cardWidth - legalOverlap)) + (illegalCardCount * (cardWidth - illegalOverlap)) + (N > 0 ? (legalMoves.includes(myHandToDisplay[0]) ? legalOverlap : illegalOverlap) : 0);

        if (totalWidth > handAreaWidth) {
            // If the hand is still too wide, calculate a reduction factor to make it fit
            const overflow = totalWidth - handAreaWidth;
            const perCardReduction = overflow / (N > 1 ? N - 1 : 1);
            finalOverlapLegal = legalOverlap + perCardReduction;
            finalOverlapIllegal = illegalOverlap + perCardReduction;
        } else {
            // Use the comfortable base overlaps if there's enough space
            finalOverlapLegal = legalOverlap;
            finalOverlapIllegal = illegalOverlap;
        }
    }
    // --- END NEW LOGIC ---

    return (
        <div className="player-hand-container">
            <div className={`player-hand-cards ${isMyTurnToPlay ? 'my-turn' : ''}`}>
                {myHandToDisplay.map((card, index) => {
                    const isIllegal = state === "Playing Phase" && isMyTurnToPlay && !legalMoves.includes(card);
                    const overlapAmount = isIllegal ? finalOverlapIllegal : finalOverlapLegal;

                    return (
                        <div key={card} className="player-hand-card-wrapper" style={{ marginLeft: index > 0 ? `-${overlapAmount}px` : 0 }}>
                            {renderCard(card, {
                                isButton: true,
                                onClick: () => handlePlayCard(card),
                                disabled: !isMyTurnToPlay || isIllegal,
                                large: true,
                                className: isIllegal ? 'illegal-move' : ''
                            })}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default PlayerHand;