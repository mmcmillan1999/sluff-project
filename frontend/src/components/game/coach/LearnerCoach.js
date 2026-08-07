// frontend/src/components/game/coach/LearnerCoach.js
//
// The Quick Play learner coach: watches live table state, asks the lesson
// picker whether a teachable moment is on the felt, and shows at most ONE
// anchored callout at a time. Dismissals persist through the quick-tips
// receipts API (server-side per user) with the same per-account
// localStorage fallback the tips beacon uses, so every lesson is
// once-per-player. Mounted for learner-mode players only (fewer than three
// games); the Academy's guided coach is a separate, richer track.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import CoachCallout from './CoachCallout';
import { pickLearnerLesson, explainTrick } from './learnerLessons';
import { getSeenTips, markTipSeen } from '../../../services/api';

// Same storage shape as TipsBeacon: one receipts pool per account.
const storageKeyFor = (userId) => (userId ? `sluff_tips_seen:${userId}` : 'sluff_tips_seen');

const localSeenIds = (userId) => {
    try {
        const stored = JSON.parse(window.localStorage.getItem(storageKeyFor(userId)));
        return Array.isArray(stored) ? stored.filter(id => typeof id === 'string') : [];
    } catch {
        return [];
    }
};

const rememberLocally = (userId, tipId) => {
    try {
        window.localStorage.setItem(
            storageKeyFor(userId),
            JSON.stringify([...new Set([...localSeenIds(userId), tipId])]),
        );
    } catch {
        // Private browsing: the server row (or this session's state) stands.
    }
};

const LearnerCoach = ({ currentTableState, selfPlayerName, userId = null, active }) => {
    const [seen, setSeen] = useState(() => new Set(localSeenIds(userId)));
    const [receiptsLoaded, setReceiptsLoaded] = useState(false);
    const [lesson, setLesson] = useState(null);
    // A lesson that displayed long enough to be read counts as taught even
    // if its moment ends before the player taps × — but one that flashed
    // and immediately lost its anchor comes back another day.
    const shownAtRef = useRef(0);

    useEffect(() => {
        if (!active) return undefined;
        let cancelled = false;
        // Promise.resolve wrapper: a mocked or offline api may not return a
        // thenable; the local receipts still stand either way.
        Promise.resolve()
            .then(() => getSeenTips())
            .then(ids => {
                if (cancelled) return;
                if (Array.isArray(ids)) setSeen(previous => new Set([...previous, ...ids]));
                setReceiptsLoaded(true);
            })
            .catch(() => { if (!cancelled) setReceiptsLoaded(true); });
        return () => { cancelled = true; };
    }, [active]);

    useEffect(() => {
        if (!active || !receiptsLoaded || lesson) return;
        const next = pickLearnerLesson(currentTableState, selfPlayerName, seen);
        if (next) {
            shownAtRef.current = Date.now();
            setLesson(next);
        }
    }, [active, receiptsLoaded, lesson, seen, currentTableState, selfPlayerName]);

    const handleDismiss = useCallback(({ reason } = {}) => {
        setLesson(current => {
            if (!current) return null;
            const displayedMs = Date.now() - shownAtRef.current;
            const taught = reason !== 'anchor-gone' || displayedMs >= 2500;
            if (taught) {
                setSeen(previous => new Set([...previous, current.id]));
                rememberLocally(userId, current.id);
                Promise.resolve()
                    .then(() => markTipSeen(current.id))
                    .catch(() => { /* local receipt stands */ });
            }
            return null;
        });
    }, [userId]);

    // The every-trick narrator: who took it and why, each linger, no
    // receipts — the whole learner game explains itself. One-shot lessons
    // take the stage when both would speak.
    const explainer = active ? explainTrick(currentTableState) : null;
    const [spokenExplainerKey, setSpokenExplainerKey] = useState(null);

    if (!active) return null;

    if (lesson) {
        return (
            <CoachCallout
                anchor={lesson.anchor}
                side={lesson.side}
                spotlight={Boolean(lesson.spotlight)}
                autoDismissMs={9000}
                onDismiss={handleDismiss}
            >
                <strong>{lesson.copy.strong}</strong> {lesson.copy.text}
            </CoachCallout>
        );
    }

    if (explainer && explainer.key !== spokenExplainerKey) {
        return (
            <CoachCallout
                key={explainer.key}
                anchor={explainer.anchor}
                side="top"
                pointer="none"
                autoDismissMs={3400}
                onDismiss={() => setSpokenExplainerKey(explainer.key)}
            >
                {explainer.text}
            </CoachCallout>
        );
    }

    return null;
};

export default LearnerCoach;
