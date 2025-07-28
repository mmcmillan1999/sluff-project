import React from 'react';
import { safeObjectValues, safeFilter, safeGet } from '../utils/safetyHelpers';
import './LobbyTable.css';

const LobbyTable = ({ table, onJoin, currentUserId }) => {
    // Use safe access helpers to prevent crashes
    const tableName = safeGet(table, 'tableName', 'Unknown Table');
    const players = safeGet(table, 'players', {});
    const gameStarted = safeGet(table, 'gameStarted', false);
    const playerMode = safeGet(table, 'playerMode', 4);

    const playerCount = safeFilter(safeObjectValues(players), p => !p?.isSpectator).length;
    const isPlayerAtTable = !!players[currentUserId];
    const isFull = playerCount >= playerMode;

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
                <span className="player-count">{playerCount} / {playerMode}</span>
            </div>
            <div className="table-body">
                <ul className="player-list">
                    {safeObjectValues(players).map(p => (
                        !p?.isSpectator && <li key={p?.userId || Math.random()}>{p?.playerName || 'Unknown Player'}</li>
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
