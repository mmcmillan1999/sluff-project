import { act, renderHook } from '@testing-library/react';
import { BID_SPLASH_DELAY_MS, useBidWinnerSplash } from './useBidWinnerSplash';

const makeState = (state) => ({
    state,
    bidWinnerInfo: { playerName: 'Alice', bid: 'Solo' },
    trumpSuit: 'S',
    playerOrderActive: ['Alice', 'Bob', 'Cara']
});

describe('useBidWinnerSplash', () => {
    beforeEach(() => vi.useFakeTimers());

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    test('cancels a pending splash when the announcement is interrupted', () => {
        const { result, rerender } = renderHook(
            ({ tableState }) => useBidWinnerSplash(tableState, false),
            { initialProps: { tableState: makeState('Bidding Phase') } }
        );

        rerender({ tableState: makeState('Bid Announcement') });
        act(() => vi.advanceTimersByTime(BID_SPLASH_DELAY_MS - 1));
        expect(result.current.bidSplashInfo).toBeNull();

        rerender({ tableState: makeState('Game Over') });
        act(() => vi.runAllTimers());
        expect(result.current.bidSplashInfo).toBeNull();
    });

    test('dismisses an already mounted splash as soon as play leaves the announcement', () => {
        const { result, rerender } = renderHook(
            ({ tableState }) => useBidWinnerSplash(tableState, false),
            { initialProps: { tableState: makeState('Trump Selection') } }
        );

        rerender({ tableState: makeState('Bid Announcement') });
        act(() => vi.advanceTimersByTime(BID_SPLASH_DELAY_MS));
        expect(result.current.bidSplashInfo).toEqual({
            playerName: 'Alice',
            bid: 'Solo',
            trumpSuit: 'S',
            defenders: ['Bob', 'Cara']
        });

        rerender({ tableState: makeState('Playing Phase') });
        expect(result.current.bidSplashInfo).toBeNull();
    });
});
