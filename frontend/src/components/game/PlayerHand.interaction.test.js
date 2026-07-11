import React from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import PlayerHand from './PlayerHand';

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

const renderHand = (emitEvent) => render(
  <PlayerHand
    currentTableState={tableState}
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
