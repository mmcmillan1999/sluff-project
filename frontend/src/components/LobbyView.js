// frontend/src/components/LobbyView.js

import React, { useState, useEffect } from 'react';
import './LobbyView.css';
import Bulletin from './Bulletin';
import LobbyTableCard from './LobbyTableCard';
import LobbyChat from './LobbyChat';
import { getLobbyChatHistory } from '../services/api';

const LobbyView = ({ user, lobbyThemes, serverVersion, handleJoinTable, handleLogout, handleRequestFreeToken, handleShowLeaderboard, handleShowAdmin, handleShowFeedback, errorMessage, emitEvent, socket, handleOpenFeedbackModal }) => {
    
    const [activeTab, setActiveTab] = useState('');
    const [showMenu, setShowMenu] = useState(false);
    const [tablesExpanded, setTablesExpanded] = useState(true);
    const [bulletinExpanded, setBulletinExpanded] = useState(true);
    const [chatMessages, setChatMessages] = useState([]);

    useEffect(() => {
        getLobbyChatHistory(50)
            .then(setChatMessages)
            .catch(err => {
                console.error('Failed to load lobby chat history:', err);
                setChatMessages([{ id: 'error', username: 'System', message: 'Could not load chat history.' }]);
            });
    }, []);

    useEffect(() => {
        if (!socket) return;
        
        const handleNewMessage = (newMessage) => {
            setChatMessages(prev => [...prev, newMessage]);
        };

        socket.on('new_lobby_message', handleNewMessage);

        return () => {
            socket.off('new_lobby_message', handleNewMessage);
        };
    }, [socket]);

    useEffect(() => {
        if (!showMenu) return;
        const timer = setTimeout(() => setShowMenu(false), 3000);
        return () => clearTimeout(timer);
    }, [showMenu]);

    useEffect(() => {
        if (lobbyThemes && lobbyThemes.length > 0 && !activeTab) {
            setActiveTab(lobbyThemes[0].id);
        }
    }, [lobbyThemes, activeTab]);

    const activeTheme = lobbyThemes.find(theme => theme.id === activeTab);

    const LobbyMenu = () => (
        <div className="lobby-menu-popup">
            <button onClick={() => { handleShowLeaderboard(); setShowMenu(false); }} className="lobby-menu-button">Leaderboard</button>
            <button onClick={() => { handleShowFeedback(); setShowMenu(false); }} className="lobby-menu-button">Feedback Repository</button>
            <button onClick={() => { handleOpenFeedbackModal(); setShowMenu(false); }} className="lobby-menu-button">Submit Feedback</button>
            <button onClick={() => { handleRequestFreeToken(); setShowMenu(false); }} className="lobby-menu-button">Request Free Token</button>
            <button onClick={() => { emitEvent("requestUserSync"); setShowMenu(false); }} className="lobby-menu-button">Sync Profile</button>
            {user?.is_admin && <button onClick={() => { handleShowAdmin(); setShowMenu(false); }} className="lobby-menu-button admin">Admin Panel</button>}
            <button onClick={() => { handleLogout(); setShowMenu(false); }} className="lobby-menu-button logout">Logout</button>
        </div>
    );

    return (
        <div className="lobby-view">
            <header className="lobby-header">
                <div className="header-left">
                    <img src="/SluffLogo.png" alt="Sluff Logo" className="lobby-logo" />
                    <h2 className="lobby-title">Lobby</h2>
                </div>
                <div className="header-right">
                    <span className="user-welcome"><strong>{user.username}</strong></span>
                    <div className="user-tokens">
                        <img src="/sluff_token.png" alt="Tokens" className="token-icon" />
                        <span>{parseFloat(user.tokens).toFixed(2)}</span>
                    </div>
                    <div className="hamburger-menu-container">
                        <button className="hamburger-btn" onClick={() => setShowMenu(prev => !prev)}>
                             <svg width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M12,16A2,2 0 0,1 14,18A2,2 0 0,1 12,20A2,2 0 0,1 10,18A2,2 0 0,1 12,16M12,10A2,2 0 0,1 14,12A2,2 0 0,1 12,14A2,2 0 0,1 10,12A2,2 0 0,1 12,10M12,4A2,2 0 0,1 14,6A2,2 0 0,1 12,8A2,2 0 0,1 10,6A2,2 0 0,1 12,4Z" /></svg>
                        </button>
                        {showMenu && <LobbyMenu />}
                    </div>
                </div>
            </header>
            
            {errorMessage && <p className="error-message">{errorMessage}</p>}

            <nav className="lobby-nav">
                {lobbyThemes && lobbyThemes.map(theme => (
                    <button
                        key={theme.id}
                        onClick={() => setActiveTab(theme.id)}
                        className={`lobby-tab ${activeTab === theme.id ? 'active' : ''}`}
                    >
                        <span className="lobby-tab-name">{theme.name}</span>
                        <span className="lobby-tab-cost">
                            <img src="/sluff_token.png" alt="Token" className="tab-token-icon" /> {theme.cost}
                        </span>
                    </button>
                ))}
            </nav>

            <main className="lobby-main">
                <div className="collapsible-section">
                    <h3 className="section-header" onClick={() => setTablesExpanded(!tablesExpanded)}>
                        Game Tables {tablesExpanded ? '▼' : '►'}
                    </h3>
                    {tablesExpanded && (
                        <div className="table-grid">
                            {activeTheme ? activeTheme.tables.map(table => (
                                <LobbyTableCard 
                                    key={table.tableId}
                                    table={table}
                                    canAfford={user.tokens >= activeTheme.cost}
                                    onJoin={handleJoinTable}
                                    user={user}
                                />
                            )) : <p className="loading-text">Loading tables...</p>}
                        </div>
                    )}
                </div>
                
                <div className="collapsible-section">
                    <h3 className="section-header" onClick={() => setBulletinExpanded(!bulletinExpanded)}>
                        Bulletin {bulletinExpanded ? '▼' : '►'}
                    </h3>
                    {bulletinExpanded && <Bulletin />}
                </div>
            </main>

            <LobbyChat
                socket={socket}
                messages={chatMessages}
            />
            
            <footer className="lobby-footer">
                <span>Server: {process.env.REACT_APP_SERVER_URL || 'wss://sluff-backend.onrender.com'}</span>
                <span>Version: {serverVersion}</span>
            </footer>
        </div>
    );
};

export default LobbyView;