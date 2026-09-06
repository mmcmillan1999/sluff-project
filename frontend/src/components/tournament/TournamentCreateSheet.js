// The creator's sheet: buy-in, starting stack, seats, venue, start rule.
// Every rule here mirrors the director's validation so a bad value is
// caught before it leaves the phone.
import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useModalFocus } from '../../hooks/useModalFocus';
import {
    DRAIN_OPTIONS, MAX_BUY_IN_TOKENS, MAX_SEATS, MIN_SEATS, STARTING_STACKS, TOURNAMENT_VENUE, VENUE_OPTIONS,
} from './tournamentFormat';
import './tournament.css';

const MIN_LEAD_MINUTES = 10;

const localDateTimeValue = (date) => {
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export const validateSettings = (form) => {
    const buyIn = Number(form.buyInTokens);
    if (!Number.isFinite(buyIn) || buyIn < 0 || buyIn > MAX_BUY_IN_TOKENS) return `The buy-in must be between 0 and ${MAX_BUY_IN_TOKENS} tokens.`;
    if (!STARTING_STACKS.includes(Number(form.startingStack))) return 'Pick a starting stack.';
    const seats = Number(form.maxSeats);
    if (!Number.isInteger(seats) || seats < MIN_SEATS || seats > MAX_SEATS) return `Seats must be between ${MIN_SEATS} and ${MAX_SEATS}.`;
    if (!DRAIN_OPTIONS.some(option => option.value === Number(form.drainPercent))) return 'Pick a chip drain.';
    if (form.startRule === 'at_time') {
        const when = new Date(form.startsAt).getTime();
        if (!Number.isFinite(when) || when < Date.now() + MIN_LEAD_MINUTES * 60_000) return `A timed start must be at least ${MIN_LEAD_MINUTES} minutes away.`;
    }
    return '';
};

const TournamentCreateSheet = ({ show, defaultName = '', onClose, onCreate, busy = false, error = '' }) => {
    const dialogRef = useModalFocus(show, '.tournament-create-name');
    const initial = useMemo(() => ({
        name: defaultName,
        buyInTokens: '1',
        startingStack: 120,
        maxSeats: '9',
        venue: TOURNAMENT_VENUE,
        drainPercent: 10,
        startRule: 'creator',
        startsAt: localDateTimeValue(new Date(Date.now() + 15 * 60_000)),
    }), [defaultName]);
    const [form, setForm] = useState(initial);
    const [localError, setLocalError] = useState('');

    useEffect(() => { if (show) { setForm(initial); setLocalError(''); } }, [initial, show]);
    useEffect(() => {
        if (!show) return undefined;
        const closeOnEscape = event => { if (event.key === 'Escape' && !busy) onClose(); };
        document.addEventListener('keydown', closeOnEscape);
        return () => document.removeEventListener('keydown', closeOnEscape);
    }, [busy, onClose, show]);

    if (!show) return null;

    const set = (field, value) => setForm(current => ({ ...current, [field]: value }));
    const submit = (event) => {
        event.preventDefault();
        const problem = validateSettings(form);
        setLocalError(problem);
        if (problem) return;
        onCreate({
            name: form.name.trim(),
            buyInTokens: Number(form.buyInTokens),
            startingStack: Number(form.startingStack),
            maxSeats: Number(form.maxSeats),
            venue: form.venue,
            drainPercent: Number(form.drainPercent),
            startRule: form.startRule,
            startsAt: form.startRule === 'at_time' ? new Date(form.startsAt).toISOString() : null,
        });
    };

    return createPortal(
        <div
            className="tournament-overlay"
            onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}
        >
            <section
                className="tournament-dialog"
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="tournament-create-title"
                aria-busy={busy}
                tabIndex="-1"
            >
                <p className="tournament-kicker">New tournament</p>
                <h2 id="tournament-create-title">Set the table</h2>
                <form className="tournament-form" onSubmit={submit}>
                    <label className="tournament-field">
                        <span>Name</span>
                        <input type="text" className="tournament-create-name" value={form.name} maxLength={60} placeholder="Saturday Sluff" onChange={event => set('name', event.target.value)} />
                    </label>
                    <label className="tournament-field">
                        <span>Buy-in (tokens, up to {MAX_BUY_IN_TOKENS})</span>
                        <input type="number" inputMode="decimal" min="0" max={MAX_BUY_IN_TOKENS} step="0.5" value={form.buyInTokens} onChange={event => set('buyInTokens', event.target.value)} />
                    </label>
                    <div className="tournament-field">
                        <span>Starting stack</span>
                        <div className="tournament-segments" role="group" aria-label="Starting stack">
                            {STARTING_STACKS.map(stack => (
                                <button key={stack} type="button" className="tournament-segment" aria-pressed={form.startingStack === stack} onClick={() => set('startingStack', stack)}>{stack}</button>
                            ))}
                        </div>
                    </div>
                    <label className="tournament-field">
                        <span>Seats ({MIN_SEATS} to {MAX_SEATS})</span>
                        <input type="number" inputMode="numeric" min={MIN_SEATS} max={MAX_SEATS} step="1" value={form.maxSeats} onChange={event => set('maxSeats', event.target.value)} />
                    </label>
                    <div className="tournament-field">
                        <span>Venue</span>
                        <div className="tournament-venues" role="group" aria-label="Venue">
                            {VENUE_OPTIONS.map(venue => (
                                <button key={venue.id} type="button" className="tournament-venue" aria-pressed={form.venue === venue.id} onClick={() => set('venue', venue.id)} data-theme={venue.id}>
                                    <span className="tournament-venue-swatch" aria-hidden="true" />
                                    <span>{venue.name}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="tournament-field">
                        <span>Chip drain · everyone drops this much between rounds</span>
                        <div className="tournament-segments" role="group" aria-label="Chip drain">
                            {DRAIN_OPTIONS.map(option => (
                                <button key={option.value} type="button" className="tournament-segment" aria-pressed={Number(form.drainPercent) === option.value} onClick={() => set('drainPercent', option.value)}>{option.label}</button>
                            ))}
                        </div>
                    </div>
                    <div className="tournament-field">
                        <span>Start</span>
                        <div className="tournament-radios">
                            <label><input type="radio" name="startRule" checked={form.startRule === 'creator'} onChange={() => set('startRule', 'creator')} /> When I start it</label>
                            <label><input type="radio" name="startRule" checked={form.startRule === 'when_full'} onChange={() => set('startRule', 'when_full')} /> When every seat is taken</label>
                            <label><input type="radio" name="startRule" checked={form.startRule === 'at_time'} onChange={() => set('startRule', 'at_time')} /> At a set time</label>
                        </div>
                    </div>
                    {form.startRule === 'at_time' && (
                        <label className="tournament-field">
                            <span>Start time</span>
                            <input type="datetime-local" value={form.startsAt} onChange={event => set('startsAt', event.target.value)} />
                        </label>
                    )}
                    {(localError || error) && <p className="tournament-error" role="alert">{localError || error}</p>}
                    <div className="tournament-actions">
                        <button type="button" className="tournament-btn secondary" onClick={onClose} disabled={busy}>Cancel</button>
                        <button type="submit" className="tournament-btn" disabled={busy}>Open registration</button>
                    </div>
                </form>
            </section>
        </div>,
        document.body,
    );
};

export default TournamentCreateSheet;
