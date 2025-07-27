// frontend/src/components/game/PlayerHand.js

import React, { useState, useEffect, useCallback, useRef } from 'react';
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
    renderCard,
    dropZoneRef
}) => {
    const [selectedDiscards, setSelectedDiscards] = useState([]);
    const myHandRef = useRef(null);
    const [cardMargin, setCardMargin] = useState(-25);

    const [dragState, setDragState] = useState({
        isDragging: false,
        draggedCard: null,
        offsetX: 0,
        offsetY: 0,
        startX: 0,
        startY: 0,
        translateX: 0,
        translateY: 0,
        isInDropZone: false,
    });

    const { state, hands, bidWinnerInfo, trickTurnPlayerName, currentTrickCards, leadSuitCurrentTrick, trumpSuit, trumpBroken } = currentTableState;
    const myHand = hands[selfPlayerName] || [];

    useEffect(() => {
        const calculateLayout = () => {
            if (!myHandRef.current || myHand.length === 0) return;
            const CARD_WIDTH = 65;
            const containerWidth = myHandRef.current.offsetWidth;
            const totalCardWidth = myHand.length * CARD_WIDTH;
            if (totalCardWidth > containerWidth) {
                const overlap = (totalCardWidth - containerWidth) / (myHand.length - 1);
                setCardMargin(-overlap);
            } else {
                setCardMargin(10);
            }
        };
        calculateLayout();
        window.addEventListener('resize', calculateLayout);
        return () => window.removeEventListener('resize', calculateLayout);
    }, [myHand.length]);


    const handleDragStart = (e, card) => {
        const cardElement = e.currentTarget;
        const rect = cardElement.getBoundingClientRect();
        const initialX = e.clientX || e.touches[0].clientX;
        const initialY = e.clientY || e.touches[0].clientY;
        const offsetX = initialX - rect.left;
        const offsetY = initialY - rect.top;

        setDragState({
            isDragging: true,
            draggedCard: card,
            startX: initialX,
            startY: initialY,
            offsetX,
            offsetY,
            translateX: 0,
            translateY: 0,
            isInDropZone: false,
        });
        document.addEventListener('mousemove', handleDragMove);
        document.addEventListener('mouseup', handleDragEnd);
        document.addEventListener('touchmove', handleDragMove);
        document.addEventListener('touchend', handleDragEnd);
    };

    const handleDragMove = useCallback((e) => {
        setDragState(prev => {
            if (!prev.isDragging) return prev;
            const currentX = e.clientX || e.touches[0].clientX;
            const currentY = e.clientY || e.touches[0].clientY;
            const newTranslateX = currentX - prev.startX;
            const newTranslateY = currentY - prev.startY;

            let newIsInDropZone = false;
            if (dropZoneRef.current) {
                const dropZone = dropZoneRef.current;
                const visualTarget = dropZone.firstChild;
                const zoneRect = dropZone.getBoundingClientRect();
                if (currentX > zoneRect.left && currentX < zoneRect.right && currentY > zoneRect.top && currentY < zoneRect.bottom) {
                    newIsInDropZone = true;
                    if (!prev.isInDropZone && navigator.vibrate) navigator.vibrate(50);
                    visualTarget.style.opacity = '1';
                    visualTarget.style.boxShadow = `0 0 40px 15px rgba(139, 195, 247, 0.9)`;
                } else {
                    const centerX = zoneRect.left + zoneRect.width / 2;
                    const centerY = zoneRect.top + zoneRect.height / 2;
                    const distance = Math.sqrt(Math.pow(centerX - currentX, 2) + Math.pow(centerY - currentY, 2));
                    const maxDistance = 400;
                    const proximity = Math.max(0, 1 - distance / maxDistance);
                    visualTarget.style.opacity = `${0.2 + (proximity * 0.8)}`;
                    visualTarget.style.boxShadow = `0 0 ${10 + (proximity * 30)}px ${5 + (proximity * 10)}px rgba(139, 195, 247, ${0.4 + (proximity * 0.5)})`;
                }
            }
            return { ...prev, translateX: newTranslateX, translateY: newTranslateY, isInDropZone: newIsInDropZone };
        });
    }, [dropZoneRef]);

    const handleDragEnd = useCallback(() => {
        if (dropZoneRef.current) {
            const visualTarget = dropZoneRef.current.firstChild;
            visualTarget.style.opacity = '0';
            visualTarget.style.boxShadow = 'none';
        }
        setDragState(prev => {
            if (prev.isInDropZone) {
                emitEvent("playCard", { card: prev.draggedCard });
            }
            return { isDragging: false, draggedCard: null, translateX: 0, translateY: 0, offsetX: 0, offsetY: 0, startX: 0, startY: 0, isInDropZone: false };
        });
        document.removeEventListener('mousemove', handleDragMove);
        document.removeEventListener('mouseup', handleDragEnd);
        document.removeEventListener('touchmove', handleDragMove);
        document.removeEventListener('touchend', handleDragEnd);
    }, [emitEvent, dropZoneRef]);

    useEffect(() => {
        if (state !== "Frog Widow Exchange") setSelectedDiscards([]);
    }, [state]);
    
    const handleSelectDiscard = (card) => {
        setSelectedDiscards(prev => {
            if (prev.includes(card)) return prev.filter(c => c !== card);
            if (prev.length < 3) return [...prev, card];
            return prev;
        });
    };
    const handleSubmitDiscards = () => {
        if (selectedDiscards.length === 3) {
            emitEvent("submitFrogDiscards", { discards: selectedDiscards });
        }
    };

    if (isSpectator || !myHand.length) {
        return <div className="player-hand-container"></div>;
    }
    
    if (state === "Frog Widow Exchange" && bidWinnerInfo?.playerName === selfPlayerName) {
        return (
             <div className="player-hand-container" style={{ flexDirection: 'column' }}>
                <div className="player-hand-cards is-discarding">
                    {sortHandBySuit(myHand).map((card) => (
                        <div key={card} className="player-hand-card-wrapper-static">
                            {renderCard(card, {
                                isButton: true,
                                onClick: () => handleSelectDiscard(card),
                                large: true,
                                isSelected: selectedDiscards.includes(card)
                            })}
                        </div>
                    ))}
                </div>
                <button
                    onClick={handleSubmitDiscards}
                    className="game-button"
                    disabled={selectedDiscards.length !== 3}
                    style={{ marginTop: '10px' }}
                >
                    Submit Discards ({selectedDiscards.length}/3)
                </button>
            </div>
        );
    }
    
    const myHandToDisplay = sortHandBySuit(myHand);
    const isMyTurnToPlay = state === "Playing Phase" && trickTurnPlayerName === selfPlayerName;
    const legalMoves = getLegalMoves(myHand, currentTrickCards.length === 0, leadSuitCurrentTrick, trumpSuit, trumpBroken);

    return (
        <div className="player-hand-container" ref={myHandRef}>
            <div
                className={`player-hand-cards ${isMyTurnToPlay && !dragState.isDragging ? 'my-turn' : ''}`}
                style={{ '--card-margin-left': `${cardMargin}px` }}
            >
                {myHandToDisplay.map((card, index) => {
                    const isLegal = isMyTurnToPlay && legalMoves.includes(card);
                    const isBeingDragged = dragState.isDragging && dragState.draggedCard === card;
                    const isShaded = state === "Playing Phase" && isMyTurnToPlay && !isLegal;
                    
                    const dynamicStyle = {
                        zIndex: isBeingDragged ? 2000 : index,
                        transform: isBeingDragged ? `translate(${dragState.translateX}px, ${dragState.translateY}px) scale(1.1)` : 'none'
                    };

                    return (
                        <div
                            id={`card-${card}`}
                            key={card}
                            className={`player-hand-card-wrapper ${isBeingDragged ? 'is-dragging' : ''}`}
                            style={dynamicStyle}
                            onMouseDown={(e) => isLegal && handleDragStart(e, card)}
                            onTouchStart={(e) => isLegal && handleDragStart(e, card)}
                        >
                            {renderCard(card, {
                                large: true,
                                className: isShaded ? 'illegal-move' : ''
                            })}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default PlayerHand;