// The learner-mode lesson picker: fires the right lesson at the right
// moment, one at a time, never twice, and only from public client state.

import { pickLearnerLesson, explainTrick, pointsMilestone, isLearner, LEARNER_GAMES } from './learnerLessons';

const baseState = (overrides = {}) => ({
    state: 'Playing Phase',
    trumpSuit: 'H',
    currentTrickCards: [],
    leadSuitCurrentTrick: null,
    trickTurnPlayerName: 'Me',
    lastCompletedTrick: null,
    playoutVote: { isActive: false },
    drawRequest: { isActive: false },
    hands: { Me: ['AS', '10S', 'KD', '7D', '6C'] },
    ...overrides,
});

const seen = (...ids) => new Set(ids);

describe('isLearner', () => {
    test('learner status retires after the configured game count', () => {
        expect(isLearner({ gamesPlayed: 0 })).toBe(true);
        expect(isLearner({ gamesPlayed: LEARNER_GAMES - 1 })).toBe(true);
        expect(isLearner({ gamesPlayed: LEARNER_GAMES })).toBe(false);
        expect(isLearner(undefined)).toBe(true);
    });
});

describe('pickLearnerLesson', () => {
    test('opens with the card-points lesson anchored to the hand', () => {
        const lesson = pickLearnerLesson(baseState(), 'Me', seen());
        expect(lesson.id).toBe('learner-card-points-2026-08');
        expect(lesson.anchor).toBe('.player-hand-container');
        expect(lesson.spotlight).toBe(true);
    });

    test('the teams lesson leads once a bidder exists, naming trump, from both chairs', () => {
        const asDefender = pickLearnerLesson(baseState({
            bidWinnerInfo: { playerName: 'Ann', bid: 'Solo' },
            playerOrderActive: ['Ann', 'Me', 'Bea'],
        }), 'Me', seen());
        expect(asDefender.id).toBe('learner-teams-2026-08');
        expect(asDefender.anchor).toBe('[data-seat-player="Ann"]');
        expect(asDefender.copy.strong).toMatch(/Ann plays alone/i);
        expect(asDefender.copy.text).toMatch(/you and Bea are a TEAM/i);
        expect(asDefender.copy.text).toMatch(/Hearts are trump/);

        const asBidder = pickLearnerLesson(baseState({
            bidWinnerInfo: { playerName: 'Me', bid: 'Frog' },
            playerOrderActive: ['Ann', 'Me', 'Bea'],
        }), 'Me', seen());
        expect(asBidder.copy.strong).toMatch(/you play alone/i);
        expect(asBidder.copy.text).toMatch(/Hearts are your trump/);
    });

    test('the trump lock and insurance lessons cover the last silent enforcements', () => {
        const lock = pickLearnerLesson(baseState({
            hands: { Me: ['AH', '7H', 'KD', '9S'] }, // holds trump + off-suit
            trumpBroken: false,
        }), 'Me', seen('learner-card-points-2026-08'));
        expect(lock.id).toBe('learner-trump-lock-2026-08');
        expect(lock.copy.text).toMatch(/stay locked until someone trumps/i);

        const ins = pickLearnerLesson(baseState({
            trickTurnPlayerName: 'Ann', // not my turn — no forced-play lesson
            insurance: { isActive: true, dealExecuted: false },
        }), 'Me', seen('learner-card-points-2026-08'));
        expect(ins.id).toBe('learner-insurance-2026-08');
        expect(ins.copy.strong).toMatch(/optional/i);
        expect(ins.copy.text).toMatch(/cards decide the round as normal/i);
    });

    test('explains the forced trump the moment the UI enforces it', () => {
        const lesson = pickLearnerLesson(baseState({
            currentTrickCards: [{ playerName: 'Ann', card: 'KC' }],
            leadSuitCurrentTrick: 'C',
            hands: { Me: ['AH', '7H', 'KD', '9S'] }, // void in clubs, holds trump
        }), 'Me', seen('learner-card-points-2026-08'));
        expect(lesson.id).toBe('learner-must-trump-2026-08');
        expect(lesson.copy.strong).toMatch(/out of clubs/i);
        expect(lesson.copy.text).toMatch(/must play trump/i);
    });

    test('explains follow-suit dimming while the player still holds the suit', () => {
        const lesson = pickLearnerLesson(baseState({
            currentTrickCards: [{ playerName: 'Ann', card: 'KC' }],
            leadSuitCurrentTrick: 'C',
            hands: { Me: ['6C', 'AH', 'KD'] },
        }), 'Me', seen('learner-card-points-2026-08'));
        expect(lesson.id).toBe('learner-follow-suit-2026-08');
        expect(lesson.copy.strong).toMatch(/follow clubs/i);
    });

    test('the linger teaches the 10-beats-King trap, anchored to the winner', () => {
        const lesson = pickLearnerLesson(baseState({
            state: 'TrickCompleteLinger',
            lastCompletedTrick: {
                winnerName: 'Ann',
                cards: [
                    { playerName: 'Me', card: 'KS' },
                    { playerName: 'Ann', card: '10S' },
                    { playerName: 'Bea', card: '7S' },
                ],
            },
        }), 'Me', seen('learner-card-points-2026-08'));
        expect(lesson.id).toBe('learner-ten-beats-king-2026-08');
        expect(lesson.anchor).toBe('[data-seat-player="Ann"]');
        expect(lesson.copy.text).toMatch(/6 7 8 9 J Q K 10 A/);
    });

    test('the ace-takes-ten and trump-wins post-mortems fire on their shapes', () => {
        const aceLesson = pickLearnerLesson(baseState({
            state: 'TrickCompleteLinger',
            lastCompletedTrick: {
                winnerName: 'Ann',
                cards: [
                    { playerName: 'Me', card: '10D' },
                    { playerName: 'Ann', card: 'AD' },
                    { playerName: 'Bea', card: '6D' },
                ],
            },
        }), 'Me', seen('learner-card-points-2026-08'));
        expect(aceLesson.id).toBe('learner-ace-takes-ten-2026-08');

        const trumpLesson = pickLearnerLesson(baseState({
            state: 'TrickCompleteLinger',
            lastCompletedTrick: {
                winnerName: 'Bea',
                cards: [
                    { playerName: 'Me', card: 'KS' },
                    { playerName: 'Ann', card: '9S' },
                    { playerName: 'Bea', card: '6H' }, // small trump takes it
                ],
            },
        }), 'Me', seen('learner-card-points-2026-08'));
        expect(trumpLesson.id).toBe('learner-trump-wins-2026-08');
        expect(trumpLesson.copy.text).toMatch(/even a small trump/i);
    });

    test('every lesson is once — seen ids never fire again', () => {
        const allSeen = seen(
            'learner-card-points-2026-08',
            'learner-must-trump-2026-08',
            'learner-follow-suit-2026-08',
            'learner-ten-beats-king-2026-08',
            'learner-ace-takes-ten-2026-08',
            'learner-trump-wins-2026-08',
            'learner-points-pile-2026-08',
        );
        expect(pickLearnerLesson(baseState(), 'Me', allSeen)).toBeNull();
        expect(pickLearnerLesson(baseState({
            state: 'TrickCompleteLinger',
            lastCompletedTrick: {
                winnerName: 'Ann',
                cards: [
                    { playerName: 'Me', card: 'KS' },
                    { playerName: 'Ann', card: '10S' },
                    { playerName: 'Bea', card: 'AS' },
                ],
            },
        }), 'Me', allSeen)).toBeNull();
    });

    test('stays silent during votes and for missing state', () => {
        expect(pickLearnerLesson(baseState({ playoutVote: { isActive: true } }), 'Me', seen())).toBeNull();
        expect(pickLearnerLesson(baseState({ drawRequest: { isActive: true } }), 'Me', seen())).toBeNull();
        expect(pickLearnerLesson(null, 'Me', seen())).toBeNull();
        expect(pickLearnerLesson(baseState(), null, seen())).toBeNull();
    });

    test('explainTrick narrates every linger: winner, reason, points', () => {
        const trumped = explainTrick(baseState({
            state: 'TrickCompleteLinger',
            lastCompletedTrick: {
                winnerName: 'Bea',
                cards: [
                    { playerName: 'Me', card: 'KS' },
                    { playerName: 'Ann', card: '9S' },
                    { playerName: 'Bea', card: '6H' },
                ],
            },
        }));
        expect(trumped.anchor).toBe('[data-seat-player="Bea"]');
        expect(trumped.text).toMatch(/Bea takes it — no spades left, so the rules said play trump — and trump beats the led suit \(\+4 pts\)/);

        const plain = explainTrick(baseState({
            state: 'TrickCompleteLinger',
            lastCompletedTrick: {
                winnerName: 'Ann',
                cards: [
                    { playerName: 'Me', card: '7D' },
                    { playerName: 'Ann', card: 'QD' },
                    { playerName: 'Bea', card: '8D' },
                ],
            },
        }));
        expect(plain.text).toMatch(/Ann takes it — highest diamond \(\+3 pts\)/);
        expect(explainTrick(baseState())).toBeNull();
    });

    test('lesson ids satisfy the receipts API pattern', () => {
        const TIP_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
        const shapes = [
            baseState(),
            baseState({
                currentTrickCards: [{ playerName: 'Ann', card: 'KC' }],
                leadSuitCurrentTrick: 'C',
                hands: { Me: ['AH', '7H', 'KD'] },
            }),
        ];
        for (const shape of shapes) {
            const lesson = pickLearnerLesson(shape, 'Me', seen());
            if (lesson) expect(lesson.id).toMatch(TIP_ID_PATTERN);
        }
    });
});

