import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import TournamentStandingsSheet from './TournamentStandingsSheet';

const tournament = {
    id: 31,
    name: "Mcsaddle's Tournament",
    status: 'running',
    round: 4,
    playersLeft: 5,
    creatorUserId: 1,
    entries: [
        { userId: 1, username: 'Mcsaddle', status: 'playing', stack: 140, sitOuts: 0, place: null, prizeTokens: 0, bustedRound: null },
        { userId: 2, username: 'MrNoobCrusher', status: 'playing', stack: 100, sitOuts: 0, place: null, prizeTokens: 0, bustedRound: null },
    ],
    tables: [{ tableId: 'tn-31-r4-t1', tableIndex: 0, playerMode: 3, seats: ['Mcsaddle', 'MrNoobCrusher'], sitOuts: [], finished: false, phase: 'playing', trick: 3, tricksTotal: 11 }],
};

describe('TournamentStandingsSheet', () => {
    test('is a modal dialog that closes on Escape', () => {
        const onClose = vi.fn();
        render(<TournamentStandingsSheet tournament={tournament} viewerUserId={2} onClose={onClose} />);
        const dialog = document.querySelector('.tournament-sheet');
        expect(dialog.getAttribute('role')).toBe('dialog');
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
