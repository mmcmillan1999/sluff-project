// frontend/src/components/game/PlayerSeat.js
import React from 'react';
import './PlayerSeat.css'; // Import the CSS file
import ScoreChipStack from './ScoreChipStack';

const SCORE_ANIMATION_STATES = new Set([
    'WidowReveal',
    'Awaiting Next Round Trigger',
    'Game Over',
]);

// Same faces as the bid buttons — one visual language across the table:
// the frog logo for Frog, the choosable trump suits for Solo, hearts ×3
// for Heart Solo.
const BID_EMOTES = {
    'Frog': {
        key: 'frog',
        node: <img className="bid-emote-bubble__frog" src="/assets/trump-pucks/FrogTrumpPuck.png" alt="" />,
    },
    'Solo': {
        key: 'solo',
        node: (
            <span className="bid-emote-suits">
                <span className="bid-emote-suit--red">♦</span>
                <span className="bid-emote-suit--black">♠</span>
                <span className="bid-emote-suit--black">♣</span>
            </span>
        ),
    },
    'Heart Solo': {
        key: 'heart-solo',
        node: <span className="bid-emote-suits bid-emote-suit--red">♥♥♥</span>,
    },
};
const BIDDING_STATES = new Set(['Bidding Phase', 'Awaiting Frog Upgrade Decision']);

// What this seat is saying during the auction: zzz once passed, the bid's
// face while holding the high bid, a think while it is their turn.
const bidEmoteFor = (currentTableState, playerName) => {
    if (!BIDDING_STATES.has(currentTableState.state)) return null;
    if (currentTableState.playersWhoPassedThisRound?.includes(playerName)) {
        return { key: 'pass', node: '💤', label: `${playerName} passed` };
    }
    const highBid = currentTableState.currentHighestBidDetails;
    if (highBid?.playerName === playerName) {
        const face = BID_EMOTES[highBid.bid];
        if (face) return { ...face, label: `${playerName} bid ${highBid.bid}` };
    }
    if (currentTableState.biddingTurnPlayerName === playerName) {
        return { key: 'think', node: '🤔', label: `${playerName} is deciding` };
    }
    return null;
};

