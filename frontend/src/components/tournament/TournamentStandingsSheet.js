// The temporary standings sheet that drops from the header cube during a
// tournament: every stack in order, who is where, who is out. Closes on tap
// or on its own after eight seconds.
import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { describeViewer, ordinal, tableProgressLabel } from './tournamentFormat';
import './tournament.css';

const AUTO_CLOSE_MS = 8000;

const TournamentStandingsSheet = ({ tournament, viewerUserId, onClose }) => {
    useEffect(() => {
        const timer = setTimeout(onClose, AUTO_CLOSE_MS);
        return () => clearTimeout(timer);
    }, [onClose, tournament]);

    if (!tournament) return null;
    const { ranked, myTable } = describeViewer(tournament, viewerUserId);
    const tableOf = (name) => (tournament.tables || []).find(table => table.seats.includes(name));

    return createPortal(
        <div className="tournament-sheet" role="dialog" aria-label="Tournament standings" onClick={onClose}>
            <h2>{tournament.name} · round {tournament.round}</h2>
            {(tournament.tables || []).length > 0 && (
                <ul className="tournament-sheet-tables">
                    {tournament.tables.map(table => (
                        <li key={table.tableId} className={table.tableId === myTable?.tableId ? 'mine' : undefined}>
                            <span>Table {table.tableIndex + 1}{table.tableId === myTable?.tableId ? ' · you' : ''}</span>
                            <span>{tableProgressLabel(table)}</span>
                        </li>
                    ))}
                </ul>
            )}
            <table className="tournament-standings">
                <tbody>
                    {ranked.map(entry => {
                        const table = tableOf(entry.username);
                        return (
                            <tr key={entry.userId} className={[entry.userId === Number(viewerUserId) ? 'me' : '', entry.status === 'busted' ? 'out' : ''].join(' ').trim()}>
                                <td className="num">{ordinal(entry.rank)}</td>
                                <td>{entry.username}</td>
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
