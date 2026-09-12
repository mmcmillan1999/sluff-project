import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import TournamentWelcomeCard from './TournamentWelcomeCard';

const entry = (userId, username) => ({ userId, username, status: 'playing', stack: 120, sitOuts: 0, place: null, prizeTokens: 0, bustedRound: null });

const running = (welcome) => ({
    id: 31,
    name: "Mcsaddle's Tournament",
    status: 'running',
    round: 1,
    favorites: ['Doc Shuffle', 'Grandpa George'],
    entries: [entry(1, 'Mcsaddle'), entry(2, 'MrNoobCrusher'), entry(3, 'Zacattack'), entry(4, 'Doc Shuffle'), entry(5, 'Grandpa George'), { ...entry(6, 'Gone'), status: 'withdrawn' }],
    tables: [{ tableId: 'tn-31-r1-t1' }, { tableId: 'tn-31-r1-t2' }],
    welcome,
});

describe('TournamentWelcomeCard', () => {
    test('shows the event, the field, the favorites and the countdown, and starts the welcome once', () => {
        const playWelcome = vi.fn();
        const fetchLine = vi.fn().mockResolvedValue(null);
        render(<TournamentWelcomeCard tournament={running({ dealInSeconds: 18, audio: false })} tableState="Dealing Pending" playWelcome={playWelcome} fetchLine={fetchLine} />);
        expect(screen.getByText('Tournament #31')).toBeTruthy();
        expect(screen.getByText("Mcsaddle's Tournament")).toBeTruthy();
        expect(screen.getByText('5 players · 2 tables')).toBeTruthy();
        expect(screen.getByText("Tonight's favorites")).toBeTruthy();
        expect(screen.getByText('★ Doc Shuffle')).toBeTruthy();
        expect(screen.getByText('★ Grandpa George')).toBeTruthy();
        expect(screen.getByText('Cards fly in 18 s')).toBeTruthy();
        expect(playWelcome).toHaveBeenCalledTimes(1);
        expect(playWelcome.mock.calls[0][0]).toBe(31);
        playWelcome.mock.calls[0][1]();
        expect(fetchLine).toHaveBeenCalledWith(31);
    });

    test('asks the hook again when the line becomes ready, and leaves the felt once the cards are dealt', () => {
        const playWelcome = vi.fn();
        const fetchLine = vi.fn().mockResolvedValue(null);
        const { rerender, container } = render(
            <TournamentWelcomeCard tournament={running({ dealInSeconds: 18, audio: false })} tableState="Dealing Pending" playWelcome={playWelcome} fetchLine={fetchLine} />,
        );
        expect(playWelcome).toHaveBeenCalledTimes(1);
        rerender(<TournamentWelcomeCard tournament={running({ dealInSeconds: 13, audio: true })} tableState="Dealing Pending" playWelcome={playWelcome} fetchLine={fetchLine} />);
        expect(playWelcome).toHaveBeenCalledTimes(2);
        rerender(<TournamentWelcomeCard tournament={running({ dealInSeconds: 0, audio: true })} tableState="Bidding Phase" playWelcome={playWelcome} fetchLine={fetchLine} />);
        expect(container.querySelector('.tournament-welcome-card')).toBeNull();
        rerender(<TournamentWelcomeCard tournament={running(null)} tableState="Dealing Pending" playWelcome={playWelcome} fetchLine={fetchLine} />);
        expect(container.querySelector('.tournament-welcome-card')).toBeNull();
        expect(playWelcome).toHaveBeenCalledTimes(2);
    });

    test('renders nothing without a tournament and never calls the hook', () => {
        const playWelcome = vi.fn();
        const { container } = render(<TournamentWelcomeCard tournament={null} tableState="Dealing Pending" playWelcome={playWelcome} />);
        expect(container.firstChild).toBeNull();
        expect(playWelcome).not.toHaveBeenCalled();
    });

    test('steps aside for the ring card in the last seconds of the hold', () => {
        const { container } = render(<TournamentWelcomeCard tournament={running({ dealInSeconds: 3, audio: true })} tableState="Dealing Pending" />);
        expect(container.querySelector('.tournament-welcome-card')).toBeNull();
    });

    test('a field with no favorites gets no favorites line', () => {
        render(<TournamentWelcomeCard tournament={{ ...running({ dealInSeconds: 9, audio: false }), favorites: [] }} tableState="Dealing Pending" />);
        expect(screen.queryByText(/Tonight's favorite/)).toBeNull();
        expect(screen.getByText('Cards fly in 9 s')).toBeTruthy();
    });
});
