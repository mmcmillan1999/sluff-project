import React from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import PlayerHand, {
  FAST_LIFT_WINDOW_MS,
  FAST_FLIGHT_MS,
} from './PlayerHand';
import { setCardPlayStyle } from '../../utils/playStyle';

const { physicsInstances } = vi.hoisted(() => ({ physicsInstances: [] }));

vi.mock('../../utils/CardPhysicsEngine', () => ({
  default: class MockCardPhysicsEngine {
    constructor() {
      this.autoReleaseResult = undefined;
      physicsInstances.push(this);
    }

    cancelAll() {}
    cleanupCard() {}
    dragCard() {}
    getActiveCardInfo() { return { cards: {}, activeCount: 0 }; }
    updateAllActiveCardPositions() {}
    handleWindowResize() {}
    grabCard() {}

    releaseCard(card, dropZoneCenter, callback) {
      this.lastRelease = { card, dropZoneCenter };
      this.releaseCallback = callback;
      if (this.autoReleaseResult !== undefined) callback(this.autoReleaseResult);
    }
  },
}));

const makeDropZoneRef = () => {
  const dropZone = document.createElement('div');
  dropZone.appendChild(document.createElement('div'));
  dropZone.getBoundingClientRect = () => ({
    left: 300,
    top: 200,
    right: 500,
    bottom: 400,
    width: 200,
    height: 200,
  });
  return { current: dropZone };
};

const tableState = {
  state: 'Playing Phase',
  hands: { Me: ['AS'] },
  bidWinnerInfo: { userId: 1, playerName: 'Me', bid: 'Solo' },
  trickTurnPlayerName: 'Me',
  currentTrickCards: [],
  leadSuitCurrentTrick: null,
  trumpSuit: 'H',
  trumpBroken: false,
  players: { 1: { userId: 1, playerName: 'Me' } },
};

const renderHand = (emitEvent, stateOverrides = {}) => render(
  <PlayerHand
    currentTableState={{ ...tableState, ...stateOverrides }}
    selfPlayerName="Me"
    isSpectator={false}
    playerId={1}
    isObserverMode={false}
    emitEvent={emitEvent}
    renderCard={(card) => <span>{card}</span>}
    dropZoneRef={makeDropZoneRef()}
  />
);

