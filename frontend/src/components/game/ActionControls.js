// frontend/src/components/game/ActionControls.js
import React, { useEffect, useState } from 'react';
import { BID_HIERARCHY, BID_MULTIPLIERS } from '../../constants';
import { shareInvite, getInviteUrl } from '../../utils/tableInvites';
import './ActionControls.css';

const HIDDEN_TABLE_STATES = new Set([
    'Bid Announcement',
    'Playing Phase',
    'TrickCompleteLinger',
    'Awaiting Next Round Trigger',
    'Game Over',
    'WidowReveal',
    'Draw Resolving',
    'DrawComplete',
    'Draw Complete',
    'DrawAccepted',
    'DrawDeclined',
    'Draw Declined'
]);

const PromptShell = ({ variant, label, status = false, children }) => (
    <section
        className={`action-prompt-container action-prompt action-prompt--portrait-docked action-prompt--${variant}`}
        data-prompt-variant={variant}
        aria-label={label}
        {...(status ? { role: 'status', 'aria-live': 'polite' } : {})}
    >
        {children}
    </section>
);

const PlayerName = ({ children }) => (
    <span className="action-prompt__player-name" title={children || undefined}>
        {children || 'another player'}
    </span>
);

const StatusPrompt = ({ label, children }) => (
    <PromptShell variant="status" label={label} status>
        <p className="action-prompt__status-copy">{children}</p>
    </PromptShell>
);

const deadlineToMs = (deadline) => {
    if (typeof deadline === 'number' && Number.isFinite(deadline)) return deadline;
    if (typeof deadline === 'string') {
        const parsed = Date.parse(deadline);
        if (Number.isFinite(parsed)) return parsed;
    }
    return null;
};

