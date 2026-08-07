// The bid emote bubble: during the auction each seat says what it just did
// — "Pass" in words for a pass, the bid's emoji for the high bidder, a think for the
// seat on turn — and vanishes the moment bidding resolves.
import React from 'react';
import { render, screen } from '@testing-library/react';
import PlayerSeat from './PlayerSeat';

const baseState = {
    players: {
        7: { userId: 7, playerName: 'River Ace', disconnected: false },
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
    gameStarted: true,
    state: 'Bidding Phase',
    playersWhoPassedThisRound: [],
    currentHighestBidDetails: null,
    biddingTurnPlayerName: null,
};

const renderSeat = (stateOverrides = {}) => render(
    <PlayerSeat
        playerName="River Ace"
        currentTableState={{ ...baseState, ...stateOverrides }}
        isSelf={false}
        emitEvent={vi.fn()}
        renderCard={vi.fn()}
        seatPosition="left"
    />,
);

test('the Frog bidder wears the frog logo (heart overhead — the hearts hint)', () => {
    renderSeat({ currentHighestBidDetails: { playerName: 'River Ace', bid: 'Frog' } });
    const bubble = screen.getByRole('img', { name: 'River Ace bid Frog' });
    expect(bubble.querySelector('img')).toHaveAttribute('src', '/assets/trump-pucks/FrogTrumpPuck.png');
});

test('the Solo bidder wears the three choosable trump suits', () => {
    renderSeat({ currentHighestBidDetails: { playerName: 'River Ace', bid: 'Solo' } });
    const bubble = screen.getByRole('img', { name: 'River Ace bid Solo' });
    expect(bubble).toHaveTextContent('♦♠♣');
});

test('the Heart Solo bidder wears three hearts', () => {
    renderSeat({ currentHighestBidDetails: { playerName: 'River Ace', bid: 'Heart Solo' } });
    const bubble = screen.getByRole('img', { name: 'River Ace bid Heart Solo' });
    expect(bubble).toHaveTextContent('♥♥♥');
});

test('a passed player snoozes even when it is not their turn', () => {
    renderSeat({
        playersWhoPassedThisRound: ['River Ace'],
        biddingTurnPlayerName: 'Someone Else',
    });
    expect(screen.getByRole('img', { name: 'River Ace passed' })).toHaveTextContent(/pass/i);
});

test('the seat on turn thinks', () => {
    renderSeat({ biddingTurnPlayerName: 'River Ace' });
    expect(screen.getByRole('img', { name: 'River Ace is deciding' })).toHaveTextContent('🤔');
});

test('the Frog bidder mulling an upgrade thinks while the Solo holder wears their bid', () => {
    renderSeat({
        state: 'Awaiting Frog Upgrade Decision',
        currentHighestBidDetails: { playerName: 'Someone Else', bid: 'Solo' },
        biddingTurnPlayerName: 'River Ace',
    });
    expect(screen.getByRole('img', { name: 'River Ace is deciding' })).toHaveTextContent('🤔');
});

test('no bubble outside the auction, even with bid details lingering', () => {
    renderSeat({
        state: 'Playing Phase',
        currentHighestBidDetails: { playerName: 'River Ace', bid: 'Heart Solo' },
    });
    expect(document.querySelector('.bid-emote-bubble')).toBeNull();
});
