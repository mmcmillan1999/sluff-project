import React from 'react';
import { render, screen } from '@testing-library/react';
import LobbyTableCard from './LobbyTableCard';

const user = { id: 1, username: 'You', is_admin: false };
const card = (players) => (
    <LobbyTableCard
        table={{ tableId: 't1', tableName: 'Fort Creek 1', playerMode: 4, state: 'Waiting for Players', players }}
        themeId="fort-creek"
        canAfford
        buyIn={1}
        onJoin={() => {}}
        user={user}
    />
);

describe('LobbyTableCard seats', () => {
    test('a table holding only a spectator still shows Open Seats', () => {
        render(card([{ userId: 9, playerName: 'Watcher', isSpectator: true }]));
        expect(screen.getByText('Open Seats')).toBeTruthy();
        expect(screen.queryByText('Watcher')).toBeNull();
    });

    test('seated players are listed without the spectators', () => {
        render(card([{ userId: 2, playerName: 'Mcsaddle' }, { userId: 9, playerName: 'Watcher', isSpectator: true }]));
        expect(screen.getByText('Mcsaddle')).toBeTruthy();
        expect(screen.queryByText('Open Seats')).toBeNull();
    });
});
