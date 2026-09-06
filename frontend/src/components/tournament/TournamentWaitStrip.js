// On the felt, under the header: what the room is waiting on once this
// table's round is done, with a way to watch the tables still playing —
// and, while watching one, the way back.
import React from 'react';
import { tableProgressLabel } from './tournamentFormat';
import { useCountdown } from './useCountdown';
import './tournament.css';

const TournamentWaitStrip = ({ tournament, tableId, tableState, viewerUserId, isSpectator, onWatch, onStopWatching }) => {
    const nextIn = useCountdown(tournament?.nextRoundInSeconds ?? null);
    if (!tournament || tournament.status !== 'running') return null;
    const tables = tournament.tables || [];
    const mine = tables.find(table => table.tableId === tableId) || null;
    const watching = tournament.viewer?.watchingTableId && tournament.viewer.watchingTableId === tableId;
    const open = tables.filter(table => !table.finished && table.tableId !== tableId);

    if (watching) {
        const here = mine ? `Table ${mine.tableIndex + 1}` : 'this table';
        return (
            <div className="tournament-wait-strip is-watching" role="status" aria-live="polite">
                <span className="tournament-wait-text">Watching {here} · {mine ? tableProgressLabel(mine) : ''}. Your next round starts when every table is done.</span>
                {onStopWatching && <button type="button" className="tournament-btn secondary small" onClick={onStopWatching}>Back to my table</button>}
            </div>
        );
    }

    const done = tableState === 'Awaiting Next Round Trigger' || (mine && mine.finished);
    if (!done || isSpectator) return null;
    if (open.length === 0) {
        return (
            <div className="tournament-wait-strip" role="status" aria-live="polite">
                <span className="tournament-wait-text">
                    Every table is done.{Number.isFinite(nextIn) && nextIn > 0 ? ` Next round in ${nextIn} s.` : ' Reseating…'}
                </span>
            </div>
        );
    }
    return (
        <div className="tournament-wait-strip" role="status" aria-live="polite">
            <span className="tournament-wait-text">
                Your round is done · waiting on {open.map(table => `Table ${table.tableIndex + 1} (${tableProgressLabel(table).toLowerCase()})`).join(', ')}
            </span>
            {onWatch && open.map(table => (
                <button key={table.tableId} type="button" className="tournament-btn secondary small" onClick={() => onWatch(table.tableId)}>
                    Watch {open.length > 1 ? `T${table.tableIndex + 1}` : ''}
                </button>
            ))}
        </div>
    );
};

export default TournamentWaitStrip;