const PlayerSeat = ({ playerName, currentTableState, isSelf, emitEvent, showTrumpIndicator, trumpIndicatorPuck, renderCard, seatPosition, onPlayerProfile }) => {
    if (!playerName) {
        return null; 
    }

    const {
        players,
        scores,
        bidWinnerInfo,
        playerOrderActive,
        trickTurnPlayerName,
        forfeiture,
        dealer,
        trumpSuit,
        trumpBroken
    } = currentTableState;

    const playerEntry = Object.values(players).find(p => p.playerName === playerName);

    if (!playerEntry) {
        return null;
    }

    const { disconnected, userId } = playerEntry;
    const isBidWinner = bidWinnerInfo?.playerName === playerName;
    const isDefender = bidWinnerInfo && !isBidWinner && playerOrderActive.includes(playerName);
    const isDealer = dealer === userId;
    // 4-player: the dealer sits the round out — black border marks them.
    const isSittingOutDealer = isDealer && currentTableState.playerMode === 4 && currentTableState.gameStarted;
    const isTimerRunningForThisPlayer = forfeiture?.targetPlayerName === playerName;
    const isMyTurn = trickTurnPlayerName === playerName;

    // Team indication border styling
    let borderColor = '#ccc'; // Default for non-players
    let borderWidth = '2px'; // Default width for non-players

    if (disconnected) {
        borderColor = 'red';
        borderWidth = '3px'; // Keep disconnected override
    } else if (isSittingOutDealer) {
        borderColor = '#111'; // Black for the sitting-out 4-player dealer
        borderWidth = '5px';
    } else if (isBidWinner) {
        borderColor = '#ffc107'; // Gold for bidder
        borderWidth = '5px';
    } else if (isDefender) {
        borderColor = '#0d6efd'; // Blue for defenders
        borderWidth = '5px';
    }

    const dynamicStyles = {
        border: `${borderWidth} solid ${borderColor}`,
    };

    const seatClasses = [
        'player-seat',
        isMyTurn && 'active-turn',
        isBidWinner && 'team-bidder',
        isDefender && 'team-defender',
        isSittingOutDealer && 'sitting-out-dealer'
    ].filter(Boolean).join(' ');

    const nameClasses = ['player-name', isSelf && 'is-self'].filter(Boolean).join(' ');
    const rawScoreAnimationReadyAt = currentTableState.roundSummary?.presentationReadyAt;
    const scoreAnimationReadyAt = Number(rawScoreAnimationReadyAt);
    const scoreAnimationScope = SCORE_ANIMATION_STATES.has(currentTableState.state)
        && rawScoreAnimationReadyAt !== null
        && rawScoreAnimationReadyAt !== undefined
        && Number.isFinite(scoreAnimationReadyAt)
        ? `${currentTableState.tableId || 'table'}:${scoreAnimationReadyAt}`
        : null;

    const handleStartTimer = () => {
        emitEvent("startTimeoutClock", { targetPlayerName: playerName });
    };

    // Render opponent cards (face-down)
    const renderOpponentCards = () => {
        // Opponent cards disabled per user request
        return null;
    };

    return (
        <div
            className={`player-seat-wrapper player-seat-wrapper-${seatPosition || 'unknown'}`}
            // Overlay anchors (e.g., the Midnight Special spotlight) find
            // seats by player without coupling to layout classes.
            data-seat-player={playerName}
        >
            {/* Dealer puck - top left ear */}
            {isDealer && (
                <div className="seat-puck dealer-puck-ear">
                    <span className="seat-puck-label">D</span>
                </div>
            )}
            
            {/* Bidder/Trump puck - top right ear */}
            {isBidWinner && bidWinnerInfo && trumpSuit && (() => {
                // Determine trump indicator image based on bid type
                let trumpImageSrc = '';
                const bidType = bidWinnerInfo.bid;
                
                if (bidType === 'Heart Solo') {
                    trumpImageSrc = '/assets/trump-pucks/HeartSoloTrumpPuck.png';
                } else if (bidType === 'Frog') {
                    trumpImageSrc = '/assets/trump-pucks/FrogTrumpPuck.png';
                } else {
                    // Solo bids use suit-specific images
                    const suitMap = {
                        'H': 'HeartSolo',
                        'D': 'DiamondSolo',
                        'S': 'SpadeSolo',
                        'C': 'ClubSolo'
                    };
                    const suitName = suitMap[trumpSuit] || 'ClubSolo';
                    trumpImageSrc = `/assets/trump-pucks/${suitName}TrumpPuck.png`;
                }
                
                return (
                    <div className="seat-puck bidder-puck-ear trump-indicator-puck">
                        <img 
                            src={trumpImageSrc}
                            alt={bidType}
                            className="trump-puck-icon"
                        />
                    </div>
                );
            })()}
            
            {(() => {
                const bidEmote = bidEmoteFor(currentTableState, playerName);
                if (!bidEmote) return null;
                return (
                    <div
                        // Keying on the status re-runs the pop animation each
                        // time this seat's auction standing changes.
                        key={bidEmote.key}
                        className="bid-emote-bubble"
                        role="img"
                        aria-label={bidEmote.label}
                        title={bidEmote.label}
                    >
                        {bidEmote.node}
                    </div>
                );
            })()}
            {renderOpponentCards()}
            <div className={seatClasses} style={dynamicStyles}>
                {onPlayerProfile ? (
                    <button
                        type="button"
                        className={`${nameClasses} player-name-button`}
                        onPointerDown={event => event.stopPropagation()}
                        onClick={event => {
                            event.stopPropagation();
                            onPlayerProfile(playerName);
                        }}
                        aria-label={isSelf ? 'View your player profile' : `View ${playerName}'s player profile`}
                    >
                        {playerName}
                    </button>
                ) : (
                    <div className={nameClasses}>{playerName}</div>
                )}
                {disconnected && (
                    <div className="disconnected-controls">
                        {isTimerRunningForThisPlayer ? (
                            <div className="timeout-display">
                                Time Left: {forfeiture.timeLeft}s
                            </div>
                        ) : (
                            <button className="start-timer-button" onClick={handleStartTimer}>
                                Start 2-Min Timer
                            </button>
                        )}
                    </div>
                )}
            </div>
            <ScoreChipStack
                score={scores?.[playerName]}
                playerName={playerName}
                seatPosition={seatPosition}
                animationScope={scoreAnimationScope}
            />
        </div>
    );
};

export default PlayerSeat;
