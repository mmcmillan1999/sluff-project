import React from 'react';

const AdminView = ({ onReturnToLobby, emitEvent }) => {

    const handleHardReset = () => {
        if (window.confirm("SERVER RESET WARNING:\n\nThis will boot ALL players from ALL tables, reset ALL in-progress games, and force everyone to log in again. This action cannot be undone.\n\nAre you sure you want to proceed?")) {
            const secret = prompt("Enter the server reset secret (Mouse_...):");
            if (secret) {
                emitEvent("hardResetServer", { secret });
            }
        }
    };

    const handleResetAllTokens = () => {
        if (window.confirm("TOKEN RESET WARNING:\n\nThis will reset the token balance for ALL players on the server to the default amount. This is useful for starting a new season.\n\nAre you sure you want to proceed?")) {
            const secret = prompt("Enter the token reset secret (Ben_...):");
            if (secret) {
                emitEvent("resetAllTokens", { secret });
            }
        }
    };

    return (
        <div className="admin-view">
            <header className="admin-header">
                <h2>Admin Control Panel</h2>
                <button onClick={onReturnToLobby} className="admin-button back-button">Back to Lobby</button>
            </header>
            <div className="admin-actions-container">
                <div className="admin-action-card">
                    <h3>Reset All Tokens</h3>
                    <p>Reset the token balance for ALL players to the default starting amount. Use this to begin a new season.</p>
                    <button onClick={handleResetAllTokens} className="admin-button danger-button">
                        Reset Tokens
                    </button>
                </div>
                <div className="admin-action-card">
                    <h3>Hard Server Reset</h3>
                    <p>Forcefully reset all game tables, boot all players, and clear all in-progress games. Use with extreme caution.</p>
                    <button onClick={handleHardReset} className="admin-button danger-button">
                        Hard Reset Server
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AdminView;
