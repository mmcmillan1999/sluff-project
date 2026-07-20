import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { buildScoreTransferPlan } from './scoreTransferPlan';
import './ScoreChipTransferCeremony.css';

const SCORE_ABSORBER = 'ScoreAbsorber';
const EMPTY_OBJECT = Object.freeze({});
const EMPTY_ARRAY = Object.freeze([]);

export const SCORE_CHIP_TRANSFER_TIMING = Object.freeze({
    INTRO_MS: 180,
    FLIGHT_MS: 800,
    PAUSE_MS: 200,
    FINAL_SETTLE_MS: 900,
});

export const SCORE_CHIP_TRANSFER_SOUNDS = Object.freeze({
    launch: 'cardPlay',
    land: 'trickWin',
});

const roundScore = value => Math.round((value + Number.EPSILON) * 100) / 100;

const finiteNumber = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
};

const playerNameFromEntry = (entry) => {
    if (typeof entry === 'string') return entry.trim();
    if (!entry || typeof entry !== 'object') return '';
    const candidate = entry.playerName ?? entry.name;
    return typeof candidate === 'string' ? candidate.trim() : '';
};

const formatPoints = (value) => {
    const rounded = roundScore(Number(value) || 0);
    return Number.isInteger(rounded)
        ? String(rounded)
        : rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
};

const displayParticipant = name => (name === SCORE_ABSORBER ? 'Widow' : name);

const numericMap = (candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return {};
    return Object.fromEntries(Object.entries(candidate)
        .map(([name, value]) => [name, finiteNumber(value)])
        .filter(([name, value]) => Boolean(name) && value !== null));
};

const signatureValue = (value) => {
    if (typeof value === 'number' && Number.isNaN(value)) return 'number:NaN';
    if (typeof value === 'number' && !Number.isFinite(value)) return `number:${String(value)}`;
    return `${typeof value}:${String(value)}`;
};

const mapSignature = (candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        return signatureValue(candidate);
    }
    return Object.keys(candidate)
        .sort((left, right) => left.localeCompare(right))
        .map(name => [name, signatureValue(candidate[name])]);
};

/**
 * Build the immutable data used by one transfer run. Keeping this model behind
 * a value signature prevents equivalent terminal socket broadcasts from
 * restarting a ceremony that is already in flight.
 */
export const buildScoreTransferCeremonyModel = ({
    finalScores = EMPTY_OBJECT,
    pointChanges = EMPTY_OBJECT,
    playerOrder = EMPTY_ARRAY,
    tableId,
} = {}) => {
    const normalizedOrder = Array.isArray(playerOrder)
        ? playerOrder.map(playerNameFromEntry).filter(Boolean)
        : [];
    const safeFinalScores = numericMap(finalScores);
    const safePointChanges = numericMap(pointChanges);
    const plan = buildScoreTransferPlan({
        // Pass the original payload so malformed values remain malformed and
        // force a safe fast-forward in the planner.
        pointChanges,
        playerOrder: normalizedOrder,
    });
    const previousScores = Object.fromEntries(Object.entries(safeFinalScores).map(([name, score]) => [
        name,
        roundScore(score - (safePointChanges[name] || 0)),
    ]));
    const transferNames = new Set(plan.transfers.flatMap(transfer => [transfer.from, transfer.to]));
    const scoresComplete = [...transferNames].every(name => (
        Object.prototype.hasOwnProperty.call(safeFinalScores, name)
        && Object.prototype.hasOwnProperty.call(safePointChanges, name)
    ));
    const signature = JSON.stringify({
        tableId: tableId === null || tableId === undefined ? null : String(tableId),
        finalScores: mapSignature(finalScores),
        pointChanges: mapSignature(pointChanges),
        playerOrder: normalizedOrder,
    });

    return {
        signature,
        tableId,
        playerOrder: normalizedOrder,
        finalScores: safeFinalScores,
        previousScores,
        transfers: plan.transfers,
        balanced: plan.balanced,
        scoresComplete,
    };
};

const elementWithDatasetValue = (root, selector, datasetKey, expectedValue) => (
    [...root.querySelectorAll(selector)]
        .find(element => element.dataset?.[datasetKey] === expectedValue)
    || null
);

const findTransferTable = (tableId) => {
    if (typeof document === 'undefined') return null;
    const tables = [...document.querySelectorAll('[data-score-transfer-table]')];
    if (tableId === null || tableId === undefined) {
        return tables.length === 1 ? tables[0] : null;
    }
    const expectedId = String(tableId);
    return tables.find(table => table.dataset?.scoreTransferTable === expectedId) || null;
};

