// frontend/src/devHarness.jsx
// Dev-only layout harness: mounts the real GameTableView with a canned
// mid-round state so the table can be screenshotted at any viewport without
// a backend. Served by `npm run dev` at /harness.html (never bundled into
// the production build, which only includes index.html).
// Query params: ?mode=4 for the four-player table (default 3);
// ?prompt=podium for the game-over podium ceremony;
// ?broken=1 to fire the trump-broken banner on mount;
// ?fx=lightning|shatter|faultline to force a trump-broken effect;
// ?mode=ident to preview the boot ident (replays on tap/Replay button;
// add &hold=1 to freeze the finished logo for screenshots);
// ?frogwidow=1 to preview the Frog widow exchange table art (combine with
// ?role=defender to see the "X is choosing…" status line);
// ?prompt=bid|status|trump|frogup|allpass|qp3|seek|fill|private|draw to
// force each table popup (combine ?mode=4&prompt=qp3 for the 4-seat start).
// ?turn=1 to make it your turn with a live hand — playCard really moves the
// card onto the felt; ?playstyle=flick|fast presets the card play style
// (implies ?turn=1) so both gestures can be exercised without a backend.
// The turn call-up rides along with ?turn=1 and ?prompt=bid|frogup|trump:
// sit still for 5s for the nudge, 15s for the urgent tier. Any click or key
// restarts the clock, so leave the pointer alone while you wait — and note
// that a backgrounded tab throttles the timer.
// ?mode=lobby renders the lobby with canned venues — the venue wheel can be
// spun and screenshotted without a backend (quick play just logs).

import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/oswald/400.css';
import '@fontsource/oswald/500.css';
import '@fontsource/oswald/600.css';
import '@fontsource/oswald/700.css';
import '@fontsource/merriweather/400.css';
import '@fontsource/merriweather/700.css';
import './index.css';
import './App.css';
import './styles/no-scroll-fix.css';
import './styles/venueThemes.css';
import GameHeader from './components/GameHeader.js';
import GameTableView from './components/GameTableView.js';
import LobbyView from './components/LobbyView.js';
import OrientationScrim from './components/OrientationScrim.js';
import SluffIdent from './components/SluffIdent.js';
import { setCosmetic } from './utils/cosmetics.js';
import { setCardPlayStyle } from './utils/playStyle.js';

const params = new URLSearchParams(window.location.search);

// --- Boot ident preview: /harness.html?mode=ident[&hold=1] ---
const identMode = params.get('mode') === 'ident';
if (identMode) {
    const IdentHarness = () => {
        const [runKey, setRunKey] = React.useState(1);
        const [running, setRunning] = React.useState(true);
        const hold = params.get('hold') === '1';
        return (
            <div style={{ position: 'fixed', inset: 0, background: '#040806' }}>
                {running && (
                    <SluffIdent
                        key={runKey}
                        hold={hold}
                        onDone={() => setRunning(false)}
                    />
                )}
                {!running && (
                    <button
                        type="button"
                        onClick={() => { setRunKey(k => k + 1); setRunning(true); }}
                        style={{
                            position: 'fixed', left: '50%', top: '50%',
                            transform: 'translate(-50%, -50%)',
                            padding: '12px 28px', fontSize: 18,
                            fontFamily: "'Oswald', sans-serif",
                            background: '#1c4630', color: '#fff',
                            border: '1px solid #c9a76d', borderRadius: 8,
                            cursor: 'pointer',
                        }}
                    >
                        Replay ident
                    </button>
                )}
            </div>
        );
    };
    ReactDOM.createRoot(document.getElementById('root')).render(<IdentHarness />);
}

