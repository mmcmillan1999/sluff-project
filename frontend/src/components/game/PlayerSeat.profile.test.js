import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PlayerSeat from './PlayerSeat';

const tableState = {
    players: {
        7: {
            userId: 7,
            playerName: 'River Ace',
            tokens: '9.00',
            disconnected: false,
        },
    },
    scores: { 'River Ace': 120 },
    bidWinnerInfo: null,
    playerOrderActive: ['River Ace'],
    trickTurnPlayerName: null,
    forfeiture: null,
    dealer: null,
    trumpSuit: null,
    trumpBroken: false,
    playerMode: 3,
    gameStarted: false,
};

test('opens a profile from a seat name without bubbling into table gestures', async () => {
    const user = userEvent.setup();
    const onPlayerProfile = vi.fn();
    const onTableClick = vi.fn();

    render(
        <div onClick={onTableClick}>
            <PlayerSeat
                playerName="River Ace"
                currentTableState={tableState}
                isSelf={false}
                emitEvent={vi.fn()}
                renderCard={vi.fn()}
                seatPosition="left"
                onPlayerProfile={onPlayerProfile}
            />
        </div>,
    );

    await user.click(screen.getByRole('button', { name: "View River Ace's player profile" }));

    expect(onPlayerProfile).toHaveBeenCalledWith('River Ace');
    expect(onTableClick).not.toHaveBeenCalled();
});
