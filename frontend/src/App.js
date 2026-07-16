// frontend/src/App.js
import React, { useState, useEffect, useCallback } from "react";
import io from "socket.io-client";
import { getServerUrl, submitFeedback, updateTutorialStatus } from "./services/api.js";
import AuthContainer from "./components/AuthContainer.js";
import LobbyView from "./components/LobbyView.js";
import GameTableView from "./components/GameTableView.js";
import LeaderboardView from "./components/LeaderboardView.js";
import TokenLedgerView from "./components/TokenLedgerView.js";
import BulletinView from "./components/BulletinView.js";
import SeasonRecapsView from "./components/SeasonRecapsView.js";
import MercyWindow from "./components/MercyWindow.js";
import AdminView from "./components/AdminView.js";
import FeedbackModal from "./components/FeedbackModal.js";
import FeedbackView from "./components/FeedbackView.js";
import LobbyHeader from "./components/LobbyHeader.js";
import GameHeader from "./components/GameHeader.js";
import HowToPlayModal from "./components/HowToPlayModal.js";
import FirstGameWelcome, { shouldShowFirstGameWelcome } from "./components/FirstGameWelcome.js";
import { extractInviteTableId } from "./utils/tableInvites.js";
import { newBuildAvailable } from "./utils/clientVersion.js";
import "./App.css";
import "./components/AdminView.css";
import "./styles/no-scroll-fix.css"; // Prevent all scrolling in game view
import "./styles/venueThemes.css";
// Mobile optimizations removed - using vh-based scaling instead
import { useSounds } from "./hooks/useSounds.js";
import {
    TUTORIAL_THEME_ID,
    TUTORIAL_VERSION,
    tutorialLessonStorageKey,
} from "./config/tutorial.js";

const SERVER_URL = getServerUrl();
console.log(`[Socket.IO] Connecting to: ${SERVER_URL}`);
const socket = io(SERVER_URL, {
    autoConnect: false,
    // Keep trying to reconnect indefinitely (with backoff) instead of giving up
    // after 5 tries — a player who backgrounds the app for a while should still
    // get their socket back, which is what triggers the server-side rejoin.
    reconnectionAttempts: Infinity,
    reconnectionDelayMax: 5000,
    transports: ['websocket', 'polling']
});

