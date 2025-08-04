// frontend/src/components/AdminView.js
import React, { useState } from 'react';
import BotInsuranceStats from './BotInsuranceStats';

// --- UPDATED: Accept handleHardReset and handleResetAllTokens as props ---
const AdminView = ({ onReturnToLobby, handleHardReset, handleResetAllTokens }) => {
    const [showBotStats, setShowBotStats] = useState(false);

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
                    {/* --- UPDATED: Button now calls the prop --- */}
                    <button onClick={handleResetAllTokens} className="admin-button danger-button">
                        Reset Tokens
                    </button>
                </div>
                <div className="admin-action-card">
                    <h3>Hard Server Reset</h3>
                    <p>Forcefully reset all game tables, boot all players, and clear all in-progress games. Use with extreme caution.</p>
                    {/* --- UPDATED: Button now calls the prop --- */}
                    <button onClick={handleHardReset} className="admin-button danger-button">
                        Hard Reset Server
                    </button>
                </div>
                <div className="admin-action-card">
                    <h3>Bot Insurance Stats</h3>
                    <p>View detailed statistics on how bots are performing with insurance decisions and their learning progress.</p>
                    <button onClick={() => setShowBotStats(true)} className="admin-button">
                        View Bot Stats
                    </button>
                </div>
            </div>
            
            {showBotStats && (
                <BotInsuranceStats onClose={() => setShowBotStats(false)} />
            )}
        </div>
    );
};

export default AdminView;