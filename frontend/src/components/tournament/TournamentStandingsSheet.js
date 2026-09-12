// The temporary standings sheet that drops from the header cube during a
// tournament: every stack in order, who is where, who is out — and, once
// your own round is done (or you are out), the way to watch another table
// and the way back to your own. Closes on tap or on its own after eight
// seconds (a tap on a Watch button counts as the tap).
import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { describeViewer, ordinal, tableProgressLabel } from './tournamentFormat';
import './tournament.css';

const AUTO_CLOSE_MS = 8000;

const TournamentStandingsSheet = ({ tournament, viewerUserId, onClose, watchingTableId = null, onWatch = null, onStopWatching = null }) => {
    useEffect(() => {
        const timer = setTimeout(onClose, AUTO_CLOSE_MS);
        return () => clearTimeout(timer);
    }, [onClose, tournament]);

    if (!tournament) return null;
    const { me, ranked, myTable } = describeViewer(tournament, viewerUserId);
    const tableOf = (name) => (tournament.tables || []).find(table => table.seats.includes(name));
    // Watching is for a player whose round is done, or who is out — never
    // for someone still mid-round at their own table.
    const mayWatch = Boolean(onWatch) && tournament.status === 'running' && Boolean(me)
        && (!myTable || myTable.finished || me.status !== 'playing');
    const watchable = (table) => mayWatch && !table.finished && table.tableId !== myTable?.tableId && table.tableId !== watchingTableId;
    const pick = (event, fn) => { event.stopPropagation(); fn(); onClose(); };

    return createPortal(
        <div className="tournament-sheet" role="dialog" aria-label="Tournament standings" onClick={onClose}>
            <h2>{tournament.name} · round {tournament.round}</h2>
            {(tournament.tables || []).length > 0 && (
                <ul className="tournament-sheet-tables">
                    {tournament.tables.map(table => (
                        <li key={table.tableId} className={[table.tableId === myTable?.tableId ? 'mine' : '', table.tableId === watchingTableId ? 'watching' : ''].join(' ').trim() || undefined}>
                            <span>Table {table.tableIndex + 1}{table.tableId === myTable?.tableId ? ' · you' : (table.tableId === watchingTableId ? ' · watching' : '')}</span>
                            <span className="tournament-sheet-table-side">
                                {tableProgressLabel(table)}
                                {watchable(table) && (
                                    <button type="button" className="tournament-btn secondary small" onClick={(event) => pick(event, () => onWatch(table.tableId))}>Watch</button>
                                )}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
            {watchingTableId && onStopWatching && (
                <div className="tournament-sheet-actions">
                    <button type="button" className="tournament-btn small" onClick={(event) => pick(event, onStopWatching)}>Back to my table</button>
                </div>
            )}
            <table className="tournament-standings">
                <tbody>
                    {ranked.map(entry => {
                        const table = tableOf(entry.username);
                        return (
                            <tr key={entry.userId} className={[entry.userId === Number(viewerUserId) ? 'me' : '', entry.status === 'busted' ? 'out' : ''].join(' ').trim()}>
                                <td className="num">{ordinal(entry.rank)}</td>
                                <td>
                                    {(tournament.favorites || []).includes(entry.username) && <span className="tournament-favorite-star" title="Tonight's favorite">★ </span>}
                                    {entry.username}
                                </td>
                                <td className="num">{entry.stack}</td>
                                <td>{entry.status === 'busted' ? `out · r${entry.bustedRound}` : (table ? `T${table.tableIndex + 1}${table.tableId === myTable?.tableId ? ' · you' : ''}` : '')}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
            <p className="tournament-sheet-hint">Tap to close</p>
        </div>,
        document.body,
    );
};

export default TournamentStandingsSheet;
