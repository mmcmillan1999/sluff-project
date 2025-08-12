// frontend/src/components/game/PlayerSeat.js
import React from 'react';
import './PlayerSeat.css'; // Import the CSS file

const PlayerSeat = ({ playerName, currentTableState, isSelf, emitEvent, showTrumpIndicator, trumpIndicatorPuck, renderCard, seatPosition }) => {
    if (!playerName) {
        return null; 
    }

    const {
        players,
        scores,
        bidWinnerInfo,
        playerOrderActive,
        trickTurnPlayerName,
        forfeiture
    } = currentTableState;

    const playerEntry = Object.values(players).find(p => p.playerName === playerName);

    if (!playerEntry) {
        return null;
    }

    // --- THE FIX: 'userId' was removed from this line as it was unused ---
    const { disconnected, tokens } = playerEntry; // Now getting tokens from playerEntry
    const playerTokenCount = tokens; // Use the value directly
    const isBidWinner = bidWinnerInfo?.playerName === playerName;
    const isDefender = bidWinnerInfo && !isBidWinner && playerOrderActive.includes(playerName);
    const isTimerRunningForThisPlayer = forfeiture?.targetPlayerName === playerName;
    const isMyTurn = trickTurnPlayerName === playerName;

    // Team indication border styling
    let borderColor = '#ccc'; // Default for non-players
    let borderWidth = '2px'; // Default width for non-players
    
    if (disconnected) {
        borderColor = 'red';
        borderWidth = '3px'; // Keep disconnected override
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
        isDefender && 'team-defender'
    ].filter(Boolean).join(' ');

    const nameClasses = ['player-name', isSelf && 'is-self'].filter(Boolean).join(' ');

    const handleStartTimer = () => {
        emitEvent("startTimeoutClock", { targetPlayerName: playerName });
    };

    // Render opponent cards (face-down)
    const renderOpponentCards = () => {
        // Opponent cards disabled per user request
        return null;
    };

    return (
        <div className="player-seat-wrapper">
            {/* Pucks are now rendered in TableLayout */}
            {renderOpponentCards()}
            <div className={seatClasses} style={dynamicStyles}>
                <div className={nameClasses}>
                    {playerName}
                </div>
                <div className="player-stats-line">
                    <span className="player-tokens">
                        <img src="/Sluff_Token.png" alt="Tokens" className="token-icon-inline" />
                        {/* --- MODIFICATION: Simplified token display logic --- */}
                        {playerTokenCount !== undefined && playerTokenCount !== 'N/A' ? parseFloat(playerTokenCount).toFixed(2) : '...'}
                    </span>
                    <span className="info-divider">|</span>
                    <span className="player-score">Points: {scores[playerName] ?? '120'}</span>
                </div>
                
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
        </div>
    );
};

export default PlayerSeat;