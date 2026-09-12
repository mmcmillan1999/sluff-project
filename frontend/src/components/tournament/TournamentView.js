// The tournament screen: registration while it fills, the reseat board
// while it runs, the podium when it is over. One component, three states,
// so the player always lands on the same place from the ribbon, the popup
// and the table.
import React, { useEffect, useRef, useState } from 'react';
import { currentDrain, describeViewer, drainLabel, ordinal, startLabel, statusLabel, tableProgressLabel, MIN_SEATS, tokensLabel } from './tournamentFormat';
import { TournamentVoiceSlot } from './TournamentVoiceDock';
import { useCountdown } from './useCountdown';
import { getTournamentInviteUrl, shareTournamentInvite } from '../../utils/tournamentInvites';
import { getThemePresentation } from '../../config/themePresentation';
import './tournament.css';

const Facts = ({ tournament }) => (
    <ul className="tournament-facts">
        <li><span className="k">Buy-in</span><span className="v">{tokensLabel(tournament.buyInTokens)}</span></li>
        <li><span className="k">Starting stack</span><span className="v">{tournament.startingStack}</span></li>
        <li><span className="k">Seats</span><span className="v">{tournament.seatsTaken} of {tournament.maxSeats}</span></li>
        <li><span className="k">Venue</span><span className="v">{getThemePresentation(tournament.venue).name}</span></li>
        <li><span className="k">Start</span><span className="v">{startLabel(tournament)}</span></li>
        <li><span className="k">Prizes</span><span className="v">{tournament.seatsTaken >= 6 ? '50 / 30 / 20' : '65 / 35'}</span></li>
        <li><span className="k">Chip drain</span><span className="v">{drainLabel(tournament)}</span></li>
    </ul>
);

// Standings as a leaderboard: a stack bar against the leader, the top three
// picked out, and — while the board shows the chip drain — each drop beside
// the stack it came off.
const Standings = ({ ranked, myUserId, finished, drain = null, favorites = [] }) => {
    const leader = Math.max(1, ...ranked.filter(entry => entry.status !== 'busted').map(entry => Math.max(0, Number(entry.stack) || 0)));
    return (
        <table className="tournament-standings">
            <thead>
                <tr>
                    <th className="num">#</th>
                    <th>Player</th>
                    <th className="bar-col" aria-hidden="true" />
                    <th className="num">Stack</th>
                    <th>{finished ? 'Prize' : 'Status'}</th>
                </tr>
            </thead>
            <tbody>
                {ranked.map(entry => {
                    const out = entry.status === 'busted';
                    const pct = out ? 0 : Math.round(100 * Math.max(0, Number(entry.stack) || 0) / leader);
                    const drop = Number(drain?.drops?.[entry.username]) || 0;
                    const classes = [
                        entry.userId === myUserId ? 'me' : '',
                        out ? 'out' : '',
                        !out && entry.rank <= 3 ? `top top-${entry.rank}` : '',
                    ].join(' ').trim();
                    return (
                        <tr key={entry.userId} className={classes}>
                            <td className="num rank">{entry.rank}</td>
                            <td className="name">
                                {favorites.includes(entry.username) && <span className="tournament-favorite-star" title="Tonight's favorite">★ </span>}
                                {entry.username}
                            </td>
                            <td className="bar-col" aria-hidden="true"><span className="tournament-bar" style={{ width: `${pct}%` }} /></td>
                            <td className="num stack">
                                {drop > 0 && <span className="drop">−{drop}</span>}
                                {entry.stack}
                            </td>
                            <td>
                                {finished
                                    ? (entry.prizeTokens > 0 ? <span className="tournament-chip gold">{tokensLabel(entry.prizeTokens)}</span> : '—')
                                    : (out
                                        ? <span className="tournament-chip out">Out · round {entry.bustedRound}</span>
                                        : (entry.status === 'playing' ? <span className="tournament-chip">Playing</span> : <span className="tournament-chip">Registered</span>))}
                            </td>
                        </tr>
                    );
                })}
            </tbody>
        </table>
    );
};

