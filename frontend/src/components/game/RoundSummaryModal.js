// frontend/src/components/game/RoundSummaryModal.js
import React, { useCallback, useEffect, useRef, useState } from 'react';
import './RoundSummaryModal.css';
import { CARD_POINT_VALUES, BID_MULTIPLIERS, PLACEHOLDER_ID_CLIENT } from '../../constants';
import PointsBreakdownBar from './PointsBreakdownBar';
import ScoreChipTransferCeremony from './ScoreChipTransferCeremony';
import { useModalFocus } from '../../hooks/useModalFocus';
import {
    ROUND_RECAP_EXTENSION_MS,
    ROUND_RECAP_MAX_EXTENSIONS,
} from '../../config/endRoundTiming';

const SCORE_ACTION_TICK_MS = 100;

// Display-only grades for rounds where no insurance deal locked. This is pure
// recap math over the settled round payload; it never changes applied scores.
export const computeNoDealRecap = ({ bidderRequirement, defenderOffers, bidMultiplier, pointChanges, bidderName }) => {
    const offers = defenderOffers || {};
    const offerValues = Object.values(offers).map(value => Number(value) || 0);
    const offerSum = offerValues.reduce((sum, value) => sum + value, 0);
    const ask = Number(bidderRequirement) || 0;
    const actual = Number(pointChanges?.[bidderName]) || 0;

    // Everyone still on the server defaults means no position was taken.
    const neverNegotiated = Boolean(bidMultiplier)
        && ask === 120 * bidMultiplier
        && offerValues.length > 0
        && offerValues.every(value => value === -60 * bidMultiplier);

    let zone;
    if (actual < offerSum) zone = 'overreach';
    else if (actual >= ask) zone = 'lowball';
    else if (actual === offerSum) zone = 'match';
    else zone = 'gap';

    const header = {
        overreach: 'Bidder overreached.',
        lowball: 'Defenders lowballed.',
        match: 'Cards matched the offers.',
        gap: 'No one blinked.',
    }[zone];

    if (neverNegotiated) {
        return {
            neverNegotiated,
            offerSum,
            gap: ask - offerSum,
            ask,
            zone: null,
            header: null,
            rows: [],
        };
    }

    const grade = (value, positiveWord, negativeWord, evenWord) => (value === 0
        ? { text: evenWord, cls: 'verdict-muted' }
        : value > 0
            ? { text: `${positiveWord} ${value}`, cls: 'verdict-good' }
            : { text: `${negativeWord} ${-value}`, cls: 'verdict-bad' });

    let bidderVerdict;
    if (actual === 0 && offerSum === 0) {
        bidderVerdict = { text: 'Nice try', cls: 'verdict-muted' };
    } else if (ask < 0 || actual === offerSum) {
        bidderVerdict = grade(actual - ask, 'Lucky', 'Greedy', 'Perfect bid');
    } else {
        bidderVerdict = grade(actual - offerSum, 'Saved', 'Wasted', 'Perfect bid');
    }

    const rows = [{
        name: bidderName,
        posText: ask < 0 ? `Offered ${-ask}` : `Asked ${ask}`,
        verdict: bidderVerdict,
    }];
    for (const [name, rawOffer] of Object.entries(offers)) {
        const offer = Number(rawOffer) || 0;
        const change = Number(pointChanges?.[name]) || 0;
        rows.push({
            name,
            // A negative offer means the defender was demanding payment.
            posText: offer >= 0 ? `Offered ${offer}` : `Asked +${-offer}`,
            verdict: grade(change + offer, 'Lucky', 'Greedy', 'Perfect bid'),
        });
    }

    return { neverNegotiated, offerSum, gap: ask - offerSum, ask, zone, header, rows };
};

const finiteNumber = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : null;
};

const roundedRecapValue = (value) => {
    const rounded = Math.round(value * 100) / 100;
    return Object.is(rounded, -0) ? 0 : rounded;
};

