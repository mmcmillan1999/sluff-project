// frontend/src/components/game/PlayerHand.js

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import './PlayerHand.css';
import { RANKS_ORDER, SUIT_SORT_ORDER } from '../../constants';
import { getLegalMoves } from '../../utils/legalMoves';
import CardPhysicsEngine from '../../utils/CardPhysicsEngine';
import CardSpacingEngine from '../../utils/CardSpacingEngine';
// import { useViewport } from '../../hooks/useViewport'; // Currently unused

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
    playerId,
    isObserverMode,
    emitEvent,
    renderCard,
    dropZoneRef,
    selectedDiscards,
    onSelectDiscard
}) => {
    // Use local state only if not provided from parent
    const [localSelectedDiscards, setLocalSelectedDiscards] = useState([]);
    const actualSelectedDiscards = selectedDiscards !== undefined ? selectedDiscards : localSelectedDiscards;
    // const actualSetSelectedDiscards = onSelectDiscard || setLocalSelectedDiscards; // Currently unused
    const myHandRef = useRef(null);
    const [cardLayout, setCardLayout] = useState(null);
    const physicsEngineRef = useRef(null);
    const spacingEngineRef = useRef(null);
    const [usePhysics] = useState(true); // Feature flag for physics
    // const { width, orientation } = useViewport(); // Currently unused

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

    const { state, hands, bidWinnerInfo, trickTurnPlayerName, currentTrickCards, leadSuitCurrentTrick, trumpSuit, trumpBroken, players } = currentTableState;
    const myHand = useMemo(() => hands[selfPlayerName] || [], [hands, selfPlayerName]);
    
    // Determine if player is bidder or defender
    const isBidder = bidWinnerInfo?.playerName === selfPlayerName;
    const isDefender = bidWinnerInfo && !isBidder && Object.values(players || {}).some(p => p.playerName === selfPlayerName);
    
    // Initialize engines
    useEffect(() => {
        if (usePhysics) {
            physicsEngineRef.current = new CardPhysicsEngine();
        }
        spacingEngineRef.current = new CardSpacingEngine();
        
        return () => {
            if (physicsEngineRef.current) {
                physicsEngineRef.current.cancelAll();
            }
        };
    }, [usePhysics]);

    // Cleanup effect for invalid/orphaned cards
    useEffect(() => {
        if (!usePhysics || !physicsEngineRef.current) return;
        
        // Check for any cards in physics that are no longer in the hand
        const activeInfo = physicsEngineRef.current.getActiveCardInfo();
        const currentHandSet = new Set(myHand);
        
        Object.keys(activeInfo.cards).forEach(cardId => {
            if (!currentHandSet.has(cardId)) {
                console.warn(`🚨 Removing orphaned card from physics: ${cardId}`);
                physicsEngineRef.current.cleanupCard(cardId);
            }
        });
        
    }, [myHand, usePhysics]);

    // Use CardSpacingEngine for layout calculations
    useEffect(() => {
        const calculateLayout = (isResize = false) => {
            if (!spacingEngineRef.current || myHand.length === 0) return;
            
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            
            // Calculate layout using the spacing engine
            const layout = spacingEngineRef.current.calculateLayout(
                viewportWidth,
                viewportHeight,
                myHand.length
            );
            
            // Store the full layout for use in rendering
            setCardLayout(prevLayout => {
                // Update positions for any active cards in physics engine
                if (usePhysics && physicsEngineRef.current && myHandRef.current) {
                    const sortedHand = sortHandBySuit(myHand);
                    
                    if (isResize) {
                        // Handle window resize case
                        physicsEngineRef.current.handleWindowResize(
                            sortedHand,
                            layout,
                            myHandRef.current
                        );
                        
                        // Debug logging for resize
                        if (process.env.NODE_ENV === 'development') {
                            const activeInfo = physicsEngineRef.current.getActiveCardInfo();
                            console.log('🔄 Window resize detected with active cards:', activeInfo);
                        }
                    } else {
                        // Handle hand content/size changes
                        physicsEngineRef.current.updateAllActiveCardPositions(
                            sortedHand,
                            layout,
                            myHandRef.current
                        );
                        
                        // Debug logging for hand changes
                        if (process.env.NODE_ENV === 'development') {
                            const activeInfo = physicsEngineRef.current.getActiveCardInfo();
                            if (activeInfo.activeCount > 0) {
                                console.log('🃏 Hand layout changed with active cards:', {
                                    ...activeInfo,
                                    handContent: sortedHand,
                                    layoutMode: layout.layout.mode
                                });
                            }
                        }
                    }
                }
                
                return layout;
            });
            
            // Debug logging in development
            if (process.env.NODE_ENV === 'development') {
                spacingEngineRef.current.logDebugInfo(layout);
            }
        };
        
        const handleResize = () => calculateLayout(true);
        
        calculateLayout();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [myHand, usePhysics]);  // Recalculate on any hand change


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
            
            // Get the card's index and container-relative position
            const cardIndex = myHandToDisplay.indexOf(card);
            const cardPosition = cardLayout?.layout.positions[cardIndex];
            const containerRect = myHandRef.current?.getBoundingClientRect();
            
            // Calculate container-relative position for proper return
            const containerRelativePosition = cardPosition && containerRect ? {
                x: cardPosition.left,
                y: 0 // Cards are positioned at top of container
            } : null;
            
            // Grab card with additional context
            physicsEngineRef.current.grabCard(
                card, 
                touchPoint, 
                cardElement, 
                cardCenter,
                {
                    cardIndex,
                    containerRelativePosition,
                    containerElement: myHandRef.current
                }
            );
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
        if (state !== "Frog Widow Exchange") {
            if (onSelectDiscard) {
                // Clear through parent if parent is managing
                // Parent should handle clearing when state changes
            } else {
                setLocalSelectedDiscards([]);
            }
        }
    }, [state, onSelectDiscard]);
    
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
        if (onSelectDiscard) {
            // If parent is managing state, call the parent handler
            onSelectDiscard(card);
        } else {
            // Otherwise use local state
            setLocalSelectedDiscards(prev => {
                if (prev.includes(card)) return prev.filter(c => c !== card);
                if (prev.length < 3) return [...prev, card];
                return prev;
            });
        }
    };

    if (isSpectator || !myHand.length) {
        return <div className="player-hand-container"></div>;
    }
    
    // Only allow the actual bidder (by userId) to perform the discards; observers should not submit
    if (state === "Frog Widow Exchange" && bidWinnerInfo?.userId === playerId) {
        // Two-row layout when holding 14 cards during Frog - no device checks
        const enableTwoRows = myHand?.length >= 14;
        
        if (enableTwoRows) {
            // Split the 14 cards into two rows of 7 each
            const sortedHand = sortHandBySuit(myHand);
            const topRow = sortedHand.slice(0, 7);
            const bottomRow = sortedHand.slice(7, 14);
            
            // Use CardSpacingEngine for each row
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            
            const topLayout = spacingEngineRef.current?.calculateRowLayout(
                viewportWidth, 
                viewportHeight, 
                7
            );
            const bottomLayout = spacingEngineRef.current?.calculateRowLayout(
                viewportWidth,
                viewportHeight,
                7
            );
            
            return (
                <div className="player-hand-container" style={{ position: 'relative' }}>
                    {/* Confirm button - fixed viewport position */}
                    <button
                        className="frog-confirm-button"
                        onClick={() => {
                            if (actualSelectedDiscards.length === 3) {
                                console.log('[Frog] Submitting discards:', actualSelectedDiscards);
                                emitEvent("submitFrogDiscards", { discards: actualSelectedDiscards });
                            }
                        }}
                        disabled={actualSelectedDiscards.length !== 3}
                        data-ready={actualSelectedDiscards.length === 3}
                    >
                        {actualSelectedDiscards.length === 3 
                            ? 'Confirm Discards' 
                            : `Select ${3 - actualSelectedDiscards.length} more`}
                    </button>
                    
                    {/* Top row - positioned 13vh above the normal hand position for better spacing */}
                    <div className="player-hand-cards is-discarding"
                         style={{ 
                             position: 'absolute',
                             bottom: '13vh', // 3vh higher for padding between rows
                             width: '100%',
                             height: `${topLayout?.card.height || 137}px`,
                             display: 'block', // Not flex - we're using absolute positioning
                             paddingLeft: `${topLayout?.container.leftPadding || 0}px`,
                             paddingRight: `${topLayout?.container.rightPadding || 0}px`
                         }}>
                        {topRow.map((card, index) => (
                            <div key={card} 
                                 className="player-hand-card-wrapper-static"
                                 style={{
                                     position: 'absolute',
                                     left: `${topLayout?.layout.positions[index]?.left || 0}px`,
                                     top: '0',
                                     zIndex: index + 1
                                 }}>
                                {renderCard(card, {
                                    isButton: true,
                                    onClick: () => handleSelectDiscard(card),
                                    large: true,
                                    isSelected: actualSelectedDiscards.includes(card)
                                })}
                            </div>
                        ))}
                    </div>
                    
                    {/* Bottom row - in the exact normal hand position */}
                    <div className="player-hand-cards is-discarding"
                         style={{ 
                             position: 'relative',
                             width: '100%',
                             height: `${bottomLayout?.card.height || 137}px`,
                             display: 'block', // Not flex - we're using absolute positioning
                             paddingLeft: `${bottomLayout?.container.leftPadding || 0}px`,
                             paddingRight: `${bottomLayout?.container.rightPadding || 0}px`
                         }}>
                        {bottomRow.map((card, index) => (
                            <div key={card} 
                                 className="player-hand-card-wrapper-static"
                                 style={{
                                     position: 'absolute',
                                     left: `${bottomLayout?.layout.positions[index]?.left || 0}px`,
                                     top: '0',
                                     zIndex: index + 1
                                 }}>
                                {renderCard(card, {
                                    isButton: true,
                                    onClick: () => handleSelectDiscard(card),
                                    large: true,
                                    isSelected: actualSelectedDiscards.includes(card)
                                })}
                            </div>
                        ))}
                    </div>
                </div>
            );
        }
        
        // Single row layout for less than 14 cards (shouldn't happen in Frog, but fallback)
        return (
            <div className="player-hand-container" style={{ flexDirection: 'column' }}>
                <div className="player-hand-cards is-discarding">
                    {sortHandBySuit(myHand).map((card) => (
                        <div key={card} className="player-hand-card-wrapper-static">
                            {renderCard(card, {
                                isButton: true,
                                onClick: () => handleSelectDiscard(card),
                                large: true,
                                isSelected: actualSelectedDiscards.includes(card)
                            })}
                        </div>
                    ))}
                </div>
            </div>
        );
    }
    
    const myHandToDisplay = sortHandBySuit(myHand);
    const isMyTurnToPlay = state === "Playing Phase" && trickTurnPlayerName === selfPlayerName;
    const legalMoves = getLegalMoves(myHand, currentTrickCards.length === 0, leadSuitCurrentTrick, trumpSuit, trumpBroken);

    // Calculate turn indicator bounds
    const getTurnIndicatorStyle = () => {
        if (!cardLayout || !isMyTurnToPlay || dragState.isDragging || myHandToDisplay.length === 0) {
            return { display: 'none' };
        }
        
        const positions = cardLayout.layout.positions;
        const firstCardLeft = positions[0].left;
        const lastCardLeft = positions[positions.length - 1].left;
        const cardWidth = cardLayout.card.width;
        const cardHeight = cardLayout.card.height;
        const containerLeftPadding = cardLayout.container.leftPadding;
        
        // Add padding around the cards
        const indicatorPadding = 8;
        
        // Allow indicator to go closer to screen edges (minimum 5px from edge)
        const minScreenPadding = 5;
        const leftBound = Math.max(minScreenPadding - containerLeftPadding, firstCardLeft - indicatorPadding);
        const rightEdge = lastCardLeft + cardWidth + indicatorPadding;
        
        // Calculate width based on actual card positions
        const indicatorWidth = rightEdge - leftBound;
        
        return {
            position: 'absolute',
            left: `${leftBound}px`,
            top: `-${indicatorPadding}px`,
            width: `${indicatorWidth}px`,
            height: `${cardHeight + (indicatorPadding * 2)}px`,
            pointerEvents: 'none', // Don't interfere with card interactions
            zIndex: 0, // Behind cards
            boxSizing: 'border-box',
        };
    };

    return (
        <div className="player-hand-container" ref={myHandRef}
             style={cardLayout ? {
                 paddingLeft: `${cardLayout.container.leftPadding}px`,
                 paddingRight: `${cardLayout.container.rightPadding}px`
             } : {}}>
            <div
                className={`player-hand-cards`}
                style={cardLayout ? {
                    ...spacingEngineRef.current.getCSSVariables(cardLayout),
                    position: 'relative',
                    display: 'block' // Not flex - using absolute positioning
                } : {}}
            >
                {/* Turn indicator overlay - absolute positioned behind cards */}
                {isMyTurnToPlay && !dragState.isDragging && (
                    <div 
                        className={`turn-indicator-overlay ${isBidder ? 'team-bidder' : ''} ${isDefender ? 'team-defender' : ''}`}
                        style={getTurnIndicatorStyle()}
                    />
                )}
                {myHandToDisplay.map((card, index) => {
                    const isLegal = isMyTurnToPlay && legalMoves.includes(card);
                    const isBeingDragged = dragState.isDragging && dragState.draggedCard === card;
                    const isShaded = state === "Playing Phase" && isMyTurnToPlay && !isLegal;
                    
                    // CRITICAL FIX: Don't apply React transforms when physics is controlling the element
                    const isPhysicsControlled = usePhysics && isBeingDragged;
                    
                    // Get card position from layout
                    const cardPosition = cardLayout?.layout.positions[index];
                    
                    const dynamicStyle = {
                        position: 'absolute',
                        left: cardPosition ? `${cardPosition.left}px` : '0',
                        top: '0',
                        zIndex: isBeingDragged ? 2000 : (index + 1),
                        transform: (isBeingDragged && !usePhysics) ? `translate(${dragState.translateX}px, ${dragState.translateY}px) scale(1.1)` : 
                                  isPhysicsControlled ? 'none' : 'none', // Let physics engine handle transforms
                        transition: isPhysicsControlled ? 'none' : 'left 0.3s ease-out' // Smooth transitions for position changes
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