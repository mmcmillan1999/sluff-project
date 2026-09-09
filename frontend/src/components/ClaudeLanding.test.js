import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import { vi } from 'vitest';
import ClaudeLanding from './ClaudeLanding';

const preview = vi.hoisted(() => ({ value: null }));
vi.mock('../services/api.js', () => ({
    trackEvent: vi.fn(),
    getTournamentPreview: vi.fn(() => Promise.resolve(preview.value)),
}));
vi.mock('../utils/LandingCardPhysics.js', () => ({ default: class { register() {} destroy() {} } }));

beforeEach(() => {
    preview.value = null;
    window.matchMedia = window.matchMedia || (() => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
});

test('SLUFF is the headline and the tagline is a footnote', () => {
    render(<ClaudeLanding onRegister={() => {}} onLogin={() => {}} />);
    const title = screen.getByRole('heading', { level: 1 });
    expect(within(title).getByRole('img', { name: 'Sluff' })).toBeInTheDocument();
    expect(screen.getByText(/Pick your card\./)).toHaveClass('cl-tagline-footnote');
    expect(screen.getAllByRole('button', { name: 'Play free now' }).length).toBeGreaterThan(0);
});

test('a tournament link names the event it points at', async () => {
    preview.value = {
        id: 17, name: 'Labor Day', status: 'registering', buyInTokens: '1.00', startingStack: 120,
        maxSeats: 15, seatsTaken: 9, startRule: 'creator', creatorName: 'Matt', round: 0, playersLeft: 0,
    };
    render(<ClaudeLanding inviteTournamentId={17} onRegister={() => {}} onLogin={() => {}} />);
    expect(screen.getByText('You’re invited')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Labor Day' })).toBeInTheDocument());
    expect(screen.getByText(/Matt is hosting · 1 token buy-in · 120 chips · 9 of 15 seats taken/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Join Labor Day' }).length).toBeGreaterThan(0);
});

test('a tournament link whose event is gone still invites', async () => {
    render(<ClaudeLanding inviteTournamentId={99} onRegister={() => {}} onLogin={() => {}} />);
    expect(screen.getByRole('heading', { name: 'A Sluff tournament' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Join your friend’s tournament' }).length).toBeGreaterThan(0);
});

test('a table link offers the saved seat', () => {
    render(<ClaudeLanding inviteTableId="abc" onRegister={() => {}} onLogin={() => {}} />);
    expect(screen.getByRole('heading', { name: 'A seat at a Sluff table' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Join your friend’s table' }).length).toBeGreaterThan(0);
});