// Display-only comparison for an executed insurance deal. Applied scores are
// compared with the authoritative card-only outcome that would have happened
// had the players declined the deal.
export const computeExecutedDealRecap = ({
    agreement,
    bidderName,
    defenderNames,
    pointChanges,
    cardPointChanges,
    insuranceHindsight,
    finalBidderPoints,
    bidMultiplier,
}) => {
    if (!agreement || typeof agreement !== 'object' || Array.isArray(agreement)) return null;

    const agreementBidder = typeof agreement.bidderPlayerName === 'string'
        && agreement.bidderPlayerName.trim()
        ? agreement.bidderPlayerName
        : bidderName;
    const offers = agreement.defenderOffers;
    if (!agreementBidder || !offers || typeof offers !== 'object' || Array.isArray(offers)) return null;

    const offerEntries = Object.entries(offers);
    if (offerEntries.length !== 2) return null;

    const orderedDefenders = [];
    for (const name of Array.isArray(defenderNames) ? defenderNames : []) {
        if (name !== agreementBidder
            && Object.prototype.hasOwnProperty.call(offers, name)
            && !orderedDefenders.includes(name)) {
            orderedDefenders.push(name);
        }
    }
    for (const [name] of offerEntries) {
        if (name !== agreementBidder && !orderedDefenders.includes(name)) {
            orderedDefenders.push(name);
        }
    }
    if (orderedDefenders.length !== 2) return null;

    const ask = finiteNumber(agreement.bidderRequirement);
    const normalizedOffers = {};
    for (const defenderName of orderedDefenders) {
        const offer = finiteNumber(offers[defenderName]);
        if (offer === null) return null;
        normalizedOffers[defenderName] = offer;
    }
    if (ask === null) return null;

    const participants = [agreementBidder, ...orderedDefenders];
    const dealOutcomes = {};
    for (const name of participants) {
        const outcome = finiteNumber(pointChanges?.[name]);
        if (outcome === null) return null;
        dealOutcomes[name] = outcome;
    }

    let cardOutcomes = null;
    if (participants.every(name => finiteNumber(cardPointChanges?.[name]) !== null)) {
        cardOutcomes = Object.fromEntries(participants.map(name => [
            name,
            finiteNumber(cardPointChanges[name]),
        ]));
    } else {
        // Compatibility for summaries created before cardPointChanges was
        // carried to the client. Three players are active in both table modes;
        // a failed bidder also pays the widow or sitting dealer's share.
        const bidderCardPoints = finiteNumber(finalBidderPoints);
        const multiplier = finiteNumber(bidMultiplier);
        if (bidderCardPoints !== null && multiplier !== null && multiplier > 0) {
            const exchange = Math.abs(bidderCardPoints - 60) * multiplier;
            cardOutcomes = {};
            if (bidderCardPoints > 60) {
                cardOutcomes[agreementBidder] = exchange * 2;
                orderedDefenders.forEach(name => { cardOutcomes[name] = -exchange; });
            } else if (bidderCardPoints < 60) {
                cardOutcomes[agreementBidder] = -(exchange * 3);
                orderedDefenders.forEach(name => { cardOutcomes[name] = exchange; });
            } else {
                participants.forEach(name => { cardOutcomes[name] = 0; });
            }
        } else if (participants.every(name => finiteNumber(insuranceHindsight?.[name]?.hindsightValue) !== null)) {
            cardOutcomes = Object.fromEntries(participants.map(name => [
                name,
                dealOutcomes[name] - finiteNumber(insuranceHindsight[name].hindsightValue),
            ]));
        }
    }
    if (!cardOutcomes) return null;

    const grade = (difference) => {
        const value = roundedRecapValue(difference);
        if (value > 0) return { text: `Saved ${value}`, cls: 'verdict-good' };
        if (value < 0) return { text: `Wasted ${-value}`, cls: 'verdict-bad' };
        return { text: 'Broke even', cls: 'verdict-muted' };
    };

    const offerSum = roundedRecapValue(Object.values(normalizedOffers)
        .reduce((sum, offer) => sum + offer, 0));
    const recordedSettlement = finiteNumber(agreement.bidderSettlement);
    const settlement = recordedSettlement === null ? offerSum : recordedSettlement;

    const rows = participants.map((name) => {
        const isBidder = name === agreementBidder;
        const stanceValue = isBidder ? ask : normalizedOffers[name];
        const dealOutcome = roundedRecapValue(dealOutcomes[name]);
        const cardOutcome = roundedRecapValue(cardOutcomes[name]);
        return {
            name,
            posText: isBidder
                ? (stanceValue < 0 ? `Offered ${-stanceValue}` : `Asked ${stanceValue}`)
                : (stanceValue < 0 ? `Asked +${-stanceValue}` : `Offered ${stanceValue}`),
            dealOutcome,
            cardOutcome,
            verdict: grade(dealOutcome - cardOutcome),
        };
    });

    return {
        bidderName: agreementBidder,
        defenderNames: orderedDefenders,
        settlement: roundedRecapValue(settlement),
        rows,
    };
};

