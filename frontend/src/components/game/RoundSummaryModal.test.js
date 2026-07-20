import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RoundSummaryModal, { computeNoDealRecap } from './RoundSummaryModal';

const baseProps = {
    showModal: true,
    getPlayerNameByUserId: id => String(id),
    renderCard: vi.fn(),
    emitEvent: vi.fn(),
    handleLeaveTable: vi.fn(),
    handleLogout: vi.fn()
};

const makeTimedPreviewSummary = () => ({
    isGameOver: false,
    dealerOfRoundId: 1,
    finalScores: { Alice: 132, Bob: 114, Cara: 114 },
    pointChanges: { Alice: 12, Bob: -6, Cara: -6 },
    finalBidderPoints: 72,
    finalDefenderPoints: 48,
    bidType: 'Frog',
    insuranceDealWasMade: false,
    insuranceHindsight: {},
    widowForReveal: [],
    widowPointsValue: 0
});

const makeTimedPreviewProps = (onContinue, overrides = {}) => ({
    ...baseProps,
    playerId: 1,
    title: 'Round Recap',
    scoreActionLabel: 'Collect Points',
    onContinue,
    scoreStage: 'preview',
    scoreActionTimerMs: 10000,
    actionTimerKey: 'round-1',
    insurance: {},
    bidWinnerInfo: { playerName: 'Alice' },
    playerOrderActive: ['Alice', 'Bob', 'Cara'],
    summaryData: makeTimedPreviewSummary(),
    ...overrides
});

const cases = [
    {
        label: 'voluntary forfeit',
        playerId: 1,
        forfeit: { forfeitingPlayerName: 'Alice', reason: 'voluntary forfeit' },
        winner: 'Bob & Cara',
        payout: 'You forfeited and lost your buy-in.',
        expectedReason: 'Reason: Voluntary forfeit'
    },
    {
        label: 'disconnect timeout',
        playerId: 2,
        forfeit: { forfeitingPlayerName: 'Alice', reason: 'disconnect timeout' },
        winner: 'Bob',
        payout: 'You received 2.00 tokens after Alice forfeited.',
        expectedReason: 'Reason: Disconnect timer expired'
    }
];

describe.each(cases)('RoundSummaryModal $label summary', ({ playerId, forfeit, winner, payout, expectedReason }) => {
    test('renders minimal settlement data without trick recap or token-payout prose', () => {
        render(
            <RoundSummaryModal
                {...baseProps}
                playerId={playerId}
                summaryData={{
                    isGameOver: true,
                    forfeit,
                    gameWinner: winner,
                    finalScores: { Alice: 120, Bob: 105, Cara: 95 },
                    payoutDetails: { [playerId]: payout }
                }}
            />
        );

        expect(screen.getByRole('heading', { name: 'Game Ended by Forfeit' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: `${forfeit.forfeitingPlayerName} forfeited the game.` })).toBeInTheDocument();
        expect(screen.getByText(expectedReason)).toBeInTheDocument();
        expect(screen.getByLabelText(`Game winner: ${winner}`)).toBeInTheDocument();
        expect(screen.queryByText(payout)).not.toBeInTheDocument();

        const scoresPanel = screen.getByRole('heading', { name: 'Final Scores' }).closest('.forfeit-scores-panel');
        const scoreTable = within(scoresPanel).getByRole('table');
        expect(within(scoreTable).getByRole('cell', { name: 'Alice' })).toBeInTheDocument();
        expect(within(scoreTable).getByRole('cell', { name: '120' })).toBeInTheDocument();
        expect(within(scoreTable).getByRole('cell', { name: 'Bob' })).toBeInTheDocument();
        expect(within(scoreTable).getByRole('cell', { name: '105' })).toBeInTheDocument();
        expect(screen.queryByText('Trick Point Recap')).not.toBeInTheDocument();
        expect(screen.queryByText(/Insurance Recap/)).not.toBeInTheDocument();
    });
});

