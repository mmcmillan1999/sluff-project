// The tournament screen: registration while it fills, the reseat board
// while it runs, the podium when it is over. One component, three states,
// so the player always lands on the same place from the ribbon, the popup
// and the table.
import React, { useEffect, useState } from 'react';
import { describeViewer, formatTokens, ordinal, stakesLabel, startLabel, statusLabel, tableProgressLabel, MIN_SEATS } from './tournamentFormat';
import { TournamentVoiceSlot } from './TournamentVoiceDock';
import { getTournamentInviteUrl, shareTournamentInvite } from '../../utils/tournamentInvites';
import { getThemePresentation } from '../../config/themePresentation';
import './tournament.css';

const Facts = ({ tournament }) => (
    <ul className="tournament-facts">
        <li><span className="k">Buy-in</span><span className="v">{formatTokens(tournament.buyInTokens)} tokens</span></li>
        <li><span className="k">Starting stack</span><span className="v">{tournament.startingStack}</span></li>
        <li><span className="k">Seats</span><span className="v">{tournament.seatsTaken} of {tournament.maxSeats}</span></li>
        <li><span className="k">Venue</span><span className="v">{getThemePresentation(tournament.venue).name}</span></li>
        <li><span className="k">Start</span><span className="v">{startLabel(tournament)}</span></li>
        <li><span className="k">Prizes</span><span className="v">{tournament.seatsTaken >= 6 ? '50 / 30 / 20' : '65 / 35'}</span></li>
        <li><span className="k">Escalation</span><span className="v">{tournament.escalationPercent > 0 ? `+${tournament.escalationPercent}% a round` : 'Off'}</span></li>
    </ul>
);

const Standings = ({ ranked, myUserId, finished }) => (
    <table className="tournament-standings">
        <thead>
            <tr>
                <th className="num">#</th>
                <th>Player</th>
                <th className="num">Stack</th>
                <th>{finished ? 'Prize' : 'Status'}</th>
            </tr>
        </thead>
        <tbody>
            {ranked.map(entry => (
                <tr key={entry.userId} className={[entry.userId === myUserId ? 'me' : '', entry.status === 'busted' ? 'out' : ''].join(' ').trim()}>
                    <td className="num">{entry.rank}</td>
                    <td>{entry.username}</td>
                    <td className="num">{entry.stack}</td>
                    <td>
                        {finished
                            ? (entry.prizeTokens > 0 ? <span className="tournament-chip gold">{formatTokens(entry.prizeTokens)} tokens</span> : '—')
                            : (entry.status === 'busted'
                                ? <span className="tournament-chip out">Out · round {entry.bustedRound}</span>
                                : (entry.status === 'playing' ? <span className="tournament-chip">Playing</span> : <span className="tournament-chip">Registered</span>))}
                    </td>
                </tr>
            ))}
        </tbody>
    </table>
);

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
    onBack,
}) => {
    const [confirming, setConfirming] = useState(null);
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
                                    {tournament.seatsTaken >= tournament.maxSeats ? 'Full' : `Join · ${formatTokens(tournament.buyInTokens)} tokens`}
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

            {running && (
                <>
                    {(() => {
                        const open = tournament.tables.filter(table => !table.finished);
                        const mineDone = myTable ? Boolean(myTable.finished) : true;
                        if (open.length === 0 || !mineDone || !me || me.status !== 'playing') return null;
                        return (
                            <section className="tournament-panel tournament-wait" aria-live="polite">
                                <h2>Waiting on {open.length === 1 ? 'one table' : `${open.length} tables`}</h2>
                                <ul className="tournament-wait-list">
                                    {open.map(table => (
                                        <li key={table.tableId}><strong>Table {table.tableIndex + 1}</strong> · {tableProgressLabel(table)}</li>
                                    ))}
                                </ul>
                            </section>
                        );
                    })()}
                    <section className="tournament-panel tournament-you">
                        <h2>You{stakesLabel(tournament.stakesMultiplier) ? ` · ${stakesLabel(tournament.stakesMultiplier)}` : ''}</h2>
                        {!me && <p>You are watching. {tournament.playersLeft} players are still in.</p>}
                        {me?.status === 'playing' && myTable && (
                            <p>You are at <strong>Table {myTable.tableIndex + 1}</strong> with {myTable.seats.filter(name => name !== me.username).join(' and ')}{myTable.sitOuts?.length ? `; ${myTable.sitOuts.join(' and ')} sit${myTable.sitOuts.length === 1 ? 's' : ''} this one out` : ''}.</p>
                        )}
                        {me?.status === 'playing' && !myTable && <p>The round is over. The room is being reseated; your next table is moments away.</p>}
                        {me?.status === 'busted' && <p>You went out in round {me.bustedRound}. You can watch the rest from here.</p>}
                        {me && <p>Stack <strong>{me.stack}</strong> · {ordinal(me.rank)} of {tournament.playersLeft} left.</p>}
                        {confirming !== 'quit' && (
                            <div className="tournament-actions">
                                <button type="button" className="tournament-btn secondary" onClick={handleShare} aria-label="Share link to this tournament">Share link</button>
                                {me?.status === 'playing' && (
                                    <button type="button" className="tournament-btn danger" onClick={() => setConfirming('quit')} disabled={busy}>Quit tournament</button>
                                )}
                            </div>
                        )}
                        {confirming === 'quit' && (
                            <ConfirmRow prompt="Quitting counts as a bust at your current place. No refund." confirmLabel="Quit" busy={busy} onCancel={() => setConfirming(null)} onConfirm={() => { setConfirming(null); onQuit(); }} />
                        )}
                    </section>

                    <section className="tournament-panel">
                        <h2>Tables · round {tournament.round}</h2>
                        {tournament.tables.length === 0
                            ? <p>Reseating…</p>
                            : (
                                <div className="tournament-tables">
                                    {tournament.tables.map(table => (
                                        <div key={table.tableId} className={`tournament-table${table.tableId === myTable?.tableId ? ' mine' : ''}`}>
                                            <div className="t"><span>Table {table.tableIndex + 1}</span><span>{tableProgressLabel(table)}</span></div>
                                            <ul>
                                                {table.seats.map(name => (
                                                    <li key={name} className={(table.sitOuts || []).includes(name) ? 'sit-out' : ''}>
                                                        {name}{(table.sitOuts || []).includes(name) ? ' · sits out' : ''}
                                                    </li>
                                                ))}
                                            </ul>
                                            {onWatch && (!me || me.status !== 'playing') && !table.finished && (
                                                <div className="tournament-actions">
                                                    <button type="button" className="tournament-btn secondary" onClick={() => onWatch(table.tableId)}>Watch</button>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                    </section>

                    <section className="tournament-panel">
                        <h2>Standings</h2>
                        <Standings ranked={ranked} myUserId={user?.id} finished={false} />
                    </section>
                </>
            )}

            {finished && (
                <>
                    {tournament.status === 'complete' && podium.length > 0 && (
                        <div className="tournament-podium">
                            {podium.map(entry => (
                                <div key={entry.userId} className={`tournament-podium-place${entry.place === 1 ? ' first' : ''}`}>
                                    <div className="place">{ordinal(entry.place)}</div>
                                    <div className="name">{entry.username}</div>
                                    <div className="prize">{entry.prizeTokens > 0 ? `${formatTokens(entry.prizeTokens)} tokens` : ''}</div>
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
                            <Standings ranked={ranked} myUserId={user?.id} finished />
                        </section>
                    )}
                </>
            )}
        </div>
    );
};

export default TournamentView;
