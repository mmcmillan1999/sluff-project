import { useCallback, useEffect, useRef, useState } from 'react';

export const BID_SPLASH_DELAY_MS = 1700;

const PRE_PLAY_STATES = new Set([
    'Bidding Phase',
    'Awaiting Frog Upgrade Decision',
    'Frog Widow Exchange',
    'Trump Selection'
]);

const buildSplashInfo = (tableState) => ({
    playerName: tableState.bidWinnerInfo.playerName,
    bid: tableState.bidWinnerInfo.bid,
    trumpSuit: tableState.trumpSuit,
    // The active roster excludes the sitting-out dealer in four-player rounds.
    defenders: (tableState.playerOrderActive || []).filter(
        name => name !== tableState.bidWinnerInfo.playerName
    )
});

// Owns the delayed mount as well as the mounted splash. Any transition away
// from Bid Announcement clears both immediately, so an interrupted round can
// never replay stale names or sounds over the next table state.
export const useBidWinnerSplash = (currentTableState, prefersReducedMotion) => {
    const [bidSplashInfo, setBidSplashInfo] = useState(null);
    const previousStateRef = useRef(null);
    const latestStateRef = useRef(currentTableState?.state);
    const pendingTimerRef = useRef(null);
    latestStateRef.current = currentTableState?.state;

    const clearPendingTimer = useCallback(() => {
        if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
    }, []);

    const dismissBidSplash = useCallback(() => setBidSplashInfo(null), []);

    useEffect(() => {
        const state = currentTableState?.state;

        if (prefersReducedMotion || state !== 'Bid Announcement') {
            clearPendingTimer();
            setBidSplashInfo(null);
            previousStateRef.current = state;
            return;
        }

        if (PRE_PLAY_STATES.has(previousStateRef.current) && currentTableState?.bidWinnerInfo) {
            clearPendingTimer();
            const info = buildSplashInfo(currentTableState);
            pendingTimerRef.current = setTimeout(() => {
                pendingTimerRef.current = null;
                if (latestStateRef.current === 'Bid Announcement') {
                    setBidSplashInfo(info);
                }
            }, BID_SPLASH_DELAY_MS);
        }

        previousStateRef.current = state;
    }, [clearPendingTimer, currentTableState, prefersReducedMotion]);

    useEffect(() => clearPendingTimer, [clearPendingTimer]);

    const visibleBidSplashInfo = !prefersReducedMotion
        && currentTableState?.state === 'Bid Announcement'
        ? bidSplashInfo
        : null;

    return { bidSplashInfo: visibleBidSplashInfo, dismissBidSplash };
};

export default useBidWinnerSplash;
