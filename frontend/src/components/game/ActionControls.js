// frontend/src/components/game/ActionControls.js
import React, { useState, useEffect } from 'react';
import { BID_HIERARCHY } from '../../constants';
import { shareInvite, getInviteUrl } from '../../utils/tableInvites';

const ActionControls = ({
    currentTableState,
    playerId,
    selfPlayerName,
    isSpectator,
    emitEvent,
    handleLeaveTable,
    renderCard,
    isAdmin
}) => {
    const [inviteCopied, setInviteCopied] = useState(false);
    // Tick while the quick-play 4th-player window is open so the countdown moves.
    const qpDeadline = currentTableState.qpWindowEndsAt;
    const [nowTs, setNowTs] = useState(Date.now());
    useEffect(() => {
        if (!qpDeadline) return undefined;
        const interval = setInterval(() => setNowTs(Date.now()), 500);
        return () => clearInterval(interval);
    }, [qpDeadline]);

    const getPlayerNameByUserId = (targetPlayerId) => {
        if (!currentTableState?.players || !targetPlayerId) return String(targetPlayerId);
        const player = Object.values(currentTableState.players).find(p => p.userId === targetPlayerId);
        return player?.playerName || String(targetPlayerId);
    };

    if (isSpectator) {
        if (currentTableState.state === "Bid Announcement") return null;
        return (
            <div className="action-prompt-container">
                <p style={{fontStyle:'italic', margin: 0}}>{currentTableState.state}</p>
            </div>
        );
    }

    const activePlayers = Object.values(currentTableState.players).filter(p => !p.isSpectator && !p.disconnected);
    const hasBots = Object.values(currentTableState.players).some(p => p.isBot);
    const isQuickPlay = currentTableState.tableType === 'quickplay';

    const handleShareLink = async () => {
        const result = await shareInvite(currentTableState.tableId, currentTableState.tableName);
        if (result === 'copied') {
            setInviteCopied(true);
            setTimeout(() => setInviteCopied(false), 2500);
        } else if (result === 'failed') {
            window.prompt('Copy this invite link:', getInviteUrl(currentTableState.tableId));
        }
    };

    switch (currentTableState.state) {
        case "Waiting for Players":
        case "Ready to Start": {
            if (isQuickPlay) {
                // Matchmaking is filling the seats — nothing to manage. Once 3
                // are seated the 20s search for a 4th human runs; Start deals
                // immediately as 3-player.
                if (qpDeadline) {
                    const secondsLeft = Math.max(0, Math.ceil((qpDeadline - nowTs) / 1000));
                    return (
                        <div className="action-prompt-container qp-filling">
                            <h4>Looking for a 4th player… {secondsLeft}s</h4>
                            <div style={{ display: 'flex', justifyContent: 'center', gap: '10px' }}>
                                <button onClick={() => emitEvent("startGame")} className="game-button qp-start-now">Start 3-Player Game</button>
                                <button onClick={handleLeaveTable} className="game-button" style={{backgroundColor: '#6c757d'}}>Leave</button>
                            </div>
                        </div>
                    );
                }
                return (
                    <div className="action-prompt-container qp-filling">
                        <h4>Finding players<span className="qp-ellipsis" aria-hidden="true"></span> ({activePlayers.length}/3)</h4>
                        <p style={{ margin: '0 0 8px', fontStyle: 'italic', opacity: 0.8 }}>Seats fill within a few seconds</p>
                        <button onClick={handleLeaveTable} className="game-button" style={{backgroundColor: '#6c757d'}}>Leave</button>
                    </div>
                );
            }

            // Private table: humans only — invite friends via the share link.
            const isReady = currentTableState.state === "Ready to Start" && activePlayers.length >= 3;
            return (
                <div className="action-prompt-container">
                    <h4>{isReady ? `Ready to Start (${activePlayers.length}-Player Game)` : `Waiting for friends... (${activePlayers.length} / 3)`}</h4>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', flexWrap: 'wrap' }}>
                        {isReady && <button onClick={() => emitEvent("startGame")} className="game-button">Start Game</button>}
                        <button onClick={handleShareLink} className="game-button share-link-button">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px', verticalAlign: '-2px' }}>
                                <circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle>
                                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
                            </svg>
                            {inviteCopied ? 'Link Copied!' : 'Copy Game Link'}
                        </button>
                        {isAdmin && activePlayers.length < 4 && <button onClick={() => emitEvent("addBot")} className="game-button">Add Bot</button>}
                        {isAdmin && hasBots && <button onClick={() => emitEvent("removeBot")} className="game-button" style={{backgroundColor: '#dc3545'}}>Remove Bot</button>}
                        <button onClick={handleLeaveTable} className="game-button" style={{backgroundColor: '#6c757d'}}>Lobby</button>
                    </div>
                </div>
            );
        }
        case "Dealing Pending":
            return (
                <div className="action-prompt-container">
                    {playerId === currentTableState.dealer ? (
                        <button onClick={() => emitEvent("dealCards")} className="game-button">Deal Cards</button>
                    ) : (
                        <p style={{ fontStyle: 'italic', margin: 0 }}>Waiting for {getPlayerNameByUserId(currentTableState.dealer)} to deal...</p>
                    )}
                </div>
            );
        case "Bidding Phase":
            if (currentTableState.biddingTurnPlayerName === selfPlayerName) {
                const bids = BID_HIERARCHY;
                const currentHighestBidLevel = currentTableState.currentHighestBidDetails ? BID_HIERARCHY.indexOf(currentTableState.currentHighestBidDetails.bid) : -1;
                return (
                    <div className="action-prompt-container">
                        <h4>Your turn to bid.</h4>
                        {bids.map(bid => (
                            <button 
                                key={bid}
                                onClick={() => emitEvent("placeBid", { bid })} 
                                className="game-button" 
                                disabled={bid !== "Pass" && BID_HIERARCHY.indexOf(bid) <= currentHighestBidLevel}>
                                {bid}
                            </button>
                        ))}
                    </div>
                );
            }
            return (
                <div className="action-prompt-container">
                    <p style={{ fontStyle: 'italic', margin: 0 }}>Waiting for {currentTableState.biddingTurnPlayerName} to bid...</p>
                </div>
            );
        case "Awaiting Frog Upgrade Decision":
             return (
                <div className="action-prompt-container">
                    {currentTableState.biddingTurnPlayerName === selfPlayerName ? (
                        <>
                            <h4>A Solo bid was made.</h4>
                            <p>Upgrade your Frog to Heart Solo?</p>
                            <button onClick={() => emitEvent("placeBid", { bid: "Heart Solo" })} className="game-button">Upgrade to Heart Solo</button>
                            <button onClick={() => emitEvent("placeBid", { bid: "Pass" })} className="game-button">Pass</button>
                        </>
                    ) : (
                        <p style={{ fontStyle: 'italic', margin: 0 }}>Waiting for {currentTableState.biddingTurnPlayerName} to decide...</p>
                    )}
                </div>
            );
        case "Trump Selection":
             return (
                <div className="action-prompt-container">
                    {currentTableState.bidWinnerInfo?.userId === playerId ? (
                        <>
                            <h4>Choose Trump Suit:</h4>
                            <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', marginTop: '10px' }}>
                                {["D", "C", "S"].map(suit => renderCard(`?${suit}`, {
                                    key: suit,
                                    large: true,
                                    isButton: true,
                                    onClick: () => emitEvent("chooseTrump", { suit })
                                }))}
                            </div>
                        </>
                    ) : (
                        <p style={{ fontStyle: 'italic', margin: 0 }}>Waiting for {currentTableState.bidWinnerInfo?.playerName} to choose trump...</p>
                    )}
                </div>
            );
        case "AllPassWidowReveal":
            const widowCards = currentTableState.roundSummary?.widowForReveal || currentTableState.originalDealtWidow || [];
            return (
                <div className="action-prompt-container">
                    <h4>All players passed. Revealing the widow...</h4>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', marginTop: '10px' }}>
                        {widowCards.map((card, index) => renderCard(card, { key: index, large: true }))}
                    </div>
                </div>
            );
        case "Frog Widow Exchange":
            const isBidder = currentTableState.bidWinnerInfo?.userId === playerId;
            const revealedWidow = currentTableState.revealedWidowForFrog || [];
            return (
                <div className="action-prompt-container">
                    <h4>{isBidder ? "You received these cards from the Widow:" : "Revealed Widow (Frog)"}</h4>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '10px' }}>
                        {revealedWidow.map((card, index) => renderCard(card, { key: `widow-${index}`, large: true }))}
                    </div>
                    <p style={{ fontStyle: 'italic', marginTop: '15px' }}>
                        {isBidder ? "Select 3 cards from your hand below to discard." : `${currentTableState.bidWinnerInfo?.playerName} is exchanging cards...`}
                    </p>
                </div>
            );
        case "DrawAccepted":
            return (
                <div className="action-prompt-container">
                    <h4>Draw Accepted!</h4>
                    <p style={{ margin: 0 }}>Returning to lobby in {currentTableState.drawCountdown}...</p>
                </div>
            );
        case "Bid Announcement": // the VS splash owns the screen — no status box
        case "Playing Phase":
        case "TrickCompleteLinger":
            return null;
        default:
            return (
                <div className="action-prompt-container">
                    <p style={{margin: 0}}>{currentTableState.state}</p>
                </div>
            );
    }
};

export default ActionControls;