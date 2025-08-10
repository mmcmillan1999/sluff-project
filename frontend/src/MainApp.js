// frontend/src/MainApp.js

import React, { useState, useEffect, useCallback, useRef } from 'react'; // Import useRef
import { useNavigate } from 'react-router-dom';
import io from 'socket.io-client';
import LobbyView from './components/LobbyView.js';
import GameTableView from './components/GameTableView.js';
import LeaderboardView from './components/LeaderboardView.js';
import MercyWindow from './components/MercyWindow.js';
import AdminView from './components/AdminView.js';
import FeedbackModal from './components/FeedbackModal.js';
import FeedbackView from './components/FeedbackView.js';
import { submitFeedback } from './services/api.js';
import './components/AdminView.css';
import { useSounds } from './hooks/useSounds.js';

const SERVER_URL = process.env.REACT_APP_SERVER_URL || "https://sluff-backend.onrender.com";

const MainApp = () => {
    const navigate = useNavigate();
    const socketRef = useRef(null); // --- THE FIX: Use useRef for the socket instance ---
    const [view, setView] = useState('lobby');
    const [user, setUser] = useState(null);
    const [lobbyThemes, setLobbyThemes] = useState([]);
    const [currentTableState, setCurrentTableState] = useState(null);
    const [errorMessage, setErrorMessage] = useState('');
    const [serverVersion, setServerVersion] = useState('');
    const [showMercyWindow, setShowMercyWindow] = useState(false);
    const { playSound, enableSound } = useSounds();
    const [showFeedbackModal, setShowFeedbackModal] = useState(false);
    const [feedbackGameContext, setFeedbackGameContext] = useState(null);
    
    const token = localStorage.getItem("sluff_token");

    const handleLogout = useCallback(() => {
        localStorage.removeItem("sluff_token");
        if (socketRef.current && socketRef.current.connected) {
            socketRef.current.disconnect();
        }
        setUser(null);
        navigate('/');
    }, [navigate]);

    const handleLeaveTable = useCallback(() => {
        if (currentTableState && socketRef.current) {
            socketRef.current.emit("leaveTable", { tableId: currentTableState.tableId });
        }
        setView('lobby');
        setCurrentTableState(null);
        if (socketRef.current) socketRef.current.emit("requestUserSync");
    }, [currentTableState]);

    useEffect(() => {
        if (!token) {
            handleLogout();
            return;
        }

        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            setUser({ id: payload.id, username: payload.username, tokens: 0, is_admin: payload.is_admin || false });
        } catch (e) {
            console.error("Invalid token found, logging out:", e);
            handleLogout();
            return;
        }

        const socket = io(SERVER_URL, {
            autoConnect: false,
            reconnectionAttempts: 5,
            transports: ['websocket', 'polling'],
            auth: { token }
        });
        
        socketRef.current = socket; // Assign to the ref

        socket.connect();
        
        const onConnect = () => console.log("Socket connected!");
        const onUpdateUser = (updatedUser) => setUser(updatedUser);
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
        
        socket.emit("requestUserSync");

        return () => {
            if (socket) {
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
                socket.disconnect();
                socketRef.current = null;
            }
        };
    }, [token, handleLogout, handleLeaveTable]);

    const emitEvent = useCallback((eventName, payload = {}) => {
        if (socketRef.current) { // Use the ref
            const eventPayload = currentTableState ? { ...payload, tableId: currentTableState.tableId } : payload;
            socketRef.current.emit(eventName, eventPayload);
        }
    }, [currentTableState]); // Dependency on currentTableState

    const handleHardReset = () => {
        if (window.confirm("SERVER RESET WARNING:\n\nThis will boot ALL players from ALL tables...")) {
            emitEvent("hardResetServer", {});
        }
    };

    const handleResetAllTokens = () => {
        if (window.confirm("TOKEN RESET WARNING:\n\nThis will reset the token balance for ALL players...")) {
            emitEvent("resetAllTokens", {});
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

    const handleShowAdmin = () => setView('admin');
    const handleReturnToLobby = () => {
        setView('lobby');
        emitEvent("requestUserSync", {});
    };

    const handleJoinTable = (tableId) => {
        enableSound();
        emitEvent("joinTable", { tableId });
    };

    if (!user) {
        return <div>Loading...</div>;
    }

    return (
        <>
            <MercyWindow show={showMercyWindow} onClose={() => setShowMercyWindow(false)} emitEvent={emitEvent} user={user} />
            <FeedbackModal show={showFeedbackModal} onClose={handleCloseFeedbackModal} onSubmit={handleSubmitFeedback} gameContext={feedbackGameContext} />

            {(() => {
                const socket = socketRef.current; // Pass the actual socket instance down
                switch (view) {
                    case 'lobby':
                        return <LobbyView user={user} lobbyThemes={lobbyThemes} serverVersion={serverVersion} handleJoinTable={handleJoinTable} handleLogout={handleLogout} handleRequestFreeToken={handleRequestFreeToken} handleShowLeaderboard={() => setView('leaderboard')} handleShowAdmin={handleShowAdmin} handleShowFeedback={() => setView('feedback')} errorMessage={errorMessage} emitEvent={emitEvent} socket={socket} handleOpenFeedbackModal={handleOpenFeedbackModal} />;
                    case 'gameTable':
                        return currentTableState ? <GameTableView playerId={user.id} currentTableState={currentTableState} handleLeaveTable={handleLeaveTable} handleLogout={handleLogout} errorMessage={errorMessage} emitEvent={emitEvent} playSound={playSound} socket={socket} handleOpenFeedbackModal={handleOpenFeedbackModal} /> : <div>Loading table...</div>;
                    case 'leaderboard':
                        return <LeaderboardView user={user} onReturnToLobby={handleReturnToLobby} handleResetAllTokens={handleResetAllTokens} handleShowAdmin={handleShowAdmin} />;
                    case 'feedback':
                        return <FeedbackView user={user} onReturnToLobby={handleReturnToLobby} />;
                    case 'admin':
                        return <AdminView onReturnToLobby={handleReturnToLobby} handleHardReset={handleHardReset} handleResetAllTokens={handleResetAllTokens} />;
                    default:
                        return <LobbyView user={user} lobbyThemes={lobbyThemes} serverVersion={serverVersion} handleJoinTable={handleJoinTable} handleLogout={handleLogout} handleRequestFreeToken={handleRequestFreeToken} handleShowLeaderboard={() => setView('leaderboard')} handleShowAdmin={handleShowAdmin} handleShowFeedback={() => setView('feedback')} errorMessage={errorMessage} emitEvent={emitEvent} socket={socket} handleOpenFeedbackModal={handleOpenFeedbackModal} />;
                }
            })()}
        </>
    );
};

export default MainApp;