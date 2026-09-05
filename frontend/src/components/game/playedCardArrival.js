// frontend/src/components/game/playedCardArrival.js
//
// An opponent's played card flies (and spins) from their seat plate onto its
// spot on the felt. This is presentation only: the server has already moved
// the turn on in the same broadcast that carries the card, so the next player
// can act the instant the card leaves the seat — nothing waits for it to dock.
// (The local player's own card is animated by PlayerHand as it leaves the hand,
// so the bottom slot never flies in.)

import { PLAYED_CARD_ARRIVAL_MS } from '../../config/endRoundTiming';

// Flight duration. Shorter than a bot's think time (1200ms), so back-to-back
// plays never stack up, and short enough that a human answering at once still
// sees their own card land after the opponent's. Lives in endRoundTiming so
// the trick magnet's hold can wait for the last card to land and rest.
export const ARRIVAL_MS = PLAYED_CARD_ARRIVAL_MS;

// Where the settle bump begins, as a fraction of the flight.
export const ARRIVAL_SETTLE_AT = 0.8;

// Same curve as the fast-play flight of the local player's card, so both
// gestures read as one house style.
export const ARRIVAL_EASING = 'cubic-bezier(0.3, 0.7, 0.3, 1)';

// Cards leave the seat small (far away) and grow as they arrive.
export const ARRIVAL_START_SCALE = 0.6;

// Slight overshoot as the card lands, like a card slapped onto felt.
export const ARRIVAL_SETTLE_SCALE = 1.06;

// Whole turns of in-plane spin on the way in.
export const ARRIVAL_SPIN_TURNS = 1;

// The slot wrapper is raised above the seat plates (z 10) for the flight so
// the card is never occluded as it leaves the seat. The trick magnet uses 40.
export const ARRIVAL_Z_INDEX = '30';

// Spin sense per seat: a card flicked from the left curls in clockwise, from
// the right anticlockwise, so the rotation reads as coming off that hand.
const SPIN_DIRECTION = Object.freeze({ left: 1, right: -1, top: 1, bottom: -1 });

// Where the seat sits relative to its slot when it cannot be measured (the
// seat has not mounted, jsdom): roughly the default seat anchors.
const FALLBACK_OFFSET = Object.freeze({
    left: Object.freeze({ x: '-30vw', y: '0px' }),
    right: Object.freeze({ x: '30vw', y: '0px' }),
    top: Object.freeze({ x: '0px', y: '-18vh' }),
    bottom: Object.freeze({ x: '0px', y: '35vh' }),
});

// One key per play on the felt. A card is played once per round, and keys
// are pruned as the trick clears, so the same card in a later round is new.
export const arrivalKey = (play) => (
    play && play.playerName && play.card ? `${play.playerName}:${play.card}` : null
);

const rectCenter = (rect) => ({
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
});

/**
 * Offset from the card's resting spot to the seat it should fly from, as CSS
 * lengths. Measured when both rects are real; otherwise a per-seat guess.
 */
export const arrivalOffset = (seatRect, cardRect, seat) => {
    const fallback = FALLBACK_OFFSET[seat] || FALLBACK_OFFSET.top;
    if (!seatRect || !cardRect || !seatRect.width || !cardRect.width) return fallback;
    const from = rectCenter(seatRect);
    const to = rectCenter(cardRect);
    return {
        x: `${Math.round(from.x - to.x)}px`,
        y: `${Math.round(from.y - to.y)}px`,
    };
};

/**
 * Web Animations keyframes for one arrival: seat -> slot with a spin and a
 * settle bump. Ends at the identity transform so the card rests exactly where
 * the slot puts it, and composes with the trick magnet, which transforms the
 * parent element.
 */
export const buildArrivalKeyframes = ({ offset, seat }) => {
    const direction = SPIN_DIRECTION[seat] || 1;
    const spin = -direction * ARRIVAL_SPIN_TURNS * 360;
    return [
        {
            offset: 0,
            transform: `translate(${offset.x}, ${offset.y}) rotate(${spin}deg) scale(${ARRIVAL_START_SCALE})`,
            opacity: 0.85,
            easing: ARRIVAL_EASING,
        },
        {
            offset: ARRIVAL_SETTLE_AT,
            transform: `translate(0px, 0px) rotate(0deg) scale(${ARRIVAL_SETTLE_SCALE})`,
            opacity: 1,
            easing: 'ease-in-out',
        },
        {
            offset: 1,
            transform: 'translate(0px, 0px) rotate(0deg) scale(1)',
            opacity: 1,
        },
    ];
};

/**
 * Decide which displayed plays should fly in. `seen` holds the keys already
 * resting on the felt. The first pass (seeded === false) claims everything
 * already on the table without animating, so mounting mid-trick (reconnect,
 * spectating) doesn't launch a volley of cards from the seats.
 *
 * Returns the pruned set — plays gone from the felt drop out — and the keys
 * that arrived on this pass, in display order.
 */
export const reconcileArrivals = (seen, displayedKeys, seeded = true) => {
    const next = new Set();
    const arriving = [];
    (displayedKeys || []).forEach((key) => {
        if (!key) return;
        if (seeded && !(seen && seen.has(key)) && !next.has(key)) arriving.push(key);
        next.add(key);
    });
    return { seen: next, arriving };
};

export const findSeatAnchor = (scope, playerName) => {
    if (!scope || !playerName || typeof scope.querySelectorAll !== 'function') return null;
    return Array.from(scope.querySelectorAll('[data-deal-player]'))
        .find((element) => element.dataset.dealPlayer === playerName) || null;
};

/**
 * Fly one card element in from its player's seat. Returns the running
 * Animation (or null when the browser cannot animate). The slot wrapper is
 * raised for the flight and released when the card lands; the release checks
 * it still owns the value so it never undercuts the trick magnet's raise.
 */
export const launchArrival = (element, { seat, playerName, scope }) => {
    if (!element || typeof element.animate !== 'function') return null;
    const seatElement = findSeatAnchor(scope, playerName);
    const offset = arrivalOffset(
        seatElement ? seatElement.getBoundingClientRect() : null,
        element.getBoundingClientRect(),
        seat,
    );
    const wrapper = element.closest ? element.closest('[data-played-card-slot]') : null;
    if (wrapper) wrapper.style.zIndex = ARRIVAL_Z_INDEX;
    element.style.willChange = 'transform';

    const animation = element.animate(buildArrivalKeyframes({ offset, seat }), {
        duration: ARRIVAL_MS,
        fill: 'none',
    });
    const settle = () => {
        element.style.willChange = '';
        if (wrapper && wrapper.style.zIndex === ARRIVAL_Z_INDEX) wrapper.style.zIndex = '';
    };
    if (typeof animation.addEventListener === 'function') {
        animation.addEventListener('finish', settle);
        animation.addEventListener('cancel', settle);
    } else if (animation.finished && typeof animation.finished.then === 'function') {
        animation.finished.then(settle, settle);
    }
    return animation;
};
