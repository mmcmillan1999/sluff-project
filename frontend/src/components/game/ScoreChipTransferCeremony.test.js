import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import ScoreChipTransferCeremony, {
    SCORE_CHIP_TRANSFER_SOUNDS,
    SCORE_CHIP_TRANSFER_TIMING,
    buildScoreTransferCeremonyModel,
    measureScoreTransferEndpoints,
} from './ScoreChipTransferCeremony';

const round = {
    finalScores: { Alice: 132, Bob: 114, Cara: 114 },
    pointChanges: { Alice: 12, Bob: -6, Cara: -6 },
    playerOrder: ['Alice', 'Bob', 'Cara'],
    tableId: 'academy-7',
};

const mountedTables = [];

const rect = (left, top, width = 40, height = 24) => ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
});

const mountTableAnchors = ({
    tableId = round.tableId,
    names = ['Alice', 'Bob', 'Cara'],
    includeWidow = false,
    omit = null,
    onMeasure,
} = {}) => {
    const gameView = document.createElement('div');
    gameView.className = 'game-view';
    const table = document.createElement('div');
    table.dataset.scoreTransferTable = tableId;
    const anchors = {};

    names.forEach((name, index) => {
        if (name === omit) return;
        const bank = document.createElement('div');
        bank.dataset.scoreChipPlayer = name;
        const anchor = document.createElement('span');
        anchor.dataset.scoreChipAnchor = '';
        anchor.getBoundingClientRect = vi.fn(() => {
            onMeasure?.(name);
            return rect(50 + (index * 110), 90 + (index * 45));
        });
        bank.append(anchor);
        table.append(bank);
        anchors[name] = anchor;
    });

    if (includeWidow) {
        const widow = document.createElement('span');
        widow.dataset.scoreTransferAnchor = 'widow';
        widow.getBoundingClientRect = vi.fn(() => {
            onMeasure?.('ScoreAbsorber');
            return rect(280, 40);
        });
        table.append(widow);
        anchors.ScoreAbsorber = widow;
    }

    gameView.append(table);
    document.body.append(gameView);
    mountedTables.push(gameView);
    return { table, anchors, gameView };
};

describe('ScoreChipTransferCeremony model and endpoint capture', () => {
    test('derives previous scores and a deterministic transfer plan', () => {
        const model = buildScoreTransferCeremonyModel(round);

        expect(model.previousScores).toEqual({ Alice: 120, Bob: 120, Cara: 120 });
        expect(model.transfers).toEqual([
            { id: 'score-transfer-1', from: 'Bob', to: 'Alice', amount: 6 },
            { id: 'score-transfer-2', from: 'Cara', to: 'Alice', amount: 6 },
        ]);
        expect(model).toMatchObject({ balanced: true, scoresComplete: true });
    });

    test('matches dataset values without selector interpolation and maps ScoreAbsorber to the widow', () => {
        const oddName = `O'Brien \"Ace\"`;
        const { anchors } = mountTableAnchors({
            tableId: 'table [one]',
            names: [oddName],
            includeWidow: true,
        });

        const endpoints = measureScoreTransferEndpoints({
            tableId: 'table [one]',
            transfers: [{ from: oddName, to: 'ScoreAbsorber', amount: 4 }],
        });

        expect(endpoints).toEqual({
            [oddName]: { x: 70, y: 102 },
            ScoreAbsorber: { x: 300, y: 52 },
        });
        expect(anchors[oddName].getBoundingClientRect).toHaveBeenCalledTimes(1);
        expect(anchors.ScoreAbsorber.getBoundingClientRect).toHaveBeenCalledTimes(1);
    });
});

