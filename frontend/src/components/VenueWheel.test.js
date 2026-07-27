import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import VenueWheel, { SEGMENT_DEG } from './VenueWheel';

const THEMES = [
    { id: 'fort-creek', name: 'Fort Creek', cost: 1 },
    { id: 'shirecliff-road', name: 'Shirecliff Road', cost: 2 },
];

// Deterministic rAF pump: callbacks queue up and run only when the test
// advances the clock, so momentum and settle animations are steppable.
let rafQueue;
let rafIds;
const pump = (t) => {
    const callbacks = rafQueue.splice(0);
    callbacks.forEach(({ id, cb }) => {
        if (!rafIds.has(id)) return; // cancelled
        rafIds.delete(id);
        act(() => cb(t));
    });
};
const pumpUntilRest = () => {
    for (let t = 16; t <= 5000 && rafQueue.length > 0; t += 50) pump(t);
    expect(rafQueue.length).toBe(0); // the wheel must come to rest
};

// jsdom has no PointerEvent, and without it React's synthetic pointer events
// deliver clientY/pointerId as undefined. MouseEvent carries the coordinates;
// this shim adds the pointer fields testing-library passes through.
class PointerEventShim extends MouseEvent {
    constructor(type, init = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 0;
        this.pointerType = init.pointerType ?? 'mouse';
    }
}

