import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { vi } from 'vitest';
import TournamentRoundCard, { RING_CARD_MS } from './TournamentRoundCard';

const table = (roundNumber) => ({ tournamentId: 31, name: "Mcsaddle's Tournament", roundNumber, tableIndex: 0 });

describe('TournamentRoundCard', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    test('walks on when a round opens, rings the bell once, and leaves when the deal is due', () => {
        const bell = vi.fn();
        const { rerender, container } = render(
            <TournamentRoundCard tableTournament={table(3)} tableState="Bidding Phase" playRoundBell={bell} />,
        );
        expect(container.querySelector('.ring-card')).toBeNull();
        expect(bell).not.toHaveBeenCalled();

        rerender(<TournamentRoundCard tableTournament={table(3)} tableState="Dealing Pending" playRoundBell={bell} />);
        expect(screen.getByLabelText('Round 3')).toBeTruthy();
        expect(screen.getByText('ROUND')).toBeTruthy();
        expect(screen.getByText('3')).toBeTruthy();
        expect(bell).toHaveBeenCalledTimes(1);

        act(() => { vi.advanceTimersByTime(RING_CARD_MS + 10); });
        expect(container.querySelector('.ring-card')).toBeNull();
    });

    test('an all-pass redeal of the same round gets no second card', () => {
        const bell = vi.fn();
        const { rerender, container } = render(
            <TournamentRoundCard tableTournament={table(4)} tableState="Dealing Pending" playRoundBell={bell} />,
        );
        act(() => { vi.advanceTimersByTime(RING_CARD_MS + 10); });
        rerender(<TournamentRoundCard tableTournament={table(4)} tableState="AllPassWidowReveal" playRoundBell={bell} />);
        rerender(<TournamentRoundCard tableTournament={table(4)} tableState="Dealing Pending" playRoundBell={bell} />);
        expect(container.querySelector('.ring-card')).toBeNull();
        expect(bell).toHaveBeenCalledTimes(1);

        rerender(<TournamentRoundCard tableTournament={table(5)} tableState="Dealing Pending" playRoundBell={bell} />);
        expect(screen.getByLabelText('Round 5')).toBeTruthy();
        expect(bell).toHaveBeenCalledTimes(2);
    });

    test('round one waits for the welcome and walks on three seconds before the first deal', () => {
        const bell = vi.fn();
        const { rerender, container } = render(
            <TournamentRoundCard tableTournament={table(1)} tableState="Dealing Pending" welcome={{ dealInSeconds: 12, audio: true }} playRoundBell={bell} />,
        );
        expect(container.querySelector('.ring-card')).toBeNull();
        expect(bell).not.toHaveBeenCalled();
        act(() => { vi.advanceTimersByTime(9_000); });
        expect(screen.getByLabelText('Round 1')).toBeTruthy();
        expect(bell).toHaveBeenCalledTimes(1);

        // A late arrival after the hold: no welcome, the card comes at once.
        const late = vi.fn();
        rerender(<TournamentRoundCard tableTournament={{ ...table(1), tournamentId: 32 }} tableState="Dealing Pending" welcome={null} playRoundBell={late} />);
        expect(late).toHaveBeenCalledTimes(1);
    });

    test('with a round call the card stays for the hold, Liam is fetched when ready, and the deal takes it away', () => {
        const bell = vi.fn();
        const call = vi.fn();
        const fetchLine = vi.fn().mockResolvedValue(null);
        const pending = { round: 7, playersLeft: 13, dealInSeconds: 8, audio: false };
        const { rerender, container } = render(
            <TournamentRoundCard tableTournament={table(7)} tableState="Dealing Pending" roundCall={pending} playRoundBell={bell} playRoundCall={call} fetchLine={fetchLine} />,
        );
        expect(screen.getByLabelText('Round 7')).toBeTruthy();
        expect(container.querySelector('.ring-card').style.animationDuration).toBe('8000ms');
        expect(call).toHaveBeenCalledTimes(1);
        expect(call.mock.calls[0][0]).toBe('31:7');
        call.mock.calls[0][1]();
        expect(fetchLine).toHaveBeenCalledWith(31);
        expect(bell).not.toHaveBeenCalled();

        act(() => { vi.advanceTimersByTime(RING_CARD_MS + 500); });
        expect(container.querySelector('.ring-card')).toBeTruthy();

        rerender(<TournamentRoundCard tableTournament={table(7)} tableState="Dealing Pending" roundCall={{ ...pending, dealInSeconds: 5, audio: true }} playRoundBell={bell} playRoundCall={call} fetchLine={fetchLine} />);
        expect(call).toHaveBeenCalledTimes(2);

        rerender(<TournamentRoundCard tableTournament={table(7)} tableState="Bidding Phase" roundCall={null} playRoundBell={bell} playRoundCall={call} fetchLine={fetchLine} />);
        expect(container.querySelector('.ring-card')).toBeNull();
    });

    test('a round call for another round is ignored', () => {
        const bell = vi.fn();
        const call = vi.fn();
        render(<TournamentRoundCard tableTournament={table(6)} tableState="Dealing Pending" roundCall={{ round: 5, playersLeft: 9, dealInSeconds: 8, audio: true }} playRoundBell={bell} playRoundCall={call} />);
        expect(bell).toHaveBeenCalledTimes(1);
        expect(call).not.toHaveBeenCalled();
    });

    test('a held card stays for previews', () => {
        const { container } = render(<TournamentRoundCard tableTournament={table(7)} tableState="Dealing Pending" hold />);
        act(() => { vi.advanceTimersByTime(RING_CARD_MS * 3); });
        expect(container.querySelector('.ring-card.is-held')).toBeTruthy();
    });
});
