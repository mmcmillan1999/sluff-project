import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import TutorialCoach, { FIRST_GAME_TUTORIAL_VERSION } from './TutorialCoach';

const makeState = (overrides = {}) => ({
    tableId: 'qp-miss-pauls-academy-1',
    tableType: 'quickplay',
    theme: 'miss-pauls-academy',
    state: 'Waiting for Players',
    qpPhase: 'filling',
    players: {
        1: { userId: 1, playerName: 'Alice' },
        2: { userId: 2, playerName: 'Bob' },
        3: { userId: 3, playerName: 'Cara' }
    },
    hands: { Alice: [] },
    insurance: { isActive: false, dealExecuted: false },
    ...overrides
});

const renderCoach = (currentTableState, overrides = {}) => {
    const props = {
        active: true,
        currentTableState,
        playerId: 1,
        selfPlayerName: 'Alice',
        roundPresentationPhase: 'idle',
        onAction: vi.fn(),
        tutorialVersion: FIRST_GAME_TUTORIAL_VERSION,
        ...overrides
    };
    return { ...render(<TutorialCoach {...props} />), props };
};

describe('TutorialCoach', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    afterEach(() => {
        cleanup();
    });

    test('recommends the fullest three-player guide without taking the choice away', async () => {
        renderCoach(makeState({ qpPhase: 'decision_pending' }));

        expect(await screen.findByText('Choose your table size')).toBeInTheDocument();
        expect(screen.getByText(/Start 3-Player gives the fullest first-game guide/i)).toBeInTheDocument();
        expect(screen.getByText(/Four-player is still your choice/i)).toBeInTheDocument();
    });

    test('moves non-recap guidance below the across-player name on four-player tables', async () => {
        renderCoach(makeState({
            state: 'Bidding Phase',
            biddingTurnPlayerName: 'Alice',
            playerMode: 4,
            seatingOrder: ['Alice', 'Bob', 'Cara', 'Drew']
        }));

        await screen.findByText('Choose the risk you want');
        expect(screen.getByLabelText('Guided game tip')).toHaveClass('tutorial-coach--four-player');
    });

    test.each([
        {
            name: 'bidding',
            state: makeState({ state: 'Bidding Phase', biddingTurnPlayerName: 'Alice' }),
            expected: 'Choose the risk you want'
        },
        {
            name: 'bidder role',
            state: makeState({
                state: 'Bid Announcement',
                bidWinnerInfo: { userId: 1, playerName: 'Alice', bid: 'Solo' }
            }),
            expected: 'Get above 60'
        },
        {
            name: 'first flick',
            state: makeState({
                state: 'Playing Phase',
                trickTurnPlayerName: 'Alice',
                hands: { Alice: Array.from({ length: 11 }, (_, index) => `card-${index}`) }
            }),
            expected: 'Flick a legal card to the table'
        },
        {
            name: 'follow-suit rule',
            state: makeState({
                state: 'Playing Phase',
                trickTurnPlayerName: 'Alice',
                leadSuitCurrentTrick: 'H',
                hands: { Alice: Array.from({ length: 10 }, (_, index) => `card-${index}`) }
            }),
            expected: 'Follow the led suit when you can'
        },
        {
            name: 'insurance',
            state: makeState({
                state: 'Playing Phase',
                trickTurnPlayerName: 'Bob',
                insurance: { isActive: true, dealExecuted: false }
            }),
            expected: 'A deal is optional'
        }
    ])('surfaces the $name lesson directly from authoritative state', async ({ state, expected }) => {
        renderCoach(state);
        expect(await screen.findByText(expected)).toBeInTheDocument();
    });

    test('records presentation immediately so reconnecting does not replay a seen lesson', async () => {
        const state = makeState({ state: 'Bidding Phase', biddingTurnPlayerName: 'Alice' });
        const first = renderCoach(state, { playerId: 77 });

        expect(await screen.findByText('Choose the risk you want')).toBeInTheDocument();
        await waitFor(() => expect(
            JSON.parse(window.localStorage.getItem(`sluff:tutorial:${FIRST_GAME_TUTORIAL_VERSION}:lessons:77`))
        ).toContain('bidding'));

        first.unmount();
        renderCoach(state, { playerId: 77 });
        expect(screen.queryByText('Choose the risk you want')).not.toBeInTheDocument();
    });

    test('leaves recap teaching to the modal and completes only after continue advances presentation', async () => {
        const onAction = vi.fn();
        const state = makeState({
            state: 'Awaiting Next Round Trigger',
            roundSummary: {
                presentationReadyAt: Date.now() + 10_000,
                pointChanges: { Alice: 12, Bob: -6, Cara: -6 }
            }
        });
        const { rerender, props } = renderCoach(state, {
            roundPresentationPhase: 'recap',
            onAction
        });

        expect(screen.queryByLabelText('Guided game tip')).not.toBeInTheDocument();
        expect(onAction).not.toHaveBeenCalled();

        rerender(<TutorialCoach {...props} roundPresentationPhase="scoring" />);
        await waitFor(() => expect(onAction).toHaveBeenCalledWith('complete'));
        expect(onAction).toHaveBeenCalledTimes(1);
    });

    test('dismisses one card without ending the guide, while End tips explicitly skips it', async () => {
        const onAction = vi.fn();
        renderCoach(makeState({ state: 'Bidding Phase', biddingTurnPlayerName: 'Alice' }), { onAction });

        await screen.findByText('Choose the risk you want');
        fireEvent.click(screen.getByRole('button', { name: 'Dismiss tutorial tip' }));
        expect(onAction).not.toHaveBeenCalled();

        cleanup();
        window.localStorage.clear();
        renderCoach(makeState({ state: 'Bidding Phase', biddingTurnPlayerName: 'Alice' }), { onAction });
        await screen.findByText('Choose the risk you want');
        fireEvent.click(screen.getByRole('button', { name: 'End tips' }));

        expect(onAction).toHaveBeenCalledWith('skip');
        await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    });

    test('keeps tips visible and offers retry when ending tips cannot be persisted', async () => {
        const onAction = vi.fn()
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValueOnce({ tutorial_version: 1 });
        renderCoach(makeState({ state: 'Bidding Phase', biddingTurnPlayerName: 'Alice' }), { onAction });

        await screen.findByText('Choose the risk you want');
        fireEvent.click(screen.getByRole('button', { name: 'End tips' }));

        expect(await screen.findByText('Tips are still on')).toBeInTheDocument();
        expect(screen.getByText(/could not save that choice/i)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

        await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
        expect(onAction).toHaveBeenCalledTimes(2);
    });

    test('surfaces a recoverable completion error without an unhandled rejection', async () => {
        const onAction = vi.fn()
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValueOnce({ tutorial_version: 1 });
        const state = makeState({
            state: 'Awaiting Next Round Trigger',
            roundSummary: { presentationReadyAt: Date.now() + 10_000 }
        });
        renderCoach(state, { roundPresentationPhase: 'scoring', onAction });

        expect(await screen.findByText('Progress not saved yet')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        await waitFor(() => expect(onAction).toHaveBeenCalledTimes(2));
    });
});
