import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import TournamentView from './TournamentView';
import TournamentPopup from './TournamentPopup';
import TournamentLobbySlot from './TournamentLobbySlot';
import TournamentStandingsSheet from './TournamentStandingsSheet';
import { validateSettings } from './TournamentCreateSheet';
import { describeViewer, rankEntries, tournamentFaces, ordinal } from './tournamentFormat';
import { vi } from 'vitest';

const entry = (userId, username, extra = {}) => ({
    userId, username, status: 'registered', stack: 120, sitOuts: 0, place: null, prizeTokens: 0, bustedRound: null, ...extra,
});

const registering = () => ({
    id: 1,
    name: "Matt's Tournament",
    venue: 'tournament-stage',
    buyInTokens: 1,
    startingStack: 120,
    maxSeats: 9,
    startRule: 'creator',
    startsAt: null,
    status: 'registering',
    round: 0,
    creatorUserId: 11,
    creatorName: 'Matt',
    seatsTaken: 2,
    playersLeft: 2,
    entries: [entry(11, 'Matt'), entry(12, 'Bob')],
    tables: [],
    closeReason: null,
});

const running = () => ({
    ...registering(),
    status: 'running',
    round: 3,
    seatsTaken: 6,
    playersLeft: 5,
    entries: [
        entry(11, 'Matt', { status: 'playing', stack: 210 }),
        entry(12, 'Bob', { status: 'playing', stack: 140 }),
        entry(13, 'Cara', { status: 'playing', stack: 95 }),
        entry(14, 'Dee', { status: 'playing', stack: 60 }),
        entry(15, 'Eli', { status: 'playing', stack: 40 }),
        entry(16, 'Flo', { status: 'busted', stack: -12, bustedRound: 2 }),
    ],
    tables: [
        { tableId: 'tn-1-r3-t1', tableIndex: 0, playerMode: 3, seats: ['Matt', 'Bob', 'Cara'], dealer: 'Cara', sitOuts: [], finished: false, phase: 'playing', trick: 0, tricksTotal: 11 },
        { tableId: 'tn-1-r3-t2', tableIndex: 1, playerMode: 3, seats: ['Dee', 'Eli'], dealer: 'Dee', sitOuts: [], finished: false, phase: 'playing', trick: 6, tricksTotal: 11 },
    ],
});

