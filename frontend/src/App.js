// frontend/src/App.js
import React, { useState, useEffect, useCallback } from "react";
import io from "socket.io-client";
import Login from "./components/Login.js";
import Register from "./components/Register.js";
import LobbyView from "./components/LobbyView.js";
import GameTableView from "./components/GameTableView.js";
import LeaderboardView from "./components/LeaderboardView.js";
import MercyWindow from "./components/MercyWindow.js";
import AdminView from "./components/AdminView.js";
import FeedbackModal from "./components/FeedbackModal.js";
import FeedbackView from "./components/FeedbackView.js";
import { submitFeedback } from "./services/api.js";
import "./components/AdminView.css";
import { useSounds } from "./hooks/useSounds.js";

const SERVER_URL = process.env.REACT_APP_SERVER_URL || "https://sluff-backend.onrender.com";
const socket = io(SERVER_URL, {
    autoConnect: false,
    reconnectionAttempts: 5,
    transports: ['websocket', 'polling']
});

function App() {
    const [view, setView] = useState('login');
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
        setView('login');
        if (socket.connected) {
            socket.disconnect();
        }
    }, []);

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

    const handleRequestFreeToken = () => {
        if (user && parseFloat(user.tokens) >= 5) {
            alert("Sorry, free tokens are only available for players with fewer than 5 tokens.");
        } else {
            setShowMercyWindow(true);
        }
    };

    const handleShowAdmin = () => {
        setView('admin');
    };

    const handleReturnToLobby = () => {
        setView('lobby');
        socket.emit("requestUserSync");
    };

    useEffect(() => {
        if (token && !user) {
            try {
                const payload = JSON.parse(atob(token.split('.')[1]));
                setUser({ id: payload.id, username: payload.username, tokens: 0, is_admin: payload.is_admin || false });
                setView('lobby');
            }
            catch (e) {
                console.error("Invalid token found, logging out:", e);
                handleLogout();
            }
        }
    }, [token, user, handleLogout]);

    useEffect(() => {
        if (token) {
            socket.auth = { token };
            socket.connect();

            const onConnect = () => {
                console.log("Socket connected!");
                socket.emit("requestUserSync");
            };

            const onUpdateUser = (updatedUser) => {
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

            const onGameStartFailed = ({ message }) => {
                alert(`Game could not start:\n\n${message}`);
            };

            const onNotification = ({ message }) => {
                alert(message);
            };

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
            };
        }
    }, [token, handleLogout]);

    const handleLoginSuccess = (data) => {
        localStorage.setItem("sluff_token", data.token);
        setToken(data.token);
        setUser(data.user);
        enableSound();
    };

    const handleJoinTable = (tableId) => {
        enableSound();
        socket.emit("joinTable", { tableId });
    }

    const handleLeaveTable = () => {
        if (currentTableState) {
            socket.emit("leaveTable", { tableId: currentTableState.tableId });
        }
        handleReturnToLobby();
        setCurrentTableState(null);
    }

    const emitEvent = (eventName, payload = {}) => {
        if (currentTableState) {
            socket.emit(eventName, { ...payload, tableId: currentTableState.tableId });
        } else {
            socket.emit(eventName, payload);
        }
    }

    if (!token || !user) {
        return view === 'register' ?
            (
                <Register onRegisterSuccess={() => setView('login')} onSwitchToLogin={() => setView('login')} />
            ) : (
                <Login onLoginSuccess={handleLoginSuccess} onSwitchToRegister={() => setView('register')} />
            );
    }

    return (
        <>
            <MercyWindow
                show={showMercyWindow}
                onClose={() => setShowMercyWindow(false)}
                emitEvent={emitEvent}
            />

            <FeedbackModal
                show={showFeedbackModal}
                onClose={handleCloseFeedbackModal}
                onSubmit={handleSubmitFeedback}
                gameContext={feedbackGameContext}
            />

            {(() => {
                switch (view) {
                    case 'lobby':
                        return <LobbyView
                            user={user}
                            lobbyThemes={lobbyThemes}
                            serverVersion={serverVersion}
                            handleJoinTable={handleJoinTable}
                            handleLogout={handleLogout}
                            handleRequestFreeToken={handleRequestFreeToken}
                            handleShowLeaderboard={() => setView('leaderboard')}
                            handleShowAdmin={handleShowAdmin}
                            handleShowFeedback={() => setView('feedback')}
                            errorMessage={errorMessage}
                            emitEvent={emitEvent}
                            socket={socket}
                            handleOpenFeedbackModal={handleOpenFeedbackModal}
                        />;
                    case 'gameTable':
                        return currentTableState ?
                            (
                                <GameTableView
                                    playerId={user.id}
                                    currentTableState={currentTableState}
                                    handleLeaveTable={handleLeaveTable}
                                    handleLogout={handleLogout}
                                    errorMessage={errorMessage}
                                    emitEvent={emitEvent}
                                    playSound={playSound}
                                    socket={socket}
                                    handleOpenFeedbackModal={handleOpenFeedbackModal}
                                />
                            ) : (
                                <div>Loading table...</div>
                            );
                    case 'leaderboard':
                        return <LeaderboardView
                            user={user}
                            onReturnToLobby={handleReturnToLobby}
                            handleResetAllTokens={handleResetAllTokens}
                            handleShowAdmin={handleShowAdmin}
                        />;
                    case 'feedback':
                        return <FeedbackView
                            user={user}
                            onReturnToLobby={handleReturnToLobby}
                        />;
                    case 'admin':
                        return <AdminView
                            onReturnToLobby={handleReturnToLobby}
                            handleHardReset={handleHardReset}
                            handleResetAllTokens={handleResetAllTokens}
                        />;
                    default:
                        setView('lobby');
                        return null;
                }
            })()}
        </>
    );
}

export default App;