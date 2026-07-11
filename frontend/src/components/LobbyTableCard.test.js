import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LobbyTableCard from './LobbyTableCard';

const IN_PROGRESS_STATES = [
    'Bidding Phase',
    'Trump Selection',
    'Frog Widow Exchange',
    'Dealing Pending'
];

const tableForState = (state) => ({
    tableId: 'table-7',
    tableName: 'Rules Table',
    state,
    playerCount: 1,
    players: [{ userId: 42, playerName: 'Seated Player' }]
});

describe.each(IN_PROGRESS_STATES)('LobbyTableCard in %s', (state) => {
    test('offers Return to Game to the seated user', async () => {
        const user = userEvent.setup();
        const onJoin = vi.fn();
        render(
            <LobbyTableCard
                table={tableForState(state)}
                canAfford
                buyIn={1}
                onJoin={onJoin}
                user={{ id: 42, is_admin: false }}
            />
        );

        expect(screen.getByText('Playing')).toBeInTheDocument();
        const returnButton = screen.getByRole('button', { name: 'Return to Game' });
        expect(returnButton).toBeEnabled();
        await user.click(returnButton);
        expect(onJoin).toHaveBeenCalledWith('table-7');
    });

    test('does not offer an enabled Join to an outsider', () => {
        render(
            <LobbyTableCard
                table={tableForState(state)}
                canAfford
                buyIn={1}
                onJoin={vi.fn()}
                user={{ id: 99, is_admin: false }}
            />
        );

        expect(screen.queryByRole('button', { name: 'Return to Game' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Join' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Join' })).toHaveAttribute('title', 'This game is already in progress.');
    });
});