const findTransferPortalHost = (tableId) => {
    if (typeof document === 'undefined') return null;
    return findTransferTable(tableId)?.closest('.game-view') || document.body;
};

const centerOfElement = (element) => {
    try {
        const rect = element.getBoundingClientRect();
        const x = Number(rect.left) + (Number(rect.width) / 2);
        const y = Number(rect.top) + (Number(rect.height) / 2);
        return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
    } catch {
        return null;
    }
};

/**
 * Capture every source and destination before the first score callback can
 * resize a chip bank. Dataset iteration avoids selector escaping bugs in names
 * containing apostrophes, quotes, or punctuation.
 */
export const measureScoreTransferEndpoints = ({ tableId, transfers = EMPTY_ARRAY } = {}) => {
    const table = findTransferTable(tableId);
    if (!table) return null;

    const names = [...new Set(transfers.flatMap(transfer => [transfer.from, transfer.to]))];
    const endpoints = {};

    for (const name of names) {
        let anchor = null;
        if (name === SCORE_ABSORBER) {
            anchor = elementWithDatasetValue(
                table,
                '[data-score-transfer-anchor]',
                'scoreTransferAnchor',
                'widow',
            );
        } else {
            const bank = elementWithDatasetValue(
                table,
                '[data-score-chip-player]',
                'scoreChipPlayer',
                name,
            );
            anchor = bank?.querySelector('[data-score-chip-anchor]') || null;
        }

        const center = anchor ? centerOfElement(anchor) : null;
        if (!center) return null;
        endpoints[name] = center;
    }

    return endpoints;
};

const readSystemReducedMotion = () => (
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
);

const useReducedMotion = (override) => {
    const [systemPreference, setSystemPreference] = useState(readSystemReducedMotion);

    useEffect(() => {
        if (typeof override === 'boolean'
            || typeof window === 'undefined'
            || typeof window.matchMedia !== 'function') {
            return undefined;
        }
        const query = window.matchMedia('(prefers-reduced-motion: reduce)');
        const handleChange = event => setSystemPreference(event.matches);
        setSystemPreference(query.matches);
        query.addEventListener?.('change', handleChange);
        if (!query.addEventListener) query.addListener?.(handleChange);
        return () => {
            query.removeEventListener?.('change', handleChange);
            if (!query.removeEventListener) query.removeListener?.(handleChange);
        };
    }, [override]);

    return typeof override === 'boolean' ? override : systemPreference;
};

const initialView = Object.freeze({
    phase: 'preparing',
    transfer: null,
    transferIndex: 0,
    activeFlight: null,
    announcement: 'Preparing chip payments.',
});

const createFlight = (transfer, endpoints, index, portalHost) => {
    const from = endpoints[transfer.from];
    const to = endpoints[transfer.to];
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const arc = Math.min(96, Math.max(34, distance * 0.16));
    const direction = index % 2 === 0 ? -1 : 1;
    const midpoint = {
        x: ((from.x + to.x) / 2) + (direction * Math.min(22, distance * 0.04)),
        y: ((from.y + to.y) / 2) - arc,
    };
    const chipCount = 3 + ((Math.round(transfer.amount * 100) + index) % 3);

    return {
        ...transfer,
        fromPoint: from,
        midpoint,
        toPoint: to,
        chipCount,
        portalHost,
    };
};

const flightStyle = flight => ({
    '--chip-flight-ms': `${SCORE_CHIP_TRANSFER_TIMING.FLIGHT_MS}ms`,
    '--chip-from-x': `${flight.fromPoint.x}px`,
    '--chip-from-y': `${flight.fromPoint.y}px`,
    '--chip-mid-x': `${flight.midpoint.x}px`,
    '--chip-mid-y': `${flight.midpoint.y}px`,
    '--chip-to-x': `${flight.toPoint.x}px`,
    '--chip-to-y': `${flight.toPoint.y}px`,
});

const ScoreChipFlight = ({ flight }) => {
    if (!flight || typeof document === 'undefined' || !document.body) return null;

    return createPortal(
        <div
            key={flight.id}
            className="score-chip-flight"
            style={flightStyle(flight)}
            aria-hidden="true"
            data-transfer-id={flight.id}
        >
            <span className="score-chip-flight__bundle">
                {Array.from({ length: flight.chipCount }, (_, index) => (
                    <span
                        className={`score-chip-flight__chip score-chip-flight__chip--${(index % 3) + 1}`}
                        style={{
                            top: `${index * -0.12}rem`,
                            left: `${index * -0.12}rem`,
                        }}
                        key={index}
                    />
                ))}
                <strong className="score-chip-flight__amount">{formatPoints(flight.amount)}</strong>
            </span>
        </div>,
        flight.portalHost || document.body,
    );
};

