// frontend/src/App.js
import React, { useState, useEffect, useCallback } from "react";
import io from "socket.io-client";
import AuthContainer from "./components/AuthContainer.js";
import LobbyView from "./components/LobbyView.js";
import GameTableView from "./components/GameTableView.js";
import LeaderboardView from "./components/LeaderboardView.js";
import MercyWindow from "./components/MercyWindow.js";
import AdminView from "./components/AdminView.js";
import FeedbackModal from "./components/FeedbackModal.js";
import FeedbackView from "./components/FeedbackView.js";
import LobbyHeader from "./components/LobbyHeader.js";
import GameHeader from "./components/GameHeader.js";
import { submitFeedback } from "./services/api.js";
import "./App.css";
import "./components/AdminView.css";
import "./styles/no-scroll-fix.css"; // Prevent all scrolling in game view
// Mobile optimizations removed - using vh-based scaling instead
import { useSounds } from "./hooks/useSounds.js";

// Import the same getServerUrl function logic from api.js
const getServerUrl = () => {
    if (process.env.REACT_APP_SERVER_URL) {
        return process.env.REACT_APP_SERVER_URL;
    }
    
    const hostname = window.location.hostname;
    
    // Local development
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return 'http://localhost:3005';
    }
    
    // Production
    if (hostname === 'playsluff.com' || hostname === 'www.playsluff.com') {
        return 'https://api.playsluff.com';
    }
    
    // Render.com deployment
    if (hostname.includes('onrender.com')) {
        return 'https://sluff-backend.onrender.com';
    }
    
    // Default to production
    return 'https://api.playsluff.com';
};

const SERVER_URL = getServerUrl();
console.log(`[Socket.IO] Connecting to: ${SERVER_URL}`);
const socket = io(SERVER_URL, {
    autoConnect: false,
    reconnectionAttempts: 5,
    transports: ['websocket', 'polling']
});

