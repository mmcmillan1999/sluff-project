import React from 'react';
import { act, render, screen } from '@testing-library/react';
import BidWinnerSplash, { BID_SPLASH_TIMING } from './BidWinnerSplash';
import PlayerSeatPositioner from './PlayerSeatPositioner';

const threePlayerSeats = {
    self: 'Alice',
    opponentLeft: 'Bob',
    opponentRight: 'Cara',
    opponentAcross: null
};

describe('BidWinnerSplash', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    test('runs the condensed sound, fly, and completion timeline', () => {
        const playSound = vi.fn();
        const onDone = vi.fn();
        const { container } = render(
            <BidWinnerSplash
                info={{ playerName: 'Alice', bid: 'Solo', trumpSuit: 'S', defenders: ['Bob', 'Cara'] }}
                seatAssignments={threePlayerSeats}
                playSound={playSound}
                onDone={onDone}
            />
        );

        const overlay = container.querySelector('.bid-splash-overlay');
        expect(overlay).not.toHaveClass('flying');

        act(() => vi.advanceTimersByTime(BID_SPLASH_TIMING.BID_SOUND_AT));
        expect(playSound).toHaveBeenNthCalledWith(1, 'bidSolo');

        act(() => vi.advanceTimersByTime(
            BID_SPLASH_TIMING.SUIT_SOUND_AT - BID_SPLASH_TIMING.BID_SOUND_AT
        ));
        expect(playSound).toHaveBeenNthCalledWith(2, 'suitSpades');

        act(() => vi.advanceTimersByTime(
            BID_SPLASH_TIMING.FLY_AT - BID_SPLASH_TIMING.SUIT_SOUND_AT
        ));
        expect(overlay).toHaveClass('flying');
        expect(onDone).not.toHaveBeenCalled();

        act(() => vi.advanceTimersByTime(
            BID_SPLASH_TIMING.DONE_AT - BID_SPLASH_TIMING.FLY_AT
        ));
        expect(onDone).toHaveBeenCalledTimes(1);
    });

    test('uses the two three-player opponents as fallback defenders', () => {
        const { container } = render(
            <BidWinnerSplash
                info={{ playerName: 'Alice', bid: 'Frog', trumpSuit: 'H' }}
                seatAssignments={threePlayerSeats}
                playSound={vi.fn()}
                onDone={vi.fn()}
            />
        );

        expect(screen.getByText('Alice')).toBeInTheDocument();
        expect(screen.getByText('FROG')).toBeInTheDocument();
        expect(container.querySelectorAll('.bid-splash-name.defender')).toHaveLength(2);
        expect(screen.getByText('Bob')).toBeInTheDocument();
        expect(screen.getByText('Cara')).toBeInTheDocument();
    });

    test('renders only active defenders in four-player mode and excludes the sitting dealer', () => {
        const { container } = render(
            <BidWinnerSplash
                info={{
                    playerName: 'Extremely Long Bidder Name That Must Stay Contained',
                    bid: 'Heart Solo',
                    trumpSuit: 'H',
                    defenders: ['Bob', 'Cara']
                }}
                seatAssignments={{
                    self: 'Extremely Long Bidder Name That Must Stay Contained',
                    opponentLeft: 'Bob',
                    opponentRight: 'Cara',
                    opponentAcross: 'Dealer Drew'
                }}
                playSound={vi.fn()}
                onDone={vi.fn()}
            />
        );

        expect(container.querySelectorAll('.bid-splash-name.defender')).toHaveLength(2);
        expect(screen.queryByText('Dealer Drew')).not.toBeInTheDocument();
        expect(screen.getByText('Extremely Long Bidder Name That Must Stay Contained'))
            .toHaveClass('bid-splash-playername');
    });

    test('flies to the effective wide-mode seat anchors on a portrait phone', () => {
        const originalWidth = window.innerWidth;
        const originalHeight = window.innerHeight;
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });

        const StubSeat = ({ playerName }) => <div>{playerName}</div>;
        const { container } = render(
            <>
                <PlayerSeatPositioner playerName="Alice" seatPosition="bottom" PlayerSeat={StubSeat} />
                <PlayerSeatPositioner playerName="Bob" seatPosition="left" PlayerSeat={StubSeat} />
                <PlayerSeatPositioner playerName="Cara" seatPosition="right" PlayerSeat={StubSeat} />
                <BidWinnerSplash
                    info={{ playerName: 'Alice', bid: 'Frog', defenders: ['Bob', 'Cara'] }}
                    seatAssignments={threePlayerSeats}
                    playSound={vi.fn()}
                    onDone={vi.fn()}
                />
            </>
        );

        expect(container.querySelector('.player-seat-bottom')).toHaveAttribute('data-anchor-y', '66.5');
        expect(container.querySelector('.player-seat-left')).toHaveAttribute('data-anchor-x', '1');
        expect(container.querySelector('.player-seat-right')).toHaveAttribute('data-anchor-x', '99');

        act(() => vi.advanceTimersByTime(BID_SPLASH_TIMING.FLY_AT));

        expect(container.querySelector('.bid-splash-name.bidder'))
            .toHaveStyle({ left: '50vw', top: '66.5vh' });
        const defenders = container.querySelectorAll('.bid-splash-name.defender');
        expect(defenders[0]).toHaveStyle({ left: '1vw', top: '35vh' });
        expect(defenders[1]).toHaveStyle({ left: '99vw', top: '35vh' });

        Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalHeight });
    });

    test('clears every pending callback when unmounted', () => {
        const playSound = vi.fn();
        const onDone = vi.fn();
        const { unmount } = render(
            <BidWinnerSplash
                info={{ playerName: 'Alice', bid: 'Solo', trumpSuit: 'D', defenders: ['Bob', 'Cara'] }}
                seatAssignments={threePlayerSeats}
                playSound={playSound}
                onDone={onDone}
            />
        );

        unmount();
        act(() => vi.runAllTimers());

        expect(playSound).not.toHaveBeenCalled();
        expect(onDone).not.toHaveBeenCalled();
    });
});
