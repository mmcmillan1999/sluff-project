// frontend/src/components/game/TableLayout.js
import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { useViewport } from '../../hooks/useViewport';
import ScoreProgressBar from './ScoreProgressBar';
import PlayerSeatPositioner from './PlayerSeatPositioner';
import {
    FINAL_TRICK_HOLD_MS, FINAL_TRICK_FLY_MS,
    BANNER_START_MS, BANNER_DURATION_MS,
    WIDOW_TO_CENTER_START_MS, WIDOW_TO_CENTER_MS,
    WIDOW_FLIP_START_MS, WIDOW_FLIP_MS,
    WIDOW_TO_PILE_MS, WIDOW_OVERLAY_TO_PILE_MS,
} from '../../config/endRoundTiming';
import './KeyAndModal.css';
import './TableLayout.css';
import { SUIT_SYMBOLS } from '../../constants';

// Full deck of 36 cards (9 ranks × 4 suits)
const FULL_DECK = [
    // Hearts
    '6H', '7H', '8H', '9H', 'JH', 'QH', 'KH', '10H', 'AH',
    // Diamonds  
    '6D', '7D', '8D', '9D', 'JD', 'QD', 'KD', '10D', 'AD',
    // Clubs
    '6C', '7C', '8C', '9C', 'JC', 'QC', 'KC', '10C', 'AC',
    // Spades
    '6S', '7S', '8S', '9S', 'JS', 'QS', 'KS', '10S', 'AS'
];

// Total captured tricks across all players (used to detect when a trick lands).
const trickTotal = (captured) => Object.values(captured || {}).reduce((acc, t) => acc + (t?.length || 0), 0);