describe('ScoreChipTransferCeremony lifecycle', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        cleanup();
        mountedTables.splice(0).forEach(table => table.remove());
        document.querySelectorAll('.score-chip-flight').forEach(node => node.remove());
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    test('measures every endpoint first, then shrinks and grows banks one payment at a time', () => {
        const eventOrder = [];
        mountTableAnchors({ onMeasure: name => eventOrder.push(`measure:${name}`) });
        const onScoreFrame = vi.fn((_, meta) => eventOrder.push(`frame:${meta.phase}`));
        const onComplete = vi.fn();
        const playSound = vi.fn();

        render(
            <ScoreChipTransferCeremony
                {...round}
                onScoreFrame={onScoreFrame}
                onComplete={onComplete}
                playSound={playSound}
                prefersReducedMotion={false}
            />,
        );

        expect(screen.getByLabelText('Settling round points')).toHaveAttribute('data-table-id', round.tableId);
        expect(screen.getByRole('button', { name: 'Skip transfers' })).toBeInTheDocument();

        act(() => vi.advanceTimersByTime(0));
        expect(onScoreFrame).toHaveBeenLastCalledWith(
            { Alice: 120, Bob: 120, Cara: 120 },
            { phase: 'initial', transfer: null },
        );
        expect(eventOrder.slice(0, 3)).toEqual(['measure:Bob', 'measure:Alice', 'measure:Cara']);
        expect(eventOrder[3]).toBe('frame:initial');

        act(() => vi.advanceTimersByTime(SCORE_CHIP_TRANSFER_TIMING.INTRO_MS));
        expect(onScoreFrame).toHaveBeenLastCalledWith(
            { Alice: 120, Bob: 114, Cara: 120 },
            expect.objectContaining({ phase: 'launch' }),
        );
        expect(screen.getByText('Bob')).toBeInTheDocument();
        expect(screen.getByText('Alice')).toBeInTheDocument();
        expect(screen.getByText('6 points')).toBeInTheDocument();
        expect(screen.getByText('Payment 1 of 2')).toBeInTheDocument();
        expect(document.querySelectorAll('.score-chip-flight')).toHaveLength(1);
        expect(document.querySelector('.game-view > .score-chip-flight')).toBeInTheDocument();
        expect(document.querySelectorAll('.score-chip-flight__chip').length).toBeGreaterThanOrEqual(3);
        expect(document.querySelectorAll('.score-chip-flight__chip').length).toBeLessThanOrEqual(5);
        expect(playSound).toHaveBeenLastCalledWith(SCORE_CHIP_TRANSFER_SOUNDS.launch);

        act(() => vi.advanceTimersByTime(SCORE_CHIP_TRANSFER_TIMING.FLIGHT_MS));
        expect(onScoreFrame).toHaveBeenLastCalledWith(
            { Alice: 126, Bob: 114, Cara: 120 },
            expect.objectContaining({ phase: 'arrival' }),
        );
        expect(document.querySelectorAll('.score-chip-flight')).toHaveLength(0);
        expect(playSound).toHaveBeenLastCalledWith(SCORE_CHIP_TRANSFER_SOUNDS.land);

        act(() => vi.advanceTimersByTime(SCORE_CHIP_TRANSFER_TIMING.PAUSE_MS));
        expect(onScoreFrame).toHaveBeenLastCalledWith(
            { Alice: 126, Bob: 114, Cara: 114 },
            expect.objectContaining({ phase: 'launch' }),
        );
        expect(screen.getByText('Payment 2 of 2')).toBeInTheDocument();
        expect(document.querySelectorAll('.score-chip-flight')).toHaveLength(1);

        act(() => vi.advanceTimersByTime(
            SCORE_CHIP_TRANSFER_TIMING.FLIGHT_MS + SCORE_CHIP_TRANSFER_TIMING.FINAL_SETTLE_MS,
        ));
        expect(onScoreFrame).toHaveBeenLastCalledWith(
            round.finalScores,
            { phase: 'complete', transfer: null },
        );
        expect(onComplete).toHaveBeenCalledTimes(1);
        expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({
            skipped: false,
            reason: 'complete',
            balanced: true,
        }));
        expect(screen.getByRole('status')).toHaveTextContent('Round points settled');
        expect(screen.queryByRole('button', { name: 'Skip transfers' })).not.toBeInTheDocument();
    });

    test('skip fast-forwards to the authoritative final snapshot exactly once', () => {
        mountTableAnchors();
        const onScoreFrame = vi.fn();
        const onComplete = vi.fn();
        render(
            <ScoreChipTransferCeremony
                {...round}
                onScoreFrame={onScoreFrame}
                onComplete={onComplete}
                prefersReducedMotion={false}
            />,
        );
        act(() => vi.advanceTimersByTime(0));
        act(() => vi.advanceTimersByTime(SCORE_CHIP_TRANSFER_TIMING.INTRO_MS));

        fireEvent.click(screen.getByRole('button', { name: 'Skip transfers' }));
        expect(onScoreFrame).toHaveBeenLastCalledWith(
            round.finalScores,
            { phase: 'complete', transfer: null },
        );
        expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ skipped: true, reason: 'skip' }));
        expect(document.querySelector('.score-chip-flight')).not.toBeInTheDocument();

        act(() => vi.runAllTimers());
        expect(onComplete).toHaveBeenCalledTimes(1);
    });

    test('reduced motion emits only the final frame and completes once in StrictMode', () => {
        const onScoreFrame = vi.fn();
        const onComplete = vi.fn();
        render(
            <React.StrictMode>
                <ScoreChipTransferCeremony
                    {...round}
                    onScoreFrame={onScoreFrame}
                    onComplete={onComplete}
                    prefersReducedMotion
                />
            </React.StrictMode>,
        );

        expect(onComplete).not.toHaveBeenCalled();
        act(() => vi.runAllTimers());
        expect(onScoreFrame).toHaveBeenCalledTimes(1);
        expect(onScoreFrame).toHaveBeenCalledWith(
            round.finalScores,
            { phase: 'complete', transfer: null },
        );
        expect(onComplete).toHaveBeenCalledTimes(1);
        expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ reason: 'reduced-motion' }));
        expect(document.querySelector('.score-chip-flight')).not.toBeInTheDocument();
    });

    test('does not restart for an equivalent terminal socket broadcast', () => {
        mountTableAnchors();
        const onScoreFrame = vi.fn();
        const onComplete = vi.fn();
        const { rerender } = render(
            <ScoreChipTransferCeremony
                {...round}
                onScoreFrame={onScoreFrame}
                onComplete={onComplete}
                prefersReducedMotion={false}
            />,
        );
        act(() => vi.advanceTimersByTime(SCORE_CHIP_TRANSFER_TIMING.INTRO_MS));
        expect(screen.getByText('Payment 1 of 2')).toBeInTheDocument();
        const frameCount = onScoreFrame.mock.calls.length;

        rerender(
            <ScoreChipTransferCeremony
                finalScores={{ ...round.finalScores }}
                pointChanges={{ ...round.pointChanges }}
                playerOrder={[...round.playerOrder]}
                tableId={round.tableId}
                onScoreFrame={onScoreFrame}
                onComplete={onComplete}
                prefersReducedMotion={false}
            />,
        );
        expect(onScoreFrame).toHaveBeenCalledTimes(frameCount);
        expect(screen.getByText('Payment 1 of 2')).toBeInTheDocument();

        act(() => vi.advanceTimersByTime(
            (SCORE_CHIP_TRANSFER_TIMING.FLIGHT_MS * 2)
            + SCORE_CHIP_TRANSFER_TIMING.PAUSE_MS
            + SCORE_CHIP_TRANSFER_TIMING.FINAL_SETTLE_MS,
        ));
        expect(onComplete).toHaveBeenCalledTimes(1);
    });

    test.each(['resize', 'orientationchange'])('%s safely settles an active flight', eventName => {
        mountTableAnchors();
        const onScoreFrame = vi.fn();
        const onComplete = vi.fn();
        render(
            <ScoreChipTransferCeremony
                {...round}
                onScoreFrame={onScoreFrame}
                onComplete={onComplete}
                prefersReducedMotion={false}
            />,
        );
        act(() => vi.advanceTimersByTime(SCORE_CHIP_TRANSFER_TIMING.INTRO_MS));
        expect(document.querySelector('.score-chip-flight')).toBeInTheDocument();

        act(() => window.dispatchEvent(new Event(eventName)));
        expect(onScoreFrame).toHaveBeenLastCalledWith(
            round.finalScores,
            { phase: 'complete', transfer: null },
        );
        expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({
            skipped: true,
            reason: 'layout-change',
        }));
        expect(document.querySelector('.score-chip-flight')).not.toBeInTheDocument();
        act(() => vi.runAllTimers());
        expect(onComplete).toHaveBeenCalledTimes(1);
    });

    test('a real unmount clears the run without stale frames or completion callbacks', () => {
        mountTableAnchors();
        const onScoreFrame = vi.fn();
        const onComplete = vi.fn();
        const { unmount } = render(
            <React.StrictMode>
                <ScoreChipTransferCeremony
                    {...round}
                    onScoreFrame={onScoreFrame}
                    onComplete={onComplete}
                    prefersReducedMotion={false}
                />
            </React.StrictMode>,
        );
        act(() => vi.advanceTimersByTime(SCORE_CHIP_TRANSFER_TIMING.INTRO_MS));
        expect(onComplete).not.toHaveBeenCalled();

        unmount();
        expect(onComplete).not.toHaveBeenCalled();
        act(() => vi.runAllTimers());
        expect(onScoreFrame.mock.calls.at(-1)[1]).toEqual(expect.objectContaining({ phase: 'launch' }));
        expect(onComplete).not.toHaveBeenCalled();
    });

    test('missing anchors, unbalanced data, and an empty plan all complete safely', () => {
        mountTableAnchors({ omit: 'Cara' });
        const missingComplete = vi.fn();
        const missingFrame = vi.fn();
        const first = render(
            <ScoreChipTransferCeremony
                {...round}
                onScoreFrame={missingFrame}
                onComplete={missingComplete}
                prefersReducedMotion={false}
            />,
        );
        act(() => vi.runAllTimers());
        expect(missingComplete).toHaveBeenCalledWith(expect.objectContaining({ reason: 'missing-anchor' }));
        expect(missingFrame).toHaveBeenLastCalledWith(round.finalScores, expect.any(Object));
        first.unmount();

        const unbalancedComplete = vi.fn();
        const second = render(
            <ScoreChipTransferCeremony
                finalScores={{ Alice: 132, Bob: 114, Cara: 115 }}
                pointChanges={{ Alice: 12, Bob: -6, Cara: -5 }}
                playerOrder={round.playerOrder}
                tableId={round.tableId}
                onComplete={unbalancedComplete}
                prefersReducedMotion={false}
            />,
        );
        act(() => vi.runAllTimers());
        expect(unbalancedComplete).toHaveBeenCalledWith(expect.objectContaining({ reason: 'unbalanced' }));
        second.unmount();

        const emptyComplete = vi.fn();
        render(
            <ScoreChipTransferCeremony
                finalScores={{ Alice: 120, Bob: 120 }}
                pointChanges={{ Alice: 0, Bob: 0 }}
                playerOrder={['Alice', 'Bob']}
                tableId={round.tableId}
                onComplete={emptyComplete}
                prefersReducedMotion={false}
            />,
        );
        act(() => vi.runAllTimers());
        expect(emptyComplete).toHaveBeenCalledWith(expect.objectContaining({ reason: 'empty' }));
    });
});
