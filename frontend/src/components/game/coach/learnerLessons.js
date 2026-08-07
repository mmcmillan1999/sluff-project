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

// Manual override from the game menu: veterans can summon the helper,
// learners can silence it. Unset = automatic by games played.
const HELPER_KEY = 'sluff_card_helper';

export const getCardHelperOverride = () => {
    try {
        const value = window.localStorage.getItem(HELPER_KEY);
        return value === 'on' || value === 'off' ? value : null;
    } catch {
        return null;
    }
};

export const setCardHelperOverride = (value) => {
    try {
        if (value === 'on' || value === 'off') window.localStorage.setItem(HELPER_KEY, value);
        else window.localStorage.removeItem(HELPER_KEY);
    } catch { /* private browsing: session state stands */ }
};

export const cardHelperActive = (tutorialState) => {
    const override = getCardHelperOverride();
    if (override) return override === 'on';
    return isLearner(tutorialState);
};

/**
 * The every-trick post-mortem (not receipts-gated): who took the trick and
 * why, in one line, anchored to the winner. Shown for the whole learner
 * game so the game's logic narrates itself.
 */
export function explainTrick(currentTableState) {
    if (currentTableState?.state !== 'TrickCompleteLinger') return null;
    const { lastCompletedTrick, trumpSuit } = currentTableState;
    const plays = lastCompletedTrick?.cards;
    if (!plays?.length) return null;
    const winnerName = lastCompletedTrick.winnerName;
    const winnerPlay = plays.find(play => play.playerName === winnerName);
    if (!winnerPlay) return null;

    const winnerSuit = suitOf(winnerPlay.card);
    const ledSuit = suitOf(plays[0].card);
    let reason;
    if (winnerSuit === trumpSuit && ledSuit !== trumpSuit) {
        // Playing trump on an off-suit lead is only legal when void, so the
        // narrator can teach the must-trump rule from the play itself.
        reason = `no ${suitName(ledSuit)} left, so the rules said play trump — and trump beats the led suit`;
    } else if (winnerSuit === trumpSuit) {
        reason = `highest trump (${suitName(trumpSuit)})`;
    } else {
        reason = `highest ${suitName(ledSuit).replace(/s$/, '')}`;
    }
    const points = plays.reduce((sum, play) => sum + cardPoints(play.card), 0);
    return {
        key: `${winnerName}:${plays.map(play => play.card).join('-')}`,
        anchor: `[data-seat-player="${winnerName}"]`,
        text: `${winnerName} takes it — ${reason}${points > 0 ? ` (+${points} pts)` : ''}`,
    };
}

// Captured-pile totals, tolerant of both trick shapes on the wire: the
// server sends { cards: ['AH', ...] }, older fixtures a bare [{ card }].
const trickCardList = (trick) => (Array.isArray(trick) ? trick : trick?.cards || [])
    .map(entry => (typeof entry === 'string' ? entry : entry?.card))
    .filter(Boolean);

const pileTotal = (capturedTricks, names) => names.reduce((sum, name) => (
    sum + (capturedTricks?.[name] || []).reduce((trickSum, trick) => (
        trickSum + trickCardList(trick).reduce((cardSum, card) => cardSum + cardPoints(card), 0)
    ), 0)
), 0);

const BID_MULTIPLIERS = { Frog: 1, Solo: 2, 'Heart Solo': 3 };

/**
 * The running-score milestones (not receipts-gated, once per crossing):
 * a side closing on break-even at 50, the bidder clinching past 60 with
 * the payout math, the defenders killing the bid at 60. Announced on the
 * linger of the trick that crossed the line — captured piles are visible
 * public state, so this teaches WHY the round is being fought over 60.
 * Hidden points (a Frog bidder's discards) can only delay an
 * announcement, never make one wrong.
 */
