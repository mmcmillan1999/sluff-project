import React from 'react';
import { act, render, renderHook, screen } from '@testing-library/react';
import TournamentClockPill from './TournamentClockPill';
import { NUDGE_AT_MS, useTurnNudge } from '../../hooks/useTurnNudge';

test('the pill shows the shot clock and the viewer\'s bank, and turns red on the clock', () => {
    const { rerender } = render(<TournamentClockPill clock={{ onTheClock: false, banks: { Ada: 31 }, freeSeconds: { play: 6, bid: 12 }, bankSeconds: 45 }} playerName="Ada" />);
    expect(screen.getByRole('status')).toHaveTextContent('Shot clock · 6 s a card');
    expect(screen.getByRole('status')).toHaveTextContent('Bank 31 s');
    expect(screen.getByRole('status')).toHaveAttribute('data-on-the-clock', 'false');
    rerender(<TournamentClockPill clock={{ onTheClock: true, banks: { Ada: 12 }, freeSeconds: { play: 4, bid: 8 }, bankSeconds: 45 }} playerName="Ada" />);
    expect(screen.getByRole('status')).toHaveTextContent('On the clock · 4 s a card');
    expect(screen.getByRole('status')).toHaveAttribute('data-on-the-clock', 'true');
    rerender(<TournamentClockPill clock={null} playerName="Ada" />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

test('with an authoritative server clock the countdown ignores local activity', () => {
    vi.useFakeTimers();
    try {
        const start = Date.now();
        const deadline = start + 20_000;
        const { result } = renderHook(() => useTurnNudge({
            actionKey: 'turn-1',
            afkDeadline: deadline,
            afkTimeoutMs: 51_750,
            serverAuthoritative: true,
        }));
        act(() => { vi.advanceTimersByTime(NUDGE_AT_MS + 250); });
        expect(result.current.level).toBe(1);
        // A tap resets the nudge level but not the server's clock.
        act(() => { window.dispatchEvent(new Event('pointerdown')); });
        act(() => { vi.advanceTimersByTime(NUDGE_AT_MS + 250); });
        expect(result.current.level).toBe(1);
        const elapsed = Date.now() - start;
        expect(result.current.afkSecondsLeft).toBe(Math.ceil((deadline - start - elapsed) / 1000));
        expect(result.current.afkSecondsLeft).toBeLessThan(20);
    } finally {
        vi.useRealTimers();
    }
});
