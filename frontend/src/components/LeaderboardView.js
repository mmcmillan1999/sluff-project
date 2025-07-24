// frontend/src/components/LeaderboardView.js
import React, { useState, useEffect, useCallback } from 'react';
import './LeaderboardView.css';
import { getLeaderboard } from '../services/api';

// --- OPTIMIZATION: Moved formatValue outside the component ---
// It's a pure function and doesn't need to be redefined on every render.
const formatValue = (val, totalGames, showPercent) => {
    if (showPercent) {
        if (totalGames === 0) return '0%';
        return `${Math.round((val / totalGames) * 100)}%`;
    }
    return val;
};

const LeaderboardView = ({ user, onReturnToLobby, handleResetAllTokens, handleShowAdmin }) => {
    const [leaderboardData, setLeaderboardData] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    const [showPercent, setShowPercent] = useState(false); // State for toggling percentage view

    const fetchLeaderboard = useCallback(async () => {
        setIsLoading(true);
        setError('');
        try {
            const data = await getLeaderboard();
            setLeaderboardData(data);
        } catch (err) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchLeaderboard();
    }, [fetchLeaderboard]);

    const currentUserRank = leaderboardData.find(p => p.username === user.username);
    const currentUserRankIndex = leaderboardData.findIndex(p => p.username === user.username);

    const renderPlayerRow = (player, index) => {
        const totalGames = player.wins + player.losses + player.washes;
        
        return (
            <tr key={player.username}>
                <td>{index + 1}</td>
                <td className="username-cell" title={player.username}>{player.username}</td>
                <td>{formatValue(player.wins, totalGames, showPercent)}</td>
                <td>{formatValue(player.losses, totalGames, showPercent)}</td>
                <td>{formatValue(player.washes, totalGames, showPercent)}</td>
                <td className="tokens">{parseFloat(player.tokens).toFixed(2)}</td>
            </tr>
        );
    };

    return (
        <div className="leaderboard-view">
            <header className="leaderboard-header">
                <div className="leaderboard-title-group">
                    <img src="/SluffLogo.png" alt="Sluff Logo" className="leaderboard-logo" />
                    <h2 className="leaderboard-title">Leaderboard</h2>
                </div>
                <div className="leaderboard-header-buttons">
                    <button onClick={fetchLeaderboard} className="refresh-button" title="Refresh">
                        <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24"><path d="M0 0h24v24H0z" fill="none"/><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
                    </button>
                    {/* --- CSS IMPROVEMENT: Using a more specific class name --- */}
                    <button onClick={() => setShowPercent(!showPercent)} className="view-toggle-button">
                        {showPercent ? 'Show Totals' : 'Show %'}
                    </button>
                    <button onClick={onReturnToLobby} className="back-button">Back to Lobby</button>
                </div>
            </header>
            
            <main className="leaderboard-main">
                {isLoading ? (
                    <p className="loading-text">Loading...</p>
                ) : error ? (
                    <p className="error-text">{error}</p>
                ) : (
                    <>
                        {currentUserRank && (
                            <div className="current-user-section">
                                <h3 className="your-rank-title">Your Rank</h3>
                                <table className="leaderboard-table current-user-table">
                                    <thead>
                                        <tr>
                                            <th className="rank-col">Rank</th>
                                            <th className="username-col">Username</th>
                                            <th className="rotated-header"><span>{showPercent ? 'Win%' : 'Wins'}</span></th>
                                            <th className="rotated-header"><span>{showPercent ? 'Loss%' : 'Losses'}</span></th>
                                            <th className="rotated-header"><span>{showPercent ? 'Wash%' : 'Washes'}</span></th>
                                            <th className="tokens-col">Tokens</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {renderPlayerRow(currentUserRank, currentUserRankIndex)}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        <div className="full-leaderboard-container">
                            <table className="leaderboard-table">
                                <thead>
                                    <tr>
                                        <th className="rank-col">Rank</th>
                                        <th className="username-col">Username</th>
                                        <th className="rotated-header"><span>{showPercent ? 'Win%' : 'Wins'}</span></th>
                                        <th className="rotated-header"><span>{showPercent ? 'Loss%' : 'Losses'}</span></th>
                                        <th className="rotated-header"><span>{showPercent ? 'Wash%' : 'Washes'}</span></th>
                                        <th className="tokens-col">Tokens</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {leaderboardData.map(renderPlayerRow)}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}
            </main>

            {user?.is_admin && (
                <footer className="leaderboard-footer">
                    <button onClick={handleShowAdmin} className="admin-button">Admin Panel</button>
                    <button onClick={handleResetAllTokens} className="admin-button">Reset All Tokens</button>
                </footer>
            )}
        </div>
    );
};

export default LeaderboardView;