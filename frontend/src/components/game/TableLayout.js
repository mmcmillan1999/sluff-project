// frontend/src/components/game/TableLayout.js
import React, { useState } from 'react';
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
}) => {
    const [lastTrickVisible, setLastTrickVisible] = useState(false);

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
                <div style={{ position: 'absolute', bottom: '25%', left: '50%', transform: 'translateX(-50%)' }}>
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

    const renderLastTrickDisplay = () => {
        const { lastCompletedTrick, bidWinnerInfo } = currentTableState;
        if (!lastCompletedTrick || !bidWinnerInfo) {
            return null;
        }

        const winnerIsBidder = lastCompletedTrick.winnerName === bidWinnerInfo.playerName;
        const tabContainerClass = `last-trick-tab-container ${winnerIsBidder ? 'bidder' : 'defender'}`;
        const overlayContainerClass = `last-trick-overlay-container ${winnerIsBidder ? 'bidder' : 'defender'}`;

        return (
            <>
                <div className={tabContainerClass}>
                    <button className="last-trick-tab" onClick={() => setLastTrickVisible(!lastTrickVisible)}>
                        Last Trick
                    </button>
                </div>

                {lastTrickVisible && (
                     <div className={overlayContainerClass}>
                        <h4 className="last-trick-header">Last Trick (won by {lastCompletedTrick.winnerName})</h4>
                        <div className="last-trick-cards">
                            {lastCompletedTrick.cards.map(play => (
                                renderCard(play.card, { key: play.card, small: true })
                            ))}
                        </div>
                    </div>
                )}
            </>
        );
    };
    
    const renderTrickTallyPiles = () => {
        const { capturedTricks, bidWinnerInfo, playerOrderActive } = currentTableState;
        if (!bidWinnerInfo) return null;
        
        const bidderName = bidWinnerInfo.playerName;
        const bidderTricksCount = capturedTricks[bidderName]?.length || 0;
        const defenderTricksCount = playerOrderActive.reduce((acc, pName) => {
            if (pName !== bidderName) {
                return acc + (capturedTricks[pName]?.length || 0);
            }
            return acc;
        }, 0);

        const TrickPile = ({ count, label }) => (
            <div className="trick-pile">
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
                <span className="trick-pile-label">{label}: {count}</span>
            </div>
        );

        return (
            <>
                <div className="trick-pile-container defender-pile">
                    <TrickPile count={defenderTricksCount} label="Defenders" />
                </div>
                <div className="trick-pile-container bidder-pile">
                    <TrickPile count={bidderTricksCount} label="Bidder" />
                </div>
            </>
        );
    };

    // --- NEW: Standalone function to render only the progress bars ---
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
                {renderLastTrickDisplay()}

                <div className="player-seat-bottom">
                    <PlayerSeat playerName={seatAssignments.self} currentTableState={currentTableState} isSelf={true} emitEvent={emitEvent} />
                </div>

                {renderPlayedCardsOnTable()}
                
                <div style={{ position: 'absolute', top: '15%', left: '50%', transform: 'translateX(-50%)', zIndex: 10, width: '80%', textAlign: 'center' }}>
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
            {/* --- NEW: Render progress bars outside the oval --- */}
            {renderProgressBars()}
        </main>
    );
};

export default TableLayout;