export function pointsMilestone(currentTableState, selfPlayerName) {
    if (currentTableState?.state !== 'TrickCompleteLinger') return null;
    const { bidWinnerInfo, capturedTricks, lastCompletedTrick, playerOrderActive } = currentTableState;
    const winnerName = lastCompletedTrick?.winnerName;
    if (!bidWinnerInfo || !winnerName) return null;

    const bidderName = bidWinnerInfo.playerName;
    const defenderNames = (playerOrderActive || []).filter(name => name !== bidderName);
    const trickCards = trickCardList(lastCompletedTrick);
    const trickPoints = trickCards.reduce((sum, card) => sum + cardPoints(card), 0);
    if (trickPoints === 0) return null; // a pointless trick cannot cross a line

    const winnerIsBidder = winnerName === bidderName;
    const sideNames = winnerIsBidder ? [bidderName] : defenderNames;
    const after = pileTotal(capturedTricks, sideNames);
    const before = after - trickPoints;
    const selfOnSide = sideNames.includes(selfPlayerName);
    const keyFor = (kind) => `milestone:${kind}:${winnerName}:${trickCards.join('-')}`;

    if (winnerIsBidder && before <= 60 && after > 60) {
        const multiplier = BID_MULTIPLIERS[bidWinnerInfo.bid] || 1;
        const past = after - 60;
        return {
            key: keyFor('made'),
            anchor: `[data-seat-player="${winnerName}"]`,
            copy: {
                strong: selfOnSide
                    ? `You're past 60 — the bid is made.`
                    : `${bidderName} is past 60 — the bid is made.`,
                text: `${after} points is ${past} past 60 × ${multiplier} (${bidWinnerInfo.bid}) — that's ${past * multiplier} from each defender already, and every extra point pays ${multiplier} more.`,
            },
        };
    }

    if (!winnerIsBidder && before < 60 && after >= 60) {
        return {
            key: keyFor('dead'),
            anchor: `[data-seat-player="${winnerName}"]`,
            copy: {
                strong: selfOnSide
                    ? 'Your team hit 60 — the bid is dead.'
                    : 'The defenders hit 60 — the bid is dead.',
                text: `${bidderName} can't reach 61 now and pays each defender — and every extra defender point raises the bill.`,
            },
        };
    }

    if (before < 50 && after >= 50 && (winnerIsBidder ? after <= 60 : after < 60)) {
        return {
            key: keyFor('close'),
            anchor: `[data-seat-player="${winnerName}"]`,
            copy: winnerIsBidder
                ? {
                    strong: selfOnSide
                        ? `You're at ${after} captured points.`
                        : `${bidderName} is at ${after} captured points.`,
                    text: `More than 60 of the 120 makes the bid — ${61 - after} to go.`,
                }
                : {
                    strong: selfOnSide
                        ? `Your team is at ${after} points.`
                        : `The defenders are at ${after} points.`,
                    text: `At 60 the bid is dead — ${60 - after} to go.`,
                },
        };
    }

    return null;
}

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

    // --- The round's shape: one bidder ALONE against a defending team ---
    // Playing Phase only: at Bid Announcement the VS splash owns the same
    // screen region as the bidder-seat anchor.
    const bidWinnerInfo = currentTableState.bidWinnerInfo;
    if (bidWinnerInfo
        && state === 'Playing Phase'
        && !seen.has('learner-teams-2026-08')) {
        const bidderName = bidWinnerInfo.playerName;
        const partner = (currentTableState.playerOrderActive || [])
            .find(name => name !== bidderName && name !== selfPlayerName);
        const iAmBidder = bidderName === selfPlayerName;
        const trumpLabel = suitName(trumpSuit);
        const trumpCapitalized = `${trumpLabel[0].toUpperCase()}${trumpLabel.slice(1)}`;
        return {
            id: 'learner-teams-2026-08',
            anchor: `[data-seat-player="${bidderName}"]`,
            side: 'top',
            spotlight: true,
            copy: iAmBidder
                ? {
                    strong: 'You play alone this round.',
                    text: `The other two defend against you as a team. ${trumpCapitalized} are your trump — they beat every other suit. Capture more than 60 of the 120 card points and you win.`,
                }
                : {
                    strong: `${bidderName} plays alone.`,
                    text: `You and ${partner || 'your fellow defender'} are a TEAM this round — your captured points count together. ${trumpCapitalized} are trump: they beat every other suit. Hold the bidder to 60 or less.`,
                },
        };
    }

    // --- The moment cards first hit the felt: the loop and the numbers ---
    if (state === 'Playing Phase' && !seen.has('learner-card-points-2026-08')) {
        return {
            id: 'learner-card-points-2026-08',
            anchor: '.player-hand-container',
            side: 'top',
            spotlight: true,
            copy: {
                strong: 'Each turn, everyone throws one card — the highest takes all three.',
                text: 'The little numbers are what those cards are worth: Aces 11 and tens 10 are the big boys; kings, queens, and jacks are small change. Each round is a fight over 120 points.',
            },
        };
    }

    // --- The trump lock: leading is restricted until trump is broken ----
    const isMyLead = state === 'Playing Phase'
        && trickTurnPlayerName === selfPlayerName
        && currentTrickCards.length === 0;
    if (isMyLead && currentTableState.trumpBroken === false
        && hand.some(card => suitOf(card) === trumpSuit)
        && hand.some(card => suitOf(card) !== trumpSuit)
        && !seen.has('learner-trump-lock-2026-08')) {
        return {
            id: 'learner-trump-lock-2026-08',
            anchor: '.player-hand-container',
            side: 'top',
            copy: {
                strong: 'Trump can\'t lead yet.',
                text: `Your ${suitName(trumpSuit)} stay locked until someone trumps a trick — open with another suit.`,
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

    // --- Insurance: it's optional, and silence is a legal answer --------
    if (state === 'Playing Phase'
        && currentTableState.insurance?.isActive
        && !currentTableState.insurance?.dealExecuted
        && !seen.has('learner-insurance-2026-08')) {
        return {
            id: 'learner-insurance-2026-08',
            anchor: '.insurance-controls-container',
            side: 'top',
            spotlight: true,
            copy: {
                strong: 'Optional side deal.',
                text: 'Ignore it and the cards decide the round as normal. If everyone agrees on numbers instead, those numbers replace the card result.',
            },
        };
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
                        text: 'Every captured trick feeds the count on its trick pile. First team past 60 wins the round.',
                    },
                };
            }
        }
    }

    return null;
}
