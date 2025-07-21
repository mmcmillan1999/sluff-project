// frontend/src/components/game/DrawVoteModal.js
import React from 'react';
import './RoundSummaryModal.css'; // Reuse the main modal styles
import './DrawVoteModal.css'; // Add our specific styles

const DrawVoteModal = ({ show, drawRequest, onVote }) => {
    if (!show || !drawRequest?.isActive) return null;

    const getVoteStatus = (vote) => {
        if (!vote) return { text: 'Pending...', className: 'pending' };
        return { text: vote.toUpperCase(), className: vote.toLowerCase() };
    };

    return (
        <div className="modal-overlay">
            <div className="summary-modal-content" style={{ maxWidth: '450px' }}>
                <div className="summary-main-area">
                    <h2>Draw Requested</h2>
                    <p className="summary-message">
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

                <div className="summary-action-area">
                    <p style={{ margin: '0 0 10px 0', fontWeight: 'bold' }}>Your Vote:</p>
                    <div className="game-over-actions">
                        <button className="game-button" onClick={() => onVote('wash')} title="Everyone gets their buy-in back.">
                            Wash
                        </button>
                        <button className="game-button" style={{ backgroundColor: '#15803d' }} onClick={() => onVote('split')} title="Payouts are calculated based on score.">
                            Split Pot
                        </button>
                        <button className="game-button" style={{ backgroundColor: '#b91c1c' }} onClick={() => onVote('no')} title="Cancel the draw and resume the game.">
                            Vote No
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default DrawVoteModal;