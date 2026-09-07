// On the felt, under the header: what the room is waiting on once this
// table's round is done, with a way to watch the tables still playing —
// and, while watching one, the way back.
import React from 'react';
import { currentDrain, tableProgressLabel } from './tournamentFormat';
import { useCountdown } from './useCountdown';
import './tournament.css';

const TournamentWaitStrip = ({ tournament, tableId, tableState, isSpectator, viewerName = null, watchingTableId = null, onWatch }) => {
    const nextIn = useCountdown(tournament?.nextRoundInSeconds ?? null);
    if (!tournament || tournament.status !== 'running') return null;
    const tables = tournament.tables || [];
    const mine = tables.find(table => table.tableId === tableId) || null;
    const watching = Boolean(watchingTableId) && watchingTableId === tableId;
    const open = tables.filter(table => !table.finished && table.tableId !== tableId);

    // Watching another table: nothing on the felt (a strip here covered the
    // action). The header cube says "Watching Table 2" and its sheet holds
    // the Watch buttons and the way back.
    if (watching) return null;

    const done = tableState === 'Awaiting Next Round Trigger' || (mine && mine.finished);
    if (!done || isSpectator) return null;
    if (open.length === 0) {
        const drain = currentDrain(tournament);
        const myDrop = drain && viewerName ? drain.drops[viewerName] : null;
        return (
            <div className="tournament-wait-strip" role="status" aria-live="polite">
                <span className="tournament-wait-text">
                    {drain ? `Chip drain −${drain.percent}%${myDrop ? ` · you drop ${myDrop}` : ''}.` : 'Every table is done.'}
                    {Number.isFinite(nextIn) && nextIn > 0 ? ` Next round in ${nextIn} s.` : ' Reseating…'}
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
