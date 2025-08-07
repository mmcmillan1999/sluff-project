// frontend/src/components/game/TableLayout.js
import React, { useState, useEffect, useRef } from 'react';
import ScoreProgressBar from './ScoreProgressBar';
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
    dropZoneRef
}) => {
    const [lastTrickVisible, setLastTrickVisible] = useState(false);
    const [trumpBrokenAnnouncementVisible, setTrumpBrokenAnnouncementVisible] = useState(false);
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

    const handleTrickPileClick = (clickedPile) => {
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
            lastTrickTimerRef.current = setTimeout(() => {
                setLastTrickVisible(false);
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

    const renderLastTrickOverlay = () => {
        const { lastCompletedTrick, bidWinnerInfo } = currentTableState;
        if (!lastTrickVisible || !lastCompletedTrick || !bidWinnerInfo) {
            return null;
        }
    
        const winnerIsBidder = lastCompletedTrick.winnerName === bidWinnerInfo.playerName;
        const overlayContainerClass = `last-trick-overlay-container ${winnerIsBidder ? 'bidder' : 'defender'}`;
    
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

        return (
            <>
                <div className="trick-pile-container defender-pile" >
                    <div className={`trick-pile-base defender-base ${defenderWonLast ? 'pulsating-blue' : ''}`} onClick={() => handleTrickPileClick('defender')}>
                        <TrickPile count={defenderTricksCount} />
                    </div>
                </div>
                <div className="trick-pile-container bidder-pile">
                    <div className={`trick-pile-base bidder-base ${bidderWonLast ? 'pulsating-gold' : ''}`} onClick={() => handleTrickPileClick('bidder')}>
                        <TrickPile count={bidderTricksCount} />
                    </div>
                </div>
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

    const renderPlayerPucks = () => {
        const { players, dealer } = currentTableState;

        const Puck = ({ player, position }) => {
            if (!player) return null;
            const isDealer = dealer === player.userId;

            return (
                <div className={`puck-container-${position}`}>
                    {isDealer && <div className="puck dealer-puck">D</div>}
                </div>
            );
        };

        const getPlayerByName = (name) => Object.values(players).find(p => p.playerName === name);

        return (
            <>
                <Puck player={getPlayerByName(seatAssignments.self)} position="bottom" />
                <Puck player={getPlayerByName(seatAssignments.opponentLeft)} position="left" />
                <Puck player={getPlayerByName(seatAssignments.opponentRight)} position="right" />
            </>
        );
    };

    // renderWidowDisplay removed - widow cards now rendered inside renderWidowSeat

    const renderTrumpIndicatorPuck = () => {
        const { trumpSuit, trumpBroken, bidWinnerInfo } = currentTableState;
        if (!trumpSuit || !bidWinnerInfo) {
            return null;
        }

        const bidType = bidWinnerInfo.bid;
        
        // Determine trump indicator content based on bid type
        let trumpContent = '';
        if (bidType === 'Heart Solo') {
            trumpContent = '♥♥♥'; // Three hearts for Heart Solo
        } else if (bidType === 'Frog') {
            trumpContent = '♥'; // Single heart for Frog
        } else {
            trumpContent = SUIT_SYMBOLS[trumpSuit]; // Trump suit symbol for regular solo
        }

        const classes = [
            'trump-indicator-puck',
            trumpBroken ? 'broken' : 'connected'
        ].filter(Boolean).join(' ');
        
        const title = trumpBroken ? 'Trump has been broken!' : `Trump is ${trumpSuit} (${bidType})`;

        return (
            <div className={classes} title={title}>
                <div className="trump-content">{trumpContent}</div>
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
        const { playerOrderActive, state, widow, originalDealtWidow, roundSummary } = currentTableState;
        
        // Only show the widow seat when there are less than 4 players
        if (!playerOrderActive || playerOrderActive.length >= 4) {
            return null;
        }
        
        const hiddenStates = ["Waiting for Players", "Ready to Start", "Dealing Pending"];
        if (hiddenStates.includes(state)) {
            return null;
        }
        
        // Get widow cards to display
        const isRoundOver = state === 'Awaiting Next Round Trigger' || state === 'Game Over';
        const cardsToDisplay = isRoundOver ? roundSummary?.widowForReveal : (widow || originalDealtWidow);
        const widowSize = cardsToDisplay?.length || 0;
        
        return (
            <div className="widow-seat">
                <div className="widow-seat-plate">
                    <div className="widow-name-row">
                        <div className="widow-name">WIDOW</div>
                        {widowSize > 0 && (
                            <div className="widow-cards-inline">
                                {isRoundOver 
                                    ? (
                                        cardsToDisplay.map((card, i) => (
                                            <div key={card + i} style={{ 
                                                transform: `translateX(${i * 15}px)`, 
                                                position: 'absolute', 
                                                top: 0, 
                                                left: 0 
                                            }}>
                                                {renderCard(card, { small: true })}
                                            </div>
                                        ))
                                    ) : (
                                        Array.from({ length: widowSize }).map((_, i) => (
                                            <div key={i} style={{ 
                                                transform: `translateX(${i * 15}px)`, 
                                                position: 'absolute', 
                                                top: 0, 
                                                left: 0 
                                            }}>
                                                {renderCard(null, { isFaceDown: true, small: true })}
                                            </div>
                                        ))
                                    )
                                }
                            </div>
                        )}
                    </div>
                    <div className="widow-stats-line">
                        <span className="widow-tokens">---</span>
                        <span className="info-divider">|</span>
                        <span className="widow-score">Empty Seat</span>
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
                
                <div className="player-seat-left">
                    <PlayerSeat 
                        playerName={seatAssignments.opponentLeft} 
                        currentTableState={currentTableState} 
                        isSelf={false} 
                        emitEvent={emitEvent}
                        renderCard={renderCard}
                        seatPosition="left"
                    />
                    {seatAssignments.opponentLeft === bidderName && renderTrumpIndicatorPuck()}
                </div>
                <div className="player-seat-right">
                    <PlayerSeat 
                        playerName={seatAssignments.opponentRight} 
                        currentTableState={currentTableState} 
                        isSelf={false} 
                        emitEvent={emitEvent}
                        renderCard={renderCard}
                        seatPosition="right"
                    />
                    {seatAssignments.opponentRight === bidderName && renderTrumpIndicatorPuck()}
                </div>

                <img 
                    src="/SluffLogo.png" 
                    alt="Sluff Watermark" 
                    className="sluff-watermark"
                />
                
                {renderWidowSeat()}
                
                {/* Desktop-only: Render widow cards separately from seat */}
                {window.innerWidth >= 1024 && (() => {
                    const { playerOrderActive, state, widow, originalDealtWidow, roundSummary } = currentTableState;
                    if (!playerOrderActive || playerOrderActive.length >= 4) return null;
                    const hiddenStates = ["Waiting for Players", "Ready to Start", "Dealing Pending"];
                    if (hiddenStates.includes(state)) return null;
                    
                    const isRoundOver = state === 'Awaiting Next Round Trigger' || state === 'Game Over';
                    const cardsToDisplay = isRoundOver ? roundSummary?.widowForReveal : (widow || originalDealtWidow);
                    const widowSize = cardsToDisplay?.length || 0;
                    
                    if (widowSize > 0) {
                        return (
                            <div className="widow-cards-desktop">
                                {isRoundOver 
                                    ? cardsToDisplay.map((card, i) => (
                                        <div key={card + i} style={{ marginLeft: i > 0 ? '10px' : '0' }}>
                                            {renderCard(card, { small: false })}
                                        </div>
                                    ))
                                    : Array.from({ length: widowSize }).map((_, i) => (
                                        <div key={i} style={{ marginLeft: i > 0 ? '10px' : '0' }}>
                                            {renderCard(null, { isFaceDown: true, small: false })}
                                        </div>
                                    ))
                                }
                            </div>
                        );
                    }
                    return null;
                })()}
                
                {renderTrickTallyPiles()}
                {renderLastTrickOverlay()}
                {renderPlayerPucks()}
                {renderTrumpBrokenAnnouncement()}
                {renderDealerDeck()}

                {renderProgressBars()}
                
                <div className="player-seat-bottom">
                    <PlayerSeat 
                        playerName={seatAssignments.self} 
                        currentTableState={currentTableState} 
                        isSelf={true} 
                        emitEvent={emitEvent}
                        showTrumpIndicator={seatAssignments.self === bidderName}
                        trumpIndicatorPuck={renderTrumpIndicatorPuck()}
                        renderCard={renderCard}
                        seatPosition="bottom"
                    />
                </div>

                {renderPlayedCardsOnTable()}
                
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