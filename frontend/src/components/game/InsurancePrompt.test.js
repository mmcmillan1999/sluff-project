import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InsurancePrompt from './InsurancePrompt';

describe('InsurancePrompt deal-gap preview', () => {
    test('includes signed offers and reports ready when the preview gap reaches zero', async () => {
        const user = userEvent.setup();
        render(
            <InsurancePrompt
                show
                insuranceState={{
                    bidMultiplier: 1,
                    bidderPlayerName: 'Alice',
                    bidderRequirement: 20,
                    defenderOffers: { Bob: -10, Cara: 5 }
                }}
                selfPlayerName="Bob"
                emitEvent={vi.fn()}
                onClose={vi.fn()}
            />
        );

        // Ask 20 minus signed offer total (-10 + 5) leaves a gap of 25.
        expect(await screen.findByText('Deal gap: 25 more points needed.')).toBeInTheDocument();

        // Replacing Bob's -10 with +15 makes the combined offers 20, so gap = 0.
        await user.click(screen.getByRole('button', { name: 'Set offer to 15' }));
        expect(screen.getByText('This setting reaches the deal threshold and would lock the agreement.')).toBeInTheDocument();
    });
});
