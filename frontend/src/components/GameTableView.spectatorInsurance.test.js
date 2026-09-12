// An observer follows the insurance negotiation from the footer: the
// bidder's ask, each defender's offer and the gap, then the locked deal —
// read-only. The real InsuranceControls and InsurancePrompt render here
// (every other table widget is stubbed) so the gate is tested end to end
// from the table state a spectator actually receives. Sept 2026: spectators
// used to get the inactive "Insurance: lock score" placeholder instead.

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
vi.mock('./game/BidWinnerSplash', () => ({ default: () => null }));
vi.mock('./game/IosPwaPrompt', () => ({ default: () => null }));
vi.mock('./game/VoiceControls', () => ({ default: () => null }));
vi.mock('./game/TipsBeacon', () => ({ default: () => null }));
vi.mock('./game/coach/LearnerCoach', () => ({ default: () => null }));

const socket = { id: 'watch-socket', on: vi.fn(), off: vi.fn() };

const negotiation = {
    isActive: true,
    bidMultiplier: 1,
    bidderPlayerName: 'Alice',
    bidderRequirement: 20,
    defenderOffers: { Bob: -10, Cara: 5 },
    dealExecuted: false,
    executedDetails: null,
};

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
    insurance: negotiation,
    roundSummary: null,
    trickTurnPlayerName: 'Alice',
    bidWinnerInfo: { userId: 1, playerName: 'Alice', bid: 'Solo' },
    trumpSuit: 'S',
    ...overrides,
});

const propsFor = (playerId, currentTableState, emitEvent = vi.fn()) => ({
    user: { id: playerId, username: currentTableState.players[playerId].playerName, is_admin: false },
    playerId,
    currentTableState,
    handleLeaveTable: vi.fn(),
    handleLogout: vi.fn(),
    handleShowHowToPlay: vi.fn(),
    emitEvent,
    playSound: vi.fn(),
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

const insuranceEmits = (emitEvent) => emitEvent.mock.calls.filter(([name]) => name === 'updateInsuranceSetting');

test('a spectator sees the ask, both offers and the gap in the footer, with nothing to press', () => {
    const emitEvent = vi.fn();
    render(<GameTableView {...propsFor(4, makeState(), emitEvent)} />);

    expect(screen.getByRole('button', { name: 'Insurance ask from Alice: 20. Open details' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Insurance offer from Bob: -10. Open details' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Insurance offer from Cara: 5. Open details' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Deal gap: 25\./ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^(Increase|Decrease) insurance/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Insurance: lock score')).not.toBeInTheDocument();
    expect(insuranceEmits(emitEvent)).toHaveLength(0);
});

test('the footer board follows the offers and then shows the locked deal', () => {
    const { rerender } = render(<GameTableView {...propsFor(4, makeState())} />);

    rerender(<GameTableView {...propsFor(4, makeState({
        insurance: { ...negotiation, defenderOffers: { Bob: -10, Cara: 25 } },
    }))} />);
    expect(screen.getByRole('button', { name: 'Insurance offer from Cara: 25. Open details' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Deal gap: 5\./ })).toBeInTheDocument();

    rerender(<GameTableView {...propsFor(4, makeState({
        insurance: {
            ...negotiation,
            defenderOffers: { Bob: -10, Cara: 30 },
            dealExecuted: true,
            executedDetails: { agreement: { bidderPlayerName: 'Alice', bidderRequirement: 20, bidderSettlement: 20, defenderOffers: { Bob: -10, Cara: 30 } } },
        },
        playoutVote: { isActive: true },
    }))} />);
    expect(screen.getByText('DEAL LOCKED')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Insurance (ask|offer) from/ })).not.toBeInTheDocument();
});

test('tapping the board opens the full negotiation read-only', async () => {
    const user = userEvent.setup();
    const emitEvent = vi.fn();
    render(<GameTableView {...propsFor(4, makeState(), emitEvent)} />);

    await user.click(screen.getByRole('button', { name: 'Insurance offer from Bob: -10. Open details' }));

    const dialog = screen.getByRole('dialog', { name: 'Insurance — Lock the Score' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('Bob -10 · Cara +5')).toBeInTheDocument();
    expect(screen.getByText(/only the bidder and the two defenders can change it/)).toBeInTheDocument();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Save/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close insurance panel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(insuranceEmits(emitEvent)).toHaveLength(0);
});

test('a seated defender at the same table still gets the steppers', async () => {
    const user = userEvent.setup();
    const emitEvent = vi.fn();
    render(<GameTableView {...propsFor(2, makeState(), emitEvent)} />);

    expect(screen.queryByRole('button', { name: /^Insurance (ask|offer) from/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Increase insurance offer' }));

    expect(insuranceEmits(emitEvent)).toEqual([
        ['updateInsuranceSetting', { settingType: 'defenderOffer', value: -9 }],
    ]);
});
