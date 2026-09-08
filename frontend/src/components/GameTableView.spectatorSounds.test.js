// A spectator hears the table: cards landing, the bidding accents, the deal.
// Only the calls to act (turn alerts) are personal and stay silent for a
// watcher. Sept 2026: the whole table-sound effect used to bail out for
// spectators, so watching a game had no card sound at all.

import React from 'react';
import { cleanup, render } from '@testing-library/react';
import GameTableView from './GameTableView';

vi.mock('../services/api', () => ({
    getLobbyChatHistory: vi.fn(() => new Promise(() => {})),
    getSeenTips: vi.fn(() => Promise.resolve([])),
    markTipSeen: vi.fn(() => Promise.resolve({})),
}));
vi.mock('../hooks/usePrefersReducedMotion', () => ({ usePrefersReducedMotion: () => false }));
vi.mock('../hooks/useBidWinnerSplash', () => ({
    useBidWinnerSplash: () => ({ bidSplashInfo: null, dismissBidSplash: vi.fn() }),
}));
vi.mock('./game/TableLayout', () => ({ default: () => <div data-testid="table" /> }));
vi.mock('./game/PlayerHand', () => ({ default: () => null }));
vi.mock('./game/DealAnimation', () => ({ default: () => null }));
vi.mock('./game/TutorialCoach', () => ({ FIRST_GAME_TUTORIAL_VERSION: 1, default: () => null }));
vi.mock('./game/RoundSummaryModal', () => ({ default: () => null }));
vi.mock('./game/GameOverPodium', () => ({ default: () => null }));
vi.mock('./game/DrawVoteModal', () => ({ default: () => null }));
vi.mock('./game/PlayoutVoteModal', () => ({ default: () => null }));
vi.mock('./game/InsuranceControls', () => ({ default: () => null }));
vi.mock('./game/InsurancePrompt', () => ({ default: () => null }));
vi.mock('./game/BidWinnerSplash', () => ({ default: () => null }));
vi.mock('./game/IosPwaPrompt', () => ({ default: () => null }));
vi.mock('./game/VoiceControls', () => ({ default: () => null }));

const socket = { id: 'watch-socket', on: vi.fn(), off: vi.fn() };

const makeState = (overrides = {}) => ({
    tableId: 'watch-table-1',
    tableName: 'Watched table',
    state: 'Playing Phase',
    gameStarted: true,
    playerMode: 3,
    dealer: 3,
    scores: { Alice: 120, Bob: 120, Cara: 120 },
    players: {
        1: { userId: 1, playerName: 'Alice', isSpectator: false, disconnected: false },
        2: { userId: 2, playerName: 'Bob', isSpectator: false, disconnected: false },
        3: { userId: 3, playerName: 'Cara', isSpectator: false, disconnected: false },
        4: { userId: 4, playerName: 'Watcher', isSpectator: true, disconnected: false },
    },
    seatingOrder: ['Alice', 'Bob', 'Cara'],
    playerOrderActive: ['Alice', 'Bob', 'Cara'],
    hands: {},
    widow: [],
    originalDealtWidow: [],
    widowCount: 0,
    currentTrickCards: [],
    capturedTricks: {},
    insurance: {},
    roundSummary: null,
    trickTurnPlayerName: 'Alice',
    bidWinnerInfo: { userId: 1, playerName: 'Alice', bid: 'Solo' },
    trumpSuit: 'S',
    ...overrides,
});

const propsFor = (playerId, currentTableState, playSound) => ({
    user: { id: playerId, username: currentTableState.players[playerId].playerName, is_admin: false },
    playerId,
    currentTableState,
    handleLeaveTable: vi.fn(),
    handleLogout: vi.fn(),
    handleShowHowToPlay: vi.fn(),
    emitEvent: vi.fn(),
    playSound,
    socket,
    handleOpenFeedbackModal: vi.fn(),
    soundSettings: {
        muted: false, volume: 0.5, toggleMute: vi.fn(), setVolume: vi.fn(),
        musicMuted: false, musicVolume: 0.25, toggleMusicMute: vi.fn(), setMusicVolume: vi.fn(),
    },
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

const soundsPlayed = (playSound) => playSound.mock.calls.map(([name]) => name);

test('a spectator hears cards land and the bidding accents, but is never called to act', () => {
    const playSound = vi.fn();
    const { rerender } = render(<GameTableView {...propsFor(4, makeState(), playSound)} />);
    expect(soundsPlayed(playSound)).not.toContain('cardPlay');

    rerender(<GameTableView {...propsFor(4, makeState({
        currentTrickCards: [{ userId: 1, playerName: 'Alice', card: 'AS' }],
        trickTurnPlayerName: 'Bob',
    }), playSound)} />);
    expect(soundsPlayed(playSound)).toContain('cardPlay');

    playSound.mockClear();
    rerender(<GameTableView {...propsFor(4, makeState({
        currentTrickCards: [
            { userId: 1, playerName: 'Alice', card: 'AS' },
            { userId: 2, playerName: 'Bob', card: '10S' },
        ],
        trickTurnPlayerName: 'Watcher',
    }), playSound)} />);
    expect(soundsPlayed(playSound)).toContain('cardPlay');
    expect(soundsPlayed(playSound)).not.toContain('turnAlert');

    playSound.mockClear();
    rerender(<GameTableView {...propsFor(4, makeState({
        state: 'Bidding Phase',
        biddingTurnPlayerName: 'Watcher',
        currentHighestBidDetails: { bid: 'Solo', playerName: 'Bob' },
    }), playSound)} />);
    expect(soundsPlayed(playSound)).toContain('bidSolo');
    expect(soundsPlayed(playSound)).not.toContain('turnAlert');
});

test('a seated player still gets the turn alert on top of the table sounds', () => {
    const playSound = vi.fn();
    const { rerender } = render(<GameTableView {...propsFor(2, makeState(), playSound)} />);
    rerender(<GameTableView {...propsFor(2, makeState({
        currentTrickCards: [{ userId: 1, playerName: 'Alice', card: 'AS' }],
        trickTurnPlayerName: 'Bob',
    }), playSound)} />);
    expect(soundsPlayed(playSound)).toContain('cardPlay');
    expect(soundsPlayed(playSound)).toContain('turnAlert');
});
