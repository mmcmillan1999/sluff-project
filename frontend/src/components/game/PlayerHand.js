// frontend/src/components/game/PlayerHand.js

import React, { useState, useEffect, useCallback, useRef } from 'react';
import './PlayerHand.css';
import { RANKS_ORDER, SUIT_SORT_ORDER } from '../../constants';
import { getLegalMoves } from '../../utils/legalMoves';
import CardPhysicsEngine from '../../utils/CardPhysicsEngine';

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
    const physicsEngineRef = useRef(null);
    const [usePhysics] = useState(true); // Feature flag for physics

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
    
    // Use ref for drag state to avoid stale closures
    const dragStateRef = useRef(dragState);
    dragStateRef.current = dragState;

    const { state, hands, bidWinnerInfo, trickTurnPlayerName, currentTrickCards, leadSuitCurrentTrick, trumpSuit, trumpBroken } = currentTableState;
    const myHand = hands[selfPlayerName] || [];
    
    // Initialize physics engine
    useEffect(() => {
        if (usePhysics) {
            physicsEngineRef.current = new CardPhysicsEngine();
        }
        return () => {
            if (physicsEngineRef.current) {
                physicsEngineRef.current.cancelAll();
            }
        };
    }, [usePhysics]);

    useEffect(() => {
        const calculateLayout = () => {
            if (!myHandRef.current || myHand.length === 0) return;
            const CARD_WIDTH = 65;
            const containerWidth = myHandRef.current.offsetWidth;
            const totalCardWidth = myHand.length * CARD_WIDTH;
            if (totalCardWidth > containerWidth) {
                const overlap = (totalCardWidth - containerWidth) / (myHand.length - 1);
                // Add extra 1pt reduction when 7+ cards to prevent overflow
                const extraReduction = myHand.length >= 7 ? 1 : 0;
                setCardMargin(-(overlap + extraReduction));
            } else {
                setCardMargin(10);
            }
        };
        calculateLayout();
        window.addEventListener('resize', calculateLayout);
        return () => window.removeEventListener('resize', calculateLayout);
    }, [myHand.length]);


    const handleDragStart = (e, card) => {
        // CRITICAL FIX: Stop event propagation
        e.stopPropagation();
        
        // CRITICAL FIX: Disable body scrolling during drag
        document.body.style.overflow = 'hidden';
        document.body.style.touchAction = 'none';
        
        const cardElement = e.currentTarget;
        const rect = cardElement.getBoundingClientRect();
        const initialX = e.clientX || (e.touches && e.touches[0].clientX);
        const initialY = e.clientY || (e.touches && e.touches[0].clientY);
        
        if (usePhysics && physicsEngineRef.current) {
            // CRITICAL FIX: Set React state BEFORE starting physics to ensure synchronization
            setDragState({
                isDragging: true,
                draggedCard: card,
                startX: initialX,
                startY: initialY,
                isInDropZone: false,
            });
            
            // Use physics engine for drag
            const touchPoint = { x: initialX, y: initialY };
            const cardCenter = {
                x: rect.left + rect.width / 2,
                y: rect.top + rect.height / 2
            };
            
            // Grab card immediately
            physicsEngineRef.current.grabCard(card, touchPoint, cardElement, cardCenter);
        } else {
            // Original drag logic
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
        }
        
        // CRITICAL FIX: Add event listeners with proper options
        document.addEventListener('mousemove', handleDragMove, { passive: false });
        document.addEventListener('mouseup', handleDragEnd, { passive: false });
        document.addEventListener('touchmove', handleDragMove, { passive: false });
        document.addEventListener('touchend', handleDragEnd, { passive: false });
    };

    const handleDragMove = useCallback((e) => {
        // CRITICAL FIX: Prevent default behavior to stop scrolling
        e.preventDefault();
        
        const currentX = e.clientX || (e.touches && e.touches[0].clientX);
        const currentY = e.clientY || (e.touches && e.touches[0].clientY);
        
        
        if (usePhysics && physicsEngineRef.current && dragStateRef.current.isDragging) {
            // CRITICAL FIX: Update physics engine immediately
            physicsEngineRef.current.dragCard(dragStateRef.current.draggedCard, { x: currentX, y: currentY });
            
            // Update React state to track drop zone
            const dropZone = dropZoneRef.current;
            if (dropZone) {
                const visualTarget = dropZone.firstChild;
                const zoneRect = dropZone.getBoundingClientRect();
                const isInDropZone = currentX > zoneRect.left && currentX < zoneRect.right && 
                    currentY > zoneRect.top && currentY < zoneRect.bottom;
                
                if (isInDropZone) {
                    visualTarget.style.opacity = '1';
                    visualTarget.style.boxShadow = `0 0 40px 15px rgba(139, 195, 247, 0.9)`;
                    
                    // Update React state for drop zone feedback
                    setDragState(prev => ({ ...prev, isInDropZone: true }));
                } else {
                    visualTarget.style.opacity = '0';
                    visualTarget.style.boxShadow = 'none';
                    
                    // Update React state
                    setDragState(prev => ({ ...prev, isInDropZone: false }));
                }
            }
            return;
        }
        
        // Original drag logic
        setDragState(prev => {
            if (!dragStateRef.current.isDragging) return prev;
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
    }, [dropZoneRef, usePhysics]);

    const handleDragEnd = useCallback(() => {
        // CRITICAL FIX: Re-enable body scrolling after drag
        document.body.style.overflow = '';
        document.body.style.touchAction = '';
        
        if (dropZoneRef.current) {
            const visualTarget = dropZoneRef.current.firstChild;
            visualTarget.style.opacity = '0';
            visualTarget.style.boxShadow = 'none';
        }
        
        if (usePhysics && physicsEngineRef.current && dragStateRef.current.isDragging) {
            // Get drop zone center for physics calculation
            const dropZoneRect = dropZoneRef.current?.getBoundingClientRect();
            const dropZoneCenter = dropZoneRect ? {
                x: dropZoneRect.left + dropZoneRect.width / 2,
                y: dropZoneRect.top + dropZoneRect.height / 2
            } : null;
            
            // Store card ID before clearing state
            const cardToPlay = dragStateRef.current.draggedCard;
            
            // Release card with physics
            physicsEngineRef.current.releaseCard(
                cardToPlay,
                dropZoneCenter,
                (success) => {
                    if (success) {
                        console.log('Emitting playCard event for:', cardToPlay);
                        emitEvent("playCard", { card: cardToPlay });
                    } else {
                        console.log('Card play failed for:', cardToPlay);
                    }
                }
            );
            
            setDragState({ isDragging: false, draggedCard: null, isInDropZone: false });
        } else {
            // Original logic
            setDragState(prev => {
                if (prev.isInDropZone) {
                    emitEvent("playCard", { card: prev.draggedCard });
                }
                return { isDragging: false, draggedCard: null, translateX: 0, translateY: 0, offsetX: 0, offsetY: 0, startX: 0, startY: 0, isInDropZone: false };
            });
        }
        
        // CRITICAL FIX: Remove event listeners with same options as when added
        document.removeEventListener('mousemove', handleDragMove, { passive: false });
        document.removeEventListener('mouseup', handleDragEnd, { passive: false });
        document.removeEventListener('touchmove', handleDragMove, { passive: false });
        document.removeEventListener('touchend', handleDragEnd, { passive: false });
    }, [emitEvent, dropZoneRef, handleDragMove, usePhysics]);

    useEffect(() => {
        if (state !== "Frog Widow Exchange") setSelectedDiscards([]);
    }, [state]);
    
    // Cleanup touch listeners on unmount
    useEffect(() => {
        return () => {
            // Clean up any touch event listeners
            document.querySelectorAll('.player-hand-card-wrapper').forEach(el => {
                if (el._touchHandler) {
                    el.removeEventListener('touchstart', el._touchHandler);
                }
            });
        };
    }, []);
    
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
                    
                    // CRITICAL FIX: Don't apply React transforms when physics is controlling the element
                    const isPhysicsControlled = usePhysics && isBeingDragged;
                    const dynamicStyle = {
                        zIndex: isBeingDragged ? 2000 : index,
                        transform: (isBeingDragged && !usePhysics) ? `translate(${dragState.translateX}px, ${dragState.translateY}px) scale(1.1)` : 
                                  isPhysicsControlled ? 'none' : 'none', // Let physics engine handle transforms
                        transition: isPhysicsControlled ? 'none' : undefined // Disable transitions during physics
                    };

                    return (
                        <div
                            id={`card-${card}`}
                            key={card}
                            className={`player-hand-card-wrapper ${isBeingDragged ? 'is-dragging' : ''}`}
                            style={dynamicStyle}
                            onMouseDown={(e) => isLegal && handleDragStart(e, card)}
                            ref={(el) => {
                                if (el && isLegal) {
                                    // Remove old listener if it exists
                                    el.removeEventListener('touchstart', el._touchHandler);
                                    
                                    // Create new handler
                                    el._touchHandler = (e) => {
                                        e.preventDefault();
                                        handleDragStart(e, card);
                                    };
                                    
                                    // Add non-passive listener
                                    el.addEventListener('touchstart', el._touchHandler, { passive: false });
                                }
                            }}
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