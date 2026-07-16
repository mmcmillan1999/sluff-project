import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import GameTableView from './GameTableView';

const { motionPreference } = vi.hoisted(() => ({
    motionPreference: { reduced: false },
}));

vi.mock('../services/api', () => ({
    getLobbyChatHistory: vi.fn(() => new Promise(() => {})),
}));

vi.mock('../hooks/usePrefersReducedMotion', () => ({
    usePrefersReducedMotion: () => motionPreference.reduced,
}));

vi.mock('../hooks/useBidWinnerSplash', () => ({
    useBidWinnerSplash: () => ({ bidSplashInfo: null, dismissBidSplash: vi.fn() }),
}));

vi.mock('./game/TableLayout', () => ({
    default: ({
        currentTableState,
        dealPresentationActive,
        dealCardsRemaining,
        suppressActionControls,
    }) => (
        <div data-testid="deal-table">
            <span data-testid="table-state">{currentTableState.state}</span>
            <span data-testid="table-widow-count">{currentTableState.widowCount}</span>
            <span data-testid="table-private-widow">{currentTableState.widow?.length || 0}</span>
            <span data-testid="deal-active">{String(dealPresentationActive)}</span>
            <span data-testid="deal-remaining">{dealCardsRemaining}</span>
            <span data-testid="deal-controls-suppressed">{String(suppressActionControls)}</span>
        </div>
    ),
}));

vi.mock('./game/PlayerHand', () => ({
    default: ({ currentTableState, selfPlayerName }) => (
        <div data-testid="visible-hand-count">
            {currentTableState.hands?.[selfPlayerName]?.length || 0}
        </div>
    ),
}));

vi.mock('./game/DealAnimation', () => ({
    default: ({
        active,
        playerOrder,
        localPlayerName,
        onCardLaunch,
        onCardArrive,
        onComplete,
    }) => active ? (
        <div data-testid="deal-animation">
            <span data-testid="deal-order">{playerOrder.join('|')}</span>
            <button
                type="button"
                onClick={() => onCardLaunch(
                    { type: 'player', playerName: localPlayerName, circuit: 0, playerIndex: 0 },
                    0,
                    36,
                )}
            >
                Launch card
            </button>
            <button
                type="button"
                onClick={() => onCardArrive(
                    { type: 'player', playerName: localPlayerName, circuit: 0, playerIndex: 0 },
                    0,
                    36,
                )}
            >
                Land local card
            </button>
            <button
                type="button"
                onClick={() => onCardArrive(
                    { type: 'player', playerName: 'Bob', circuit: 0, playerIndex: 1 },
                    1,
                    36,
                )}
            >
                Land opponent card
            </button>
            <button
                type="button"
                onClick={() => onCardArrive(
                    { type: 'widow', circuit: 0, widowIndex: 0 },
                    3,
                    36,
                )}
            >
                Land widow card
            </button>
            <button type="button" onClick={onComplete}>Finish deal</button>
        </div>
    ) : null,
}));

vi.mock('./game/TutorialCoach', () => ({
    FIRST_GAME_TUTORIAL_VERSION: 1,
    default: ({ currentTableState }) => (
        <div data-testid="tutorial-table-state">{currentTableState.state}</div>
    ),
}));

vi.mock('./game/RoundSummaryModal', () => ({ default: () => null }));
vi.mock('./game/GameOverPodium', () => ({ default: () => null }));
vi.mock('./game/DrawVoteModal', () => ({ default: () => null }));
vi.mock('./game/InsuranceControls', () => ({ default: () => null }));
vi.mock('./game/InsurancePrompt', () => ({ default: () => null }));
vi.mock('./game/BidWinnerSplash', () => ({ default: () => null }));
vi.mock('./game/IosPwaPrompt', () => ({ default: () => null }));

const socket = {
    id: 'deal-socket',
    on: vi.fn(),
    off: vi.fn(),
};

const LOCAL_HAND = [
    '6H', '7H', '8H', '9H', 'JH', 'QH', 'KH', '10H', 'AH', '6D', '7D',
];

const makeState = (state, overrides = {}) => ({
    tableId: 'deal-table-1',
    tableName: 'Deal animation table',
    state,
    gameStarted: true,
    playerMode: 3,
    dealer: 3,
    scores: { Alice: 120, Bob: 120, Cara: 120 },
    players: {
        1: { userId: 1, playerName: 'Alice', isSpectator: false, disconnected: false },
        2: { userId: 2, playerName: 'Bob', isSpectator: false, disconnected: false },
        3: { userId: 3, playerName: 'Cara', isSpectator: false, disconnected: false },
    },
    seatingOrder: ['Alice', 'Bob', 'Cara'],
    playerOrderActive: ['Alice', 'Bob', 'Cara'],
    hands: state === 'Bidding Phase' ? { Alice: LOCAL_HAND } : {},
    widow: state === 'Bidding Phase' ? ['8D', '9D', 'JD'] : [],
    originalDealtWidow: state === 'Bidding Phase' ? ['8D', '9D', 'JD'] : [],
    widowCount: state === 'Bidding Phase' ? 3 : 0,
    currentTrickCards: [],
    capturedTricks: {},
    insurance: {},
    roundSummary: null,
    ...overrides,
});

const baseProps = (currentTableState) => ({
    user: { id: 1, username: 'Alice', is_admin: false },
    playerId: 1,
    currentTableState,
    handleLeaveTable: vi.fn(),
    handleLogout: vi.fn(),
    handleShowHowToPlay: vi.fn(),
    emitEvent: vi.fn(),
    playSound: vi.fn(),
    socket,
    handleOpenFeedbackModal: vi.fn(),
    soundSettings: {
        muted: false,
        volume: 0.5,
        toggleMute: vi.fn(),
        setVolume: vi.fn(),
        musicMuted: false,
        musicVolume: 0.25,
        toggleMusicMute: vi.fn(),
        setMusicVolume: vi.fn(),
    },
});

