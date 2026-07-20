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

describe('computeNoDealRecap (approved compact grades v2)', () => {
    const recapOf = ({ ask, offers, changes, multiplier = 1 }) => computeNoDealRecap({
        bidderRequirement: ask,
        defenderOffers: offers,
        bidMultiplier: multiplier,
        pointChanges: changes,
        bidderName: 'Alice',
    });

    const cases = [
        ['01 reported case', 40, { Bob: -30, Cara: 20 }, { Alice: 24, Bob: -12, Cara: -12 }, 1, 'gap', 'No one blinked.', ['Saved 34', 'Greedy 42', 'Lucky 8']],
        ['02 backed ask', 40, { Bob: 19, Cara: 20 }, { Alice: 60, Bob: -30, Cara: -30 }, 1, 'lowball', 'Defenders lowballed.', ['Saved 21', 'Greedy 11', 'Greedy 10']],
        ['03 cards match ask', 20, { Bob: 9, Cara: 10 }, { Alice: 20, Bob: -10, Cara: -10 }, 1, 'lowball', 'Defenders lowballed.', ['Saved 1', 'Greedy 1', 'Perfect bid']],
        ['04 correct holdout', 60, { Bob: 10, Cara: 20 }, { Alice: 40, Bob: -20, Cara: -20 }, 1, 'gap', 'No one blinked.', ['Saved 10', 'Greedy 10', 'Perfect bid']],
        ['05 winning overreach', 40, { Bob: 10, Cara: 20 }, { Alice: 24, Bob: -12, Cara: -12 }, 1, 'overreach', 'Bidder overreached.', ['Wasted 6', 'Greedy 2', 'Lucky 8']],
        ['06 bidder loses', 40, { Bob: 10, Cara: 20 }, { Alice: -30, Bob: 10, Cara: 10, ScoreAbsorber: 10 }, 1, 'overreach', 'Bidder overreached.', ['Wasted 60', 'Lucky 20', 'Lucky 30']],
        ['07 exact sixty', 20, { Bob: 0, Cara: 0 }, { Alice: 0, Bob: 0, Cara: 0 }, 1, 'match', 'Cards matched the offers.', ['Nice try', 'Perfect bid', 'Perfect bid']],
        ['08 one defender can close', 80, { Bob: 50, Cara: 0 }, { Alice: 50, Bob: -25, Cara: -25 }, 1, 'match', 'Cards matched the offers.', ['Greedy 30', 'Lucky 25', 'Greedy 25']],
        ['09 neither can close', 100, { Bob: 20, Cara: 20 }, { Alice: 120, Bob: -60, Cara: -60 }, 1, 'lowball', 'Defenders lowballed.', ['Saved 80', 'Greedy 40', 'Greedy 40']],
        ['10 maximum close', 80, { Bob: 20, Cara: 20 }, { Alice: 60, Bob: -30, Cara: -30 }, 1, 'gap', 'No one blinked.', ['Saved 20', 'Greedy 10', 'Greedy 10']],
        ['11 negative ask', -20, { Bob: -15, Cara: -10 }, { Alice: -15, Bob: 5, Cara: 5, ScoreAbsorber: 5 }, 1, 'lowball', 'Defenders lowballed.', ['Lucky 5', 'Greedy 10', 'Greedy 5']],
        ['13 mixed signs', 20, { Bob: -20, Cara: 30 }, { Alice: 0, Bob: 0, Cara: 0 }, 1, 'overreach', 'Bidder overreached.', ['Wasted 10', 'Greedy 20', 'Lucky 30']],
        ['14 odd ask', 25, { Bob: 10, Cara: 14 }, { Alice: 16, Bob: -8, Cara: -8 }, 1, 'overreach', 'Bidder overreached.', ['Wasted 8', 'Lucky 2', 'Lucky 6']],
        ['15 Solo failure', 40, { Bob: 10, Cara: 15 }, { Alice: -60, Bob: 20, Cara: 20, ScoreAbsorber: 20 }, 2, 'overreach', 'Bidder overreached.', ['Wasted 85', 'Lucky 30', 'Lucky 35']],
        ['16 Heart Solo', 60, { Bob: 20, Cara: 30 }, { Alice: 48, Bob: -24, Cara: -24 }, 3, 'overreach', 'Bidder overreached.', ['Wasted 2', 'Greedy 4', 'Lucky 6']],
        ['17 reviewed custom', 40, { Bob: -30, Cara: 20 }, { Alice: 12, Bob: -6, Cara: -6 }, 1, 'gap', 'No one blinked.', ['Saved 22', 'Greedy 36', 'Lucky 14']],
    ];

    test.each(cases)('%s', (_label, ask, offers, changes, multiplier, zone, header, expectedGrades) => {
        const recap = recapOf({ ask, offers, changes, multiplier });

        expect(recap).toMatchObject({
            neverNegotiated: false,
            ask,
            offerSum: offers.Bob + offers.Cara,
            gap: ask - offers.Bob - offers.Cara,
            zone,
            header,
        });
        expect(recap.rows.map(row => row.name)).toEqual(['Alice', 'Bob', 'Cara']);
        expect(recap.rows.map(row => row.verdict.text)).toEqual(expectedGrades);
        expect(recap.rows.map(row => row.verdict.cls)).toEqual(expectedGrades.map(text => (
            /^(Saved|Lucky)/.test(text)
                ? 'verdict-good'
                : /^(Wasted|Greedy)/.test(text)
                    ? 'verdict-bad'
                    : 'verdict-muted'
        )));
    });

    test('12 untouched defaults suppress every grade', () => {
        const recap = recapOf({
            ask: 120,
            offers: { Bob: -60, Cara: -60 },
            changes: { Alice: 24, Bob: -12, Cara: -12 },
        });

        expect(recap).toMatchObject({
            neverNegotiated: true,
            zone: null,
            header: null,
            rows: [],
        });
    });

    test('normalizes finite numeric strings without grading the score absorber', () => {
        const recap = recapOf({
            ask: '40',
            offers: { Bob: '-30', Cara: '20' },
            changes: { Alice: '24', Bob: '-12', Cara: '-12', ScoreAbsorber: '12' },
        });

        expect(recap.rows.map(row => [row.name, row.verdict.text])).toEqual([
            ['Alice', 'Saved 34'],
            ['Bob', 'Greedy 42'],
            ['Cara', 'Lucky 8'],
        ]);
    });
});