const ActionControls = ({
    currentTableState,
    playerId,
    selfPlayerName,
    isSpectator,
    emitEvent,
    handleLeaveTable,
    renderCard,
    isAdmin,
    quickPlayDecisionRejectionNonce = 0,
    roundPresentationComplete = false
}) => {
    const [inviteCopied, setInviteCopied] = useState(false);
    const [quickPlayDecisionSubmitted, setQuickPlayDecisionSubmitted] = useState(false);
    const [roundAdvanceSubmitted, setRoundAdvanceSubmitted] = useState(false);
    const qpPhase = currentTableState.qpPhase;
    const qpGeneration = currentTableState.qpGeneration;
    const hasQpDeadline = deadlineToMs(currentTableState.qpWindowEndsAt) !== null;

    useEffect(() => {
        setQuickPlayDecisionSubmitted(false);
    }, [qpPhase, qpGeneration, quickPlayDecisionRejectionNonce]);

    useEffect(() => {
        if (currentTableState.state !== 'Awaiting Next Round Trigger' || !roundPresentationComplete) {
            setRoundAdvanceSubmitted(false);
        }
    }, [currentTableState.state, roundPresentationComplete]);

    const players = Object.values(currentTableState.players || {});
    const activePlayers = players.filter(player => !player.isSpectator && !player.disconnected);
    const hasBots = players.some(player => player.isBot);
    const selfPlayer = currentTableState.players?.[playerId]
        || players.find(player => player.userId === playerId);
    const isActiveHuman = !isSpectator && !selfPlayer?.isBot;
    const isQuickPlay = currentTableState.tableType === 'quickplay';

    const getPlayerNameByUserId = (targetPlayerId) => {
        if (!targetPlayerId) return null;
        const player = players.find(candidate => candidate.userId === targetPlayerId);
        return player?.playerName || String(targetPlayerId);
    };

    const handleShareLink = async () => {
        const result = await shareInvite(currentTableState.tableId, currentTableState.tableName);
        if (result === 'copied') {
            setInviteCopied(true);
            setTimeout(() => setInviteCopied(false), 2500);
        } else if (result === 'failed') {
            window.prompt('Copy this invite link:', getInviteUrl(currentTableState.tableId));
        }
    };

    const handleQuickPlayDecision = (choice) => {
        if (quickPlayDecisionSubmitted) return;
        setQuickPlayDecisionSubmitted(true);
        emitEvent('quickPlayDecision', { choice, generation: qpGeneration });
    };

    const bidLabel = (bid) => bid === 'Pass' ? bid : `${bid} · ${BID_MULTIPLIERS[bid]}×`;

    const renderQuickPlayPregame = () => {
        // Keep one release-compatible fallback while old tables drain during a
        // rolling deployment. New servers always provide qpPhase.
        const phase = qpPhase || (hasQpDeadline ? 'seeking_fourth' : 'filling');

        if (phase === 'decision_pending') {
            const isFourPlayerDecision = activePlayers.length === 4;
            if (!isActiveHuman) {
                return (
                    <StatusPrompt label="Quick Play decision">
                        {isFourPlayerDecision
                            ? 'The four-player table is deciding when to begin…'
                            : 'Seated players are choosing a 3- or 4-player game…'}
                    </StatusPrompt>
                );
            }
            if (isFourPlayerDecision) {
                return (
                    <PromptShell variant="choice" label="Start four-player Quick Play">
                        <h2 className="action-prompt__heading">Four seats are ready</h2>
                        <p className="action-prompt__copy">Start when everyone is set.</p>
                        <div className="action-prompt__button-row">
                            <button
                                type="button"
                                className="game-button action-prompt__button action-prompt__button--primary"
                                disabled={quickPlayDecisionSubmitted}
                                onClick={() => handleQuickPlayDecision('start4')}
                            >
                                Start 4-Player
                            </button>
                        </div>
                    </PromptShell>
                );
            }
            return (
                <PromptShell variant="choice" label="Choose Quick Play game size">
                    <h2 className="action-prompt__heading">Three seats are ready</h2>
                    <p className="action-prompt__copy">First choice at the table decides.</p>
                    <div className="action-prompt__button-grid action-prompt__button-grid--decision">
                        <button
                            type="button"
                            className="game-button action-prompt__button action-prompt__button--primary"
                            disabled={quickPlayDecisionSubmitted}
                            onClick={() => handleQuickPlayDecision('start3')}
                        >
                            Start 3-Player
                        </button>
                        <button
                            type="button"
                            className="game-button action-prompt__button"
                            disabled={quickPlayDecisionSubmitted}
                            onClick={() => handleQuickPlayDecision('seek4')}
                        >
                            Look for a 4th
                        </button>
                    </div>
                </PromptShell>
            );
        }

        if (phase === 'seeking_fourth') {
            return (
                <PromptShell variant="pregame" label="Looking for a fourth player">
                    <h2 className="action-prompt__heading">
                        Finding a fourth player<span className="qp-ellipsis" aria-hidden="true" />
                    </h2>
                    <p className="action-prompt__copy">Searching for one more player.</p>
                    {!isSpectator && (
                        <button
                            type="button"
                            onClick={handleLeaveTable}
                            className="game-button action-prompt__button action-prompt__button--quiet"
                        >
                            Leave
                        </button>
                    )}
                </PromptShell>
            );
        }

        if (phase === 'starting_3' || phase === 'starting_4') {
            return (
                <StatusPrompt label="Quick Play starting">
                    Starting a {phase === 'starting_3' ? '3' : '4'}-player game…
                </StatusPrompt>
            );
        }

        return (
            <PromptShell variant="pregame" label="Quick Play matchmaking">
                <h2 className="action-prompt__heading">
                    Finding players<span className="qp-ellipsis" aria-hidden="true" />
                </h2>
                <p className="action-prompt__copy">Seats ready: {Math.min(activePlayers.length, 3)}/3</p>
                {!isSpectator && (
                    <button
                        type="button"
                        onClick={handleLeaveTable}
                        className="game-button action-prompt__button action-prompt__button--quiet"
                    >
                        Leave
                    </button>
                )}
            </PromptShell>
        );
    };

    switch (currentTableState.state) {
        case 'Waiting for Players':
        case 'Ready to Start': {
            if (isQuickPlay) return renderQuickPlayPregame();

            const isReady = currentTableState.state === 'Ready to Start' && activePlayers.length >= 3;
            if (isSpectator) {
                return (
                    <StatusPrompt label="Private table status">
                        {isReady ? 'Players are ready to begin.' : `Waiting for players · ${activePlayers.length}/3`}
                    </StatusPrompt>
                );
            }
            return (
                <PromptShell variant="pregame" label="Private table controls">
                    <h2 className="action-prompt__heading">
                        {isReady ? `${activePlayers.length}-player table ready` : `Waiting for friends · ${activePlayers.length}/3`}
                    </h2>
                    <div className="action-prompt__button-row">
                        {isReady && (
                            <button type="button" onClick={() => emitEvent('startGame')} className="game-button action-prompt__button action-prompt__button--primary">
                                Start Game
                            </button>
                        )}
                        <button type="button" onClick={handleShareLink} className="game-button action-prompt__button share-link-button">
                            <svg className="action-prompt__share-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                            </svg>
                            {inviteCopied ? 'Link Copied!' : 'Copy Game Link'}
                        </button>
                        {isAdmin && activePlayers.length < 4 && (
                            <button type="button" onClick={() => emitEvent('addBot')} className="game-button action-prompt__button">Add Bot</button>
                        )}
                        {isAdmin && hasBots && (
                            <button type="button" onClick={() => emitEvent('removeBot')} className="game-button action-prompt__button action-prompt__button--danger">Remove Bot</button>
                        )}
                        <button type="button" onClick={handleLeaveTable} className="game-button action-prompt__button action-prompt__button--quiet">Lobby</button>
                    </div>
                </PromptShell>
            );
        }

        case 'Dealing Pending':
            if (!isSpectator && playerId === currentTableState.dealer) {
                return (
                    <PromptShell variant="choice" label="Deal cards">
                        <button type="button" onClick={() => emitEvent('dealCards')} className="game-button action-prompt__button action-prompt__button--primary">Deal Cards</button>
                    </PromptShell>
                );
            }
            return (
                <StatusPrompt label="Waiting for the dealer">
                    Waiting for <PlayerName>{getPlayerNameByUserId(currentTableState.dealer)}</PlayerName> to deal…
                </StatusPrompt>
            );

        case 'Bidding Phase':
            if (!isSpectator && currentTableState.biddingTurnPlayerName === selfPlayerName) {
                const currentHighestBidLevel = currentTableState.currentHighestBidDetails
                    ? BID_HIERARCHY.indexOf(currentTableState.currentHighestBidDetails.bid)
                    : -1;
                return (
                    <PromptShell variant="choice" label="Bidding controls">
                        <h2 className="action-prompt__heading">Choose your bid</h2>
                        <div className="action-prompt__button-grid action-prompt__button-grid--bids">
                            {BID_HIERARCHY.map(bid => (
                                <button
                                    type="button"
                                    key={bid}
                                    onClick={() => emitEvent('placeBid', { bid })}
                                    className="game-button action-prompt__button action-prompt__bid-button"
                                    aria-label={bid === 'Pass' ? 'Pass' : `${bid}, ${BID_MULTIPLIERS[bid]} times scoring multiplier`}
                                    disabled={bid !== 'Pass' && BID_HIERARCHY.indexOf(bid) <= currentHighestBidLevel}
                                >
                                    {bidLabel(bid)}
                                </button>
                            ))}
                        </div>
                    </PromptShell>
                );
            }
            return (
                <StatusPrompt label="Waiting for a bid">
                    <PlayerName>{currentTableState.biddingTurnPlayerName}</PlayerName> is bidding…
                </StatusPrompt>
            );

        case 'Awaiting Frog Upgrade Decision':
            if (!isSpectator && currentTableState.biddingTurnPlayerName === selfPlayerName) {
                return (
                    <PromptShell variant="choice" label="Frog upgrade decision">
                        <h2 className="action-prompt__heading">Solo was bid</h2>
                        <p className="action-prompt__copy">Upgrade Frog to Heart Solo?</p>
                        <div className="action-prompt__button-grid action-prompt__button-grid--decision">
                            <button type="button" onClick={() => emitEvent('placeBid', { bid: 'Heart Solo' })} className="game-button action-prompt__button action-prompt__button--primary">
                                Heart Solo · {BID_MULTIPLIERS['Heart Solo']}×
                            </button>
                            <button type="button" onClick={() => emitEvent('placeBid', { bid: 'Pass' })} className="game-button action-prompt__button">Keep Frog</button>
                        </div>
                    </PromptShell>
                );
            }
            return (
                <StatusPrompt label="Waiting for a Frog decision">
                    <PlayerName>{currentTableState.biddingTurnPlayerName}</PlayerName> is deciding…
                </StatusPrompt>
            );

        case 'Trump Selection':
            if (!isSpectator && currentTableState.bidWinnerInfo?.userId === playerId) {
                return (
                    <PromptShell variant="card" label="Choose trump suit">
                        <h2 className="action-prompt__heading">Choose trump</h2>
                        <div className="action-prompt__cards action-prompt__cards--trump">
                            {['D', 'C', 'S'].map(suit => (
                                <React.Fragment key={suit}>
                                    {renderCard(`?${suit}`, {
                                        large: true,
                                        isButton: true,
                                        onClick: () => emitEvent('chooseTrump', { suit })
                                    })}
                                </React.Fragment>
                            ))}
                        </div>
                    </PromptShell>
                );
            }
            return (
                <StatusPrompt label="Waiting for trump selection">
                    <PlayerName>{currentTableState.bidWinnerInfo?.playerName}</PlayerName> is choosing trump…
                </StatusPrompt>
            );

        case 'AllPassWidowReveal': {
            const widowCards = currentTableState.roundSummary?.widowForReveal
                || currentTableState.originalDealtWidow
                || [];
            return (
                <PromptShell variant="card" label="All-pass widow reveal">
                    <h2 className="action-prompt__heading">All passed · Widow reveal</h2>
                    <div className="action-prompt__cards">
                        {widowCards.map((card, index) => (
                            <React.Fragment key={`${card}-${index}`}>{renderCard(card, { large: true })}</React.Fragment>
                        ))}
                    </div>
                </PromptShell>
            );
        }

        case 'Frog Widow Exchange': {
            const isBidder = !isSpectator && currentTableState.bidWinnerInfo?.userId === playerId;
            const revealedWidow = currentTableState.revealedWidowForFrog || [];
            return (
                <PromptShell variant="card" label="Frog widow exchange">
                    <h2 className="action-prompt__heading">Widow cards</h2>
                    <div className="action-prompt__cards">
                        {revealedWidow.map((card, index) => (
                            <React.Fragment key={`${card}-${index}`}>{renderCard(card, { large: true })}</React.Fragment>
                        ))}
                    </div>
                    <p className="action-prompt__copy">
                        {isBidder
                            ? 'Choose 3 cards from your hand to discard.'
                            : <><PlayerName>{currentTableState.bidWinnerInfo?.playerName}</PlayerName> is exchanging cards…</>}
                    </p>
                </PromptShell>
            );
        }

        case 'Awaiting Next Round Trigger':
            if (
                !roundPresentationComplete
                || isSpectator
                || playerId !== currentTableState.roundSummary?.dealerOfRoundId
            ) {
                return null;
            }
            return (
                <PromptShell variant="choice" label="Start the next round">
                    <button
                        type="button"
                        autoFocus
                        disabled={roundAdvanceSubmitted}
                        onClick={() => {
                            if (roundAdvanceSubmitted) return;
                            setRoundAdvanceSubmitted(true);
                            emitEvent('requestNextRound');
                        }}
                        className="game-button action-prompt__button action-prompt__button--primary"
                    >
                        Start Next Round
                    </button>
                </PromptShell>
            );

        default:
            // Dedicated overlays, recaps, and gameplay surfaces own every other
            // known state. Unknown internal state names must never leak to players.
            if (HIDDEN_TABLE_STATES.has(currentTableState.state)) return null;
            return null;
    }
};

export default ActionControls;
