// frontend/src/components/game/coach/learnerLessons.js
//
// The learner-mode micro-lessons: pure decision logic, no rendering. Each
// lesson fires at the moment its rule is actually in play, anchored to the
// element it talks about, once per player (dismissals persist through the
// quick-tips receipts API — ids satisfy the backend TIP_ID_PATTERN).
//
// This is the Quick Play counterpart of the Academy's guided coach: the
// rank trap (10 beats K), the forced plays the UI otherwise enforces
// silently, and the card points the felt never used to explain.

import { CARD_POINT_VALUES } from '../../../constants';

const SUIT_NAMES = { S: 'spades', C: 'clubs', D: 'diamonds', H: 'hearts' };

const rank = (card) => String(card).slice(0, -1);
const suitOf = (card) => String(card).slice(-1);
const suitName = (suit) => SUIT_NAMES[suit] || 'that suit';
const cardPoints = (card) => CARD_POINT_VALUES[rank(card)] || 0;

export const LEARNER_GAMES = 3; // helpers retire after this many games

export const isLearner = (tutorialState) => (
    (Number(tutorialState?.gamesPlayed) || 0) < LEARNER_GAMES
);

/**
 * Choose the one lesson that applies right now, or null. `seen` is a Set of
 * already-dismissed lesson ids; the caller shows at most one at a time.
 * Every branch reads only public client state.
 */
export function pickLearnerLesson(currentTableState, selfPlayerName, seen) {
    if (!currentTableState || !selfPlayerName) return null;
    const {
        state,
        trumpSuit,
        currentTrickCards = [],
        leadSuitCurrentTrick,
        trickTurnPlayerName,
        lastCompletedTrick,
        playoutVote,
        drawRequest,
    } = currentTableState;
    if (playoutVote?.isActive || drawRequest?.isActive) return null;

    const hand = currentTableState.hands?.[selfPlayerName] || [];

    // --- The moment cards first hit the felt: what the numbers mean -----
    if (state === 'Playing Phase' && !seen.has('learner-card-points-2026-08')) {
        return {
            id: 'learner-card-points-2026-08',
            anchor: '.player-hand-container',
            side: 'top',
            spotlight: true,
            copy: {
                strong: 'The little numbers are card points.',
                text: 'Aces are 11 and tens are 10 — the big boys. Kings, queens, and jacks are small change. The rest are worth nothing. Each round is a fight over 120 points.',
            },
        };
    }

    // --- Forced plays, explained the moment the UI enforces them --------
    const isMyTurn = state === 'Playing Phase' && trickTurnPlayerName === selfPlayerName;
    const following = isMyTurn && currentTrickCards.length > 0 && leadSuitCurrentTrick;
    if (following) {
        const hasLeadSuit = hand.some(card => suitOf(card) === leadSuitCurrentTrick);
        const hasTrump = hand.some(card => suitOf(card) === trumpSuit);
        const hasOffSuit = hand.some(card => suitOf(card) !== leadSuitCurrentTrick);
        if (!hasLeadSuit && hasTrump && leadSuitCurrentTrick !== trumpSuit
            && hand.some(card => suitOf(card) !== trumpSuit)
            && !seen.has('learner-must-trump-2026-08')) {
            return {
                id: 'learner-must-trump-2026-08',
                anchor: '.player-hand-container',
                side: 'top',
                spotlight: true,
                copy: {
                    strong: `You're out of ${suitName(leadSuitCurrentTrick)}.`,
                    text: `The rules say you must play trump when you can't follow suit — that's why only your ${suitName(trumpSuit)} are lit.`,
                },
            };
        }
        if (hasLeadSuit && hasOffSuit && !seen.has('learner-follow-suit-2026-08')) {
            return {
                id: 'learner-follow-suit-2026-08',
                anchor: '.player-hand-container',
                side: 'top',
                copy: {
                    strong: `Follow ${suitName(leadSuitCurrentTrick)}.`,
                    text: 'Faded cards can\'t be played right now — you must follow the suit that was led while you still have one.',
                },
            };
        }
    }

    // --- Trick post-mortems: the linger becomes the teacher -------------
    if (state === 'TrickCompleteLinger' && lastCompletedTrick?.cards?.length) {
        const plays = lastCompletedTrick.cards;
        const winnerName = lastCompletedTrick.winnerName;
        const winnerPlay = plays.find(play => play.playerName === winnerName);
        if (winnerPlay) {
            const winnerCard = winnerPlay.card;
            const winnerSuit = suitOf(winnerCard);
            const winnerRank = rank(winnerCard);
            const anchor = `[data-seat-player="${winnerName}"]`;
            const ledSuit = suitOf(plays[0].card);

            if (winnerRank === '10'
                && plays.some(play => play !== winnerPlay && suitOf(play.card) === winnerSuit
                    && ['K', 'Q'].includes(rank(play.card)))
                && !seen.has('learner-ten-beats-king-2026-08')) {
                return {
                    id: 'learner-ten-beats-king-2026-08',
                    anchor,
                    side: 'top',
                    spotlight: true,
                    copy: {
                        strong: 'The 10 outranks the King.',
                        text: 'In Sluff the 10 is the second-highest card — only the Ace beats it. Card order, low to high: 6 7 8 9 J Q K 10 A.',
                    },
                };
            }
            if (winnerRank === 'A'
                && plays.some(play => play !== winnerPlay && suitOf(play.card) === winnerSuit && rank(play.card) === '10')
                && !seen.has('learner-ace-takes-ten-2026-08')) {
                return {
                    id: 'learner-ace-takes-ten-2026-08',
                    anchor,
                    side: 'top',
                    copy: {
                        strong: 'The Ace just took the 10.',
                        text: 'That\'s 21 card points on one trick — a 10 is only safe when its own Ace is out of the way.',
                    },
                };
            }
            if (winnerSuit === trumpSuit && ledSuit !== trumpSuit
                && !seen.has('learner-trump-wins-2026-08')) {
                return {
                    id: 'learner-trump-wins-2026-08',
                    anchor,
                    side: 'top',
                    copy: {
                        strong: `${suitName(trumpSuit)[0].toUpperCase()}${suitName(trumpSuit).slice(1)} are trump.`,
                        text: `Even a small trump beats every ${suitName(ledSuit)} — that's how this trick walked away.`,
                    },
                };
            }
            const trickPoints = plays.reduce((sum, play) => sum + cardPoints(play.card), 0);
            if (trickPoints >= 14 && !seen.has('learner-points-pile-2026-08')) {
                return {
                    id: 'learner-points-pile-2026-08',
                    anchor,
                    side: 'top',
                    copy: {
                        strong: `${trickPoints} card points just changed hands.`,
                        text: 'Every captured trick feeds its team\'s gold number. First past 60 decides the round.',
                    },
                };
            }
        }
    }

    return null;
}