describe('computeNoDealRecap (spec scenarios)', () => {
    const recapOf = (ask, offers, changes) => computeNoDealRecap({
        bidderRequirement: ask,
        defenderOffers: offers,
        bidMultiplier: 2,
        pointChanges: changes,
        bidderName: 'Alice',
    });
    const row = (recap, name) => recap.rows.find(r => r.name === name);

    test('scenario 1: win in the gap — bidder saved vs offers, defenders vs their own price', () => {
        const recap = recapOf(74, { Bob: 10, Cara: 20 }, { Alice: 40, Bob: -20, Cara: -20 });
        expect(recap.zone).toBe('gap');
        expect(recap.gap).toBe(44);
        expect(row(recap, 'Alice')).toMatchObject({ posCls: 'verdict-warn', verdict: { text: 'saved 10' } });
        expect(row(recap, 'Bob')).toMatchObject({ posText: 'Offered 10', posCls: 'verdict-bad', verdict: { text: 'wasted 10' } });
        expect(row(recap, 'Cara')).toMatchObject({ posCls: 'verdict-good', verdict: { text: 'broke even' } });
    });

    test('scenario 2: rich offers — bidder overreached and wasted 15', () => {
        const recap = recapOf(74, { Bob: 25, Cara: 30 }, { Alice: 40, Bob: -20, Cara: -20 });
        expect(recap.zone).toBe('overreach');
        expect(recap.header).toMatch(/Bidder overreached/);
        expect(row(recap, 'Alice')).toMatchObject({ posCls: 'verdict-bad', verdict: { text: 'wasted 15' } });
        expect(row(recap, 'Bob').verdict.text).toBe('saved 5');
        expect(row(recap, 'Cara').verdict.text).toBe('saved 10');
    });

    test('scenario 3: bidder collapse — wasted vs the declined offers, ×3 ledger', () => {
        const recap = recapOf(40, { Bob: 10, Cara: 15 }, { Alice: -60, Bob: 20, Cara: 20, ScoreAbsorber: 20 });
        expect(recap.zone).toBe('overreach');
        expect(row(recap, 'Alice').verdict.text).toBe('wasted 85');
        expect(row(recap, 'Bob')).toMatchObject({ posCls: 'verdict-good', verdict: { text: 'saved 30' } });
    });

    test('scenario 5: cards covered the ask — defenders lowballed and wasted', () => {
        const recap = recapOf(30, { Bob: 10, Cara: 15 }, { Alice: 80, Bob: -40, Cara: -40 });
        expect(recap.zone).toBe('lowball');
        expect(recap.header).toMatch(/Defenders lowballed/);
        expect(row(recap, 'Alice')).toMatchObject({ posCls: 'verdict-good', verdict: { text: 'saved 55' } });
        expect(row(recap, 'Bob')).toMatchObject({ posCls: 'verdict-bad', verdict: { text: 'wasted 30' } });
    });

    test('scenario 6: negative ask — the conceding bidder shows green, demands show red', () => {
        const recap = recapOf(-20, { Bob: -25, Cara: -20 }, { Alice: -15, Bob: 5, Cara: 5, ScoreAbsorber: 5 });
        expect(recap.zone).toBe('lowball');
        expect(row(recap, 'Alice')).toMatchObject({ posText: "Req'd -20", posCls: 'verdict-good', verdict: { text: 'saved 30' } });
        expect(row(recap, 'Bob')).toMatchObject({ posText: 'Asked +25', posCls: 'verdict-bad', verdict: { text: 'wasted 20' } });
    });

    test('flags a round where everyone stayed on the defaults', () => {
        const recap = recapOf(240, { Bob: -120, Cara: -120 }, { Alice: 40, Bob: -20, Cara: -20 });
        expect(recap.neverNegotiated).toBe(true);
    });
});

