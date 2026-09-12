// Everyone at the table can follow the insurance negotiation; only the
// bidder and the two defenders can move it. Observers — spectators,
// tournament watchers, the sitting-out dealer — get the read-only board.
// Sept 2026: spectators used to get the inactive placeholder instead.
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InsuranceControls from './InsuranceControls';

const negotiation = {
    isActive: true,
    bidMultiplier: 1,
    bidderPlayerName: 'Alice',
    bidderRequirement: 20,
    defenderOffers: { Bob: -10, Cara: 5 },
    dealExecuted: false,
};

const renderControls = (props = {}) => {
    const baseProps = {
        insuranceState: negotiation,
        selfPlayerName: 'Watcher',
        isSpectator: true,
        emitEvent: vi.fn(),
        onOpenPrompt: vi.fn(),
        insuranceTouched: false,
        onInsuranceInteract: vi.fn(),
        ...props,
    };
    const utils = render(<InsuranceControls {...baseProps} />);
    return {
        ...utils,
        props: baseProps,
        rerenderWith: (next) => utils.rerender(<InsuranceControls {...baseProps} {...next} />),
    };
};

const stepper = () => screen.queryByRole('button', { name: /^(Increase|Decrease) insurance/ });

describe('InsuranceControls for an observer', () => {
    test('a spectator sees the ask, every offer and the gap, with no steppers', () => {
        renderControls();

        expect(screen.getByText('LOCK SCORE')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Deal gap: 25\./ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Insurance ask from Alice: 20. Open details' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Insurance offer from Bob: -10. Open details' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Insurance offer from Cara: 5. Open details' })).toBeInTheDocument();
        expect(stepper()).not.toBeInTheDocument();
        expect(screen.queryByText('Insurance: lock score')).not.toBeInTheDocument();
    });

    test('tapping any tile opens the details and never emits an insurance change', async () => {
        const user = userEvent.setup();
        const { props } = renderControls();

        await user.click(screen.getByRole('button', { name: 'Insurance offer from Bob: -10. Open details' }));
        await user.click(screen.getByRole('button', { name: 'Insurance ask from Alice: 20. Open details' }));
        await user.click(screen.getByRole('button', { name: /^Deal gap: 25\./ }));

        expect(props.onOpenPrompt).toHaveBeenCalledTimes(3);
        expect(props.emitEvent).not.toHaveBeenCalled();
        expect(props.onInsuranceInteract).not.toHaveBeenCalled();
    });

    test('the board follows the negotiation as offers move', () => {
        const { rerenderWith } = renderControls();

        rerenderWith({ insuranceState: { ...negotiation, defenderOffers: { Bob: -10, Cara: 25 } } });

        expect(screen.getByRole('button', { name: /^Deal gap: 5\./ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Insurance offer from Cara: 25. Open details' })).toBeInTheDocument();

        rerenderWith({ insuranceState: { ...negotiation, bidderRequirement: 10, defenderOffers: { Bob: -10, Cara: 25 } } });

        expect(screen.getByRole('button', { name: 'Insurance ask from Alice: 10. Open details' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Deal gap: -5\. Deal threshold reached/ })).toBeInTheDocument();
    });

    test('shows the locked deal once the offers meet the ask', () => {
        const { rerenderWith } = renderControls();

        rerenderWith({ insuranceState: { ...negotiation, defenderOffers: { Bob: 0, Cara: 20 }, dealExecuted: true } });

        expect(screen.getByText('DEAL LOCKED')).toBeInTheDocument();
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    test('a spectator who shares the bidder\'s name is still only watching', () => {
        renderControls({ selfPlayerName: 'Alice' });

        expect(screen.getByRole('button', { name: 'Insurance ask from Alice: 20. Open details' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Your insurance/ })).not.toBeInTheDocument();
        expect(stepper()).not.toBeInTheDocument();
    });

    test('the sitting-out dealer reads the same board', () => {
        renderControls({ selfPlayerName: 'Drew', isSpectator: false });

        expect(screen.getByRole('button', { name: 'Insurance ask from Alice: 20. Open details' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Insurance offer from Bob: -10. Open details' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Insurance offer from Cara: 5. Open details' })).toBeInTheDocument();
        expect(stepper()).not.toBeInTheDocument();
    });

    test('keeps the footer placeholder while insurance is not running', () => {
        renderControls({ insuranceState: { isActive: false } });

        expect(screen.getByText('Insurance: lock score')).toBeInTheDocument();
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
});

describe('InsuranceControls for a party to the deal', () => {
    test('a defender keeps the steppers and the emit path, without the observer tiles', async () => {
        const user = userEvent.setup();
        const { props } = renderControls({ selfPlayerName: 'Bob', isSpectator: false });

        expect(screen.getByRole('button', { name: 'Your insurance offer: -10. Open details' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Insurance (ask|offer) from/ })).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Increase insurance offer' }));

        expect(props.emitEvent).toHaveBeenCalledWith('updateInsuranceSetting', { settingType: 'defenderOffer', value: -9 });
        expect(props.onInsuranceInteract).toHaveBeenCalledTimes(1);
    });

    test('the bidder keeps the ask steppers', async () => {
        const user = userEvent.setup();
        const { props } = renderControls({ selfPlayerName: 'Alice', isSpectator: false });

        await user.click(screen.getByRole('button', { name: 'Decrease insurance ask' }));

        expect(props.emitEvent).toHaveBeenCalledWith('updateInsuranceSetting', { settingType: 'bidderRequirement', value: 19 });
    });
});
