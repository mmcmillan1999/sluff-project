// frontend/src/components/game/TableLayout.js
import React, { useState, useEffect } from 'react';
import ScoreProgressBar from './ScoreProgressBar';
import './KeyAndModal.css';
import './TableLayout.css'; 
import { SUIT_SYMBOLS } from '../../constants';

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
}) => {
    const [lastTrickVisible, setLastTrickVisible] = useState(false);
    const lastTrickTimerRef = React.useRef(null);

    useEffect(() => {
        return () => {
            if (lastTrickTimerRef.current) {
                clearTimeout(lastTrickTimerRef.current);
            }
        };
    }, []);

    const handleTrickPileClick = (clickedPile) => {
        const { lastCompletedTrick, bidWinnerInfo } = currentTableState;
        if (!lastCompletedTrick || !bidWinnerInfo) return;

        const winnerIsBidder = lastCompletedTrick.winnerName === bidWinnerInfo.playerName;
        const clickedWinnerPile = (clickedPile === 'bidder' && winnerIsBidder) || (clickedPile === 'defender' && !winnerIsBidder);

        if (clickedWinnerPile) {
            if (lastTrickTimerRef.current) clearTimeout(lastTrickTimerRef.current);
            setLastTrickVisible(true);
            lastTrickTimerRef.current = setTimeout(() => {
                setLastTrickVisible(false);
            }, 3000); // Show for 3 seconds
        } else {
            playSound('no_peaking_cheater');
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
                <div style={{ position: 'absolute', bottom: '30%', left: '50%', transform: 'translateX(-50%)' }}>
                    {getPlayedCardForPlayer(seatAssignments.self)}
                </div>
                <div style={{ position: 'absolute', top: '50%', left: '25%', transform: 'translateY(-50%)' }}>
                    {getPlayedCardForPlayer(seatAssignments.opponentLeft)}
                </div>
                <div style={{ position: 'absolute', top: '50%', right: '25%', transform: 'translateY(-50%)' }}>
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
                                <div key={i} className="trick-pile-card-wrapper" style={{ transform: `translateY(-${i * 2}px)` }}>
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
                <div className="trick-pile-container defender-pile" onClick={() => handleTrickPileClick('defender')}>
                    <div className={`trick-pile-base defender-base ${defenderWonLast ? 'pulsating-blue' : ''}`}>
                        <TrickPile count={defenderTricksCount} />
                    </div>
                </div>
                <div className="trick-pile-container bidder-pile" onClick={() => handleTrickPileClick('bidder')}>
                    <div className={`trick-pile-base bidder-base ${bidderWonLast ? 'pulsating-gold' : ''}`}>
                        <TrickPile count={bidderTricksCount} />
                    </div>
                </div>
            </>
        );
    };

    const renderProgressBars = () => {
        const { theme, state, bidWinnerInfo, bidderCardPoints, defenderCardPoints } = currentTableState;
        if (!bidWinnerInfo || theme !== 'miss-pauls-academy' || state !== 'Playing Phase') {
            return null;
        }

        return (
            <>
                <div className="progress-bar-container defender-progress-container">
                    <ScoreProgressBar 
                        currentPoints={defenderCardPoints} 
                        opponentPoints={bidderCardPoints}
                        barColor="linear-gradient(to right, #3b82f6, #60a5fa)"
                    />
                </div>
                <div className="progress-bar-container bidder-progress-container">
                    <ScoreProgressBar 
                        currentPoints={bidderCardPoints} 
                        opponentPoints={defenderCardPoints}
                        barColor="linear-gradient(to right, #f59e0b, #facc15)"
                    />
                </div>
            </>
        );
    };

    const renderWidowDisplay = () => {
        const { state, widow, originalDealtWidow, roundSummary } = currentTableState;
        
        const hiddenStates = ["Waiting for Players", "Ready to Start", "Dealing Pending", "Frog Widow Exchange"];
        if (hiddenStates.includes(state)) {
            return null;
        }

        const isRoundOver = state === 'Awaiting Next Round Trigger' || state === 'Game Over';
        
        const cardsToDisplay = isRoundOver ? roundSummary?.widowForReveal : (widow || originalDealtWidow);
        const widowSize = cardsToDisplay?.length || 0;

        if (widowSize === 0) {
            return null;
        }

        return (
            <div className="widow-display-container">
                <div className="widow-pile">
                    {isRoundOver 
                        ? (
                            cardsToDisplay.map((card, i) => (
                                <div key={card + i} className="trick-pile-card-wrapper" style={{ transform: `translateX(${i * 15}px)` }}>
                                    {renderCard(card, { small: true })}
                                </div>
                            ))
                        ) : (
                            Array.from({ length: widowSize }).map((_, i) => (
                                <div key={i} className="trick-pile-card-wrapper" style={{ transform: `translateX(${i * 15}px)` }}>
                                    {renderCard(null, { isFaceDown: true, small: true })}
                                </div>
                            ))
                        )
                    }
                </div>
                <span className="widow-pile-label">Widow</span>
            </div>
        );
    };

    const renderTrumpIndicatorPuck = () => {
        const { trumpSuit, trumpBroken } = currentTableState;
        if (!trumpSuit) {
            return null;
        }

        const classes = [
            'trump-indicator-puck',
            trumpBroken ? 'broken' : ''
        ].filter(Boolean).join(' ');
        
        const title = trumpBroken ? 'Trump has been broken!' : `Trump is ${trumpSuit}`;

        return (
            <div className={classes} title={title}>
                {SUIT_SYMBOLS[trumpSuit]}
            </div>
        );
    };

    return (
        <main className="game-table">
            <div className="table-oval">
                <div className="player-seat-left">
                    <PlayerSeat playerName={seatAssignments.opponentLeft} currentTableState={currentTableState} isSelf={false} emitEvent={emitEvent} />
                </div>
                <div className="player-seat-right">
                    <PlayerSeat playerName={seatAssignments.opponentRight} currentTableState={currentTableState} isSelf={false} emitEvent={emitEvent} />
                </div>

                <img 
                    src="/SluffLogo.png" 
                    alt="Sluff Watermark" 
                    style={{
                        position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                        width: '40%', maxWidth: '350px', opacity: 0.1, pointerEvents: 'none'
                    }} 
                />
                
                {renderWidowDisplay()}
                {renderTrumpIndicatorPuck()}
                {renderTrickTallyPiles()}
                {renderLastTrickOverlay()}

                <div className="player-seat-bottom">
                    <PlayerSeat playerName={seatAssignments.self} currentTableState={currentTableState} isSelf={true} emitEvent={emitEvent} />
                </div>

                {renderPlayedCardsOnTable()}
                
                <div className="action-message-container">
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
            </div>
            {renderProgressBars()}
        </main>
    );
};

export default TableLayout;