import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { PLACEHOLDER_ID_CLIENT } from '../../constants';
import { useModalFocus } from '../../hooks/useModalFocus';
import './RoundScoreCeremony.css';

const EMPTY_ARRAY = Object.freeze([]);
const EMPTY_OBJECT = Object.freeze({});

export const ROUND_SCORE_CEREMONY_SOUNDS = Object.freeze({
    // Existing short effects keep this slice integration-ready without adding
    // a second audio loader: cardPlay is the light count tick, trickWin the ding.
    tick: 'cardPlay',
    ding: 'trickWin'
});

export const ROUND_SCORE_CEREMONY_TIMING = Object.freeze({
    INTRO_MS: 300,
    DEFAULT_PLAYER_SLOT_MS: 650,
    PLAYER_COUNTING_MS: 500,
    MAX_SEQUENCE_MS: 2800,
    SETTLE_MS: 450,
    MAX_TICKS_PER_PLAYER: 6,
    // Every generated plan completes within this ceiling, regardless of score
    // size or the number of supplied rows.
    MAX_TOTAL_MS: 3550
});

const toFiniteNumber = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
};

const roundScore = value => Math.round((value + Number.EPSILON) * 100) / 100;

export const formatCeremonyScore = (value) => {
    const rounded = roundScore(toFiniteNumber(value));
    return Number.isInteger(rounded)
        ? String(rounded)
        : rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
};

export const formatCeremonyDelta = value => {
    const number = toFiniteNumber(value);
    if (number > 0) return `+${formatCeremonyScore(number)}`;
    return formatCeremonyScore(number);
};

const playerNameFromEntry = (entry) => {
    if (typeof entry === 'string') return entry.trim();
    if (!entry || typeof entry !== 'object') return '';
    const candidate = entry.playerName ?? entry.name;
    return typeof candidate === 'string' ? candidate.trim() : '';
};

/**
 * Produces the ceremony rows in table order, then appends any score entries
 * omitted from that order (such as a sitting-out four-player dealer).
 */
export const buildRoundScoreRows = ({
    finalScores = EMPTY_OBJECT,
    pointChanges = EMPTY_OBJECT,
    playerOrder = EMPTY_ARRAY
} = {}) => {
    const safeFinalScores = finalScores && typeof finalScores === 'object' ? finalScores : EMPTY_OBJECT;
    const safePointChanges = pointChanges && typeof pointChanges === 'object' ? pointChanges : EMPTY_OBJECT;
    const safePlayerOrder = Array.isArray(playerOrder) ? playerOrder : EMPTY_ARRAY;
    const orderedNames = [
        ...safePlayerOrder.map(playerNameFromEntry),
        ...Object.keys(safeFinalScores),
        ...Object.keys(safePointChanges)
    ];
    const seen = new Set();

    return orderedNames
        .filter(name => {
            if (!name || name === PLACEHOLDER_ID_CLIENT || seen.has(name)) return false;
            seen.add(name);
            return true;
        })
        .map(name => {
            const finalScore = toFiniteNumber(safeFinalScores[name]);
            const pointChange = toFiniteNumber(safePointChanges[name]);
            return {
                name,
                finalScore,
                pointChange,
                previousScore: roundScore(finalScore - pointChange)
            };
        });
};

export const createRoundScoreCeremonyPlan = (playerCount) => {
    const count = Math.max(0, Math.floor(toFiniteNumber(playerCount)));
    if (count === 0) {
        return { playerSlotMs: 0, countingMs: 0, completionMs: 0 };
    }

    const playerSlotMs = Math.min(
        ROUND_SCORE_CEREMONY_TIMING.DEFAULT_PLAYER_SLOT_MS,
        ROUND_SCORE_CEREMONY_TIMING.MAX_SEQUENCE_MS / count
    );
    const countingMs = Math.min(
        ROUND_SCORE_CEREMONY_TIMING.PLAYER_COUNTING_MS,
        playerSlotMs * 0.78
    );
    const completionMs = ROUND_SCORE_CEREMONY_TIMING.INTRO_MS
        + ((count - 1) * playerSlotMs)
        + countingMs
        + ROUND_SCORE_CEREMONY_TIMING.SETTLE_MS;

    return { playerSlotMs, countingMs, completionMs };
};

const readSystemReducedMotion = () => (
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
);