describe('RoundSummaryModal no-deal verdict panel', () => {
    const noDealProps = (overrides = {}) => makeTimedPreviewProps(vi.fn(), {
        scoreStage: 'complete',
        insurance: { bidMultiplier: 2, bidderRequirement: 74, defenderOffers: { Bob: 10, Cara: 20 } },
        summaryData: {
            ...makeTimedPreviewSummary(),
            pointChanges: { Alice: 40, Bob: -20, Cara: -20 },
        },
        ...overrides
    });

    test('renders the header verdict, positions, and own-anchor outcomes', () => {
        render(<RoundSummaryModal {...noDealProps()} />);

        expect(screen.getByText('Insurance Recap (No Deal)')).toBeInTheDocument();
        expect(screen.getByText(/No one blinked/)).toBeInTheDocument();
        expect(screen.getByText(/ask 74 · offers 30 · gap 44/)).toBeInTheDocument();
        expect(screen.getByText("Req'd 74")).toHaveClass('verdict-warn');
        expect(screen.getByText('saved 10')).toHaveClass('verdict-good');
        expect(screen.getByText('Offered 10')).toHaveClass('verdict-bad');
        expect(screen.getByText('wasted 10')).toHaveClass('verdict-bad');
        expect(screen.getByText('broke even')).toHaveClass('verdict-muted');
    });

    test('suppresses verdicts when insurance was never negotiated', () => {
        render(<RoundSummaryModal {...noDealProps({
            insurance: { bidMultiplier: 2, bidderRequirement: 240, defenderOffers: { Bob: -120, Cara: -120 } },
        })} />);

        expect(screen.getByText('Insurance was never seriously negotiated this round.')).toBeInTheDocument();
        expect(screen.queryByText(/No one blinked|overreached|lowballed/)).not.toBeInTheDocument();
    });

    test('shows the widow share as a muted netting row in the totals', () => {
        render(<RoundSummaryModal {...noDealProps({
            insurance: { bidMultiplier: 2, bidderRequirement: 40, defenderOffers: { Bob: 10, Cara: 15 } },
            summaryData: {
                ...makeTimedPreviewSummary(),
                pointChanges: { Alice: -60, Bob: 20, Cara: 20, ScoreAbsorber: 20 },
            },
        })} />);

        const widowRow = screen.getByText('Widow').closest('tr');
        expect(widowRow).toHaveClass('widow-share-row');
        expect(widowRow).toHaveTextContent('+20');
        expect(widowRow).toHaveTextContent('—');
        // -60 + 20 + 20 + 20 nets to zero on screen
    });

    test('keeps the widow row hidden when the share is zero', () => {
        render(<RoundSummaryModal {...noDealProps({
            summaryData: {
                ...makeTimedPreviewSummary(),
                pointChanges: { Alice: 40, Bob: -20, Cara: -20, ScoreAbsorber: 0 },
            },
        })} />);

        expect(screen.queryByText('Widow')).not.toBeInTheDocument();
    });
});

