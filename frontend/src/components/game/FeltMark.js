// The felt's inscription: the SLUFF mark at the center of every table and,
// on a tournament table, the event's name over it — with FINAL TABLE between
// the two once the field is down to the last table — the way a televised final
// table wears the event on the cloth. Ghosted like the mark, sized small,
// and never wider than the cloth's middle so the cards keep their room.
import React from 'react';
import './FeltMark.css';

// Five or fewer players seat at one table (seating.js): the final table.
export const FINAL_TABLE_PLAYERS = 5;

export const feltMarkFor = ({ tableTournament, tournament }) => {
    if (!tableTournament) return null;
    const sameEvent = tournament && Number(tournament.id) === Number(tableTournament.tournamentId);
    const left = sameEvent ? Number(tournament.playersLeft) : NaN;
    return {
        name: typeof tableTournament.name === 'string' ? tableTournament.name.trim() : '',
        finalTable: Number.isFinite(left) && left > 0 && left <= FINAL_TABLE_PLAYERS,
    };
};

const FeltMark = ({ mark = null }) => (
    <div className={`felt-mark${mark?.finalTable ? ' is-final' : ''}`} aria-hidden="true">
        {mark?.name ? <span className="felt-mark-event">{mark.name}</span> : null}
        {mark?.finalTable ? <span className="felt-mark-final">Final Table</span> : null}
        <img src="/SluffLogo.png" alt="" className="sluff-watermark" />
    </div>
);

export default FeltMark;
