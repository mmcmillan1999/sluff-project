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
    quickPlayDecisionRejectionNonce = 0
}) => {
    const [inviteCopied, setInviteCopied] = useState(false);
    const [quickPlayDecisionSubmitted, setQuickPlayDecisionSubmitted] = useState(false);
    const [seekingPlayer, setSeekingPlayer] = useState(false);
    const qpPhase = currentTableState.qpPhase;
    const qpGeneration = currentTableState.qpGeneration;
    const qpMatchmakingNotice = currentTableState.qpMatchmakingNotice;
    const hasQpDeadline = deadlineToMs(currentTableState.qpWindowEndsAt) !== null;

    useEffect(() => {
        setQuickPlayDecisionSubmitted(false);
    }, [qpPhase, qpGeneration, quickPlayDecisionRejectionNonce]);

    const players = Object.values(currentTableState.players || {});
    const activePlayers = players.filter(player => !player.isSpectator && !player.disconnected);
    const hasBots = players.some(player => player.isBot);
    const selfPlayer = currentTableState.players?.[playerId]
        || players.find(player => player.userId === playerId);
    const isActiveHuman = !isSpectator && !selfPlayer?.isBot;
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

    const handleFindPlayer = () => {
        emitEvent('findPlayer');
        setSeekingPlayer(true);
        // The server's search window tops out around 8s; hold the searching
        // state slightly longer so the button never re-enables mid-search.
        setTimeout(() => setSeekingPlayer(false), 9000);
    };

    // A new arrival (found player, invite) ends the visible search early.
    const activePlayerCount = activePlayers.length;
    useEffect(() => {
        setSeekingPlayer(false);
    }, [activePlayerCount]);

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
            const lowerStakesName = qpMatchmakingNotice?.recommendedTableName;
            const hasLowerStakesRecommendation = qpMatchmakingNotice?.code === 'HIGH_STAKES_POOL_THIN'
                && Boolean(lowerStakesName);
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
                    <p
                        className="action-prompt__copy"
                        {...(qpMatchmakingNotice ? { role: 'status', 'aria-live': 'polite' } : {})}
                    >
                        {qpMatchmakingNotice
                            ? (qpMatchmakingNotice.code === 'MATCHMAKING_TEMPORARILY_UNAVAILABLE'
                                ? 'Matchmaking is having trouble checking another seat. Start with three or try again. The first game-size choice decides for the table.'
                                : `We couldn't find a fourth seat at this buy-in. Start with three${lowerStakesName ? ` or try ${lowerStakesName} while more high rollers arrive` : ' or keep looking'}. The first game-size choice decides for the table.`)
                            : 'First choice at the table decides.'}
                    </p>
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
                    {qpMatchmakingNotice && (
                        <button
                            type="button"
                            onClick={handleLeaveTable}
                            disabled={quickPlayDecisionSubmitted}
                            className="game-button action-prompt__button action-prompt__button--quiet"
                        >
                            {hasLowerStakesRecommendation ? 'View Lower-Stakes Tables' : 'Back to Lobby'}
                        </button>
                    )}
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

        if (qpMatchmakingNotice) {
            const lowerStakesName = qpMatchmakingNotice.recommendedTableName;
            const temporarilyUnavailable = qpMatchmakingNotice.code === 'MATCHMAKING_TEMPORARILY_UNAVAILABLE';
            const hasLowerStakesRecommendation = !temporarilyUnavailable && Boolean(lowerStakesName);
            return (
                <PromptShell variant="pregame" label="Quick Play needs more players">
                    <h2 className="action-prompt__heading">
                        {temporarilyUnavailable
                            ? 'Matchmaking needs a moment'
                            : (lowerStakesName ? 'More high rollers needed' : 'More players needed')}
                    </h2>
                    <p className="action-prompt__copy" role="status" aria-live="polite">
                        {temporarilyUnavailable
                            ? 'We could not verify another seat. We will keep trying while you wait.'
                            : `We couldn't fill this buy-in yet.${lowerStakesName ? ` Try ${lowerStakesName} while more high rollers arrive.` : ' We will keep looking while you wait.'}`}
                    </p>
                    {!isSpectator && (
                        <button
                            type="button"
                            onClick={handleLeaveTable}
                            className="game-button action-prompt__button action-prompt__button--quiet"
                        >
                            {hasLowerStakesRecommendation ? 'View Lower-Stakes Tables' : 'Back to Lobby'}
                        </button>
                    )}
                </PromptShell>
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
                        {activePlayers.length < 4 && (
                            <button
                                type="button"
                                onClick={handleFindPlayer}
                                disabled={seekingPlayer}
                                className="game-button action-prompt__button"
                            >
                                {seekingPlayer ? 'Searching…' : 'Find a Player'}
                            </button>
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
            // The deck's location already communicates whose deal it is. The
            // dealer-only action now lives beside that deck in TableLayout.
            return null;

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
            // The server advances to Dealing Pending once every connected human
            // finishes the recap. The new dealer still starts the actual deal.
            return null;

        default:
            // Dedicated overlays, recaps, and gameplay surfaces own every other
            // known state. Unknown internal state names must never leak to players.
            if (HIDDEN_TABLE_STATES.has(currentTableState.state)) return null;
            return null;
    }
};

export default ActionControls;
