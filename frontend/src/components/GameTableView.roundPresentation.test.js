import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GameTableView from './GameTableView';
import { END_ROUND_TOTAL_MS, SETTLED_RECAP_HOLD_MS } from '../config/endRoundTiming';

vi.mock('../services/api', () => ({
    getLobbyChatHistory: vi.fn(() => new Promise(() => {}))
}));

const { motionPreference } = vi.hoisted(() => ({
    motionPreference: { reduced: true }
}));

vi.mock('../hooks/usePrefersReducedMotion', () => ({
    usePrefersReducedMotion: () => motionPreference.reduced
}));

vi.mock('../hooks/useBidWinnerSplash', () => ({
    useBidWinnerSplash: () => ({ bidSplashInfo: null, dismissBidSplash: vi.fn() })
}));

vi.mock('./game/RoundSummaryModal', () => ({
    default: ({ showModal, continueLabel, onContinue, scoreStage, onScoreComplete }) => {
        if (!showModal) return null;
        if (scoreStage === 'counting') {
            return (
                <button type="button" onClick={() => onScoreComplete({ skipped: false, rows: [] })}>
                    Finish Score Ceremony
                </button>
            );
        }
        if (scoreStage === 'complete') return <div>Score Totals Complete</div>;
        return <button type="button" onClick={onContinue}>{continueLabel}</button>;
    }
}));

vi.mock('./game/GameOverPodium', () => ({
    default: ({ show, onRematch, onLobby, actionsDisabled, tokenSettlement }) => show ? (
        <div role="dialog" aria-label="Winner podium">
            <span data-testid="podium-token-settlement">{JSON.stringify(tokenSettlement || null)}</span>
            <button type="button" onClick={onRematch} disabled={actionsDisabled || !onRematch}>Rematch</button>
            <button type="button" onClick={onLobby}>Lobby</button>
        </div>
    ) : null
}));

vi.mock('./game/TableLayout', () => ({
    default: ({ currentTableState, roundPresentationComplete }) => (
        <div>
            <span data-testid="alice-table-score">{currentTableState.scores.Alice}</span>
            <span data-testid="round-presentation-complete">{String(roundPresentationComplete)}</span>
        </div>
    )
}));

vi.mock('./game/DrawVoteModal', () => ({ default: () => null }));
vi.mock('./game/PlayerHand', () => ({ default: () => null }));
vi.mock('./game/InsuranceControls', () => ({ default: () => null }));
vi.mock('./game/InsurancePrompt', () => ({ default: () => null }));
vi.mock('./game/BidWinnerSplash', () => ({ default: () => null }));
vi.mock('./game/IosPwaPrompt', () => ({ default: () => null }));

const socket = {
    id: 'socket-1',
    on: vi.fn(),
    off: vi.fn()
};

const makeState = ({
    state = 'Awaiting Next Round Trigger',
    theme = 'fort-creek',
    isGameOver = false,
    forfeit,
    presentationReadyAt,
    presentationForceReadyAt,
    allConnectedHumansPresented = true,
    settlementStatus = 'complete',
    serverTime,
    viewerRoundPresentationAcknowledged
} = {}) => ({
    tableId: 'table-1',
    tableName: 'Presentation table',
    theme,
    state,
    serverTime,
    viewerRoundPresentationAcknowledged,
    gameStarted: true,
    settlement: { status: settlementStatus },
    scores: { Alice: 132, Bob: 114, Cara: 114 },
    players: {
        1: { userId: 1, playerName: 'Alice', isSpectator: false, disconnected: false },
        2: { userId: 2, playerName: 'Bob', isSpectator: false, disconnected: false },
        3: { userId: 3, playerName: 'Cara', isSpectator: false, disconnected: false }
    },
    seatingOrder: ['Alice', 'Bob', 'Cara'],
    playerOrderActive: ['Alice', 'Bob', 'Cara'],
    insurance: {},
    roundSummary: {
        isGameOver,
        forfeit,
        dealerOfRoundId: 1,
        gameWinner: isGameOver ? 'Alice' : null,
        finalScores: { Alice: 132, Bob: 114, Cara: 114 },
        pointChanges: forfeit ? undefined : { Alice: 12, Bob: -6, Cara: -6 },
        presentationReadyAt,
        presentationForceReadyAt,
        allConnectedHumansPresented
    }
});

