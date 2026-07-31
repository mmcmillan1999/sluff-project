// frontend/src/components/game/PlayerHand.js

import React, { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import './PlayerHand.css';
import { RANKS_ORDER, SUIT_SORT_ORDER } from '../../constants';
import { getLegalMoves } from '../../utils/legalMoves';
import CardPhysicsEngine from '../../utils/CardPhysicsEngine';
import CardSpacingEngine from '../../utils/CardSpacingEngine';
import { useCardPlayStyle } from '../../utils/playStyle';
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion';
import { TurnBeacon } from './TurnNudge';
// import { useViewport } from '../../hooks/useViewport'; // Currently unused

// Fast play style timings. First click raises the card; a second click within
// the window sends it to the drop spot with a full spin, otherwise it reseats.
export const FAST_LIFT_WINDOW_MS = 1000;
export const FAST_FLIGHT_MS = 500;
// If the server never confirms the play (rejection, drop), snap the card back
// into the hand instead of leaving it stranded on the felt.
export const FAST_FLIGHT_RECOVER_MS = 1500;

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
    onSelectDiscard,
    // Turn call-up level for hand-owned decisions: 0 calm, 1 nudge, 2 urgent.
    nudgeLevel = 0,
    // Seconds until the AFK backstop plays for this player, or null.
    nudgeCountdown = null
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

    // Fast play style: click to raise, click again to play, timeout reseats.
    const cardPlayStyle = useCardPlayStyle();
    const isFastMode = cardPlayStyle === 'fast';
    const prefersReducedMotion = usePrefersReducedMotion();
    const [fastLiftedCard, setFastLiftedCard] = useState(null);
    // { card, from:{x,y}, to:{x,y}, launched, emitted } while a clicked card
    // is flying to the drop spot. React owns the styles for the whole flight,
    // so a failed play recovers by simply clearing this state.
    const [fastFlight, setFastFlight] = useState(null);
    const fastLiftTimerRef = useRef(null);
    // App re-creates emitEvent on every render (each socket broadcast), so
    // timers must call through a ref or their effects would restart mid-count.
    const emitEventRef = useRef(emitEvent);
    emitEventRef.current = emitEvent;

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

    const { state, hands = {}, bidWinnerInfo, trickTurnPlayerName, currentTrickCards = [], leadSuitCurrentTrick, trumpSuit, trumpBroken, players } = currentTableState;
    // Viewer-specific server state only includes the current player's hand.
    const myHand = useMemo(() => hands?.[selfPlayerName] || [], [hands, selfPlayerName]);
    
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
                        if (import.meta.env?.DEV) {
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
                        if (import.meta.env?.DEV) {
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
            if (import.meta.env?.DEV) {
                spacingEngineRef.current.logDebugInfo(layout);
            }
        };
        
        const handleResize = () => calculateLayout(true);
        
        calculateLayout();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [myHand, usePhysics]);  // Recalculate on any hand change


    // --- Fast play style (click-click) ---

    // Reuses the drop-zone glow the drag path paints while a card hovers the
    // zone: lit while a card is raised or flying, dark otherwise.
    const setDropZoneGlow = useCallback((on) => {
        const visualTarget = dropZoneRef.current?.firstChild;
        if (!visualTarget) return;
        visualTarget.style.opacity = on ? '1' : '0';
        visualTarget.style.boxShadow = on ? '0 0 40px 15px rgba(139, 195, 247, 0.9)' : 'none';
    }, [dropZoneRef]);

    const clearFastLift = useCallback(() => {
        if (fastLiftTimerRef.current) {
            clearTimeout(fastLiftTimerRef.current);
            fastLiftTimerRef.current = null;
        }
        setFastLiftedCard(null);
        setDropZoneGlow(false);
    }, [setDropZoneGlow]);

    const handleFastClick = useCallback((card) => {
        if (fastFlight) return; // a play is already on its way

        if (fastLiftedCard !== card) {
            // First click (or switching cards): raise it, fully revealed, and
            // start the reseat countdown.
            setFastLiftedCard(card);
            setDropZoneGlow(true);
            if (fastLiftTimerRef.current) clearTimeout(fastLiftTimerRef.current);
            fastLiftTimerRef.current = setTimeout(() => {
                fastLiftTimerRef.current = null;
                setFastLiftedCard(null);
                setDropZoneGlow(false);
            }, FAST_LIFT_WINDOW_MS);
            return;
        }

        // Second click inside the window: send it to the drop spot.
        if (fastLiftTimerRef.current) {
            clearTimeout(fastLiftTimerRef.current);
            fastLiftTimerRef.current = null;
        }
        setFastLiftedCard(null);

        const cardElement = document.getElementById(`card-${card}`);
        const dropZoneRect = dropZoneRef.current?.getBoundingClientRect();
        if (!cardElement || !dropZoneRect || prefersReducedMotion) {
            // No geometry to animate with (or motion is unwelcome): play now.
            setDropZoneGlow(false);
            emitEvent("playCard", { card });
            return;
        }

        const rect = cardElement.getBoundingClientRect();
        setFastFlight({
            card,
            from: { x: rect.left, y: rect.top },
            to: {
                x: dropZoneRect.left + dropZoneRect.width / 2 - rect.width / 2,
                y: dropZoneRect.top + dropZoneRect.height / 2 - rect.height / 2,
            },
            // Kept for retargeting: mid-spin the live bounding box is
            // rotation-inflated, so the launch measurement is the truth.
            size: { w: rect.width, h: rect.height },
            launched: false,
            emitted: false,
        });
    }, [fastFlight, fastLiftedCard, dropZoneRef, prefersReducedMotion, setDropZoneGlow, emitEvent]);

    // Launch the flight one committed frame after the wrapper re-renders at
    // its fixed starting position, so the transition animates from the hand.
    useLayoutEffect(() => {
        if (!fastFlight || fastFlight.launched) return;
        const cardElement = document.getElementById(`card-${fastFlight.card}`);
        if (cardElement) void cardElement.offsetWidth; // commit the start frame
        setFastFlight(flight => (
            flight && !flight.launched ? { ...flight, launched: true } : flight
        ));
    }, [fastFlight]);

    // The play is committed when the card lands on the drop spot, mirroring
    // the flick path where physics docking success triggers the emit. Keyed on
    // the flight's primitive fields (not the object) so parent re-renders and
    // mid-flight retargets can never restart the countdown.
    useEffect(() => {
        if (!fastFlight?.launched || fastFlight.emitted) return undefined;
        const card = fastFlight.card;
        const timer = setTimeout(() => {
            setDropZoneGlow(false);
            emitEventRef.current("playCard", { card });
            setFastFlight(flight => (
                flight && !flight.emitted ? { ...flight, emitted: true } : flight
            ));
        }, FAST_FLIGHT_MS);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fastFlight?.card, fastFlight?.launched, fastFlight?.emitted, setDropZoneGlow]);

    // Recovery: if the server never takes the card out of the hand, release
    // the flight styles so the card snaps back to its seat.
    useEffect(() => {
        if (!fastFlight?.emitted) return undefined;
        const timer = setTimeout(() => setFastFlight(null), FAST_FLIGHT_RECOVER_MS);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fastFlight?.card, fastFlight?.emitted]);

    // A viewport resize (mobile keyboard, rotation, window drag) moves the
    // drop zone while the flight targets stale pixels; retarget from the live
    // rect. Updating only `to` leaves the primitive-keyed timers untouched and
    // the transform transition redirects smoothly mid-animation.
    useEffect(() => {
        if (!fastFlight) return undefined;
        const retarget = () => {
            const dropZoneRect = dropZoneRef.current?.getBoundingClientRect();
            if (!dropZoneRect) return;
            setFastFlight(flight => flight && ({
                ...flight,
                to: {
                    x: dropZoneRect.left + dropZoneRect.width / 2 - flight.size.w / 2,
                    y: dropZoneRect.top + dropZoneRect.height / 2 - flight.size.h / 2,
                },
            }));
        };
        window.addEventListener('resize', retarget);
        return () => window.removeEventListener('resize', retarget);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [Boolean(fastFlight), dropZoneRef]);

    // Keep fast-play interaction honest against server state: reseat when the
    // turn moves on, drop flight styles once the card leaves the hand, and
    // reset everything when the player switches styles mid-hand.
    useEffect(() => {
        const stillMyTurn = state === "Playing Phase" && trickTurnPlayerName === selfPlayerName;
        if (fastLiftedCard && (!isFastMode || !stillMyTurn || !myHand.includes(fastLiftedCard))) {
            clearFastLift();
        }
        if (fastFlight && !myHand.includes(fastFlight.card)) {
            setFastFlight(null);
            setDropZoneGlow(false); // defensive: normally already off post-emit
        }
    }, [state, trickTurnPlayerName, selfPlayerName, myHand, isFastMode, fastLiftedCard, fastFlight, clearFastLift, setDropZoneGlow]);

    // Never leave the drop-zone glow or a pending reseat behind on unmount.
    useEffect(() => () => {
        if (fastLiftTimerRef.current) clearTimeout(fastLiftTimerRef.current);
        const visualTarget = dropZoneRef.current?.firstChild;
        if (visualTarget) {
            visualTarget.style.opacity = '0';
            visualTarget.style.boxShadow = 'none';
        }
    }, [dropZoneRef]);

    // --- Flick play style (drag physics) ---

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
            
            // Portal the 14-card discard overlay to <body> so it escapes the
            // game-footer's stacking context (z-index:10) — otherwise the table's
            // trick piles (z-index:15) render on top and hide cards during the
            // discard selection. At body level its z-index:100 wins cleanly.
            return createPortal(
                <>
                    {/* Render cards outside container with fixed positioning */}
                    {/* Top row - positioned higher on screen */}
                    <div className="player-hand-cards is-discarding"
                         style={{ 
                             position: 'fixed',
                             bottom: '23vh', // Lowered by 3vh (was 26vh)
                             left: '0',
                             right: '0',
                             width: '100%',
                             height: `${topLayout?.card.height || 137}px`,
                             display: 'block', // Not flex - we're using absolute positioning
                             paddingLeft: `${topLayout?.container.leftPadding || 0}px`,
                             paddingRight: `${topLayout?.container.rightPadding || 0}px`,
                             zIndex: 100 // Ensure cards are above other elements
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
                    
                    {/* Bottom row - positioned at bottom of screen */}
                    <div className="player-hand-cards is-discarding"
                         style={{ 
                             position: 'fixed',
                             bottom: '10vh', // Lowered by 3vh (was 13vh)
                             left: '0',
                             right: '0',
                             width: '100%',
                             height: `${bottomLayout?.card.height || 137}px`,
                             display: 'block', // Not flex - we're using absolute positioning
                             paddingLeft: `${bottomLayout?.container.leftPadding || 0}px`,
                             paddingRight: `${bottomLayout?.container.rightPadding || 0}px`,
                             zIndex: 100 // Ensure cards are above other elements
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
                </>,
                document.body
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

    // Position of each legal card among the legal ones only, so the call-up
    // crest sweeps left to right across what's playable instead of stuttering
    // over the gaps where the shaded cards sit.
    const legalWaveIndex = new Map();
    if (isMyTurnToPlay && nudgeLevel > 0) {
        myHandToDisplay.forEach((card) => {
            if (legalMoves.includes(card)) legalWaveIndex.set(card, legalWaveIndex.size);
        });
    }

    // Calculate turn indicator bounds
    const getTurnIndicatorStyle = () => {
        if (!cardLayout || !isMyTurnToPlay || dragState.isDragging || fastFlight || myHandToDisplay.length === 0) {
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
                {isMyTurnToPlay && !dragState.isDragging && !fastFlight && (
                    <div
                        className={`turn-indicator-overlay ${isBidder ? 'team-bidder' : ''} ${isDefender ? 'team-defender' : ''} ${nudgeLevel > 0 ? 'is-nudging' : ''} ${nudgeLevel >= 2 ? 'is-urgent' : ''}`}
                        style={getTurnIndicatorStyle()}
                    />
                )}
                {isMyTurnToPlay && !dragState.isDragging && !fastFlight && (
                    <TurnBeacon level={nudgeLevel} countdown={nudgeCountdown} />
                )}
                {myHandToDisplay.map((card, index) => {
                    const isLegal = isMyTurnToPlay && legalMoves.includes(card);
                    const isBeingDragged = dragState.isDragging && dragState.draggedCard === card;
                    const isShaded = state === "Playing Phase" && isMyTurnToPlay && !isLegal;
                    const isFastLifted = isFastMode && fastLiftedCard === card;
                    // Not gated on isFastMode: a launched flight is a committed
                    // play and must finish (and emit once) even if the player
                    // switches styles from the menu mid-flight.
                    const isFastFlying = fastFlight?.card === card;
                    // The crest animates the card face, never the wrapper: the
                    // wrapper is what the physics engine and the fast-play
                    // flight drive, and a competing transform there would
                    // hijack a play in progress.
                    const isWaving = nudgeLevel > 0
                        && isLegal
                        && !isBeingDragged
                        && !isFastFlying
                        && !isFastLifted;

                    // CRITICAL FIX: Don't apply React transforms when physics is controlling the element
                    const isPhysicsControlled = usePhysics && isBeingDragged;

                    // Get card position from layout
                    const cardPosition = cardLayout?.layout.positions[index];

                    const dynamicStyle = isFastFlying
                        ? {
                            // Fast play flight: fixed positioning (like the drag
                            // physics) so the card can cross the table, with one
                            // full spin on the way to the drop spot.
                            position: 'fixed',
                            left: '0',
                            top: '0',
                            margin: '0',
                            zIndex: 2000,
                            pointerEvents: 'none',
                            willChange: 'transform',
                            transform: fastFlight.launched
                                ? `translate(${fastFlight.to.x}px, ${fastFlight.to.y}px) rotate(360deg)`
                                : `translate(${fastFlight.from.x}px, ${fastFlight.from.y}px)`,
                            transition: fastFlight.launched
                                ? `transform ${FAST_FLIGHT_MS}ms cubic-bezier(0.3, 0.7, 0.3, 1)`
                                : 'none',
                        }
                        : {
                            position: 'absolute',
                            left: cardPosition ? `${cardPosition.left}px` : '0',
                            top: '0',
                            // Raised cards jump the overlap stack so they read fully.
                            zIndex: isBeingDragged ? 1000 : (isFastLifted ? 999 : (index + 1)),
                            // Use translate3d with a zero z-value to force GPU acceleration and proper stacking
                            transform: (isBeingDragged && !usePhysics)
                                ? `translate3d(${dragState.translateX}px, ${dragState.translateY}px, 0) scale(1.1)`
                                : (isFastLifted ? 'translateY(-0.25in)' : 'none'), // Physics engine handles drag transforms
                            transition: isPhysicsControlled
                                ? 'none'
                                : (isFastMode
                                    ? 'transform 0.15s ease-out, left 0.3s ease-out' // lift/reseat + reflow
                                    : 'left 0.3s ease-out') // Smooth transitions for position changes
                        };

                    const wrapper = (
                        <div
                            id={`card-${card}`}
                            key={card}
                            className={`player-hand-card-wrapper ${isBeingDragged ? 'is-dragging' : ''}${isFastMode && isLegal ? ' fast-play' : ''}${isFastLifted ? ' is-fast-lifted' : ''}`}
                            style={dynamicStyle}
                            onMouseDown={(e) => !isFastMode && isLegal && handleDragStart(e, card)}
                            onClick={isFastMode && isLegal ? () => handleFastClick(card) : undefined}
                            ref={(el) => {
                                if (!el) return;
                                // Remove old listener if it exists
                                el.removeEventListener('touchstart', el._touchHandler);

                                if (isLegal && !isFastMode) {
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
                                className: [
                                    isShaded ? 'illegal-move' : '',
                                    isWaving ? 'turn-nudge-wave' : '',
                                    isWaving && nudgeLevel >= 2 ? 'turn-nudge-wave--urgent' : ''
                                ].filter(Boolean).join(' '),
                                style: isWaving ? { '--nudge-wave-index': legalWaveIndex.get(card) } : {}
                            })}
                        </div>
                    );

                    // The flight escapes the footer's stacking context via a
                    // body portal (the frog-discard precedent) so it can't
                    // pass underneath the trick piles. It reparents on the
                    // pre-launch frame (transition:none), so the transform
                    // transition still animates from the hand.
                    return isFastFlying ? createPortal(wrapper, document.body, `fly-${card}`) : wrapper;
                })}
            </div>
        </div>
    );
};

export default PlayerHand;
