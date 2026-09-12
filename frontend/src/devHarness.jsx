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
// ?volley=1 plays the rest of the trick back at you (opponent fly-ins,
// linger, magnet) and hands the lead back — see the flag below.
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
import TournamentView from './components/tournament/TournamentView';
import './components/ClaudeLanding.css';
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
// ?volley=1 (implies ?turn=1) — a whole trick plays out: you lead, each
// opponent answers on the bot cadence (their card flies in from the seat),
// the trick lingers and magnets to a pile, and the lead comes back to you.
// Loops for as long as you keep leading. In ?mode=4 Elena sits out as dealer
// so the across seat (Marcus) is one of the two that answer.
const volley = params.get('volley') === '1';
const interactiveTurn = params.get('turn') === '1' || Boolean(params.get('playstyle')) || volley;
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
if (volley) {
    // You lead into an empty felt so every opponent card is a fresh arrival.
    tableState.currentTrickCards = [];
    tableState.leadSuitCurrentTrick = null;
    if (playerMode === 4) {
        tableState.dealer = 103;
        tableState.playerOrderActive = ['You', 'Brandi', 'Marcus'];
        tableState.insurance.defenderOffers = Object.fromEntries(
            tableState.playerOrderActive
                .filter(name => name !== bidderName)
                .map(name => [name, insuranceUnset ? -120 : -20]),
        );
    }
}
// Bot cadence from GameService (playDelay for a non-Courtney bot), so the
// harness volley paces exactly like a live table.
const VOLLEY_PLAY_DELAY_MS = 1200;
const VOLLEY_LINGER_MS = 2200;
// Cards no one else holds in the canned deal, cycled per responder.
const VOLLEY_POOL = {
    Brandi: ['KH', 'QS', '9D', 'JH', 'AS', '6C'],
    Elena: ['9H', '10S', '8D', 'QH', 'KS', '7C'],
    Marcus: ['6H', 'JS', '10D', '7H', '9S', '8C'],
};

// ?prompt=<state> — force each ActionControls popup (and the draw vote
// modal) so their size, position, and key-cap buttons can be screenshotted.
// ?ringcard=N — the table opens a tournament round N in Dealing Pending so
// the ring card walks on (add &hold=1 to freeze it mid-walk for a capture).
const ringCardRound = Number(params.get('ringcard')) || 0;
const ringCardHold = ringCardRound > 0 && params.get('hold') === '1';
if (ringCardRound > 0) {
    tableState.state = 'Dealing Pending';
    tableState.dealer = 102;
    tableState.tournament = { tournamentId: 1, name: 'Harness Open', roundNumber: ringCardRound, tableIndex: 0, drainPercent: 0 };
}