const TableLayout = ({
    currentTableState,
    seatAssignments,
    isSpectator,
    renderCard,
    PlayerSeat,
    ActionControls,
    selfPlayerName,
    playerId,
    emitEvent,
    handleLeaveTable,
    playSound,
    dropZoneRef,
    isAdmin = false,
    showDebugAnchors = false
}) => {
    const [lastTrickVisible, setLastTrickVisible] = useState(false);
    const [lastTrickPosition, setLastTrickPosition] = useState(null);
    // 4-player: the sitting-out dealer may peek at the widow (spec privilege)
    const [widowPeekVisible, setWidowPeekVisible] = useState(false);
    const widowPeekTimerRef = useRef(null);
    const [trumpBrokenAnnouncementVisible, setTrumpBrokenAnnouncementVisible] = useState(false);
    const { width } = useViewport();
    const [previousTrumpBroken, setPreviousTrumpBroken] = useState(false);
    const lastTrickTimerRef = useRef(null);
    const trumpAnnouncementTimerRef = useRef(null);
    // Refs to the played-card "fly" wrappers (one per seat) + the hold-then-fly timer.
    const flyRefs = useRef({});
    const flyTimerRef = useRef(null);
    // End-of-round celebration: "WIDOW REVEAL!" banner + the widow cards flying
    // from the widow pile to center and on to the awarded team's pile.
    const [widowRevealVisible, setWidowRevealVisible] = useState(false);
    const [widowCelebrationActive, setWidowCelebrationActive] = useState(false);
    const [widowFlipped, setWidowFlipped] = useState(false);
    const widowCardRefs = useRef([]);
    const endRoundTimersRef = useRef([]);
    const endRoundKeyRef = useRef(null);
    // Pile counts lag the server until the magnet slides the cards in, so the
    // stack only grows once the cards have arrived (not the moment they're played).
    const [laggedCapturedTricks, setLaggedCapturedTricks] = useState(() => currentTableState.capturedTricks || {});
    const displayedTrickTotalRef = useRef(trickTotal(currentTableState.capturedTricks));
    const pendingTrickTargetRef = useRef(null);
    const laggedTrickTimerRef = useRef(null);

    const clearEndRoundTimers = () => {
        endRoundTimersRef.current.forEach(clearTimeout);
        endRoundTimersRef.current = [];
    };

    useEffect(() => {
        return () => {
            if (lastTrickTimerRef.current) {
                clearTimeout(lastTrickTimerRef.current);
            }
            if (trumpAnnouncementTimerRef.current) {
                clearTimeout(trumpAnnouncementTimerRef.current);
            }
            if (flyTimerRef.current) {
                clearTimeout(flyTimerRef.current);
            }
            if (laggedTrickTimerRef.current) {
                clearTimeout(laggedTrickTimerRef.current);
            }
            clearEndRoundTimers();
        };
    }, []);

    // When a trick is captured, hold the pile count until the magnet has slid the
    // cards onto the pile (~hold + fly). Resets/new rounds update immediately, and
    // spectators (who don't see the magnet) update immediately too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => {
        const captured = currentTableState.capturedTricks || {};
        const newTotal = trickTotal(captured);
        const oldTotal = displayedTrickTotalRef.current;

        if (!isSpectator && newTotal > oldTotal) {
            if (pendingTrickTargetRef.current !== newTotal) {
                pendingTrickTargetRef.current = newTotal;
                if (laggedTrickTimerRef.current) clearTimeout(laggedTrickTimerRef.current);
                laggedTrickTimerRef.current = setTimeout(() => {
                    setLaggedCapturedTricks(captured);
                    displayedTrickTotalRef.current = newTotal;
                    pendingTrickTargetRef.current = null;
                }, FINAL_TRICK_HOLD_MS + FINAL_TRICK_FLY_MS);
            }
        } else if (newTotal !== oldTotal || isSpectator) {
            if (laggedTrickTimerRef.current) {
                clearTimeout(laggedTrickTimerRef.current);
                laggedTrickTimerRef.current = null;
            }
            pendingTrickTargetRef.current = null;
            setLaggedCapturedTricks(captured);
            displayedTrickTotalRef.current = newTotal;
        }
    }, [currentTableState.capturedTricks, isSpectator]);

    // Shared helper: measure the played cards + the winning pile, hold, then slide
    // and shrink the cards onto that pile. Used by both the per-trick linger and
    // the final trick of the round.
    const flyTrickToWinnerPile = useCallback((winnerIsBidder) => {
        const targetEl = document.querySelector(`.trick-pile-base.${winnerIsBidder ? 'bidder' : 'defender'}-base`);
        if (!targetEl) return; // graceful fallback: cards simply remain, then unmount
        const t = targetEl.getBoundingClientRect();
        const tcx = t.left + t.width / 2;
        const tcy = t.top + t.height / 2;

        const cards = Object.values(flyRefs.current).filter(Boolean);
        cards.forEach((el) => {
            const r = el.getBoundingClientRect();
            if (!r.width) return;
            el.__fly = { dx: tcx - (r.left + r.width / 2), dy: tcy - (r.top + r.height / 2) };
            el.style.transition = 'none';
            el.style.transform = 'translate(0px, 0px) scale(1)';
            if (el.parentElement) el.parentElement.style.zIndex = '40';
            void el.offsetWidth; // force reflow so the fly animates from home
        });

        flyTimerRef.current = setTimeout(() => {
            cards.forEach((el) => {
                if (!el.__fly) return;
                el.style.transition = `transform ${FINAL_TRICK_FLY_MS}ms cubic-bezier(0.45, 0.05, 0.4, 1)`;
                el.style.transform = `translate(${el.__fly.dx}px, ${el.__fly.dy}px) scale(0.6)`;
            });
        }, FINAL_TRICK_HOLD_MS);
    }, []);

    // Track trump broken state changes and trigger announcement
    useEffect(() => {
        const { trumpBroken } = currentTableState;
        
        // Check if trump just got broken (transition from false to true)
        if (!previousTrumpBroken && trumpBroken) {
            // Clear any existing timer
            if (trumpAnnouncementTimerRef.current) {
                clearTimeout(trumpAnnouncementTimerRef.current);
            }
            
            // Show announcement + play the trump-broken accent
            setTrumpBrokenAnnouncementVisible(true);
            if (playSound) playSound('trumpBroken');

            // Hide announcement after 2.5 seconds
            trumpAnnouncementTimerRef.current = setTimeout(() => {
                setTrumpBrokenAnnouncementVisible(false);
            }, 2500);
        }
        
        // Update previous state
        setPreviousTrumpBroken(trumpBroken);
    }, [currentTableState, previousTrumpBroken]);

    // "Magnet" the completed trick onto the winning pile during the per-trick
    // linger. Keyed on state only so mid-linger re-renders don't cancel the fly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useLayoutEffect(() => {
        const { state, lastCompletedTrick, bidWinnerInfo } = currentTableState;
        if (state !== 'TrickCompleteLinger' || isSpectator || !lastCompletedTrick || !bidWinnerInfo) {
            return undefined;
        }
        flyTrickToWinnerPile(lastCompletedTrick.winnerName === bidWinnerInfo.playerName);
        return () => {
            if (flyTimerRef.current) {
                clearTimeout(flyTimerRef.current);
                flyTimerRef.current = null;
            }
        };
    }, [currentTableState.state]);

    // End-of-round celebration sequence. The final (11th) trick skips the linger
    // and jumps straight to scoring, so we run the whole flourish here when the
    // round-end state arrives, then GameTableView delays the recap modal to match.
    //   1) magnet the final trick onto its pile
    //   2) "WIDOW REVEAL!" banner
    //   3) widow cards fly from the widow pile to center
    //   4) hold in center
    //   5) widow cards fly to the awarded team's pile
    // Keyed on state only so the long sequence isn't cancelled by re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useLayoutEffect(() => {
        const { state, roundSummary, lastCompletedTrick, bidWinnerInfo } = currentTableState;
        const isRoundEnd = (state === 'Awaiting Next Round Trigger' || state === 'Game Over')
            && roundSummary && lastCompletedTrick && bidWinnerInfo && !isSpectator;

        if (!isRoundEnd) {
            // Reset once we've moved on to the next round / away from the recap.
            if (endRoundKeyRef.current) {
                endRoundKeyRef.current = null;
                clearEndRoundTimers();
                setWidowRevealVisible(false);
                setWidowCelebrationActive(false);
                setWidowFlipped(false);
            }
            return;
        }

        // Run the sequence once per round-end (roundSummary is a fresh object each round).
        if (endRoundKeyRef.current === roundSummary) return;
        endRoundKeyRef.current = roundSummary;
        clearEndRoundTimers();
        setWidowFlipped(false);

        // 1) Final trick onto the winning pile.
        flyTrickToWinnerPile(lastCompletedTrick.winnerName === bidWinnerInfo.playerName);

        // As it lands, fade the trick cards into the pile so a face-up card isn't
        // left hovering on the pile when the widow reveal begins. (The server never
        // clears the final trick's cards the way it does for non-final tricks.)
        endRoundTimersRef.current.push(setTimeout(() => {
            Object.values(flyRefs.current).filter(Boolean).forEach((el) => {
                el.style.transition = 'opacity 150ms ease-out';
                el.style.opacity = '0';
            });
        }, FINAL_TRICK_HOLD_MS + FINAL_TRICK_FLY_MS));

        // 2) Banner + drumroll begin (anticipation).
        endRoundTimersRef.current.push(setTimeout(() => {
            setWidowRevealVisible(true);
            if (playSound) playSound('drumroll');
        }, BANNER_START_MS));
        endRoundTimersRef.current.push(setTimeout(() => setWidowRevealVisible(false), BANNER_START_MS + BANNER_DURATION_MS));

        // 3) Mount the widow overlay (face-down) just before it should start moving;
        //    the positioning effect below measures + animates it once it's in the DOM.
        endRoundTimersRef.current.push(setTimeout(() => setWidowCelebrationActive(true), WIDOW_TO_CENTER_START_MS));

        // 4) Flip the widow face-up + the round-end fanfare as the payoff.
        endRoundTimersRef.current.push(setTimeout(() => {
            setWidowFlipped(true);
            if (playSound) playSound('roundEnd');
        }, WIDOW_FLIP_START_MS));
    }, [currentTableState.state]);

    // Drives the widow overlay: measured FLIP from the widow pile -> center
    // (held) -> the awarded team's pile. Runs when the overlay mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useLayoutEffect(() => {
        if (!widowCelebrationActive) return undefined;
        const { roundSummary, lastCompletedTrick, bidWinnerInfo } = currentTableState;
        const cards = widowCardRefs.current.filter(Boolean);
        if (!cards.length || !roundSummary || !bidWinnerInfo) return undefined;

        const center = (el) => {
            const r = el.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        };
        const widowEl = document.querySelector('.trick-pile-base.widow-base');
        const ovalEl = document.querySelector('.table-oval');
        // Frog/Solo -> bidder; Heart Solo -> the last-trick winner's team.
        const widowToBidder = bidWinnerInfo.bid === 'Heart Solo'
            ? lastCompletedTrick?.winnerName === bidWinnerInfo.playerName
            : true;
        const pileEl = document.querySelector(`.trick-pile-base.${widowToBidder ? 'bidder' : 'defender'}-base`);
        if (!widowEl || !ovalEl || !pileEl) return undefined;

        const src = center(widowEl);
        const mid = center(ovalEl);
        const dst = center(pileEl);
        const place = (x, y, scale) => `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${scale})`;

        cards.forEach((el, i) => {
            const fan = (i - (cards.length - 1) / 2) * (el.offsetWidth * 0.85 || 60);
            el.__mid = { x: mid.x + fan, y: mid.y };
            el.__dst = dst;
            el.style.transition = 'none';
            el.style.transform = place(src.x, src.y, 0.55);
            void el.offsetWidth; // reflow so the move animates from the widow pile
            el.style.transition = `transform ${WIDOW_TO_CENTER_MS}ms cubic-bezier(0.3, 0.7, 0.3, 1)`;
            el.style.transform = place(el.__mid.x, el.__mid.y, 1);
        });

        // After the anticipation + flip + revealed hold, converge onto the awarded pile.
        const toPile = setTimeout(() => {
            cards.forEach((el) => {
                if (!el.__dst) return;
                el.style.transition = `transform ${WIDOW_TO_PILE_MS}ms cubic-bezier(0.45, 0.05, 0.4, 1)`;
                el.style.transform = place(el.__dst.x, el.__dst.y, 0.5);
            });
        }, WIDOW_OVERLAY_TO_PILE_MS);
        endRoundTimersRef.current.push(toPile);

        return undefined;
    }, [widowCelebrationActive]);

    const handleTrickPileClick = (clickedPile, pileClass) => {
        const { lastCompletedTrick, bidWinnerInfo } = currentTableState;
        if (!lastCompletedTrick || !bidWinnerInfo) {
            console.log('[TrickPile] No last trick or bid winner info available');
            return;
        }

        const winnerIsBidder = lastCompletedTrick.winnerName === bidWinnerInfo.playerName;
        const clickedWinnerPile = (clickedPile === 'bidder' && winnerIsBidder) || (clickedPile === 'defender' && !winnerIsBidder);

        console.log('[TrickPile] Click:', clickedPile, 'Winner:', lastCompletedTrick.winnerName, 'Is Bidder:', winnerIsBidder, 'Correct pile:', clickedWinnerPile);

        // Only show last trick when clicking the pile of the team that won
        if (clickedWinnerPile) {
            if (lastTrickTimerRef.current) clearTimeout(lastTrickTimerRef.current);
            setLastTrickVisible(true);
            setLastTrickPosition(pileClass); // Store which pile was clicked
            lastTrickTimerRef.current = setTimeout(() => {
                setLastTrickVisible(false);
                setLastTrickPosition(null);
            }, 3000);
        } else {
            // Play sound when clicking the pile that didn't win
            console.log('[TrickPile] Playing no_peaking_cheater sound');
            if (playSound) {
                playSound('no_peaking_cheater');
            } else {
                console.error('[TrickPile] playSound function not available');
            }
        }
    };

    // Widow peek (4-player only): the sitting-out dealer taps the widow pile
    // to see its cards, same rhythm as the last-trick peek. Anyone else who
    // taps gets the "no peeking" treatment.
    const handleWidowPileClick = () => {
        if (currentTableState.playerMode !== 4) return;
        const isSittingOutDealer = currentTableState.dealer === playerId;
        if (isSittingOutDealer) {
            if (widowPeekTimerRef.current) clearTimeout(widowPeekTimerRef.current);
            setWidowPeekVisible(true);
            widowPeekTimerRef.current = setTimeout(() => setWidowPeekVisible(false), 3000);
        } else if (playSound) {
            playSound('no_peaking_cheater');
        }
    };

    const renderWidowPeekOverlay = () => {
        const { originalDealtWidow, widowDiscardsForFrogBidder, bidWinnerInfo } = currentTableState;
        if (!widowPeekVisible || !originalDealtWidow?.length) return null;
        const widowPileClass = currentTableState._widowPilePosition || 'pile-bottom-left';
        const showFrogDiscards = bidWinnerInfo?.bid === 'Frog' && widowDiscardsForFrogBidder?.length > 0;
        return (
            <div className={`last-trick-overlay-container ${widowPileClass}`}>
                <h4 className="last-trick-header">Widow</h4>
                <div className="last-trick-cards">
                    {originalDealtWidow.map(card => renderCard(card, { key: card, small: true }))}
                </div>
                {showFrogDiscards && (
                    <>
                        <h4 className="last-trick-header">Frog discards</h4>
                        <div className="last-trick-cards">
                            {widowDiscardsForFrogBidder.map(card => renderCard(card, { key: card, small: true }))}
                        </div>
                    </>
                )}
            </div>
        );
    };

    const renderPlayedCardsOnTable = () => {
        const isLingerState = currentTableState.state === 'TrickCompleteLinger';
        const cardsToDisplay = isLingerState ? currentTableState.lastCompletedTrick.cards : currentTableState.currentTrickCards;

        if (!cardsToDisplay || cardsToDisplay.length === 0 || isSpectator) {
            return null;
        }

        const cardFor = (pName) => (pName ? (cardsToDisplay || []).find(c => c.playerName === pName)?.card || null : null);

        // During the linger, highlight the card that actually won the trick, in the
        // winning team's colour (gold = bidder, blue = defender) to match the pile.
        const winnerName = isLingerState ? currentTableState.lastCompletedTrick?.winnerName : null;
        const winnerIsBidder = !!winnerName && winnerName === currentTableState.bidWinnerInfo?.playerName;

        // Each played card sits in a fixed wrapper for positioning; the inner
        // .trick-card-fly element is what we transform to animate onto the pile.
        const slot = (posKey, pName, wrapperClass) => {
            const card = cardFor(pName);
            const isWinner = !!card && pName === winnerName;
            const winnerClass = isWinner ? (winnerIsBidder ? ' trick-winning-card-bidder' : ' trick-winning-card-defender') : '';
            const flyClass = `trick-card-fly${winnerClass}`;
            return (
                <div className={wrapperClass}>
                    <div className={flyClass} ref={(el) => { flyRefs.current[posKey] = card ? el : null; }}>
                        {renderCard(card, { large: true })}
                    </div>
                </div>
            );
        };

        return (
            <>
                {slot('bottom', seatAssignments.self, 'played-card-bottom')}
                {slot('left', seatAssignments.opponentLeft, 'played-card-left')}
                {slot('right', seatAssignments.opponentRight, 'played-card-right')}
                {seatAssignments.opponentAcross && slot('top', seatAssignments.opponentAcross, 'played-card-top')}
            </>
        );
    };

    // Removed testing helper - no longer needed
    const renderCardDropZones = () => {
        return null;
    };

    const renderLastTrickOverlay = () => {
        const { lastCompletedTrick, bidWinnerInfo } = currentTableState;
        if (!lastTrickVisible || !lastCompletedTrick || !bidWinnerInfo || !lastTrickPosition) {
            return null;
        }
    
        const winnerIsBidder = lastCompletedTrick.winnerName === bidWinnerInfo.playerName;
        // Use the pile position class that was clicked
        const overlayContainerClass = `last-trick-overlay-container ${lastTrickPosition}`;
    
        return (
            <div className={overlayContainerClass}>
                <h4 className="last-trick-header">Last Trick (won by {lastCompletedTrick.winnerName})</h4>
                <div className="last-trick-cards">
                    {lastCompletedTrick.cards.map(play => (
                        renderCard(play.card, { key: play.card, small: true })
                    ))}
                </div>
            </div>
        );
    };
    
    const renderTrickTallyPiles = () => {
        const { bidWinnerInfo, playerOrderActive, lastCompletedTrick } = currentTableState;
        // Use the lagged counts so the stack grows only once the magnet lands.
        const capturedTricks = laggedCapturedTricks;
        if (!bidWinnerInfo) return null;
        
        const bidderName = bidWinnerInfo.playerName;
        const defenderNames = playerOrderActive.filter(name => name !== bidderName);
        const bidderTricksCount = capturedTricks[bidderName]?.length || 0;
        const defenderTricksCount = defenderNames.reduce((acc, pName) => acc + (capturedTricks[pName]?.length || 0), 0);

        const lastWinnerName = lastCompletedTrick?.winnerName;
        const bidderWonLast = lastWinnerName === bidderName;
        const defenderWonLast = lastWinnerName && !bidderWonLast;
        
        // Determine which of the 4 fixed positions to use based on player positions
        // We have 4 positions: bottom-left, bottom-right, top-left, top-right
        
        // Find where the bidder is sitting
        let bidderPosition = null;
        let defenderPositions = [];
        
        if (seatAssignments.self === bidderName) {
            bidderPosition = 'bottom';
        } else if (seatAssignments.opponentLeft === bidderName) {
            bidderPosition = 'left';
        } else if (seatAssignments.opponentRight === bidderName) {
            bidderPosition = 'right';
        } else {
            bidderPosition = 'top'; // Default for across or unknown
        }
        
        // Find defender positions
        defenderNames.forEach(defenderName => {
            if (seatAssignments.self === defenderName) {
                defenderPositions.push('bottom');
            } else if (seatAssignments.opponentLeft === defenderName) {
                defenderPositions.push('left');
            } else if (seatAssignments.opponentRight === defenderName) {
                defenderPositions.push('right');
            } else {
                defenderPositions.push('top');
            }
        });
        
        // Assign trick piles and widow to the 4 fixed positions
        // We'll use 3 of 4: bidder pile, defender pile, and widow
        const allPositions = ['pile-bottom-left', 'pile-bottom-right', 'pile-top-left', 'pile-top-right'];
        const usedPositions = new Set();
        
        let bidderPileClass = '';
        let defenderPileClass = '';
        let widowPileClass = '';
        
        // Logic: Place defender pile between defenders, bidder pile near bidder, widow in remaining spot
        if (bidderPosition === 'bottom') {
            // Bidder at bottom - use bottom-right for bidder
            bidderPileClass = 'pile-bottom-right';
            usedPositions.add(bidderPileClass);
            
            // Defenders pile goes to best position for defenders
            if (defenderPositions.includes('left') && defenderPositions.includes('right')) {
                defenderPileClass = 'pile-top-left';
            } else if (defenderPositions.includes('left')) {
                defenderPileClass = 'pile-bottom-left';
            } else {
                defenderPileClass = 'pile-top-right';
            }
            usedPositions.add(defenderPileClass);
            
        } else if (bidderPosition === 'top') {
            // Bidder at top - use top-right for bidder
            bidderPileClass = 'pile-top-right';
            usedPositions.add(bidderPileClass);
            
            // Defenders pile
            if (defenderPositions.includes('left') && defenderPositions.includes('right')) {
                defenderPileClass = 'pile-bottom-left';
            } else if (defenderPositions.includes('left')) {
                defenderPileClass = 'pile-top-left';
            } else {
                defenderPileClass = 'pile-bottom-right';
            }
            usedPositions.add(defenderPileClass);
            
        } else if (bidderPosition === 'left') {
            // Bidder at left - use top-left for bidder
            bidderPileClass = 'pile-top-left';
            usedPositions.add(bidderPileClass);
            
            // Defenders pile between the two defenders
            if (defenderPositions.includes('right') && defenderPositions.includes('bottom')) {
                defenderPileClass = 'pile-bottom-right';
            } else {
                defenderPileClass = 'pile-top-right';
            }
            usedPositions.add(defenderPileClass);
            
        } else if (bidderPosition === 'right') {
            // Bidder at right - use top-right for bidder
            bidderPileClass = 'pile-top-right';
            usedPositions.add(bidderPileClass);
            
            // Defenders pile between the two defenders
            if (defenderPositions.includes('left') && defenderPositions.includes('bottom')) {
                defenderPileClass = 'pile-bottom-left';
            } else {
                defenderPileClass = 'pile-top-left';
            }
            usedPositions.add(defenderPileClass);
        }
        
        // Find the unused position for widow
        widowPileClass = allPositions.find(pos => !usedPositions.has(pos)) || 'pile-bottom-left';

        const TrickPile = ({ count }) => (
            <div className="trick-pile">
                <div className="trick-pile-content-wrapper">
                    <div className="trick-pile-cards">
                        {count === 0 ? (
                            renderCard(null, { isFaceDown: true, style: { opacity: 0.3 }, small: true })
                        ) : (
                            Array.from({ length: count }).map((_, i) => (
                                <div key={i} style={{ 
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    transform: `translateY(-${i * 2}px)` 
                                }}>
                                    {renderCard(null, { isFaceDown: true, small: true })}
                                </div>
                            ))
                        )}
                    </div>
                    <span className="trick-pile-count">{count}</span>
                </div>
            </div>
        );

        // Store widow position in parent scope for widow rendering
        currentTableState._widowPilePosition = widowPileClass;
        
        return (
            <>
                {/* Render bidder pile in its assigned position */}
                <div className={`trick-pile-container ${bidderPileClass}`}>
                    <div className={`trick-pile-base bidder-base ${bidderWonLast ? 'pulsating-gold' : ''}`} onClick={() => handleTrickPileClick('bidder', bidderPileClass)}>
                        <TrickPile count={bidderTricksCount} />
                    </div>
                </div>
                
                {/* Render defender pile in its assigned position */}
                <div className={`trick-pile-container ${defenderPileClass}`}>
                    <div className={`trick-pile-base defender-base ${defenderWonLast ? 'pulsating-blue' : ''}`} onClick={() => handleTrickPileClick('defender', defenderPileClass)}>
                        <TrickPile count={defenderTricksCount} />
                    </div>
                </div>
                
                {/* Widow will be rendered separately using widowPileClass */}
            </>
        );
    };

    const renderProgressBars = () => {
        const { theme, state, bidWinnerInfo, bidderCardPoints, defenderCardPoints, playerOrderActive } = currentTableState;
        if (!bidWinnerInfo || theme !== 'miss-pauls-academy' || state !== 'Playing Phase') {
            return null;
        }

        const bidderName = bidWinnerInfo.playerName;
        const defenderNames = playerOrderActive.filter(name => name !== bidderName);

        return (
            <div className="progress-bar-area">
                <ScoreProgressBar 
                    label={defenderNames.join(' & ')}
                    currentPoints={defenderCardPoints} 
                    opponentPoints={bidderCardPoints}
                    team="defender"
                />
                <ScoreProgressBar 
                    label={bidderName}
                    currentPoints={bidderCardPoints} 
                    opponentPoints={defenderCardPoints}
                    team="bidder"
                />
            </div>
        );
    };

    // Pucks are now rendered as overlays on PlayerSeat components

    // Helper function to get player by name
    const getPlayerByName = (name) => {
        const { players } = currentTableState;
        return players ? Object.values(players).find(p => p.playerName === name) : null;
    };

    const renderTrumpIndicatorPuck = () => {
        const { trumpSuit, trumpBroken, bidWinnerInfo } = currentTableState;
        if (!trumpSuit || !bidWinnerInfo) {
            return null;
        }

        const bidType = bidWinnerInfo.bid;
        
        // Determine trump indicator image based on bid type
        let trumpImageSrc = '';
        if (bidType === 'Heart Solo') {
            trumpImageSrc = '/assets/trump-pucks/HeartSoloTrumpPuck.png';
        } else if (bidType === 'Frog') {
            trumpImageSrc = '/assets/trump-pucks/FrogTrumpPuck.png';
        } else {
            // Solo bids use suit-specific images
            const suitMap = {
                'H': 'HeartSolo',
                'D': 'DiamondSolo',
                'S': 'SpadeSolo',
                'C': 'ClubSolo'
            };
            const suitName = suitMap[trumpSuit] || 'ClubSolo';
            trumpImageSrc = `/assets/trump-pucks/${suitName}TrumpPuck.png`;
        }

        const classes = [
            'trump-indicator-puck',
            trumpBroken ? 'broken' : 'connected'
        ].filter(Boolean).join(' ');
        
        const title = trumpBroken ? 'Trump has been broken!' : `Trump is ${trumpSuit} (${bidType})`;

        return (
            <div className={classes} title={title}>
                <img 
                    src={trumpImageSrc} 
                    alt={bidType}
                    className="trump-puck-icon"
                />
                <div className={`trump-state-indicator ${trumpBroken ? 'broken' : 'connected'}`}></div>
            </div>
        );
    };

    const renderTrumpBrokenAnnouncement = () => {
        if (!trumpBrokenAnnouncementVisible) {
            return null;
        }

        return (
            <div className="trump-broken-announcement">
                <div className="trump-broken-content">
                    <div className="trump-broken-lightning">⚡</div>
                    <div className="trump-broken-text">TRUMP BROKEN!</div>
                    <div className="trump-broken-lightning">⚡</div>
                </div>
            </div>
        );
    };

    const renderWidowRevealAnnouncement = () => {
        if (!widowRevealVisible) {
            return null;
        }

        return (
            <div className="trump-broken-announcement">
                <div className="trump-broken-content widow-reveal-content">
                    <div className="trump-broken-lightning">🃏</div>
                    <div className="trump-broken-text">WIDOW REVEAL!</div>
                    <div className="trump-broken-lightning">🃏</div>
                </div>
            </div>
        );
    };

    // Overlay of the widow cards animated from the widow pile -> center -> awarded
    // pile during the end-of-round celebration (positioning driven by the effect above).
    const renderWidowCelebration = () => {
        if (!widowCelebrationActive) {
            return null;
        }
        const widowCards = currentTableState.roundSummary?.widowForReveal || [];
        if (!widowCards.length) {
            return null;
        }
        return (
            <div className="widow-celebration-overlay">
                {widowCards.map((card, i) => (
                    <div
                        key={`${card}-${i}`}
                        className="widow-celebration-card"
                        ref={(el) => { widowCardRefs.current[i] = el; }}
                    >
                        <div className={`widow-flip${widowFlipped ? ' revealed' : ''}`}>
                            <div className="widow-flip-face widow-flip-front">
                                {renderCard(card, { large: true })}
                            </div>
                            <div className="widow-flip-face widow-flip-back">
                                {renderCard(null, { isFaceDown: true, large: true })}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        );
    };

    const renderDealerDeck = () => {
        const { state, dealer, players } = currentTableState;
        
        // Only show deck during "Dealing Pending" state
        if (state !== 'Dealing Pending' || !dealer || !players) {
            return null;
        }

        // Find the dealer's name and position
        const dealerPlayer = Object.values(players).find(p => p.userId === dealer);
        if (!dealerPlayer) return null;

        const dealerName = dealerPlayer.playerName;
        let deckPosition = '';
        
        // Determine dealer position based on seat assignments
        if (seatAssignments.self === dealerName) {
            deckPosition = 'bottom';
        } else if (seatAssignments.opponentLeft === dealerName) {
            deckPosition = 'left';
        } else if (seatAssignments.opponentRight === dealerName) {
            deckPosition = 'right';
        } else {
            return null; // Dealer not in current player's view
        }

        return (
            <div className={`dealer-deck-container dealer-deck-${deckPosition}`}>
                <div className="dealer-deck-label">
                    {dealerName} is dealing...
                </div>
                <div className="dealer-deck-pile">
                    {/* Stack of 36 face-down cards */}
                    {FULL_DECK.map((_, index) => (
                        <div 
                            key={index} 
                            className="dealer-deck-card-wrapper" 
                            style={{ 
                                transform: `translateY(-${index * 0.5}px) translateX(-${index * 0.2}px)`,
                                zIndex: 50 + index
                            }}
                        >
                            {renderCard(null, { isFaceDown: true, small: true })}
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    // The WIDOW nameplate seat is retired (July 2026): in 3-player the top
    // seat simply stays empty, in 4-player the across player sits there. The
    // widow PILE (renderWidowPile) remains in both modes.

    const renderWidowPile = () => {
        const { playerOrderActive, state, widow, originalDealtWidow, roundSummary, bidWinnerInfo } = currentTableState;
        
        const hiddenStates = ["Waiting for Players", "Ready to Start", "Dealing Pending"];
        if (hiddenStates.includes(state)) {
            return null;
        }
        
        // Don't show widow pile if no bid winner yet
        if (!bidWinnerInfo) {
            return null;
        }
        
        // The widow pile renders in both modes — in 4-player it's also the
        // sitting-out dealer's peek target (docs/FOUR_PLAYER_SPEC.md).
        if (!playerOrderActive || playerOrderActive.length === 0) {
            return null;
        }

        // Get the widow pile position from trick pile calculation
        const widowPileClass = currentTableState._widowPilePosition || 'pile-bottom-left';
        
        // Players watch the animated reveal: the static pile stays face-down, then
        // becomes an empty plate once the celebration lifts the cards out. Spectators
        // (who don't see the animation) get the revealed widow.
        const isRoundOver = state === 'Awaiting Next Round Trigger' || state === 'Game Over';
        const showRevealed = isRoundOver && isSpectator;
        const cardsToDisplay = showRevealed ? roundSummary?.widowForReveal : (widow || originalDealtWidow);
        const widowSize = (widowCelebrationActive && !isSpectator) ? 0 : (cardsToDisplay?.length || 0);
        
        const dealerCanPeek = currentTableState.playerMode === 4;
        return (
            <div
                className={`trick-pile-container ${widowPileClass}`}
                onClick={dealerCanPeek ? handleWidowPileClick : undefined}
                style={dealerCanPeek ? { cursor: 'pointer', pointerEvents: 'auto' } : undefined}
            >
                <div className="trick-pile-base widow-base">
                    <div className="trick-pile">
                        <div className="trick-pile-content-wrapper">
                            <div className="trick-pile-cards">
                                {widowSize === 0 ? (
                                    renderCard(null, { isFaceDown: true, style: { opacity: 0.3 }, small: true })
                                ) : showRevealed ? (
                                    // Show revealed widow cards stacked
                                    cardsToDisplay.map((card, i) => (
                                        <div key={card + i} style={{ 
                                            position: i === 0 ? 'relative' : 'absolute',
                                            top: 0,
                                            left: 0,
                                            transform: `translateY(-${i * 2}px)` 
                                        }}>
                                            {renderCard(card, { small: true })}
                                        </div>
                                    ))
                                ) : (
                                    // Show face-down widow cards stacked
                                    Array.from({ length: widowSize }).map((_, i) => (
                                        <div key={i} style={{ 
                                            position: i === 0 ? 'relative' : 'absolute',
                                            top: 0,
                                            left: 0,
                                            transform: `translateY(-${i * 2}px)` 
                                        }}>
                                            {renderCard(null, { isFaceDown: true, small: true })}
                                        </div>
                                    ))
                                )}
                            </div>
                            <span className="trick-pile-count">W</span>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    // Extract bidder name for use in render
    const bidderName = currentTableState?.bidWinnerInfo?.playerName;

    return (
        <main className="game-table">
            <div className="table-oval">
                <div ref={dropZoneRef} className="card-drop-zone-hitbox">
                    <div className="card-drop-zone-visual"></div>
                </div>
                
                <PlayerSeatPositioner
                    playerName={seatAssignments.opponentLeft}
                    currentTableState={currentTableState}
                    isSelf={false}
                    emitEvent={emitEvent}
                    renderCard={renderCard}
                    seatPosition="left"
                    PlayerSeat={PlayerSeat}
                    rotation={0}
                    debugMode={showDebugAnchors}
                />
                <PlayerSeatPositioner
                    playerName={seatAssignments.opponentRight}
                    currentTableState={currentTableState}
                    isSelf={false}
                    emitEvent={emitEvent}
                    renderCard={renderCard}
                    seatPosition="right"
                    PlayerSeat={PlayerSeat}
                    rotation={0}
                    debugMode={showDebugAnchors}
                />
                {/* 4-player: the across player takes the top seat (the widow
                    seat in 3-player). null playerName renders nothing. */}
                {seatAssignments.opponentAcross && (
                    <PlayerSeatPositioner
                        playerName={seatAssignments.opponentAcross}
                        currentTableState={currentTableState}
                        isSelf={false}
                        emitEvent={emitEvent}
                        renderCard={renderCard}
                        seatPosition="top"
                        PlayerSeat={PlayerSeat}
                        rotation={0}
                        debugMode={showDebugAnchors}
                    />
                )}

                <img
                    src="/SluffLogo.png" 
                    alt="Sluff Watermark" 
                    className="sluff-watermark"
                />
                
                {renderTrickTallyPiles()}
                {renderWidowPile()}
                {renderLastTrickOverlay()}
                {renderWidowPeekOverlay()}
                {/* Pucks are now rendered individually below */}
                {renderTrumpBrokenAnnouncement()}
                {renderWidowRevealAnnouncement()}
                {renderWidowCelebration()}
                {renderDealerDeck()}

                {renderProgressBars()}
                
                <PlayerSeatPositioner
                    playerName={seatAssignments.self}
                    currentTableState={currentTableState}
                    isSelf={true}
                    emitEvent={emitEvent}
                    showTrumpIndicator={seatAssignments.self === bidderName}
                    trumpIndicatorPuck={renderTrumpIndicatorPuck()}
                    renderCard={renderCard}
                    seatPosition="bottom"
                    PlayerSeat={PlayerSeat}
                    rotation={0}
                    debugMode={showDebugAnchors}
                />

                {renderPlayedCardsOnTable()}
                {renderCardDropZones()}
                
                {/* Pucks are now rendered as "ears" on PlayerSeat components */}
                
                <ActionControls
                    currentTableState={currentTableState}
                    playerId={playerId}
                    selfPlayerName={selfPlayerName}
                    isSpectator={isSpectator}
                    emitEvent={emitEvent}
                    handleLeaveTable={handleLeaveTable}
                    renderCard={renderCard}
                    isAdmin={isAdmin}
                />
            </div>
        </main>
    );
};

export default TableLayout;