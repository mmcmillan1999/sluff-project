// backend/src/core/afkTurnTimer.js
//
// A soft turn timer for present-but-idle players.
//
// The forfeit timer only ever covered DISCONNECTED seats. A player whose phone
// is still connected but face-down on a table froze the game indefinitely, and
// with public matchmaking against strangers that is not an edge case — it is
// most Tuesday evenings. The client already escalates a turn nudge at 5s and
// 15s; this is what happens when that goes unanswered.
//
// The action taken is deliberately the least damaging one available rather than
// the cleverest: Pass a bid, and play the lowest-value legal card. Auto-play
// should cost the absent player as little as possible while unblocking everyone
// who is still at the table, and it must never look like the server tried to
// play well on their behalf.

const { getLegalMoves } = require('./legalMoves');
const { CARD_POINT_VALUES } = require('./constants');

const DEFAULT_TIMEOUT_MS = 45_000;

// The cheapest legal card is the one that surrenders the fewest points, so the
// scoring table is the authority — a local copy would silently drift the day
// the card values change.
const CARD_POINTS = CARD_POINT_VALUES;
const RANK_ORDER = ['6', '7', '8', '9', 'J', 'Q', 'K', '10', 'A'];

const rankOf = card => String(card).slice(0, -1);

function cardCost(card) {
    const rank = rankOf(card);
    // Points first, then raw rank: between two pointless cards the lower one
    // is likelier to lose the trick, which is what "least damaging" means here.
    return (CARD_POINTS[rank] || 0) * 100 + RANK_ORDER.indexOf(rank);
}

/** The card an absent player forfeits least by playing. */
function cheapestLegalCard(legalMoves) {
    if (!Array.isArray(legalMoves) || legalMoves.length === 0) return null;
    return [...legalMoves].sort((left, right) => cardCost(left) - cardCost(right))[0];
}

/**
 * Identifies who the table is waiting on, if anyone, and what would be done for
 * them. Returns null when nobody is blocking — including when the pending seat
 * is a bot (the bot loop owns those) or a disconnected human (the forfeit timer
 * owns those).
 */
function pendingHumanAction(engine) {
    if (!engine || !engine.gameStarted) return null;
    // A vote in flight is its own timed interaction; do not race it.
    if (engine.drawRequest?.isActive || engine.playoutVote?.isActive) return null;

    if (engine.state === 'Bidding Phase' && engine.biddingTurnPlayerId != null) {
        const player = engine.players?.[engine.biddingTurnPlayerId];
        if (!player || player.isBot || player.disconnected) return null;
        return { userId: engine.biddingTurnPlayerId, kind: 'bid', playerName: player.playerName };
    }

    if (engine.state === 'Playing Phase' && engine.trickTurnPlayerId != null) {
        const player = engine.players?.[engine.trickTurnPlayerId];
        if (!player || player.isBot || player.disconnected) return null;
        return { userId: engine.trickTurnPlayerId, kind: 'play', playerName: player.playerName };
    }

    return null;
}

/**
 * A value that changes exactly when the table starts waiting on someone new, so
 * the clock restarts on a genuinely new turn rather than on unrelated state
 * churn (an insurance tick, a chat message, a reconnect).
 */
function turnKey(engine, pending) {
    if (!pending) return null;
    return [
        engine.state,
        pending.userId,
        engine.tricksPlayedCount ?? 0,
        engine.currentTrickCards?.length ?? 0,
        engine.playersWhoPassedThisRound?.length ?? 0,
    ].join('|');
}

/**
 * Advances the timer for one engine. Pure bookkeeping plus a decision — the
 * caller performs the action, so this stays testable without a live table.
 *
 * @returns {{action: 'bid'|'play', userId: number, bid?: string, card?: string,
 *            playerName: string} | null}
 */
function evaluate(engine, { now = Date.now(), timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const pending = pendingHumanAction(engine);
    const key = turnKey(engine, pending);

    if (!pending) {
        engine.afkWatch = null;
        return null;
    }

    if (!engine.afkWatch || engine.afkWatch.key !== key) {
        engine.afkWatch = { key, since: now };
        return null;
    }

    if (now - engine.afkWatch.since < timeoutMs) return null;

    // Re-arm before acting: whatever happens next, this turn must not fire
    // twice, and the next turn gets a full window.
    engine.afkWatch = { key, since: now };

    if (pending.kind === 'bid') {
        return { action: 'bid', userId: pending.userId, bid: 'Pass', playerName: pending.playerName };
    }

    const hand = engine.hands?.[pending.playerName] || [];
    const legal = getLegalMoves(
        hand,
        (engine.currentTrickCards?.length ?? 0) === 0,
        engine.leadSuitCurrentTrick,
        engine.trumpSuit,
        engine.trumpBroken,
    );
    const card = cheapestLegalCard(legal);
    if (!card) return null;
    return { action: 'play', userId: pending.userId, card, playerName: pending.playerName };
}

/** Epoch ms at which the pending seat will be acted for, or null. */
function deadlineFor(engine, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    if (!engine?.afkWatch) return null;
    const pending = pendingHumanAction(engine);
    if (!pending || turnKey(engine, pending) !== engine.afkWatch.key) return null;
    return engine.afkWatch.since + timeoutMs;
}

/**
 * The pending player showed signs of life — restart their clock.
 *
 * The timer's own doc says it exists for the player who has STOPPED touching
 * the screen, but the server cannot see touches, only completed actions — so
 * without this, "idle" silently meant "elapsed turn time" and a present player
 * thinking through a hard trick got auto-played at 45s. That is exactly the
 * feedback that came in: "the game plays itself for you." The client now sends
 * a throttled activity ping while its owner is interacting, and only the
 * player actually on turn can extend their own clock.
 *
 * @returns {boolean} whether the clock was extended
 */
function refresh(engine, userId, { now = Date.now() } = {}) {
    const pending = pendingHumanAction(engine);
    if (!pending || Number(pending.userId) !== Number(userId)) return false;
    if (!engine.afkWatch || engine.afkWatch.key !== turnKey(engine, pending)) return false;
    engine.afkWatch.since = now;
    return true;
}

module.exports = {
    CARD_POINTS,
    DEFAULT_TIMEOUT_MS,
    cardCost,
    cheapestLegalCard,
    deadlineFor,
    evaluate,
    pendingHumanAction,
    refresh,
    turnKey,
};
