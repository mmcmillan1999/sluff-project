import React from 'react';
import { act, render, screen } from '@testing-library/react';
import FrogWidowReveal, { FROG_WIDOW_RETURN_MS } from './FrogWidowReveal';

const renderCard = (card) => <span data-testid="mock-card">{card}</span>;

describe('FrogWidowReveal', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    test('shows the widow cards on the felt while the exchange is active', () => {
        render(<FrogWidowReveal active cards={['AS', 'KH', '9D']} renderCard={renderCard} />);
        expect(screen.getAllByTestId('mock-card').map(el => el.textContent))
            .toEqual(['AS', 'KH', '9D']);
    });

    test('renders nothing when no exchange is active', () => {
        render(<FrogWidowReveal active={false} cards={[]} renderCard={renderCard} />);
        expect(screen.queryByTestId('frog-widow-reveal')).not.toBeInTheDocument();
    });

    test('flies the cards back to the pile and unmounts after the exchange', () => {
        vi.useFakeTimers();
        const { rerender } = render(
            <FrogWidowReveal active cards={['AS', 'KH', '9D']} renderCard={renderCard} />
        );

        rerender(<FrogWidowReveal active={false} cards={[]} renderCard={renderCard} />);
        expect(screen.getByTestId('frog-widow-reveal').className).toContain('is-returning');
        // The cards stay visible for the return flight...
        expect(screen.getAllByTestId('mock-card')).toHaveLength(3);

        // ...then the component unmounts.
        act(() => vi.advanceTimersByTime(FROG_WIDOW_RETURN_MS));
        expect(screen.queryByTestId('frog-widow-reveal')).not.toBeInTheDocument();
    });
});