const useCeremonyReducedMotion = (override) => {
    const [systemPreference, setSystemPreference] = useState(readSystemReducedMotion);

    useEffect(() => {
        if (typeof override === 'boolean' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
            return undefined;
        }
        const query = window.matchMedia('(prefers-reduced-motion: reduce)');
        const handleChange = event => setSystemPreference(event.matches);
        setSystemPreference(query.matches);
        if (query.addEventListener) query.addEventListener('change', handleChange);
        else query.addListener?.(handleChange);
        return () => {
            if (query.removeEventListener) query.removeEventListener('change', handleChange);
            else query.removeListener?.(handleChange);
        };
    }, [override]);

    return typeof override === 'boolean' ? override : systemPreference;
};

const totalsFromRows = (rows, key) => Object.fromEntries(
    rows.map(row => [row.name, row[key]])
);

/**
 * Portrait-first score reveal intended to mount after the round recap.
 *
 * onComplete receives { skipped, rows }; skipping still completes the ceremony
 * contract so an integrating parent has one reliable exit path.
 */
const RoundScoreCeremony = ({
    finalScores,
    pointChanges,
    playerOrder,
    playSound,
    onComplete,
    onSkip,
    prefersReducedMotion,
    soundNames = ROUND_SCORE_CEREMONY_SOUNDS,
    title = 'Round totals'
}) => {
    const headingId = useId();
    const candidateRows = buildRoundScoreRows({
        finalScores,
        pointChanges,
        playerOrder
    });
    const rowsSignature = JSON.stringify(candidateRows);
    const rowsCacheRef = useRef(null);
    if (rowsCacheRef.current?.signature !== rowsSignature) {
        rowsCacheRef.current = { signature: rowsSignature, rows: candidateRows };
    }
    const rows = rowsCacheRef.current.rows;
    const plan = useMemo(() => createRoundScoreCeremonyPlan(rows.length), [rows.length]);
    const reducedMotion = useCeremonyReducedMotion(prefersReducedMotion);
    const [displayTotals, setDisplayTotals] = useState(() => totalsFromRows(rows, 'previousScore'));
    const [revealedNames, setRevealedNames] = useState(() => new Set());
    const [settledNames, setSettledNames] = useState(() => new Set());
    const [activeName, setActiveName] = useState(null);
    const [complete, setComplete] = useState(false);
    const [announcement, setAnnouncement] = useState('Preparing score updates.');
    const timersRef = useRef(new Set());
    const ceremonyRef = useModalFocus(true, 'button:not(:disabled)');
    const completedRef = useRef(false);
    const callbacksRef = useRef({ playSound, onComplete, onSkip, soundNames });
    callbacksRef.current = { playSound, onComplete, onSkip, soundNames };

    const clearTimers = useCallback(() => {
        timersRef.current.forEach(timer => clearTimeout(timer));
        timersRef.current.clear();
    }, []);

    const schedule = useCallback((callback, delay) => {
        const timer = setTimeout(() => {
            timersRef.current.delete(timer);
            callback();
        }, Math.max(0, delay));
        timersRef.current.add(timer);
        return timer;
    }, []);

    const safelyPlay = useCallback((soundName) => {
        if (!soundName || typeof callbacksRef.current.playSound !== 'function') return;
        try {
            callbacksRef.current.playSound(soundName);
        } catch {
            // Audio is decorative; a callback failure must never strand the UI.
        }
    }, []);

    const finish = useCallback((skipped) => {
        if (completedRef.current) return;
        completedRef.current = true;
        clearTimers();
        setDisplayTotals(totalsFromRows(rows, 'finalScore'));
        setRevealedNames(new Set(rows.map(row => row.name)));
        setSettledNames(new Set(rows.map(row => row.name)));
        setActiveName(null);
        setComplete(true);
        setAnnouncement(rows.length > 0
            ? `Round scores updated. ${rows.map(row => `${row.name} ${formatCeremonyScore(row.finalScore)}`).join(', ')}.`
            : 'No round score changes to show.');
        callbacksRef.current.onComplete?.({ skipped, rows });
    }, [clearTimers, rows]);

    useEffect(() => {
        clearTimers();
        completedRef.current = false;
        setDisplayTotals(totalsFromRows(rows, 'previousScore'));
        setRevealedNames(new Set());
        setSettledNames(new Set());
        setActiveName(null);
        setComplete(false);
        setAnnouncement(rows.length > 0 ? 'Preparing score updates.' : 'No round score changes to show.');

        if (reducedMotion || rows.length === 0) {
            // Deferring one task makes this StrictMode-safe: its probe cleanup
            // cancels the first callback before the real mount completes.
            schedule(() => finish(false), 0);
            return clearTimers;
        }

        rows.forEach((row, index) => {
            const rowStartMs = ROUND_SCORE_CEREMONY_TIMING.INTRO_MS + (index * plan.playerSlotMs);
            schedule(() => {
                if (completedRef.current) return;
                setActiveName(row.name);
                setRevealedNames(previous => new Set(previous).add(row.name));
                setAnnouncement(
                    `${row.name} ${formatCeremonyDelta(row.pointChange)} points. New total ${formatCeremonyScore(row.finalScore)}.`
                );

                const magnitude = Math.abs(row.pointChange);
                if (magnitude === 0) {
                    setDisplayTotals(previous => ({ ...previous, [row.name]: row.finalScore }));
                    setSettledNames(previous => new Set(previous).add(row.name));
                    return;
                }

                const tickCount = Math.min(
                    ROUND_SCORE_CEREMONY_TIMING.MAX_TICKS_PER_PLAYER,
                    Math.max(1, Math.ceil(magnitude))
                );
                for (let step = 1; step <= tickCount; step += 1) {
                    schedule(() => {
                        if (completedRef.current) return;
                        const isFinalStep = step === tickCount;
                        const nextTotal = isFinalStep
                            ? row.finalScore
                            : roundScore(row.previousScore + ((row.pointChange * step) / tickCount));
                        setDisplayTotals(previous => ({ ...previous, [row.name]: nextTotal }));
                        if (isFinalStep) {
                            setSettledNames(previous => new Set(previous).add(row.name));
                            safelyPlay(callbacksRef.current.soundNames?.ding);
                        } else {
                            safelyPlay(callbacksRef.current.soundNames?.tick);
                        }
                    }, (plan.countingMs * step) / tickCount);
                }
            }, rowStartMs);
        });

        schedule(() => finish(false), plan.completionMs);
        return clearTimers;
    }, [clearTimers, finish, plan, reducedMotion, rows, safelyPlay, schedule]);

    const handleSkip = () => {
        if (completedRef.current) return;
        try {
            callbacksRef.current.onSkip?.();
        } finally {
            finish(true);
        }
    };

    return (
        <section
            ref={ceremonyRef}
            className={`round-score-ceremony${complete ? ' round-score-ceremony--complete' : ''}`}
            aria-labelledby={headingId}
            data-reduced-motion={reducedMotion ? 'true' : 'false'}
            tabIndex={-1}
        >
            <header className="round-score-ceremony__header">
                <span className="round-score-ceremony__eyebrow">Score ceremony</span>
                <h2 id={headingId}>{title}</h2>
                <p>Round points settle into the table totals.</p>
            </header>

            <div className="round-score-ceremony__score-heading" aria-hidden="true">
                <span>Player</span><span>Previous</span><span>Round</span><span>Total</span>
            </div>
            <ol className="round-score-ceremony__players">
                {rows.map(row => {
                    const revealed = reducedMotion || revealedNames.has(row.name);
                    const settled = reducedMotion || settledNames.has(row.name);
                    const classes = [
                        'round-score-ceremony__player',
                        revealed && 'is-revealed',
                        settled && 'is-settled',
                        activeName === row.name && !settled && 'is-active'
                    ].filter(Boolean).join(' ');
                    return (
                        <li className={classes} key={row.name}>
                            <span className="round-score-ceremony__name" title={row.name}>{row.name}</span>
                            <span className="round-score-ceremony__previous" aria-label={`${row.name} previous score ${formatCeremonyScore(row.previousScore)}`}>
                                {formatCeremonyScore(row.previousScore)}
                            </span>
                            <span
                                className={`round-score-ceremony__delta ${row.pointChange > 0 ? 'is-positive' : row.pointChange < 0 ? 'is-negative' : 'is-even'}`}
                                aria-hidden={!revealed}
                                aria-label={`${row.name} round change ${formatCeremonyDelta(row.pointChange)}`}
                            >
                                {formatCeremonyDelta(row.pointChange)}
                            </span>
                            <span className="round-score-ceremony__total" aria-label={`${row.name} score`}>
                                {formatCeremonyScore(reducedMotion
                                    ? row.finalScore
                                    : (displayTotals[row.name] ?? row.previousScore))}
                            </span>
                        </li>
                    );
                })}
            </ol>

            {rows.length === 0 && (
                <p className="round-score-ceremony__empty">No score changes to show.</p>
            )}

            <div className="round-score-ceremony__live" role="status" aria-live="polite" aria-atomic="true">
                {announcement}
            </div>

            {!complete && !reducedMotion && rows.length > 0 && (
                <button type="button" className="round-score-ceremony__skip" onClick={handleSkip}>
                    Skip animation
                </button>
            )}
        </section>
    );
};

export default RoundScoreCeremony;
