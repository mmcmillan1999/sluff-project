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
        dealer,
        bidWinnerInfo,
        trumpSuit,
        playerOrderActive,
        trickTurnPlayerName,
        forfeiture
    } = currentTableState;

    const playerEntry = Object.values(players).find(p => p.playerName === playerName);

    if (!playerEntry) {
        return null;
    }

    const { userId, disconnected } = playerEntry;
    const isBidWinner = bidWinnerInfo?.playerName === playerName;
    const isDefender = bidWinnerInfo && !isBidWinner && playerOrderActive.includes(playerName);
    const isTimerRunningForThisPlayer = forfeiture?.targetPlayerName === playerName;
    const isMyTurn = trickTurnPlayerName === playerName;

    // --- FIX: Removed unused variables 'isDealer' and 'rolePuckClasses' ---

    const seatClasses = [
        'player-seat',
        isBidWinner && 'bid-winner',
        isDefender && 'defender',
        disconnected && 'disconnected',
        isMyTurn && 'active-turn',
        !isSelf && 'opponent-seat'
    ].filter(Boolean).join(' ');

    const nameClasses = ['player-name', isSelf && 'is-self'].filter(Boolean).join(' ');

    const handleStartTimer = () => {
        emitEvent("startTimeoutClock", { targetPlayerName: playerName });
    };

    return (
        <div className="player-seat-wrapper">
            {/* Pucks are still commented out for debugging the main layout */}

            <div className={seatClasses}>
                <div className="player-name-wrapper">
                    <div className={nameClasses}>{playerName}</div>
                </div>
                {isSelf && (
                    <div className="player-stats-line">
                        <span className="player-tokens">
                            {/* Tokens are not available in this scope, simplifying to points only */}
                        </span>
                        <span className="player-score">Points: {scores[playerName] ?? '120'}</span>
                    </div>
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
        </div>
    );
};

export default PlayerSeat;