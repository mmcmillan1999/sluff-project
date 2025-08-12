// frontend/src/components/LobbyView.js

import React, { useState, useEffect } from 'react';
import './LobbyView.css';
import Bulletin from './Bulletin';
import LobbyTableCard from './LobbyTableCard';
import LobbyChat from './LobbyChat';
import { getLobbyChatHistory } from '../services/api';
import { useViewport } from '../hooks/useViewport';

const LobbyView = ({ user, lobbyThemes, serverVersion, handleJoinTable, handleLogout, handleRequestFreeToken, handleShowLeaderboard, handleShowAdmin, handleShowFeedback, errorMessage, emitEvent, socket, handleOpenFeedbackModal }) => {
    
    const [activeTab, setActiveTab] = useState('');
    const [showMenu, setShowMenu] = useState(false);
    // Collapsible headers removed; add simple toggles for tables and bulletin visibility
    const [tablesCollapsed, setTablesCollapsed] = useState(false);
    const [bulletinCollapsed, setBulletinCollapsed] = useState(false);
    const [chatMessages, setChatMessages] = useState([]);
    const [chatMinimized, setChatMinimized] = useState(false);
    
    // Get viewport information for responsive behavior
    const viewport = useViewport();
    const isMobile = viewport.width < 768;
    const isTablet = viewport.width >= 768 && viewport.width < 1024;
    const isDesktop = viewport.width >= 1024;

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

    // Keyboard shortcuts for desktop quick actions
    useEffect(() => {
        if (!isDesktop) return;

        const handleKeyDown = (e) => {
            // Only trigger if no input is focused and no modifiers are pressed
            if (document.activeElement.tagName === 'INPUT' || 
                document.activeElement.tagName === 'TEXTAREA' ||
                e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) {
                return;
            }

            switch (e.key.toLowerCase()) {
                case 'l':
                    e.preventDefault();
                    handleShowLeaderboard();
                    break;
                case 'f':
                    e.preventDefault();
                    handleOpenFeedbackModal();
                    break;
                case 't':
                    e.preventDefault();
                    handleRequestFreeToken();
                    break;
                case 's':
                    e.preventDefault();
                    emitEvent("requestUserSync");
                    break;
                case 'a':
                    if (user?.is_admin) {
                        e.preventDefault();
                        handleShowAdmin();
                    }
                    break;
                case 'q':
                    e.preventDefault();
                    handleLogout();
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isDesktop, user, handleShowLeaderboard, handleOpenFeedbackModal, handleRequestFreeToken, 
        handleShowAdmin, handleLogout, emitEvent]);

    const activeTheme = lobbyThemes.find(theme => theme.id === activeTab);

    // Desktop sidebar component
    const DesktopSidebar = () => {
        if (!isDesktop || !user) return null;
        
        const gamesPlayed = user.games_played || 0;
        const gamesWon = user.games_won || 0;
        const winRate = gamesPlayed > 0 ? ((gamesWon / gamesPlayed) * 100).toFixed(1) : '0.0';
        const tokensEarned = user.tokens_earned || 0;
        
        return (
            <div className="desktop-sidebar">
                <div className="sidebar-section">
                    <h3>Player Stats</h3>
                    <div className="user-stats-card">
                        <div className="stat-row">
                            <span className="stat-label">Games Played:</span>
                            <span className="stat-value">{gamesPlayed}</span>
                        </div>
                        <div className="stat-row">
                            <span className="stat-label">Games Won:</span>
                            <span className="stat-value">{gamesWon}</span>
                        </div>
                        <div className="stat-row">
                            <span className="stat-label">Win Rate:</span>
                            <span className="stat-value">{winRate}%</span>
                        </div>
                        <div className="stat-row">
                            <span className="stat-label">Tokens Earned:</span>
                            <span className="stat-value">{tokensEarned.toFixed(2)}</span>
                        </div>
                    </div>
                </div>
                
                <div className="sidebar-section">
                    <h3>Quick Actions</h3>
                    <div className="quick-actions">
                        <button onClick={handleShowLeaderboard} className="quick-action-btn">
                            Leaderboard
                            <span className="keyboard-shortcut">L</span>
                        </button>
                        <button onClick={handleShowFeedback} className="quick-action-btn">
                            Feedback Repository
                        </button>
                        <button onClick={handleOpenFeedbackModal} className="quick-action-btn">
                            Submit Feedback
                            <span className="keyboard-shortcut">F</span>
                        </button>
                        <button onClick={handleRequestFreeToken} className="quick-action-btn">
                            Request Free Token
                            <span className="keyboard-shortcut">T</span>
                        </button>
                        <button onClick={() => emitEvent("requestUserSync")} className="quick-action-btn">
                            Sync Profile
                            <span className="keyboard-shortcut">S</span>
                        </button>
                        {user?.is_admin && (
                            <button onClick={handleShowAdmin} className="quick-action-btn admin">
                                Admin Panel
                                <span className="keyboard-shortcut">A</span>
                            </button>
                        )}
                        <button onClick={handleLogout} className="quick-action-btn logout">
                            Logout
                            <span className="keyboard-shortcut">Q</span>
                        </button>
                    </div>
                </div>
            </div>
        );
    };
    
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
                </div>
                <div className="header-right">
                    <span className="user-welcome"><strong>{user.username}</strong></span>
                    {(() => {
                        const mercyEligible = Boolean(
                            user && (
                                parseFloat(user.tokens) < 5 ||
                                user.can_watch_mercy_ad ||
                                user.canWatchMercyAd ||
                                user.mercyEligible ||
                                (user.eligibility && user.eligibility.mercyAd)
                            )
                        );
                        return (
                            <button
                                type="button"
                                className={`user-tokens ${mercyEligible ? 'pulse-eligible' : ''}`}
                                onClick={handleRequestFreeToken}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        handleRequestFreeToken();
                                    }
                                }}
                                aria-label="Request Free Token"
                                title={mercyEligible ? 'Watch an ad for a Mercy Token' : 'Request Free Token'}
                            >
                                <img src="/Sluff_Token.png" alt="Tokens" className="token-icon" />
                                <span>{parseFloat(user.tokens).toFixed(2)}</span>
                            </button>
                        );
                    })()}
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
                            <img src="/Sluff_Token.png" alt="Token" className="tab-token-icon" /> {theme.cost}
                        </span>
                    </button>
                ))}
            </nav>

            <main className="lobby-main">
                {/* Desktop sidebar - only shown on desktop */}
                <DesktopSidebar />
                
                <div className="tables-section">
                    <div
                        className="tables-toggle"
                        role="button"
                        tabIndex={0}
                        onClick={() => setTablesCollapsed(v => !v)}
                        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setTablesCollapsed(v => !v)}
                        aria-expanded={!tablesCollapsed}
                        aria-controls="tables-grid"
                    >
                        <span className="toggle-title">Game Tables</span>
                        <span className="toggle-caret">{tablesCollapsed ? '►' : '▼'}</span>
                    </div>
                    {!tablesCollapsed && (
                        <div className="table-grid" id="tables-grid">
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
                
                <div className="bulletin-section">
                    <div
                        className="bulletin-toggle"
                        role="button"
                        tabIndex={0}
                        onClick={() => setBulletinCollapsed(v => !v)}
                        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setBulletinCollapsed(v => !v)}
                        aria-expanded={!bulletinCollapsed}
                        aria-controls="bulletin-content"
                    >
                        <span className="toggle-title">Bulletin</span>
                        <span className="toggle-caret">{bulletinCollapsed ? '►' : '▼'}</span>
                    </div>
                    {!bulletinCollapsed && (
                        <div id="bulletin-content">
                            <Bulletin />
                        </div>
                    )}
                </div>
                
                {/* Chat component with responsive positioning and minimize functionality */}
                <div className={`lobby-chat-container ${isMobile && chatMinimized ? 'minimized' : ''}`}>
                    <div 
                        className="chat-header"
                        onClick={isMobile ? () => setChatMinimized(prev => !prev) : undefined}
                        style={{ cursor: isMobile ? 'pointer' : 'default' }}
                    >
                        <h3 className="chat-title">Lobby Chat</h3>
                        {isMobile && (
                            <button 
                                className="chat-minimize-btn"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setChatMinimized(prev => !prev);
                                }}
                                aria-label={chatMinimized ? 'Expand chat' : 'Minimize chat'}
                            >
                                {chatMinimized ? '▲' : '▼'}
                            </button>
                        )}
                    </div>
                    <LobbyChat
                        socket={socket}
                        messages={chatMessages}
                    />
                </div>
            </main>
            
            <footer className="lobby-footer">
                <span>Server: {process.env.REACT_APP_SERVER_URL || 'wss://sluff-backend.onrender.com'}</span>
                <span>Version: {serverVersion}</span>
            </footer>
        </div>
    );
};

export default LobbyView;