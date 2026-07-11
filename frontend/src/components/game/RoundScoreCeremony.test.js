import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import RoundScoreCeremony, {
    ROUND_SCORE_CEREMONY_SOUNDS,
    ROUND_SCORE_CEREMONY_TIMING,
    buildRoundScoreRows,
    createRoundScoreCeremonyPlan
} from './RoundScoreCeremony';

const scores = {
    finalScores: { Alice: 132, Bob: 96, Cara: 120 },
    pointChanges: { Alice: 12, Bob: -24, Cara: 0 },
    playerOrder: ['Bob', 'Alice', 'Cara']
};

describe('RoundScoreCeremony score model', () => {
    test('preserves table order, includes omitted score names, and derives previous totals', () => {
        expect(buildRoundScoreRows({
            finalScores: { Alice: 132, Bob: 96, Drew: 111, ScoreAbsorber: 130 },
            pointChanges: { Alice: 12, Bob: -24, Drew: 0, ScoreAbsorber: 3 },
            playerOrder: [{ playerName: 'Bob' }, { name: 'Alice' }, { playerName: 'Bob' }]
        })).toEqual([
            { name: 'Bob', finalScore: 96, pointChange: -24, previousScore: 120 },
            { name: 'Alice', finalScore: 132, pointChange: 12, previousScore: 120 },
            { name: 'Drew', finalScore: 111, pointChange: 0, previousScore: 111 }
        ]);
    });

    test('keeps every ceremony plan under the fixed total-duration ceiling', () => {
        [1, 3, 4, 25, 1000].forEach(count => {
            const plan = createRoundScoreCeremonyPlan(count);
            expect(plan.completionMs).toBeLessThanOrEqual(ROUND_SCORE_CEREMONY_TIMING.MAX_TOTAL_MS);
        });
    });
});

