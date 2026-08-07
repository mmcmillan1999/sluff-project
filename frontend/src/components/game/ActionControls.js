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

// `nudge` is the turn call-up level (0 calm, 1 nudge, 2 urgent). Decisions
// made in this popup rather than in the hand escalate here instead.
const PromptShell = ({ variant, label, status = false, nudge = 0, children }) => (
    <section
        className={[
            'action-prompt-container action-prompt action-prompt--portrait-docked',
            `action-prompt--${variant}`,
            nudge > 0 ? 'turn-nudge-prompt' : '',
            nudge >= 2 ? 'turn-nudge-prompt--urgent' : ''
        ].filter(Boolean).join(' ')}
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
    turnNudgeLevel = 0,
    turnNudgeCountdown = null,
    bidHintText = '',
    // Learner mode: show the one-line bid primer above the bid keys.
    learnerMode = false
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

    // Each bid gets a face that says what the bid MEANS: the frog logo (heart
    // overhead — hearts trump, widow help) for Frog, the three choosable
    // trump suits fanned like mini cards for Solo, three hearts for Heart
    // Solo. PlayerSeat's bid emotes mirror these, so the table reads as one
    // language.
    const BID_SLUGS = { 'Pass': 'pass', 'Frog': 'frog', 'Solo': 'solo', 'Heart Solo': 'heart-solo' };
    // What each key actually commits you to — the label a first-timer needs.
    const BID_COMMITMENTS = {
        'Pass': 'Pass — sit this auction out, costs nothing',
        'Frog': 'Frog — hearts trump, swap three cards with the widow, 1 times stakes',
        'Solo': 'Solo — pick the trump suit, play alone, 2 times stakes',
        'Heart Solo': 'Heart Solo — hearts trump, play alone, 3 times stakes',
    };
    const BID_FACES = {
        'Pass': <span className="bid-key__emoji" aria-hidden="true">✋</span>,
        'Frog': (
            <span className="bid-key__chip" aria-hidden="true">
                <img src="/assets/trump-pucks/FrogTrumpPuck.png" alt="" className="bid-key__frog-art" />
            </span>
        ),
        'Solo': (
            <span className="bid-key__suits" aria-hidden="true">
                <span className="bid-key__suit-chip bid-suit--red">♦</span>
                <span className="bid-key__suit-chip bid-suit--black">♠</span>
                <span className="bid-key__suit-chip bid-suit--black">♣</span>
            </span>
        ),
        'Heart Solo': (
            <span className="bid-key__suits" aria-hidden="true">
                <span className="bid-key__suit-chip bid-suit--red">♥</span>
                <span className="bid-key__suit-chip bid-suit--red">♥</span>
                <span className="bid-key__suit-chip bid-suit--red">♥</span>
            </span>
        ),
    };

    const renderBidFace = (bid, name = bid) => (
        <>
            {BID_FACES[bid]}
            <span className="bid-key__name">{name}</span>
            {bid !== 'Pass' && <span className="bid-key__mult">{BID_MULTIPLIERS[bid]}×</span>}
        </>
    );

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
                                className="game-button keycap action-prompt__button action-prompt__button--primary"
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
                            className="game-button keycap action-prompt__button action-prompt__button--primary"
                            disabled={quickPlayDecisionSubmitted}
                            onClick={() => handleQuickPlayDecision('start3')}
                        >
                            Start 3-Player
                        </button>
                        <button
                            type="button"
                            className="game-button keycap action-prompt__button"
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
                            className="game-button keycap action-prompt__button action-prompt__button--quiet"
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
                            className="game-button keycap action-prompt__button action-prompt__button--quiet"
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
                            className="game-button keycap action-prompt__button action-prompt__button--quiet"
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
                        className="game-button keycap action-prompt__button action-prompt__button--quiet"
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
                    <div className="action-prompt__button-row action-prompt__button-row--grid">
                        {isReady && (
                            <button type="button" onClick={() => emitEvent('startGame')} className="game-button keycap action-prompt__button action-prompt__button--primary">
                                Start Game
                            </button>
                        )}
                        <button type="button" onClick={handleShareLink} className="game-button keycap action-prompt__button share-link-button">
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
                                className="game-button keycap action-prompt__button"
                            >
                                {seekingPlayer ? 'Searching…' : 'Find a Player'}
                            </button>
                        )}
                        {activePlayers.length >= 4 && hasBots && (
                            <button
                                type="button"
                                onClick={() => emitEvent('makeRoom')}
                                className="game-button keycap action-prompt__button"
                            >
                                Make Room
                            </button>
                        )}
                        <button type="button" onClick={handleLeaveTable} className="game-button keycap action-prompt__button action-prompt__button--quiet">Lobby</button>
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
                    <PromptShell variant="choice" label="Bidding controls" nudge={turnNudgeLevel}>
                        <div className="action-prompt__heading-row">
                            <h2 className="action-prompt__heading">
                                Choose your bid
                                {turnNudgeLevel > 0 && Number.isFinite(turnNudgeCountdown) && turnNudgeCountdown <= 20 && (
                                    <span className="action-prompt__countdown"> · {Math.max(turnNudgeCountdown, 0)}s</span>
                                )}
                            </h2>
                            <button
                                type="button"
                                className="action-prompt__hint-btn"
                                onClick={() => emitEvent('requestBidHint')}
                                aria-label="Not sure? Get a bid suggestion"
                                title="Not sure? Get a bid suggestion"
                            >
                                ?
                            </button>
                        </div>
                        {/* Always mounted: a live region inserted together
                            with its content is unreliably announced, and
                            unmounting the button mid-interaction would drop
                            keyboard focus to the body. */}
                        <p className="action-prompt__hint" role="status">{bidHintText}</p>
                        {/* Floats in the hint's slot above the prompt — never
                            in-flow, which pushed bid keys off short phones.
                            Yields the slot once a requested hint arrives. */}
                        {learnerMode && !bidHintText && (
                            <p className="action-prompt__bid-primer">
                                Bid = play alone vs. the other two for most of the
                                120 points. Pass costs nothing. Not sure? Tap
                                the <strong>?</strong> for advice on this hand.
                            </p>
                        )}
                        <div className="action-prompt__button-grid action-prompt__button-grid--bids">
                            {BID_HIERARCHY.map(bid => (
                                <button
                                    type="button"
                                    key={bid}
                                    onClick={() => emitEvent('placeBid', { bid })}
                                    className={`game-button keycap action-prompt__button action-prompt__bid-button bid-key bid-key--${BID_SLUGS[bid]}`}
                                    aria-label={BID_COMMITMENTS[bid]}
                                    disabled={bid !== 'Pass' && BID_HIERARCHY.indexOf(bid) <= currentHighestBidLevel}
                                >
                                    {renderBidFace(bid)}
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
                    <PromptShell variant="choice" label="Frog upgrade decision" nudge={turnNudgeLevel}>
                        <h2 className="action-prompt__heading">Solo outbids your Frog</h2>
                        <p className="action-prompt__copy">Take the round back with Heart Solo (3×), or step aside and let the Solo play.</p>
                        <div className="action-prompt__button-grid action-prompt__button-grid--decision">
                            <button
                                type="button"
                                onClick={() => emitEvent('placeBid', { bid: 'Heart Solo' })}
                                className="game-button keycap action-prompt__button bid-key bid-key--heart-solo"
                                aria-label="Heart Solo — hearts trump, alone, 3 times stakes"
                            >
                                {renderBidFace('Heart Solo')}
                            </button>
                            <button
                                type="button"
                                onClick={() => emitEvent('placeBid', { bid: 'Pass' })}
                                className="game-button keycap action-prompt__button bid-key bid-key--frog"
                                aria-label="Let the Solo play — your Frog stands down"
                            >
                                {BID_FACES['Frog']}
                                <span className="bid-key__name">Let Solo Play</span>
                            </button>
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
                    <PromptShell variant="card" label="Choose trump suit" nudge={turnNudgeLevel}>
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
            // The widow itself is shown as table art (FrogWidowReveal flies
            // the cards to the middle of the felt) — this is just the small
            // status line.
            const isBidder = !isSpectator && currentTableState.bidWinnerInfo?.userId === playerId;
            if (isBidder) {
                return (
                    <StatusPrompt label="Frog widow exchange">
                        Choose 3 cards from your hand to return to the widow.
                    </StatusPrompt>
                );
            }
            return (
                <StatusPrompt label="Frog widow exchange">
                    <PlayerName>{currentTableState.bidWinnerInfo?.playerName}</PlayerName> is choosing 3 cards to return to the widow…
                </StatusPrompt>
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
