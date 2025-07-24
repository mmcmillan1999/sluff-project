// frontend/src/components/game/RoundSummaryModal.js
import React, { useState } from 'react';
import './RoundSummaryModal.css';
import { CARD_POINT_VALUES, BID_MULTIPLIERS } from '../../constants';
import PointsBreakdownBar from './PointsBreakdownBar';

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
    handleLogout
}) => {
    const [detailsVisible, setDetailsVisible] = useState(false);

    if (!showModal || !summaryData) {
        return null;
    }

    const {
        message,
        finalScores,
        isGameOver,
        gameWinner,
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
        payouts,
        payoutDetails,
        lastCompletedTrick
    } = summaryData;
    
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

    const myPayoutMessage = isGameOver && payoutDetails ? payoutDetails[playerId] : null;

    const pointsPanelContent = (
        <div className="summary-points-section">
            <h4>Points Captured</h4>
            <PointsBreakdownBar
                bidderName={bidderName}
                bidderPoints={finalBidderPoints}
                defenderNames={defenderNames}
                defenderPoints={finalDefenderPoints}
            />
            <div className="point-calculation-recap">
                <span>Difference from Goal: <strong>{rawDifference}</strong> pts</span>
                <span className="recap-divider">×</span>
                <span className="recap-divider">×</span>
                <span>Bid Multiplier: <strong>{bidMultiplier}x</strong> ({bidType})</span>
                <span className="recap-divider">=</span>
                <span>Exchange Value: <strong>{exchangeValue}</strong> pts</span>
            </div>
            <div className="point-changes-list">
                {pointChanges && Object.entries(pointChanges).map(([name, change]) => (
                    name !== 'ScoreAbsorber' &&
                    <div key={name} className="point-change-item">
                        {name}: <span className={change > 0 ? 'positive' : 'negative'}>{change > 0 ? `+${change}` : change}</span>
                    </div>
                ))}
            </div>
        </div>
    );
    
    const renderTrickDetails = () => {
        if (!allTricks) return null;

        const bidderTotal = finalBidderPoints;
        const defenderTotal = finalDefenderPoints;

        const bidderWonWidow = 
            (bidType === 'Frog') || 
            ((bidType === 'Solo' || bidType === 'Heart Solo') && lastCompletedTrick?.winnerName === bidderName);

        const widowRowJsx = widowPointsValue > 0 ? (
            <div className="trick-detail-row widow-row">
                <span className="trick-number">Widow:</span>
                <div className="trick-cards" style={{ display: 'flex', gap: '2px', flexWrap: 'wrap', alignItems: 'center' }}>
                    {widowForReveal.map((card, i) => renderCard(card, { key: `widow-${i}`, small: true }))}
                </div>
                <span className="trick-points">({widowPointsValue} pts)</span>
            </div>
        ) : null;
        
        const TrickRow = ({ trick }) => (
            <div key={`trick-${trick.trickNumber}`} className="trick-detail-row">
                <span className="trick-number">Trick {trick.trickNumber}:</span>
                <div className="trick-cards" style={{ display: 'flex', gap: '2px', flexWrap: 'wrap', alignItems: 'center' }}>
                    {trick.cards.map((card, i) => renderCard(card, { key: `trickcard-${trick.trickNumber}-${i}`, small: true }))}
                </div>
                <span className="trick-points">({calculateCardPoints(trick.cards)} pts)</span>
            </div>
        );

        // --- THIS IS THE FIX: A much simpler and more robust way to get the tricks ---
        const bidderTricks = allTricks[bidderName] || [];
        const defenderTricks = defenderNames.flatMap(name => allTricks[name] || []);

        return (
            <div className="trick-breakdown-details">
                <div className="team-trick-section">
                    <h4>Bidder Total ({bidderName}): {bidderTotal} pts</h4>
                     {bidderTricks.map(trick => <TrickRow key={trick.trickNumber} trick={trick} />)}
                    {bidderWonWidow && widowRowJsx}
                </div>
                <div className="team-trick-section">
                    <h4>Defender Total ({defenderNames.join(', ')}): {defenderTotal} pts</h4>
                     {defenderTricks.map(trick => <TrickRow key={trick.trickNumber} trick={trick} />)}
                    {!bidderWonWidow && widowRowJsx}
                </div>
            </div>
        );
    };

    const renderMainContent = () => {
        if (drawOutcome) {
            return (
                <div className="summary-scores-container">
                    {payouts && (
                         <div className="forfeit-payout-section" style={{ backgroundColor: '#cfe2ff', borderColor: '#b6d4fe' }}>
                            <h4 style={{ color: '#0a58ca' }}>Draw Payouts ({drawOutcome}):</h4>
                            <ul className="forfeit-payout-list">
                                {Object.entries(payouts).map(([pName, details]) => (
                                    <li key={pName}>
                                        <strong>{pName}:</strong> Received {details.totalReturn.toFixed(2)} tokens
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            );
        }

        return (
            <>
                {summaryData.insuranceDealWasMade ? (
                    <div className="what-if-panel">
                        <h4 className="what-if-title">How Points Would Have Been Calculated</h4>
                        {pointsPanelContent}
                    </div>
                ) : (
                    pointsPanelContent
                )}
                
                {insurance && insurance.bidMultiplier && (
                    <div className="insurance-deal-recap">
                        <h4 className="recap-title">
                            {summaryData.insuranceDealWasMade ? "Insurance Deal Recap" : "Final Insurance State (No Deal)"}
                        </h4>
                        <p>
                            <strong>{insurance.bidderPlayerName}</strong> (Bidder) required <strong>{insurance.bidderRequirement}</strong> points.
                        </p>
                        <ul>
                            {Object.entries(insurance.defenderOffers).map(([name, offer]) => (
                                <li key={name}><strong>{name}</strong> offered <strong>{offer}</strong> points.</li>
                            ))}
                        </ul>
                    </div>
                )}
                
                {insuranceHindsight && (
                    <div className="insurance-hindsight">
                        <h4 className="hindsight-title">Insurance Hindsight</h4>
                         {Object.entries(insuranceHindsight).map(([pName, data]) => (
                            <p key={pName} className="hindsight-text">
                                <strong>{pName}:</strong> Your decision <strong>{data.hindsightValue >= 0 ? 'saved' : 'wasted'} {Math.abs(data.hindsightValue)}</strong> points.
                            </p>
                        ))}
                    </div>
                )}

                <div className="summary-scores-container">
                    <h4>Updated Scores</h4>
                    <ul className="summary-score-list">
                        {Object.entries(finalScores).map(([name, score]) => (
                           <li key={name}><strong>{name}:</strong> {score}</li>
                        ))}
                    </ul>
                </div>
            </>
        );
    };

    return (
        <div className="modal-overlay">
            <div className="summary-modal-content">
                <div className="summary-main-area">
                    <h2>{isGameOver ? "Game Over" : "Round Over"}</h2>
                    <p className="summary-message">{isGameOver ? `Winner: ${gameWinner}` : message}</p>
                    {myPayoutMessage && (
                        <div style={{ padding: '10px', backgroundColor: '#e0eafc', border: '1px solid #c4d5f5', borderRadius: '8px', marginBottom: '15px' }}>
                            <p style={{ margin: 0, fontWeight: 'bold', color: '#0d6efd' }}>{myPayoutMessage}</p>
                        </div>
                    )}
                    {renderMainContent()}
                </div>

                {!drawOutcome && (
                    <div className="summary-details-section">
                        <button className="details-toggle" onClick={() => setDetailsVisible(!detailsVisible)}>
                            {detailsVisible ? 'Hide Round Details' : 'Show Round Details'}
                        </button>
                        {detailsVisible && (
                            <div className="details-content">
                                <h4 style={{marginTop: '0px'}}>Trick Breakdown</h4>
                                 <div className="scrollable-tricks">
                                    {renderTrickDetails()}
                                </div>
                            </div>
                        )}
                    </div>
                )}
                
                <div className="summary-action-area">
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
                </div>
            </div>
        </div>
    );
};

export default RoundSummaryModal;