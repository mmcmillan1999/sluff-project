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
        return <p style={{color: 'white', fontStyle:'italic'}}>{currentTableState.state}</p>;
    }

    const activePlayers = Object.values(currentTableState.players).filter(p => !p.isSpectator && !p.disconnected);
    const hasBots = Object.values(currentTableState.players).some(p => p.isBot);

    switch (currentTableState.state) {
        case "Waiting for Players":
            return (
                <div style={{ color: 'white', textAlign: 'center' }}>
                    <h2>Waiting for players... ({activePlayers.length} / 3)</h2>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '10px' }}>
                        {activePlayers.length < 4 && (
                            <button onClick={() => emitEvent("addBot")} className="game-button">Add Bot</button>
                        )}
                        {hasBots && (
                            <button onClick={() => emitEvent("removeBot")} className="game-button" style={{backgroundColor: '#dc3545'}}>Remove Bot</button>
                        )}
                        <button onClick={handleLeaveTable} className="game-button" style={{backgroundColor: '#6c757d'}}>Lobby</button>
                    </div>
                </div>
            );
        case "Ready to Start":
            if (activePlayers.length < 3) {
                return <h2 style={{ color: 'white' }}>Waiting for more players...</h2>;
            }
            return (
                <div style={{ textAlign: 'center' }}>
                    <button onClick={() => emitEvent("startGame")} className="game-button">Start {activePlayers.length}-Player Game</button>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', marginTop: '10px' }}>
                        {activePlayers.length < 4 && (
                            <button onClick={() => emitEvent("addBot")} className="game-button">Add Bot</button>
                        )}
                        {hasBots && (
                            <button onClick={() => emitEvent("removeBot")} className="game-button" style={{backgroundColor: '#dc3545'}}>Remove Bot</button>
                        )}
                        <button onClick={handleLeaveTable} className="game-button" style={{backgroundColor: '#6c757d'}}>Lobby</button>
                    </div>
                </div>
            );
        case "Dealing Pending":
            if (playerId === currentTableState.dealer) {
                return <button onClick={() => emitEvent("dealCards")} className="game-button">Deal Cards</button>;
            }
            return <p style={{ color: 'white', fontStyle: 'italic' }}>Waiting for {getPlayerNameByUserId(currentTableState.dealer)} to deal...</p>;
        case "Bidding Phase":
            if (currentTableState.biddingTurnPlayerName === selfPlayerName) {
                const bids = BID_HIERARCHY;
                const currentHighestBidLevel = currentTableState.currentHighestBidDetails ? BID_HIERARCHY.indexOf(currentTableState.currentHighestBidDetails.bid) : -1;
                return (
                    <div style={{ textAlign: 'center', backgroundColor: 'rgba(0,0,0,0.5)', padding: '10px', borderRadius: '10px' }}>
                        <p style={{ color: 'white', margin: '0 0 10px 0' }}>Your turn to bid.</p>
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
            return <p style={{ color: 'white', fontStyle: 'italic' }}>Waiting for {currentTableState.biddingTurnPlayerName} to bid...</p>;
        case "Awaiting Frog Upgrade Decision":
            if (currentTableState.biddingTurnPlayerName === selfPlayerName) {
                return (
                    <div style={{ textAlign: 'center', backgroundColor: 'rgba(0,0,0,0.5)', padding: '10px', borderRadius: '10px' }}>
                        <p style={{ color: 'white' }}>A Solo bid was made. Upgrade your Frog to Heart Solo?</p>
                        <button onClick={() => emitEvent("placeBid", { bid: "Heart Solo" })} className="game-button">Upgrade to Heart Solo</button>
                        <button onClick={() => emitEvent("placeBid", { bid: "Pass" })} className="game-button">Pass</button>
                    </div>
                );
            }
            return <p style={{ color: 'white', fontStyle: 'italic' }}>Waiting for {currentTableState.biddingTurnPlayerName} to decide...</p>;
        case "Trump Selection":
            if (currentTableState.bidWinnerInfo?.userId === playerId) {
                return (
                    <div className="action-prompt">
                        <h4>Choose Trump Suit:</h4>
                        <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', marginTop: '10px' }}>
                            {["D", "C", "S"].map(suit => renderCard(`?${suit}`, {
                                key: suit,
                                large: true,
                                isButton: true,
                                onClick: () => emitEvent("chooseTrump", { suit })
                            }))}
                        </div>
                    </div>
                );
            }
            return <p style={{ color: 'white', fontStyle: 'italic' }}>Waiting for {currentTableState.bidWinnerInfo?.playerName} to choose trump...</p>;
        case "AllPassWidowReveal":
            const widowCards = currentTableState.roundSummary?.widowForReveal || currentTableState.originalDealtWidow || [];
            return (
                <div className="action-prompt">
                    <h4>All players passed. Revealing the widow...</h4>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', marginTop: '10px' }}>
                        {widowCards.map((card, index) => renderCard(card, { key: index, large: true }))}
                    </div>
                </div>
            );
        case "Playing Phase":
        case "TrickCompleteLinger":
            if (currentTableState.trickTurnPlayerName === selfPlayerName) {
                return <p style={{ color: 'limegreen', fontWeight: 'bold', fontSize: '1.2em', textShadow: '1px 1px 2px black' }}>Your Turn!</p>;
            }
            return <p style={{ color: 'white', fontStyle: 'italic' }}>Waiting for {currentTableState.trickTurnPlayerName}...</p>;
        case "Frog Widow Exchange":
            const isBidder = currentTableState.bidWinnerInfo?.userId === playerId;
            if (isBidder) {
                return null; 
            } else {
                return (
                    <div className="action-prompt">
                        <h4 style={{marginBottom: '10px'}}>Revealed Widow (Frog)</h4>
                        <div style={{ display: 'flex', justifyContent: 'center', gap: '10px' }}>
                            {(currentTableState.revealedWidowForFrog || []).map((card, index) => renderCard(card, { key: `widow-${index}`, large: true }))}
                        </div>
                        <p style={{ color: 'white', fontStyle: 'italic', marginTop: '15px' }}>
                            {currentTableState.bidWinnerInfo?.playerName} is exchanging cards...
                        </p>
                    </div>
                );
            }
        default:
            return <p style={{ color: 'white' }}>{currentTableState.state}</p>;
    }
};

export default ActionControls;