function App() {
    const [view, setView] = useState('lobby');
    const [token, setToken] = useState(localStorage.getItem("sluff_token"));
    const [user, setUser] = useState(null);
    const [lobbyThemes, setLobbyThemes] = useState([]);
    const [currentTableState, setCurrentTableState] = useState(null);
    const [errorMessage, setErrorMessage] = useState('');
    const [connectionNotice, setConnectionNotice] = useState(null);
    const [serverVersion, setServerVersion] = useState('');
    const [showMercyWindow, setShowMercyWindow] = useState(false);
    const { playSound, enableSound, soundSettings } = useSounds({
        musicActive: Boolean(user) && (view === 'lobby' || view === 'gameTable'),
    });
    const [showFeedbackModal, setShowFeedbackModal] = useState(false);
    const [showHowToPlay, setShowHowToPlay] = useState(false);
    const [feedbackGameContext, setFeedbackGameContext] = useState(null);
    const [socketSessionReady, setSocketSessionReady] = useState(false);
    const [welcomeDelayElapsed, setWelcomeDelayElapsed] = useState(false);
    // Invite link (/join/<tableId>): parsed once on load, held until the user
    // is logged in and the socket is up, then consumed by the auto-join effect.
    // window.__sluffInviteTableId is the native cold-start handoff (nativeInit).
    const [pendingInviteTableId, setPendingInviteTableId] = useState(() =>
        extractInviteTableId(window.location.href) || window.__sluffInviteTableId || null
    );
    const [inviteJoinInFlight, setInviteJoinInFlight] = useState(() => Boolean(
        extractInviteTableId(window.location.href) || window.__sluffInviteTableId
    ));
    const currentTableId = currentTableState?.tableId;
    const hasConnectedRef = React.useRef(false);
    const errorMessageTimerRef = React.useRef(null);
    const connectionNoticeTimerRef = React.useRef(null);

    const handleLogout = useCallback(() => {
        localStorage.removeItem("sluff_token");
        setToken(null);
        setUser(null);
        setSocketSessionReady(false);
        setInviteJoinInFlight(false);
        if (socket.connected) {
            socket.disconnect();
        }
    }, []);

    const handleLoginSuccess = (data) => {
        localStorage.setItem("sluff_token", data.token);
        setToken(data.token);
        setUser(data.user);
        setSocketSessionReady(false);
        enableSound();
    };

    const handleHardReset = () => {
        if (window.confirm("SERVER RESET WARNING:\n\nThis will boot ALL players from ALL tables, reset ALL in-progress games, and force everyone to log in again. This action cannot be undone.\n\nAre you sure you want to proceed?")) {
            socket.emit("hardResetServer", {});
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

    const handleShowHowToPlay = useCallback(() => setShowHowToPlay(true), []);
    const handleCloseHowToPlay = useCallback(() => setShowHowToPlay(false), []);

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
        if (socket.connected) socket.emit("requestUserSync");
    };

    const handleLeaveTable = useCallback(() => {
        if (currentTableId) {
            socket.emit("leaveTable", { tableId: currentTableId });
        }
        handleReturnToLobby();
        setCurrentTableState(null);
    }, [currentTableId]);

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

            const onConnect = () => {
                if (connectionNoticeTimerRef.current) clearTimeout(connectionNoticeTimerRef.current);
                if (hasConnectedRef.current) {
                    setConnectionNotice({ kind: 'online', message: 'Back online' });
                    connectionNoticeTimerRef.current = setTimeout(() => setConnectionNotice(null), 2500);
                } else {
                    setConnectionNotice(null);
                    hasConnectedRef.current = true;
                }
            };
            const onDisconnect = (reason) => {
                if (reason === 'io client disconnect') return;
                if (connectionNoticeTimerRef.current) clearTimeout(connectionNoticeTimerRef.current);
                setConnectionNotice({ kind: 'reconnecting', message: 'Connection lost. Reconnecting…' });
            };
            const onReconnectAttempt = () => {
                setConnectionNotice({ kind: 'reconnecting', message: 'Reconnecting…' });
            };
            const onUpdateUser = (updatedUser) => {
                // console.log('[DEBUG] updateUser received from server:', updatedUser);
                // console.log('[DEBUG] is_admin from server:', updatedUser.is_admin);
                setUser(updatedUser);
            };
            const onLobbyState = (newLobbyState) => {
                if (newLobbyState && newLobbyState.themes) {
                    setLobbyThemes(newLobbyState.themes);
                    setServerVersion(newLobbyState.serverVersion || 'N/A');
                    // The server sends this only after resolving any automatic
                    // seat restoration for the newly connected socket.
                    setSocketSessionReady(true);
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
                    // Return to our seat after a fresh reload/reconnect: the server
                    // re-seats us and pushes state, but the view was reset to 'lobby'.
                    // Only auto-switch from the lobby so we don't override an
                    // intentional view (leaderboard/feedback) while still seated.
                    setView(v => (v === 'lobby' ? 'gameTable' : v));
                }
            };
            const onJoinedTable = ({ gameState }) => {
                // console.log('[ADMIN] Joined table event received, tableId:', gameState?.tableId);
                // console.log('[ADMIN] Table name:', gameState?.tableName);
                // console.log('[ADMIN] Players:', Object.values(gameState?.players || {}).map(p => `${p.playerName} (${p.isSpectator ? 'spectator' : 'player'})`));
                setCurrentTableState(gameState);
                setInviteJoinInFlight(false);
                setView('gameTable');
            };
            const onError = (error) => {
                const msg = error?.message || error || 'Something went wrong.';
                setErrorMessage(String(msg));
                // An invite join failure leaves the player in the lobby. Release
                // the navigation guard so ordinary lobby actions (including the
                // tutorial offer) are not suppressed for the rest of the session.
                setInviteJoinInFlight(false);
                if (errorMessageTimerRef.current) clearTimeout(errorMessageTimerRef.current);
                errorMessageTimerRef.current = setTimeout(() => setErrorMessage(''), 5000);
            };
            const onConnectError = (err) => {
                const message = err?.message || 'Connection failed';
                console.error("Connection Error:", message);
                if (message.includes("Authentication error")) {
                    handleLogout();
                } else {
                    setConnectionNotice({ kind: 'reconnecting', message: 'Unable to reach Sluff. Reconnecting…' });
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
            const onTokenBalancesReset = () => socket.emit('requestUserSync');

            socket.on('connect', onConnect);
            socket.on('disconnect', onDisconnect);
            socket.io?.on('reconnect_attempt', onReconnectAttempt);
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
            socket.on('tokenBalancesReset', onTokenBalancesReset);

            return () => {
                socket.off('connect', onConnect);
                socket.off('disconnect', onDisconnect);
                socket.io?.off('reconnect_attempt', onReconnectAttempt);
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
                socket.off('tokenBalancesReset', onTokenBalancesReset);
                if (errorMessageTimerRef.current) clearTimeout(errorMessageTimerRef.current);
                if (connectionNoticeTimerRef.current) clearTimeout(connectionNoticeTimerRef.current);
            };
        } else {
            if (socket.connected) {
                socket.disconnect();
            }
            hasConnectedRef.current = false;
            setSocketSessionReady(false);
            setConnectionNotice(null);
        }
    }, [token, handleLogout, handleLeaveTable]);

    // When the app returns to the foreground (tab focus / mobile resume), make sure
    // the socket is connected. If it dropped while we were away, reconnecting here
    // triggers the server to put us back on our table. This is the "close the app
    // and come back" path.
    useEffect(() => {
        if (!token) return;
        const ensureConnected = () => {
            if (document.visibilityState === 'visible' && !socket.connected) {
                socket.auth = { token };
                socket.connect();
            }
        };
        document.addEventListener('visibilitychange', ensureConnected);
        window.addEventListener('focus', ensureConnected);
        return () => {
            document.removeEventListener('visibilitychange', ensureConnected);
            window.removeEventListener('focus', ensureConnected);
        };
    }, [token]);

    // Mandatory client updates: poll version.json on load, on returning to the
    // foreground (the moment phones show stale code), and every 5 minutes. When
    // a newer build is deployed, reload immediately — unless the user is
    // mid-game, in which case the reload waits until they leave the table.
    const pendingReloadRef = React.useRef(false);
    const viewRef = React.useRef(view);
    useEffect(() => { viewRef.current = view; }, [view]);

    useEffect(() => {
        let disposed = false;
        const applyIfSafe = () => {
            if (viewRef.current !== 'gameTable') window.location.reload();
        };
        const check = async () => {
            if (pendingReloadRef.current) { applyIfSafe(); return; }
            if (await newBuildAvailable() && !disposed) {
                console.log('[VERSION] Newer frontend build detected — reloading.');
                pendingReloadRef.current = true;
                applyIfSafe();
            }
        };
        const onVisible = () => { if (document.visibilityState === 'visible') check(); };
        check();
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('focus', onVisible);
        const interval = setInterval(check, 5 * 60 * 1000);
        return () => {
            disposed = true;
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('focus', onVisible);
            clearInterval(interval);
        };
    }, []);

    // A stale client that was mid-game reloads as soon as it leaves the table.
    useEffect(() => {
        if (view !== 'gameTable' && pendingReloadRef.current) window.location.reload();
    }, [view]);

    // Native deep links arrive as a window event (see utils/nativeInit.js)
    // because the webview URL never changes inside the Capacitor shell.
    useEffect(() => {
        const onInvite = (e) => {
            if (e.detail?.tableId) {
                setInviteJoinInFlight(true);
                setPendingInviteTableId(e.detail.tableId);
            }
        };
        window.addEventListener('sluff:invite', onInvite);
        return () => window.removeEventListener('sluff:invite', onInvite);
    }, []);

    // Consume a pending invite: wait until we're authenticated and the socket
    // is connected, then join via the normal joinTable flow. Errors (table
    // full, not found) surface through the existing 'error' handler.
    useEffect(() => {
        if (!token || !user || !pendingInviteTableId) return;
        const tableId = pendingInviteTableId;
        const join = () => {
            setInviteJoinInFlight(true);
            socket.emit("joinTable", { tableId });
            setPendingInviteTableId(null);
            delete window.__sluffInviteTableId;
            // Clear /join/... from the address bar so a refresh doesn't re-join.
            if (window.location.pathname.startsWith('/join/')) {
                window.history.replaceState({}, '', '/');
            }
        };
        if (socket.connected) {
            join();
        } else {
            socket.once('connect', join);
            return () => socket.off('connect', join);
        }
    }, [token, user, pendingInviteTableId]);

    const handleJoinTable = (tableId) => {
        enableSound();
        socket.emit("joinTable", { tableId });
    };

    // Quick Play: the server picks a matchmaking table for the theme, seats
    // us (joinedTable flips the view), and fills the remaining seats.
    const handleQuickPlay = (themeId) => {
        enableSound();
        socket.emit("quickPlay", { theme: themeId });
    };

    const handleTutorialAction = useCallback(async (action) => {
        if (!['start', 'complete', 'skip', 'reset'].includes(action)) {
            throw new Error('Invalid tutorial action.');
        }

        const tutorialUpdate = await updateTutorialStatus(action);
        const tutorialVersion = Number(tutorialUpdate?.tutorial_version);
        const activeVersion = Number(tutorialUpdate?.tutorial_active_version);
        if (!Number.isFinite(tutorialVersion) || !Number.isFinite(activeVersion)) {
            throw new Error('The tutorial response was incomplete. Please try again.');
        }

        setUser(currentUser => currentUser ? {
            ...currentUser,
            tutorial_version: tutorialVersion,
            tutorial_active_version: activeVersion,
        } : currentUser);
        return {
            tutorial_version: tutorialVersion,
            tutorial_active_version: activeVersion,
        };
    }, []);

    const handleStartGuidedTutorial = async () => {
        await handleTutorialAction('start');
        handleQuickPlay(TUTORIAL_THEME_ID);
    };

    const handleResetTutorial = useCallback(async () => {
        const tutorialUpdate = await handleTutorialAction('reset');
        try {
            localStorage.removeItem(tutorialLessonStorageKey(user?.id, TUTORIAL_VERSION));
        } catch {
            // A locked-down webview may deny local storage. The server reset is
            // still authoritative, so the welcome should remain available.
        }
        return tutorialUpdate;
    }, [handleTutorialAction, user?.id]);

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

    const welcomeIsEligible = shouldShowFirstGameWelcome({
        user,
        isLobby: view === 'lobby',
        hasCurrentTable: Boolean(currentTableState),
        hasPendingInvite: Boolean(pendingInviteTableId || inviteJoinInFlight),
        socketSessionReady,
    });

    // Give a restored table's immediate gameState a chance to arrive before a
    // first-game prompt is mounted. Any table/invite/view change cancels this
    // delay, preventing a welcome flash during reconnect navigation.
    useEffect(() => {
        setWelcomeDelayElapsed(false);
        if (!welcomeIsEligible) return undefined;
        const timer = setTimeout(() => setWelcomeDelayElapsed(true), 450);
        return () => clearTimeout(timer);
    }, [welcomeIsEligible]);

    // No header for auth pages
    if (!token || !user) {
        return (
            <div className="app-content-container no-header">
                <AuthContainer onLoginSuccess={handleLoginSuccess} inviteTableId={pendingInviteTableId} />
            </div>
        );
    }

    // Render different headers for different views
    const renderHeader = () => {
        // No header for auth views (login/register)
        if (view === 'auth') {
            return null;
        }

        switch (view) {
            case 'lobby':
                return <LobbyHeader />;
            case 'gameTable':
                return <GameHeader />;
            default:
                return null; // No header for admin, leaderboard, feedback, or auth views
        }
    };

    const hasAdvertisingHeader = view === 'lobby' || view === 'gameTable';

    return (
        <>
            {(errorMessage || connectionNotice) && (
                <div
                    className={`app-status-toast ${errorMessage ? 'is-error' : `is-${connectionNotice.kind}`}`}
                    role={errorMessage ? 'alert' : 'status'}
                    aria-live={errorMessage ? 'assertive' : 'polite'}
                    aria-atomic="true"
                >
                    {errorMessage || connectionNotice.message}
                </div>
            )}
            {/* Render appropriate header based on current view */}
            {renderHeader()}
            
            <div className={`app-content-container ${hasAdvertisingHeader ? 'with-header' : 'no-header'} app-view-${view}`}>
                <MercyWindow show={showMercyWindow} onClose={() => setShowMercyWindow(false)} emitEvent={emitEvent} user={user} />
                <FeedbackModal show={showFeedbackModal} onClose={handleCloseFeedbackModal} onSubmit={handleSubmitFeedback} gameContext={feedbackGameContext} />
                <HowToPlayModal
                    show={showHowToPlay}
                    onClose={handleCloseHowToPlay}
                    returnFocusSelector={view === 'gameTable' ? '.game-menu-btn' : '.hamburger-btn'}
                    onStartGuidedGame={view === 'lobby'
                        && !currentTableState
                        && socketSessionReady
                        && !pendingInviteTableId
                        && !inviteJoinInFlight
                        ? handleStartGuidedTutorial
                        : undefined}
                />
                {welcomeIsEligible && welcomeDelayElapsed && (
                    <FirstGameWelcome
                        activeVersion={user.tutorial_active_version}
                        onStartGuided={handleStartGuidedTutorial}
                        onSkip={() => handleTutorialAction('skip')}
                    />
                )}

                {(() => {
                    switch (view) {
                        case 'lobby':
                            return <LobbyView user={user} lobbyThemes={lobbyThemes} serverVersion={serverVersion} handleJoinTable={handleJoinTable} handleQuickPlay={handleQuickPlay} handleJoinTableAsSpectator={handleJoinTableAsSpectator} handleLogout={handleLogout} handleRequestFreeToken={handleRequestFreeToken} handleShowLeaderboard={() => setView('leaderboard')} handleShowSeasonRecaps={() => setView('seasonRecaps')} handleShowTokenLedger={() => setView('tokenLedger')} handleShowBulletin={() => setView('bulletin')} handleShowAdmin={handleShowAdmin} handleShowFeedback={() => setView('feedback')} handleShowHowToPlay={handleShowHowToPlay} handleResetTutorial={handleResetTutorial} errorMessage={errorMessage} socket={socket} soundSettings={soundSettings} />;
                        case 'gameTable':
                            return currentTableState ? <GameTableView user={user} playerId={user.id} currentTableState={currentTableState} handleLeaveTable={handleLeaveTable} handleLogout={handleLogout} handleShowHowToPlay={handleShowHowToPlay} errorMessage={errorMessage} emitEvent={emitEvent} playSound={playSound} socket={socket} handleOpenFeedbackModal={handleOpenFeedbackModal} soundSettings={soundSettings} tutorialState={{ tutorialVersion: Number(user.tutorial_version) || 0, activeVersion: Number(user.tutorial_active_version) || 0, gamesPlayed: Number(user.games_played) || 0 }} onTutorialAction={handleTutorialAction} /> : <div>Loading table...</div>;
                        case 'leaderboard':
                            return <LeaderboardView user={user} onReturnToLobby={handleReturnToLobby} handleShowAdmin={handleShowAdmin} />;
                        case 'tokenLedger':
                            return <TokenLedgerView onReturnToLobby={handleReturnToLobby} />;
                        case 'seasonRecaps':
                            return <SeasonRecapsView onReturnToLobby={handleReturnToLobby} />;
                        case 'bulletin':
                            return <BulletinView onReturnToLobby={handleReturnToLobby} onOpenSeasonRecaps={() => setView('seasonRecaps')} />;
                        case 'feedback':
                            return <FeedbackView user={user} onOpenFeedbackModal={() => handleOpenFeedbackModal()} onReturnToLobby={handleReturnToLobby} />;
                        case 'admin':
                            return <AdminView onReturnToLobby={handleReturnToLobby} handleHardReset={handleHardReset} />;
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
