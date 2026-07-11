import React, { useRef } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import DealAnimation from './DealAnimation';
import {
    buildDealSequence,
    DEAL_CARD_FLIGHT_MS,
    DEAL_CARD_STAGGER_MS,
} from './dealSequence';

const rect = (left, top, width, height) => ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
});

const RECTS = {
    outsideDeck: rect(900, 900, 40, 60),
    deck: rect(100, 120, 40, 60),
    localHand: rect(200, 800, 400, 120),
    Bob: rect(20, 300, 120, 70),
    Cara: rect(660, 300, 120, 70),
    widow: rect(700, 90, 50, 70),
};

const Harness = ({ animationProps }) => {
    const scopeRef = useRef(null);
    return (
        <>
            <div data-deal-source="deck" data-rect="outsideDeck" />
            <div data-testid="deal-scope" ref={scopeRef}>
                <div data-deal-source="deck" data-rect="deck" />
                <div data-deal-target="local-hand" data-rect="localHand" />
                <div data-deal-player="Bob" data-rect="Bob" />
                <div data-deal-player="Cara" data-rect="Cara" />
                <div data-deal-target="widow" data-rect="widow" />
            </div>
            <DealAnimation {...animationProps} scopeRef={scopeRef} />
        </>
    );
};

const baseProps = (overrides = {}) => ({
    active: true,
    animationKey: 'round-1',
    playerOrder: ['Alice', 'Bob', 'Cara'],
    localPlayerName: 'Alice',
    renderCard: vi.fn(() => <div data-testid="flight-card-back" />),
    onCardLaunch: vi.fn(),
    onCardArrive: vi.fn(),
    onComplete: vi.fn(),
    ...overrides,
});

describe('DealAnimation', () => {
    let rectSpy;

    beforeEach(() => {
        vi.useFakeTimers();
        Object.defineProperty(window, 'innerHeight', {
            configurable: true,
            value: 1000,
        });
        rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
            .mockImplementation(function getRect() {
                return RECTS[this.dataset.rect] || rect(0, 0, 0, 0);
            });
    });

    afterEach(() => {
        cleanup();
        rectSpy?.mockRestore();
        vi.useRealTimers();
    });

    test('uses scoped live geometry for local hand, player nameplate, and widow targets', () => {
        const props = baseProps();
        const { getByTestId } = render(<Harness animationProps={props} />);

        act(() => vi.advanceTimersByTime(0));
        const first = document.querySelector('[data-deal-index="0"]');
        expect(first).toHaveAttribute('data-deal-destination', 'local-hand');
        // The in-scope deck center is (120, 150). A 6vh card at 1000px
        // viewport height is 43px wide and 60px high.
        expect(first.style.getPropertyValue('--deal-start-x')).toBe('98.5px');
        expect(first.style.getPropertyValue('--deal-start-y')).toBe('120px');
        expect(getByTestId('deal-scope')).not.toContainElement(first.closest('.deal-animation-overlay'));

        RECTS.Bob = rect(80, 260, 160, 80);
        act(() => vi.advanceTimersByTime(DEAL_CARD_STAGGER_MS));
        const second = document.querySelector('[data-deal-index="1"]');
        expect(second).toHaveAttribute('data-deal-destination', 'Bob');
        expect(second.style.getPropertyValue('--deal-end-x')).toBe('138.5px');
        expect(second.style.getPropertyValue('--deal-end-y')).toBe('270px');

        act(() => vi.advanceTimersByTime(DEAL_CARD_STAGGER_MS));
        expect(document.querySelector('[data-deal-index="2"]'))
            .toHaveAttribute('data-deal-destination', 'Cara');

        act(() => vi.advanceTimersByTime(DEAL_CARD_STAGGER_MS));
        expect(document.querySelector('[data-deal-index="3"]'))
            .toHaveAttribute('data-deal-destination', 'widow');
    });

    test('renders only anonymous face-down cards', () => {
        const renderCard = vi.fn(() => <div data-testid="flight-card-back" />);
        render(<Harness animationProps={baseProps({ renderCard })} />);

        act(() => vi.advanceTimersByTime(DEAL_CARD_STAGGER_MS * 4));

        expect(renderCard).toHaveBeenCalled();
        renderCard.mock.calls.forEach(([card, options]) => {
            expect(card).toBeNull();
            expect(options).toEqual({ isFaceDown: true, small: true });
        });
        expect(document.querySelector('.deal-animation-overlay')).toHaveAttribute('aria-hidden', 'true');
    });

    test('launches on the stagger, arrives after the flight, and completes exactly once', () => {
        const props = baseProps();
        const total = buildDealSequence(props.playerOrder).length;
        render(<Harness animationProps={props} />);

        act(() => vi.advanceTimersByTime(0));
        expect(props.onCardLaunch).toHaveBeenCalledTimes(1);
        expect(props.onCardArrive).not.toHaveBeenCalled();
        expect(props.onCardLaunch).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ type: 'player', playerName: 'Alice', circuit: 0 }),
            0,
            total,
        );

        const lastLaunchAt = (total - 1) * DEAL_CARD_STAGGER_MS;
        act(() => vi.advanceTimersByTime(lastLaunchAt));
        expect(props.onCardLaunch).toHaveBeenCalledTimes(total);
        expect(props.onComplete).not.toHaveBeenCalled();

        act(() => vi.advanceTimersByTime(DEAL_CARD_FLIGHT_MS - 1));
        expect(props.onComplete).not.toHaveBeenCalled();
        act(() => vi.advanceTimersByTime(1));

        expect(props.onCardArrive).toHaveBeenCalledTimes(total);
        expect(props.onComplete).toHaveBeenCalledTimes(1);
        expect(document.querySelectorAll('.deal-animation-card')).toHaveLength(0);

        act(() => vi.runAllTimers());
        expect(props.onComplete).toHaveBeenCalledTimes(1);
    });

    test('finishes every outstanding event once when the viewport changes', () => {
        const props = baseProps();
        const total = buildDealSequence(props.playerOrder).length;
        render(<Harness animationProps={props} />);

        act(() => vi.advanceTimersByTime(DEAL_CARD_STAGGER_MS));
        expect(props.onCardLaunch).toHaveBeenCalledTimes(2);

        act(() => window.dispatchEvent(new Event('resize')));
        expect(props.onCardLaunch).toHaveBeenCalledTimes(total);
        expect(props.onCardArrive).toHaveBeenCalledTimes(total);
        expect(props.onComplete).toHaveBeenCalledTimes(1);
        expect(document.querySelectorAll('.deal-animation-card')).toHaveLength(0);

        act(() => {
            window.dispatchEvent(new Event('orientationchange'));
            vi.runAllTimers();
        });
        expect(props.onCardLaunch).toHaveBeenCalledTimes(total);
        expect(props.onCardArrive).toHaveBeenCalledTimes(total);
        expect(props.onComplete).toHaveBeenCalledTimes(1);
    });

    test('cleans pending launch and arrival timers without completing after unmount', () => {
        const props = baseProps();
        const { unmount } = render(<Harness animationProps={props} />);

        act(() => vi.advanceTimersByTime(0));
        expect(props.onCardLaunch).toHaveBeenCalledTimes(1);
        unmount();

        act(() => vi.runAllTimers());
        expect(props.onCardLaunch).toHaveBeenCalledTimes(1);
        expect(props.onCardArrive).not.toHaveBeenCalled();
        expect(props.onComplete).not.toHaveBeenCalled();
        expect(document.querySelector('.deal-animation-overlay')).not.toBeInTheDocument();
    });
});