const playerMode = params.get('mode') === '4' ? 4 : 3;
// ?fx=<id> equips a trump-broken effect before mount so the three can be
// compared back-to-back with ?broken=1. Unknown ids are ignored.
if (params.get('fx')) {
    setCosmetic('trumpBrokenFx', params.get('fx'));
}
// ?playstyle=flick|fast presets the card play style. Unknown ids are ignored.
if (params.get('playstyle')) {
    setCardPlayStyle(params.get('playstyle'));
}
// ?turn=1 (implied by ?playstyle) arms the hand: it becomes your turn and the
// harness emitEvent really moves the played card onto the felt.
const interactiveTurn = params.get('turn') === '1' || Boolean(params.get('playstyle'));
// ?role=defender — Brandi holds the bid and You defend.
const selfIsBidder = params.get('role') !== 'defender';
// ?insurance=unset — everyone still at the server's round defaults
// (ask 120xM, offers -60xM), which arms the attention pulse.
const insuranceUnset = params.get('insurance') === 'unset';
const bidderName = selfIsBidder ? 'You' : 'Brandi';
const defenderNames = selfIsBidder ? ['Brandi', 'Elena'] : ['You', 'Elena'];

const players = {
    101: { userId: 101, playerName: 'You', isSpectator: false, disconnected: false, isBot: false },
    102: { userId: 102, playerName: 'Brandi', isSpectator: false, disconnected: false, isBot: false },
    103: { userId: 103, playerName: 'Elena', isSpectator: false, disconnected: false, isBot: false },
};
if (playerMode === 4) {
    players[104] = { userId: 104, playerName: 'Marcus', isSpectator: false, disconnected: false, isBot: false };
}

const tableState = {
    tableId: 'harness-table',
    tableName: 'Layout Harness',
    theme: 'fort-creek',
    state: 'Playing Phase',
    serverTime: 0,
    gameStarted: true,
    playerMode,
    players,
    seatingOrder: playerMode === 4 ? ['You', 'Brandi', 'Marcus', 'Elena'] : ['You', 'Brandi', 'Elena'],
    playerOrderActive: ['You', 'Brandi', 'Elena'],
    // In defender mode Brandi is dealer AND bidder: both corner pucks plus
    // her 267 two-column bank on one rotated seat — the worst-case collision.
    dealer: playerMode === 4 ? 104 : (selfIsBidder ? 103 : 102),
    // Brandi's 267 exercises the max six-pile bank; Elena's 44 the two-pile one.
    scores: { You: 108, Brandi: 267, Elena: 44, ...(playerMode === 4 ? { Marcus: 90 } : {}) },
    hands: { You: ['AC', 'KC', 'QC', 'JC', '10C', '9C', '8S', '7S', 'AD', 'KD', 'QD'] },
    widow: ['6D', '7D', '8D'],
    widowCount: 3,
    originalDealtWidow: ['6D', '7D', '8D'],
    trumpSuit: 'S',
    // ?broken=1 mounts with trump already broken, which fires the
    // trump-broken announcement immediately — handy for FX screenshots.
    trumpBroken: params.get('broken') === '1',
    leadSuitCurrentTrick: 'H',
    tricksPlayedCount: 3,
    currentTrickCards: [
        { playerName: 'Brandi', card: 'KH' },
        { playerName: 'Elena', card: '9H' },
    ],
    capturedTricks: {
        You: [[{ card: 'AH' }, { card: '6H' }, { card: '7H' }]],
        Brandi: [[{ card: '10H' }, { card: 'JH' }, { card: 'QH' }], [{ card: '8H' }, { card: '8D' }, { card: '9D' }]],
    },
    currentHighestBidDetails: { userId: selfIsBidder ? 101 : 102, playerName: bidderName, bid: 'Solo' },
    bidWinnerInfo: { userId: selfIsBidder ? 101 : 102, playerName: bidderName, bid: 'Solo' },
    insurance: {
        isActive: true,
        bidMultiplier: 2,
        bidderPlayerName: bidderName,
        bidderRequirement: insuranceUnset ? 240 : 40,
        defenderOffers: Object.fromEntries(defenderNames.map(name => [name, insuranceUnset ? -120 : -20])),
        dealExecuted: false,
    },
    drawRequest: null,
    settlement: { status: 'complete' },
    roundSummary: null,
    lastCompletedTrick: null,
    playersWhoPassedThisRound: [],
};
if (interactiveTurn) {
    tableState.trickTurnPlayerName = 'You';
    // The AFK backstop's countdown, previewable without a backend: a short
    // window means the "Your move · Ns" tail appears seconds after the nudge.
    // Real servers send 45s; ?afk=<seconds> overrides (0 disables).
    const afkSeconds = params.get('afk') === null ? 22 : Number(params.get('afk'));
    if (Number.isFinite(afkSeconds) && afkSeconds > 0) {
        tableState.afkTimeoutSeconds = afkSeconds;
        tableState.afkDeadline = Date.now() + afkSeconds * 1000;
        tableState.serverTime = Date.now();
    }
}

