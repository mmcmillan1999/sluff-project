// frontend/src/components/game/DrawVoteModal.js
import React from 'react';
import './RoundSummaryModal.css'; // You can reuse the modal styles

const DrawVoteModal = ({ show, drawRequest, onVote, onClose }) => {
    if (!show || !drawRequest?.isActive) return null;

    return (
        <div className="modal-overlay">
            <div className="modal-content">
                <h2>Draw Requested</h2>
                <p><strong>{drawRequest.initiator}</strong> has requested to end the game.</p>
                <p>Time to vote: <strong>{drawRequest.timer}s</strong></p>
                
                <div className="draw-votes">
                    <p>Votes:</p>
                    <ul>
                        {Object.entries(drawRequest.votes).map(([name, vote]) => (
                            <li key={name}>
                                {name}: {vote ? <strong>{vote.toUpperCase()}</strong> : '...voting'}
                            </li>
                        ))}
                    </ul>
                </div>

                <div className="modal-actions" style={{ marginTop: '20px' }}>
                    <button className="game-button" onClick={() => onVote('wash')}>
                        Vote Wash (Return Buy-ins)
                    </button>
                    <button className="game-button" style={{ backgroundColor: '#1e40af' }} onClick={() => onVote('split')}>
                        Vote Split (Proportional Payout)
                    </button>
                    <button className="game-button" style={{ backgroundColor: '#991b1b' }} onClick={() => onVote('no')}>
                        Vote No (Resume Game)
                    </button>
                </div>
            </div>
        </div>
    );
};

export default DrawVoteModal;