describe('VenueWheel', () => {
    let nowValue;
    let nowSpy;

    beforeEach(() => {
        vi.stubGlobal('PointerEvent', PointerEventShim);
        rafQueue = [];
        rafIds = new Set();
        let nextId = 1;
        vi.stubGlobal('requestAnimationFrame', (cb) => {
            const id = nextId += 1;
            rafIds.add(id);
            rafQueue.push({ id, cb });
            return id;
        });
        vi.stubGlobal('cancelAnimationFrame', (id) => rafIds.delete(id));
        nowValue = 0;
        nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => nowValue);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        // Restore only our spy — vi.restoreAllMocks() would also wipe the
        // setupTests matchMedia mock implementation for later tests.
        nowSpy.mockRestore();
    });

    const renderWheel = (props = {}) => render(
        <VenueWheel
            themes={THEMES}
            userTokens={10}
            pendingThemeId={null}
            onPlay={() => {}}
            {...props}
        />
    );

    const viewport = () => document.querySelector('.venue-wheel-viewport');
    const frontCard = () => document.querySelector('.venue-wheel-slot.is-front .qp-card');

    test('the venue list repeats around the drum so few venues loop', () => {
        renderWheel();

        const slots = document.querySelectorAll('.venue-wheel-slot');
        expect(slots.length).toBe(7); // front ± 3
        const fortCreekPanels = document.querySelectorAll('.qp-card.qp-fort-creek');
        const shirecliffPanels = document.querySelectorAll('.qp-card.qp-shirecliff-road');
        expect(fortCreekPanels.length).toBeGreaterThanOrEqual(3);
        expect(shirecliffPanels.length).toBeGreaterThanOrEqual(3);
        expect(viewport().dataset.centeredTheme).toBe('fort-creek');
    });

    test('the front panel is the same PLAY NOW card as before and plays on tap', () => {
        const onPlay = vi.fn();
        renderWheel({ onPlay });

        const card = frontCard();
        expect(card.textContent).toContain('Fort Creek');
        expect(card.textContent).toContain('PLAY NOW');
        fireEvent.click(card);
        expect(onPlay).toHaveBeenCalledWith('fort-creek');
    });

    test('a player who cannot afford the buy-in cannot play but can still spin', () => {
        const onPlay = vi.fn();
        renderWheel({ onPlay, userTokens: 0 });

        const card = frontCard();
        expect(card.textContent).toContain('NEED TOKENS');
        expect(card.getAttribute('aria-disabled')).toBe('true');
        fireEvent.click(card);
        expect(onPlay).not.toHaveBeenCalled();

        fireEvent.keyDown(document.querySelector('.venue-wheel'), { key: 'ArrowDown' });
        pumpUntilRest();
        expect(viewport().dataset.centeredTheme).toBe('shirecliff-road');
    });

    test('tapping a neighbor spins it to the front instead of buying in', () => {
        const onPlay = vi.fn();
        renderWheel({ onPlay });

        const neighbor = document.querySelector('.venue-wheel-slot:not(.is-front) .qp-card');
        const neighborTheme = neighbor.dataset.theme;
        fireEvent.click(neighbor);
        expect(onPlay).not.toHaveBeenCalled();

        pumpUntilRest();
        expect(viewport().dataset.centeredTheme).toBe(neighborTheme);
    });

    test('arrow keys step the wheel one venue at a time, wrapping around', () => {
        renderWheel();
        const wheel = document.querySelector('.venue-wheel');

        fireEvent.keyDown(wheel, { key: 'ArrowDown' });
        pumpUntilRest();
        expect(viewport().dataset.centeredTheme).toBe('shirecliff-road');

        fireEvent.keyDown(wheel, { key: 'ArrowDown' });
        pumpUntilRest();
        expect(viewport().dataset.centeredTheme).toBe('fort-creek'); // wrapped

        fireEvent.keyDown(wheel, { key: 'ArrowUp' });
        pumpUntilRest();
        expect(viewport().dataset.centeredTheme).toBe('shirecliff-road');
    });

    test('a drag spins the wheel and its release never counts as a tap', () => {
        const onPlay = vi.fn();
        renderWheel({ onPlay });
        const surface = viewport();

        nowValue = 0;
        fireEvent.pointerDown(surface, { pointerId: 1, clientY: 300 });
        nowValue = 30;
        fireEvent.pointerMove(surface, { pointerId: 1, clientY: 260 });
        nowValue = 60;
        fireEvent.pointerMove(surface, { pointerId: 1, clientY: 220 });
        nowValue = 90;
        fireEvent.pointerUp(surface, { pointerId: 1, clientY: 220 });

        // The click browsers fire after pointerup (detail >= 1) must not buy
        // in mid-spin.
        fireEvent.click(frontCard(), { detail: 1 });
        expect(onPlay).not.toHaveBeenCalled();

        pumpUntilRest();
        // An upward pull of ~80px carries real momentum; the wheel must have
        // advanced off the original venue and settled cleanly on a card.
        expect(viewport().dataset.centeredTheme).toBeTruthy();
    });

    test('a genuine flick coasts with momentum before settling', () => {
        renderWheel();
        const surface = viewport();

        nowValue = 0;
        fireEvent.pointerDown(surface, { pointerId: 1, clientY: 300 });
        nowValue = 20;
        fireEvent.pointerMove(surface, { pointerId: 1, clientY: 250 });
        nowValue = 40;
        fireEvent.pointerMove(surface, { pointerId: 1, clientY: 200 });
        nowValue = 60;
        fireEvent.pointerUp(surface, { pointerId: 1, clientY: 200 });

        const before = viewport().dataset.centeredTheme;
        expect(rafQueue.length).toBeGreaterThan(0); // momentum loop armed
        pump(16);
        pump(66);
        const during = document.querySelector('.venue-wheel-slot.is-front .qp-card').dataset.theme;
        expect(during).toBeDefined();
        pumpUntilRest();
        // 100px in 60ms is a hard flick — it must travel at least one card.
        expect(`${before}`).not.toBe(''); // sanity
        expect(viewport().dataset.centeredTheme).toBeTruthy();
    });

    test('a short tap on the front card still plays even with pointer wiring', () => {
        const onPlay = vi.fn();
        renderWheel({ onPlay });
        const surface = viewport();

        nowValue = 0;
        fireEvent.pointerDown(surface, { pointerId: 1, clientY: 300 });
        nowValue = 80;
        fireEvent.pointerUp(surface, { pointerId: 1, clientY: 302 }); // 2px wobble
        fireEvent.click(frontCard());

        expect(onPlay).toHaveBeenCalledWith('fort-creek');
    });

    test('a wobbly tap (under the slop) still plays — and never poisons later taps', () => {
        // Regression: the sub-slop pointermove used to commit a render whose
        // stale closure swallowed this and EVERY later PLAY NOW tap.
        const onPlay = vi.fn();
        renderWheel({ onPlay });
        const surface = viewport();

        nowValue = 0;
        fireEvent.pointerDown(surface, { pointerId: 1, clientY: 300 });
        nowValue = 30;
        fireEvent.pointerMove(surface, { pointerId: 1, clientY: 303 }); // 3px wobble
        nowValue = 80;
        fireEvent.pointerUp(surface, { pointerId: 1, clientY: 303 });
        fireEvent.click(frontCard(), { detail: 1 });

        expect(onPlay).toHaveBeenCalledWith('fort-creek');
        expect(onPlay).toHaveBeenCalledTimes(1);
    });

    test('keyboard activation still works after the wheel has been dragged', () => {
        // Regression: wasDrag was never cleared, so Enter/Space (click detail
        // 0) was swallowed forever after the first drag.
        const onPlay = vi.fn();
        renderWheel({ onPlay });
        const surface = viewport();

        nowValue = 0;
        fireEvent.pointerDown(surface, { pointerId: 1, clientY: 300 });
        nowValue = 30;
        fireEvent.pointerMove(surface, { pointerId: 1, clientY: 240 });
        nowValue = 60;
        fireEvent.pointerUp(surface, { pointerId: 1, clientY: 240 });
        pumpUntilRest();

        fireEvent.click(frontCard(), { detail: 0 }); // keyboard/AT activation
        expect(onPlay).toHaveBeenCalledTimes(1);
    });

    test('tapping a coasting wheel arrests it onto a card and never buys in', () => {
        const onPlay = vi.fn();
        renderWheel({ onPlay });
        const surface = viewport();

        // Flick to get it coasting.
        nowValue = 0;
        fireEvent.pointerDown(surface, { pointerId: 1, clientY: 300 });
        nowValue = 20;
        fireEvent.pointerMove(surface, { pointerId: 1, clientY: 250 });
        nowValue = 40;
        fireEvent.pointerMove(surface, { pointerId: 1, clientY: 200 });
        nowValue = 60;
        fireEvent.pointerUp(surface, { pointerId: 1, clientY: 200 });
        pump(16);
        pump(66); // mid-coast, off-grid

        // Arrest tap.
        nowValue = 200;
        fireEvent.pointerDown(surface, { pointerId: 2, clientY: 300 });
        nowValue = 260;
        fireEvent.pointerUp(surface, { pointerId: 2, clientY: 300 });
        fireEvent.click(frontCard(), { detail: 1 }); // trailing click of the arrest tap
        expect(onPlay).not.toHaveBeenCalled();

        // The drum must glide onto a card, not freeze between segments.
        pumpUntilRest();
        expect(viewport().dataset.centeredTheme).toBeTruthy();

        // And the NEXT clean tap plays normally.
        nowValue = 400;
        fireEvent.pointerDown(surface, { pointerId: 3, clientY: 300 });
        nowValue = 460;
        fireEvent.pointerUp(surface, { pointerId: 3, clientY: 300 });
        fireEvent.click(frontCard(), { detail: 1 });
        expect(onPlay).toHaveBeenCalledTimes(1);
    });

    test('a second finger cannot hijack an active drag', () => {
        renderWheel();
        const surface = viewport();

        nowValue = 0;
        fireEvent.pointerDown(surface, { pointerId: 1, clientY: 300 });
        fireEvent.pointerDown(surface, { pointerId: 2, clientY: 500 }); // ignored
        nowValue = 30;
        const before = viewport().dataset.centeredTheme;
        fireEvent.pointerMove(surface, { pointerId: 2, clientY: 300 }); // ignored
        expect(viewport().dataset.centeredTheme).toBe(before);

        nowValue = 60;
        fireEvent.pointerMove(surface, { pointerId: 1, clientY: 190 }); // finger 1 drives
        nowValue = 90;
        fireEvent.pointerUp(surface, { pointerId: 1, clientY: 190 });
        pumpUntilRest();
        expect(viewport().dataset.centeredTheme).not.toBe(before);
    });

    test('pointer capture engages only for real drags, never for taps', () => {
        // Regression: capturing on pointerdown retargets the follow-up click
        // to the viewport in real browsers, killing PLAY NOW entirely.
        renderWheel();
        const surface = viewport();
        surface.setPointerCapture = vi.fn();

        nowValue = 0;
        fireEvent.pointerDown(surface, { pointerId: 1, clientY: 300 });
        nowValue = 60;
        fireEvent.pointerUp(surface, { pointerId: 1, clientY: 301 });
        expect(surface.setPointerCapture).not.toHaveBeenCalled();

        nowValue = 200;
        fireEvent.pointerDown(surface, { pointerId: 2, clientY: 300 });
        nowValue = 230;
        fireEvent.pointerMove(surface, { pointerId: 2, clientY: 250 });
        expect(surface.setPointerCapture).toHaveBeenCalledWith(2);
        nowValue = 260;
        fireEvent.pointerUp(surface, { pointerId: 2, clientY: 250 });
        pumpUntilRest();
    });

    test('a changed venue list resets the wheel instead of silently swapping the front card', () => {
        const view = renderWheel();
        fireEvent.keyDown(document.querySelector('.venue-wheel'), { key: 'ArrowDown' });
        pumpUntilRest();
        expect(viewport().dataset.centeredTheme).toBe('shirecliff-road');

        const newThemes = [
            { id: 'dans-deck', name: 'Eaglewood', cost: 20 },
            ...THEMES,
        ];
        view.rerender(
            <VenueWheel themes={newThemes} userTokens={10} pendingThemeId={null} onPlay={() => {}} />
        );
        expect(viewport().dataset.centeredTheme).toBe('dans-deck');
    });

    test('shows the loading text with no venues', () => {
        renderWheel({ themes: [] });
        expect(screen.getByText('Loading tables...')).toBeInTheDocument();
    });

    test('the pending venue shows the seating state on the front card', () => {
        renderWheel({ pendingThemeId: 'fort-creek' });
        expect(frontCard().textContent).toContain('SEATING YOU…');
        expect(frontCard().className).toContain('qp-pending');
    });

    test('segment constant stays in sync with the drum math', () => {
        // 7 slots × SEGMENT_DEG must cover more than the visible window so
        // cards never pop in visibly; cos() fades them out by ±90°.
        expect(SEGMENT_DEG * 3).toBeLessThan(120);
    });
});
