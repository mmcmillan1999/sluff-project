// frontend/src/components/game/TableLayout.js
import React, { useState, useEffect, useRef } from 'react';
import { useViewport } from '../../hooks/useViewport';
import ScoreProgressBar from './ScoreProgressBar';
import PlayerSeatPositioner from './PlayerSeatPositioner';
import WidowSeat from './WidowSeat';
import { PLAYER_SEAT_CONFIG, getSeatConfig } from '../../config/PlayerSeatConfig';
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
    showDebugAnchors = false
}) => {
    const [lastTrickVisible, setLastTrickVisible] = useState(false);
    const [lastTrickPosition, setLastTrickPosition] = useState(null);
    const [trumpBrokenAnnouncementVisible, setTrumpBrokenAnnouncementVisible] = useState(false);
    const { width } = useViewport();
    const [previousTrumpBroken, setPreviousTrumpBroken] = useState(false);
    const lastTrickTimerRef = useRef(null);
    const trumpAnnouncementTimerRef = useRef(null);

    useEffect(() => {
        return () => {
            if (lastTrickTimerRef.current) {
                clearTimeout(lastTrickTimerRef.current);
            }
            if (trumpAnnouncementTimerRef.current) {
                clearTimeout(trumpAnnouncementTimerRef.current);
            }
        };
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
            
            // Show announcement
            setTrumpBrokenAnnouncementVisible(true);
            
            // Hide announcement after 2.5 seconds
            trumpAnnouncementTimerRef.current = setTimeout(() => {
                setTrumpBrokenAnnouncementVisible(false);
            }, 2500);
        }
        
        // Update previous state
        setPreviousTrumpBroken(trumpBroken);
    }, [currentTableState, previousTrumpBroken]);

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

    const renderPlayedCardsOnTable = () => {
        const isLingerState = currentTableState.state === 'TrickCompleteLinger';
        const cardsToDisplay = isLingerState ? currentTableState.lastCompletedTrick.cards : currentTableState.currentTrickCards;

        if (!cardsToDisplay || cardsToDisplay.length === 0 || isSpectator) {
            return null;
        }

        const getPlayedCardForPlayer = (pName) => {
            if (!pName) return renderCard(null, { large: true });
            const cardInfo = (cardsToDisplay || []).find(c => c.playerName === pName);
            return renderCard(cardInfo?.card, { large: true });
        };

        return (
            <>
                <div className="played-card-bottom">
                    {getPlayedCardForPlayer(seatAssignments.self)}
                </div>
                <div className="played-card-left">
                    {getPlayedCardForPlayer(seatAssignments.opponentLeft)}
                </div>
                <div className="played-card-right">
                    {getPlayedCardForPlayer(seatAssignments.opponentRight)}
                </div>
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
        const { capturedTricks, bidWinnerInfo, playerOrderActive, lastCompletedTrick } = currentTableState;
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

    const renderWidowSeat = () => {
        const { playerOrderActive, state } = currentTableState;
        
        const hiddenStates = ["Waiting for Players", "Ready to Start", "Dealing Pending"];
        if (hiddenStates.includes(state)) {
            return null;
        }
        
        const numPlayers = playerOrderActive?.length || 0;
        const isFourPlayer = numPlayers === 4;
        
        // In 4-player games, don't show separate widow seat (dealer is the widow)
        if (isFourPlayer) {
            return null;
        }
        
        // Only show the widow seat when there are less than 4 players
        if (!playerOrderActive || numPlayers >= 4) {
            return null;
        }
        
        // Determine widow position for 3-player games
        // Find the empty seat position
        let widowPosition = 'top'; // Default to top
        
        // Check which positions are occupied
        const occupiedPositions = new Set();
        if (seatAssignments.self) occupiedPositions.add('bottom');
        if (seatAssignments.opponentLeft) occupiedPositions.add('left');
        if (seatAssignments.opponentRight) occupiedPositions.add('right');
        
        // Place widow in the unoccupied position
        if (!occupiedPositions.has('top')) {
            widowPosition = 'top';
        } else if (!occupiedPositions.has('bottom')) {
            widowPosition = 'bottom';
        } else if (!occupiedPositions.has('left')) {
            widowPosition = 'left';
        } else if (!occupiedPositions.has('right')) {
            widowPosition = 'right';
        }
        
        // Get configuration for widow position
        const widowConfig = getSeatConfig(widowPosition);
        
        // Use PlayerSeatPositioner to handle positioning and collision mode
        return (
            <PlayerSeatPositioner
                playerName="WIDOW"
                currentTableState={currentTableState}
                isSelf={false}
                emitEvent={emitEvent}
                renderCard={renderCard}
                seatPosition={widowPosition}
                PlayerSeat={WidowSeat}  // Use WidowSeat component
                showTrumpIndicator={false}
                trumpIndicatorPuck={null}
                anchorX={widowConfig.anchorX}
                anchorY={widowConfig.anchorY}
                rotation={widowConfig.rotation}
                debugMode={showDebugAnchors}
            />
        );
    };

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
        
        const numPlayers = playerOrderActive?.length || 0;
        const isFourPlayer = numPlayers === 4;
        
        // In 4-player games, don't show separate widow pile (dealer is the widow)
        if (isFourPlayer) {
            return null;
        }
        
        // Only show the widow pile when there are less than 4 players
        if (!playerOrderActive || numPlayers >= 4) {
            return null;
        }
        
        // Get the widow pile position from trick pile calculation
        const widowPileClass = currentTableState._widowPilePosition || 'pile-bottom-left';
        
        // Get widow cards to display
        const isRoundOver = state === 'Awaiting Next Round Trigger' || state === 'Game Over';
        const cardsToDisplay = isRoundOver ? roundSummary?.widowForReveal : (widow || originalDealtWidow);
        const widowSize = cardsToDisplay?.length || 0;
        
        return (
            <div className={`trick-pile-container ${widowPileClass}`}>
                <div className="trick-pile-base widow-base">
                    <div className="trick-pile">
                        <div className="trick-pile-content-wrapper">
                            <div className="trick-pile-cards">
                                {widowSize === 0 ? (
                                    renderCard(null, { isFaceDown: true, style: { opacity: 0.3 }, small: true })
                                ) : isRoundOver ? (
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

                <img 
                    src="/SluffLogo.png" 
                    alt="Sluff Watermark" 
                    className="sluff-watermark"
                />
                
                {renderWidowSeat()}
                {renderTrickTallyPiles()}
                {renderWidowPile()}
                {renderLastTrickOverlay()}
                {/* Pucks are now rendered individually below */}
                {renderTrumpBrokenAnnouncement()}
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
                />
            </div>
        </main>
    );
};

export default TableLayout;