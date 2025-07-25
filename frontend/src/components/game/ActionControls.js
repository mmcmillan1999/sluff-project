// frontend/src/components/game/ActionControls.js
import React from 'react';
import { BID_HIERARCHY } from '../../constants';

const ActionControls = ({
    currentTableState,
    playerId,
    selfPlayerName,
    isSpectator,
    emitEvent,
    handleLeaveTable,
    renderCard
}) => {
    
    const getPlayerNameByUserId = (targetPlayerId) => {
        if (!currentTableState?.players || !targetPlayerId) return String(targetPlayerId);
        const player = Object.values(currentTableState.players).find(p => p.userId === targetPlayerId);
        return player?.playerName || String(targetPlayerId);
    };
    
    if (isSpectator) {
        return (
            <div className="action-prompt-container">
                <p style={{fontStyle:'italic', margin: 0}}>{currentTableState.state}</p>
            </div>
        );
    }

    const activePlayers = Object.values(currentTableState.players).filter(p => !p.isSpectator && !p.disconnected);
    const hasBots = Object.values(currentTableState.players).some(p => p.isBot);

    switch (currentTableState.state) {
        case "Waiting for Players":
        case "Ready to Start":
            const isReady = currentTableState.state === "Ready to Start" && activePlayers.length >= 3;
            return (
                <div className="action-prompt-container">
                    <h4>{isReady ? `Ready to Start (${activePlayers.length}-Player Game)` : `Waiting for players... (${activePlayers.length} / 3)`}</h4>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '10px' }}>
                        {isReady && <button onClick={() => emitEvent("startGame")} className="game-button">Start Game</button>}
                        {activePlayers.length < 4 && <button onClick={() => emitEvent("addBot")} className="game-button">Add Bot</button>}
                        {hasBots && <button onClick={() => emitEvent("removeBot")} className="game-button" style={{backgroundColor: '#dc3545'}}>Remove Bot</button>}
                        <button onClick={handleLeaveTable} className="game-button" style={{backgroundColor: '#6c757d'}}>Lobby</button>
                    </div>
                </div>
            );
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
        case "Playing Phase":
        case "TrickCompleteLinger":
            // No prompt needed here, player hand glows instead.
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