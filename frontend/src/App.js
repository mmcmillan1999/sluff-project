// frontend/src/App.js
import { createPortal } from 'react-dom';
import React, { useState, useEffect, useCallback, Suspense } from "react";
import io from "socket.io-client";
import { getServerUrl, submitFeedback, updateTutorialStatus } from "./services/api.js";
import AuthContainer from "./components/AuthContainer.js";
import LobbyView from "./components/LobbyView.js";
import GameTableView from "./components/GameTableView.js";
import TournamentView from './components/tournament/TournamentView';
import TournamentPopup from './components/tournament/TournamentPopup';
import TournamentCreateSheet from './components/tournament/TournamentCreateSheet';
import VoiceControls from './components/game/VoiceControls';
import { tournamentVoiceHost } from './components/tournament/TournamentVoiceDock';
import LeaderboardView from "./components/LeaderboardView.js";
import TokenLedgerView from "./components/TokenLedgerView.js";
import BulletinView from "./components/BulletinView.js";
import SeasonRecapsView from "./components/SeasonRecapsView.js";
import MercyWindow from "./components/MercyWindow.js";
import FeedbackModal from "./components/FeedbackModal.js";
import FeedbackView from "./components/FeedbackView.js";
import LobbyHeader from "./components/LobbyHeader.js";
import GameHeader from "./components/GameHeader.js";
import HowToPlayModal from "./components/HowToPlayModal.js";
import AccountSettingsModal from "./components/AccountSettingsModal.js";
import PrivacyPolicy from "./components/legal/PrivacyPolicy.js";
import TermsOfService from "./components/legal/TermsOfService.js";
import FirstGameWelcome, { shouldShowFirstGameWelcome } from "./components/FirstGameWelcome.js";
import OrientationScrim from "./components/OrientationScrim.js";
import SluffIdent from "./components/SluffIdent.js";
import DecorBoundary from "./components/DecorBoundary.js";
import { extractInviteTableId } from "./utils/tableInvites.js";
import { extractInviteTournamentId } from "./utils/tournamentInvites.js";
import { onViewportSettle, resetStrayScroll, viewportSnapshot } from "./utils/viewportSettle.js";
import { startLayoutBeacon } from "./utils/layoutBeacon.js";
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

// Admin-only surface: its own chunk, fetched the first time an admin opens it.
const AdminView = React.lazy(() => import("./components/AdminView.js"));

const SERVER_URL = getServerUrl();
console.log(`[Socket.IO] Connecting to: ${SERVER_URL}`);
const socket = io(SERVER_URL, {
    autoConnect: false,
    // Keep trying to reconnect indefinitely (with backoff) instead of giving up
    // after 5 tries — a player who backgrounds the app for a while should still
    // get their socket back, which is what triggers the server-side rejoin.
    reconnectionAttempts: Infinity,
    reconnectionDelayMax: 5000,
    transports: ['websocket', 'polling'],
    // engine.io-client tries ONLY the first transport by default; without this
    // a network that blocks WebSocket upgrades never reaches the polling entry.
    tryAllTransports: true,
});

