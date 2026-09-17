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
    test('defender slider spans the full server range; quick picks hug real outcomes', async () => {
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
        // Data-tuned picks (±σ band × multiplier 2), not the theoretical extremes
        expect(screen.getByRole('button', { name: 'Set offer to -40' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Set offer to 60' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Set offer to -120' })).not.toBeInTheDocument();
    });

    test('bidder slider covers the full server range; quick picks hug real outcomes', async () => {
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
        expect(screen.getByRole('button', { name: 'Set ask to -40' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Set ask to 60' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Set ask to 120' })).not.toBeInTheDocument();
    });
});

describe('InsurancePrompt saving and attention', () => {
    test('saves through the steppers and notifies the insurance-interaction callback', async () => {
        const user = userEvent.setup();
        const emitEvent = vi.fn();
        const onClose = vi.fn();
        const onInsuranceInteract = vi.fn();
        render(
            <InsurancePrompt
                show
                insuranceState={baseState}
                selfPlayerName="Bob"
                emitEvent={emitEvent}
                onClose={onClose}
                onInsuranceInteract={onInsuranceInteract}
            />
        );

        await user.click(await screen.findByRole('button', { name: 'Increase offer by 1' }));
        await user.click(screen.getByRole('button', { name: 'Save Offer' }));

        expect(emitEvent).toHaveBeenCalledWith('updateInsuranceSetting', {
            settingType: 'defenderOffer',
            value: -9,
        });
        expect(onInsuranceInteract).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    test('pulses the save button while the insurance value is still at the round default', async () => {
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

describe('InsurancePrompt for an observer', () => {
    test('a spectator gets the live board and the watching note, never the editor', async () => {
        const emitEvent = vi.fn();
        render(
            <InsurancePrompt
                show
                insuranceState={baseState}
                selfPlayerName="Watcher"
                isSpectator
                emitEvent={emitEvent}
                onClose={vi.fn()}
            />
        );

        expect(await screen.findByText('Ask')).toBeInTheDocument();
        expect(screen.getByText('Alice')).toBeInTheDocument();
        expect(screen.getByText('Bob -10 · Cara +5')).toBeInTheDocument();
        expect(screen.getByText('25')).toBeInTheDocument();
        expect(screen.getByText(/only the bidder and the two defenders can change it/)).toBeInTheDocument();
        expect(screen.queryByRole('slider')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Save/ })).not.toBeInTheDocument();
        expect(emitEvent).not.toHaveBeenCalled();
    });

    test('a spectator who shares a defender\'s name is still only watching', async () => {
        render(
            <InsurancePrompt
                show
                insuranceState={baseState}
                selfPlayerName="Bob"
                isSpectator
                emitEvent={vi.fn()}
                onClose={vi.fn()}
            />
        );

        expect(await screen.findByText(/only the bidder and the two defenders can change it/)).toBeInTheDocument();
        expect(screen.getByText('Bob -10 · Cara +5')).toBeInTheDocument();
        expect(screen.queryByRole('slider')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Save Offer' })).not.toBeInTheDocument();
    });

    test('the locked deal reads the same for a spectator', async () => {
        render(
            <InsurancePrompt
                show
                insuranceState={{ ...baseState, defenderOffers: { Bob: 0, Cara: 20 }, dealExecuted: true }}
                selfPlayerName="Watcher"
                isSpectator
                emitEvent={vi.fn()}
                onClose={vi.fn()}
            />
        );

        expect(await screen.findByText('DEAL LOCKED')).toBeInTheDocument();
        expect(screen.getByText('Bob 0 · Cara +20')).toBeInTheDocument();
        expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    });
});

// Nobody may offer more points than they hold: the server sends each seat
// the most it can put up (every point but its last) in insuranceState.limits.
describe('InsurancePrompt stack limits', () => {
    const shortStacks = {
        ...baseState,
        // Bob holds 13 points, Alice (the bidder) 9.
        limits: { Alice: { min: -8, max: 120 }, Bob: { min: -60, max: 12 }, Cara: { min: -60, max: 60 } },
    };

    test('a defender cannot pick, step or slide past every point but their last', async () => {
        const user = userEvent.setup();
        const emitEvent = vi.fn();
        render(<InsurancePrompt show insuranceState={shortStacks} selfPlayerName="Bob" emitEvent={emitEvent} onClose={vi.fn()} />);

        expect(await screen.findByText('The most you can put up is 12 — every point you hold but one.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Set offer to 10' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Set offer to 20' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Set offer to 30' })).toBeDisabled();
        // The slider keeps the round's full range so zero stays centred.
        expect(screen.getByRole('slider')).toHaveAttribute('max', '60');

        await user.click(screen.getByRole('button', { name: 'Set offer to 10' }));
        await user.click(screen.getByRole('button', { name: 'Increase offer by 1' }));
        await user.click(screen.getByRole('button', { name: 'Increase offer by 1' }));
        expect(screen.getByRole('button', { name: 'Increase offer by 1' })).toBeDisabled();
        await user.click(screen.getByRole('button', { name: 'Save Offer' }));
        expect(emitEvent).toHaveBeenCalledWith('updateInsuranceSetting', { settingType: 'defenderOffer', value: 12 });
    });

    test('a bidder cannot pay more than they hold to escape, and may still ask for anything', async () => {
        render(<InsurancePrompt show insuranceState={shortStacks} selfPlayerName="Alice" emitEvent={vi.fn()} onClose={vi.fn()} />);

        expect(await screen.findByText('The most you can put up is 8 — every point you hold but one.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Set ask to -20' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Set ask to -40' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Set ask to 60' })).toBeEnabled();
    });

    test('says nothing when the stack is deep, or when the server sends no limits', async () => {
        const { rerender } = render(<InsurancePrompt show insuranceState={shortStacks} selfPlayerName="Cara" emitEvent={vi.fn()} onClose={vi.fn()} />);
        expect(await screen.findByRole('button', { name: 'Set offer to 30' })).toBeEnabled();
        expect(screen.queryByText(/The most you can put up/)).not.toBeInTheDocument();

        rerender(<InsurancePrompt show insuranceState={baseState} selfPlayerName="Bob" emitEvent={vi.fn()} onClose={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'Set offer to 30' })).toBeEnabled();
        expect(screen.queryByText(/The most you can put up/)).not.toBeInTheDocument();
    });

    test('a seat on its last point is told it can still ask to be paid', async () => {
        const lastPoint = { ...baseState, limits: { Bob: { min: -60, max: 0 } } };
        render(<InsurancePrompt show insuranceState={lastPoint} selfPlayerName="Bob" emitEvent={vi.fn()} onClose={vi.fn()} />);
        expect(await screen.findByText('You have no points to put up — you can still ask to be paid.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Set offer to 10' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Set offer to -10' })).toBeEnabled();
    });
});
