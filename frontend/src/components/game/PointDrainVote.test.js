import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import PointDrainVote from './PointDrainVote';
import PointDrainSheet from './PointDrainSheet';

const NOW = 1_800_000_000_000;
const drain = (overrides = {}) => ({ percent: 0, par: 120, last: null, options: [5, 7.5, 10, 15, 20], recommended: 10, ...overrides });
const openVote = (votes, percent = 10) => ({
    isActive: true, initiator: 'Brandi', percent, votes, endsAt: NOW + 27_000, resolution: null, resolvedAt: null,
});
const makeState = (overrides = {}) => ({
    tableId: 'table-1',
    serverTime: NOW,
    pointDrain: drain(),
    drainVote: { isActive: false, initiator: null, percent: null, votes: {}, endsAt: null, resolution: null, resolvedAt: null },
    ...overrides,
});

describe('PointDrainVote', () => {
    beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW + 4000); });
    afterEach(() => { vi.useRealTimers(); });

    test('a seat that has not answered sees the proposal, the clock and both answers', () => {
        const onVote = vi.fn();
        render(
            <PointDrainVote
                currentTableState={makeState({ drainVote: openVote({ Me: null, Brandi: 'yes', Elena: null }) })}
                selfPlayerName="Me"
                isSpectator={false}
                onVote={onVote}
            />
        );
        // Counted from when the vote ARRIVED (27 s of lead), not from a clock
        // that disagrees with the server's by four seconds.
        expect(screen.getByText('Table vote · 27s')).toBeInTheDocument();
        expect(screen.getByText('Brandi')).toBeInTheDocument();
        expect(screen.getByText('10%')).toBeInTheDocument();
        expect(screen.getByText(/Nobody can lose their last point/)).toBeInTheDocument();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'AGREE' }));
        expect(onVote).toHaveBeenCalledWith('yes');
        fireEvent.click(screen.getByRole('button', { name: 'NO THANKS' }));
        expect(onVote).toHaveBeenCalledWith('no');

        act(() => { vi.advanceTimersByTime(5000); });
        expect(screen.getByText('Table vote · 22s')).toBeInTheDocument();
    });

    test('a seat that has answered, and a spectator, get the tally and no buttons', () => {
        const votes = { Me: 'yes', Brandi: 'yes', Elena: null };
        const { rerender } = render(
            <PointDrainVote currentTableState={makeState({ drainVote: openVote(votes) })} selfPlayerName="Me" isSpectator={false} onVote={() => {}} />
        );
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
        expect(screen.getByText(/You agreed\. Waiting for the table… \(2\/3\)/)).toBeInTheDocument();

        rerender(
            <PointDrainVote currentTableState={makeState({ drainVote: openVote({ Brandi: 'yes', Elena: null, Marcus: null }) })} selfPlayerName="Watcher" isSpectator onVote={() => {}} />
        );
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
        expect(screen.getByText(/Waiting for the table… \(1\/3\)/)).toBeInTheDocument();
    });

    test('a proposal to stop the drain reads as one', () => {
        render(
            <PointDrainVote currentTableState={makeState({ pointDrain: drain({ percent: 10 }), drainVote: openVote({ Me: null, Brandi: 'yes' }, 0) })} selfPlayerName="Me" isSpectator={false} onVote={() => {}} />
        );
        expect(screen.getByText('stop dropping')).toBeInTheDocument();
        expect(screen.queryByText(/last point/)).not.toBeInTheDocument();
    });

    test('the outcome lingers for a moment, then the dock clears', () => {
        const closed = (resolution) => ({ isActive: false, initiator: 'Brandi', percent: 15, votes: {}, endsAt: null, resolution, resolvedAt: NOW + 3000 });
        const { rerender } = render(
            <PointDrainVote currentTableState={makeState({ drainVote: closed('agreed') })} selfPlayerName="Me" isSpectator={false} onVote={() => {}} />
        );
        expect(screen.getByText(/Agreed\. Every score drops 15% after each round, starting with the next deal\./)).toBeInTheDocument();
        act(() => { vi.advanceTimersByTime(5000); });
        expect(screen.queryByRole('status')).not.toBeInTheDocument();

        rerender(
            <PointDrainVote currentTableState={makeState({ drainVote: { ...closed('declined'), resolvedAt: NOW + 9000 } })} selfPlayerName="Me" isSpectator={false} onVote={() => {}} />
        );
        expect(screen.getByText('No change. Not everyone agreed.')).toBeInTheDocument();
    });

    test('as a round is dealt under a drain it says what everyone gave up — once, and not on a reconnect', () => {
        const last = { afterRound: 3, percent: 7.5, drops: { Me: 12, Brandi: 8 } };
        const { rerender, unmount } = render(
            <PointDrainVote currentTableState={makeState({ pointDrain: drain({ percent: 7.5 }) })} selfPlayerName="Me" isSpectator={false} onVote={() => {}} />
        );
        rerender(
            <PointDrainVote currentTableState={makeState({ pointDrain: drain({ percent: 7.5, last }) })} selfPlayerName="Me" isSpectator={false} onVote={() => {}} />
        );
        expect(screen.getByText('Speed-up · scores drop 7.5%')).toBeInTheDocument();
        expect(screen.getByText('−12')).toBeInTheDocument();
        expect(screen.getByText(/You/)).toBeInTheDocument();
        act(() => { vi.advanceTimersByTime(6000); });
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        unmount();

        // A client that joins or reconnects mid-round already sees the scores.
        render(
            <PointDrainVote currentTableState={makeState({ pointDrain: drain({ percent: 7.5, last }) })} selfPlayerName="Me" isSpectator={false} onVote={() => {}} />
        );
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
});