// The ring at the head of the board: a countdown draining to the next round,
// or the room's progress through the round while tables are still playing.
const RING_RADIUS = 44;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;
const Ring = ({ value, caption, fraction, live = false, label }) => {
    const clamped = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
    return (
        <div className={`tournament-ring${live ? ' live' : ''}`} role="img" aria-label={label}>
            <svg viewBox="0 0 100 100" aria-hidden="true">
                <circle className="track" cx="50" cy="50" r={RING_RADIUS} />
                <circle
                    className="arc"
                    cx="50"
                    cy="50"
                    r={RING_RADIUS}
                    style={{ strokeDasharray: RING_LENGTH, strokeDashoffset: RING_LENGTH * (1 - clamped) }}
                />
            </svg>
            <div className="tournament-ring-value">
                <span>{value}</span>
                {caption && <small>{caption}</small>}
            </div>
        </div>
    );
};

// One table of the round as a small felt in the venue's own surface: who is
// seated, how far through the hand it is, and Watch when the viewer is free.
const FeltCard = ({ table, mine, canWatch, onWatch }) => {
    const total = table.tricksTotal || 11;
    const done = Boolean(table.finished) || table.phase === 'done';
    const trick = Math.min(total, Number(table.trick) || 0);
    const pct = done ? 100 : ((table.phase === 'dealing' || table.phase === 'bidding') ? 4 : Math.round(100 * trick / total));
    const sitOuts = table.sitOuts || [];
    return (
        <div className={`tournament-felt${mine ? ' mine' : ''}${done ? ' done' : ' live'}`}>
            <div className="tournament-felt-head">
                <span>Table {table.tableIndex + 1}</span>
                <span className="tournament-felt-state">{done ? 'Done' : tableProgressLabel(table)}</span>
            </div>
            <div className="tournament-felt-oval">
                <ul>
                    {table.seats.map(name => (
                        <li key={name} className={sitOuts.includes(name) ? 'sit-out' : ''}>
                            {name}{sitOuts.includes(name) ? ' · sits out' : ''}
                        </li>
                    ))}
                </ul>
            </div>
            <div className="tournament-felt-progress" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
            {canWatch && !done && onWatch && (
                <div className="tournament-actions center">
                    <button type="button" className="tournament-btn secondary small" onClick={() => onWatch(table.tableId)}>Watch</button>
                </div>
            )}
        </div>
    );
};

const ConfirmRow = ({ prompt, confirmLabel, onConfirm, onCancel, busy }) => (
    <div className="tournament-actions">
        <span style={{ alignSelf: 'center', marginRight: 'auto' }}>{prompt}</span>
        <button type="button" className="tournament-btn secondary" onClick={onCancel} disabled={busy}>Stay</button>
        <button type="button" className="tournament-btn danger" onClick={onConfirm} disabled={busy}>{confirmLabel}</button>
    </div>
);

