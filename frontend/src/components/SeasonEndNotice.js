import React from 'react';
import useModalFocus from '../hooks/useModalFocus';
import './SeasonEndNotice.css';

// Alpha Season 2 closes at midnight Mountain Time at the end of Wednesday,
// September 30 2026 (06:00 UTC, October 1). The servers go down then for the
// changeover to Season 3; the notice says so once, on the way into the lobby,
// and a "Got it" keeps it away on this device.
export const SEASON_TWO_ENDS_AT = '2026-10-01T06:00:00Z';
export const SEASON_END_NOTICE_ID = 'season-2-ending';
const STORAGE_KEY = `sluff.notice.${SEASON_END_NOTICE_ID}`;

// Dismissal is a per-device convenience: storage can throw or come back empty
// (private windows, blocked site data), and then the notice simply shows again.
export const seasonEndNoticeDismissed = () => {
    try {
        return window.localStorage.getItem(STORAGE_KEY) === 'dismissed';
    } catch (error) {
        return false;
    }
};

export const dismissSeasonEndNotice = () => {
    try {
        window.localStorage.setItem(STORAGE_KEY, 'dismissed');
    } catch (error) { /* shows again next visit */ }
};

export const shouldShowSeasonEndNotice = ({ user, isLobby, hasCurrentTable, blocked = false, now = Date.now() }) => Boolean(
    user
    && isLobby
    && !hasCurrentTable
    && !blocked
    && now < Date.parse(SEASON_TWO_ENDS_AT)
    && !seasonEndNoticeDismissed()
);

// The closing moment in the viewer's own clock, e.g. "Thu, Oct 1, 12:00 AM MDT".
export const localSeasonEnd = (locale) => {
    try {
        return new Date(SEASON_TWO_ENDS_AT).toLocaleString(locale, {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            timeZoneName: 'short',
        });
    } catch (error) {
        return null;
    }
};

const SeasonEndNotice = ({ onDismiss }) => {
    const dialogRef = useModalFocus(true, '[data-season-notice-primary]');
    const local = localSeasonEnd();

    const handleDismiss = () => {
        dismissSeasonEndNotice();
        onDismiss?.();
    };

    return (
        <div className="season-end-notice" data-testid="season-end-notice">
            <section
                ref={dialogRef}
                className="season-end-notice__card"
                role="dialog"
                aria-modal="true"
                aria-labelledby="season-end-notice-title"
                aria-describedby="season-end-notice-body"
                tabIndex={-1}
            >
                <div className="season-end-notice__eyebrow">Alpha Season 2</div>
                <h1 id="season-end-notice-title">The final week</h1>
                <div className="season-end-notice__date" aria-label="Season 2 ends September 30">
                    <span className="season-end-notice__month">Sept</span>
                    <span className="season-end-notice__day">30</span>
                </div>
                <div id="season-end-notice-body">
                    <p className="season-end-notice__intro">
                        Season 2 ends at midnight Mountain Time at the close of Wednesday, September 30.
                    </p>
                    {local && (
                        <p className="season-end-notice__local">
                            That is <strong>{local}</strong> on your clock.
                        </p>
                    )}
                    <ul className="season-end-notice__points">
                        <li>The standings freeze at the final whistle and the Season 2 champion is crowned.</li>
                        <li>Sluff goes offline for a couple of hours while the record book is sealed and Season 3 is set up.</li>
                        <li>Plan to finish your game before midnight: the servers shut down for the changeover.</li>
                    </ul>
                </div>
                <button
                    type="button"
                    className="season-end-notice__primary"
                    data-season-notice-primary
                    onClick={handleDismiss}
                >
                    Got it
                </button>
            </section>
        </div>
    );
};

export default SeasonEndNotice;
