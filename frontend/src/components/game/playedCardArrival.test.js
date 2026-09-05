import {
    FINAL_TRICK_HOLD_MS,
    FINAL_TRICK_FLY_MS,
    SERVER_TRICK_LINGER_MS,
    TRICK_REST_MS,
} from '../../config/endRoundTiming';
import {
    ARRIVAL_MS,
    ARRIVAL_SETTLE_AT,
    ARRIVAL_START_SCALE,
    ARRIVAL_Z_INDEX,
    arrivalKey,
    arrivalOffset,
    buildArrivalKeyframes,
    reconcileArrivals,
    findSeatAnchor,
    launchArrival,
} from './playedCardArrival';

const rect = (left, top, width, height) => ({ left, top, width, height });

describe('arrival timing against the trick magnet', () => {
    test('the magnet waits for the last card to land and rest before pulling the trick', () => {
        // The card that completes a trick arrives in the same broadcast as the
        // linger state, so the hold must outlast the flight by a real beat.
        expect(FINAL_TRICK_HOLD_MS).toBe(ARRIVAL_MS + TRICK_REST_MS);
        expect(TRICK_REST_MS).toBeGreaterThanOrEqual(250);
    });

    test('hold plus fly still lands inside the server linger with room for jitter', () => {
        expect(FINAL_TRICK_HOLD_MS + FINAL_TRICK_FLY_MS).toBeLessThanOrEqual(SERVER_TRICK_LINGER_MS - 200);
    });
});

describe('arrivalKey', () => {
    test('keys a play by player and card, and rejects incomplete plays', () => {
        expect(arrivalKey({ playerName: 'Brandi', card: 'KH' })).toBe('Brandi:KH');
        expect(arrivalKey({ playerName: 'Brandi' })).toBeNull();
        expect(arrivalKey(null)).toBeNull();
    });
});

describe('arrivalOffset', () => {
    test('points from the slot centre back to the seat centre in pixels', () => {
        const seat = rect(10, 300, 100, 40);   // centre 60, 320
        const card = rect(200, 200, 60, 84);   // centre 230, 242
        expect(arrivalOffset(seat, card, 'left')).toEqual({ x: '-170px', y: '78px' });
    });

    test('falls back to a per-seat guess when either rect cannot be measured', () => {
        expect(arrivalOffset(null, rect(0, 0, 60, 84), 'left')).toEqual({ x: '-30vw', y: '0px' });
        expect(arrivalOffset(rect(0, 0, 0, 0), rect(0, 0, 60, 84), 'right')).toEqual({ x: '30vw', y: '0px' });
        expect(arrivalOffset(rect(0, 0, 100, 40), rect(0, 0, 0, 0), 'top')).toEqual({ x: '0px', y: '-18vh' });
        expect(arrivalOffset(null, null, 'nowhere')).toEqual({ x: '0px', y: '-18vh' });
    });
});

describe('buildArrivalKeyframes', () => {
    test('starts small at the seat, settles with a bump, and ends at the identity transform', () => {
        const frames = buildArrivalKeyframes({ offset: { x: '-170px', y: '78px' }, seat: 'left' });
        expect(frames).toHaveLength(3);
        expect(frames[0].offset).toBe(0);
        expect(frames[0].transform).toBe(`translate(-170px, 78px) rotate(-360deg) scale(${ARRIVAL_START_SCALE})`);
        expect(frames[1].offset).toBe(ARRIVAL_SETTLE_AT);
        expect(frames[1].transform).toContain('translate(0px, 0px) rotate(0deg) scale(1.06)');
        expect(frames[2].offset).toBe(1);
        expect(frames[2].transform).toBe('translate(0px, 0px) rotate(0deg) scale(1)');
    });

    test('spins the opposite way for a card from the right', () => {
        const left = buildArrivalKeyframes({ offset: { x: '0px', y: '0px' }, seat: 'left' });
        const right = buildArrivalKeyframes({ offset: { x: '0px', y: '0px' }, seat: 'right' });
        expect(left[0].transform).toContain('rotate(-360deg)');
        expect(right[0].transform).toContain('rotate(360deg)');
    });
});

