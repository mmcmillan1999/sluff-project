import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import VenueWheel, { FACE_COUNT, FACE_DEG } from './VenueWheel';

const THEMES = [
    { id: 'miss-pauls-academy', name: 'Academy', cost: 0.1 },
    { id: 'fort-creek', name: 'Fort Creek', cost: 1 },
    { id: 'shirecliff-road', name: 'Shirecliff', cost: 5 },
    { id: 'dans-deck', name: 'Eaglewood', cost: 20 },
];

// Deterministic rAF pump: callbacks queue and run only when the test
// advances the clock, so momentum and settle animations are steppable.
let rafQueue;
let rafIds;
const pump = (t) => {
    const callbacks = rafQueue.splice(0);
    callbacks.forEach(({ id, cb }) => {
        if (!rafIds.has(id)) return;
        rafIds.delete(id);
        act(() => cb(t));
    });
};
const pumpUntilRest = () => {
    for (let t = 16; t <= 30000 && rafQueue.length > 0; t += 50) pump(t);
    expect(rafQueue.length).toBe(0);
};

// jsdom has no PointerEvent; without it React delivers pointer coords as
// undefined. MouseEvent carries them; the shim adds the pointer fields.
class PointerEventShim extends MouseEvent {
    constructor(type, init = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 0;
        this.pointerType = init.pointerType ?? 'mouse';
    }
}

