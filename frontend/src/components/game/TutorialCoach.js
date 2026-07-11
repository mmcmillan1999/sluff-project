import React, { useEffect, useMemo, useRef, useState } from 'react';
import { TUTORIAL_VERSION, tutorialLessonStorageKey } from '../../config/tutorial';
import './TutorialCoach.css';

export const FIRST_GAME_TUTORIAL_VERSION = TUTORIAL_VERSION;

const PRESENTATION_COMPLETE_PHASES = new Set([
    'scoring',
    'score-settled-waiting',
    'settled',
    'podium'
]);

const readSeenLessons = (storageKey) => {
    try {
        const parsed = JSON.parse(window.localStorage.getItem(storageKey) || '[]');
        return new Set(Array.isArray(parsed) ? parsed.filter(value => typeof value === 'string') : []);
    } catch {
        return new Set();
    }
};

const writeSeenLessons = (storageKey, seenLessons) => {
    try {
        window.localStorage.setItem(storageKey, JSON.stringify([...seenLessons]));
    } catch {
        // Storage can be unavailable in private browsing or a locked-down webview.
        // The guide still works for the current mount; it simply cannot remember it.
    }
};

const samePlayer = (left, right) => (
    left !== undefined
    && left !== null
    && right !== undefined
    && right !== null
    && String(left) === String(right)
);

const buildCandidateLessons = ({ currentTableState, playerId, selfPlayerName, roundPresentationPhase }) => {
    const state = currentTableState?.state;
    const players = Object.values(currentTableState?.players || {});
    const seatedPlayers = players.filter(player => !player.isSpectator && !player.disconnected);
    const ownHand = currentTableState?.hands?.[selfPlayerName] || [];
    const isSelfTurn = currentTableState?.trickTurnPlayerName === selfPlayerName;
    const bidder = currentTableState?.bidWinnerInfo;
    const isBidder = samePlayer(bidder?.userId, playerId)
        || (selfPlayerName && bidder?.playerName === selfPlayerName);
    const candidates = [];

    if (
        currentTableState?.qpPhase === 'decision_pending'
        && seatedPlayers.length === 3
        && ['Waiting for Players', 'Ready to Start'].includes(state)
    ) {
        candidates.push({
            id: 'quickplay-decision',
            eyebrow: 'Guided game',
            title: 'Choose your table size',
            body: 'Start 3-Player gives the fullest first-game guide. Four-player is still your choice.',
            placement: 'top'
        });
    }

    if (state === 'Bidding Phase' && currentTableState?.biddingTurnPlayerName === selfPlayerName) {
        candidates.push({
            id: 'bidding',
            eyebrow: 'Bidding',
            title: 'Choose the risk you want',
            body: 'Pass is always available. Frog scores at 1×, Solo at 2×, and Heart Solo at 3×.',
            placement: 'top'
        });
    }

    if (state === 'Bid Announcement' && bidder) {
        candidates.push({
            id: 'round-role',
            eyebrow: isBidder ? 'You are the bidder' : 'You are defending',
            title: isBidder ? 'Get above 60' : `Hold ${bidder.playerName || 'the bidder'} below 60`,
            body: isBidder
                ? 'Your distance from 60 is multiplied by your bid. Exactly 60 is a wash.'
                : 'The bidder wants more than 60 card points. Exactly 60 is a wash.',
            placement: 'top'
        });
    }

    if (state === 'Playing Phase' && isSelfTurn && ownHand.length === 11) {
        candidates.push({
            id: 'first-flick',
            eyebrow: 'Your first play',
            title: 'Flick a legal card to the table',
            body: 'Lift, then deliberately flick or fling toward the center. Release gently if you change your mind and the card returns to your hand.',
            placement: 'top'
        });
    }

    if (state === 'Playing Phase' && isSelfTurn && ownHand.length > 0 && ownHand.length < 11) {
        candidates.push({
            id: 'follow-suit',
            eyebrow: 'Legal play',
            title: currentTableState?.leadSuitCurrentTrick
                ? 'Follow the led suit when you can'
                : 'You are leading this trick',
            body: currentTableState?.leadSuitCurrentTrick
                ? 'If you cannot follow suit, play trump when you have it. Only then may you sluff another suit.'
                : 'Trump cannot be led until it is broken, unless your hand contains only trump.',
            placement: 'top'
        });
    }

    if (
        state === 'Playing Phase'
        && currentTableState?.insurance?.isActive
        && !currentTableState.insurance.dealExecuted
        && !isSelfTurn
    ) {
        candidates.push({
            id: 'insurance',
            eyebrow: 'Insurance',
            title: 'A deal is optional',
            body: 'The bidder sets an ask and defenders set offers. Closing the deal gap locks that agreement in place of normal round scoring.',
            placement: 'top'
        });
    }

    return candidates;
};