describe('reconcileArrivals', () => {
    test('the unseeded first pass claims everything on the felt without animating', () => {
        const { seen, arriving } = reconcileArrivals(new Set(), ['Brandi:KH', 'Elena:9H'], false);
        expect(arriving).toEqual([]);
        expect([...seen]).toEqual(['Brandi:KH', 'Elena:9H']);
    });

    test('only plays not yet on the felt arrive, in display order', () => {
        const { seen, arriving } = reconcileArrivals(new Set(['Brandi:KH']), ['Brandi:KH', 'Elena:9H']);
        expect(arriving).toEqual(['Elena:9H']);
        expect([...seen]).toEqual(['Brandi:KH', 'Elena:9H']);
    });

    test('plays gone from the felt drop out, so the same card flies again next round', () => {
        const cleared = reconcileArrivals(new Set(['Brandi:KH', 'Elena:9H']), []);
        expect(cleared.arriving).toEqual([]);
        expect(cleared.seen.size).toBe(0);
        const nextRound = reconcileArrivals(cleared.seen, ['Brandi:KH']);
        expect(nextRound.arriving).toEqual(['Brandi:KH']);
    });

    test('ignores empty keys and duplicates', () => {
        const { seen, arriving } = reconcileArrivals(new Set(), [null, 'Brandi:KH', 'Brandi:KH', undefined]);
        expect(arriving).toEqual(['Brandi:KH']);
        expect(seen.size).toBe(1);
    });
});

describe('findSeatAnchor', () => {
    test('finds the seat by player name inside the scope only', () => {
        const scope = document.createElement('div');
        scope.innerHTML = '<div data-deal-player="Brandi"></div><div data-deal-player="Elena"></div>';
        expect(findSeatAnchor(scope, 'Elena')).toBe(scope.children[1]);
        expect(findSeatAnchor(scope, 'Marcus')).toBeNull();
        expect(findSeatAnchor(null, 'Elena')).toBeNull();
        expect(findSeatAnchor(scope, '')).toBeNull();
    });
});

describe('launchArrival', () => {
    const makeSlot = () => {
        const scope = document.createElement('div');
        scope.innerHTML = `
            <div data-deal-player="Brandi"></div>
            <div data-played-card-slot="left">
                <div class="trick-card-fly"><div class="trick-card-arrive"></div></div>
            </div>
        `;
        const seat = scope.querySelector('[data-deal-player]');
        const wrapper = scope.querySelector('[data-played-card-slot]');
        const element = scope.querySelector('.trick-card-arrive');
        seat.getBoundingClientRect = () => rect(10, 300, 100, 40);
        element.getBoundingClientRect = () => rect(200, 200, 60, 84);
        return { scope, seat, wrapper, element };
    };

    test('animates from the measured seat, raising the slot until the card lands', () => {
        const { scope, wrapper, element } = makeSlot();
        const listeners = {};
        const animation = {
            playState: 'running',
            addEventListener: (name, fn) => { listeners[name] = fn; },
        };
        element.animate = vi.fn(() => animation);

        expect(launchArrival(element, { seat: 'left', playerName: 'Brandi', scope })).toBe(animation);

        const [frames, options] = element.animate.mock.calls[0];
        expect(frames[0].transform).toContain('translate(-170px, 78px)');
        expect(options).toEqual({ duration: ARRIVAL_MS, fill: 'none' });
        expect(wrapper.style.zIndex).toBe(ARRIVAL_Z_INDEX);
        expect(element.style.willChange).toBe('transform');

        listeners.finish();
        expect(wrapper.style.zIndex).toBe('');
        expect(element.style.willChange).toBe('');
    });

    test('never undercuts a raise it does not own (the trick magnet sets 40)', () => {
        const { scope, wrapper, element } = makeSlot();
        const listeners = {};
        element.animate = vi.fn(() => ({ addEventListener: (name, fn) => { listeners[name] = fn; } }));
        launchArrival(element, { seat: 'left', playerName: 'Brandi', scope });
        wrapper.style.zIndex = '40';
        listeners.cancel();
        expect(wrapper.style.zIndex).toBe('40');
    });

    test('is a no-op where the browser cannot animate', () => {
        const { scope, wrapper, element } = makeSlot();
        delete element.animate;
        expect(launchArrival(element, { seat: 'left', playerName: 'Brandi', scope })).toBeNull();
        expect(wrapper.style.zIndex).toBe('');
        expect(launchArrival(null, { seat: 'left', playerName: 'Brandi', scope })).toBeNull();
    });
});