// ?prompt=<state> — force each ActionControls popup (and the draw vote
// modal) so their size, position, and key-cap buttons can be screenshotted.
const promptMode = params.get('prompt');
if (promptMode) {
    tableState.currentTrickCards = [];
    tableState.trumpBroken = false;
    switch (promptMode) {
        case 'bid':
            tableState.state = 'Bidding Phase';
            tableState.biddingTurnPlayerName = 'You';
            tableState.currentHighestBidDetails = null;
            break;
        case 'status':
            tableState.state = 'Bidding Phase';
            tableState.biddingTurnPlayerName = 'Brandi';
            break;
        case 'trump':
            tableState.state = 'Trump Selection';
            break;
        case 'frogup':
            tableState.state = 'Awaiting Frog Upgrade Decision';
            tableState.biddingTurnPlayerName = 'You';
            break;
        case 'allpass':
            tableState.state = 'AllPassWidowReveal';
            break;
        case 'qp3':
            tableState.tableType = 'quickplay';
            tableState.state = 'Ready to Start';
            tableState.qpPhase = 'decision_pending';
            tableState.qpGeneration = 1;
            break;
        case 'seek':
            tableState.tableType = 'quickplay';
            tableState.state = 'Ready to Start';
            tableState.qpPhase = 'seeking_fourth';
            tableState.qpGeneration = 1;
            break;
        case 'fill':
            tableState.tableType = 'quickplay';
            tableState.state = 'Waiting for Players';
            tableState.qpPhase = 'filling';
            tableState.qpGeneration = 1;
            break;
        case 'private':
            tableState.tableType = 'private';
            tableState.state = 'Ready to Start';
            break;
        case 'draw':
            tableState.drawRequest = {
                isActive: true,
                initiator: 'Brandi',
                timer: 27,
                votes: { You: null, Brandi: 'wash', Elena: null },
            };
            break;
        case 'podium': {
            // Game-over ceremony. presentationReadyAt in the past takes the
            // reconnect shortcut in GameTableView straight to the podium
            // phase, so no scoring sequence has to play out first.
            // &lose=1 puts Brandi on the top step instead, which fires the
            // local player's loss sting (watch for [harness] playSound in
            // the console; audition the clip itself in sound-audition.html).
            const selfLoses = params.get('lose') === '1';
            tableState.state = 'Game Over';
            tableState.serverTime = Date.now();
            tableState.currentTrickCards = [];
            tableState.roundSummary = {
                isGameOver: true,
                gameWinner: selfLoses ? 'Brandi' : 'You',
                finalScores: playerMode === 4
                    ? (selfLoses
                        ? { Brandi: 152, You: 97, Elena: 61, Marcus: 50 }
                        : { You: 152, Brandi: 97, Elena: 61, Marcus: 50 })
                    : (selfLoses
                        ? { Brandi: 152, You: 97, Elena: 61 }
                        : { You: 152, Brandi: 97, Elena: 61 }),
                presentationReadyAt: Date.now() - 1000,
            };
            break;
        }
        default:
            break;
    }
}

// ?frogwidow=1 — the widow cards fly from the pile to the middle of the felt.
if (params.get('frogwidow') === '1') {
    tableState.state = 'Frog Widow Exchange';
    tableState.revealedWidowForFrog = ['6D', '7D', '8D'];
    tableState.currentTrickCards = [];
    tableState.hands.You = [...tableState.hands.You, '6D', '7D', '8D'];
}

const noop = () => {};
// Real handler registry so harness code can answer requests the way the
// server would (see the requestBidHint interception in HarnessApp).
const socketHandlers = new Map();
const fakeSocket = {
    id: 'harness-socket',
    connected: false,
    on(event, handler) {
        if (!socketHandlers.has(event)) socketHandlers.set(event, new Set());
        socketHandlers.get(event).add(handler);
    },
    off(event, handler) {
        socketHandlers.get(event)?.delete(handler);
    },
    emit: noop,
    io: { on: noop, off: noop },
    trigger(event, payload) {
        socketHandlers.get(event)?.forEach(handler => handler(payload));
    },
};