function App() {
    const [view, setView] = useState('lobby');
    // Boot ident: plays on every full page load (like the Netflix/Chess.com
    // openers) and doubles as a curtain over the socket-connect wait. It
    // replays on login (rolling into the lobby) and when the app returns
    // after a long time away — never over a live game table.
    const [showBootIdent, setShowBootIdent] = useState(true);
    const [bootIdentRun, setBootIdentRun] = useState(1);
    const playBootIdent = useCallback(() => {
        setBootIdentRun(run => run + 1);
        setShowBootIdent(true);
    }, []);
    const [token, setToken] = useState(localStorage.getItem("sluff_token"));
    const [user, setUser] = useState(null);
    const [lobbyThemes, setLobbyThemes] = useState([]);
    const [currentTableState, setCurrentTableState] = useState(null);
    // Tournaments (components/tournament): the open/running summary every
    // player sees, the tournament this player is in (or is viewing), and the
    // per-visit dismissal of the lobby popup.
    const [tournamentLobby, setTournamentLobby] = useState({ open: null, running: [] });
    const [myTournament, setMyTournament] = useState(null);
    const [dismissedTournamentId, setDismissedTournamentId] = useState(null);
    const [showTournamentCreate, setShowTournamentCreate] = useState(false);
    const [tournamentBusy, setTournamentBusy] = useState(false);
    const [tournamentError, setTournamentError] = useState('');
    const myTournamentRef = React.useRef(null);
    myTournamentRef.current = myTournament;
    // Tournament: the other table this player is watching while their own
    // round is done (null otherwise). A ref for the socket handlers.
    const [watchingTableId, setWatchingTableId] = useState(null);
    const watchingTableIdRef = React.useRef(null);
    watchingTableIdRef.current = watchingTableId;
    const pendingTournamentCreateRef = React.useRef(false);
    const [errorMessage, setErrorMessage] = useState('');
    const [connectionNotice, setConnectionNotice] = useState(null);
    const [serverVersion, setServerVersion] = useState('');
    const [showMercyWindow, setShowMercyWindow] = useState(false);
    const {
        playSound, playDealSounds, playWheelTick, playWheelSettle, playMidnightSpecial,
        prefetchChampionLine, playChampionSting,
        enableSound, soundSettings,
    } = useSounds({
        musicActive: Boolean(user) && (view === 'lobby' || view === 'gameTable'),
    });
    // The venue wheel's flapper-and-clunk voice, bundled for the lobby.
    const wheelAudio = React.useMemo(
        () => ({ tick: playWheelTick, settle: playWheelSettle }),
        [playWheelTick, playWheelSettle],
    );
    const [showFeedbackModal, setShowFeedbackModal] = useState(false);
    const [showHowToPlay, setShowHowToPlay] = useState(false);
    const [showAccountSettings, setShowAccountSettings] = useState(false);
    // /privacy and /terms used to render only for logged-out visitors — once
    // signed in, those paths fell through to the lobby and the documents were
    // unreachable. Store reviewers check exactly this. Path-driven state so a
    // signed-in deep link works, plus lobby menu entries.
    const legalPageFromPath = () => (
        ['/privacy', '/terms'].includes(window.location.pathname)
            ? window.location.pathname.slice(1)
            : null
    );
    const [legalPage, setLegalPage] = useState(legalPageFromPath);
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
    // Tournament link (/tournament/<id>): held the same way, then consumed
    // once the lobby state has arrived by opening that tournament's page.
    const [pendingInviteTournamentId, setPendingInviteTournamentId] = useState(() =>
        extractInviteTournamentId(window.location.href) || window.__sluffInviteTournamentId || null
    );
    const hasConnectedRef = React.useRef(false);
    const errorMessageTimerRef = React.useRef(null);
    const connectionNoticeTimerRef = React.useRef(null);
    // True from the server's restart notice until we reconnect: the ordinary
    // disconnect handlers must not stomp "updating" with "connection lost".
    const serverRestartingRef = React.useRef(false);
    // Throttles the automatic seat-reclaim reconnect so a genuinely
    // superseded tab cannot fight the live one in a loop.
    const seatReclaimAtRef = React.useRef(0);
    // Mirrors currentTableState for code that must not re-bind on every
    // table change: the socket listeners and the stale-build reload guard.
    const tableRef = React.useRef(currentTableState);
    useEffect(() => { tableRef.current = currentTableState; }, [currentTableState]);
    // Armed by a reconnect made while seated. The server then pushes gameState
    // only if an engine still holds us, and always follows with lobbyState —
    // so lobbyState arriving first means the table is gone.
    const awaitingReseatRef = React.useRef(false);

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

    // The API already swapped the stored JWT for one carrying the new name.
    // Re-reading it keeps `token` in step, and requestUserSync repoints the
    // server's socket identity and the rest of the cached profile.
    const handleUsernameChanged = useCallback((username) => {
        setToken(localStorage.getItem("sluff_token"));
        setUser(currentUser => (currentUser ? { ...currentUser, username } : currentUser));
        if (socket.connected) socket.emit("requestUserSync");
    }, []);

    const handleShowLegalPage = useCallback((page) => {
        window.history.pushState({}, '', `/${page}`);
        setLegalPage(page);
    }, []);

    const handleCloseLegalPage = useCallback(() => {
        window.history.pushState({}, '', '/');
        setLegalPage(null);
    }, []);

    useEffect(() => {
        const onPopState = () => setLegalPage(legalPageFromPath());
        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleAccountDeleted = useCallback(() => {
        setShowAccountSettings(false);
        handleLogout();
    }, [handleLogout]);

    const handleLoginSuccess = (data) => {
        // Crossing the auth boundary changes who renders /privacy and /terms
        // (AuthContainer logged out, the overlay logged in). Re-derive from the
        // path so a document open at login is still open after it.
        setLegalPage(legalPageFromPath());
        localStorage.setItem("sluff_token", data.token);
        setToken(data.token);
        setUser(data.user);
        setSocketSessionReady(false);
        enableSound();
        // Roll the ident as the freshly logged-in player lands in the lobby.
        playBootIdent();
    };

    const handleHardReset = () => {
        if (window.confirm("SERVER RESET WARNING:\n\nThis will boot ALL players from ALL tables, reset ALL in-progress games, and force everyone to log in again. This action cannot be undone.\n\nAre you sure you want to proceed?")) {
            socket.emit("hardResetServer", {});
        }
    };

    const handleOpenFeedbackModal = (context = null) => {
        // In-game feedback carries a viewport snapshot: the layout bugs that
        // only show on someone's phone are impossible to chase without it.
        setFeedbackGameContext(context ? { ...context, viewport: viewportSnapshot() } : context);
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

    // Reads the table id through the ref so this stays referentially stable:
    // the socket-listener effect depends on it, and re-binding every listener
    // on each table join dropped the toast auto-dismiss timers mid-toast.
    const handleLeaveTable = useCallback(() => {
        const tableId = tableRef.current?.tableId;
        const inTournament = Boolean(tableRef.current?.tournament);
        setWatchingTableId(null);
        if (tableId) {
            socket.emit("leaveTable", { tableId });
        }
        if (inTournament) {
            // The seat stays the tournament's; the board is the way back.
            setView('tournament');
        } else {
            handleReturnToLobby();
        }
        setCurrentTableState(null);
    }, []);

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
                serverRestartingRef.current = false;
                socket.emit('tournamentSync');
                // Only a genuine reconnect while seated expects a reseat; a
                // recovered session gets no connect-time pushes at all.
                awaitingReseatRef.current = hasConnectedRef.current
                    && !socket.recovered
                    && tableRef.current !== null;
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
                // ~1.2s after the restart notice the socket drops; keep telling
                // the truth ("updating") instead of reverting to a scary
                // generic loss message.
                setConnectionNotice(serverRestartingRef.current
                    ? { kind: 'reconnecting', message: 'Sluff is updating — back in a moment. Games resume automatically.' }
                    : { kind: 'reconnecting', message: 'Connection lost. Reconnecting…' });
            };
            const onReconnectAttempt = () => {
                setConnectionNotice(serverRestartingRef.current
                    ? { kind: 'reconnecting', message: 'Sluff is updating — back in a moment. Games resume automatically.' }
                    : { kind: 'reconnecting', message: 'Reconnecting…' });
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
                // Reconnected, and no gameState/joinedTable came first: the
                // server no longer seats us. Drop the table rather than leave
                // a frozen board that will never update again.
                if (awaitingReseatRef.current) {
                    awaitingReseatRef.current = false;
                    setCurrentTableState(null);
                    setView('lobby');
                    setErrorMessage('Your table has closed.');
                    if (errorMessageTimerRef.current) clearTimeout(errorMessageTimerRef.current);
                    errorMessageTimerRef.current = setTimeout(() => setErrorMessage(''), 5000);
                }
            };
            const onGameState = (newTableState) => {
                awaitingReseatRef.current = false;
                const currentUserId = JSON.parse(atob(token.split('.')[1])).id;
                const playerAtTable = newTableState.players[currentUserId];
                // Watching another tournament table: our own finished table
                // may still broadcast (acknowledgements, reconnects). Stay on
                // the watched table until the next round opens somewhere.
                const watching = watchingTableIdRef.current;
                if (watching && newTableState.tableId !== watching && newTableState.tournament) {
                    if (newTableState.state === 'Awaiting Next Round Trigger') return;
                    setWatchingTableId(null);
                }
                if (!playerAtTable) {
                    setView('lobby');
                    setCurrentTableState(null);
                } else {
                    setCurrentTableState(newTableState);
                    // Return to our seat after a fresh reload/reconnect: the server
                    // re-seats us and pushes state, but the view was reset to 'lobby'.
                    // Only auto-switch from the lobby (or the tournament board,
                    // whose next round arrives this way) so we don't override an
                    // intentional view (leaderboard/feedback) while still seated.
                    setView(v => (v === 'lobby' || v === 'tournament' ? 'gameTable' : v));
                }
            };
            const onJoinedTable = ({ gameState }) => {
                awaitingReseatRef.current = false;
                // console.log('[ADMIN] Joined table event received, tableId:', gameState?.tableId);
                // console.log('[ADMIN] Table name:', gameState?.tableName);
                // console.log('[ADMIN] Players:', Object.values(gameState?.players || {}).map(p => `${p.playerName} (${p.isSpectator ? 'spectator' : 'player'})`));
                setCurrentTableState(gameState);
                setInviteJoinInFlight(false);
                setView('gameTable');
            };
            const onTournamentLobby = (lobby) => {
                const next = lobby && typeof lobby === 'object'
                    ? { open: lobby.open || null, running: Array.isArray(lobby.running) ? lobby.running : [], loaded: true }
                    : { open: null, running: [], loaded: true };
                setTournamentLobby(next);
                // Someone looking at a tournament they are not in (a shared
                // link, the lobby slot) only hears about it through the lobby
                // broadcast, so keep their copy fresh from it.
                const viewing = myTournamentRef.current;
                if (viewing) {
                    const currentUserId = JSON.parse(atob(token.split('.')[1])).id;
                    const mine = viewing.creatorUserId === currentUserId
                        || (viewing.entries || []).some(entry => entry.userId === currentUserId);
                    const copy = [next.open, ...next.running].find(candidate => candidate && candidate.id === viewing.id);
                    if (!mine && copy) setMyTournament(copy);
                }
            };
            const onTournamentState = (state) => {
                if (!state || typeof state !== 'object') return;
                const currentUserId = JSON.parse(atob(token.split('.')[1])).id;
                const mine = state.creatorUserId === currentUserId
                    || (state.entries || []).some(entry => entry.userId === currentUserId);
                const viewing = myTournamentRef.current?.id === state.id;
                if (!mine && !viewing) return;
                setMyTournament(state);
                setTournamentBusy(false);
                if (pendingTournamentCreateRef.current && state.creatorUserId === currentUserId) {
                    pendingTournamentCreateRef.current = false;
                    setShowTournamentCreate(false);
                    setTournamentError('');
                    setView('tournament');
                }
                // Between rounds the table is gone: move from the felt to the board.
                const atTournamentTable = tableRef.current?.tournament?.tournamentId === state.id;
                const seatedNow = (state.tables || []).some(table => table.tableId === tableRef.current?.tableId);
                if (atTournamentTable && !seatedNow) {
                    setCurrentTableState(null);
                    setView(v => (v === 'gameTable' ? 'tournament' : v));
                }
            };
            const onTournamentActionFailed = (failure) => {
                setTournamentBusy(false);
                setTournamentError(String(failure?.message || 'That did not work.'));
                if (failure?.action === 'tournamentCreate') pendingTournamentCreateRef.current = false;
            };
            const onError = (error) => {
                const msg = String(error?.message || error || 'Something went wrong.');
                // A seat-control rejection means this socket predates the
                // server's view of our seat (typically right after a deploy
                // resume). A programmatic reconnect performs exactly what a
                // manual refresh would — the server reseats this connection
                // on connect — so heal silently instead of showing an error.
                if (/no longer controls/i.test(msg)) {
                    if (Date.now() - seatReclaimAtRef.current > 5000) {
                        seatReclaimAtRef.current = Date.now();
                        socket.disconnect();
                        socket.connect();
                    }
                    return;
                }
                setErrorMessage(msg);
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
            const onTokenBalanceChanged = () => socket.emit('requestUserSync');
            // Both fire for this account's OTHER live sessions: a rename on one
            // device repoints the rest, and a deletion signs them out.
            const onIdentityChanged = () => socket.emit('requestUserSync');
            const onAccountDeleted = () => handleLogout();
            // A deploy is about to drop this socket; saying so first makes the
            // disconnect read as an update rather than a mystery.
            const onServerRestarting = () => {
                serverRestartingRef.current = true;
                if (connectionNoticeTimerRef.current) clearTimeout(connectionNoticeTimerRef.current);
                setConnectionNotice({ kind: 'reconnecting', message: 'Sluff is updating — back in a moment. Games resume automatically.' });
            };

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
            socket.on('tokenBalancesReset', onTokenBalanceChanged);
            socket.on('tokenBalanceChanged', onTokenBalanceChanged);
            socket.on('identityChanged', onIdentityChanged);
            socket.on('accountDeleted', onAccountDeleted);
            socket.on('serverRestarting', onServerRestarting);
            socket.on('tournamentLobby', onTournamentLobby);
            socket.on('tournamentState', onTournamentState);
            socket.on('tournamentActionFailed', onTournamentActionFailed);

            return () => {
                socket.off('connect', onConnect);
                socket.off('disconnect', onDisconnect);
                socket.io?.off('reconnect_attempt', onReconnectAttempt);
                socket.off('updateUser', onUpdateUser);
                socket.off('lobbyState', onLobbyState);
                socket.off('gameState', onGameState);
                socket.off('joinedTable', onJoinedTable);
                socket.off('tournamentLobby', onTournamentLobby);
                socket.off('tournamentState', onTournamentState);
                socket.off('tournamentActionFailed', onTournamentActionFailed);
                socket.off('error', onError);
                socket.off('connect_error', onConnectError);
                socket.off('forceDisconnectAndReset', onForceReset);
                socket.off('gameStartFailed', onGameStartFailed);
                socket.off('notification', onNotification);
                socket.off('forceLobbyReturn', onForceLobbyReturn);
                socket.off('tokenBalancesReset', onTokenBalanceChanged);
                socket.off('tokenBalanceChanged', onTokenBalanceChanged);
                socket.off('identityChanged', onIdentityChanged);
                socket.off('accountDeleted', onAccountDeleted);
                socket.off('serverRestarting', onServerRestarting);
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
    const socketHiddenAtRef = React.useRef(null);
    useEffect(() => {
        if (!token) return;
        // After a real absence a socket can still say "connected" over a TCP
        // session the OS quietly lost (wifi → cell, a long lock): plays would
        // go into the void until the ping timeout. Cycle it — the server
        // reseats on every connect, so the cost is one round trip.
        const STALE_AFTER_HIDDEN_MS = 20 * 1000;
        const ensureConnected = () => {
            if (document.visibilityState !== 'visible') return;
            const hiddenAt = socketHiddenAtRef.current;
            socketHiddenAtRef.current = null;
            if (!socket.connected) {
                socket.auth = { token };
                socket.connect();
            } else if (hiddenAt !== null && Date.now() - hiddenAt >= STALE_AFTER_HIDDEN_MS) {
                socket.disconnect();
                socket.auth = { token };
                socket.connect();
            }
        };
        const onVisibility = () => {
            if (document.visibilityState === 'hidden') {
                if (socketHiddenAtRef.current === null) socketHiddenAtRef.current = Date.now();
                return;
            }
            ensureConnected();
        };
        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('focus', ensureConnected);
        return () => {
            document.removeEventListener('visibilitychange', onVisibility);
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

    // Replay the ident when the app comes back after a long time away
    // (backgrounded phone, laptop lid, offline stretch). Short app switches
    // don't retrigger it, and it never plays over a live game table.
    const identHiddenAtRef = React.useRef(null);
    useEffect(() => {
        const IDENT_REPLAY_AFTER_AWAY_MS = 10 * 60 * 1000;
        const onVisibility = () => {
            if (document.visibilityState === 'hidden') {
                if (identHiddenAtRef.current === null) {
                    identHiddenAtRef.current = Date.now();
                }
                return;
            }
            const hiddenAt = identHiddenAtRef.current;
            identHiddenAtRef.current = null;
            if (hiddenAt !== null
                && Date.now() - hiddenAt >= IDENT_REPLAY_AFTER_AWAY_MS
                && viewRef.current !== 'gameTable') {
                playBootIdent();
            }
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => document.removeEventListener('visibilitychange', onVisibility);
    }, [playBootIdent]);

    useEffect(() => {
        let disposed = false;
        // "Seated anywhere" is the real guard: a player checking the
        // leaderboard mid-game is still in a live hand.
        const applyIfSafe = () => {
            if (viewRef.current !== 'gameTable' && tableRef.current === null) window.location.reload();
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
        if (view !== 'gameTable' && !currentTableState && pendingReloadRef.current) window.location.reload();
    }, [view, currentTableState]);

    // Native deep links arrive as a window event (see utils/nativeInit.js)
    // because the webview URL never changes inside the Capacitor shell.
    useEffect(() => {
        const onInvite = (e) => {
            if (e.detail?.tableId) {
                setInviteJoinInFlight(true);
                setPendingInviteTableId(e.detail.tableId);
            } else if (e.detail?.tournamentId) {
                setPendingInviteTournamentId(e.detail.tournamentId);
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

    // Consume a pending tournament link: once we're signed in and the lobby
    // broadcast has arrived, open that tournament's page (registration or the
    // board). A link to a tournament that is over just says so.
    useEffect(() => {
        if (!token || !user || !pendingInviteTournamentId || !tournamentLobby.loaded) return;
        const target = [tournamentLobby.open, ...tournamentLobby.running]
            .find(candidate => candidate && candidate.id === pendingInviteTournamentId);
        setPendingInviteTournamentId(null);
        delete window.__sluffInviteTournamentId;
        if (/^\/tournament\//.test(window.location.pathname) || new URLSearchParams(window.location.search).has('tournament')) {
            window.history.replaceState({}, '', '/');
        }
        if (target) {
            setDismissedTournamentId(target.id);
            // An entrant already holds the richer per-viewer copy from the
            // server; only a visitor needs the public one from the lobby.
            const mine = target.creatorUserId === user.id
                || (target.entries || []).some(entry => entry.userId === user.id);
            if (!(mine && myTournamentRef.current?.id === target.id)) setMyTournament(target);
            setView('tournament');
        } else {
            if (errorMessageTimerRef.current) clearTimeout(errorMessageTimerRef.current);
            setErrorMessage('That tournament is over. Look under the wheel for the next one.');
            errorMessageTimerRef.current = setTimeout(() => setErrorMessage(''), 6000);
        }
    }, [token, user, pendingInviteTournamentId, tournamentLobby]);

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
    // Tournament: watch another table while yours is done for the round.
    // The director seats you as a spectator there and pulls you back the
    // moment the room reseats.
    const handleWatchTournamentTable = (tableId) => {
        if (!myTournamentRef.current) return;
        enableSound();
        setWatchingTableId(tableId);
        socket.emit('tournamentWatch', { tournamentId: myTournamentRef.current.id, tableId });
        setView('gameTable');
    };
    const handleStopWatchingTournamentTable = () => {
        if (!myTournamentRef.current) return;
        setWatchingTableId(null);
        socket.emit('tournamentUnwatch', { tournamentId: myTournamentRef.current.id });
    };

    // ---- Tournaments: every action is a socket event; the director answers
    // with tournamentState (or tournamentActionFailed). ----
    const tournamentEmit = (eventName, payload = {}) => {
        setTournamentError('');
        setTournamentBusy(true);
        socket.emit(eventName, payload);
        // A missed answer must never leave the buttons dead.
        setTimeout(() => setTournamentBusy(false), 2500);
    };
    const handleOpenTournament = () => {
        if (!myTournament || !['registering', 'running'].includes(myTournament.status)) {
            const target = tournamentLobby.open || tournamentLobby.running[0] || null;
            if (target) setMyTournament(target);
        }
        setView('tournament');
    };
    const handleTournamentJoin = (tournamentId) => {
        enableSound();
        setDismissedTournamentId(tournamentId);
        tournamentEmit('tournamentJoin', { tournamentId });
        setView('tournament');
    };
    const handleTournamentCreate = (settings) => {
        pendingTournamentCreateRef.current = true;
        tournamentEmit('tournamentCreate', { settings });
    };
    const handleTournamentBack = () => {
        const entered = Boolean(myTournament) && (
            myTournament.creatorUserId === user.id
            || (myTournament.entries || []).some(entry => entry.userId === user.id)
        );
        // Keep only a tournament you are actually in and that is still going.
        if (!entered || !['registering', 'running'].includes(myTournament.status)) setMyTournament(null);
        handleReturnToLobby();
    };
    const tournamentActionFor = (eventName) => () => {
        if (myTournament) tournamentEmit(eventName, { tournamentId: myTournament.id });
    };

    const emitEvent = (eventName, payload = {}) => {
        if (currentTableState) {
            socket.emit(eventName, { ...payload, tableId: currentTableState.tableId });
        } else {
            socket.emit(eventName, payload);
        }
    };

    // The tournament popup shows once per tournament per lobby visit.
    useEffect(() => {
        if (view !== 'lobby') setDismissedTournamentId(null);
    }, [view]);

    // The layout beacon: when a phone's layout goes wrong the menu may be out
    // of reach, so the app reports its own viewport geometry (anonymously,
    // to the crash intake) whenever the viewport settles into a bad shape.
    useEffect(() => startLayoutBeacon(), []);

    // Toggle body class for no-scroll when in game view. While the felt is
    // up, any stray document scroll (iOS toolbar collapse, keyboard close)
    // is undone as the viewport settles, so the bottom of the table is never
    // left cut off.
    useEffect(() => {
        if (view === 'gameTable') {
            document.body.classList.add('game-active');
            const stop = onViewportSettle(resetStrayScroll, { immediate: true });
            return () => {
                stop();
                document.body.classList.remove('game-active');
            };
        }
        document.body.classList.remove('game-active');
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
                {showBootIdent && (
                    <SluffIdent key={bootIdentRun} onDone={() => setShowBootIdent(false)} />
                )}
                <OrientationScrim />
                <AuthContainer onLoginSuccess={handleLoginSuccess} inviteTableId={pendingInviteTableId} inviteTournamentId={pendingInviteTournamentId} />
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
                return <DecorBoundary><LobbyHeader /></DecorBoundary>;
            case 'gameTable':
                return <DecorBoundary><GameHeader tournament={myTournament} viewerUserId={user.id} watchingTableId={watchingTableId} onWatchTable={handleWatchTournamentTable} onStopWatching={handleStopWatchingTournamentTable} /></DecorBoundary>;
            case 'tournament':
                return <DecorBoundary><LobbyHeader /></DecorBoundary>;
            default:
                return null; // No header for admin, leaderboard, feedback, or auth views
        }
    };

    const hasAdvertisingHeader = view === 'lobby' || view === 'gameTable' || view === 'tournament';

    return (
        <>
            {showBootIdent && (
                <SluffIdent key={bootIdentRun} onDone={() => setShowBootIdent(false)} />
            )}
            <OrientationScrim />
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
                <TournamentCreateSheet
                    show={showTournamentCreate}
                    defaultName={`${user.username}'s Tournament`}
                    busy={tournamentBusy}
                    error={tournamentError}
                    onClose={() => { setShowTournamentCreate(false); setTournamentError(''); pendingTournamentCreateRef.current = false; }}
                    onCreate={handleTournamentCreate}
                />
                {/* Tournament-wide voice: one room for the whole event, built
                    once. It renders into a host node the felt and the board
                    adopt in turn (TournamentVoiceDock), so it survives every
                    reseat and the board between rounds. */}
                {myTournament && ['running', 'complete'].includes(myTournament.status) && tournamentVoiceHost()
                    && (myTournament.entries || []).some(entry => entry.userId === user.id && !['withdrawn', 'refunded'].includes(entry.status))
                    && createPortal(
                        <VoiceControls
                            key={`tournament-${myTournament.id}`}
                            socket={socket}
                            tableId={`tournament-${myTournament.id}`}
                        />,
                        tournamentVoiceHost(),
                    )}
                {view === 'lobby' && tournamentLobby.open
                    && dismissedTournamentId !== tournamentLobby.open.id
                    && !pendingInviteTournamentId
                    && tournamentLobby.open.creatorUserId !== user.id
                    && !(tournamentLobby.open.entries || []).some(entry => entry.userId === user.id)
                    && !(myTournament && ['registering', 'running'].includes(myTournament.status)) && (
                    <TournamentPopup
                        tournament={tournamentLobby.open}
                        busy={tournamentBusy}
                        onJoin={() => handleTournamentJoin(tournamentLobby.open.id)}
                        onDismiss={() => setDismissedTournamentId(tournamentLobby.open.id)}
                    />
                )}
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
                        && !pendingInviteTournamentId
                        && !inviteJoinInFlight
                        ? handleStartGuidedTutorial
                        : undefined}
                />
                {legalPage && (
                    <div className="legal-overlay">
                        {legalPage === 'terms'
                            ? <TermsOfService onNavigate={(view) => (
                                view === 'privacy' || view === 'terms'
                                    ? handleShowLegalPage(view)
                                    : handleCloseLegalPage()
                            )} />
                            : <PrivacyPolicy onNavigate={(view) => (
                                view === 'privacy' || view === 'terms'
                                    ? handleShowLegalPage(view)
                                    : handleCloseLegalPage()
                            )} />}
                    </div>
                )}
                <AccountSettingsModal
                    show={showAccountSettings}
                    user={user}
                    onClose={() => setShowAccountSettings(false)}
                    onUsernameChanged={handleUsernameChanged}
                    onAccountDeleted={handleAccountDeleted}
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
                            return <LobbyView user={user} lobbyThemes={lobbyThemes} serverVersion={serverVersion} wheelAudio={wheelAudio} handleJoinTable={handleJoinTable} handleQuickPlay={handleQuickPlay} handleJoinTableAsSpectator={handleJoinTableAsSpectator} handleLogout={handleLogout} handleRequestFreeToken={handleRequestFreeToken} handleShowLeaderboard={() => setView('leaderboard')} handleShowSeasonRecaps={() => setView('seasonRecaps')} handleShowTokenLedger={() => setView('tokenLedger')} handleShowBulletin={() => setView('bulletin')} handleShowAdmin={handleShowAdmin} handleShowFeedback={() => setView('feedback')} handleShowHowToPlay={handleShowHowToPlay} handleResetTutorial={handleResetTutorial} handleShowAccountSettings={() => setShowAccountSettings(true)} handleShowPrivacy={() => handleShowLegalPage('privacy')} handleShowTerms={() => handleShowLegalPage('terms')} errorMessage={errorMessage} socket={socket} soundSettings={soundSettings} tournamentLobby={tournamentLobby} myTournament={myTournament} handleOpenTournament={handleOpenTournament} handleCreateTournament={() => { setTournamentError(''); setShowTournamentCreate(true); }} />;
                        case 'tournament':
                            return (
                                <TournamentView
                                    tournament={myTournament}
                                    user={user}
                                    busy={tournamentBusy}
                                    error={tournamentError}
                                    onJoin={() => myTournament && handleTournamentJoin(myTournament.id)}
                                    onLeave={tournamentActionFor('tournamentLeave')}
                                    onFindPlayer={tournamentActionFor('tournamentFindPlayer')}
                                    onStart={tournamentActionFor('tournamentStart')}
                                    onCancel={tournamentActionFor('tournamentCancel')}
                                    onQuit={tournamentActionFor('tournamentQuit')}
                                    onFastPlay={(enabled) => myTournament && tournamentEmit('tournamentFastPlay', { tournamentId: myTournament.id, enabled })}
                                    onWatch={handleWatchTournamentTable}
                                    onBack={handleTournamentBack}
                                />
                            );
                        case 'gameTable':
                            return currentTableState ? <GameTableView user={user} playerId={user.id} currentTableState={currentTableState} handleLeaveTable={handleLeaveTable} handleLogout={handleLogout} handleShowHowToPlay={handleShowHowToPlay} errorMessage={errorMessage} emitEvent={emitEvent} playSound={playSound} playDealSounds={playDealSounds} playMidnightSpecial={playMidnightSpecial} prefetchChampionLine={prefetchChampionLine} playChampionSting={playChampionSting} socket={socket} handleOpenFeedbackModal={handleOpenFeedbackModal} soundSettings={soundSettings} tutorialState={{ tutorialVersion: Number(user.tutorial_version) || 0, activeVersion: Number(user.tutorial_active_version) || 0, gamesPlayed: Number(user.games_played) || 0 }} onTutorialAction={handleTutorialAction} onShowTokenLedger={() => setView('tokenLedger')} tournament={myTournament} watchingTableId={watchingTableId} onWatchTable={handleWatchTournamentTable} onStopWatching={handleStopWatchingTournamentTable} /> : <div>Loading table...</div>;
                        case 'leaderboard':
                            return <LeaderboardView user={user} onReturnToLobby={handleReturnToLobby} handleShowAdmin={handleShowAdmin} onShowTokenLedger={() => setView('tokenLedger')} />;
                        case 'tokenLedger':
                            return <TokenLedgerView onReturnToLobby={handleReturnToLobby} />;
                        case 'seasonRecaps':
                            return <SeasonRecapsView onReturnToLobby={handleReturnToLobby} />;
                        case 'bulletin':
                            return <BulletinView onReturnToLobby={handleReturnToLobby} onOpenSeasonRecaps={() => setView('seasonRecaps')} />;
                        case 'feedback':
                            return <FeedbackView user={user} onOpenFeedbackModal={() => handleOpenFeedbackModal()} onReturnToLobby={handleReturnToLobby} />;
                        case 'admin':
                            return (
                                <Suspense fallback={null}>
                                    <AdminView onReturnToLobby={handleReturnToLobby} handleHardReset={handleHardReset} />
                                </Suspense>
                            );
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
