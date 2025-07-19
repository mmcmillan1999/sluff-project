// frontend/src/components/game/RoundSummaryModal.js
import React, { useState } from 'react';
import './RoundSummaryModal.css';
// --- MODIFICATION: Import BID_MULTIPLIERS ---
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
        payouts,
        finalBidderPoints,
        finalDefenderPoints,
        pointChanges,
        widowPointsValue,
        bidType
    } = summaryData;
    
    const insuranceAgreement = insurance?.executedDetails?.agreement;
    
    const bidderName = bidWinnerInfo?.playerName || 'Bidder';
    const defenderNames = playerOrderActive?.filter(name => name !== bidderName) || ['Defenders'];

    const calculateCardPoints = (cards) => {
        if (!cards || cards.length === 0) return 0;
        return cards.reduce((sum, cardString) => {
            const rank = cardString.slice(0, -1);
            return sum + (CARD_POINT_VALUES[rank] || 0);
        }, 0);
    };

    // --- NEW: Calculations for the points breakdown text ---
    const rawDifference = Math.abs(finalBidderPoints - 60);
    const bidMultiplier = BID_MULTIPLIERS[bidType] || 1;
    const exchangeValue = rawDifference * bidMultiplier;

    const pointsPanelContent = (
        <div className="summary-points-section">
            <h4>Points Captured</h4>
            <PointsBreakdownBar
                bidderName={bidderName}
                bidderPoints={finalBidderPoints}
                defenderNames={defenderNames}
                defenderPoints={finalDefenderPoints}
            />
            {/* --- MODIFICATION: Replaced the old text with the new calculation breakdown --- */}
            <div className="point-calculation-recap">
                <span>Difference from Goal: <strong>{rawDifference}</strong> pts</span>
                <span className="recap-divider">Ã—</span>
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
        let trickCounter = 1;

        const bidderTotal = finalBidderPoints;
        const defenderTotal = finalDefenderPoints;
        
        return (
            <div className="trick-breakdown-details">
                <div className="team-trick-section">
                    <h4>Bidder Total ({bidderName}): {bidderTotal} pts</h4>
                     {Object.entries(allTricks).filter(([pName]) => pName === bidderName).flatMap(([_, tricks]) => tricks).map((trick, i) => (
                        <div key={`bidder-trick-${i}`} className="trick-detail-row">
                            <span className="trick-number">Trick {trickCounter++}:</span>
                            <span className="trick-cards">{trick.join(', ')}</span>
                            <span className="trick-points">({calculateCardPoints(trick)} pts)</span>
                        </div>
                    ))}
                    {widowPointsValue > 0 && (
                        <div className="trick-detail-row widow-row">
                            <span className="trick-number">Widow:</span>
                            <span className="trick-cards">{widowForReveal.join(', ')}</span>
                            <span className="trick-points">({widowPointsValue} pts)</span>
                        </div>
                    )}
                </div>
                <div className="team-trick-section">
                    <h4>Defender Total ({defenderNames.join(', ')}): {defenderTotal} pts</h4>
                     {Object.entries(allTricks).filter(([pName]) => pName !== bidderName).flatMap(([_, tricks]) => tricks).map((trick, i) => (
                        <div key={`defender-trick-${i}`} className="trick-detail-row">
                            <span className="trick-number">Trick {trickCounter++}:</span>
                            <span className="trick-cards">{trick.join(', ')}</span>
                            <span className="trick-points">({calculateCardPoints(trick)} pts)</span>
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    return (
        <div className="modal-overlay">
            <div className="summary-modal-content">
                <div className="summary-main-area">
                    <h2>{isGameOver ? "Game Over" : "Round Over"}</h2>
                    <p className="summary-message">{isGameOver ? `Winner: ${gameWinner}` : message}</p>

                    {summaryData.insuranceDealWasMade ? (
                        <div className="what-if-panel">
                            <h4 className="what-if-title">How Points Would Have Been Calculated</h4>
                            {pointsPanelContent}
                        </div>
                    ) : (
                        pointsPanelContent
                    )}
                    
                    {insuranceAgreement && (
                        <div className="insurance-deal-recap">
                            <h4 className="recap-title">Insurance Deal Recap</h4>
                            <p><strong>{insuranceAgreement.bidderPlayerName}</strong> (Bidder) asked for <strong>{insuranceAgreement.bidderRequirement}</strong> points.</p>
                            <ul>
                                {Object.entries(insuranceAgreement.defenderOffers).map(([name, offer]) => (
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
                        {payouts && (
                             <div className="forfeit-payout-section">
                                <h4>Forfeit Payouts:</h4>
                                <ul className="forfeit-payout-list">
                                    {Object.entries(payouts).map(([pName, details]) => (
                                        <li key={pName}>
                                            <strong>{pName}:</strong> Received {details.totalGain.toFixed(2)} tokens
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                </div>

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