function App() {
    const [view, setView] = useState('lobby');
    const [token, setToken] = useState(localStorage.getItem("sluff_token"));
    const [user, setUser] = useState(null);
    const [lobbyThemes, setLobbyThemes] = useState([]);
    const [currentTableState, setCurrentTableState] = useState(null);
    const [errorMessage, setErrorMessage] = useState('');
    const [serverVersion, setServerVersion] = useState('');
    const [showMercyWindow, setShowMercyWindow] = useState(false);
    const { playSound, enableSound } = useSounds();
    const [showFeedbackModal, setShowFeedbackModal] = useState(false);
    const [feedbackGameContext, setFeedbackGameContext] = useState(null);

    const handleLogout = useCallback(() => {
        localStorage.removeItem("sluff_token");
        setToken(null);
        setUser(null);
        if (socket.connected) {
            socket.disconnect();
        }
    }, []);

    const handleLoginSuccess = (data) => {
        localStorage.setItem("sluff_token", data.token);
        setToken(data.token);
        setUser(data.user);
        enableSound();
    };

    const handleHardReset = () => {
        if (window.confirm("SERVER RESET WARNING:\n\nThis will boot ALL players from ALL tables, reset ALL in-progress games, and force everyone to log in again. This action cannot be undone.\n\nAre you sure you want to proceed?")) {
            socket.emit("hardResetServer", {});
        }
    };

    const handleResetAllTokens = () => {
        if (window.confirm("TOKEN RESET WARNING:\n\nThis will reset the token balance for ALL players on the server to the default amount (8). This is useful for starting a new season or testing period.\n\nAre you sure you want to proceed?")) {
            socket.emit("resetAllTokens", {});
        }
    };

    const handleOpenFeedbackModal = (context = null) => {
        setFeedbackGameContext(context);
        setShowFeedbackModal(true);
    };

    const handleCloseFeedbackModal = () => {
        setShowFeedbackModal(false);
        setFeedbackGameContext(null);
    };

    const handleSubmitFeedback = async (feedbackData) => {
        await submitFeedback(feedbackData);
    };

    const handleAdClick = (adType) => {
        // Track advertisement clicks for analytics
        // console.log("Advertisement clicked");
        // In a real implementation, this would send analytics data to your tracking service
    };


    const handleRequestFreeToken = () => {
        if (user && parseFloat(user.tokens) >= 5) {
            alert("Sorry, free tokens are only available for players with fewer than 5 tokens.");
        } else {
            setShowMercyWindow(true);
        }
    };

    const handleShowAdmin = () => setView('admin');

    const handleReturnToLobby = () => {
        setView('lobby');
        if (socket.connected) socket.emit("requestUserSync");
    };

    const handleLeaveTable = useCallback(() => {
        if (currentTableState) {
            socket.emit("leaveTable", { tableId: currentTableState.tableId });
        }
        handleReturnToLobby();
        setCurrentTableState(null);
    }, [currentTableState]);

    useEffect(() => {
        if (token && !user) {
            try {
                const payload = JSON.parse(atob(token.split('.')[1]));
                // console.log('[DEBUG] JWT payload decoded:', payload);
                // console.log('[DEBUG] is_admin from token:', payload.is_admin);
                setUser({ id: payload.id, username: payload.username, tokens: 0, is_admin: payload.is_admin || false });
            } catch (e) {
                console.error("Invalid token found, logging out:", e);
                handleLogout();
            }
        }
    }, [token, user, handleLogout]);

    useEffect(() => {
        if (token) {
            socket.auth = { token };
            socket.connect();
            socket.emit("requestUserSync");

            const onConnect = () => {}; // console.log("Socket connected!");
            const onUpdateUser = (updatedUser) => {
                // console.log('[DEBUG] updateUser received from server:', updatedUser);
                // console.log('[DEBUG] is_admin from server:', updatedUser.is_admin);
                setUser(updatedUser);
            };
            const onLobbyState = (newLobbyState) => {
                if (newLobbyState && newLobbyState.themes) {
                    setLobbyThemes(newLobbyState.themes);
                    setServerVersion(newLobbyState.serverVersion || 'N/A');
                }
            };
            const onGameState = (newTableState) => {
                const currentUserId = JSON.parse(atob(token.split('.')[1])).id;
                const playerAtTable = newTableState.players[currentUserId];
                if (!playerAtTable) {
                    setView('lobby');
                    setCurrentTableState(null);
                } else {
                    setCurrentTableState(newTableState);
                }
            };
            const onJoinedTable = ({ gameState }) => {
                // console.log('[ADMIN] Joined table event received, tableId:', gameState?.tableId);
                // console.log('[ADMIN] Table name:', gameState?.tableName);
                // console.log('[ADMIN] Players:', Object.values(gameState?.players || {}).map(p => `${p.playerName} (${p.isSpectator ? 'spectator' : 'player'})`));
                setCurrentTableState(gameState);
                setView('gameTable');
            };
            const onError = (error) => {
                const msg = error.message || error;
                setErrorMessage(msg);
                setTimeout(() => setErrorMessage(''), 5000);
            };
            const onConnectError = (err) => {
                console.error("Connection Error:", err.message);
                if (err.message.includes("Authentication error")) {
                    handleLogout();
                }
            };
            const onForceReset = (message) => {
                alert(message);
                handleLogout();
                window.location.reload(true);
            };
            const onGameStartFailed = ({ message }) => alert(`Game could not start:\n\n${message}`);
            const onNotification = ({ message }) => alert(message);
            const onForceLobbyReturn = () => handleLeaveTable();

            socket.on('connect', onConnect);
            socket.on('updateUser', onUpdateUser);
            socket.on('lobbyState', onLobbyState);
            socket.on('gameState', onGameState);
            socket.on('joinedTable', onJoinedTable);
            socket.on('error', onError);
            socket.on('connect_error', onConnectError);
            socket.on('forceDisconnectAndReset', onForceReset);
            socket.on('gameStartFailed', onGameStartFailed);
            socket.on('notification', onNotification);
            socket.on('forceLobbyReturn', onForceLobbyReturn);

            return () => {
                socket.off('connect', onConnect);
                socket.off('updateUser', onUpdateUser);
                socket.off('lobbyState', onLobbyState);
                socket.off('gameState', onGameState);
                socket.off('joinedTable', onJoinedTable);
                socket.off('error', onError);
                socket.off('connect_error', onConnectError);
                socket.off('forceDisconnectAndReset', onForceReset);
                socket.off('gameStartFailed', onGameStartFailed);
                socket.off('notification', onNotification);
                socket.off('forceLobbyReturn', onForceLobbyReturn);
            };
        } else {
            if (socket.connected) {
                socket.disconnect();
            }
        }
    }, [token, handleLogout, handleLeaveTable]);

    const handleJoinTable = (tableId) => {
        enableSound();
        socket.emit("joinTable", { tableId });
    };

    const handleJoinTableAsSpectator = (tableId) => {
        enableSound();
        socket.emit("joinTable", { tableId, asSpectator: true });
    };

    const emitEvent = (eventName, payload = {}) => {
        if (currentTableState) {
            socket.emit(eventName, { ...payload, tableId: currentTableState.tableId });
        } else {
            socket.emit(eventName, payload);
        }
    };

    // Toggle body class for no-scroll when in game view
    useEffect(() => {
        if (view === 'gameTable') {
            document.body.classList.add('game-active');
        } else {
            document.body.classList.remove('game-active');
        }
        
        // Cleanup on unmount
        return () => {
            document.body.classList.remove('game-active');
        };
    }, [view]);

    // No header for auth pages
    if (!token || !user) {
        return (
            <div className="app-content-container no-header">
                <AuthContainer onLoginSuccess={handleLoginSuccess} />
            </div>
        );
    }

    // Calculate mercy eligibility for header
    const mercyEligible = Boolean(
        user && (
            parseFloat(user.tokens) < 5 ||
            user.can_watch_mercy_ad ||
            user.canWatchMercyAd ||
            user.mercyEligible ||
            (user.eligibility && user.eligibility.mercyAd)
        )
    );

    // Render different headers for different views
    const renderHeader = () => {
        // No header for auth views (login/register)
        if (view === 'auth') {
            return null;
        }
        
        switch (view) {
            case 'lobby':
                return <LobbyHeader onAdClick={handleAdClick} eligibleForMercy={mercyEligible} />;
            case 'gameTable':
                return <GameHeader onAdClick={handleAdClick} eligibleForMercy={mercyEligible} />;
            default:
                return null; // No header for admin, leaderboard, feedback, or auth views
        }
    };

    return (
        <>
            {/* Render appropriate header based on current view */}
            {renderHeader()}
            
            <div className="app-content-container">
                <MercyWindow show={showMercyWindow} onClose={() => setShowMercyWindow(false)} emitEvent={emitEvent} user={user} />
                <FeedbackModal show={showFeedbackModal} onClose={handleCloseFeedbackModal} onSubmit={handleSubmitFeedback} gameContext={feedbackGameContext} />

                {(() => {
                    switch (view) {
                        case 'lobby':
                            return <LobbyView user={user} lobbyThemes={lobbyThemes} serverVersion={serverVersion} handleJoinTable={handleJoinTable} handleJoinTableAsSpectator={handleJoinTableAsSpectator} handleLogout={handleLogout} handleRequestFreeToken={handleRequestFreeToken} handleShowLeaderboard={() => setView('leaderboard')} handleShowAdmin={handleShowAdmin} handleShowFeedback={() => setView('feedback')} errorMessage={errorMessage} emitEvent={emitEvent} socket={socket} handleOpenFeedbackModal={handleOpenFeedbackModal} />;
                        case 'gameTable':
                            return currentTableState ? <GameTableView user={user} playerId={user.id} currentTableState={currentTableState} handleLeaveTable={handleLeaveTable} handleLogout={handleLogout} errorMessage={errorMessage} emitEvent={emitEvent} playSound={playSound} socket={socket} handleOpenFeedbackModal={handleOpenFeedbackModal} /> : <div>Loading table...</div>;
                        case 'leaderboard':
                            return <LeaderboardView user={user} onReturnToLobby={handleReturnToLobby} handleResetAllTokens={handleResetAllTokens} handleShowAdmin={handleShowAdmin} />;
                        case 'feedback':
                            return <FeedbackView user={user} onReturnToLobby={handleReturnToLobby} />;
                        case 'admin':
                            return <AdminView onReturnToLobby={handleReturnToLobby} handleHardReset={handleHardReset} handleResetAllTokens={handleResetAllTokens} />;
                        default:
                            setView('lobby');
                            return null;
                    }
                })()}
            </div>
        </>
    );
}

export default App;