const renderGame = (currentTableState, overrides = {}) => {
    const props = {
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
            setVolume: vi.fn()
        },
        ...overrides
    };
    return {
        ...render(<React.StrictMode><GameTableView {...props} /></React.StrictMode>),
        props
    };
};

afterEach(() => {
    cleanup();
    motionPreference.reduced = true;
    socket.id = 'socket-1';
    vi.useRealTimers();
    vi.clearAllMocks();
});

describe('GameTableView round presentation sequence', () => {
    test('portals the open game menu into the top-level overlay layer', async () => {
        const user = userEvent.setup();
        renderGame(makeState({ state: 'Playing Phase' }));

        const menuButton = screen.getByRole('button', { name: 'Open game menu' });
        await user.click(menuButton);

        const menu = screen.getByRole('dialog', { name: 'Game menu' });
        const menuLayer = menu.closest('.game-menu-layer');
        const gameView = document.querySelector('.game-view');
        expect(menuLayer).not.toBeNull();
        expect(menuLayer.parentElement).toBe(document.body);
        expect(menu.closest('.game-view')).toBeNull();
        expect(gameView).toHaveAttribute('data-table-theme', 'fort-creek');
        expect(menuLayer).toHaveAttribute('data-table-theme', 'fort-creek');
        expect(within(menu).getByText('Oakley ranch nights')).toBeInTheDocument();
        expect(within(menu).getByText('Cowhide, leather & campfire cards')).toBeInTheDocument();
        expect(menuButton).toHaveAttribute('aria-expanded', 'true');
        expect(getComputedStyle(menuLayer).zIndex).toBe('2147483000');

        await user.click(menuLayer.querySelector('.game-menu-backdrop'));
        expect(screen.queryByRole('dialog', { name: 'Game menu' })).not.toBeInTheDocument();
        expect(menuButton).toHaveAttribute('aria-expanded', 'false');
    });

    test('closes the portaled game menu with Escape', async () => {
        const user = userEvent.setup();
        renderGame(makeState({ state: 'Playing Phase' }));

        await user.click(screen.getByRole('button', { name: 'Open game menu' }));
        expect(screen.getByRole('dialog', { name: 'Game menu' })).toBeInTheDocument();

        await user.keyboard('{Escape}');
        expect(screen.queryByRole('dialog', { name: 'Game menu' })).not.toBeInTheDocument();
    });

    test('keeps the cleaned active-game menu open until the player dismisses it', () => {
        vi.useFakeTimers();
        renderGame(makeState({ state: 'Playing Phase' }), {
            user: { id: 1, username: 'Alice', is_admin: true }
        });

        const menuButton = screen.getByRole('button', { name: 'Open game menu' });
        fireEvent.click(menuButton);
        const menu = screen.getByRole('dialog', { name: 'Game menu' });

        expect(within(menu).queryByText(/^State:/)).not.toBeInTheDocument();
        expect(within(menu).queryByText(/^Bid:/)).not.toBeInTheDocument();
        expect(within(menu).getByRole('button', { name: 'How to Play' })).toHaveFocus();
        expect(within(menu).getByRole('button', { name: 'Invite Friends' })).toBeEnabled();
        expect(within(menu).getByRole('button', { name: 'Send Feedback' })).toBeEnabled();
        expect(within(menu).getByRole('button', { name: 'Return to Lobby' })).toHaveAccessibleDescription(
            /seat stays reserved.*does not forfeit/i
        );
        expect(within(menu).getByText('Game Actions')).toBeInTheDocument();
        expect(within(menu).getByRole('button', { name: 'Request Draw' })).toBeEnabled();
        expect(within(menu).getByRole('button', { name: 'Forfeit Game' })).toBeEnabled();
        expect(within(menu).queryByRole('button', { name: /Layout Dev/i })).not.toBeInTheDocument();

        act(() => vi.advanceTimersByTime(10_000));
        expect(screen.getByRole('dialog', { name: 'Game menu' })).toBeInTheDocument();

        fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.queryByRole('dialog', { name: 'Game menu' })).not.toBeInTheDocument();
        expect(menuButton).toHaveFocus();
    });

    test('hides player-only game actions from spectators', () => {
        const state = makeState({ state: 'Playing Phase' });
        state.players[1].isSpectator = true;
        renderGame(state);

        fireEvent.click(screen.getByRole('button', { name: 'Open game menu' }));
        const menu = screen.getByRole('dialog', { name: 'Game menu' });

        expect(within(menu).getByRole('button', { name: 'Return to Lobby' })).toBeEnabled();
        expect(within(menu).queryByText(/seat stays reserved/i)).not.toBeInTheDocument();
        expect(within(menu).queryByText('Game Actions')).not.toBeInTheDocument();
        expect(within(menu).queryByRole('button', { name: 'Request Draw' })).not.toBeInTheDocument();
        expect(within(menu).queryByRole('button', { name: 'Forfeit Game' })).not.toBeInTheDocument();
    });

    test('hides funded game actions before a game starts', () => {
        const state = makeState({ state: 'Ready to Start' });
        state.gameStarted = false;
        renderGame(state);

        fireEvent.click(screen.getByRole('button', { name: 'Open game menu' }));
        const menu = screen.getByRole('dialog', { name: 'Game menu' });

        expect(within(menu).queryByText(/seat stays reserved/i)).not.toBeInTheDocument();
        expect(within(menu).queryByRole('button', { name: 'Request Draw' })).not.toBeInTheDocument();
        expect(within(menu).queryByRole('button', { name: 'Forfeit Game' })).not.toBeInTheDocument();
    });

    test('offers forfeiting but not a draw outside the playing phase', () => {
        renderGame(makeState({ state: 'Bidding Phase' }));

        fireEvent.click(screen.getByRole('button', { name: 'Open game menu' }));
        const menu = screen.getByRole('dialog', { name: 'Game menu' });

        expect(within(menu).queryByRole('button', { name: 'Request Draw' })).not.toBeInTheDocument();
        expect(within(menu).getByRole('button', { name: 'Forfeit Game' })).toBeEnabled();
    });

    test('removes an open game menu when round presentation locks the controls', async () => {
        const user = userEvent.setup();
        const playingState = makeState({ state: 'Playing Phase' });
        const { rerender, props } = renderGame(playingState);

        await user.click(screen.getByRole('button', { name: 'Open game menu' }));
        expect(screen.getByRole('dialog', { name: 'Game menu' })).toBeInTheDocument();

        rerender(
            <React.StrictMode>
                <GameTableView {...props} currentTableState={makeState()} />
            </React.StrictMode>
        );

        await waitFor(() => {
            expect(screen.queryByRole('dialog', { name: 'Game menu' })).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Open game menu' })).not.toBeInTheDocument();
        });
    });

    test('keeps the delayed recap timer alive across the Strict Mode effect probe', () => {
        vi.useFakeTimers();
        motionPreference.reduced = false;
        renderGame(makeState());

        expect(screen.queryByRole('button', { name: 'Collect Points' })).not.toBeInTheDocument();
        act(() => vi.advanceTimersByTime(END_ROUND_TOTAL_MS - 1));
        expect(screen.queryByRole('button', { name: 'Collect Points' })).not.toBeInTheDocument();
        act(() => vi.advanceTimersByTime(1));
        expect(screen.getByRole('button', { name: 'Collect Points' })).toBeInTheDocument();
    });

    test('personalizes the recap action for the player giving up round points', () => {
        renderGame(makeState(), {
            playerId: 2,
            user: { id: 2, username: 'Bob', is_admin: false }
        });

        expect(screen.getByRole('button', { name: 'Hand Over Points' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Collect Points' })).not.toBeInTheDocument();
    });

    test('uses serverTime to honor the shared clock when the client clock is badly skewed', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-11T07:00:00Z'));
        const serverTime = 10_000;
        renderGame(makeState({
            serverTime,
            presentationReadyAt: serverTime + 7000
        }));

        fireEvent.click(screen.getByRole('button', { name: 'Collect Points' }));
        fireEvent.click(screen.getByRole('button', { name: 'Finish Score Ceremony' }));
        expect(screen.getByTestId('alice-table-score')).toHaveTextContent('132');
        expect(screen.getByTestId('round-presentation-complete')).toHaveTextContent('false');
        act(() => vi.advanceTimersByTime(SETTLED_RECAP_HOLD_MS));
        expect(screen.getByText('Score Totals Complete')).toBeInTheDocument();
        expect(screen.getByTestId('round-presentation-complete')).toHaveTextContent('false');
        act(() => vi.advanceTimersByTime(2025));
        expect(screen.getByTestId('round-presentation-complete')).toHaveTextContent('true');
    });

    test('defers a reconnecting terminal client only while settlement is pending', async () => {
        const emitEvent = vi.fn();
        const pendingState = makeState({
            state: 'Game Over',
            isGameOver: true,
            settlementStatus: 'pending',
            presentationReadyAt: Date.now() - 1
        });
        const { rerender, props } = renderGame(pendingState, { emitEvent });

        expect(screen.queryByRole('button', { name: 'Collect Points' })).not.toBeInTheDocument();
        expect(screen.queryByRole('dialog', { name: 'Winner podium' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Chat' })).toBeEnabled();
        expect(emitEvent).not.toHaveBeenCalledWith('ackRoundPresentation', expect.anything());

        const failedState = makeState({
            state: 'Game Over',
            isGameOver: true,
            settlementStatus: 'failed',
            presentationReadyAt: Date.now() - 1
        });
        rerender(
            <React.StrictMode>
                <GameTableView {...props} currentTableState={failedState} />
            </React.StrictMode>
        );

        expect(await screen.findByRole('dialog', { name: 'Winner podium' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Rematch' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Lobby' })).toBeEnabled();
        expect(emitEvent).not.toHaveBeenCalledWith('ackRoundPresentation', expect.anything());
    });

    test('re-acknowledges when the server invalidates the same viewer and presentation', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-11T07:00:00Z'));
        const presentationReadyAt = Date.now() + 1000;
        const emitEvent = vi.fn();
        const state = makeState({
            presentationReadyAt,
            viewerRoundPresentationAcknowledged: false
        });
        const { rerender, props } = renderGame(state, { emitEvent });

        fireEvent.click(screen.getByRole('button', { name: 'Collect Points' }));
        fireEvent.click(screen.getByRole('button', { name: 'Finish Score Ceremony' }));
        act(() => vi.advanceTimersByTime(SETTLED_RECAP_HOLD_MS));

        expect(emitEvent).toHaveBeenCalledTimes(1);
        expect(emitEvent).toHaveBeenLastCalledWith('ackRoundPresentation', { presentationReadyAt });

        rerender(
            <React.StrictMode>
                <GameTableView
                    {...props}
                    currentTableState={{
                        ...state,
                        viewerRoundPresentationAcknowledged: true
                    }}
                />
            </React.StrictMode>
        );
        expect(emitEvent).toHaveBeenCalledTimes(1);

        rerender(
            <React.StrictMode>
                <GameTableView
                    {...props}
                    currentTableState={{
                        ...state,
                        viewerRoundPresentationAcknowledged: false
                    }}
                />
            </React.StrictMode>
        );
        expect(emitEvent).toHaveBeenCalledTimes(2);
        expect(emitEvent).toHaveBeenLastCalledWith('ackRoundPresentation', { presentationReadyAt });

        rerender(
            <React.StrictMode>
                <GameTableView
                    {...props}
                    currentTableState={{
                        ...state,
                        viewerRoundPresentationAcknowledged: false,
                        players: {
                            ...state.players,
                            1: { ...state.players[1] }
                        }
                    }}
                />
            </React.StrictMode>
        );
        expect(emitEvent).toHaveBeenCalledTimes(2);

        socket.id = 'socket-2';
        rerender(
            <React.StrictMode>
                <GameTableView {...props} currentTableState={{ ...state, serverTime: Date.now() }} />
            </React.StrictMode>
        );
        expect(emitEvent).toHaveBeenCalledTimes(3);
        expect(emitEvent).toHaveBeenLastCalledWith('ackRoundPresentation', { presentationReadyAt });
    });

    test('waits for server quorum, then uses its server-time force deadline as an anti-stall fallback', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-11T07:00:00Z'));
        const serverTime = 50_000;
        renderGame(makeState({
            serverTime,
            presentationReadyAt: serverTime - 1,
            presentationForceReadyAt: serverTime + 1000,
            allConnectedHumansPresented: false
        }));

        expect(screen.getByTestId('round-presentation-complete')).toHaveTextContent('false');
        act(() => vi.advanceTimersByTime(1025));
        expect(screen.getByTestId('round-presentation-complete')).toHaveTextContent('true');
    });

    test('keeps legacy states without quorum fields playable after the base clock', () => {
        const state = makeState({ presentationReadyAt: Date.now() - 1 });
        delete state.roundSummary.allConnectedHumansPresented;
        delete state.roundSummary.presentationForceReadyAt;

        renderGame(state);
        expect(screen.getByTestId('round-presentation-complete')).toHaveTextContent('true');
    });

    test('restores an already-presented terminal game directly to its persistent podium', async () => {
        renderGame(makeState({
            state: 'Game Over',
            isGameOver: true,
            presentationReadyAt: Date.now() - 1
        }));

        expect(screen.getByTestId('alice-table-score')).toHaveTextContent('132');
        expect(screen.queryByRole('button', { name: 'Collect Points' })).not.toBeInTheDocument();
        expect(await screen.findByRole('dialog', { name: 'Winner podium' })).toBeInTheDocument();
    });

    test('opens a forfeit recap promptly instead of waiting for a nonexistent final-trick finale', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-11T07:00:00Z'));
        motionPreference.reduced = false;
        renderGame(makeState({
            state: 'Game Over',
            isGameOver: true,
            forfeit: { forfeitingPlayerName: 'Bob', reason: 'voluntary forfeit' },
            presentationReadyAt: Date.now() + 1000
        }));

        act(() => vi.advanceTimersByTime(0));
        expect(screen.getByRole('button', { name: 'View Final Standings' })).toBeInTheDocument();
    });

    test('never offers the table-mutating Rematch action to a spectator', async () => {
        const emitEvent = vi.fn();
        const state = makeState({
            state: 'Game Over',
            isGameOver: true,
            presentationReadyAt: Date.now() - 1
        });
        state.players[1].isSpectator = true;
        renderGame(state, { emitEvent });

        expect(await screen.findByRole('button', { name: 'Rematch' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Lobby' })).toBeEnabled();
        expect(emitEvent).not.toHaveBeenCalledWith('ackRoundPresentation', expect.anything());
    });

    test('keeps Rematch disabled until server quorum is ready while leaving Lobby available', async () => {
        const state = makeState({
            state: 'Game Over',
            isGameOver: true,
            presentationReadyAt: Date.now() - 1,
            presentationForceReadyAt: Date.now() + 30_000,
            allConnectedHumansPresented: false
        });
        const { rerender, props } = renderGame(state);

        expect(await screen.findByRole('button', { name: 'Rematch' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Lobby' })).toBeEnabled();

        rerender(
            <React.StrictMode>
                <GameTableView
                    {...props}
                    currentTableState={{
                        ...state,
                        roundSummary: {
                            ...state.roundSummary,
                            allConnectedHumansPresented: true
                        }
                    }}
                />
            </React.StrictMode>
        );
        expect(screen.getByRole('button', { name: 'Rematch' })).toBeEnabled();
    });

    test('holds pre-round totals through recap and ceremony, then reveals final totals and dealer control', () => {
        vi.useFakeTimers();
        renderGame(makeState());

        expect(screen.getByTestId('alice-table-score')).toHaveTextContent('120');
        expect(screen.queryByRole('button', { name: 'Chat' })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Collect Points' }));

        expect(screen.getByTestId('alice-table-score')).toHaveTextContent('120');
        expect(screen.getByTestId('round-presentation-complete')).toHaveTextContent('false');
        fireEvent.click(screen.getByRole('button', { name: 'Finish Score Ceremony' }));

        expect(screen.getByTestId('alice-table-score')).toHaveTextContent('132');
        expect(screen.getByText('Score Totals Complete')).toBeInTheDocument();
        expect(screen.getByTestId('round-presentation-complete')).toHaveTextContent('false');
        act(() => vi.advanceTimersByTime(SETTLED_RECAP_HOLD_MS - 1));
        expect(screen.getByText('Score Totals Complete')).toBeInTheDocument();
        expect(screen.getByTestId('round-presentation-complete')).toHaveTextContent('false');
        act(() => vi.advanceTimersByTime(1));
        expect(screen.getByTestId('round-presentation-complete')).toHaveTextContent('true');
        expect(screen.getByRole('button', { name: 'Chat' })).toBeEnabled();
    });

    test('holds final totals for five seconds before opening the persistent podium', () => {
        vi.useFakeTimers();
        const emitEvent = vi.fn();
        const handleLeaveTable = vi.fn();
        const state = makeState({ state: 'Game Over', isGameOver: true });
        state.roundSummary.tokenSettlement = {
            buyInCents: 100,
            potCents: 300,
            entries: [
                { playerName: 'Alice', funded: true, grossReturnCents: 200, netChangeCents: 100 },
                { playerName: 'Bob', funded: true, grossReturnCents: 100, netChangeCents: 0 },
                { playerName: 'Cara', funded: true, grossReturnCents: 0, netChangeCents: -100 }
            ]
        };
        renderGame(state, { emitEvent, handleLeaveTable });

        fireEvent.click(screen.getByRole('button', { name: 'Collect Points' }));
        fireEvent.click(screen.getByRole('button', { name: 'Finish Score Ceremony' }));

        expect(screen.getByText('Score Totals Complete')).toBeInTheDocument();
        expect(screen.queryByRole('dialog', { name: 'Winner podium' })).not.toBeInTheDocument();
        act(() => vi.advanceTimersByTime(SETTLED_RECAP_HOLD_MS - 1));
        expect(screen.getByText('Score Totals Complete')).toBeInTheDocument();
        expect(screen.queryByRole('dialog', { name: 'Winner podium' })).not.toBeInTheDocument();
        act(() => vi.advanceTimersByTime(1));
        expect(screen.getByRole('dialog', { name: 'Winner podium' })).toBeInTheDocument();
        expect(screen.getByTestId('podium-token-settlement')).toHaveTextContent('"playerName":"Alice"');
        fireEvent.click(screen.getByRole('button', { name: 'Rematch' }));
        fireEvent.click(screen.getByRole('button', { name: 'Lobby' }));
        expect(emitEvent).toHaveBeenCalledWith('resetGame');
        expect(handleLeaveTable).toHaveBeenCalledTimes(1);
    });

    test('skips a meaningless zero-change ceremony for a forfeit and opens final standings', async () => {
        const user = userEvent.setup();
        renderGame(makeState({
            state: 'Game Over',
            isGameOver: true,
            forfeit: { forfeitingPlayerName: 'Bob', reason: 'voluntary forfeit' }
        }));

        await user.click(await screen.findByRole('button', { name: 'View Final Standings' }));
        expect(screen.queryByRole('button', { name: 'Finish Score Ceremony' })).not.toBeInTheDocument();
        expect(screen.getByRole('dialog', { name: 'Winner podium' })).toBeInTheDocument();
    });
});