describe('VenueWheel (rim)', () => {
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
        // Restore only our spy — restoreAllMocks would wipe the setupTests
        // matchMedia implementation for later tests.
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

    const scene = () => document.querySelector('.venue-wheel-scene');
    const cta = () => document.querySelector('.venue-wheel-cta');

    // buttons: 1 mirrors a held primary button — real pointermove events
    // carry it, and the wheel treats buttons: 0 as a missed release.
    const drag = (fromY, toY, { pointerId = 1, start = 0, stepMs = 20 } = {}) => {
        nowValue = start;
        fireEvent.pointerDown(scene(), { pointerId, clientY: fromY, buttons: 1 });
        nowValue += stepMs;
        fireEvent.pointerMove(scene(), { pointerId, clientY: (fromY + toY) / 2, buttons: 1 });
        nowValue += stepMs;
        fireEvent.pointerMove(scene(), { pointerId, clientY: toY, buttons: 1 });
        nowValue += stepMs;
        fireEvent.pointerUp(scene(), { pointerId, clientY: toY });
    };

    test('each venue rides two opposite faces of the octagon', () => {
        renderWheel();
        const faces = [...document.querySelectorAll('.venue-wheel-face')];
        expect(faces.length).toBe(FACE_COUNT);
        THEMES.forEach((theme, i) => {
            expect(faces[i].dataset.theme).toBe(theme.id);
            expect(faces[i + 4].dataset.theme).toBe(theme.id);
        });
        expect(scene().dataset.frontTheme).toBe('miss-pauls-academy');
    });

    test('the CTA plays the front venue; the wheel itself never buys in', () => {
        const onPlay = vi.fn();
        renderWheel({ onPlay });

        // Tapping/clicking the wheel is never a purchase.
        nowValue = 0;
        fireEvent.pointerDown(scene(), { pointerId: 1, clientY: 200 });
        nowValue = 60;
        fireEvent.pointerUp(scene(), { pointerId: 1, clientY: 201 });
        fireEvent.click(scene());
        expect(onPlay).not.toHaveBeenCalled();

        // The button is the purchase.
        expect(cta().textContent).toContain('Academy');
        expect(cta().textContent).toContain('PLAY NOW');
        fireEvent.click(cta());
        expect(onPlay).toHaveBeenCalledWith('miss-pauls-academy');
        expect(onPlay).toHaveBeenCalledTimes(1);
    });

    test('a thrown wheel coasts, settles on a face, and the CTA follows it', () => {
        const onPlay = vi.fn();
        // Rich enough to afford every venue, so the settled CTA is enabled.
        renderWheel({ onPlay, userTokens: 100 });

        drag(300, 190); // hard upward pull
        expect(rafQueue.length).toBeGreaterThan(0); // momentum armed
        // Mid-spin the CTA is disabled: you cannot buy a moving target.
        expect(cta()).toBeDisabled();
        fireEvent.click(cta());
        expect(onPlay).not.toHaveBeenCalled();

        pumpUntilRest();
        const front = scene().dataset.frontTheme;
        expect(front).toBeTruthy();
        const frontName = THEMES.find(t => t.id === front).name;
        expect(cta().textContent).toContain(frontName);
        expect(cta()).not.toBeDisabled();

        fireEvent.click(cta());
        expect(onPlay).toHaveBeenCalledWith(front);
    });

    test('arrow keys step one venue and wrap through the catalog', () => {
        renderWheel();
        const wheel = document.querySelector('.venue-wheel');

        fireEvent.keyDown(wheel, { key: 'ArrowDown' });
        pumpUntilRest();
        expect(scene().dataset.frontTheme).toBe('fort-creek');

        for (let i = 0; i < 3; i += 1) {
            fireEvent.keyDown(wheel, { key: 'ArrowDown' });
            pumpUntilRest();
        }
        expect(scene().dataset.frontTheme).toBe('miss-pauls-academy'); // wrapped

        fireEvent.keyDown(wheel, { key: 'ArrowUp' });
        pumpUntilRest();
        expect(scene().dataset.frontTheme).toBe('dans-deck');
    });

    test('an unaffordable front venue disables the CTA but never the wheel', () => {
        const onPlay = vi.fn();
        renderWheel({ onPlay, userTokens: 0.5 });

        // Academy (0.1) is affordable...
        expect(cta()).not.toBeDisabled();

        // ...Fort Creek (1) is not.
        fireEvent.keyDown(document.querySelector('.venue-wheel'), { key: 'ArrowDown' });
        pumpUntilRest();
        expect(scene().dataset.frontTheme).toBe('fort-creek');
        expect(cta().textContent).toContain('NEED TOKENS');
        expect(cta()).toBeDisabled();
        fireEvent.click(cta());
        expect(onPlay).not.toHaveBeenCalled();

        // The wheel still spins to the next venue.
        fireEvent.keyDown(document.querySelector('.venue-wheel'), { key: 'ArrowDown' });
        pumpUntilRest();
        expect(scene().dataset.frontTheme).toBe('shirecliff-road');
    });

    test('the pending venue shows the seating state on the CTA', () => {
        renderWheel({ pendingThemeId: 'miss-pauls-academy' });
        expect(cta().textContent).toContain('SEATING YOU…');
        expect(cta().className).toContain('is-pending');
        expect(cta()).toBeDisabled();
    });

    test('pointer capture engages only for real drags, never for taps', () => {
        renderWheel();
        scene().setPointerCapture = vi.fn();

        nowValue = 0;
        fireEvent.pointerDown(scene(), { pointerId: 1, clientY: 300 });
        nowValue = 60;
        fireEvent.pointerUp(scene(), { pointerId: 1, clientY: 302 });
        expect(scene().setPointerCapture).not.toHaveBeenCalled();

        drag(300, 240, { pointerId: 2, start: 200 });
        expect(scene().setPointerCapture).toHaveBeenCalledWith(2);
        pumpUntilRest();
    });

    test('a second finger cannot hijack an active drag', () => {
        renderWheel();

        nowValue = 0;
        fireEvent.pointerDown(scene(), { pointerId: 1, clientY: 300 });
        fireEvent.pointerDown(scene(), { pointerId: 2, clientY: 500 }); // ignored
        const before = scene().dataset.frontTheme;
        fireEvent.pointerMove(scene(), { pointerId: 2, clientY: 300, buttons: 1 }); // ignored
        expect(scene().dataset.frontTheme).toBe(before);

        nowValue = 40;
        fireEvent.pointerMove(scene(), { pointerId: 1, clientY: 150, buttons: 1 }); // finger 1 drives
        expect(scene().dataset.frontTheme).not.toBe(before); // wheel followed finger 1
        nowValue = 80;
        fireEvent.pointerUp(scene(), { pointerId: 1, clientY: 150 });
        pumpUntilRest();
    });

    test('a changed venue list resets the wheel instead of silently swapping the front', () => {
        const view = renderWheel();
        fireEvent.keyDown(document.querySelector('.venue-wheel'), { key: 'ArrowDown' });
        pumpUntilRest();
        expect(scene().dataset.frontTheme).toBe('fort-creek');

        const reordered = [THEMES[3], ...THEMES.slice(0, 3)];
        view.rerender(
            <VenueWheel themes={reordered} userTokens={10} pendingThemeId={null} onPlay={() => {}} />
        );
        expect(scene().dataset.frontTheme).toBe('dans-deck');
    });

    test('shows the loading text with no venues', () => {
        renderWheel({ themes: [] });
        expect(screen.getByText('Loading tables...')).toBeInTheDocument();
    });

    test('touch drags survive browsers that report buttons 0 mid-contact', () => {
        // Regression: the missed-mouse-release guard must never apply to
        // touch — several mobile browsers report buttons 0 during contact,
        // which killed every touch drag on the first move.
        renderWheel();

        nowValue = 0;
        fireEvent.pointerDown(scene(), { pointerId: 1, clientY: 300, pointerType: 'touch', buttons: 0 });
        nowValue = 20;
        fireEvent.pointerMove(scene(), { pointerId: 1, clientY: 250, pointerType: 'touch', buttons: 0 });
        nowValue = 40;
        fireEvent.pointerMove(scene(), { pointerId: 1, clientY: 200, pointerType: 'touch', buttons: 0 });
        // The wheel tracked the finger instead of dying on the first move.
        expect(scene().dataset.frontTheme).not.toBe('miss-pauls-academy');

        nowValue = 60;
        fireEvent.pointerUp(scene(), { pointerId: 1, clientY: 200, pointerType: 'touch' });
        expect(rafQueue.length).toBeGreaterThan(0); // and the flick coasts
        pumpUntilRest();
        expect(scene().dataset.atRest).toBe('true');
    });

    test('a mouse released off-wheel below the slop cannot orphan the drag', () => {
        // Regression: dragging=true used to latch forever, making the wheel
        // un-grabbable and letting hover moves spin it with no button down.
        renderWheel();

        nowValue = 0;
        fireEvent.pointerDown(scene(), { pointerId: 1, clientY: 300, buttons: 1 });
        nowValue = 30;
        fireEvent.pointerMove(scene(), { pointerId: 1, clientY: 303, buttons: 1 }); // sub-slop
        // ...release happens off-element (no pointerup here). The next hover
        // move arrives with no button held:
        nowValue = 400;
        fireEvent.pointerMove(scene(), { pointerId: 1, clientY: 500, buttons: 0 });

        // The orphan resolved as a tap: on-grid, at rest, not spinning.
        expect(scene().dataset.atRest).toBe('true');
        expect(scene().dataset.frontTheme).toBe('miss-pauls-academy');

        // And the wheel is grabbable again.
        drag(300, 190, { pointerId: 2, start: 600 });
        pumpUntilRest();
        expect(scene().dataset.frontTheme).not.toBe('miss-pauls-academy');
    });

    test('pointercancel mid-drag behaves like a release, never a stuck wheel', () => {
        renderWheel();

        nowValue = 0;
        fireEvent.pointerDown(scene(), { pointerId: 1, clientY: 300, buttons: 1 });
        nowValue = 20;
        fireEvent.pointerMove(scene(), { pointerId: 1, clientY: 240, buttons: 1 }); // past slop
        nowValue = 40;
        fireEvent.pointerCancel(scene(), { pointerId: 1, clientY: 240 });

        pumpUntilRest(); // any momentum/settle drains cleanly
        expect(scene().dataset.atRest).toBe('true');

        // A fresh drag still works.
        drag(300, 250, { pointerId: 2, start: 500 });
        pumpUntilRest();
        expect(scene().dataset.atRest).toBe('true');
    });

    test('geometry: a full pull of one face height advances exactly one venue', () => {
        renderWheel();
        // Face height in jsdom falls back to innerHeight * 0.11; apothem
        // follows the octagon. One face of surface travel = FACE_DEG.
        const faceH = window.innerHeight * 0.11;
        const apothem = (faceH / 2) / Math.tan(Math.PI / FACE_COUNT);
        const onePacePx = (FACE_DEG * Math.PI * apothem) / 180;

        nowValue = 0;
        fireEvent.pointerDown(scene(), { pointerId: 1, clientY: 400 });
        nowValue = 900; // glacial pull: release velocity below the settle gate
        fireEvent.pointerMove(scene(), { pointerId: 1, clientY: 400 + onePacePx, buttons: 1 });
        nowValue = 1800;
        fireEvent.pointerUp(scene(), { pointerId: 1, clientY: 400 + onePacePx });
        pumpUntilRest();
        // Pulling DOWN brings the face above (the previous venue) to front.
        expect(scene().dataset.frontTheme).toBe('dans-deck');
    });
});
