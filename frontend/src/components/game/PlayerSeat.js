// frontend/src/components/game/PlayerSeat.js
import React from 'react';
import './PlayerSeat.css'; // Import the CSS file
import ScoreChipStack from './ScoreChipStack';

const SCORE_ANIMATION_STATES = new Set([
    'WidowReveal',
    'Awaiting Next Round Trigger',
    'Game Over',
]);

const PlayerSeat = ({ playerName, currentTableState, isSelf, emitEvent, showTrumpIndicator, trumpIndicatorPuck, renderCard, seatPosition, onPlayerProfile }) => {
    if (!playerName) {
        return null; 
    }

    const {
        players,
        scores,
        bidWinnerInfo,
        playerOrderActive,
        trickTurnPlayerName,
        forfeiture,
        dealer,
        trumpSuit,
        trumpBroken
    } = currentTableState;

    const playerEntry = Object.values(players).find(p => p.playerName === playerName);

    if (!playerEntry) {
        return null;
    }

    const { disconnected, userId } = playerEntry;
    const isBidWinner = bidWinnerInfo?.playerName === playerName;
    const isDefender = bidWinnerInfo && !isBidWinner && playerOrderActive.includes(playerName);
    const isDealer = dealer === userId;
    // 4-player: the dealer sits the round out — black border marks them.
    const isSittingOutDealer = isDealer && currentTableState.playerMode === 4 && currentTableState.gameStarted;
    const isTimerRunningForThisPlayer = forfeiture?.targetPlayerName === playerName;
    const isMyTurn = trickTurnPlayerName === playerName;

    // Team indication border styling
    let borderColor = '#ccc'; // Default for non-players
    let borderWidth = '2px'; // Default width for non-players

    if (disconnected) {
        borderColor = 'red';
        borderWidth = '3px'; // Keep disconnected override
    } else if (isSittingOutDealer) {
        borderColor = '#111'; // Black for the sitting-out 4-player dealer
        borderWidth = '5px';
    } else if (isBidWinner) {
        borderColor = '#ffc107'; // Gold for bidder
        borderWidth = '5px';
    } else if (isDefender) {
        borderColor = '#0d6efd'; // Blue for defenders
        borderWidth = '5px';
    }

    const dynamicStyles = {
        border: `${borderWidth} solid ${borderColor}`,
    };

    const seatClasses = [
        'player-seat',
        isMyTurn && 'active-turn',
        isBidWinner && 'team-bidder',
        isDefender && 'team-defender',
        isSittingOutDealer && 'sitting-out-dealer'
    ].filter(Boolean).join(' ');

    const nameClasses = ['player-name', isSelf && 'is-self'].filter(Boolean).join(' ');
    const rawScoreAnimationReadyAt = currentTableState.roundSummary?.presentationReadyAt;
    const scoreAnimationReadyAt = Number(rawScoreAnimationReadyAt);
    const scoreAnimationScope = SCORE_ANIMATION_STATES.has(currentTableState.state)
        && rawScoreAnimationReadyAt !== null
        && rawScoreAnimationReadyAt !== undefined
        && Number.isFinite(scoreAnimationReadyAt)
        ? `${currentTableState.tableId || 'table'}:${scoreAnimationReadyAt}`
        : null;

    const handleStartTimer = () => {
        emitEvent("startTimeoutClock", { targetPlayerName: playerName });
    };

    // Render opponent cards (face-down)
    const renderOpponentCards = () => {
        // Opponent cards disabled per user request
        return null;
    };

    return (
        <div className={`player-seat-wrapper player-seat-wrapper-${seatPosition || 'unknown'}`}>
            {/* Dealer puck - top left ear */}
            {isDealer && (
                <div className="seat-puck dealer-puck-ear">
                    <span className="seat-puck-label">D</span>
                </div>
            )}
            
            {/* Bidder/Trump puck - top right ear */}
            {isBidWinner && bidWinnerInfo && trumpSuit && (() => {
                // Determine trump indicator image based on bid type
                let trumpImageSrc = '';
                const bidType = bidWinnerInfo.bid;
                
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
                
                return (
                    <div className="seat-puck bidder-puck-ear trump-indicator-puck">
                        <img 
                            src={trumpImageSrc}
                            alt={bidType}
                            className="trump-puck-icon"
                        />
                    </div>
                );
            })()}
            
            {renderOpponentCards()}
            <div className={seatClasses} style={dynamicStyles}>
                {onPlayerProfile ? (
                    <button
                        type="button"
                        className={`${nameClasses} player-name-button`}
                        onPointerDown={event => event.stopPropagation()}
                        onClick={event => {
                            event.stopPropagation();
                            onPlayerProfile(playerName);
                        }}
                        aria-label={isSelf ? 'View your player profile' : `View ${playerName}'s player profile`}
                    >
                        {playerName}
                    </button>
                ) : (
                    <div className={nameClasses}>{playerName}</div>
                )}
                {disconnected && (
                    <div className="disconnected-controls">
                        {isTimerRunningForThisPlayer ? (
                            <div className="timeout-display">
                                Time Left: {forfeiture.timeLeft}s
                            </div>
                        ) : (
                            <button className="start-timer-button" onClick={handleStartTimer}>
                                Start 2-Min Timer
                            </button>
                        )}
                    </div>
                )}
            </div>
            <ScoreChipStack
                score={scores?.[playerName]}
                playerName={playerName}
                seatPosition={seatPosition}
                animationScope={scoreAnimationScope}
            />
        </div>
    );
};

export default PlayerSeat;
