import React from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import SpinWheel, { WEDGE_DEG } from './SpinWheel';

// Same deterministic rAF pump + PointerEvent shim as VenueWheel.test.js was
// using: callbacks queue and run only when the test advances the clock.
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

class PointerEventShim extends MouseEvent {
    constructor(type, init = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 0;
        this.pointerType = init.pointerType ?? 'mouse';
    }
}

describe('SpinWheel lab object', () => {
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
        nowSpy.mockRestore();
    });

    const disc = () => document.querySelector('.spin-wheel-disc');
    const rotor = () => document.querySelector('.spin-wheel-svg');
    const currentRotation = () => parseFloat(rotor().style.transform.match(/rotate\(([-\d.]+)deg\)/)[1]);

    // The disc's center is (0,0) in jsdom (all rects are zero), so pointer
    // coords ARE center-relative: angles come straight from atan2(y, x).
    const at = (deg, radius = 100) => ({
        clientX: radius * Math.cos(deg * Math.PI / 180),
        clientY: radius * Math.sin(deg * Math.PI / 180),
    });

    test('a thrown wheel coasts with momentum and settles squarely on a wedge', () => {
        render(<SpinWheel />);

        nowValue = 0;
        fireEvent.pointerDown(disc(), { pointerId: 1, ...at(0) });
        nowValue = 20;
        fireEvent.pointerMove(disc(), { pointerId: 1, ...at(25) });
        nowValue = 40;
        fireEvent.pointerUp(disc(), { pointerId: 1, ...at(25) });

        // Drag tracked the finger 1:1.
        expect(currentRotation()).toBeCloseTo(25, 1);
        expect(rafQueue.length).toBeGreaterThan(0); // momentum armed

        pump(16);
        pump(66);
        const coasting = currentRotation();
        expect(coasting).toBeGreaterThan(25); // still travelling clockwise

        pumpUntilRest();
        const settled = currentRotation();
        expect(settled).toBeGreaterThan(coasting);
        // Must land exactly on a wedge alignment (multiple of 45°).
        expect(Math.abs(settled / WEDGE_DEG - Math.round(settled / WEDGE_DEG))).toBeLessThan(1e-6);
        expect(document.querySelector('.spin-wheel-readout').textContent).toMatch(/^Landed on [1-8]$/);
    });

    test('the readout wedge matches the rotation arithmetic', () => {
        render(<SpinWheel />);
        // At rotation 0, wedge 7 (index 6, center at 270°) sits under the
        // top flapper: mod(round((-90 - 0) / 45), 8) = 6.
        expect(disc().dataset.winner).toBe('7');
        expect(document.querySelector('.spin-wheel-readout').textContent).toBe('Landed on 7');
    });

    test('a tap neither spins the wheel nor leaves it off-grid', () => {
        render(<SpinWheel />);

        nowValue = 0;
        fireEvent.pointerDown(disc(), { pointerId: 1, ...at(10) });
        nowValue = 60;
        fireEvent.pointerMove(disc(), { pointerId: 1, ...at(11) }); // sub-slop wobble
        fireEvent.pointerUp(disc(), { pointerId: 1, ...at(11) });

        expect(rafQueue.length).toBe(0); // no momentum from a tap
        expect(currentRotation()).toBe(0); // snapped back to grid
    });

    test('grabbing a coasting wheel arrests it and a second finger is ignored', () => {
        render(<SpinWheel />);

        // Throw it.
        nowValue = 0;
        fireEvent.pointerDown(disc(), { pointerId: 1, ...at(0) });
        nowValue = 20;
        fireEvent.pointerMove(disc(), { pointerId: 1, ...at(30) });
        nowValue = 40;
        fireEvent.pointerUp(disc(), { pointerId: 1, ...at(30) });
        pump(16);
        pump(66);

        // Grab mid-coast: motion stops dead where the hand lands.
        nowValue = 200;
        fireEvent.pointerDown(disc(), { pointerId: 2, ...at(90) });
        const held = currentRotation();
        // A second finger joins: ignored entirely.
        fireEvent.pointerDown(disc(), { pointerId: 3, ...at(180) });
        fireEvent.pointerMove(disc(), { pointerId: 3, ...at(120) });
        expect(currentRotation()).toBe(held);

        // The holding finger still drives the wheel.
        nowValue = 240;
        fireEvent.pointerMove(disc(), { pointerId: 2, ...at(120) });
        expect(currentRotation()).toBeCloseTo(held + 30, 1);
    });

    test('crossing the atan2 seam never registers as a full lap', () => {
        render(<SpinWheel />);

        nowValue = 0;
        fireEvent.pointerDown(disc(), { pointerId: 1, ...at(170) });
        nowValue = 30;
        fireEvent.pointerMove(disc(), { pointerId: 1, ...at(185) }); // crosses ±180°
        expect(currentRotation()).toBeCloseTo(15, 1);
        nowValue = 60;
        fireEvent.pointerUp(disc(), { pointerId: 1, ...at(185) });
        pumpUntilRest();
    });
});
