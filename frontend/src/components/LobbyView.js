// frontend/src/components/LobbyView.js

import React, { useState, useEffect, useRef } from 'react';
import './LobbyView.css';
import BulletinTicker from './BulletinTicker';
import LobbyTableCard from './LobbyTableCard';
import LobbyChat from './LobbyChat';
import SoundControls from './game/SoundControls';
import { getLobbyChatHistory } from '../services/api';
import { BUILD_ID } from '../utils/clientVersion';
import { useViewport } from '../hooks/useViewport';
import { TUTORIAL_VERSION } from '../config/tutorial';

export const deriveLobbyPlayerStats = (user = {}) => {
    const numericStat = value => {
        const number = Number(value);
        return Number.isFinite(number) ? number : 0;
    };
    const gamesWon = numericStat(user.wins ?? user.games_won);
    const gamesPlayed = numericStat(
        user.games_played
        ?? (gamesWon + numericStat(user.losses) + numericStat(user.washes))
    );
    const coinBalance = numericStat(user.tokens);

    return {
        gamesWon,
        gamesPlayed,
        coinBalance,
        winRate: gamesPlayed > 0 ? ((gamesWon / gamesPlayed) * 100).toFixed(1) : '0.0',
    };
};

const LobbyView = ({ user, lobbyThemes, serverVersion, handleJoinTable, handleQuickPlay, handleJoinTableAsSpectator, handleLogout, handleRequestFreeToken, handleShowLeaderboard, handleShowSeasonRecaps, handleShowTokenLedger, handleShowBulletin, handleShowAdmin, handleShowFeedback, handleShowHowToPlay, handleResetTutorial, socket, soundSettings }) => {

    const [activeTab, setActiveTab] = useState('');
    const [showMenu, setShowMenu] = useState(false);
    // Quick Play is the primary path; private tables start collapsed.
    const [tablesCollapsed, setTablesCollapsed] = useState(true);
    // Brief "seating you" feedback on the tapped Quick Play card.
    const [quickPlayPending, setQuickPlayPending] = useState(null);
    const [chatMessages, setChatMessages] = useState([]);
    const [chatMinimized, setChatMinimized] = useState(false);
    const [tutorialResetPending, setTutorialResetPending] = useState(false);
    const [tutorialResetError, setTutorialResetError] = useState('');
    const menuContainerRef = useRef(null);
    const menuButtonRef = useRef(null);
    
    // Get viewport information for responsive behavior
    const viewport = useViewport();
    const isMobile = viewport.width < 768;
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
        if (!showMenu) return undefined;

        const closeFromOutside = event => {
            if (!menuContainerRef.current?.contains(event.target)) setShowMenu(false);
        };
        const closeFromKeyboard = event => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            setShowMenu(false);
            menuButtonRef.current?.focus();
        };

        document.addEventListener('pointerdown', closeFromOutside);
        window.addEventListener('keydown', closeFromKeyboard);
        return () => {
            document.removeEventListener('pointerdown', closeFromOutside);
            window.removeEventListener('keydown', closeFromKeyboard);
        };
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
                    handleShowFeedback();
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
                default:
                    // No action for other keys
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isDesktop, user, handleShowLeaderboard, handleShowFeedback,
        handleShowAdmin, handleLogout]);

    const activeTheme = lobbyThemes.find(theme => theme.id === activeTab);
    const hasTutorialTraining = Number(user?.tutorial_version) >= TUTORIAL_VERSION;

    const resetTutorialTraining = async () => {
        if (!handleResetTutorial || tutorialResetPending) return;
        setTutorialResetPending(true);
        setTutorialResetError('');
        try {
            await handleResetTutorial();
            setShowMenu(false);
        } catch (error) {
            setTutorialResetError(error?.message || 'Could not reset the tutorial. Please try again.');
        } finally {
            setTutorialResetPending(false);
        }
    };

    const lobbyActionGroups = [
        {
            id: 'player',
            label: 'Player',
            actions: [
                { id: 'leaderboard', label: 'Leaderboard', shortcut: 'L', onSelect: handleShowLeaderboard },
                { id: 'season-recaps', label: 'Season Recaps', onSelect: handleShowSeasonRecaps },
                { id: 'ledger', label: 'Token Ledger', onSelect: handleShowTokenLedger },
            ],
        },
        {
            id: 'learn',
            label: 'Learn',
            actions: [
                { id: 'how-to-play', label: 'How to Play', onSelect: handleShowHowToPlay },
                ...(hasTutorialTraining ? [{
                    id: 'replay-tutorial',
                    label: tutorialResetPending ? 'Preparing Tutorial…' : 'Replay Tutorial',
                    onSelect: resetTutorialTraining,
                    disabled: tutorialResetPending,
                    managesMenuState: true,
                }] : []),
            ],
        },
        {
            id: 'support',
            label: 'Support',
            actions: [
                { id: 'feedback', label: 'Feedback', shortcut: 'F', onSelect: handleShowFeedback },
            ],
        },
        {
            id: 'account',
            label: 'Account',
            actions: [
                ...(user?.is_admin ? [{
                    id: 'admin',
                    label: 'Admin Tools',
                    shortcut: 'A',
                    tone: 'admin',
                    onSelect: handleShowAdmin,
                }] : []),
                { id: 'logout', label: 'Sign Out', shortcut: 'Q', tone: 'logout', onSelect: handleLogout },
            ],
        },
    ];

    const renderLobbyActions = ({ buttonClass, closeMenu }) => lobbyActionGroups.map(group => (
        <div className="lobby-action-group" key={group.id}>
            <p className="lobby-action-group-label">{group.label}</p>
            {group.actions.map(action => (
                <button
                    type="button"
                    key={action.id}
                    className={`${buttonClass}${action.tone ? ` ${action.tone}` : ''}`}
                    disabled={action.disabled}
                    aria-keyshortcuts={action.shortcut || undefined}
                    onClick={() => {
                        action.onSelect();
                        if (closeMenu && !action.managesMenuState) setShowMenu(false);
                    }}
                >
                    {action.label}
                    {action.shortcut && <span className="keyboard-shortcut" aria-hidden="true">{action.shortcut}</span>}
                </button>
            ))}
        </div>
    ));

    // Desktop sidebar component
    const renderDesktopSidebar = () => {
        if (!isDesktop || !user) return null;
        
        const { gamesPlayed, gamesWon, winRate, coinBalance } = deriveLobbyPlayerStats(user);
        
        return (
            <div className="desktop-sidebar">
                <div className="sidebar-section">
                    <h3>Career Stats</h3>
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
                            <span className="stat-label">Coin Balance:</span>
                            <span className="stat-value">{coinBalance.toFixed(2)}</span>
                        </div>
                    </div>
                </div>
                
                <div className="sidebar-section">
                    <h3>Quick Actions</h3>
                    <div className="quick-actions">
                        {renderLobbyActions({ buttonClass: 'quick-action-btn', closeMenu: false })}
                        {tutorialResetError && !showMenu && (
                            <p className="tutorial-reset-error" role="alert">{tutorialResetError}</p>
                        )}
                    </div>
                </div>
            </div>
        );
    };
    
    const renderLobbyMenu = () => (
        <div className="lobby-menu-popup venue-menu" role="group" aria-label="Player menu">
            <div className="lobby-menu-audio">
                <p className="lobby-action-group-label">Audio</p>
                <SoundControls soundSettings={soundSettings} />
            </div>
            {renderLobbyActions({ buttonClass: 'lobby-menu-button', closeMenu: true })}
            {tutorialResetError && (
                <p className="tutorial-reset-error" role="alert">{tutorialResetError}</p>
            )}
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
                    <div className="hamburger-menu-container" ref={menuContainerRef}>
                        <button
                            type="button"
                            className="hamburger-btn"
                            ref={menuButtonRef}
                            onClick={() => {
                                setTutorialResetError('');
                                setShowMenu(prev => !prev);
                            }}
                            aria-label={showMenu ? 'Close player menu' : 'Open player menu'}
                            aria-expanded={showMenu}
                        >
                             <svg width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M12,16A2,2 0 0,1 14,18A2,2 0 0,1 12,20A2,2 0 0,1 10,18A2,2 0 0,1 12,16M12,10A2,2 0 0,1 14,12A2,2 0 0,1 12,14A2,2 0 0,1 10,12A2,2 0 0,1 12,10M12,4A2,2 0 0,1 14,6A2,2 0 0,1 12,8A2,2 0 0,1 10,6A2,2 0 0,1 12,4Z" /></svg>
                        </button>
                        {showMenu && renderLobbyMenu()}
                    </div>
                </div>
            </header>

            <BulletinTicker onOpen={handleShowBulletin} />

            <main className="lobby-main">
                {/* Desktop sidebar - only shown on desktop */}
                {renderDesktopSidebar()}

                {/* ============ QUICK PLAY — the primary way in ============ */}
                <div className="quickplay-section">
                    <div className="quickplay-heading">
                        <span className="quickplay-title">Quick Play</span>
                        <span className="quickplay-subtitle">Tap a table — we'll find you a game</span>
                    </div>
                    <div className="quickplay-cards">
                        {lobbyThemes && lobbyThemes.length > 0 ? lobbyThemes.map(theme => {
                            const canAfford = parseFloat(user.tokens) >= theme.cost;
                            const isPending = quickPlayPending === theme.id;
                            const actionLabel = isPending ? 'Seating you' : (canAfford ? 'Play now' : 'Need tokens');
                            return (
                                <button
                                    key={theme.id}
                                    className={`qp-card qp-${theme.id} ${canAfford ? '' : 'qp-disabled'} ${isPending ? 'qp-pending' : ''}`}
                                    data-theme={theme.id}
                                    disabled={!canAfford || isPending}
                                    aria-label={`${theme.name}, ${theme.cost} token buy-in. ${actionLabel}.`}
                                    onClick={() => {
                                        setQuickPlayPending(theme.id);
                                        handleQuickPlay(theme.id);
                                        // Safety: clear if the server didn't seat us
                                        setTimeout(() => setQuickPlayPending(null), 4000);
                                    }}
                                >
                                    <span className="qp-card-copy">
                                        <span className="qp-card-name">{theme.name}</span>
                                        <span className="qp-card-cost">
                                            <img src="/Sluff_Token.png" alt="" className="tab-token-icon" /> {theme.cost}
                                        </span>
                                    </span>
                                    <span className="qp-play-pill">
                                        {isPending ? 'SEATING YOU…' : canAfford ? 'PLAY NOW ▶' : 'NEED TOKENS'}
                                    </span>
                                </button>
                            );
                        }) : <p className="loading-text">Loading tables...</p>}
                    </div>
                </div>

                {/* ============ PRIVATE TABLES — play with friends ============ */}
                <div
                    className="tables-section"
                    data-theme={!tablesCollapsed ? activeTheme?.id : undefined}
                >
                    <div
                        className="tables-toggle"
                        role="button"
                        tabIndex={0}
                        onClick={() => setTablesCollapsed(v => !v)}
                        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setTablesCollapsed(v => !v)}
                        aria-expanded={!tablesCollapsed}
                        aria-controls="tables-grid"
                    >
                        <span className="toggle-title">Private Tables</span>
                        <span className="toggle-subtitle">pick a table & invite friends</span>
                        <span className="toggle-caret">{tablesCollapsed ? '►' : '▼'}</span>
                    </div>
                    {!tablesCollapsed && (
                        <>
                            <nav className="lobby-nav">
                                {lobbyThemes && lobbyThemes.map(theme => (
                                    <button
                                        key={theme.id}
                                        onClick={() => setActiveTab(theme.id)}
                                        className={`lobby-tab ${activeTab === theme.id ? 'active' : ''}`}
                                        data-theme={theme.id}
                                    >
                                        <span className="lobby-tab-name">{theme.name}</span>
                                        <span className="lobby-tab-cost">
                                            <img src="/Sluff_Token.png" alt="Token" className="tab-token-icon" /> {theme.cost}
                                        </span>
                                    </button>
                                ))}
                            </nav>
                            <div className="table-grid" id="tables-grid">
                                {activeTheme ? activeTheme.tables.map(table => (
                                    <LobbyTableCard
                                        key={table.tableId}
                                        table={table}
                                        themeId={activeTheme.id}
                                        canAfford={user.tokens >= activeTheme.cost}
                                        buyIn={activeTheme.cost}
                                        onJoin={handleJoinTable}
                                        onJoinAsSpectator={handleJoinTableAsSpectator}
                                        user={user}
                                    />
                                )) : <p className="loading-text">Loading tables...</p>}
                            </div>
                        </>
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
                <SoundControls soundSettings={soundSettings} compact />
                <span>
                    Version: {serverVersion}
                    {BUILD_ID && ` | Client: ${BUILD_ID.replace('T', ' ').slice(5, 16)}`}
                </span>
            </footer>
        </div>
    );
};

export default LobbyView;