const strictGame = (props) => (
    <React.StrictMode>
        <GameTableView {...props} />
    </React.StrictMode>
);

afterEach(() => {
    cleanup();
    motionPreference.reduced = false;
    vi.clearAllMocks();
});

describe('GameTableView deal presentation', () => {
    test('masks the dealt hand and widow until their face-down flights land', () => {
        const pendingProps = baseProps(makeState('Dealing Pending'));
        const { rerender } = render(strictGame(pendingProps));

        rerender(strictGame({
            ...pendingProps,
            currentTableState: makeState('Bidding Phase'),
        }));

        expect(screen.getByTestId('deal-animation')).toBeInTheDocument();
        expect(screen.getByTestId('deal-order')).toHaveTextContent('Alice|Bob|Cara');
        expect(screen.getByTestId('visible-hand-count')).toHaveTextContent('0');
        expect(screen.getByTestId('table-widow-count')).toHaveTextContent('0');
        expect(screen.getByTestId('table-private-widow')).toHaveTextContent('0');
        expect(screen.getByTestId('deal-active')).toHaveTextContent('true');
        expect(screen.getByTestId('deal-remaining')).toHaveTextContent('36');
        expect(screen.getByTestId('deal-controls-suppressed')).toHaveTextContent('true');
        expect(screen.getByTestId('tutorial-table-state')).toHaveTextContent('Dealing Pending');

        fireEvent.click(screen.getByRole('button', { name: 'Launch card' }));
        expect(screen.getByTestId('deal-remaining')).toHaveTextContent('35');

        fireEvent.click(screen.getByRole('button', { name: 'Land opponent card' }));
        expect(screen.getByTestId('visible-hand-count')).toHaveTextContent('0');

        fireEvent.click(screen.getByRole('button', { name: 'Land local card' }));
        expect(screen.getByTestId('visible-hand-count')).toHaveTextContent('1');

        fireEvent.click(screen.getByRole('button', { name: 'Land widow card' }));
        expect(screen.getByTestId('table-widow-count')).toHaveTextContent('1');

        for (let index = 1; index < 11; index += 1) {
            fireEvent.click(screen.getByRole('button', { name: 'Land local card' }));
        }
        for (let index = 1; index < 3; index += 1) {
            fireEvent.click(screen.getByRole('button', { name: 'Land widow card' }));
        }
        expect(screen.getByTestId('visible-hand-count')).toHaveTextContent('11');
        expect(screen.getByTestId('table-widow-count')).toHaveTextContent('3');

        fireEvent.click(screen.getByRole('button', { name: 'Finish deal' }));
        expect(screen.queryByTestId('deal-animation')).not.toBeInTheDocument();
        expect(screen.getByTestId('visible-hand-count')).toHaveTextContent('11');
        expect(screen.getByTestId('table-widow-count')).toHaveTextContent('3');
        expect(screen.getByTestId('table-private-widow')).toHaveTextContent('3');
        expect(screen.getByTestId('deal-active')).toHaveTextContent('false');
        expect(screen.getByTestId('deal-controls-suppressed')).toHaveTextContent('false');
        expect(screen.getByTestId('tutorial-table-state')).toHaveTextContent('Bidding Phase');
    });

    test('does not replay a deal when a client mounts or reconnects during bidding', () => {
        render(strictGame(baseProps(makeState('Bidding Phase'))));

        expect(screen.queryByTestId('deal-animation')).not.toBeInTheDocument();
        expect(screen.getByTestId('visible-hand-count')).toHaveTextContent('11');
        expect(screen.getByTestId('table-widow-count')).toHaveTextContent('3');
        expect(screen.getByTestId('deal-controls-suppressed')).toHaveTextContent('false');
    });

    test('skips decorative flights when reduced motion is requested', () => {
        motionPreference.reduced = true;
        const pendingProps = baseProps(makeState('Dealing Pending'));
        const { rerender } = render(strictGame(pendingProps));

        rerender(strictGame({
            ...pendingProps,
            currentTableState: makeState('Bidding Phase'),
        }));

        expect(screen.queryByTestId('deal-animation')).not.toBeInTheDocument();
        expect(screen.getByTestId('visible-hand-count')).toHaveTextContent('11');
        expect(screen.getByTestId('table-widow-count')).toHaveTextContent('3');
        expect(screen.getByTestId('deal-controls-suppressed')).toHaveTextContent('false');
        expect(screen.getByTestId('tutorial-table-state')).toHaveTextContent('Bidding Phase');
    });

    test('cancels the presentation if authoritative play advances beyond bidding', () => {
        const pendingProps = baseProps(makeState('Dealing Pending'));
        const { rerender } = render(strictGame(pendingProps));
        rerender(strictGame({
            ...pendingProps,
            currentTableState: makeState('Bidding Phase'),
        }));
        expect(screen.getByTestId('deal-animation')).toBeInTheDocument();

        rerender(strictGame({
            ...pendingProps,
            currentTableState: makeState('Bid Announcement', {
                hands: { Alice: LOCAL_HAND },
                widowCount: 3,
            }),
        }));

        expect(screen.queryByTestId('deal-animation')).not.toBeInTheDocument();
        expect(screen.getByTestId('visible-hand-count')).toHaveTextContent('11');
        expect(screen.getByTestId('deal-controls-suppressed')).toHaveTextContent('false');
    });
});