const TutorialCoach = ({
    active = false,
    currentTableState,
    playerId,
    selfPlayerName,
    roundPresentationPhase = 'idle',
    onAction,
    tutorialVersion = FIRST_GAME_TUTORIAL_VERSION
}) => {
    const storageKey = tutorialLessonStorageKey(playerId, tutorialVersion);
    const [seenLessons, setSeenLessons] = useState(() => readSeenLessons(storageKey));
    const [visibleLessonId, setVisibleLessonId] = useState(null);
    const [sessionEnded, setSessionEnded] = useState(false);
    const [pendingAction, setPendingAction] = useState(null);
    const [actionError, setActionError] = useState(null);
    const previousStorageKeyRef = useRef(storageKey);
    const skipNextPersistenceRef = useRef(false);
    const completionRequestedRef = useRef(false);
    const actionInFlightRef = useRef(false);

    const candidateLessons = useMemo(() => buildCandidateLessons({
        currentTableState,
        playerId,
        selfPlayerName,
        roundPresentationPhase
    }), [currentTableState, playerId, selfPlayerName, roundPresentationPhase]);

    useEffect(() => {
        if (previousStorageKeyRef.current === storageKey) return;
        previousStorageKeyRef.current = storageKey;
        skipNextPersistenceRef.current = true;
        completionRequestedRef.current = false;
        setSeenLessons(readSeenLessons(storageKey));
        setVisibleLessonId(null);
        setSessionEnded(false);
        setPendingAction(null);
        setActionError(null);
        actionInFlightRef.current = false;
    }, [storageKey]);

    useEffect(() => {
        if (skipNextPersistenceRef.current) {
            skipNextPersistenceRef.current = false;
            return;
        }
        writeSeenLessons(storageKey, seenLessons);
    }, [seenLessons, storageKey]);

    useEffect(() => {
        if (!active || sessionEnded) {
            setVisibleLessonId(null);
            return;
        }

        const visibleStillApplies = candidateLessons.some(lesson => lesson.id === visibleLessonId);
        if (visibleLessonId && visibleStillApplies) return;
        if (visibleLessonId) {
            setVisibleLessonId(null);
            return;
        }

        const nextLesson = candidateLessons.find(lesson => !seenLessons.has(lesson.id));
        if (!nextLesson) return;

        // A lesson counts as seen when it is actually presented, not only when
        // dismissed. That keeps a reconnect from replaying the same coach card.
        setVisibleLessonId(nextLesson.id);
        setSeenLessons(previous => {
            if (previous.has(nextLesson.id)) return previous;
            const updated = new Set(previous);
            updated.add(nextLesson.id);
            return updated;
        });
    }, [active, candidateLessons, seenLessons, sessionEnded, visibleLessonId]);

    const persistTutorialAction = React.useCallback(async (action) => {
        if (actionInFlightRef.current) return false;

        actionInFlightRef.current = true;
        setPendingAction(action);
        setActionError(null);
        try {
            if (typeof onAction !== 'function') throw new Error('Tutorial persistence is unavailable.');
            await onAction(action);
            if (action === 'skip') {
                setSessionEnded(true);
                setVisibleLessonId(null);
            }
            return true;
        } catch (error) {
            setActionError({
                action,
                message: action === 'complete'
                    ? 'Your game is safe, but we could not save tutorial completion.'
                    : 'We could not save that choice, so tips are still on.'
            });
            return false;
        } finally {
            actionInFlightRef.current = false;
            setPendingAction(null);
        }
    }, [onAction]);

    useEffect(() => {
        if (
            !active
            || sessionEnded
            || completionRequestedRef.current
            || !currentTableState?.roundSummary
            || !PRESENTATION_COMPLETE_PHASES.has(roundPresentationPhase)
        ) return;

        // Completion waits until the player has continued past the recap. This
        // guarantees the scoring lesson is visible before App clears the guide.
        completionRequestedRef.current = true;
        void persistTutorialAction('complete');
    }, [
        active,
        currentTableState?.roundSummary,
        persistTutorialAction,
        roundPresentationPhase,
        sessionEnded
    ]);

    const visibleLesson = candidateLessons.find(lesson => lesson.id === visibleLessonId);
    const recoveryLesson = actionError ? {
        id: `${actionError.action}-persistence-error`,
        eyebrow: 'Connection problem',
        title: actionError.action === 'complete' ? 'Progress not saved yet' : 'Tips are still on',
        body: actionError.message,
        placement: 'top'
    } : null;
    const displayedLesson = recoveryLesson || visibleLesson;
    if (!active || sessionEnded || !displayedLesson) return null;
    const isFourPlayerTable = currentTableState?.playerMode === 4
        || currentTableState?.seatingOrder?.length === 4;
    const positionClass = isFourPlayerTable && displayedLesson.placement !== 'recap'
        ? ' tutorial-coach--four-player'
        : '';

    const retryPersistence = () => {
        if (!actionError) return;
        void persistTutorialAction(actionError.action);
    };

    return (
        <aside
            className={`tutorial-coach tutorial-coach--${displayedLesson.placement}${positionClass}`}
            aria-label="Guided game tip"
            data-lesson-id={displayedLesson.id}
        >
            <div className="tutorial-coach__card">
                <div className="tutorial-coach__copy" role="status" aria-live="polite" aria-atomic="true">
                    <span className="tutorial-coach__eyebrow">{displayedLesson.eyebrow}</span>
                    <h2>{displayedLesson.title}</h2>
                    <p>{displayedLesson.body}</p>
                </div>
                <div className="tutorial-coach__actions">
                    {actionError ? (
                        <button
                            type="button"
                            className="tutorial-coach__button tutorial-coach__button--primary"
                            onClick={retryPersistence}
                            disabled={pendingAction !== null}
                        >
                            {pendingAction ? 'Saving…' : 'Retry'}
                        </button>
                    ) : (
                        <>
                            <button
                                type="button"
                                className="tutorial-coach__button tutorial-coach__button--primary"
                                onClick={() => setVisibleLessonId(null)}
                                aria-label="Dismiss tutorial tip"
                                disabled={pendingAction !== null}
                            >
                                Got it
                            </button>
                            <button
                                type="button"
                                className="tutorial-coach__button tutorial-coach__button--quiet"
                                onClick={() => { void persistTutorialAction('skip'); }}
                                disabled={pendingAction !== null}
                            >
                                {pendingAction === 'skip' ? 'Saving…' : 'End tips'}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </aside>
    );
};

export default TutorialCoach;
