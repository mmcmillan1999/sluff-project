// backend/src/serialization/gameResume.js
//
// Full-fidelity engine snapshots so live games survive a deploy. On SIGTERM
// the dying instance serializes every resumable game to live_game_snapshots;
// the replacement instance restores them (boot pass + a short sweep, because
// Render boots the new instance BEFORE the old one receives SIGTERM) and
// players reconnect into the same trick they left.
//
// Serialization normalizes transient presentation states to their settled
// equivalent (a trick linger is saved as "linger finished", the bid fanfare
// as "play begun") so a restore never depends on a timer that died with the
// old process. States owned by an in-flight database settlement are refused
// — those games stay with abandonedGameRecovery's refund path.

'use strict';

const BotPlayer = require('../core/BotPlayer');

const RESUME_VERSION = 1;

const RESUMABLE_STATES = new Set([
    'Dealing Pending',
    'Bidding Phase',
    'Awaiting Frog Upgrade Decision',
    'Frog Widow Exchange',
    'Trump Selection',
    'Bid Announcement',
    'Playing Phase',
    'TrickCompleteLinger',
    'DrawDeclined',
    'AllPassWidowReveal',
    'Awaiting Next Round Trigger',
]);

// Plain JSON-safe fields copied verbatim in both directions.
const COPY_FIELDS = [
    'playerMode', 'gameId', 'dealer', 'roundHistory',
    'hands', 'widow', 'originalDealtWidow',
    'biddingTurnPlayerId', 'currentHighestBidDetails', 'playersWhoPassedThisRound',
    'bidWinnerInfo', 'trumpSuit', 'trumpBroken',
    'originalFrogBidderId', 'soloBidMadeAfterFrog',
    'revealedWidowForFrog', 'widowDiscardsForFrogBidder',
    'trickLeaderId', 'lastCompletedTrick', 'tricksPlayedCount', 'capturedTricks',
    'bidderCardPoints', 'defenderCardPoints', 'allCardsPlayedThisRound',
    'insurance', 'roundSummary', 'roundWrappedEarly',
    // Midnight Special: the once-per-round guard must survive a deploy (or a
    // restored round could celebrate the same run twice), and the rider stamp
    // feeds the round-history entry written at scoring.
    'midnightSpecialFired', 'midnightSpecialRider',
];

/**
 * Serialize a live engine into a resume snapshot, or null when the game is
 * not in a state that can be safely brought back (not started, settling,
 * or already terminal).
 */
function serializeEngineForResume(engine) {
    if (!engine?.gameStarted || engine.gameStartPending || !engine.gameId) return null;
    if (!RESUMABLE_STATES.has(engine.state)) return null;
    if (engine.settlement && !['idle', 'complete'].includes(engine.settlement.status)) return null;

    // Normalize timer-held presentation states to what their timer would
    // have produced, so restore lands on a state that waits for a player
    // action instead of a dead callback.
    let state = engine.state;
    let trickTurnPlayerId = engine.trickTurnPlayerId;
    let currentTrickCards = engine.currentTrickCards;
    let leadSuitCurrentTrick = engine.leadSuitCurrentTrick;
    if (state === 'TrickCompleteLinger') {
        state = 'Playing Phase';
        currentTrickCards = [];
        leadSuitCurrentTrick = null;
        // resolveTrick already promoted the winner to trick leader.
        trickTurnPlayerId = engine.trickLeaderId;
    } else if (state === 'Bid Announcement' || state === 'DrawDeclined') {
        state = 'Playing Phase';
    }

    const snapshot = {
        v: RESUME_VERSION,
        state,
        trickTurnPlayerId,
        currentTrickCards,
        leadSuitCurrentTrick,
        qpPhase: engine.qpPhase,
        qpGeneration: engine.qpGeneration,
        allIds: engine.playerOrder.allIds,
        turnOrder: engine.playerOrder.turnOrder,
        scores: { ...engine.scores },
        players: Object.values(engine.players).map(player => ({
            userId: player.userId,
            playerName: player.playerName,
            isBot: player.isBot === true,
            isSpectator: player.isSpectator === true,
            wasExplicitSpectator: player.wasExplicitSpectator === true,
            tokens: player.tokens,
        })),
    };
    for (const field of COPY_FIELDS) snapshot[field] = engine[field];
    return JSON.parse(JSON.stringify(snapshot));
}

/**
 * Rebuild a game inside a fresh engine from a resume snapshot.
 * Returns true on success; false leaves the engine untouched enough to keep
 * serving its table (the game then falls to the recovery refund path).
 */
function restoreEngineFromResume(engine, snapshot) {
    if (!engine || snapshot?.v !== RESUME_VERSION) return false;
    if (engine.gameStarted || engine.gameStartPending) return false;
    // A human already seated pregame owns the table's future; never clobber.
    if (Object.values(engine.players).some(p => !p.isBot)) return false;

    // The exhibition manager may have seated lobby bots meanwhile; clear them
    // (removeBotPlayer also releases their seat leases).
    for (const player of Object.values(engine.players)) {
        if (player.isBot) engine.removeBotPlayer(player.userId);
    }

    engine.players = {};
    for (const saved of snapshot.players) {
        engine.players[saved.userId] = {
            userId: saved.userId,
            playerName: saved.playerName,
            socketId: null,
            tokens: saved.tokens,
            isSpectator: saved.isSpectator === true,
            // Humans must reconnect; bots are immediately live again. The
            // resumePending flag lets the socket action guard adopt the
            // owner's connection even when it attached before this restore
            // ran; any reconnect path clears it.
            disconnected: saved.isBot !== true,
            ...(saved.isBot ? {} : { resumePending: true }),
            ...(saved.isBot ? { isBot: true } : {}),
            ...(saved.wasExplicitSpectator ? { wasExplicitSpectator: true } : {}),
        };
    }
    engine.scores = { ...snapshot.scores };
    engine.playerOrder.restore(snapshot.allIds, snapshot.turnOrder);

    // Fresh transient state (timers, votes, forfeiture) before layering the
    // saved round back on top.
    engine._initializeNewRoundState();

    engine.gameStarted = true;
    engine.gameStartPending = false;
    engine.settlement = engine._newSettlementState();
    for (const field of COPY_FIELDS) engine[field] = snapshot[field];
    engine.trickTurnPlayerId = snapshot.trickTurnPlayerId;
    engine.currentTrickCards = snapshot.currentTrickCards || [];
    engine.leadSuitCurrentTrick = snapshot.leadSuitCurrentTrick ?? null;
    if (engine.tableType === 'quickplay') {
        engine.qpPhase = snapshot.qpPhase;
        engine.qpGeneration = snapshot.qpGeneration;
    }

    engine.bots = {};
    for (const saved of snapshot.players) {
        if (!saved.isBot) continue;
        engine.bots[saved.userId] = new BotPlayer(saved.userId, saved.playerName, engine);
        // Re-claim persistent seats so matchmaking/exhibition cannot seat the
        // same principal at a second table while this game is live.
        if (Number.isInteger(saved.userId) && saved.userId > 0 && engine.botSeatLease) {
            engine.botSeatLease.acquire(saved.userId);
        }
    }

    engine.state = snapshot.state;
    // The 3-second all-pass reveal died with its timer; perform what it was
    // about to do: rotate the dealer and re-deal.
    if (engine.state === 'AllPassWidowReveal') engine._advanceRound();
    engine.turnStartedAt = Date.now();
    return true;
}

module.exports = {
    RESUME_VERSION,
    RESUMABLE_STATES,
    serializeEngineForResume,
    restoreEngineFromResume,
};
