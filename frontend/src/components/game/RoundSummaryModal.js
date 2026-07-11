// frontend/src/components/game/RoundSummaryModal.js
import React, { useEffect, useState } from 'react';
import './RoundSummaryModal.css';
import { CARD_POINT_VALUES, BID_MULTIPLIERS, PLACEHOLDER_ID_CLIENT } from '../../constants';
import PointsBreakdownBar from './PointsBreakdownBar';
import { useModalFocus } from '../../hooks/useModalFocus';

const RoundSummaryModal = ({
    summaryData,
    showModal,
    playerId,
    getPlayerNameByUserId,
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
    onContinue
}) => {
    const [detailsVisible, setDetailsVisible] = useState(false);
    const dialogRef = useModalFocus(
        showModal,
        '.summary-continue-button, .summary-action-area button:not(:disabled)'
    );

    useEffect(() => {
        if (!showModal) {
            setDetailsVisible(false);
        }
    }, [showModal]);

    if (!showModal || !summaryData) {
        return null;
    }

    const {
        isGameOver,
        gameWinner,
        message,
        forfeit,
        dealerOfRoundId,
        widowForReveal,
        insuranceHindsight,
        allTricks,
        finalBidderPoints,
        finalDefenderPoints,
        pointChanges,
        widowPointsValue,
        bidType,
        drawOutcome,
        payoutDetails,
        lastCompletedTrick,
        insuranceDealWasMade,
        finalScores
    } = summaryData;

    const myPayoutMessage = isGameOver && payoutDetails ? payoutDetails[playerId] : null;
    const modalTitle = title || (isGameOver ? 'Game Over' : 'Round Over');

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
                        {myPayoutMessage && (
                            <div className="payout-details-banner">
                                <p>{myPayoutMessage}</p>
                            </div>
                        )}

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

    const renderTotalsTable = (changes, totals) => {
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
                                        <td>{totals?.[name] ?? '—'}</td>
                                    </tr>
                                );
                        })}
                    </tbody>
                </table>
            </div>
        );
    };

    const TrickPointRecapPanel = () => {
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
                {!insuranceDealWasMade && showScoreTotals && renderTotalsTable(pointChanges, finalScores)}
            </div>
        );
    };

    const InsuranceRecapPanel = () => {
        if (!insurance || !insurance.bidMultiplier) return null;
        
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
                {insuranceDealWasMade && showScoreTotals && renderTotalsTable(pointChanges, finalScores)}
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
                    {myPayoutMessage && (
                        <div className="payout-details-banner">
                            <p>{myPayoutMessage}</p>
                        </div>
                    )}
                    {isGameOver && message && message !== 'Game Over!' && (
                        <div className="settlement-status-banner" role="status">
                            {message}
                        </div>
                    )}
                    
                    <TrickPointRecapPanel />
                    {!detailsVisible && <InsuranceRecapPanel />}

                </div>

                {!drawOutcome && (
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
                
                <div className="summary-action-area">
                    {onContinue ? (
                        <button type="button" onClick={onContinue} className="game-button summary-continue-button">
                            {continueLabel}
                        </button>
                    ) : (
                        <>
                            {!isGameOver && playerId === dealerOfRoundId && (
                                <button onClick={() => emitEvent("requestNextRound")} className="game-button">
                                    Start Next Round
                                </button>
                            )}
                            {!isGameOver && playerId !== dealerOfRoundId && (
                                <p>Waiting for {getPlayerNameByUserId(dealerOfRoundId)} to start the next round...</p>
                            )}
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
            </div>
        </div>
    );
};

export default RoundSummaryModal;
