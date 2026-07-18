import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InsurancePrompt from './InsurancePrompt';

const baseState = {
    bidMultiplier: 1,
    bidderPlayerName: 'Alice',
    bidderRequirement: 20,
    defenderOffers: { Bob: -10, Cara: 5 },
    dealExecuted: false,
};

describe('InsurancePrompt deal-gap preview', () => {
    test('includes signed offers and reports ready when the preview gap reaches zero', async () => {
        const user = userEvent.setup();
        render(
            <InsurancePrompt
                show
                insuranceState={baseState}
                selfPlayerName="Bob"
                emitEvent={vi.fn()}
                onClose={vi.fn()}
            />
        );

        // Ask 20 minus signed offer total (-10 + 5) leaves a gap of 25.
        expect(await screen.findByText('Deal gap: 25 more points needed.')).toBeInTheDocument();

        // Replacing Bob's -10 with +20 makes the combined offers 25 >= ask 20.
        await user.click(screen.getByRole('button', { name: 'Set offer to 20' }));
        expect(screen.getByText('This setting reaches the deal threshold and would lock the agreement.')).toBeInTheDocument();
    });

    test('shows the live negotiation board with every participant', async () => {
        render(
            <InsurancePrompt
                show
                insuranceState={baseState}
                selfPlayerName="Bob"
                emitEvent={vi.fn()}
                onClose={vi.fn()}
            />
        );

        expect(await screen.findByText('Ask')).toBeInTheDocument();
        expect(screen.getByText('Alice')).toBeInTheDocument();
        expect(screen.getByText('You -10 · Cara +5')).toBeInTheDocument();
        expect(screen.getByText('Gap')).toBeInTheDocument();
        expect(screen.getByText('25')).toBeInTheDocument();
    });
});

describe('InsurancePrompt range coverage', () => {
    test('defender slider and quick picks span the full server range (±60 × multiplier)', async () => {
        render(
            <InsurancePrompt
                show
                insuranceState={{ ...baseState, bidMultiplier: 2, defenderOffers: { Bob: -120, Cara: 10 } }}
                selfPlayerName="Bob"
                emitEvent={vi.fn()}
                onClose={vi.fn()}
            />
        );

        const slider = await screen.findByRole('slider', { name: 'Insurance offer' });
        expect(slider).toHaveAttribute('min', '-120');
        expect(slider).toHaveAttribute('max', '120');
        expect(slider).toHaveAttribute('step', '2');
        expect(screen.getByRole('button', { name: 'Set offer to -120' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Set offer to 120' })).toBeInTheDocument();
    });

    test('bidder slider covers the full server range including negative asks', async () => {
        render(
            <InsurancePrompt
                show
                insuranceState={baseState}
                selfPlayerName="Alice"
                emitEvent={vi.fn()}
                onClose={vi.fn()}
            />
        );

        const slider = await screen.findByRole('slider', { name: 'Insurance ask' });
        expect(slider).toHaveAttribute('min', '-120');
        expect(slider).toHaveAttribute('max', '120');
        expect(screen.getByRole('button', { name: 'Set ask to -120' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Set ask to 120' })).toBeInTheDocument();
    });
});

describe('InsurancePrompt saving and attention', () => {
    test('saves through the steppers and notifies the wager-interaction callback', async () => {
        const user = userEvent.setup();
        const emitEvent = vi.fn();
        const onClose = vi.fn();
        const onWagerInteract = vi.fn();
        render(
            <InsurancePrompt
                show
                insuranceState={baseState}
                selfPlayerName="Bob"
                emitEvent={emitEvent}
                onClose={onClose}
                onWagerInteract={onWagerInteract}
            />
        );

        await user.click(await screen.findByRole('button', { name: 'Increase offer by 1' }));
        await user.click(screen.getByRole('button', { name: 'Save Offer' }));

        expect(emitEvent).toHaveBeenCalledWith('updateInsuranceSetting', {
            settingType: 'defenderOffer',
            value: -9,
        });
        expect(onWagerInteract).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    test('pulses the save button while the wager is still at the round default', async () => {
        render(
            <InsurancePrompt
                show
                insuranceState={{ ...baseState, defenderOffers: { Bob: -60, Cara: 5 } }}
                selfPlayerName="Bob"
                emitEvent={vi.fn()}
                onClose={vi.fn()}
            />
        );

        expect(await screen.findByRole('button', { name: 'Save Offer' })).toHaveClass('attention-pulse');
        expect(screen.getByText('not set yet')).toBeInTheDocument();
    });

    test('shows the locked state and hides the editor once a deal executes', async () => {
        render(
            <InsurancePrompt
                show
                insuranceState={{ ...baseState, dealExecuted: true }}
                selfPlayerName="Bob"
                emitEvent={vi.fn()}
                onClose={vi.fn()}
            />
        );

        expect(await screen.findByText('DEAL LOCKED')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Save Offer' })).not.toBeInTheDocument();
        expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    });
});
