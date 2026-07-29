// frontend/src/utils/pendingSelfAction.js
// The one decision, if any, the table is currently waiting on from the local
// player. Turn cues escalate against this single answer so every surface
// agrees on what "you're up" means and the nudge points at exactly one place
// on screen. Insurance is deliberately absent: it runs alongside the Playing
// Phase and is never the thing blocking the table.

export const getPendingSelfAction = (tableState, selfPlayerName, playerId) => {
    if (!tableState || !selfPlayerName) return null;

    switch (tableState.state) {
        case 'Bidding Phase':
            return tableState.biddingTurnPlayerName === selfPlayerName
                ? { kind: 'bid', surface: 'prompt' }
                : null;
        case 'Awaiting Frog Upgrade Decision':
            return tableState.biddingTurnPlayerName === selfPlayerName
                ? { kind: 'frogUpgrade', surface: 'prompt' }
                : null;
        case 'Trump Selection':
            return tableState.bidWinnerInfo?.userId === playerId
                ? { kind: 'trump', surface: 'prompt' }
                : null;
        case 'Frog Widow Exchange':
            return tableState.bidWinnerInfo?.userId === playerId
                ? { kind: 'frogDiscard', surface: 'hand' }
                : null;
        case 'Playing Phase':
            return tableState.trickTurnPlayerName === selfPlayerName
                ? { kind: 'play', surface: 'hand' }
                : null;
        default:
            return null;
    }
};

// Changes exactly when a new decision lands on the player, so the idle clock
// restarts on a genuinely new turn rather than on unrelated table chatter —
// another seat's insurance tick, a chat message, a score update.
export const pendingActionKey = (tableState, pendingAction) => {
    if (!pendingAction || !tableState) return null;
    return [
        pendingAction.kind,
        tableState.tricksPlayedCount ?? 0,
        tableState.currentTrickCards?.length ?? 0,
        tableState.playersWhoPassedThisRound?.length ?? 0,
        tableState.currentHighestBidDetails?.bid ?? ''
    ].join('|');
};