describe('RoundSummaryModal no-deal verdict panel', () => {
    const noDealProps = (overrides = {}) => makeTimedPreviewProps(vi.fn(), {
        scoreStage: 'complete',
        insurance: { bidMultiplier: 1, bidderRequirement: 40, defenderOffers: { Bob: -30, Cara: 20 } },
        summaryData: {
            ...makeTimedPreviewSummary(),
            pointChanges: { Alice: 24, Bob: -12, Cara: -12 },
        },
        ...overrides
    });

    test('renders the approved compact headline, stances, and player grades', () => {
        render(<RoundSummaryModal {...noDealProps()} />);

        expect(screen.getByText('Insurance · No Deal')).toBeInTheDocument();
        expect(screen.getByText('No one blinked.')).toBeInTheDocument();
        expect(screen.getByText(/ask 40 · offers -10 · gap 50/)).toBeInTheDocument();
        expect(screen.getByText('Asked 40')).toBeInTheDocument();
        expect(screen.getByText('Asked +30')).toBeInTheDocument();
        expect(screen.getByText('Offered 20')).toBeInTheDocument();
        expect(screen.getByText('Saved 34')).toHaveClass('verdict-good');
        expect(screen.getByText('Greedy 42')).toHaveClass('verdict-bad');
        expect(screen.getByText('Lucky 8')).toHaveClass('verdict-good');

        const table = screen.getByRole('table', { name: 'Insurance grades' });
        expect(within(table).getAllByRole('row')).toHaveLength(4);
        expect(screen.queryByText(/Decision check|Close check|even share|broke even/i)).not.toBeInTheDocument();
    });

    test('suppresses verdicts when insurance was never negotiated', () => {
        render(<RoundSummaryModal {...noDealProps({
            insurance: { bidMultiplier: 2, bidderRequirement: 240, defenderOffers: { Bob: -120, Cara: -120 } },
        })} />);

        expect(screen.getByText('No grade this round.')).toBeInTheDocument();
        expect(screen.queryByText(/No one blinked|overreached|lowballed/)).not.toBeInTheDocument();
        expect(screen.queryByRole('table', { name: 'Insurance grades' })).not.toBeInTheDocument();
    });

    test.each([
        ['one defender offer', {
            insurance: { bidMultiplier: 1, bidderRequirement: 40, defenderOffers: { Bob: -30 } },
        }],
        ['a missing player score', {
            summaryData: {
                ...makeTimedPreviewSummary(),
                pointChanges: { Alice: 24, Bob: -12 },
            },
        }],
        ['a non-numeric ask', {
            insurance: { bidMultiplier: 1, bidderRequirement: 'unknown', defenderOffers: { Bob: -30, Cara: 20 } },
        }],
    ])('omits a no-deal grade when legacy data has %s', (_label, overrides) => {
        render(<RoundSummaryModal {...noDealProps(overrides)} />);

        expect(screen.getByText('Trick Point Recap')).toBeInTheDocument();
        expect(screen.queryByText('Insurance · No Deal')).not.toBeInTheDocument();
        expect(screen.queryByRole('table', { name: 'Insurance grades' })).not.toBeInTheDocument();
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

        test('allows four ten-second extensions and caps the total wait at fifty seconds', () => {
            vi.useFakeTimers();
            const onContinue = vi.fn();
            render(<RoundSummaryModal {...makeTimedPreviewProps(onContinue)} />);

            const extendButton = screen.getByRole('button', { name: '+10 seconds' });
            fireEvent.click(extendButton);
            fireEvent.click(extendButton);
            fireEvent.click(extendButton);
            expect(extendButton).toBeEnabled();
            fireEvent.click(extendButton);
            expect(extendButton).toBeDisabled();

            act(() => vi.advanceTimersByTime(49999));
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

        test('gives every later round a fresh countdown and four fresh extensions', () => {
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
            fireEvent.click(extendButton);
            fireEvent.click(extendButton);
            expect(extendButton).toBeDisabled();

            act(() => vi.advanceTimersByTime(49999));
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
