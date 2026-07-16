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

test('retains theme identity without rendering venue copy in a private table card', () => {
    const { container } = render(
        <LobbyTableCard
            table={tableForState('Waiting for Players')}
            themeId="dans-deck"
            canAfford
            buyIn={20}
            onJoin={vi.fn()}
            user={{ id: 99, is_admin: false }}
        />
    );

    expect(container.firstChild).toHaveAttribute('data-theme', 'dans-deck');
    expect(screen.getByRole('heading', { name: 'Rules Table' })).toBeInTheDocument();
    expect(screen.queryByText('Above the Great Salt Lake')).not.toBeInTheDocument();
    expect(container.querySelector('.table-card-venue')).not.toBeInTheDocument();
});

test('normalizes an unknown private-table theme to the safe classic identity', () => {
    const { container } = render(
        <LobbyTableCard
            table={tableForState('Waiting for Players')}
            themeId="unknown-theme"
            canAfford
            buyIn={1}
            onJoin={vi.fn()}
            user={{ id: 99, is_admin: false }}
        />
    );

    expect(container.firstChild).toHaveAttribute('data-theme', 'classic');
    expect(container.querySelector('.table-card-venue')).not.toBeInTheDocument();
});

describe.each(IN_PROGRESS_STATES)('LobbyTableCard in %s', (state) => {
    test('offers Return to Game to the seated user', async () => {
        const user = userEvent.setup();
        const onJoin = vi.fn();
        render(
            <LobbyTableCard
                table={tableForState(state)}
                themeId="fort-creek"
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
                themeId="fort-creek"
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