// ?tourneyname=Name[&left=N] — the felt wears the event's name; five or
// fewer left makes it the final table.
const feltEvent = params.get('tourneyname');
if (feltEvent) {
    tableState.tournament = tableState.tournament || { tournamentId: 1, name: feltEvent, roundNumber: 9, tableIndex: 0, drainPercent: 0 };
    tableState.tournament.name = feltEvent;
}
const playersLeft = Number(params.get('left')) || 0;

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
        case 'deal':
            // Your deal: the deck, the sonar-ringed Deal button, and (in
            // learner mode) the coach callout pointing at it.
            tableState.state = 'Dealing Pending';
            tableState.dealer = 101;
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
    const liveStateRef = React.useRef(tableState);
    liveStateRef.current = liveState;
    const volleyTimersRef = React.useRef([]);
    const volleyPlayCountRef = React.useRef(0);
    React.useEffect(() => () => volleyTimersRef.current.forEach(clearTimeout), []);

    // Play the rest of the trick back on the bot cadence, linger it onto the
    // first responder's pile, then hand the lead back. Each step is a plain
    // state update, the way a server broadcast would land.
    const runVolley = React.useCallback(() => {
        const later = (ms, fn) => volleyTimersRef.current.push(setTimeout(fn, ms));
        const responders = tableState.playerOrderActive.filter(name => name !== 'You');
        const round = volleyPlayCountRef.current;
        volleyPlayCountRef.current += 1;
        responders.forEach((name, index) => {
            const pool = VOLLEY_POOL[name] || VOLLEY_POOL.Brandi;
            const card = pool[round % pool.length];
            const completesTrick = index === responders.length - 1;
            later(VOLLEY_PLAY_DELAY_MS * (index + 1), () => setLiveState(prev => {
                const currentTrickCards = [...prev.currentTrickCards, { playerName: name, card }];
                // The server completes the trick in the same broadcast as the
                // last card, so the linger (and the magnet's hold) starts while
                // that card is still flying in — exactly what a live table does.
                return completesTrick
                    ? {
                        ...prev,
                        currentTrickCards,
                        state: 'TrickCompleteLinger',
                        trickTurnPlayerName: null,
                        lastCompletedTrick: { cards: currentTrickCards, winnerName: responders[0] },
                    }
                    : { ...prev, currentTrickCards, trickTurnPlayerName: responders[index + 1] };
            }));
        });
        const trickDone = VOLLEY_PLAY_DELAY_MS * responders.length;
        later(trickDone + VOLLEY_LINGER_MS, () => setLiveState(prev => ({
            ...prev,
            state: 'Playing Phase',
            currentTrickCards: [],
            leadSuitCurrentTrick: null,
            trickTurnPlayerName: 'You',
        })));
    }, []);

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
        // Acceptance is decided against the latest committed state (a ref,
        // since updaters may run lazily) so the volley only follows a real play.
        if (!liveStateRef.current.hands.You.includes(payload.card)) return;
        setLiveState(prev => ({
            ...prev,
            hands: { ...prev.hands, You: prev.hands.You.filter(c => c !== payload.card) },
            currentTrickCards: [...prev.currentTrickCards, { playerName: 'You', card: payload.card }],
            trickTurnPlayerName: 'Brandi',
        }));
        if (volley) runVolley();
    }, [runVolley]);

    return (
        <>
            <OrientationScrim />
            <GameHeader />
            <div className="app-content-container with-header app-view-gameTable">
                <GameTableView
                    user={{ id: 101, username: 'You', is_admin: true, is_vip: true }}
                    playerId={101}
                    currentTableState={liveState}
                    handleLeaveTable={noop}
                    handleLogout={noop}
                    handleShowHowToPlay={noop}
                    errorMessage=""
                    emitEvent={emitEvent}
                    playSound={(name) => console.log('[harness] playSound', name)}
                    playRoundBell={() => console.log('[harness] ding ding')}
                    playRoundCall={(key) => console.log('[harness] ding ding + round call', key)}
                    tournament={(ringCardRound > 0 && params.get('players')) || playersLeft > 0
                        ? {
                            id: 1,
                            status: 'running',
                            playersLeft: playersLeft || Number(params.get('players')) || 0,
                            roundCall: ringCardRound > 0 && params.get('players')
                                ? { round: ringCardRound, playersLeft: Number(params.get('players')), dealInSeconds: 8, audio: false }
                                : null,
                        }
                        : undefined}
                    ringCardHold={ringCardHold}
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
    // ?tables=0 for empty venues; by default every venue has a few private
    // tables in different states. ?tourney=open|running|none for the slot.
    const seat = (userId, playerName) => ({ userId, playerName, isSpectator: false, isBot: false });
    const cannedTables = (venue, label) => (params.get('tables') === '0' ? [] : [
        { tableId: venue + '-1', tableName: label + ' 1', playerMode: 4, state: 'Waiting for Players', players: [seat(201, 'Mcsaddle')] },
        { tableId: venue + '-2', tableName: label + ' 2', playerMode: 4, state: 'Playing Phase', players: [seat(202, 'jazzachy'), seat(203, 'CJ'), seat(204, 'Zacattack')] },
        { tableId: venue + '-3', tableName: label + ' 3', playerMode: 4, state: 'Waiting for Players', players: [] },
        { tableId: venue + '-4', tableName: label + ' 4', playerMode: 3, state: 'Ready to Start', players: [seat(205, 'Devondampier'), seat(206, 'Kimba'), seat(207, 'Flo')] },
        { tableId: venue + '-5', tableName: label + ' 5', playerMode: 4, state: 'Waiting for Players', players: [] },
    ]);
    const lobbyThemes = [
        { id: 'miss-pauls-academy', name: 'Academy', cost: 0.1, tables: cannedTables('academy', 'Academy') },
        { id: 'fort-creek', name: 'Fort Creek', cost: 1, tables: cannedTables('fort-creek', 'Fort Creek') },
        { id: 'shirecliff-road', name: 'Shirecliff', cost: 5, tables: cannedTables('shirecliff', 'Shirecliff') },
        { id: 'dans-deck', name: 'Eaglewood', cost: 20, tables: cannedTables('eaglewood', 'Eaglewood') },
    ];
    const tourney = params.get('tourney') || 'open';
    const tournamentLobby = tourney === 'open'
        ? { open: { id: 32, name: "Mcsaddle's Tournament", status: 'registering', seatsTaken: 5, maxSeats: 9, buyInTokens: 25, startRule: 'creator', startsAt: null, creatorUserId: 201, creatorName: 'Mcsaddle', entries: [] }, running: [] }
        : tourney === 'running'
            ? { open: null, running: [{ id: 31, name: "Mcsaddle's Tournament", status: 'running', round: 6, playersLeft: 5 }] }
            : { open: null, running: [] };
    ReactDOM.createRoot(document.getElementById('root')).render(
        <div style={{ height: '100dvh' }}>
        <LobbyView
            user={{ id: 101, username: 'You', tokens: '12.00', wins: 4, losses: 2, washes: 1, is_admin: false }}
            lobbyThemes={lobbyThemes}
            tournamentLobby={tournamentLobby}
            myTournament={null}
            handleOpenTournament={noop}
            handleCreateTournament={noop}
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
        </div>
    );
}