const ScoreChipTransferCeremony = ({
    finalScores,
    pointChanges,
    playerOrder,
    tableId,
    playSound,
    onScoreFrame,
    onComplete,
    prefersReducedMotion,
}) => {
    const candidateModel = buildScoreTransferCeremonyModel({
        finalScores,
        pointChanges,
        playerOrder,
        tableId,
    });
    const modelCacheRef = useRef(null);
    if (modelCacheRef.current?.signature !== candidateModel.signature) {
        modelCacheRef.current = candidateModel;
    }
    const model = modelCacheRef.current;
    const reducedMotion = useReducedMotion(prefersReducedMotion);
    const [view, setView] = useState(initialView);
    const callbacksRef = useRef({ playSound, onScoreFrame, onComplete });
    callbacksRef.current = { playSound, onScoreFrame, onComplete };
    const currentRunRef = useRef(null);

    useEffect(() => {
        let mounted = true;
        let timerId = null;
        let finished = false;
        let lastFrameSignature = null;
        const workingScores = { ...model.previousScores };

        const clearTimer = () => {
            if (timerId !== null) {
                window.clearTimeout(timerId);
                timerId = null;
            }
        };

        const schedule = (callback, delay) => {
            clearTimer();
            timerId = window.setTimeout(() => {
                timerId = null;
                callback();
            }, Math.max(0, delay));
        };

        const emitFrame = (scores, phase, transfer = null) => {
            const snapshot = { ...scores };
            const frameSignature = JSON.stringify({
                scores: snapshot,
                phase,
                transferId: transfer?.id || null,
            });
            if (frameSignature === lastFrameSignature) return;
            lastFrameSignature = frameSignature;
            try {
                callbacksRef.current.onScoreFrame?.(snapshot, { phase, transfer });
            } catch {
                // A presentation callback must never strand authoritative scores.
            }
        };

        const safelyPlay = (soundName) => {
            try {
                callbacksRef.current.playSound?.(soundName);
            } catch {
                // Audio is decorative and cannot interrupt settlement.
            }
        };

        const finish = ({ skipped = false, reason = 'complete' } = {}) => {
            if (finished) return;
            finished = true;
            clearTimer();
            // Phase participates in frame de-duplication, so this terminal
            // contract is published even when the last arrival already has
            // the same authoritative score values.
            emitFrame(model.finalScores, 'complete');
            if (mounted) {
                setView({
                    phase: 'complete',
                    transfer: null,
                    transferIndex: model.transfers.length,
                    activeFlight: null,
                    announcement: 'Round points settled.',
                });
            }
            try {
                callbacksRef.current.onComplete?.({
                    skipped,
                    reason,
                    transfers: model.transfers,
                    balanced: model.balanced,
                });
            } catch {
                // The ceremony is already complete; callers own follow-up UI.
            }
        };

        const currentRun = { finish };
        currentRunRef.current = currentRun;

        const launchTransfer = (index, endpoints, portalHost) => {
            if (finished) return;
            const transfer = model.transfers[index];
            const fromLabel = displayParticipant(transfer.from);
            const toLabel = displayParticipant(transfer.to);
            workingScores[transfer.from] = roundScore(workingScores[transfer.from] - transfer.amount);
            emitFrame(workingScores, 'launch', transfer);
            safelyPlay(SCORE_CHIP_TRANSFER_SOUNDS.launch);
            const activeFlight = createFlight(transfer, endpoints, index, portalHost);
            if (mounted) {
                setView({
                    phase: 'flying',
                    transfer,
                    transferIndex: index,
                    activeFlight,
                    announcement: `${fromLabel} sends ${formatPoints(transfer.amount)} points to ${toLabel}.`,
                });
            }

            schedule(() => {
                if (finished) return;
                workingScores[transfer.to] = roundScore(workingScores[transfer.to] + transfer.amount);
                emitFrame(workingScores, 'arrival', transfer);
                safelyPlay(SCORE_CHIP_TRANSFER_SOUNDS.land);
                if (mounted) {
                    setView({
                        phase: 'landed',
                        transfer,
                        transferIndex: index,
                        activeFlight: null,
                        announcement: `${formatPoints(transfer.amount)} points arrived for ${toLabel}.`,
                    });
                }

                schedule(() => {
                    if (index + 1 < model.transfers.length) {
                        launchTransfer(index + 1, endpoints, portalHost);
                    } else {
                        finish();
                    }
                }, index + 1 < model.transfers.length
                    ? SCORE_CHIP_TRANSFER_TIMING.PAUSE_MS
                    : SCORE_CHIP_TRANSFER_TIMING.FINAL_SETTLE_MS);
            }, SCORE_CHIP_TRANSFER_TIMING.FLIGHT_MS);
        };

        const begin = () => {
            if (reducedMotion) {
                finish({ reason: 'reduced-motion' });
                return;
            }
            if (!model.balanced) {
                finish({ skipped: true, reason: 'unbalanced' });
                return;
            }
            if (model.transfers.length === 0) {
                finish({ reason: 'empty' });
                return;
            }
            if (!model.scoresComplete) {
                finish({ skipped: true, reason: 'invalid-scores' });
                return;
            }

            // Geometry must be frozen before the initial score snapshot can
            // shrink, grow, or otherwise reflow any bank.
            const endpoints = measureScoreTransferEndpoints({
                tableId: model.tableId,
                transfers: model.transfers,
            });
            if (!endpoints) {
                finish({ skipped: true, reason: 'missing-anchor' });
                return;
            }
            const portalHost = findTransferPortalHost(model.tableId);

            emitFrame(model.previousScores, 'initial');
            if (mounted) {
                setView({
                    ...initialView,
                    announcement: `${model.transfers.length} chip payment${model.transfers.length === 1 ? '' : 's'} ready.`,
                });
            }
            schedule(
                () => launchTransfer(0, endpoints, portalHost),
                SCORE_CHIP_TRANSFER_TIMING.INTRO_MS,
            );
        };

        const handleLayoutChange = () => finish({ skipped: true, reason: 'layout-change' });
        window.addEventListener('resize', handleLayoutChange);
        window.addEventListener('orientationchange', handleLayoutChange);
        // One deferred task prevents React StrictMode's probe mount from
        // emitting score frames or completion callbacks.
        schedule(begin, 0);

        return () => {
            mounted = false;
            clearTimer();
            window.removeEventListener('resize', handleLayoutChange);
            window.removeEventListener('orientationchange', handleLayoutChange);
            // An external unmount means a parent stage/table is already gone.
            // Clearing callbacks avoids stale score writes and StrictMode
            // probe completions; the authoritative socket score remains safe.
            if (currentRunRef.current === currentRun) currentRunRef.current = null;
        };
    }, [model, reducedMotion]);

    const handleSkip = () => {
        currentRunRef.current?.finish({ skipped: true, reason: 'skip' });
    };

    const currentTransfer = view.transfer;
    const totalTransfers = model.transfers.length;
    const transferNumber = Math.min(view.transferIndex + 1, totalTransfers);
    const fromLabel = currentTransfer ? displayParticipant(currentTransfer.from) : null;
    const toLabel = currentTransfer ? displayParticipant(currentTransfer.to) : null;
    const canSkip = view.phase !== 'complete' && !reducedMotion && totalTransfers > 0;

    return (
        <section
            className={`score-chip-transfer-ceremony score-chip-transfer-ceremony--${view.phase}`}
            aria-label="Settling round points"
            data-table-id={tableId}
            data-transfer-phase={view.phase}
        >
            <div className="score-chip-transfer-ceremony__copy">
                <span className="score-chip-transfer-ceremony__eyebrow">Table settlement</span>
                <h3>Settling round points</h3>
            </div>

            <div className="score-chip-transfer-ceremony__docket">
                {currentTransfer ? (
                    <>
                        <span className="score-chip-transfer-ceremony__route" title={`${fromLabel} to ${toLabel}`}>
                            <strong>{fromLabel}</strong>
                            <span aria-hidden="true">&rarr;</span>
                            <strong>{toLabel}</strong>
                        </span>
                        <span className="score-chip-transfer-ceremony__amount">
                            {formatPoints(currentTransfer.amount)} points
                        </span>
                    </>
                ) : (
                    <span className="score-chip-transfer-ceremony__route">
                        {view.phase === 'complete' ? 'All chips settled' : 'Preparing chip payments'}
                    </span>
                )}
                {totalTransfers > 0 && view.phase !== 'complete' && (
                    <small>Payment {transferNumber} of {totalTransfers}</small>
                )}
            </div>

            {canSkip && (
                <button
                    type="button"
                    className="score-chip-transfer-ceremony__skip"
                    onClick={handleSkip}
                >
                    Skip transfers
                </button>
            )}

            <div
                className="score-chip-transfer-ceremony__live"
                role="status"
                aria-live="polite"
                aria-atomic="true"
            >
                {view.announcement}
            </div>

            <ScoreChipFlight flight={view.activeFlight} />
        </section>
    );
};

export default ScoreChipTransferCeremony;
