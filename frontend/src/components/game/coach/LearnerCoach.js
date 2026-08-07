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
import { pickLearnerLesson, explainTrick, pointsMilestone } from './learnerLessons';
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

    // Score milestones (50 approaching, bid made past 60, bid dead at 60)
    // are read-and-confirm notes: a timed fade outran the reader (Matt), so
    // a milestone is PINNED — it outlives its linger and leaves only when
    // the player taps "Got it" or the next card hits the felt. They can
    // never re-fire, while a one-shot lesson simply re-arms at its next
    // moment.
    const milestone = active ? pointsMilestone(currentTableState, selfPlayerName) : null;
    const [stickyMilestone, setStickyMilestone] = useState(null);
    const [spokenMilestoneKey, setSpokenMilestoneKey] = useState(null);

    useEffect(() => {
        if (milestone
            && milestone.key !== spokenMilestoneKey
            && milestone.key !== stickyMilestone?.key) {
            setStickyMilestone(milestone);
        }
    }, [milestone, spokenMilestoneKey, stickyMilestone]);

    // Only the PLAYER's own play retires the note — bots playing under it
    // is fine (Matt's call); the reader sets the pace. Every trick includes
    // the player, so the note can never survive into the next linger.
    // Leaving the linger/play states entirely (round wrapped, vote struck)
    // retires it too — the note must never float over a recap.
    const tableState = currentTableState?.state;
    const selfPlayed = tableState === 'Playing Phase'
        && (currentTableState?.currentTrickCards || [])
            .some(play => play.playerName === selfPlayerName);
    const stickyStateValid = tableState === 'TrickCompleteLinger' || tableState === 'Playing Phase';
    useEffect(() => {
        if (stickyMilestone && (selfPlayed || !stickyStateValid)) {
            setSpokenMilestoneKey(stickyMilestone.key);
            setStickyMilestone(null);
        }
    }, [stickyMilestone, selfPlayed, stickyStateValid]);

    useEffect(() => {
        if (!active || !receiptsLoaded || lesson || stickyMilestone) return;
        const next = pickLearnerLesson(currentTableState, selfPlayerName, seen);
        if (next) {
            shownAtRef.current = Date.now();
            setLesson(next);
        }
    }, [active, receiptsLoaded, lesson, stickyMilestone, seen, currentTableState, selfPlayerName]);

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

    // "Your deal" call-up: with the turn nudge silenced for learners,
    // nothing else tells a new dealer the whole table is waiting on that
    // little button. Not receipts-gated — every deal, all three games.
    const [dealPromptHidden, setDealPromptHidden] = useState(false);
    const dealingPending = currentTableState?.state === 'Dealing Pending';
    useEffect(() => {
        if (!dealingPending) setDealPromptHidden(false);
    }, [dealingPending]);
    const selfIsDealer = dealingPending
        && Object.values(currentTableState?.players || {}).some(
            player => player.playerName === selfPlayerName
                && String(player.userId) === String(currentTableState.dealer),
        );

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

    if (selfIsDealer && !dealPromptHidden) {
        return (
            <CoachCallout
                anchor=".dealer-deck-action"
                side="top"
                autoDismissMs={0}
                onDismiss={() => setDealPromptHidden(true)}
            >
                <strong>Your deal.</strong> Tap the Deal button to send the cards out.
            </CoachCallout>
        );
    }

    if (stickyMilestone) {
        return (
            <CoachCallout
                key={stickyMilestone.key}
                anchor={stickyMilestone.anchor}
                side="top"
                autoDismissMs={0}
                acknowledgeLabel="Got it"
                onDismiss={() => {
                    setSpokenMilestoneKey(stickyMilestone.key);
                    // The plain "X takes it" line for the same trick must not
                    // pop up behind an acknowledged milestone.
                    if (explainer) setSpokenExplainerKey(explainer.key);
                    setStickyMilestone(null);
                }}
            >
                <strong>{stickyMilestone.copy.strong}</strong> {stickyMilestone.copy.text}
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
                autoDismissMs={4200}
                onDismiss={() => setSpokenExplainerKey(explainer.key)}
            >
                {explainer.text}
            </CoachCallout>
        );
    }

    return null;
};

export default LearnerCoach;