test('a non-entrant sees the facts and a Join button while registration is open', () => {
    const onJoin = vi.fn();
    render(<TournamentView tournament={registering()} user={{ id: 99, username: 'Zed' }} onJoin={onJoin} onBack={() => {}} />);
    expect(screen.getByRole('heading', { name: "Matt's Tournament" })).toBeInTheDocument();
    expect(screen.getByText('2 of 9')).toBeInTheDocument();
    expect(screen.getByText('Starts when Matt says go')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Join · 1 tokens' }));
    expect(onJoin).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Find player' })).not.toBeInTheDocument();
    expect(screen.queryByText(/bot|house player/i)).not.toBeInTheDocument();
});

test('the creator gets Find player, Start now (three or more) and a confirmed Cancel', () => {
    const onFindPlayer = vi.fn();
    const onStart = vi.fn();
    const onCancel = vi.fn();
    const { rerender } = render(<TournamentView tournament={registering()} user={{ id: 11, username: 'Matt' }} onFindPlayer={onFindPlayer} onStart={onStart} onCancel={onCancel} onLeave={() => {}} onBack={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Find player' }));
    expect(onFindPlayer).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Start now' })).toBeDisabled();
    const three = registering();
    three.seatsTaken = 3;
    three.entries.push(entry(13, 'Cara'));
    rerender(<TournamentView tournament={three} user={{ id: 11, username: 'Matt' }} onFindPlayer={onFindPlayer} onStart={onStart} onCancel={onCancel} onLeave={() => {}} onBack={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start now' }));
    expect(onStart).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel it' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
});

test('while running, a player sees their table, the standings and a confirmed Quit', () => {
    const onQuit = vi.fn();
    render(<TournamentView tournament={running()} user={{ id: 12, username: 'Bob' }} onQuit={onQuit} onBack={() => {}} onWatch={() => {}} />);
    expect(screen.getByText(/You are at/)).toHaveTextContent('Table 1 with Matt and Cara');
    expect(screen.getByText(/2nd of 5 left/)).toBeInTheDocument();
    const rows = screen.getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Matt');
    expect(rows[6]).toHaveTextContent('Flo');
    expect(rows[6]).toHaveTextContent('Out · round 2');
    expect(screen.queryByRole('button', { name: 'Watch' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Quit tournament' }));
    expect(onQuit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Quit' }));
    expect(onQuit).toHaveBeenCalledTimes(1);
});

test('the host can switch fast play on and off once only house players are left', () => {
    const onFastPlay = vi.fn();
    const botsOnly = () => ({
        ...running(),
        botsOnly: true,
        fastPlay: false,
        playersLeft: 4,
        entries: [
            entry(11, 'Matt', { status: 'busted', stack: -5, bustedRound: 3 }),
            entry(12, 'Bob', { status: 'playing', stack: 140 }),
            entry(13, 'Cara', { status: 'playing', stack: 95 }),
            entry(14, 'Dee', { status: 'playing', stack: 60 }),
            entry(15, 'Eli', { status: 'playing', stack: 40 }),
        ],
    });
    const { rerender } = render(<TournamentView tournament={botsOnly()} user={{ id: 11, username: 'Matt' }} onFastPlay={onFastPlay} onBack={() => {}} onWatch={() => {}} />);
    expect(screen.getByText('Only house players are left')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Fast play' }));
    expect(onFastPlay).toHaveBeenCalledWith(true);
    rerender(<TournamentView tournament={{ ...botsOnly(), fastPlay: true }} user={{ id: 11, username: 'Matt' }} onFastPlay={onFastPlay} onBack={() => {}} onWatch={() => {}} />);
    expect(screen.getByText(/Fast play is on/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Normal speed' }));
    expect(onFastPlay).toHaveBeenCalledWith(false);
    // Not the host: no switch. A human still in: no switch either.
    rerender(<TournamentView tournament={botsOnly()} user={{ id: 12, username: 'Bob' }} onFastPlay={onFastPlay} onBack={() => {}} onWatch={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Fast play' })).not.toBeInTheDocument();
    rerender(<TournamentView tournament={{ ...botsOnly(), botsOnly: false }} user={{ id: 11, username: 'Matt' }} onFastPlay={onFastPlay} onBack={() => {}} onWatch={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Fast play' })).not.toBeInTheDocument();
});

test('a busted player can watch a live table', () => {
    const onWatch = vi.fn();
    render(<TournamentView tournament={running()} user={{ id: 16, username: 'Flo' }} onWatch={onWatch} onBack={() => {}} />);
    expect(screen.getByText(/You went out in round 2/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Watch' })[0]);
    expect(onWatch).toHaveBeenCalledWith('tn-1-r3-t1');
});

test('a finished tournament shows the podium with prizes', () => {
    const done = running();
    done.status = 'complete';
    done.round = 7;
    done.entries = [
        entry(11, 'Matt', { status: 'finished', stack: 300, place: 1, prizeTokens: 3 }),
        entry(12, 'Bob', { status: 'finished', stack: 80, place: 2, prizeTokens: 1.8 }),
        entry(13, 'Cara', { status: 'finished', stack: -20, place: 3, prizeTokens: 1.2, bustedRound: 7 }),
        entry(14, 'Dee', { status: 'finished', stack: -5, place: 4, bustedRound: 5 }),
    ];
    render(<TournamentView tournament={done} user={{ id: 14, username: 'Dee' }} onBack={() => {}} />);
    expect(screen.getByText('1st')).toBeInTheDocument();
    expect(screen.getAllByText('Matt').length).toBeGreaterThan(0);
    expect(screen.getAllByText('3 tokens').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1.8 tokens').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Final standings · 7 rounds' })).toBeInTheDocument();
});

test('the popup offers Join and Not now', () => {
    const onJoin = vi.fn();
    const onDismiss = vi.fn();
    render(<TournamentPopup tournament={registering()} onJoin={onJoin} onDismiss={onDismiss} />);
    expect(screen.getByRole('dialog', { name: "Matt's Tournament" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Join · 1 tokens' }));
    expect(onJoin).toHaveBeenCalledTimes(1);
});

test('the lobby slot is Create for a VIP, a ribbon when something is open, nothing otherwise', () => {
    const onCreate = vi.fn();
    const onOpen = vi.fn();
    const { rerender } = render(<TournamentLobbySlot user={{ id: 11, is_vip: true }} tournamentLobby={{ open: null, running: [] }} myTournament={null} onOpen={onOpen} onCreate={onCreate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create a tournament' }));
    expect(onCreate).toHaveBeenCalledTimes(1);
    rerender(<TournamentLobbySlot user={{ id: 99, is_vip: false }} tournamentLobby={{ open: null, running: [] }} myTournament={null} onOpen={onOpen} onCreate={onCreate} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    rerender(<TournamentLobbySlot user={{ id: 99, is_vip: false }} tournamentLobby={{ open: registering(), running: [] }} myTournament={null} onOpen={onOpen} onCreate={onCreate} />);
    expect(screen.getByText('Tournament open · 2 of 9 seats')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    rerender(<TournamentLobbySlot user={{ id: 12, is_vip: false }} tournamentLobby={{ open: null, running: [running()] }} myTournament={running()} onOpen={onOpen} onCreate={onCreate} />);
    expect(screen.getByText('Round 3 · 5 left')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Board' })).toBeInTheDocument();
});

test('creator settings are validated the way the server validates them', () => {
    const base = { buyInTokens: '1', startingStack: 120, maxSeats: '9', startRule: 'creator', startsAt: '', drainPercent: 10 };
    expect(validateSettings({ ...base, drainPercent: 7 })).toMatch(/chip drain/i);
    expect(validateSettings(base)).toBe('');
    expect(validateSettings({ ...base, buyInTokens: '51' })).toMatch(/between 0 and 50/);
    expect(validateSettings({ ...base, startingStack: 100 })).toMatch(/starting stack/);
    expect(validateSettings({ ...base, maxSeats: '16' })).toMatch(/between 3 and 15/);
    expect(validateSettings({ ...base, startRule: 'at_time', startsAt: new Date(Date.now() + 60_000).toISOString() })).toMatch(/at least 10 minutes/);
    expect(validateSettings({ ...base, startRule: 'at_time', startsAt: new Date(Date.now() + 20 * 60_000).toISOString() })).toBe('');
});

test('standings rank the playing by stack, then the busted by the round they went out', () => {
    const ranked = rankEntries(running().entries);
    expect(ranked.map(e => `${e.rank}:${e.username}`)).toEqual(['1:Matt', '2:Bob', '3:Cara', '4:Dee', '5:Eli', '6:Flo']);
    const view = describeViewer(running(), 15);
    expect(view.me.username).toBe('Eli');
    expect(view.myTable.tableIndex).toBe(1);
    expect(view.isCreator).toBe(false);
    const faces = tournamentFaces(running(), 15);
    expect(faces.map(f => f.key)).toEqual(['round', 'leaders', 'you', 'out', 'tables']);
    expect(faces[4].title).toBe('T1 trick 1 of 11');
    expect(faces[0].sub).toBe('Round 3 · 5 of 6 left');
    expect(faces[2].title).toBe('You 5th · 40');
    expect(faces[3].title).toBe('Flo out in round 2');
    expect(ordinal(22)).toBe('22nd');
    expect(ordinal(13)).toBe('13th');
});


test('a finished table waits on the others with their trick counts', () => {
    const state = running();
    state.tables[0].finished = true;
    state.tables[0].phase = 'done';
    const onWatch = vi.fn();
    render(<TournamentView tournament={state} user={{ id: 12, username: 'Bob' }} onBack={() => {}} onQuit={() => {}} onWatch={onWatch} />);
    expect(screen.getByRole('heading', { name: /waiting on one table/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Watch' }));
    expect(onWatch).toHaveBeenCalledWith('tn-1-r3-t2');
    expect(screen.getAllByText(/Trick 7 of 11/).length).toBeGreaterThan(0);
});

test('between rounds the board shows the chip drain everyone just took and counts down', () => {
    const state = running();
    state.tables = [];
    state.drainPercent = 10;
    state.lastDrain = { round: 3, percent: 10, drops: { Matt: 21, Bob: 14, Cara: 10, Dee: 6, Eli: 4 } };
    state.nextRoundInSeconds = 8;
    render(<TournamentView tournament={state} user={{ id: 12, username: 'Bob' }} onBack={() => {}} onQuit={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Next round in 8 s' })).toBeInTheDocument();
    expect(screen.getByText(/everyone drops 10%/i)).toBeInTheDocument();
    expect(screen.getByText('−14')).toBeInTheDocument();
});


test('the Share link button copies a link that opens the tournament', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<TournamentView tournament={registering()} user={{ id: 99, username: 'Zed' }} onJoin={() => {}} onBack={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Share link to this tournament' }));
    expect(await screen.findByText(/Link copied/)).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/tournament/1`);
    delete navigator.clipboard;
});

test('the header cube sheet offers Watch on the open tables and the way back', () => {
    const state = running();
    state.tables[0].finished = true;
    state.tables[0].phase = 'done';
    const onWatch = vi.fn();
    const onStopWatching = vi.fn();
    const onClose = vi.fn();
    const { rerender } = render(
        <TournamentStandingsSheet tournament={state} viewerUserId={12} onClose={onClose} onWatch={onWatch} onStopWatching={onStopWatching} />,
    );
    // Bob's table (T1) is done, so T2 is watchable; his own table is not.
    const watchButtons = screen.getAllByRole('button', { name: 'Watch' });
    expect(watchButtons).toHaveLength(1);
    fireEvent.click(watchButtons[0]);
    expect(onWatch).toHaveBeenCalledWith('tn-1-r3-t2');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Back to my table' })).not.toBeInTheDocument();

    rerender(
        <TournamentStandingsSheet tournament={state} viewerUserId={12} onClose={onClose} onWatch={onWatch} onStopWatching={onStopWatching} watchingTableId="tn-1-r3-t2" />,
    );
    expect(screen.queryByRole('button', { name: 'Watch' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to my table' }));
    expect(onStopWatching).toHaveBeenCalledTimes(1);
    const faces = tournamentFaces(state, 12, { watchingTableId: 'tn-1-r3-t2' });
    expect(faces.find(face => face.key === 'watching').title).toBe('Watching Table 2 · trick 7 of 11');
});

test('a player still mid-round at their own table is not offered Watch', () => {
    render(<TournamentStandingsSheet tournament={running()} viewerUserId={12} onClose={() => {}} onWatch={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Watch' })).not.toBeInTheDocument();
});
