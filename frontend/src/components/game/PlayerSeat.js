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
        forfeiture,
        roundSummary,
        playerTokens 
    } = currentTableState;

    const playerEntry = Object.values(players).find(p => p.playerName === playerName);

    if (!playerEntry) {
        return null;
    }

    const { userId, disconnected } = playerEntry;
    const playerTokenCount = playerTokens?.[playerName] ?? roundSummary?.playerTokens?.[playerName];
    const isDealer = dealer === userId;
    const isBidWinner = bidWinnerInfo?.playerName === playerName;
    const isDefender = bidWinnerInfo && !isBidWinner && playerOrderActive.includes(playerName);
    const isTimerRunningForThisPlayer = forfeiture?.targetPlayerName === playerName;
    const isMyTurn = trickTurnPlayerName === playerName;

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

    const seatClasses = [
        'player-seat',
        isBidWinner && 'bid-winner',
        isDefender && 'defender',
        disconnected && 'disconnected',
        isMyTurn && 'active-turn'
    ].filter(Boolean).join(' ');

    const nameClasses = ['player-name', isSelf && 'is-self'].filter(Boolean).join(' ');
    
    const rolePuckClasses = [
        'puck', 
        'role-puck', 
        isBidWinner ? 'bid-winner' : 'defender', 
        rolePuckContent?.length > 3 && 'small-font'
    ].filter(Boolean).join(' ');

    const handleStartTimer = () => {
        emitEvent("startTimeoutClock", { targetPlayerName: playerName });
    };

    return (
        <div className="player-seat-wrapper">
            {isDealer && <div className="puck dealer-puck">D</div>}
            {rolePuckContent && <div className={rolePuckClasses}>{rolePuckContent}</div>}

            <div className={seatClasses}>
                <div className={nameClasses}>{playerName}</div>
                <div className="player-stats-line">
                    <span className="player-tokens">
                        <img src="/sluff_token.png" alt="Tokens" className="token-icon-inline" />
                        {playerTokenCount !== undefined ? parseFloat(playerTokenCount).toFixed(2) : '...'}
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