import React from 'react';
import './LobbyTable.css';

const LobbyTable = ({ table, onJoin, currentUserId }) => {
    // --- FIX: Default players to an empty object if it's null or undefined ---
    // This prevents the "Cannot convert undefined or null to object" crash.
    const { tableName, players = {}, gameStarted, playerMode } = table;

    const playerCount = Object.values(players).filter(p => !p.isSpectator).length;
    const isPlayerAtTable = players[currentUserId];
    const isFull = playerCount >= (playerMode || 4);

    let statusText = 'Waiting for players...';
    let canJoin = !isPlayerAtTable && !gameStarted && !isFull;

    if (gameStarted) {
        statusText = 'Game in progress';
        canJoin = false;
    } else if (isFull) {
        statusText = 'Table is full';
        canJoin = false;
    } else if (playerCount >= 3) {
        statusText = 'Ready to Start';
    }

    if (isPlayerAtTable) {
        statusText = 'You are at this table';
        canJoin = false;
    }

    return (
        <div className={`lobby-table ${gameStarted ? 'in-progress' : ''} ${isFull ? 'full' : ''}`}>
            <div className="table-header">
                <h3>{tableName}</h3>
                <span className="player-count">{playerCount} / {playerMode || 4}</span>
            </div>
            <div className="table-body">
                <ul className="player-list">
                    {Object.values(players).map(p => (
                        !p.isSpectator && <li key={p.userId}>{p.playerName}</li>
                    ))}
                </ul>
            </div>
            <div className="table-footer">
                <span className="table-status">{statusText}</span>
                <button onClick={onJoin} disabled={!canJoin} className="join-button">
                    Join
                </button>
            </div>
        </div>
    );
};

export default LobbyTable;