describe('pointsMilestone', () => {
    // A linger where Ann (the bidder) just took a 21-point trick
    // (AH 11 + 10H 10 + 6H 0). Server shape: the winner's pile already
    // contains the crossing trick.
    const lingerState = (overrides = {}) => baseState({
        state: 'TrickCompleteLinger',
        bidWinnerInfo: { playerName: 'Ann', bid: 'Solo' },
        playerOrderActive: ['Ann', 'Me', 'Bea'],
        lastCompletedTrick: {
            winnerName: 'Ann',
            cards: [
                { playerName: 'Ann', card: 'AH' },
                { playerName: 'Me', card: '10H' },
                { playerName: 'Bea', card: '6H' },
            ],
        },
        ...overrides,
    });
    const crossingTrick = { cards: ['AH', '10H', '6H'] }; // 21

    test('announces the bidder approaching break-even at 50', () => {
        const milestone = pointsMilestone(lingerState({
            // 24 + 9 banked, + 21 = 54: crossed 50, still short of 61.
            capturedTricks: { Ann: [
                { cards: ['AS', 'AC', 'JD'] },
                { cards: ['KD', 'QD', 'JC'] },
                crossingTrick,
            ] },
        }), 'Me');
        expect(milestone.key).toMatch(/^milestone:close:/);
        expect(milestone.copy.strong).toBe('Ann is at 54 captured points.');
        expect(milestone.copy.text).toMatch(/More than 60 of the 120 makes the bid — 7 to go/);
    });

    test('announces the made bid with the payout math', () => {
        const milestone = pointsMilestone(lingerState({
            // 33 + 10 banked, + 21 = 64: 4 past 60 x 2 (Solo) = 8 from each.
            capturedTricks: { Ann: [
                { cards: ['AS', 'AC', 'AD'] },
                { cards: ['KC', 'KD', 'JC'] },
                crossingTrick,
            ] },
        }), 'Me');
        expect(milestone.key).toMatch(/^milestone:made:/);
        expect(milestone.copy.strong).toBe('Ann is past 60 — the bid is made.');
        expect(milestone.copy.text).toMatch(/64 points is 4 past 60 × 2 \(Solo\) — that's 8 from each defender/);
    });

    test('announces the dead bid when the defending team reaches 60, as OUR team', () => {
        const milestone = pointsMilestone(lingerState({
            lastCompletedTrick: {
                winnerName: 'Me',
                cards: [
                    { playerName: 'Ann', card: '6S' },
                    { playerName: 'Me', card: 'AS' },
                    { playerName: 'Bea', card: '10S' },
                ],
            },
            // Me 20 banked + the 21-point trick, Bea 22: 42 before, 63 after.
            capturedTricks: {
                Me: [{ cards: ['10C', '10D', '6D'] }, { cards: ['AS', '10S', '6S'] }],
                Bea: [{ cards: ['AC', 'AD', '6C'] }],
            },
        }), 'Me');
        expect(milestone.key).toMatch(/^milestone:dead:/);
        expect(milestone.copy.strong).toBe('Your team hit 60 — the bid is dead.');
        expect(milestone.copy.text).toMatch(/Ann can't reach 61 now/);
    });

    test('stays quiet off the linger, below 50, and on pointless tricks', () => {
        expect(pointsMilestone(baseState(), 'Me')).toBeNull();
        expect(pointsMilestone(lingerState({
            capturedTricks: { Ann: [crossingTrick] }, // 21 total: no line crossed
        }), 'Me')).toBeNull();
        expect(pointsMilestone(lingerState({
            lastCompletedTrick: {
                winnerName: 'Ann',
                cards: [
                    { playerName: 'Ann', card: '9H' },
                    { playerName: 'Me', card: '8H' },
                    { playerName: 'Bea', card: '6H' },
                ],
            },
            // A big pile, but the trick itself is worth 0: nothing crossed NOW.
            capturedTricks: { Ann: [{ cards: ['AS', 'AC', 'AD'] }, { cards: ['9H', '8H', '6H'] }] },
        }), 'Me')).toBeNull();
    });

    test('tolerates the bare-array trick shape old fixtures use', () => {
        const milestone = pointsMilestone(lingerState({
            capturedTricks: { Ann: [
                [{ card: 'AS' }, { card: 'AC' }, { card: 'JD' }],
                [{ card: 'KD' }, { card: 'QD' }, { card: 'JC' }],
                [{ card: 'AH' }, { card: '10H' }, { card: '6H' }],
            ] },
        }), 'Me');
        expect(milestone.copy.strong).toBe('Ann is at 54 captured points.');
    });
});