const soundSettings = {
    muted: true,
    volume: 0,
    toggleMute: noop,
    setVolume: noop,
    musicMuted: true,
    musicVolume: 0,
    toggleMusicMute: noop,
    setMusicVolume: noop,
};

// With ?turn=1 the harness keeps the canned state in React state so a played
// card genuinely leaves the hand and lands on the felt (one play per reload —
// the turn then passes to Brandi, who never moves).
const HarnessApp = () => {
    const [liveState, setLiveState] = React.useState(tableState);
    const emitEvent = React.useCallback((eventName, payload) => {
        console.log('[harness] emitEvent', eventName, payload);
        if (eventName === 'requestBidHint') {
            // Facts mirror the canned hand exactly: AC KC QC JC 10C 9C 8S 7S
            // AD KD QD = 48 points with six clubs, which the shared backend
            // evaluator (core/bidAdvice.js) reads as a Solo.
            fakeSocket.trigger('bidHint', {
                tableId: 'harness-table',
                bid: 'Solo',
                handBid: 'Solo',
                points: 48,
                suits: { H: 0, S: 2, C: 6, D: 3 },
                outbid: false,
            });
            return;
        }
        if (!interactiveTurn || eventName !== 'playCard' || !payload?.card) return;
        setLiveState(prev => {
            if (!prev.hands.You.includes(payload.card)) return prev;
            return {
                ...prev,
                hands: { ...prev.hands, You: prev.hands.You.filter(c => c !== payload.card) },
                currentTrickCards: [...prev.currentTrickCards, { playerName: 'You', card: payload.card }],
                trickTurnPlayerName: 'Brandi',
            };
        });
    }, []);

    return (
        <>
            <OrientationScrim />
            <GameHeader />
            <div className="app-content-container with-header app-view-gameTable">
                <GameTableView
                    user={{ id: 101, username: 'You', is_admin: true }}
                    playerId={101}
                    currentTableState={liveState}
                    handleLeaveTable={noop}
                    handleLogout={noop}
                    handleShowHowToPlay={noop}
                    errorMessage=""
                    emitEvent={emitEvent}
                    playSound={(name) => console.log('[harness] playSound', name)}
                    socket={fakeSocket}
                    handleOpenFeedbackModal={noop}
                    soundSettings={soundSettings}
                    onShowTokenLedger={noop}
                />
            </div>
        </>
    );
};

// --- Lobby preview: /harness.html?mode=lobby ---
const lobbyMode = params.get('mode') === 'lobby';
if (lobbyMode) {
    const lobbyThemes = [
        { id: 'miss-pauls-academy', name: 'Academy', cost: 0.1, tables: [] },
        { id: 'fort-creek', name: 'Fort Creek', cost: 1, tables: [] },
        { id: 'shirecliff-road', name: 'Shirecliff', cost: 5, tables: [] },
        { id: 'dans-deck', name: 'Eaglewood', cost: 20, tables: [] },
    ];
    ReactDOM.createRoot(document.getElementById('root')).render(
        <LobbyView
            user={{ id: 101, username: 'You', tokens: '12.00', wins: 4, losses: 2, washes: 1, is_admin: false }}
            lobbyThemes={lobbyThemes}
            serverVersion="harness"
            handleJoinTable={noop}
            handleQuickPlay={(themeId) => console.log('[harness] quickPlay', themeId)}
            handleJoinTableAsSpectator={noop}
            handleLogout={noop}
            handleRequestFreeToken={noop}
            handleShowLeaderboard={noop}
            handleShowSeasonRecaps={noop}
            handleShowTokenLedger={noop}
            handleShowBulletin={noop}
            handleShowAdmin={noop}
            handleShowFeedback={noop}
            handleShowHowToPlay={noop}
            handleResetTutorial={noop}
            socket={fakeSocket}
            soundSettings={soundSettings}
        />
    );
}

if (!identMode && !lobbyMode) {
document.body.classList.add('game-active');

ReactDOM.createRoot(document.getElementById('root')).render(<HarnessApp />);
}
