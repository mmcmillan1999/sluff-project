// The learner-mode lesson picker: fires the right lesson at the right
// moment, one at a time, never twice, and only from public client state.

import { pickLearnerLesson, explainTrick, isLearner, LEARNER_GAMES } from './learnerLessons';

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
