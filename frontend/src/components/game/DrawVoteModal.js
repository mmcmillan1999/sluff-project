// frontend/src/components/game/DrawVoteModal.js
import React, { useState, useEffect } from 'react';
import './DrawVoteModal.css';

const DrawVoteModal = ({ show, currentTableState, onVote, handleLeaveTable }) => {
    const { state, drawRequest, roundSummary } = currentTableState;
    const [declineCountdown, setDeclineCountdown] = useState(3);

    useEffect(() => {
        if (state === 'DrawDeclined') {
            setDeclineCountdown(3);
            const timer = setInterval(() => {
                setDeclineCountdown(prev => (prev > 1 ? prev - 1 : 1));
            }, 1000);
            return () => clearInterval(timer);
        }
    }, [state]);

    if (!show) return null;

    const getVoteStatus = (vote) => {
        if (!vote) return { text: 'Pending...', className: 'pending' };
        return { text: vote.toUpperCase(), className: vote.toLowerCase() };
    };

    const renderVotingContent = () => (
        <>
            <div className="draw-vote-main-area">
                <h2>Draw Requested</h2>
                <p className="draw-vote-message">
                    <strong>{drawRequest.initiator}</strong> has requested to end the game. All players must vote.
                </p>
                <div className="draw-vote-timer">{drawRequest.timer}s</div>
                <div className="draw-votes-list-container">
                    <h4>Current Votes</h4>
                    {Object.entries(drawRequest.votes).map(([name, vote]) => {
                        const status = getVoteStatus(vote);
                        return (
                            <div key={name} className="draw-vote-item">
                                <span>{name}</span>
                                <span className={`vote-status ${status.className}`}>{status.text}</span>
                            </div>
                        );
                    })}
                </div>
            </div>
            <div className="draw-vote-action-area">
                <p style={{ margin: '0 0 10px 0', fontWeight: 'bold' }}>Your Vote:</p>
                <div className="draw-vote-actions">
                    <button className="game-button" onClick={() => onVote('wash')} title="Everyone gets their buy-in back.">Wash</button>
                    <button className="game-button" style={{ backgroundColor: '#15803d' }} onClick={() => onVote('split')} title="Payouts are calculated based on score.">Split Pot</button>
                    <button className="game-button" style={{ backgroundColor: '#b91c1c' }} onClick={() => onVote('no')} title="Cancel the draw and resume the game.">Vote No</button>
                </div>
            </div>
        </>
    );

    const renderDeclinedContent = () => (
        <div className="draw-vote-main-area">
            <h2>Draw Declined</h2>
            <p className="draw-vote-message">A player has voted to continue the game.</p>
            <div className="draw-vote-timer">Returning to game in {declineCountdown}...</div>
        </div>
    );

    const renderCompleteContent = () => (
        <>
            <div className="draw-vote-main-area">
                <h2>Draw Succeeded!</h2>
                <p className="draw-vote-message">
                    The game has ended in a <strong>{roundSummary.drawOutcome}</strong>. Payouts are as follows:
                </p>
                {roundSummary?.payouts && (
                    <div className="draw-payout-section">
                        <ul className="draw-payout-list">
                            {Object.entries(roundSummary.payouts).map(([pName, details]) => (
                                <li key={pName}>
                                    <strong>{pName}:</strong> Received {details.totalReturn.toFixed(2)} tokens
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>
            <div className="draw-vote-action-area">
                <button className="game-button" onClick={handleLeaveTable}>Exit to Lobby</button>
            </div>
        </>
    );
    
    let content;
    if (state === 'DrawDeclined') {
        content = renderDeclinedContent();
    } else if (state === 'DrawComplete') {
        content = renderCompleteContent();
    } else {
        content = renderVotingContent();
    }

    return (
        <div className="draw-vote-modal-overlay">
            <div className="draw-vote-modal-content">
                {content}
            </div>
        </div>
    );
};

export default DrawVoteModal;