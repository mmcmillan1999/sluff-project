import React from 'react';
import './LobbyTableCard.css';

const LobbyTableCard = ({ table, canAfford, buyIn, onJoin, onJoinAsSpectator, user }) => {
    const players = Array.isArray(table.players) ? table.players : Object.values(table.players || {});
    const state = table.state || '';
    const isFull = (table.playerCount ?? players.filter(p => !p.isSpectator).length) >= (table.playerMode || 4);
    const isPlaying = Boolean(state) && !['Waiting for Players', 'Ready to Start'].includes(state);
    
    const isMyGame = players.some(p => String(p.userId) === String(user.id));
    const isAdmin = user.is_admin;

    const canRejoin = isMyGame && isPlaying;
    const canJoin = !isMyGame && !isFull && canAfford && !isPlaying;
    const canSpectate = isAdmin && !isMyGame;
    
    const isDisabled = !(canJoin || canRejoin || canSpectate);
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
            {Number.isFinite(Number(buyIn)) && (
                <div className="table-economics" aria-label={`Human buy-in ${Number(buyIn)} tokens. In an all-human game, untied returns are 2, 1, and 0 times the buy-in in a three-player game, or 3, 1, 0, and 0 times in a four-player game. Ties are settled from the same pot.`}>
                    <span className="table-buy-in"><img src="/Sluff_Token.png" alt="" /> {Number(buyIn).toFixed(2)} human buy-in</span>
                    <span className="table-payout">All-human untied: 3P 2×/1×/0× · 4P 3×/1×/0×/0×</span>
                </div>
            )}
            <div className="table-card-body">
                <div className="player-list">
                    <span className="player-names">
                        {players.length > 0
                            ? players.filter(p => !p.isSpectator).map(p => p.playerName).join(', ')
                            : <em className="open-seats">Open Seats</em>
                        }
                    </span>
                    <div className="table-actions">
                        <button
                            onClick={() => onJoin(table.tableId)}
                            className="join-table-button"
                            disabled={!(canJoin || canRejoin)}
                            title={buttonTitle}
                            style={canRejoin ? {backgroundColor: '#17a2b8'} : {}}
                        >
                            {buttonText}
                        </button>
                        {canSpectate && (
                            <button
                                onClick={() => onJoinAsSpectator?.(table.tableId)}
                                className="spectate-table-button"
                                title="Join as spectator (Admin only)"
                                aria-label={`Spectate ${table.tableName}`}
                            >
                                👁️
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default LobbyTableCard;