// --- Tournament board preview: /harness.html?mode=tourney[&phase=wait|board|host] ---
// The reseat board between rounds with several tables: `wait` = your table
// is done and two are still playing, `board` = every table is done and the
// room is on the countdown with the chip drain, `host` = the busted creator
// watching a bots-only finish (the Fast play switch). ?me=<userId> to sit in
// another seat (11 Matt/host, 12 Bob, 16 Flo busted).
const tourneyMode = params.get('mode') === 'tourney';
if (tourneyMode) {
    const phase = params.get('phase') || 'wait';
    const meId = Number(params.get('me')) || (phase === 'host' ? 11 : 12);
    const entry = (userId, username, stack, extra = {}) => ({
        userId, username, status: 'playing', stack, sitOuts: 0, place: null, prizeTokens: 0, bustedRound: null, ...extra,
    });
    const entries = [
        entry(11, 'Matt', 262, phase === 'host' ? { status: 'busted', stack: -8, bustedRound: 4 } : {}),
        entry(12, 'Bob', 188),
        entry(13, 'Cara', 151),
        entry(14, 'Grandpa George', 139),
        entry(15, 'Vera Hearts', 96),
        entry(16, 'Flo', -14, { status: 'busted', bustedRound: 2 }),
        entry(17, 'Otis Draw', 74),
        entry(18, 'Stephen Richins', 61),
        entry(19, 'Kimba', 47),
        entry(20, 'Dolly Deal', 62),
        entry(21, 'Doc Shuffle', -3, { status: 'busted', bustedRound: 4 }),
        entry(22, 'Ruby Rook', 40),
    ];
    const table = (tableIndex, seats, finished, trick, extra = {}) => ({
        tableId: `tn-1-r5-t${tableIndex + 1}`, tableIndex, playerMode: 3, seats, dealer: seats[0], sitOuts: [],
        finished, phase: finished ? 'done' : 'playing', trick, tricksTotal: 11, ...extra,
    });
    const allDone = phase !== 'wait';
    const tables = [
        table(0, ['Matt', 'Bob', 'Cara'], true, 11),
        table(1, ['Grandpa George', 'Vera Hearts', 'Otis Draw'], allDone, allDone ? 11 : 6),
        table(2, ['Stephen Richins', 'Kimba', 'Dolly Deal', 'Ruby Rook'], allDone, allDone ? 11 : 2, { playerMode: 4, sitOuts: ['Ruby Rook'] }),
    ];
    const drops = Object.fromEntries(entries.filter(e => e.status === 'playing').map(e => [e.username, Math.ceil(e.stack / 9)]));
    const tournament = {
        id: 1,
        name: 'Labor Day',
        venue: 'tournament-stage',
        buyInTokens: 1,
        startingStack: 120,
        maxSeats: 12,
        startRule: 'creator',
        startsAt: null,
        status: 'running',
        round: 5,
        drainPercent: 10,
        lastDrain: allDone ? { round: 5, percent: 10, drops } : null,
        nextRoundInSeconds: allDone ? 7 : null,
        creatorUserId: 11,
        creatorName: 'Matt',
        seatsTaken: 12,
        playersLeft: entries.filter(e => e.status === 'playing').length,
        entries,
        tables,
        closeReason: null,
        fastPlay: false,
        botsOnly: phase === 'host',
        viewer: { entered: true, status: 'playing', isCreator: meId === 11, tableId: null, watchingTableId: null },
    };
    const me = entries.find(e => e.userId === meId);
    document.body.style.background = '#111214';
    // &phone=1 frames the board at phone-portrait width inside a wide window.
    if (params.get('phone')) {
        const root = document.getElementById('root');
        Object.assign(root.style, {
            width: '430px', height: '900px', margin: '16px auto', overflow: 'auto',
            border: '1px solid #444', borderRadius: '24px', background: '#111214',
        });
    }
    ReactDOM.createRoot(document.getElementById('root')).render(
        <TournamentView
            tournament={tournament}
            user={{ id: meId, username: me?.username || 'You' }}
            onJoin={noop}
            onLeave={noop}
            onFindPlayer={noop}
            onStart={noop}
            onCancel={noop}
            onQuit={noop}
            onWatch={(tableId) => console.log('[harness] watch', tableId)}
            onFastPlay={(enabled) => console.log('[harness] fastPlay', enabled)}
            onBack={noop}
        />
    );
}

