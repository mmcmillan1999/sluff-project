// The Midnight Special production: phase timing under fake timers — the
// title gives way to karaoke lines on the score's cues, the spotlight lands
// with "shine a light on me" aimed at the runner's seat, and the whole
// production begins its fade on schedule. The train itself is rAF-driven
// scenery; these tests pin the choreography around it.
import React from 'react';
import { act, render, screen } from '@testing-library/react';
import MidnightSpecialBanner, { MIDNIGHT_SPECIAL_TOTAL_MS } from './MidnightSpecialBanner';
import { MIDNIGHT_TIMELINE } from '../../utils/soundSynth';

describe('MidnightSpecialBanner', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    const renderBanner = () => render(
        <>
            <div data-seat-player="Grampa Blane" style={{ position: 'fixed', top: 100, left: 200 }} />
            <MidnightSpecialBanner playerName="Grampa Blane" />
        </>,
    );

    test('the choreography follows the score timeline', () => {
        renderBanner();

        // Curtain up: title and departure line.
        expect(screen.getByText('THE MIDNIGHT SPECIAL')).toBeInTheDocument();
        expect(screen.getByText('Grampa Blane has left the station')).toBeInTheDocument();
        expect(document.querySelector('.midnight-special__spotlight')).toBeNull();

        // First line of the chorus replaces the departure notice.
        act(() => vi.advanceTimersByTime(MIDNIGHT_TIMELINE.line1 * 1000 + 50));
        expect(screen.getByText(/Let the Midnight Special/)).toBeInTheDocument();
        expect(screen.queryByText(/left the station/)).toBeNull();

        // "...shine a light on me" — the spotlight lands.
        act(() => vi.advanceTimersByTime((MIDNIGHT_TIMELINE.spotlight - MIDNIGHT_TIMELINE.line1) * 1000 + 50));
        expect(screen.getByText(/shine a light on me/)).toBeInTheDocument();
        expect(document.querySelector('.midnight-special__spotlight')).not.toBeNull();

        // The finale line, then the fade begins — but the production is
        // still mounted until its host takes it down at the total.
        act(() => vi.advanceTimersByTime((MIDNIGHT_TIMELINE.fade - MIDNIGHT_TIMELINE.spotlight) * 1000 + 50));
        expect(screen.getByText(/ever-lovin/)).toBeInTheDocument();
        expect(document.querySelector('.midnight-special.is-fading')).not.toBeNull();
    });

    test('the host teardown constant covers the full production', () => {
        expect(MIDNIGHT_SPECIAL_TOTAL_MS).toBe(MIDNIGHT_TIMELINE.total * 1000);
        expect(MIDNIGHT_SPECIAL_TOTAL_MS).toBeGreaterThan(MIDNIGHT_TIMELINE.fade * 1000);
    });

    test('renders nothing without a runner', () => {
        render(<MidnightSpecialBanner playerName={null} />);
        expect(document.querySelector('.midnight-special')).toBeNull();
    });
});
