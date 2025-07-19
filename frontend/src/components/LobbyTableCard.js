import React from 'react';
import './LobbyTableCard.css';

const LobbyTableCard = ({ table, canAfford, onJoin, user }) => {
    const isFull = table.playerCount >= 4;
    const isPlaying = table.state.includes("Playing") || table.state.includes("Game Over");
    
    const isMyGame = table.players.some(p => p.userId === user.id);

    const canRejoin = isMyGame && isPlaying;
    const canJoin = !isMyGame && !isFull && canAfford && !isPlaying;
    
    const isDisabled = !(canJoin || canRejoin);
    const buttonText = canRejoin ? "Return to Game" : "Join";

    // --- MODIFICATION: Improved status text logic ---
    let statusText = 'Waiting for players';
    if (isPlaying) {
        statusText = 'Playing';
    } else if (isFull) {
        statusText = 'Full';
    }

    let buttonTitle = 'Join Table';
    if (canRejoin) buttonTitle = 'Return to your active game';
    else if (!canAfford) buttonTitle = 'You cannot afford the buy-in for this table.';
    else if (isFull) buttonTitle = 'This table is full.';
    else if (isPlaying) buttonTitle = 'This game is already in progress.';

    return (
        <div className={`table-card-container ${isDisabled ? 'disabled' : ''}`}>
            <div className="table-card-header">
                <h3 className="table-card-title">{table.tableName}</h3>
                <div className={`table-card-status ${statusText.toLowerCase().replace(/ /g, '-')}`}>
                    {statusText}
                </div>
            </div>
            <div className="table-card-body">
                <div className="player-list">
                    <span className="player-names">
                        {table.players && table.players.length > 0
                            ? table.players.map(p => p.playerName).join(', ')
                            : <em className="open-seats">Open Seats</em>
                        }
                    </span>
                    <button
                        onClick={() => onJoin(table.tableId)}
                        className="join-table-button"
                        disabled={isDisabled}
                        title={buttonTitle}
                        style={canRejoin ? {backgroundColor: '#17a2b8'} : {}}
                    >
                        {buttonText}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default LobbyTableCard;