describe('RoundSummaryModal staged presentation', () => {
    test('shows round changes, conceals new totals, and supports a personalized score action', async () => {
        const user = userEvent.setup();
        const onContinue = vi.fn();
        render(
            <RoundSummaryModal
                {...baseProps}
                playerId={1}
                title="Round Recap"
                continueLabel="Count the Score"
                scoreActionLabel="Collect Points"
                onContinue={onContinue}
                scoreStage="preview"
                tutorialHint={{
                    eyebrow: 'Round recap',
                    title: 'See where every point came from',
                    body: 'Card points and the bid multiplier explain this score.'
                }}
                insurance={{}}
                bidWinnerInfo={{ playerName: 'Alice' }}
                playerOrderActive={['Alice', 'Bob', 'Cara']}
                summaryData={{
                    isGameOver: false,
                    dealerOfRoundId: 1,
                    finalScores: { Alice: 132, Bob: 114, Cara: 114 },
                    pointChanges: { Alice: 12, Bob: -6, Cara: -6 },
                    finalBidderPoints: 72,
                    finalDefenderPoints: 48,
                    bidType: 'Frog',
                    insuranceDealWasMade: false,
                    insuranceHindsight: {},
                    widowForReveal: [],
                    widowPointsValue: 0
                }}
            />
        );

        expect(screen.getByRole('dialog', { name: 'Round Recap' })).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('See where every point came from');
        expect(screen.getByText(/Card points and the bid multiplier/i)).toBeInTheDocument();
        expect(screen.getByText('New Total')).toBeInTheDocument();
        expect(screen.getByText('+12')).toBeInTheDocument();
        expect(screen.getAllByText('-6')).toHaveLength(2);
        expect(screen.getByLabelText('Alice new total is hidden until the score is counted')).toHaveTextContent('—');
        expect(screen.queryByText('132')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Collect Points' })).toHaveFocus();
        await user.click(screen.getByRole('button', { name: 'Collect Points' }));
        expect(onContinue).toHaveBeenCalledTimes(1);
    });

    describe('score action timer', () => {
        afterEach(() => {
            vi.useRealTimers();
        });

        test('automatically runs the primary score action once after ten seconds', () => {
            vi.useFakeTimers();
            const onContinue = vi.fn();
            render(<RoundSummaryModal {...makeTimedPreviewProps(onContinue)} />);

            const primaryAction = screen.getByRole('button', { name: 'Collect Points' });
            expect(Number(primaryAction.style.getPropertyValue('--summary-action-progress'))).toBe(1);
            act(() => vi.advanceTimersByTime(9999));
            expect(onContinue).not.toHaveBeenCalled();
            expect(primaryAction).toHaveAccessibleName('Collect Points');
            expect(Number(primaryAction.style.getPropertyValue('--summary-action-progress'))).toBeLessThan(0.02);

            act(() => vi.advanceTimersByTime(1));
            expect(onContinue).toHaveBeenCalledTimes(1);

            act(() => vi.advanceTimersByTime(30000));
            expect(onContinue).toHaveBeenCalledTimes(1);
        });

        test('allows two ten-second extensions and caps the total wait at thirty seconds', () => {
            vi.useFakeTimers();
            const onContinue = vi.fn();
            render(<RoundSummaryModal {...makeTimedPreviewProps(onContinue)} />);

            const extendButton = screen.getByRole('button', { name: '+10 seconds' });
            fireEvent.click(extendButton);
            expect(extendButton).toBeEnabled();
            fireEvent.click(extendButton);
            expect(extendButton).toBeDisabled();

            act(() => vi.advanceTimersByTime(29999));
            expect(onContinue).not.toHaveBeenCalled();
            act(() => vi.advanceTimersByTime(1));
            expect(onContinue).toHaveBeenCalledTimes(1);
        });

        test('a manual score action cancels its timer and cannot fire a duplicate', () => {
            vi.useFakeTimers();
            const onContinue = vi.fn();
            render(<RoundSummaryModal {...makeTimedPreviewProps(onContinue)} />);

            act(() => vi.advanceTimersByTime(4000));
            fireEvent.click(screen.getByRole('button', { name: 'Collect Points' }));
            expect(onContinue).toHaveBeenCalledTimes(1);

            act(() => vi.advanceTimersByTime(30000));
            expect(onContinue).toHaveBeenCalledTimes(1);
        });

        test('a fresh summary object rebroadcast does not restart the countdown', () => {
            vi.useFakeTimers();
            const onContinue = vi.fn();
            const props = makeTimedPreviewProps(onContinue);
            const { rerender } = render(<RoundSummaryModal {...props} />);

            act(() => vi.advanceTimersByTime(6000));
            rerender(
                <RoundSummaryModal
                    {...props}
                    summaryData={makeTimedPreviewSummary()}
                />
            );

            act(() => vi.advanceTimersByTime(3999));
            expect(onContinue).not.toHaveBeenCalled();
            act(() => vi.advanceTimersByTime(1));
            expect(onContinue).toHaveBeenCalledTimes(1);
        });

        test('a new action timer key starts a fresh ten-second countdown', () => {
            vi.useFakeTimers();
            const onContinue = vi.fn();
            const props = makeTimedPreviewProps(onContinue);
            const { rerender } = render(<RoundSummaryModal {...props} />);

            act(() => vi.advanceTimersByTime(9000));
            rerender(<RoundSummaryModal {...props} actionTimerKey="round-2" />);
            act(() => vi.advanceTimersByTime(9999));
            expect(onContinue).not.toHaveBeenCalled();
            act(() => vi.advanceTimersByTime(1));
            expect(onContinue).toHaveBeenCalledTimes(1);
        });

        test('gives every later round a fresh countdown and two fresh extensions', () => {
            vi.useFakeTimers();
            const onContinue = vi.fn();
            const props = makeTimedPreviewProps(onContinue);
            const { rerender } = render(<RoundSummaryModal {...props} />);

            act(() => vi.advanceTimersByTime(10000));
            expect(onContinue).toHaveBeenCalledTimes(1);

            rerender(<RoundSummaryModal {...props} showModal={false} />);
            rerender(
                <RoundSummaryModal
                    {...props}
                    actionTimerKey="round-2"
                    summaryData={{
                        ...makeTimedPreviewSummary(),
                        dealerOfRoundId: 2,
                        finalScores: { Alice: 138, Bob: 111, Cara: 111 }
                    }}
                />
            );

            expect(onContinue).toHaveBeenCalledTimes(1);
            const primaryAction = screen.getByRole('button', { name: 'Collect Points' });
            expect(primaryAction).toHaveTextContent('10s');

            const extendButton = screen.getByRole('button', { name: '+10 seconds' });
            fireEvent.click(extendButton);
            fireEvent.click(extendButton);
            expect(extendButton).toBeDisabled();

            act(() => vi.advanceTimersByTime(29999));
            expect(onContinue).toHaveBeenCalledTimes(1);
            act(() => vi.advanceTimersByTime(1));
            expect(onContinue).toHaveBeenCalledTimes(2);
        });

        test.each([
            ['the recap closes', { showModal: false }],
            ['the recap leaves preview', { scoreStage: 'counting' }]
        ])('cancels the pending score action when %s', (_reason, transitionProps) => {
            vi.useFakeTimers();
            const onContinue = vi.fn();
            const props = makeTimedPreviewProps(onContinue);
            const { rerender } = render(<RoundSummaryModal {...props} />);

            act(() => vi.advanceTimersByTime(5000));
            rerender(<RoundSummaryModal {...props} {...transitionProps} />);
            act(() => vi.advanceTimersByTime(30000));

            expect(onContinue).not.toHaveBeenCalled();
        });
    });

    test('runs the score count inside the recap without adding a nested modal', () => {
        vi.useFakeTimers();
        const onScoreComplete = vi.fn();
        render(
            <RoundSummaryModal
                {...baseProps}
                playerId={1}
                title="Round Recap"
                onContinue={vi.fn()}
                scoreStage="counting"
                onScoreComplete={onScoreComplete}
                prefersReducedMotion={false}
                insurance={{}}
                bidWinnerInfo={{ playerName: 'Alice' }}
                playerOrderActive={['Alice', 'Bob', 'Cara']}
                playerOrder={['Bob', 'Alice', 'Cara']}
                summaryData={{
                    isGameOver: false,
                    dealerOfRoundId: 1,
                    finalScores: { Alice: 132, Bob: 114, Cara: 114 },
                    pointChanges: { Alice: 12, Bob: -6, Cara: -6 },
                    finalBidderPoints: 72,
                    finalDefenderPoints: 48,
                    bidType: 'Frog',
                    insuranceDealWasMade: false,
                    insuranceHindsight: {},
                    widowForReveal: [],
                    widowPointsValue: 0
                }}
            />
        );

        const recap = screen.getByRole('dialog', { name: 'Round Recap' });
        expect(within(recap).getByLabelText('Counting round score')).toBeInTheDocument();
        expect(within(recap).queryByRole('dialog')).not.toBeInTheDocument();
        expect(screen.getByText('+12')).toHaveAttribute('aria-hidden', 'false');
        expect(screen.queryByRole('button', { name: 'Count the Score' })).not.toBeInTheDocument();

        act(() => vi.runAllTimers());
        expect(screen.getByLabelText('Alice score')).toHaveTextContent('132');
        expect(onScoreComplete).toHaveBeenCalledTimes(1);
        vi.useRealTimers();
    });

    test('a state rebroadcast mid-count does not restart the score ceremony', () => {
        vi.useFakeTimers();
        const onScoreComplete = vi.fn();
        // Fresh object identities mimic a server broadcast arriving during the
        // count (presentation acks rebroadcast table state to everyone).
        const makeSummary = () => ({
            isGameOver: false,
            dealerOfRoundId: 1,
            finalScores: { Alice: 132, Bob: 114, Cara: 114 },
            pointChanges: { Alice: 12, Bob: -6, Cara: -6 },
            finalBidderPoints: 72,
            finalDefenderPoints: 48,
            bidType: 'Frog',
            insuranceDealWasMade: false,
            insuranceHindsight: {},
            widowForReveal: [],
            widowPointsValue: 0
        });
        const props = {
            ...baseProps,
            playerId: 1,
            title: 'Round Recap',
            onContinue: vi.fn(),
            scoreStage: 'counting',
            onScoreComplete,
            prefersReducedMotion: false,
            insurance: {},
            bidWinnerInfo: { playerName: 'Alice' },
            playerOrderActive: ['Alice', 'Bob', 'Cara']
        };
        const { rerender } = render(<RoundSummaryModal {...props} summaryData={makeSummary()} />);

        const ceremonyNode = screen.getByLabelText('Counting round score');
        act(() => vi.advanceTimersByTime(600));
        rerender(<RoundSummaryModal {...props} summaryData={makeSummary()} />);

        expect(screen.getByLabelText('Counting round score')).toBe(ceremonyNode);
        act(() => vi.runAllTimers());
        expect(onScoreComplete).toHaveBeenCalledTimes(1);
        vi.useRealTimers();
    });

    test('collapses open trick details so an insurance score count always mounts', () => {
        vi.useFakeTimers();
        const onScoreComplete = vi.fn();
        const props = {
            ...baseProps,
            playerId: 1,
            title: 'Round Recap',
            onContinue: vi.fn(),
            onScoreComplete,
            prefersReducedMotion: false,
            insurance: {
                bidMultiplier: 1,
                bidderRequirement: 120,
                defenderOffers: { Bob: 10, Cara: 10 }
            },
            bidWinnerInfo: { playerName: 'Alice' },
            playerOrderActive: ['Alice', 'Bob', 'Cara'],
            summaryData: {
                isGameOver: false,
                dealerOfRoundId: 1,
                finalScores: { Alice: 132, Bob: 114, Cara: 114 },
                pointChanges: { Alice: 12, Bob: -6, Cara: -6 },
                finalBidderPoints: 72,
                finalDefenderPoints: 48,
                bidType: 'Frog',
                insuranceDealWasMade: true,
                insuranceHindsight: {},
                allTricks: {},
                widowForReveal: [],
                widowPointsValue: 0
            }
        };
        const { rerender } = render(<RoundSummaryModal {...props} scoreStage="preview" />);

        fireEvent.click(screen.getByRole('button', { name: 'Show Trick Breakdown' }));
        expect(screen.getByRole('button', { name: 'Hide Trick Breakdown' })).toBeInTheDocument();

        rerender(<RoundSummaryModal {...props} scoreStage="counting" />);
        expect(screen.getByLabelText('Counting round score')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Show Trick Breakdown' })).not.toBeInTheDocument();

        act(() => vi.runAllTimers());
        expect(onScoreComplete).toHaveBeenCalledTimes(1);
        vi.useRealTimers();
    });

    test('counts an executed insurance round even when live insurance controls are unavailable', () => {
        vi.useFakeTimers();
        const onScoreComplete = vi.fn();
        render(
            <RoundSummaryModal
                {...baseProps}
                playerId={1}
                title="Round Recap"
                onContinue={vi.fn()}
                scoreStage="counting"
                onScoreComplete={onScoreComplete}
                prefersReducedMotion={false}
                insurance={null}
                bidWinnerInfo={{ playerName: 'Alice' }}
                playerOrderActive={['Alice', 'Bob', 'Cara']}
                summaryData={{
                    isGameOver: false,
                    finalScores: { Alice: 132, Bob: 114, Cara: 114 },
                    pointChanges: { Alice: 12, Bob: -6, Cara: -6 },
                    finalBidderPoints: 72,
                    finalDefenderPoints: 48,
                    bidType: 'Frog',
                    insuranceDealWasMade: true,
                    insuranceHindsight: {},
                    widowForReveal: [],
                    widowPointsValue: 0
                }}
            />
        );

        expect(screen.getByLabelText('Counting round score')).toBeInTheDocument();
        act(() => vi.runAllTimers());
        expect(onScoreComplete).toHaveBeenCalledTimes(1);
        vi.useRealTimers();
    });

    test('shows authoritative final totals after counting without another action button', () => {
        render(
            <RoundSummaryModal
                {...baseProps}
                playerId={1}
                title="Round Recap"
                onContinue={vi.fn()}
                scoreStage="complete"
                insurance={{}}
                bidWinnerInfo={{ playerName: 'Alice' }}
                playerOrderActive={['Alice', 'Bob', 'Cara']}
                summaryData={{
                    isGameOver: false,
                    finalScores: { Alice: 132, Bob: 114, Cara: 114 },
                    pointChanges: { Alice: 12, Bob: -6, Cara: -6 },
                    finalBidderPoints: 72,
                    finalDefenderPoints: 48,
                    bidType: 'Frog',
                    insuranceDealWasMade: false,
                    insuranceHindsight: {},
                    widowForReveal: [],
                    widowPointsValue: 0
                }}
            />
        );

        expect(screen.getByLabelText('Alice new total 132')).toHaveTextContent('132');
        expect(screen.queryByRole('button', { name: 'Count the Score' })).not.toBeInTheDocument();
    });

    test('can hand a forfeit recap to the podium without exposing final scores early', async () => {
        const user = userEvent.setup();
        const onContinue = vi.fn();
        render(
            <RoundSummaryModal
                {...baseProps}
                playerId={2}
                title="Final Round Recap"
                continueLabel="View Final Standings"
                onContinue={onContinue}
                showScoreTotals={false}
                scoreStage="preview"
                summaryData={{
                    isGameOver: true,
                    forfeit: { forfeitingPlayerName: 'Alice', reason: 'voluntary forfeit' },
                    gameWinner: 'Bob & Cara',
                    finalScores: { Alice: 120, Bob: 105, Cara: 95 }
                }}
            />
        );

        expect(screen.queryByRole('heading', { name: 'Final Scores' })).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'View Final Standings' }));
        expect(onContinue).toHaveBeenCalledTimes(1);
    });

    test('surfaces a failed final settlement in the recap', () => {
        render(
            <RoundSummaryModal
                {...baseProps}
                playerId={1}
                insurance={{}}
                bidWinnerInfo={{ playerName: 'Alice' }}
                playerOrderActive={['Alice', 'Bob', 'Cara']}
                summaryData={{
                    isGameOver: true,
                    message: 'Game settlement needs administrator review. No partial payout was committed.',
                    finalScores: { Alice: 132, Bob: 114, Cara: -2 },
                    pointChanges: { Alice: 12, Bob: -6, Cara: -122 },
                    finalBidderPoints: 72,
                    finalDefenderPoints: 48,
                    bidType: 'Frog',
                    insuranceDealWasMade: false,
                    insuranceHindsight: {},
                    widowForReveal: [],
                    widowPointsValue: 0
                }}
            />
        );

        expect(screen.getByRole('status')).toHaveTextContent('administrator review');
    });

    test('does not mix the overall coin payout message into a final-round loss recap', () => {
        const payoutMessage = 'You finished 1st and won a net 1.00 tokens!';
        render(
            <RoundSummaryModal
                {...baseProps}
                playerId={2}
                title="Final Round Recap"
                scoreActionLabel="Hand Over Points"
                onContinue={vi.fn()}
                scoreStage="preview"
                insurance={{}}
                bidWinnerInfo={{ playerName: 'Alice' }}
                playerOrderActive={['Alice', 'Bob', 'Cara']}
                summaryData={{
                    isGameOver: true,
                    gameWinner: 'Bob',
                    payoutDetails: { 2: payoutMessage },
                    finalScores: { Alice: 132, Bob: 114, Cara: -6 },
                    pointChanges: { Alice: 12, Bob: -6, Cara: -6 },
                    finalBidderPoints: 72,
                    finalDefenderPoints: 48,
                    bidType: 'Frog',
                    insuranceDealWasMade: false,
                    insuranceHindsight: {},
                    widowForReveal: [],
                    widowPointsValue: 0
                }}
            />
        );

        expect(screen.getByRole('heading', { name: 'Final Round Recap' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Hand Over Points' })).toBeInTheDocument();
        expect(screen.queryByText(payoutMessage)).not.toBeInTheDocument();
    });

    test('collapses trick details when the recap closes before a later round', async () => {
        const user = userEvent.setup();
        const props = {
            ...baseProps,
            playerId: 1,
            insurance: {},
            bidWinnerInfo: { playerName: 'Alice' },
            playerOrderActive: ['Alice', 'Bob', 'Cara'],
            summaryData: {
                isGameOver: false,
                dealerOfRoundId: 1,
                finalScores: { Alice: 132, Bob: 114, Cara: 114 },
                pointChanges: { Alice: 12, Bob: -6, Cara: -6 },
                finalBidderPoints: 72,
                finalDefenderPoints: 48,
                bidType: 'Frog',
                insuranceDealWasMade: false,
                insuranceHindsight: {},
                allTricks: {},
                widowForReveal: [],
                widowPointsValue: 0
            }
        };
        const { rerender } = render(<RoundSummaryModal {...props} />);

        await user.click(screen.getByRole('button', { name: 'Show Trick Breakdown' }));
        expect(screen.getByRole('button', { name: 'Hide Trick Breakdown' })).toBeInTheDocument();
        rerender(<RoundSummaryModal {...props} showModal={false} />);
        rerender(<RoundSummaryModal {...props} showModal />);
        expect(screen.getByRole('button', { name: 'Show Trick Breakdown' })).toBeInTheDocument();
    });
});