// --- Share-card renders: /harness.html?mode=og&variant=home|tournament|table ---
// A 1200×630 Open Graph card at the top-left of the page, captured to
// public/sluff-*-preview-*.png. SLUFF is the headline; the tagline is the
// footnote. (Chrome screenshot → Pillow crop; see the session notes.)
const ogMode = params.get('mode') === 'og';
if (ogMode) {
    const variant = params.get('variant') || 'home';
    const ribbon = { tournament: 'You’re invited · Tournament', table: 'A seat is saved for you' }[variant] || null;
    const line = { tournament: 'Come play in a Sluff tournament.', table: 'Come take your seat at the table.' }[variant]
        || 'The card game you throw.';
    Object.assign(document.body.style, { margin: '0', background: '#0b1f15' });
    ReactDOM.createRoot(document.getElementById('root')).render(
        <div className="claude-landing" style={{ width: 1200, height: 630, position: 'relative', overflow: 'hidden', background: 'var(--cl-night)' }}>
            <div style={{
                position: 'absolute', inset: 0,
                background: 'radial-gradient(ellipse at 50% 30%, rgba(227,169,61,0.16), transparent 48%), linear-gradient(180deg, rgba(8,24,16,0.88) 0%, rgba(11,31,21,0.78) 50%, rgba(6,18,12,0.97) 100%), url(/assets/themes/academy-green-felt.webp) center / cover no-repeat',
            }} />
            {ribbon && (
                <div style={{
                    position: 'absolute', top: 44, left: 0, right: 0, textAlign: 'center',
                    fontFamily: "'Oswald', 'Segoe UI', sans-serif", fontWeight: 600, fontSize: 30, letterSpacing: '0.24em',
                    textTransform: 'uppercase', color: '#e3a93d',
                }}>{ribbon}</div>
            )}
            <img src="/SluffLogo.png" alt="Sluff" style={{
                position: 'absolute', left: '50%', top: ribbon ? 84 : 52, transform: 'translateX(-50%)', width: ribbon ? 600 : 640,
                filter: 'drop-shadow(0 24px 44px rgba(0,0,0,0.6)) drop-shadow(0 0 40px rgba(227,169,61,0.16))',
            }} />
            <div style={{
                position: 'absolute', left: 0, right: 0, top: ribbon ? 496 : 492, textAlign: 'center',
                fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 42, color: '#f6efe0', letterSpacing: '0.005em',
            }}>{line}</div>
            <div style={{
                position: 'absolute', left: 64, bottom: 34, fontFamily: "Georgia, serif", fontStyle: 'italic', fontSize: 22,
                color: 'rgba(246,239,224,0.6)',
            }}>Pick your card. <span style={{ color: '#e3a93d' }}>Send it.</span></div>
            <div style={{
                position: 'absolute', right: 64, bottom: 34, fontFamily: "'Oswald', 'Segoe UI', sans-serif", fontSize: 22,
                letterSpacing: '0.16em', textTransform: 'uppercase', color: 'rgba(246,239,224,0.7)',
            }}>playsluff.com · free to play</div>
        </div>
    );
}

if (!identMode && !lobbyMode && !tourneyMode && !ogMode) {
document.body.classList.add('game-active');

ReactDOM.createRoot(document.getElementById('root')).render(<HarnessApp />);
}
