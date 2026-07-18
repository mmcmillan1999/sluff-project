// frontend/src/devHarness.jsx
// Dev-only layout harness: mounts the real GameTableView with a canned
// mid-round state so the table can be screenshotted at any viewport without
// a backend. Served by `npm run dev` at /harness.html (never bundled into
// the production build, which only includes index.html).
// Query params: ?mode=4 for the four-player table (default 3).

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
import OrientationScrim from './components/OrientationScrim.js';

const params = new URLSearchParams(window.location.search);
const playerMode = params.get('mode') === '4' ? 4 : 3;
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

const noop = () => {};
const fakeSocket = {
    id: 'harness-socket',
    connected: false,
    on: noop,
    off: noop,
    emit: noop,
    io: { on: noop, off: noop },
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

document.body.classList.add('game-active');

ReactDOM.createRoot(document.getElementById('root')).render(
    <>
        <OrientationScrim />
        <GameHeader />
        <div className="app-content-container with-header app-view-gameTable">
            <GameTableView
                user={{ id: 101, username: 'You', is_admin: false }}
                playerId={101}
                currentTableState={tableState}
                handleLeaveTable={noop}
                handleLogout={noop}
                handleShowHowToPlay={noop}
                errorMessage=""
                emitEvent={noop}
                playSound={noop}
                socket={fakeSocket}
                handleOpenFeedbackModal={noop}
                soundSettings={soundSettings}
                onShowTokenLedger={noop}
            />
        </div>
    </>
);