describe('RoundScoreCeremony presentation and lifecycle', () => {
    beforeEach(() => vi.useFakeTimers());

    afterEach(() => {
        cleanup();
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    test('reveals signed deltas sequentially and settles on authoritative final totals', () => {
        const playSound = vi.fn();
        const onComplete = vi.fn();
        render(
            <RoundScoreCeremony
                {...scores}
                playSound={playSound}
                onComplete={onComplete}
                prefersReducedMotion={false}
            />
        );

        expect(screen.getByLabelText('Bob score')).toHaveTextContent('120');
        expect(screen.getByLabelText('Alice score')).toHaveTextContent('120');
        expect(screen.getByText('-24')).toHaveAttribute('aria-hidden', 'true');
        expect(screen.getByRole('status')).toHaveTextContent('Preparing score updates');
        expect(screen.getByRole('button', { name: 'Skip animation' })).toHaveFocus();

        act(() => vi.advanceTimersByTime(ROUND_SCORE_CEREMONY_TIMING.INTRO_MS));
        expect(screen.getByText('-24')).toHaveAttribute('aria-hidden', 'false');
        expect(screen.getByRole('status')).toHaveTextContent('Bob -24 points');

        act(() => vi.advanceTimersByTime(ROUND_SCORE_CEREMONY_TIMING.MAX_TOTAL_MS));
        expect(screen.getByLabelText('Bob score')).toHaveTextContent('96');
        expect(screen.getByLabelText('Alice score')).toHaveTextContent('132');
        expect(screen.getByLabelText('Cara score')).toHaveTextContent('120');
        expect(screen.getByText('+12')).toHaveAttribute('aria-hidden', 'false');
        expect(screen.getByRole('status')).toHaveTextContent('Round scores updated');
        expect(onComplete).toHaveBeenCalledTimes(1);
        expect(onComplete.mock.calls[0][0]).toMatchObject({ skipped: false });
        expect(screen.queryByRole('button', { name: 'Skip animation' })).not.toBeInTheDocument();
    });

    test('caps sound calls for very large changes instead of stretching the duration', () => {
        const playSound = vi.fn();
        const onComplete = vi.fn();
        render(
            <RoundScoreCeremony
                finalScores={{ Alice: 10120 }}
                pointChanges={{ Alice: 10000 }}
                playerOrder={['Alice']}
                playSound={playSound}
                onComplete={onComplete}
                prefersReducedMotion={false}
            />
        );

        act(() => vi.advanceTimersByTime(ROUND_SCORE_CEREMONY_TIMING.MAX_TOTAL_MS));
        expect(screen.getByLabelText('Alice score')).toHaveTextContent('10120');
        expect(playSound).toHaveBeenCalledTimes(ROUND_SCORE_CEREMONY_TIMING.MAX_TICKS_PER_PLAYER);
        expect(playSound).toHaveBeenLastCalledWith(ROUND_SCORE_CEREMONY_SOUNDS.ding);
        expect(playSound.mock.calls.slice(0, -1).every(([name]) => name === ROUND_SCORE_CEREMONY_SOUNDS.tick)).toBe(true);
        expect(onComplete).toHaveBeenCalledTimes(1);
    });

    test('skip immediately reveals every final score and cannot complete twice', () => {
        const playSound = vi.fn();
        const onSkip = vi.fn();
        const onComplete = vi.fn();
        render(
            <RoundScoreCeremony
                {...scores}
                playSound={playSound}
                onSkip={onSkip}
                onComplete={onComplete}
                prefersReducedMotion={false}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: 'Skip animation' }));
        expect(screen.getByLabelText('Bob score')).toHaveTextContent('96');
        expect(screen.getByLabelText('Alice score')).toHaveTextContent('132');
        expect(onSkip).toHaveBeenCalledTimes(1);
        expect(onComplete).toHaveBeenCalledTimes(1);
        expect(onComplete.mock.calls[0][0]).toMatchObject({ skipped: true });

        act(() => vi.runAllTimers());
        expect(onComplete).toHaveBeenCalledTimes(1);
        expect(playSound).not.toHaveBeenCalled();
    });

    test('reduced motion renders final totals immediately without decorative audio', () => {
        const playSound = vi.fn();
        const onComplete = vi.fn();
        render(
            <RoundScoreCeremony
                {...scores}
                playSound={playSound}
                onComplete={onComplete}
                prefersReducedMotion
            />
        );

        act(() => vi.runOnlyPendingTimers());
        expect(screen.getByLabelText('Bob score')).toHaveTextContent('96');
        expect(screen.getByLabelText('Alice score')).toHaveTextContent('132');
        expect(screen.getByText('-24')).toHaveAttribute('aria-hidden', 'false');
        expect(screen.queryByRole('button', { name: 'Skip animation' })).not.toBeInTheDocument();
        expect(playSound).not.toHaveBeenCalled();
        expect(onComplete).toHaveBeenCalledTimes(1);
    });

    test('reduced-motion completion remains single-fire under React StrictMode', () => {
        const onComplete = vi.fn();
        render(
            <React.StrictMode>
                <RoundScoreCeremony
                    {...scores}
                    onComplete={onComplete}
                    prefersReducedMotion
                />
            </React.StrictMode>
        );

        act(() => vi.runAllTimers());
        expect(onComplete).toHaveBeenCalledTimes(1);
    });

    test('clears every pending tick, sound, and completion callback on unmount', () => {
        const playSound = vi.fn();
        const onComplete = vi.fn();
        const { unmount } = render(
            <RoundScoreCeremony
                {...scores}
                playSound={playSound}
                onComplete={onComplete}
                prefersReducedMotion={false}
            />
        );

        unmount();
        act(() => vi.runAllTimers());
        expect(playSound).not.toHaveBeenCalled();
        expect(onComplete).not.toHaveBeenCalled();
    });

    test('does not restart when an equivalent terminal socket broadcast supplies fresh objects', () => {
        const onComplete = vi.fn();
        const { rerender } = render(
            <RoundScoreCeremony
                {...scores}
                onComplete={onComplete}
                prefersReducedMotion={false}
            />
        );

        act(() => vi.advanceTimersByTime(ROUND_SCORE_CEREMONY_TIMING.INTRO_MS + 200));
        expect(screen.getByRole('status')).toHaveTextContent('Bob -24 points');
        const bobBeforeBroadcast = screen.getByLabelText('Bob score').textContent;

        rerender(
            <RoundScoreCeremony
                finalScores={{ ...scores.finalScores }}
                pointChanges={{ ...scores.pointChanges }}
                playerOrder={[...scores.playerOrder]}
                onComplete={onComplete}
                prefersReducedMotion={false}
            />
        );

        expect(screen.getByRole('status')).toHaveTextContent('Bob -24 points');
        expect(screen.getByLabelText('Bob score')).toHaveTextContent(bobBeforeBroadcast);
        act(() => vi.advanceTimersByTime(ROUND_SCORE_CEREMONY_TIMING.MAX_TOTAL_MS));
        expect(onComplete).toHaveBeenCalledTimes(1);
    });

    test('empty data completes safely and reports an accessible empty state', () => {
        const onComplete = vi.fn();
        render(<RoundScoreCeremony onComplete={onComplete} prefersReducedMotion={false} />);
        expect(screen.getByText('No score changes to show.')).toBeInTheDocument();
        act(() => vi.runOnlyPendingTimers());
        expect(screen.getByRole('status')).toHaveTextContent('No round score changes to show');
        expect(onComplete).toHaveBeenCalledWith({ skipped: false, rows: [] });
    });
});
