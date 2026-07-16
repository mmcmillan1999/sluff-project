import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getCurrentSeasonStandings } from '../services/api';
import { alphaSeasonTwo, bulletinEntries } from './BulletinContent';
import './BulletinView.css';

const BulletinView = ({ onReturnToLobby, onOpenSeasonRecaps }) => {
    const headingRef = useRef(null);
    const [standings, setStandings] = useState(null);
    const [seasonName, setSeasonName] = useState(null);

    useEffect(() => {
        headingRef.current?.focus();
    }, []);

    useEffect(() => {
        let cancelled = false;

        const loadCurrentStandings = async () => {
            try {
                const payload = await getCurrentSeasonStandings();
                if (cancelled || !payload || !Array.isArray(payload.standings)) return;
                setStandings(payload.standings);
                setSeasonName(payload.season?.name || null);
            } catch (error) {
                // The Bulletin stays useful without live standings; the
                // Leaderboard owns the authoritative error UI.
            }
        };

        loadCurrentStandings();
        return () => {
            cancelled = true;
        };
    }, []);

    // Live top 3: ranked players only, by rank. Slots without a ranked
    // player render as open seats so a young season still looks inviting.
    const livePodium = useMemo(() => {
        const ranked = (Array.isArray(standings) ? standings : [])
            .filter(row => Number.isFinite(Number(row?.rank)) && Number(row.rank) >= 1)
            .sort((a, b) => Number(a.rank) - Number(b.rank));
        return alphaSeasonTwo.standings.podium.map((slot, index) => ({
            ...slot,
            player: ranked[index]?.displayName || ranked[index]?.username || null,
        }));
    }, [standings]);

    const podiumHasPlayers = livePodium.some(slot => slot.player);

    return (
        <div className="bulletin-view">
            <header className="bulletin-view-header">
                <button type="button" className="bulletin-view-back" onClick={onReturnToLobby}>
                    <span aria-hidden="true">&lsaquo;</span>
                    Lobby
                </button>
                <div className="bulletin-view-brand">
                    <img src="/SluffLogo.png" alt="" aria-hidden="true" />
                    <span>Sluff Bulletin</span>
                </div>
                <span className="bulletin-view-edition">Alpha</span>
            </header>

            <main className="bulletin-view-main">
                <section className="bulletin-season-hero" aria-labelledby="alpha-season-heading">
                    <div className="bulletin-season-copy">
                        <p className="bulletin-eyebrow">{alphaSeasonTwo.eyebrow}</p>
                        <h1 id="alpha-season-heading" ref={headingRef} tabIndex="-1">
                            {alphaSeasonTwo.title}
                        </h1>
                        <p className="bulletin-season-summary">
                            {alphaSeasonTwo.summary}
                        </p>
                        <div className="bulletin-spotlight">
                            <span>{alphaSeasonTwo.spotlight.label}</span>
                            <strong>{alphaSeasonTwo.spotlight.name}</strong>
                            <p>{alphaSeasonTwo.spotlight.note}</p>
                        </div>
                    </div>

                    <div
                        className="bulletin-podium-preview"
                        role="group"
                        aria-label={`${seasonName || 'Current season'} live top three`}
                    >
                        <p className="bulletin-podium-status">
                            {seasonName ? `${seasonName} · ${alphaSeasonTwo.standings.status}` : alphaSeasonTwo.standings.status}
                        </p>
                        <div className="bulletin-podium-slots">
                            {livePodium.map(entry => (
                                <div className={`bulletin-podium-slot place-${entry.place}`} key={entry.place}>
                                    <span className="bulletin-podium-place">{entry.place}</span>
                                    <strong>{entry.player || alphaSeasonTwo.standings.openSeatName}</strong>
                                    <span>{entry.label}</span>
                                </div>
                            ))}
                        </div>
                        <p className="bulletin-archive-note">
                            {podiumHasPlayers
                                ? alphaSeasonTwo.standings.note
                                : alphaSeasonTwo.standings.emptyNote}
                        </p>
                        {onOpenSeasonRecaps && (
                            <button
                                type="button"
                                className="bulletin-season-archive-button"
                                onClick={onOpenSeasonRecaps}
                            >
                                View Season Recaps
                            </button>
                        )}
                    </div>
                </section>

                <section className="bulletin-journal" aria-labelledby="build-journal-heading">
                    <div className="bulletin-journal-heading">
                        <p className="bulletin-eyebrow">Development journal</p>
                        <h2 id="build-journal-heading">The build so far</h2>
                        <p>Highlights from the changes shaping Sluff during the Alpha.</p>
                    </div>

                    <div className="bulletin-entry-list">
                        {bulletinEntries.map(entry => (
                            <article className="bulletin-entry" key={entry.id}>
                                <div className="bulletin-entry-meta">
                                    <span>{entry.status}</span>
                                    <span>{entry.dateLabel}</span>
                                </div>
                                <h3>{entry.title}</h3>
                                <p>{entry.summary}</p>
                                <ul>
                                    {entry.highlights.map(highlight => <li key={highlight}>{highlight}</li>)}
                                </ul>
                            </article>
                        ))}
                    </div>
                </section>
            </main>

            <footer className="bulletin-view-footer">
                Shaped with player feedback during the Alpha. Season Recaps holds the official historical record.
            </footer>
        </div>
    );
};

export default BulletinView;
