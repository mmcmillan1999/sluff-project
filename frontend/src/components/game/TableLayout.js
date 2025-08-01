// frontend/src/components/game/TableLayout.js
import React, { useState, useEffect, useRef } from 'react';
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
    dropZoneRef
}) => {
    const [lastTrickVisible, setLastTrickVisible] = useState(false);
    const lastTrickTimerRef = useRef(null);

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
            }, 3000);
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
        const { players, dealer, bidWinnerInfo, trumpSuit, playerOrderActive } = currentTableState;
        if (!playerOrderActive || playerOrderActive.length === 0) return null;

        const Puck = ({ player, position }) => {
            if (!player) return null;
            const isDealer = dealer === player.userId;
            const isBidWinner = bidWinnerInfo?.playerName === player.playerName;
            const isDefender = bidWinnerInfo && !isBidWinner && playerOrderActive.includes(player.playerName);

            let rolePuckContent = null;
            if (isBidWinner) {
                switch (bidWinnerInfo.bid) {
                    case "Frog": rolePuckContent = "FROG"; break;
                    case "Heart Solo": rolePuckContent = "H-S"; break;
                    case "Solo": rolePuckContent = `${trumpSuit}-S`; break;
                    default: break;
                }
            } else if (isDefender) {
                rolePuckContent = "TEAM";
            }
            
            const rolePuckClasses = ['puck', 'role-puck', isBidWinner ? 'bid-winner' : 'defender', rolePuckContent?.length > 3 && 'small-font'].filter(Boolean).join(' ');

            return (
                <div className={`puck-container-${position}`}>
                    {isDealer && <div className="puck dealer-puck">D</div>}
                    {rolePuckContent && <div className={rolePuckClasses}>{rolePuckContent}</div>}
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
                <div ref={dropZoneRef} className="card-drop-zone-hitbox">
                    <div className="card-drop-zone-visual"></div>
                </div>
                
                <div className="player-seat-left">
                    <PlayerSeat playerName={seatAssignments.opponentLeft} currentTableState={currentTableState} isSelf={false} emitEvent={emitEvent} />
                </div>
                <div className="player-seat-right">
                    <PlayerSeat playerName={seatAssignments.opponentRight} currentTableState={currentTableState} isSelf={false} emitEvent={emitEvent} />
                </div>

                <img 
                    src="/SluffLogo.png" 
                    alt="Sluff Watermark" 
                    className="sluff-watermark"
                />
                
                {renderWidowDisplay()}
                {renderTrumpIndicatorPuck()}
                {renderTrickTallyPiles()}
                {renderLastTrickOverlay()}
                {renderPlayerPucks()}
                {renderProgressBars()}

                <div className="player-seat-bottom">
                    <PlayerSeat playerName={seatAssignments.self} currentTableState={currentTableState} isSelf={true} emitEvent={emitEvent} />
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