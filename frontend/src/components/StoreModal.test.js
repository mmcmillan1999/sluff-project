import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StoreModal from './StoreModal';
import { getCosmetics } from '../utils/cosmetics';

describe('StoreModal', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    test('renders both categories with every item free', () => {
        render(<StoreModal show onClose={vi.fn()} />);

        const dialog = screen.getByRole('dialog', { name: 'Sluff store' });
        expect(within(dialog).getByText('Card Decks')).toBeInTheDocument();
        expect(within(dialog).getByText('Trump Broken')).toBeInTheDocument();
        expect(within(dialog).getByText('Sluff Classic')).toBeInTheDocument();
        expect(within(dialog).getByText('McMillan Crest')).toBeInTheDocument();
        expect(within(dialog).getByText('Lightning Strike')).toBeInTheDocument();
        expect(within(dialog).getByText('Shatterglass')).toBeInTheDocument();
        expect(within(dialog).getAllByText('FREE')).toHaveLength(4);
    });

    test('marks the current loadout equipped and swaps on Use', async () => {
        const user = userEvent.setup();
        render(<StoreModal show onClose={vi.fn()} />);

        // Defaults equipped: classic deck + lightning effect
        expect(screen.getAllByRole('button', { name: 'Equipped ✓' })).toHaveLength(2);

        const useButtons = screen.getAllByRole('button', { name: 'Use' });
        expect(useButtons).toHaveLength(2);

        // Equip the McMillan deck (first non-equipped item is in Card Decks)
        await user.click(useButtons[0]);

        expect(getCosmetics().deckSkin).toBe('mcmillan');
        expect(screen.getAllByRole('button', { name: 'Equipped ✓' })).toHaveLength(2);
        const mcmillanItem = screen.getByText('McMillan Crest').closest('.store-item');
        expect(within(mcmillanItem).getByRole('button', { name: 'Equipped ✓' })).toBeInTheDocument();
    });

    test('renders nothing when closed and closes with Escape', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        const { rerender } = render(<StoreModal show={false} onClose={onClose} />);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

        rerender(<StoreModal show onClose={onClose} />);
        await user.keyboard('{Escape}');
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
