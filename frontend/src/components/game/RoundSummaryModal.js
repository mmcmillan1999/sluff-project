// frontend/src/components/game/RoundSummaryModal.js
import React, { useCallback, useEffect, useRef, useState } from 'react';
import './RoundSummaryModal.css';
import { CARD_POINT_VALUES, BID_MULTIPLIERS, PLACEHOLDER_ID_CLIENT } from '../../constants';
import PointsBreakdownBar from './PointsBreakdownBar';
import RoundScoreCeremony from './RoundScoreCeremony';
import { useModalFocus } from '../../hooks/useModalFocus';
import {
    ROUND_RECAP_EXTENSION_MS,
    ROUND_RECAP_MAX_EXTENSIONS,
} from '../../config/endRoundTiming';

const SCORE_ACTION_TICK_MS = 100;

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
    playSound,
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
        if (timerSessionKey === null) return undefined;

        const deadline = Date.now() + initialActionTimerMs;
        actionSubmittedRef.current = false;
        setActionDeadline(deadline);
        setActionAllocatedMs(initialActionTimerMs);
        setActionRemainingMs(initialActionTimerMs);
        setActionExtensionsUsed(0);

        return undefined;
    }, [initialActionTimerMs, timerSessionKey]);

    useEffect(() => {
        if (timerSessionKey === null || !Number.isFinite(actionDeadline)) return undefined;

        const updateTimer = () => {
            const remaining = Math.max(0, actionDeadline - Date.now());
            setActionRemainingMs(remaining);
            if (remaining === 0) submitTimedAction();
        };

        updateTimer();
        const timer = setInterval(updateTimer, SCORE_ACTION_TICK_MS);
        return () => clearInterval(timer);
    }, [actionDeadline, submitTimedAction, timerSessionKey]);

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
        widowPointsValue,
        bidType,
        drawOutcome,
        lastCompletedTrick,
        insuranceDealWasMade,
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
    
    const bidderName = bidWinnerInfo?.playerName || 'Bidder';
    const defenderNames = playerOrderActive?.filter(name => name !== bidderName) || ['Defenders'];

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
                    </tbody>
                </table>
            </div>
        );
    };

    const scoreRowsOrder = playerOrder || [bidderName, ...defenderNames];
    const renderScoreTotals = () => {
        if (!showScoreTotals) return null;
        if (normalizedScoreStage === 'counting') {
            return (
                <div className="summary-totals-panel summary-totals-panel--counting">
                    <RoundScoreCeremony
                        embedded
                        finalScores={finalScores}
                        pointChanges={pointChanges}
                        playerOrder={scoreRowsOrder}
                        playSound={playSound}
                        onComplete={onScoreComplete}
                        prefersReducedMotion={prefersReducedMotion}
                        title="Counting round score"
                    />
                </div>
            );
        }
        return renderTotalsTable(pointChanges, finalScores, {
            concealTotals: normalizedScoreStage === 'preview'
        });
    };

    // These panels are plain render helpers, not component types: defining a
    // component inside render would give it a new identity every re-render,
    // remounting the embedded RoundScoreCeremony and restarting its count
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
        if (!insurance || !insurance.bidMultiplier) {
            // Settlement presentation must not depend on the live insurance
            // controls surviving a reconnect or late state refresh. The round
            // summary is authoritative, so always keep its score count mounted.
            return insuranceDealWasMade ? (
                <div className="insurance-recap-panel">
                    <h4>Insurance Deal Executed</h4>
                    {renderScoreTotals()}
                </div>
            ) : null;
        }
        
        const dealStatusText = insuranceDealWasMade ? "by taking deal" : "by not taking deal";
        const bidderGainedPoints = pointChanges[bidderName] > 0;

        const panelClasses = ['insurance-recap-panel'];
        if (insuranceDealWasMade) {
            panelClasses.push(bidderGainedPoints ? 'pulsating-gold' : 'pulsating-blue');
        }

        return (
            <div className={panelClasses.join(' ')}>
                <h4>{insuranceDealWasMade ? "Insurance Deal Executed" : "Insurance Recap (No Deal)"}</h4>
                <div className="insurance-narrative">
                    {Object.entries(insuranceHindsight || {}).map(([pName, data]) => {
                        const isBidder = pName === bidderName;
                        const actionText = isBidder ? `required ${insurance.bidderRequirement}` : `offered ${insurance.defenderOffers[pName]}`;
                        const outcomeValue = data.hindsightValue >= 0 ? data.hindsightValue : Math.abs(data.hindsightValue);
                        const outcomeWord = data.hindsightValue >= 0 ? "Saved" : "Wasted";
                        const outcomeClass = data.hindsightValue >= 0 ? "saved-text" : "wasted-text";
                        
                        return (
                            <p key={pName} className={isBidder ? 'bidder-text' : 'defender-text'}>
                                <strong>{pName}</strong> {actionText}, <strong className={outcomeClass}>{outcomeWord} {outcomeValue} pts</strong> {dealStatusText}.
                            </p>
                        );
                    })}
                </div>
                {insuranceDealWasMade && renderScoreTotals()}
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
        <div className="modal-overlay">
            <div ref={dialogRef} className="summary-modal-content" role="dialog" aria-modal="true" aria-label={modalTitle} tabIndex={-1}>
                <div className="summary-main-area">
                    <h2>{modalTitle}</h2>
                    {tutorialHintPanel}
                    {isGameOver && message && message !== 'Game Over!' && (
                        <div className="settlement-status-banner" role="status">
                            {message}
                        </div>
                    )}
                    
                    {renderTrickPointRecapPanel()}
                    {!detailsVisible && renderInsuranceRecapPanel()}

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
