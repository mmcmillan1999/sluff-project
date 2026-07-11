'use strict';

/**
 * Produce the state a single socket is allowed to see.
 *
 * The GameEngine's legacy getStateForClient() method returns one shared state
 * object containing every hand and every widow card.  This serializer is
 * intentionally viewer-specific: callers must invoke it once per recipient,
 * never once per Socket.IO room.
 *
 * viewerContext:
 *   - userId: the authenticated viewer's user id
 *   - isAdmin: true only when derived from the server-verified identity
 *   - trustedAdminObserver: an explicit opt-in to unredacted observer state
 *
 * Both admin flags must be exactly true for trusted observer access.  Merely
 * being an admin spectator is not enough, which keeps ordinary spectating
 * safe if a caller forwards the authenticated user's admin flag by default.
 */
function serializeGameState(game, viewerContext = {}) {
    const rawStateProvider = game?._getRawStateForClient || game?.getStateForClient;
    if (typeof rawStateProvider !== 'function') {
        throw new TypeError('serializeGameState requires a game state provider');
    }

    const rawState = rawStateProvider.call(game);
    const state = structuredClone(rawState);
    const viewer = findViewer(state.players, viewerContext.userId);
    const isTrustedAdminObserver = viewerContext.isAdmin === true
        && viewerContext.trustedAdminObserver === true;

    // Socket ids are routing details, not client game state.  Removing them
    // also means the trusted observer option grants card visibility only.
    for (const player of Object.values(state.players || {})) {
        if (!player || typeof player !== 'object') continue;
        delete player.socketId;
        if (!sameUserId(player.userId, viewerContext.userId)) delete player.tokens;
    }

    if (!isTrustedAdminObserver) {
        state.hands = visibleHands(state.hands, viewer);

        const canPeekAsSittingDealer = isFourPlayerSittingDealer(state, viewer);
        const widowIsPublic = isWidowPublic(state);

        if (!canPeekAsSittingDealer && !widowIsPublic) {
            state.widow = [];
            state.originalDealtWidow = [];
            state.widowDiscardsForFrogBidder = [];
        }
    }

    return state;
}

function findViewer(players, userId) {
    if (userId === undefined || userId === null) return null;

    return Object.values(players || {}).find(player => (
        player && sameUserId(player.userId, userId)
    )) || null;
}

function visibleHands(hands, viewer) {
    if (!viewer || viewer.isSpectator || !viewer.playerName) return {};

    const ownHand = hands?.[viewer.playerName];
    return Array.isArray(ownHand)
        ? { [viewer.playerName]: ownHand }
        : {};
}

function isFourPlayerSittingDealer(state, viewer) {
    if (!viewer || viewer.isSpectator || state.playerMode !== 4 || state.gameStarted !== true) {
        return false;
    }

    if (!sameUserId(state.dealer, viewer.userId)) return false;

    // In four-player Sluff the dealer is permitted to peek only while sitting
    // out.  Checking the active trio prevents a malformed state from granting
    // the active dealer hidden-widow access.
    return !(state.playerOrderActive || []).includes(viewer.playerName);
}

function isWidowPublic(state) {
    if (state.state === 'AllPassWidowReveal') return true;

    // A populated round summary is the engine's authoritative signal that the
    // widow has been revealed for scoring.  The summary itself remains public.
    return Array.isArray(state.roundSummary?.widowForReveal);
}

function sameUserId(left, right) {
    if (left === undefined || left === null || right === undefined || right === null) {
        return false;
    }
    return String(left) === String(right);
}

module.exports = {
    serializeGameState,
};
