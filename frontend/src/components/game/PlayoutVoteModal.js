// frontend/src/components/game/PlayoutVoteModal.js
// The playout vote: an insurance deal just locked in the round's points,
// so the table decides whether to play the remaining tricks or head to the
// next round. One "play it out" keeps the round alive; unanimous "next
// round" (or the 30s timer) wraps it immediately.

import React from 'react';
import './PlayoutVoteModal.css';

const PlayoutVoteModal = ({ show, currentTableState, selfPlayerName, onVote }) => {
    if (!show || !currentTableState?.playoutVote?.isActive) return null;

    const { playoutVote } = currentTableState;
    const myVote = playoutVote.votes?.[selfPlayerName];
    const voteEntries = Object.entries(playoutVote.votes || {});
    const votedCount = voteEntries.filter(([, vote]) => vote !== null).length;

    return (
        <div className="playout-vote-overlay" role="dialog" aria-modal="true" aria-label="Deal struck">
            <div className="playout-vote-modal">
                <p className="playout-vote-eyebrow">Insurance</p>
                <h3 className="playout-vote-title">Deal Struck!</h3>
                <p className="playout-vote-copy">
                    The points for this round are locked in. Play out the
                    remaining tricks for fun, or head straight to the next round?
                </p>
                {myVote === null || myVote === undefined ? (
                    <div className="playout-vote-actions">
                        <button
                            type="button"
                            className="playout-vote-btn playout-vote-play"
                            onClick={() => onVote('play')}
                        >
                            PLAY IT OUT
                        </button>
                        <button
                            type="button"
                            className="playout-vote-btn playout-vote-wrap"
                            onClick={() => onVote('wrap')}
                        >
                            NEXT ROUND ▶
                        </button>
                    </div>
                ) : (
                    <p className="playout-vote-waiting">
                        {myVote === 'play' ? 'You voted to play it out.' : 'You voted for the next round.'}
                        {' '}Waiting for the table… ({votedCount}/{voteEntries.length})
                    </p>
                )}
                <p className="playout-vote-timer" aria-live="polite">
                    {Number.isFinite(playoutVote.timer) ? `${playoutVote.timer}s` : ''}
                </p>
                <p className="playout-vote-hint">
                    If anyone votes to play it out, the round continues.
                </p>
            </div>
        </div>
    );
};

export default PlayoutVoteModal;
