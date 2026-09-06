// The one slot under the wheel, beside Private Tables. It is the Create
// button when nothing is open, the way back to an open registration once
// the popup has been dismissed, or a pointer at a tournament in progress.
import React from 'react';
import { formatTokens, startLabel } from './tournamentFormat';
import './tournament.css';

const TournamentLobbySlot = ({ user, tournamentLobby, myTournament, onOpen, onCreate }) => {
    const open = tournamentLobby?.open || null;
    const running = tournamentLobby?.running || [];
    const entered = Boolean(myTournament) && (
        myTournament.creatorUserId === user?.id
        || (myTournament.entries || []).some(entry => entry.userId === user?.id)
    );
    const mineIsLive = entered && ['registering', 'running'].includes(myTournament.status);

    if (mineIsLive) {
        const registering = myTournament.status === 'registering';
        return (
            <div className="tournament-slot">
                <div className="tournament-ribbon">
                    <div className="tournament-ribbon-text">
                        <span className="tournament-ribbon-title">{myTournament.name}</span>
                        <span className="tournament-ribbon-sub">
                            {registering
                                ? `You're in · ${myTournament.seatsTaken} of ${myTournament.maxSeats} seats · ${startLabel(myTournament)}`
                                : `Round ${myTournament.round} · ${myTournament.playersLeft} left`}
                        </span>
                    </div>
                    <button type="button" className="tournament-btn" onClick={onOpen}>{registering ? 'View' : 'Board'}</button>
                </div>
            </div>
        );
    }

    if (open) {
        return (
            <div className="tournament-slot">
                <div className="tournament-ribbon">
                    <div className="tournament-ribbon-text">
                        <span className="tournament-ribbon-title">Tournament open · {open.seatsTaken} of {open.maxSeats} seats</span>
                        <span className="tournament-ribbon-sub">{open.name} · {formatTokens(open.buyInTokens)} tokens · {startLabel(open)}</span>
                    </div>
                    <button type="button" className="tournament-btn" onClick={onOpen}>View</button>
                </div>
            </div>
        );
    }

    if (running.length > 0) {
        const live = running[0];
        return (
            <div className="tournament-slot">
                <div className="tournament-ribbon">
                    <div className="tournament-ribbon-text">
                        <span className="tournament-ribbon-title">Tournament in progress</span>
                        <span className="tournament-ribbon-sub">{live.name} · round {live.round} · {live.playersLeft} left</span>
                    </div>
                    <button type="button" className="tournament-btn secondary" onClick={onOpen}>Watch</button>
                </div>
            </div>
        );
    }

    if (user?.is_vip) {
        return (
            <div className="tournament-slot">
                <button type="button" className="tournament-btn create" onClick={onCreate}>Create a tournament</button>
            </div>
        );
    }

    return null;
};

export default TournamentLobbySlot;