describe('PointDrainSheet', () => {
    test('offers the server\'s choices with the recommended one picked, and proposes it', () => {
        const onPropose = vi.fn();
        render(<PointDrainSheet show pointDrain={drain()} onPropose={onPropose} onClose={() => {}} />);
        const radios = screen.getAllByRole('radio');
        expect(radios.map(r => r.textContent)).toEqual([
            '5% a roundGentle', '7.5% a round', '10% a roundRecommended', '15% a roundFast', '20% a roundFastest',
        ]);
        expect(screen.getByRole('radio', { name: /10% a round/ })).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByText(/Everyone at the table has to agree/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('radio', { name: /7\.5% a round/ }));
        fireEvent.click(screen.getByRole('button', { name: 'ASK THE TABLE' }));
        expect(onPropose).toHaveBeenCalledWith(7.5);
    });

    test('under a running drain the current rate is marked and the table can be asked to stop', () => {
        const onPropose = vi.fn();
        render(<PointDrainSheet show pointDrain={drain({ percent: 10 })} onPropose={onPropose} onClose={() => {}} />);
        expect(screen.getByText(/playing at 10% now/)).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: /10% a round/ })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'ASK THE TABLE' })).toBeDisabled();
        fireEvent.click(screen.getByRole('radio', { name: /Stop dropping scores/ }));
        fireEvent.click(screen.getByRole('button', { name: 'ASK THE TABLE' }));
        expect(onPropose).toHaveBeenCalledWith(0);
    });

    test('closes on Cancel, on the backdrop and on Escape; renders nothing when hidden', () => {
        const onClose = vi.fn();
        const { rerender, container } = render(<PointDrainSheet show pointDrain={drain()} onPropose={() => {}} onClose={onClose} />);
        fireEvent.click(screen.getByRole('button', { name: 'CANCEL' }));
        fireEvent.keyDown(window, { key: 'Escape' });
        fireEvent.click(container.querySelector('.point-drain-sheet-overlay'));
        expect(onClose).toHaveBeenCalledTimes(3);
        rerender(<PointDrainSheet show={false} pointDrain={drain()} onPropose={() => {}} onClose={onClose} />);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
});