const TournamentView = ({
    tournament,
    user,
    busy = false,
    error = '',
    onJoin,
    onLeave,
    onFindPlayer,
    onStart,
    onCancel,
    onQuit,
    onWatch,
    onFastPlay,
    onBack,
}) => {
    const [confirming, setConfirming] = useState(null);
    const nextIn = useCountdown(tournament?.nextRoundInSeconds ?? null);
    // The countdown ring drains from wherever the count began this time.
    const countdownFromRef = useRef(null);
    useEffect(() => {
        if (!Number.isFinite(nextIn) || nextIn <= 0) { countdownFromRef.current = null; return; }
        if (countdownFromRef.current === null || nextIn > countdownFromRef.current) countdownFromRef.current = nextIn;
    }, [nextIn]);
    // "Link copied" after a share that had no share sheet; clears itself.
    const [shareNotice, setShareNotice] = useState('');
    useEffect(() => {
        if (!shareNotice) return undefined;
        const timer = setTimeout(() => setShareNotice(''), 4000);
        return () => clearTimeout(timer);
    }, [shareNotice]);
    const handleShare = async () => {
        const result = await shareTournamentInvite(tournament);
        if (result === 'copied') setShareNotice('Link copied — paste it into a message.');
        else if (result === 'failed') window.prompt('Copy this tournament link:', getTournamentInviteUrl(tournament.id));
    };
    useEffect(() => { setConfirming(null); }, [tournament?.id, tournament?.status]);

    if (!tournament) {
        return (
            <div className="tournament-view">
                <div className="tournament-head"><h1>No tournament right now</h1></div>
                <p>When someone opens one, it shows up under the wheel in the lobby.</p>
                <div className="tournament-actions">
                    <button type="button" className="tournament-btn secondary" onClick={onBack}>Back to the lobby</button>
                </div>
            </div>
        );
    }

    const { me, entered, isCreator, myTable, ranked } = describeViewer(tournament, user?.id);
    const finished = ['complete', 'cancelled', 'voided'].includes(tournament.status);
    const running = tournament.status === 'running';
    const registering = tournament.status === 'registering';

    const podium = finished && tournament.status === 'complete'
        ? ranked.filter(entry => entry.place != null && entry.place <= 3)
        : [];

    return (
        <div className="tournament-view" data-theme={tournament.venue}>
            <div className="tournament-head">
                <div>
                    <p className="tournament-status">{statusLabel(tournament)}</p>
                    <h1>{tournament.name}</h1>
                </div>
                <div className="tournament-head-actions">
                    {running && me && <TournamentVoiceSlot className="tournament-voice-slot on-board" />}
                    <button type="button" className="tournament-btn secondary" onClick={onBack}>
                        {running && me?.status === 'playing' ? 'Lobby' : 'Back to the lobby'}
                    </button>
                </div>
            </div>

            {error && <p className="tournament-error" role="alert">{error}</p>}
            {shareNotice && <p className="tournament-notice" role="status">{shareNotice}</p>}

            {registering && (
                <>
                    <section className="tournament-panel">
                        <Facts tournament={tournament} />
                        <div className="tournament-actions">
                            {!entered && (
                                <button type="button" className="tournament-btn" onClick={onJoin} disabled={busy || tournament.seatsTaken >= tournament.maxSeats}>
                                    {tournament.seatsTaken >= tournament.maxSeats ? 'Full' : `Join · ${tokensLabel(tournament.buyInTokens)}`}
                                </button>
                            )}
                            {entered && !isCreator && confirming !== 'leave' && (
                                <button type="button" className="tournament-btn secondary" onClick={() => setConfirming('leave')} disabled={busy}>Leave</button>
                            )}
                            {entered && isCreator && confirming !== 'leave' && confirming !== 'cancel' && (
                                <button type="button" className="tournament-btn secondary" onClick={() => setConfirming('leave')} disabled={busy}>Leave</button>
                            )}
                            <button type="button" className="tournament-btn secondary" onClick={handleShare} title="Share a link that opens this tournament" aria-label="Share link to this tournament">Share link</button>
                        </div>
                        {confirming === 'leave' && (
                            <ConfirmRow prompt="Leave and take your buy-in back?" confirmLabel="Leave" busy={busy} onCancel={() => setConfirming(null)} onConfirm={() => { setConfirming(null); onLeave(); }} />
                        )}
                    </section>

                    {isCreator && (
                        <section className="tournament-panel tournament-you">
                            <h2>Your tournament</h2>
                            <p>Fill the seats, then start it. It needs at least {MIN_SEATS} players.</p>
                            <div className="tournament-actions">
                                <button type="button" className="tournament-btn" onClick={onFindPlayer} disabled={busy || tournament.seatsTaken >= tournament.maxSeats}>Find player</button>
                                {tournament.startRule !== 'when_full' && (
                                    <button type="button" className="tournament-btn" onClick={onStart} disabled={busy || tournament.seatsTaken < MIN_SEATS}>Start now</button>
                                )}
                                {confirming !== 'cancel' && (
                                    <button type="button" className="tournament-btn danger" onClick={() => setConfirming('cancel')} disabled={busy}>Cancel</button>
                                )}
                            </div>
                            {confirming === 'cancel' && (
                                <ConfirmRow prompt="Cancel the tournament and refund everyone?" confirmLabel="Cancel it" busy={busy} onCancel={() => setConfirming(null)} onConfirm={() => { setConfirming(null); onCancel(); }} />
                            )}
                        </section>
                    )}

                    <section className="tournament-panel">
                        <h2>Registered · {tournament.seatsTaken}</h2>
                        {ranked.length === 0
                            ? <p>Nobody yet.</p>
                            : (
                                <div className="tournament-table">
                                    <ul>{ranked.map(entry => <li key={entry.userId}>{entry.username}{entry.userId === tournament.creatorUserId ? ' · host' : ''}</li>)}</ul>
                                </div>
                            )}
                    </section>
                </>
            )}

            {running && (() => {
                const open = tournament.tables.filter(table => !table.finished);
                const seated = me?.status === 'playing';
                const mineDone = myTable ? Boolean(myTable.finished) : true;
                const betweenRounds = open.length === 0;
                const drain = betweenRounds ? currentDrain(tournament) : null;
                const canWatch = Boolean(onWatch) && (!seated || mineDone);
                const openLabel = open.length === 1 ? 'one table' : `${open.length} tables`;
                const tricksDone = open.reduce((sum, table) => sum + (table.finished ? (table.tricksTotal || 11) : Math.min(table.tricksTotal || 11, Number(table.trick) || 0)), 0);
                const tricksTotal = Math.max(1, tournament.tables.reduce((sum, table) => sum + (table.tricksTotal || 11), 0));
                const roundFraction = (tricksDone + (tournament.tables.length - open.length) * 11) / tricksTotal;

                let title;
                let sub;
                let ring;
                if (betweenRounds) {
                    const counting = Number.isFinite(nextIn) && nextIn > 0;
                    title = counting ? `Next round in ${nextIn} s` : 'Reseating…';
                    sub = drain
                        ? `Chip drain · everyone drops ${drain.percent}%`
                        : 'Top with top: the leaders share a table, and so do the short stacks.';
                    const from = countdownFromRef.current || nextIn || 1;
                    ring = <Ring value={counting ? nextIn : '…'} caption={counting ? 'seconds' : 'reseating'} fraction={counting ? nextIn / from : 0} label={title} />;
                } else if (seated && !mineDone) {
                    title = `Round ${tournament.round} in play`;
                    sub = `${open.length === 1 ? 'One table is' : `${open.length} tables are`} still playing.`;
                    ring = <Ring value={open.length} caption={open.length === 1 ? 'table live' : 'tables live'} fraction={roundFraction} live label={title} />;
                } else {
                    title = `Waiting on ${openLabel}`;
                    const progress = open.map(table => `Table ${table.tableIndex + 1} · ${tableProgressLabel(table)}`).join('   ·   ');
                    sub = seated ? `Your round is done. ${progress}` : progress;
                    ring = <Ring value={open.length} caption={open.length === 1 ? 'table live' : 'tables live'} fraction={roundFraction} live label={title} />;
                }

                return (
                    <>
                        <section className="tournament-hero" aria-live="polite">
                            {ring}
                            <div className="tournament-hero-text">
                                <h2>{title}</h2>
                                <p className="tournament-hero-sub">{sub}</p>
                                <div className="tournament-hero-you">
                                    {!me && <p>You are watching. {tournament.playersLeft} players are still in.</p>}
                                    {seated && myTable && (
                                        <p>You are at <strong>Table {myTable.tableIndex + 1}</strong> with {myTable.seats.filter(name => name !== me.username).join(' and ')}{myTable.sitOuts?.length ? `; ${myTable.sitOuts.join(' and ')} sit${myTable.sitOuts.length === 1 ? 's' : ''} this one out` : ''}.</p>
                                    )}
                                    {seated && !myTable && <p>The round is over. The room is being reseated; your next table is moments away.</p>}
                                    {me?.status === 'busted' && <p>You went out in round {me.bustedRound}. You can watch the rest from here.</p>}
                                    {me && <p>Stack <strong>{me.stack}</strong> · {ordinal(me.rank)} of {tournament.playersLeft} left.</p>}
                                </div>
                            </div>
                        </section>

                        {isCreator && tournament.botsOnly && onFastPlay && (
                            <section className="tournament-panel tournament-you tournament-fast-play">
                                <h2>Only house players are left</h2>
                                <p>
                                    {tournament.fastPlay
                                        ? 'Fast play is on: the rest of the event runs at ten times speed.'
                                        : 'As the host you can run the rest of the event at ten times speed.'}
                                </p>
                                <div className="tournament-actions">
                                    <button
                                        type="button"
                                        className={`tournament-btn${tournament.fastPlay ? ' secondary' : ''}`}
                                        onClick={() => onFastPlay(!tournament.fastPlay)}
                                        disabled={busy}
                                    >
                                        {tournament.fastPlay ? 'Normal speed' : 'Fast play'}
                                    </button>
                                </div>
                            </section>
                        )}

                        <div className="tournament-board">
                            <section className="tournament-panel tournament-room">
                                <h2>Tables · round {tournament.round}</h2>
                                {tournament.tables.length === 0
                                    ? <p className="tournament-room-empty">Reseating…</p>
                                    : (
                                        <div className="tournament-felts">
                                            {tournament.tables.map(table => (
                                                <FeltCard
                                                    key={table.tableId}
                                                    table={table}
                                                    mine={table.tableId === myTable?.tableId}
                                                    canWatch={canWatch}
                                                    onWatch={onWatch}
                                                />
                                            ))}
                                        </div>
                                    )}
                            </section>
                            <section className="tournament-panel">
                                <h2>Standings</h2>
                                <Standings ranked={ranked} myUserId={user?.id} finished={false} drain={drain} favorites={tournament.favorites || []} />
                            </section>
                        </div>

                        <section className="tournament-panel tournament-foot">
                            {confirming !== 'quit' && (
                                <div className="tournament-actions">
                                    <button type="button" className="tournament-btn secondary" onClick={handleShare} aria-label="Share link to this tournament">Share link</button>
                                    {seated && (
                                        <button type="button" className="tournament-btn danger" onClick={() => setConfirming('quit')} disabled={busy}>Quit tournament</button>
                                    )}
                                </div>
                            )}
                            {confirming === 'quit' && (
                                <ConfirmRow prompt="Quitting counts as a bust at your current place. No refund." confirmLabel="Quit" busy={busy} onCancel={() => setConfirming(null)} onConfirm={() => { setConfirming(null); onQuit(); }} />
                            )}
                        </section>
                    </>
                );
            })()}

            {finished && (
                <>
                    {tournament.status === 'complete' && podium.length > 0 && (
                        <div className="tournament-podium">
                            {podium.map(entry => (
                                <div key={entry.userId} className={`tournament-podium-place${entry.place === 1 ? ' first' : ''}`}>
                                    <div className="place">{ordinal(entry.place)}</div>
                                    <div className="name">{entry.username}</div>
                                    <div className="prize">{entry.prizeTokens > 0 ? tokensLabel(entry.prizeTokens) : ''}</div>
                                </div>
                            ))}
                        </div>
                    )}
                    {tournament.status !== 'complete' && (
                        <section className="tournament-panel">
                            <p>{tournament.closeReason || 'The tournament did not run.'} Every buy-in was returned.</p>
                        </section>
                    )}
                    {tournament.status === 'complete' && (
                        <section className="tournament-panel">
                            <h2>Final standings · {tournament.round} rounds</h2>
                            <Standings ranked={ranked} myUserId={user?.id} finished favorites={tournament.favorites || []} />
                        </section>
                    )}
                </>
            )}
        </div>
    );
};

export default TournamentView;
