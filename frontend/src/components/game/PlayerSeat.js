// frontend/src/components/game/PlayerSeat.js
import React from 'react';
import './PlayerSeat.css'; // Import the CSS file

const PlayerSeat = ({ playerName, currentTableState, isSelf, emitEvent }) => {
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

    // --- MODIFICATION: New border styling logic ---
    let borderColor = '#ccc'; // Default
    if (isBidWinner) {
        borderColor = '#ffc107'; // Gold
    } else if (isDefender) {
        borderColor = '#0d6efd'; // Blue
    }
    if (disconnected) {
        borderColor = 'red';
    }
    const dynamicStyles = {
        border: `3px solid ${borderColor}`, // Thicker border
    };

    const seatClasses = [
        'player-seat',
        isMyTurn && 'active-turn'
    ].filter(Boolean).join(' ');

    const nameClasses = ['player-name', isSelf && 'is-self'].filter(Boolean).join(' ');

    const handleStartTimer = () => {
        emitEvent("startTimeoutClock", { targetPlayerName: playerName });
    };

    return (
        <div className="player-seat-wrapper">
            {/* Pucks are now rendered in TableLayout */}
            <div className={seatClasses} style={dynamicStyles}>
                <div className={nameClasses}>{playerName}</div>
                <div className="player-stats-line">
                    <span className="player-tokens">
                        <img src="/sluff_token.png" alt="Tokens" className="token-icon-inline" />
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