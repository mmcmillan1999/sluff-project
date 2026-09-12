import React from 'react';
import { render, screen } from '@testing-library/react';
import FeltMark, { feltMarkFor, FINAL_TABLE_PLAYERS } from './FeltMark';

const tableTournament = { tournamentId: 31, name: "Mcsaddle's Tournament", roundNumber: 9, tableIndex: 0 };

describe('FeltMark', () => {
    test('an ordinary table carries the SLUFF mark alone', () => {
        const { container } = render(<FeltMark mark={null} />);
        expect(container.querySelector('.sluff-watermark')).toBeTruthy();
        expect(container.querySelector('.felt-mark-event')).toBeNull();
        expect(container.querySelector('.felt-mark-final')).toBeNull();
    });

    test('a tournament table wears the event name over the mark', () => {
        const mark = feltMarkFor({ tableTournament, tournament: { id: 31, playersLeft: 11 } });
        expect(mark).toEqual({ name: "Mcsaddle's Tournament", finalTable: false });
        const { container } = render(<FeltMark mark={mark} />);
        expect(screen.getByText("Mcsaddle's Tournament")).toBeTruthy();
        expect(container.querySelector('.felt-mark-final')).toBeNull();
        expect(container.querySelector('.felt-mark.is-final')).toBeNull();
    });

    test(`five or fewer players left is the final table`, () => {
        const mark = feltMarkFor({ tableTournament, tournament: { id: 31, playersLeft: FINAL_TABLE_PLAYERS } });
        expect(mark.finalTable).toBe(true);
        const { container } = render(<FeltMark mark={mark} />);
        expect(screen.getByText('Final Table')).toBeTruthy();
        expect(container.querySelector('.felt-mark.is-final')).toBeTruthy();
        expect(feltMarkFor({ tableTournament, tournament: { id: 31, playersLeft: 6 } }).finalTable).toBe(false);
        expect(feltMarkFor({ tableTournament, tournament: { id: 31, playersLeft: 0 } }).finalTable).toBe(false);
    });

    test('another event’s count, or no event, never marks a final table', () => {
        expect(feltMarkFor({ tableTournament, tournament: { id: 30, playersLeft: 3 } }).finalTable).toBe(false);
        expect(feltMarkFor({ tableTournament, tournament: null }).finalTable).toBe(false);
        expect(feltMarkFor({ tableTournament: null, tournament: { id: 31, playersLeft: 3 } })).toBeNull();
    });
});