describe('PlayerHand flick-only play contract', () => {
  beforeEach(() => {
    physicsInstances.length = 0;
    window.localStorage.clear(); // default play style: flick
  });

  test('stationary pointer releases and keyboard activation do not play a card', () => {
    const emitEvent = vi.fn();
    renderHand(emitEvent);

    const card = document.getElementById('card-AS');
    const physics = physicsInstances[0];
    physics.autoReleaseResult = false;

    fireEvent.keyDown(card, { key: 'Enter' });
    fireEvent.keyDown(card, { key: ' ' });
    fireEvent.mouseDown(card, { clientX: 100, clientY: 100 });
    fireEvent.mouseUp(document, { clientX: 100, clientY: 100 });
    fireEvent.touchStart(card, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchEnd(document, { changedTouches: [{ clientX: 100, clientY: 100 }] });

    expect(emitEvent).not.toHaveBeenCalledWith('playCard', expect.anything());
  });

  test('playCard is emitted only after the physics release reports success', () => {
    const emitEvent = vi.fn();
    renderHand(emitEvent);

    const card = document.getElementById('card-AS');
    const physics = physicsInstances[0];

    fireEvent.mouseDown(card, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(document, { clientX: 260, clientY: 180 });
    fireEvent.mouseUp(document, { clientX: 260, clientY: 180 });

    expect(emitEvent).not.toHaveBeenCalledWith('playCard', expect.anything());
    expect(physics.lastRelease.card).toBe('AS');

    act(() => physics.releaseCallback(true));

    expect(emitEvent).toHaveBeenCalledWith('playCard', { card: 'AS' });
  });
});

describe('PlayerHand fast play style (click-click)', () => {
  beforeEach(() => {
    physicsInstances.length = 0;
    window.localStorage.clear();
    setCardPlayStyle('fast');
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('first click raises the card without playing it; it reseats after the window', () => {
    const emitEvent = vi.fn();
    renderHand(emitEvent);

    const card = document.getElementById('card-AS');
    fireEvent.click(card);

    expect(card.className).toContain('is-fast-lifted');
    expect(card.style.transform).toContain('translateY');
    expect(emitEvent).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(FAST_LIFT_WINDOW_MS));

    expect(card.className).not.toContain('is-fast-lifted');
    expect(emitEvent).not.toHaveBeenCalled();
  });

  test('second click within the window flies the card with a full spin, then plays it', () => {
    const emitEvent = vi.fn();
    renderHand(emitEvent);

    const card = document.getElementById('card-AS');
    fireEvent.click(card);
    fireEvent.click(card);

    // In flight: portaled to <body>, fixed positioning, spinning toward the
    // drop spot, not played yet. (Re-query: the portal remounts the wrapper.)
    const flying = document.getElementById('card-AS');
    expect(flying.parentElement).toBe(document.body);
    expect(flying.style.position).toBe('fixed');
    expect(flying.style.transform).toContain('rotate(360deg)');
    expect(emitEvent).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(FAST_FLIGHT_MS));

    expect(emitEvent).toHaveBeenCalledWith('playCard', { card: 'AS' });
    expect(emitEvent).toHaveBeenCalledTimes(1);
    // The drag physics never got involved.
    expect(physicsInstances[0].lastRelease).toBeUndefined();
  });

  test('the play still fires when the parent re-renders with a fresh emitEvent mid-flight', () => {
    // App.js re-creates emitEvent on every socket broadcast; the emit timer
    // must not restart when the prop identity churns during the flight.
    const calls = [];
    const makeEmit = () => vi.fn((...args) => calls.push(args));
    const props = {
      currentTableState: tableState,
      selfPlayerName: 'Me',
      isSpectator: false,
      playerId: 1,
      isObserverMode: false,
      renderCard: (card) => <span>{card}</span>,
      dropZoneRef: makeDropZoneRef(),
    };
    const view = render(<PlayerHand {...props} emitEvent={makeEmit()} />);

    const card = document.getElementById('card-AS');
    fireEvent.click(card);
    fireEvent.click(card);

    act(() => vi.advanceTimersByTime(150));
    view.rerender(<PlayerHand {...props} emitEvent={makeEmit()} />);
    act(() => vi.advanceTimersByTime(150));
    view.rerender(<PlayerHand {...props} emitEvent={makeEmit()} />);
    act(() => vi.advanceTimersByTime(FAST_FLIGHT_MS - 300));

    expect(calls).toEqual([['playCard', { card: 'AS' }]]);
  });

  test('switching back to flick mid-flight still completes the committed play exactly once', () => {
    const emitEvent = vi.fn();
    renderHand(emitEvent);

    const card = document.getElementById('card-AS');
    fireEvent.click(card);
    fireEvent.click(card);

    act(() => { setCardPlayStyle('flick'); });

    // The flight keeps its styling instead of snapping back into the fan.
    expect(document.getElementById('card-AS').style.position).toBe('fixed');

    act(() => vi.advanceTimersByTime(FAST_FLIGHT_MS));
    expect(emitEvent).toHaveBeenCalledWith('playCard', { card: 'AS' });
    expect(emitEvent).toHaveBeenCalledTimes(1);
  });

  test('clicking a different card reseats the first and raises the second', () => {
    const emitEvent = vi.fn();
    renderHand(emitEvent, { hands: { Me: ['AS', 'KS'] }, trumpSuit: 'S', trumpBroken: true });

    const ace = document.getElementById('card-AS');
    const king = document.getElementById('card-KS');

    fireEvent.click(ace);
    expect(ace.className).toContain('is-fast-lifted');

    fireEvent.click(king);
    expect(ace.className).not.toContain('is-fast-lifted');
    expect(king.className).toContain('is-fast-lifted');
    expect(emitEvent).not.toHaveBeenCalled();

    fireEvent.click(king);
    act(() => vi.advanceTimersByTime(FAST_FLIGHT_MS));
    expect(emitEvent).toHaveBeenCalledWith('playCard', { card: 'KS' });
  });

  test('illegal cards ignore clicks entirely', () => {
    const emitEvent = vi.fn();
    // Trick led with spades: the off-suit KH is illegal while AS must follow.
    renderHand(emitEvent, {
      hands: { Me: ['AS', 'KH'] },
      currentTrickCards: [{ playerName: 'Other', card: '9S' }],
      leadSuitCurrentTrick: 'S',
    });

    const heart = document.getElementById('card-KH');
    fireEvent.click(heart);
    fireEvent.click(heart);
    act(() => vi.advanceTimersByTime(FAST_FLIGHT_MS + FAST_LIFT_WINDOW_MS));

    expect(heart.className).not.toContain('is-fast-lifted');
    expect(emitEvent).not.toHaveBeenCalled();
  });

  test('fast mode never engages the drag physics', () => {
    const emitEvent = vi.fn();
    renderHand(emitEvent);

    const card = document.getElementById('card-AS');
    fireEvent.mouseDown(card, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(document, { clientX: 260, clientY: 180 });
    fireEvent.mouseUp(document, { clientX: 260, clientY: 180 });

    expect(physicsInstances[0].lastRelease).toBeUndefined();
    expect(emitEvent).not.toHaveBeenCalled();
  });
});
