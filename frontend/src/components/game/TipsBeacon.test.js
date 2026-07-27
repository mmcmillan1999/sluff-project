import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import TipsBeacon, { TIP_FLY_MS, resetSeenTipsCacheForTests } from './TipsBeacon';

const { apiMock, mockTips } = vi.hoisted(() => ({
    apiMock: {
        getSeenTips: vi.fn(),
        markTipSeen: vi.fn(),
    },
    // Two tips so the queue/count behavior is exercised; the first mirrors
    // the real fast-play entry's shape (interactive widget included).
    mockTips: [
        { id: 'tip-alpha-2026-07', title: 'Alpha tip headline', body: 'Alpha body.', widget: 'play-style' },
        { id: 'tip-beta-2026-08', title: 'Beta tip headline', body: 'Beta body.' },
    ],
}));

vi.mock('../../services/api', () => apiMock);
vi.mock('../../config/tips', () => ({ TIPS: mockTips }));

// Render and flush the mocked getSeenTips resolution so state settles in act.
const renderBeacon = async (props = {}) => {
    const view = render(<TipsBeacon {...props} />);
    await act(async () => {});
    return view;
};

describe('TipsBeacon', () => {
    beforeEach(() => {
        window.localStorage.clear();
        resetSeenTipsCacheForTests();
        apiMock.getSeenTips.mockReset().mockResolvedValue([]);
        apiMock.markTipSeen.mockReset().mockResolvedValue({});
    });

    test('shows the beacon with the unseen count and opens the first tip', async () => {
        await renderBeacon();

        const beacon = screen.getByRole('button', { name: /new tips/ });
        expect(beacon.textContent).toContain('2');

        fireEvent.click(beacon);
        expect(screen.getByRole('dialog', { name: 'Quick tip' })).toBeInTheDocument();
        expect(screen.getByText('Alpha tip headline')).toBeInTheDocument();
    });

    test('the play-style widget in a tip card actually switches the setting', async () => {
        await renderBeacon();
        fireEvent.click(screen.getByRole('button', { name: /new tips/ }));

        const fastOption = screen.getByRole('button', { name: 'Fast' });
        expect(fastOption).toHaveAttribute('aria-pressed', 'false');

        fireEvent.click(fastOption);
        expect(fastOption).toHaveAttribute('aria-pressed', 'true');
        expect(JSON.parse(window.localStorage.getItem('sluff_card_play_style'))).toBe('fast');
    });

    test('dismissing marks the tip seen server-side and locally, then the next tip queues up', async () => {
        await renderBeacon({ userId: 7 });
        fireEvent.click(screen.getByRole('button', { name: /new tips/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Dismiss tip' }));
        await act(async () => {}); // flush the deferred markTipSeen call

        expect(apiMock.markTipSeen).toHaveBeenCalledWith(mockTips[0].id);
        // Per-account local receipt, so a shared device never hides another player's tips.
        expect(JSON.parse(window.localStorage.getItem('sluff_tips_seen:7'))).toContain(mockTips[0].id);
        // No hamburger button exists in this DOM, so the card closes without a flight.
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

        // One tip remains; clicking the beacon again surfaces it.
        const beacon = screen.getByRole('button', { name: /new tip$/ });
        expect(beacon.textContent).toContain('1');
        fireEvent.click(beacon);
        expect(screen.getByText('Beta tip headline')).toBeInTheDocument();
    });

    test('Escape closes the card without dismissing the tip', async () => {
        await renderBeacon();
        fireEvent.click(screen.getByRole('button', { name: /new tips/ }));

        const card = screen.getByRole('dialog', { name: 'Quick tip' });
        fireEvent.keyDown(card, { key: 'Escape' });

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(apiMock.markTipSeen).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: /new tips/ }).textContent).toContain('2');
    });

    test('with a hamburger present the dismissed card flies to it, ignoring beacon clicks mid-flight', async () => {
        vi.useFakeTimers();
        try {
            const menuButton = document.createElement('button');
            menuButton.className = 'game-header-menu-btn';
            menuButton.getBoundingClientRect = () => ({ left: 900, top: 10, width: 44, height: 44 });
            document.body.appendChild(menuButton);

            await renderBeacon();
            fireEvent.click(screen.getByRole('button', { name: /new tips/ }));
            fireEvent.click(screen.getByRole('button', { name: 'Dismiss tip' }));

            // Mid-flight: the card is still mounted, shrinking toward the menu.
            const card = screen.getByRole('dialog', { name: 'Quick tip' });
            expect(card.className).toContain('is-flying');
            expect(card.style.transform).toContain('scale(0.08)');

            // A beacon click during the flight must not abort it into a ghost.
            fireEvent.click(screen.getByRole('button', { name: /new tip$/ }));
            expect(screen.getByRole('dialog', { name: 'Quick tip' })).toBe(card);
            expect(card.className).toContain('is-flying');

            act(() => vi.advanceTimersByTime(TIP_FLY_MS));
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
            // The remaining tip is still advertised.
            expect(screen.getByRole('button', { name: /new tip$/ }).textContent).toContain('1');

            menuButton.remove();
        } finally {
            vi.useRealTimers();
        }
    });

    test('tips already seen on the server never surface', async () => {
        apiMock.getSeenTips.mockResolvedValue(mockTips.map(tip => tip.id));
        await renderBeacon();

        await waitFor(() => {
            expect(screen.queryByRole('button', { name: /new tip/ })).not.toBeInTheDocument();
        });
    });

    test('a locally-dismissed tip stays dismissed when the server is unreachable', async () => {
        apiMock.getSeenTips.mockRejectedValue(new Error('offline'));
        window.localStorage.setItem('sluff_tips_seen:7', JSON.stringify(mockTips.map(tip => tip.id)));

        await renderBeacon({ userId: 7 });
        expect(screen.queryByRole('button', { name: /new tip/ })).not.toBeInTheDocument();
    });

    test('offline dismissals are pushed back to the server once it is reachable', async () => {
        // The local receipt exists but the server never heard about it.
        window.localStorage.setItem('sluff_tips_seen:7', JSON.stringify([mockTips[0].id]));
        apiMock.getSeenTips.mockResolvedValue([]);

        await renderBeacon({ userId: 7 });
        await waitFor(() => {
            expect(apiMock.markTipSeen).toHaveBeenCalledWith(mockTips[0].id);
        });
    });

    test('the seen-tips fetch is cached across remounts (the beacon remounts every round)', async () => {
        const first = await renderBeacon();
        first.unmount();
        await renderBeacon();

        expect(apiMock.getSeenTips).toHaveBeenCalledTimes(1);
    });
});

describe('tips registry', () => {
    test('the real registry leads with the fast-play tip', async () => {
        const { TIPS: realTips } = await vi.importActual('../../config/tips');
        expect(realTips[0].id).toBe('fast-play-style-2026-07');
        expect(realTips[0].widget).toBe('play-style');
        expect(realTips.every(tip => /^[a-z0-9][a-z0-9-]{0,63}$/.test(tip.id))).toBe(true);
    });
});