const RoundSummaryModal = ({
    summaryData,
    showModal,
    renderCard,
    emitEvent,
    insurance,
    bidWinnerInfo,
    playerOrderActive,
    handleLeaveTable,
    handleLogout,
    showScoreTotals = true,
    title,
    continueLabel = 'Continue',
    scoreActionLabel,
    onContinue,
    scoreStage = 'complete',
    playerOrder,
    tableId,
    playSound,
    onScoreFrame,
    onScoreComplete,
    prefersReducedMotion,
    tutorialHint = null,
    scoreActionTimerMs = null,
    actionTimerKey = null
}) => {
    const [detailsVisible, setDetailsVisible] = useState(false);
    const initialActionTimerMs = Number(scoreActionTimerMs);
    const hasScoreActionTimer = Number.isFinite(initialActionTimerMs)
        && initialActionTimerMs > 0;
    const timedActionActive = Boolean(
        showModal
        && summaryData
        && onContinue
        && scoreStage === 'preview'
        && hasScoreActionTimer
    );
    const timerSessionKey = timedActionActive
        ? String(actionTimerKey ?? 'active-score-action')
        : null;
    const [actionDeadline, setActionDeadline] = useState(null);
    const [actionDeadlineSessionKey, setActionDeadlineSessionKey] = useState(null);
    const [actionAllocatedMs, setActionAllocatedMs] = useState(
        hasScoreActionTimer ? initialActionTimerMs : 0
    );
    const [actionRemainingMs, setActionRemainingMs] = useState(
        hasScoreActionTimer ? initialActionTimerMs : 0
    );
    const [actionExtensionsUsed, setActionExtensionsUsed] = useState(0);
    const onContinueRef = useRef(onContinue);
    const actionSubmittedRef = useRef(false);
    const dialogRef = useModalFocus(
        showModal,
        '.summary-continue-button, .summary-action-area button:not(:disabled)'
    );

    useEffect(() => {
        onContinueRef.current = onContinue;
    }, [onContinue]);

    const submitTimedAction = useCallback(() => {
        if (actionSubmittedRef.current) return;
        actionSubmittedRef.current = true;
        setActionRemainingMs(0);
        onContinueRef.current?.();
    }, []);

    useEffect(() => {
        if (timerSessionKey === null) {
            setActionDeadline(null);
            setActionDeadlineSessionKey(null);
            return undefined;
        }

        const deadline = Date.now() + initialActionTimerMs;
        actionSubmittedRef.current = false;
        setActionDeadline(deadline);
        setActionDeadlineSessionKey(timerSessionKey);
        setActionAllocatedMs(initialActionTimerMs);
        setActionRemainingMs(initialActionTimerMs);
        setActionExtensionsUsed(0);

        return undefined;
    }, [initialActionTimerMs, timerSessionKey]);

    useEffect(() => {
        if (timerSessionKey === null
            || actionDeadlineSessionKey !== timerSessionKey
            || !Number.isFinite(actionDeadline)) {
            return undefined;
        }

        const updateTimer = () => {
            const remaining = Math.max(0, actionDeadline - Date.now());
            setActionRemainingMs(remaining);
            if (remaining === 0) submitTimedAction();
        };

        updateTimer();
        const timer = setInterval(updateTimer, SCORE_ACTION_TICK_MS);
        return () => clearInterval(timer);
    }, [actionDeadline, actionDeadlineSessionKey, submitTimedAction, timerSessionKey]);

    const extendTimedAction = () => {
        if (!timedActionActive
            || actionSubmittedRef.current
            || actionExtensionsUsed >= ROUND_RECAP_MAX_EXTENSIONS) {
            return;
        }

        setActionDeadline(current => (
            Number.isFinite(current)
                ? current + ROUND_RECAP_EXTENSION_MS
                : Date.now() + ROUND_RECAP_EXTENSION_MS
        ));
        setActionAllocatedMs(current => current + ROUND_RECAP_EXTENSION_MS);
        setActionRemainingMs(current => current + ROUND_RECAP_EXTENSION_MS);
        setActionExtensionsUsed(current => Math.min(
            ROUND_RECAP_MAX_EXTENSIONS,
            current + 1
        ));
    };

    useEffect(() => {
        if (!showModal || scoreStage === 'counting') {
            setDetailsVisible(false);
        }
    }, [scoreStage, showModal]);

    if (!showModal || !summaryData) {
        return null;
    }

    const {
        isGameOver,
        gameWinner,
        message,
        forfeit,
        widowForReveal,
        insuranceHindsight,
        allTricks,
        finalBidderPoints,
        finalDefenderPoints,
        pointChanges,
        cardPointChanges,
        widowPointsValue,
        bidType,
        drawOutcome,
        lastCompletedTrick,
        insuranceDealWasMade,
        insuranceDetails,
        finalScores
    } = summaryData;

    const modalTitle = title || (isGameOver ? 'Game Over' : 'Round Over');
    const normalizedScoreStage = scoreStage === 'preview' || scoreStage === 'counting'
        ? scoreStage
        : 'complete';
    const tutorialHintPanel = tutorialHint ? (
        <aside className="summary-tutorial-hint" role="status" aria-live="polite">
            <span>{tutorialHint.eyebrow}</span>
            <strong>{tutorialHint.title}</strong>
            <p>{tutorialHint.body}</p>
        </aside>
    ) : null;

    if (isGameOver && forfeit) {
        const forfeitingPlayerName = forfeit.forfeitingPlayerName || 'A player';
        const reasonLabels = {
            'voluntary forfeit': 'Voluntary forfeit',
            'disconnect timeout': 'Disconnect timer expired'
        };
        const reasonLabel = reasonLabels[forfeit.reason] || forfeit.reason;
        const finalScoreEntries = Object.entries(finalScores || {})
            .filter(([name]) => name !== PLACEHOLDER_ID_CLIENT)
            .sort(([, leftScore], [, rightScore]) => Number(rightScore) - Number(leftScore));
        const standardMessage = `${forfeitingPlayerName} forfeited the game.`;

        return (
            <div className="modal-overlay">
                <div ref={dialogRef} className="summary-modal-content" role="dialog" aria-modal="true" aria-label={title || 'Game ended by forfeit'} tabIndex={-1}>
                    <div className="summary-main-area">
                        <h2>{title || 'Game Ended by Forfeit'}</h2>
                        {tutorialHintPanel}

                        <div className="forfeit-summary-panel">
                            <h3 className="forfeit-player"><strong>{forfeitingPlayerName}</strong> forfeited the game.</h3>
                            {reasonLabel && <p className="forfeit-reason">Reason: {reasonLabel}</p>}
                            {message && message !== standardMessage && <p className="forfeit-settlement-note">{message}</p>}
                            {gameWinner && gameWinner !== 'N/A' && gameWinner !== 'Forfeit' && (
                                <p className="forfeit-winner" aria-label={`Game winner: ${gameWinner}`}>Game winner: <strong>{gameWinner}</strong></p>
                            )}
                        </div>

                        {showScoreTotals && (
                            <div className="forfeit-scores-panel">
                                <h4>Final Scores</h4>
                                {finalScoreEntries.length > 0 ? (
                                    <table className="summary-totals-table forfeit-scores-table">
                                        <thead>
                                            <tr><th>Player</th><th>Score</th></tr>
                                        </thead>
                                        <tbody>
                                            {finalScoreEntries.map(([name, score]) => (
                                                <tr key={name}><td><strong>{name}</strong></td><td>{score}</td></tr>
                                            ))}
                                        </tbody>
                                    </table>
                                ) : (
                                    <p>Final scores are unavailable.</p>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="summary-action-area">
                        {onContinue ? (
                            <button type="button" onClick={onContinue} className="game-button summary-continue-button">
                                {continueLabel}
                            </button>
                        ) : (
                            <div className="game-over-actions">
                                <button onClick={() => emitEvent("resetGame")} className="game-button">Play Again</button>
                                <button onClick={handleLeaveTable} className="game-button" style={{backgroundColor: '#17a2b8'}}>Back to Lobby</button>
                                <button onClick={handleLogout} className="game-button" style={{backgroundColor: '#6c757d'}}>Logout</button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    }
    
    const summaryAgreement = insuranceDetails?.agreement
        && typeof insuranceDetails.agreement === 'object'
        ? insuranceDetails.agreement
        : null;
    const liveExecutedAgreement = insurance?.executedDetails?.agreement
        && typeof insurance.executedDetails.agreement === 'object'
        ? insurance.executedDetails.agreement
        : null;
    const liveAgreementFallback = insuranceDealWasMade
        && insurance?.defenderOffers
        && typeof insurance.defenderOffers === 'object'
        ? {
            bidderPlayerName: bidWinnerInfo?.playerName,
            bidderRequirement: insurance.bidderRequirement,
            defenderOffers: insurance.defenderOffers,
        }
        : null;
    // The settled summary wins over mutable live controls, especially after a
    // reconnect or a late table-state broadcast.
    const executedAgreement = summaryAgreement || liveExecutedAgreement || liveAgreementFallback;
    const bidderName = executedAgreement?.bidderPlayerName || bidWinnerInfo?.playerName || 'Bidder';
    const activeDefenderNames = Array.isArray(playerOrderActive)
        ? playerOrderActive.filter(name => name !== bidderName)
        : [];
    const agreementDefenderNames = executedAgreement?.defenderOffers
        && typeof executedAgreement.defenderOffers === 'object'
        ? Object.keys(executedAgreement.defenderOffers).filter(name => name !== bidderName)
        : [];
    const defenderNames = activeDefenderNames.length > 0
        ? activeDefenderNames
        : (agreementDefenderNames.length > 0 ? agreementDefenderNames : ['Defenders']);

    const calculateCardPoints = (cards) => {
        if (!cards || cards.length === 0) return 0;
        return cards.reduce((sum, cardString) => {
            const rank = cardString.slice(0, -1);
            return sum + (CARD_POINT_VALUES[rank] || 0);
        }, 0);
    };

    const rawDifference = Math.abs(finalBidderPoints - 60);
    const bidMultiplier = BID_MULTIPLIERS[bidType] || 1;
    const exchangeValue = rawDifference * bidMultiplier;

    const renderTotalsTable = (changes, totals, { concealTotals = false } = {}) => {
        // In four-player rounds the dealer sits out and therefore is absent from
        // playerOrderActive, but still has a score/change entry worth showing.
        const sortedPlayerNames = [...new Set([
            bidderName,
            ...defenderNames,
            ...Object.keys(changes || {}),
            ...Object.keys(totals || {})
        ])];
        return (
            <div className="summary-totals-panel">
                <table className="summary-totals-table">
                    <thead>
                        <tr>
                            <th>Player</th>
                            <th>Round</th>
                            <th>New Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        {sortedPlayerNames
                            .filter(name => name !== PLACEHOLDER_ID_CLIENT)
                            .map(name => {
                                const change = changes?.[name] || 0;
                                const isBidder = name === bidderName;
                                return (
                                    <tr key={name}>
                                        <td className={isBidder ? 'bidder-text' : 'defender-text'}><strong>{name}</strong></td>
                                        <td className={change > 0 ? 'positive' : (change < 0 ? 'negative' : '')}>
                                            {change > 0 ? `+${change}` : change}
                                        </td>
                                        <td
                                            className={concealTotals ? 'summary-total-pending' : undefined}
                                            aria-label={concealTotals
                                                ? `${name} new total is hidden until the score is counted`
                                                : `${name} new total ${totals?.[name] ?? 'unavailable'}`}
                                        >
                                            {concealTotals ? '—' : (totals?.[name] ?? '—')}
                                        </td>
                                    </tr>
                                );
                        })}
                        {/* The widow's share of a failed bid used to be hidden
                            here, making rounds look like points evaporated.
                            One muted row keeps the table netting to zero. */}
                        {(changes?.[PLACEHOLDER_ID_CLIENT] || 0) !== 0 && (
                            <tr className="widow-share-row">
                                <td><em>Widow</em></td>
                                <td className={changes[PLACEHOLDER_ID_CLIENT] > 0 ? 'positive' : 'negative'}>
                                    {changes[PLACEHOLDER_ID_CLIENT] > 0
                                        ? `+${changes[PLACEHOLDER_ID_CLIENT]}`
                                        : changes[PLACEHOLDER_ID_CLIENT]}
                                </td>
                                <td aria-label="The widow keeps no running total">—</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        );
    };

    const scoreRowsOrder = playerOrder || [bidderName, ...defenderNames];
    const renderScoreTotals = () => {
        if (!showScoreTotals) return null;
        return renderTotalsTable(pointChanges, finalScores, {
            concealTotals: normalizedScoreStage === 'preview'
        });
    };

    const scoreTransferTray = normalizedScoreStage === 'counting' && showScoreTotals ? (
        <ScoreChipTransferCeremony
            finalScores={finalScores}
            pointChanges={pointChanges}
            playerOrder={scoreRowsOrder}
            tableId={tableId}
            playSound={playSound}
            onScoreFrame={onScoreFrame}
            onComplete={onScoreComplete}
            prefersReducedMotion={prefersReducedMotion}
        />
    ) : null;

    // These panels are plain render helpers, not component types: defining a
    // component inside render would give it a new identity every re-render,
    // remounting the score ceremony and restarting its count
    // whenever a table-state broadcast lands mid-ceremony.
    const renderTrickPointRecapPanel = () => {
        const bidderWonPoints = pointChanges[bidderName] > 0;
        const panelClasses = ['summary-points-section'];
        if (!insuranceDealWasMade) {
            panelClasses.push(bidderWonPoints ? 'pulsating-gold' : 'pulsating-blue');
        }

        return (
            <div className={panelClasses.join(' ')}>
                <h4>Trick Point Recap</h4>
                <PointsBreakdownBar
                    bidderPoints={finalBidderPoints}
                    defenderPoints={finalDefenderPoints}
                />
                <div className="point-calculation-recap">
                    Δ60: {rawDifference} pts × {bidMultiplier}x ({bidType}) = {exchangeValue} pts
                </div>
                {!insuranceDealWasMade && renderScoreTotals()}
            </div>
        );
    };

    const renderInsuranceRecapPanel = () => {
        // No deal: the compact verdict panel (see computeNoDealRecap / the
        // Insurance Recap Spec artifact).
        if (!insuranceDealWasMade) {
            if (!insurance || !insurance.bidMultiplier) return null;

            const defenderEntries = insurance.defenderOffers
                && typeof insurance.defenderOffers === 'object'
                ? Object.entries(insurance.defenderOffers)
                : [];
            const scoredNames = [bidderName, ...defenderEntries.map(([name]) => name)];
            const hasCompleteInsuranceRecap = Number.isFinite(Number(insurance.bidMultiplier))
                && Number(insurance.bidMultiplier) > 0
                && insurance.bidderRequirement !== null
                && insurance.bidderRequirement !== undefined
                && Number.isFinite(Number(insurance.bidderRequirement))
                && defenderEntries.length === 2
                && defenderEntries.every(([, value]) => value !== null && Number.isFinite(Number(value)))
                && scoredNames.every(name => pointChanges?.[name] !== null
                    && pointChanges?.[name] !== undefined
                    && Number.isFinite(Number(pointChanges[name])));

            if (!hasCompleteInsuranceRecap) return null;

            const recap = computeNoDealRecap({
                bidderRequirement: insurance.bidderRequirement,
                defenderOffers: insurance.defenderOffers,
                bidMultiplier: insurance.bidMultiplier,
                pointChanges,
                bidderName,
            });

            return (
                <div className="insurance-recap-panel insurance-recap-panel--compact insurance-recap-panel--no-deal">
                    <h4>Insurance · No Deal</h4>
                    {recap.neverNegotiated ? (
                        <p className="insurance-no-negotiation">
                            No grade this round.
                        </p>
                    ) : (
                        <>
                            <p className="insurance-verdict-strip">
                                <strong>{recap.header}</strong>
                                <span className="insurance-verdict-numbers">
                                    ask {recap.ask} · offers {recap.offerSum} · gap {recap.gap}
                                </span>
                            </p>
                            <table className="insurance-verdict-table" aria-label="Insurance grades">
                                <thead>
                                    <tr>
                                        <th scope="col">Player</th>
                                        <th scope="col">Stance</th>
                                        <th scope="col">Grade</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {recap.rows.map(row => (
                                        <tr key={row.name}>
                                            <th scope="row" className="verdict-name" title={row.name}>{row.name}</th>
                                            <td className="verdict-pos">{row.posText}</td>
                                            <td className={`verdict-out ${row.verdict.cls}`}>{row.verdict.text}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </>
                    )}
                </div>
            );
        }

        const recap = computeExecutedDealRecap({
            agreement: executedAgreement,
            bidderName,
            defenderNames,
            pointChanges,
            cardPointChanges,
            insuranceHindsight,
            finalBidderPoints,
            bidMultiplier,
        });

        const recapDefenders = recap?.defenderNames || agreementDefenderNames;
        const trickParticipants = [recap?.bidderName || bidderName, ...recapDefenders];
        const hasTrickReference = Boolean(allTricks)
            && trickParticipants.length === 3
            && trickParticipants.every(name => Array.isArray(allTricks?.[name]));
        const bidderTricks = hasTrickReference
            ? allTricks[trickParticipants[0]].length
            : null;
        const defenderTricks = hasTrickReference
            ? trickParticipants.slice(1).reduce((total, name) => total + allTricks[name].length, 0)
            : null;
        const bidderCardPointReference = finiteNumber(finalBidderPoints);
        const defenderCardPointReference = finiteNumber(finalDefenderPoints);
        const hasCardPointReference = bidderCardPointReference !== null
            && defenderCardPointReference !== null;
        const bidderGainedPoints = Number(pointChanges?.[bidderName]) > 0;

        const panelClasses = [
            'insurance-recap-panel',
            'insurance-recap-panel--compact',
            'insurance-recap-panel--deal',
        ];
        panelClasses.push(bidderGainedPoints ? 'pulsating-gold' : 'pulsating-blue');

        return (
            <div className={panelClasses.join(' ')}>
                <h4>Insurance · Deal Executed</h4>
                {(recap || hasCardPointReference) && (
                    <p className="insurance-verdict-strip">
                        <strong>
                            {recap
                                ? `Deal ${recap.settlement > 0 ? '+' : ''}${recap.settlement}`
                                : 'Deal executed.'}
                        </strong>
                        {hasCardPointReference && (
                            <span
                                className="insurance-verdict-numbers"
                                aria-label={`Card points ${bidderCardPointReference} to ${defenderCardPointReference}${hasTrickReference ? `; tricks won ${bidderTricks} to ${defenderTricks}` : ''}`}
                            >
                                card points {bidderCardPointReference}–{defenderCardPointReference}
                                {hasTrickReference && ` · tricks ${bidderTricks}–${defenderTricks}`}
                            </span>
                        )}
                    </p>
                )}
                {recap && (
                    <table className="insurance-verdict-table" aria-label="Insurance deal grades">
                        <thead>
                            <tr>
                                <th scope="col">Player</th>
                                <th scope="col">Stance</th>
                                <th scope="col">Grade</th>
                            </tr>
                        </thead>
                        <tbody>
                            {recap.rows.map(row => (
                                <tr key={row.name}>
                                    <th scope="row" className="verdict-name" title={row.name}>{row.name}</th>
                                    <td className="verdict-pos">{row.posText}</td>
                                    <td className={`verdict-out ${row.verdict.cls}`}>{row.verdict.text}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
                {renderScoreTotals()}
            </div>
        );
    };
    
    const TrickDetailsPanel = () => {
        if (!allTricks) return null;
        const bidderWonWidow = (bidType === 'Frog') || (bidType === 'Solo') || ((bidType === 'Heart Solo') && lastCompletedTrick?.winnerName === bidderName);
        const widowRowJsx = (
            <div className="trick-detail-row widow-row">
                <span className="trick-number">Widow:</span>
                <div className="trick-cards">
                    {(widowForReveal || []).map((card, i) => renderCard(card, { key: `widow-${i}`, small: true }))}
                </div>
                <span className="trick-points">({widowPointsValue} pts)</span>
            </div>
        );
        const TrickRow = ({ trick }) => (
            <div key={`trick-${trick.trickNumber}`} className="trick-detail-row">
                <span className="trick-number">Trick {trick.trickNumber}:</span>
                <div className="trick-cards">
                    {trick.cards.map((card, i) => renderCard(card, { key: `trickcard-${trick.trickNumber}-${i}`, small: true }))}
                </div>
                <span className="trick-points">({calculateCardPoints(trick.cards)} pts)</span>
            </div>
        );
        const bidderTricks = allTricks[bidderName] || [];
        const defenderTricks = defenderNames.flatMap(name => allTricks[name] || []);
        return (
            <div className="trick-breakdown-details">
                <div className="team-trick-section">
                    <h4>{bidderName} (Bidder): {finalBidderPoints} pts</h4>
                     {bidderTricks.map(trick => <TrickRow key={trick.trickNumber} trick={trick} />)}
                    {bidderWonWidow && widowRowJsx}
                </div>
                <div className="team-trick-section">
                    <h4>{defenderNames.join(' & ')} (Defenders): {finalDefenderPoints} pts</h4>
                     {defenderTricks.map(trick => <TrickRow key={trick.trickNumber} trick={trick} />)}
                    {!bidderWonWidow && widowRowJsx}
                </div>
            </div>
        );
    };
    
    return (
        <div className={`modal-overlay summary-modal-overlay${normalizedScoreStage === 'counting' ? ' summary-modal-overlay--counting' : ''}`}>
            <div
                ref={dialogRef}
                className={`summary-modal-content${normalizedScoreStage === 'counting' ? ' summary-modal-content--counting' : ''}`}
                role="dialog"
                aria-modal="true"
                aria-label={modalTitle}
                tabIndex={-1}
            >
                <div className={`summary-main-area${normalizedScoreStage === 'counting' ? ' summary-main-area--counting' : ''}`}>
                    {normalizedScoreStage === 'counting' ? scoreTransferTray : (
                        <>
                            <h2>{modalTitle}</h2>
                            {tutorialHintPanel}
                            {isGameOver && message && message !== 'Game Over!' && (
                                <div className="settlement-status-banner" role="status">
                                    {message}
                                </div>
                            )}

                            {renderTrickPointRecapPanel()}
                            {!detailsVisible && renderInsuranceRecapPanel()}
                        </>
                    )}
                </div>

                {!drawOutcome && normalizedScoreStage !== 'counting' && (
                    <div className="summary-details-section">
                        <button className="details-toggle" onClick={() => setDetailsVisible(!detailsVisible)}>
                            {detailsVisible ? 'Hide Trick Breakdown' : 'Show Trick Breakdown'}
                        </button>
                        {detailsVisible && (
                            <div className="details-content">
                                 <div className="scrollable-tricks">
                                    <TrickDetailsPanel />
                                </div>
                            </div>
                        )}
                    </div>
                )}
                
                {normalizedScoreStage !== 'counting'
                    && (normalizedScoreStage === 'preview' || !onContinue)
                    && (onContinue || isGameOver) && (
                    <div className="summary-action-area">
                        {onContinue ? (
                            timedActionActive ? (
                                <div className="summary-timed-action-row">
                                    <button
                                        type="button"
                                        aria-label={scoreActionLabel || continueLabel}
                                        onClick={submitTimedAction}
                                        className="game-button summary-continue-button summary-timed-action"
                                        style={{
                                            '--summary-action-progress': Math.max(
                                                0,
                                                Math.min(
                                                    1,
                                                    actionAllocatedMs > 0
                                                        ? actionRemainingMs / actionAllocatedMs
                                                        : 0
                                                )
                                            )
                                        }}
                                    >
                                        <span className="summary-timed-action__fill" aria-hidden="true" />
                                        <span className="summary-timed-action__content">
                                            <span>{scoreActionLabel || continueLabel}</span>
                                            <span className="summary-timed-action__seconds" aria-hidden="true">
                                                {Math.max(0, Math.ceil(actionRemainingMs / 1000))}s
                                            </span>
                                        </span>
                                    </button>
                                    <button
                                        type="button"
                                        aria-label="+10 seconds"
                                        onClick={extendTimedAction}
                                        disabled={actionExtensionsUsed >= ROUND_RECAP_MAX_EXTENSIONS}
                                        className="game-button summary-time-extension-button"
                                    >
                                        +10s
                                    </button>
                                </div>
                            ) : (
                                <button type="button" onClick={onContinue} className="game-button summary-continue-button">
                                    {scoreActionLabel || continueLabel}
                                </button>
                            )
                        ) : (
                            <>
                                {isGameOver && (
                                    <div className="game-over-actions">
                                        <button onClick={() => emitEvent("resetGame")} className="game-button">
                                            Play Again
                                        </button>
                                        <button onClick={handleLeaveTable} className="game-button" style={{backgroundColor: '#17a2b8'}}>
                                            Back to Lobby
                                        </button>
                                        <button onClick={handleLogout} className="game-button" style={{backgroundColor: '#6c757d'}}>
                                            Logout
                                        </button>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default RoundSummaryModal;
