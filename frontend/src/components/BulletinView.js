import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getSeason, getSeasons } from '../services/api';
import { alphaSeasonOne, bulletinEntries } from './BulletinContent';
import './BulletinView.css';

const seasonKey = season => String(season?.slug ?? season?.id ?? '');

const BulletinView = ({ onReturnToLobby, onOpenSeasonRecaps }) => {
    const headingRef = useRef(null);
    const [alphaArchive, setAlphaArchive] = useState(null);

    useEffect(() => {
        headingRef.current?.focus();
    }, []);

    useEffect(() => {
        let cancelled = false;

        const loadFinalAlphaStandings = async () => {
            try {
                const index = await getSeasons();
                const seasons = Array.isArray(index?.seasons) ? index.seasons : [];
                const alphaOne = seasons.find(season => (
                    season?.finalizedAt
                    && (seasonKey(season) === 'alpha-season-1' || season?.name === 'Alpha Season 1')
                ));
                if (!alphaOne) return;

                const archive = await getSeason(seasonKey(alphaOne));
                if (!cancelled) setAlphaArchive(archive);
            } catch (error) {
                // The Bulletin remains useful during a rolling deploy or an
                // archive outage. Season Recaps owns the authoritative error UI.
            }
        };

        loadFinalAlphaStandings();
        return () => {
            cancelled = true;
        };
    }, []);

    const finalPodium = useMemo(() => {
        const archivedPodium = Array.isArray(alphaArchive?.podium) ? alphaArchive.podium : [];
        const byRank = new Map(archivedPodium.map(player => [Number(player?.rank), player]));
        return alphaSeasonOne.podium.map(slot => ({
            ...slot,
            player: byRank.get(slot.place)?.displayName || slot.player,
        }));
    }, [alphaArchive]);

    const archiveIsFinal = Boolean(alphaArchive?.season?.finalizedAt);

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
                        <p className="bulletin-eyebrow">{alphaSeasonOne.eyebrow}</p>
                        <h1 id="alpha-season-heading" ref={headingRef} tabIndex="-1">
                            {archiveIsFinal ? alphaSeasonOne.finalTitle : alphaSeasonOne.title}
                        </h1>
                        <p className="bulletin-season-summary">
                            {archiveIsFinal ? alphaSeasonOne.finalSummary : alphaSeasonOne.summary}
                        </p>
                        <div className="bulletin-spotlight">
                            <span>{alphaSeasonOne.spotlight.label}</span>
                            <strong>{alphaSeasonOne.spotlight.name}</strong>
                            <p>{alphaSeasonOne.spotlight.note}</p>
                        </div>
                    </div>

                    <div
                        className="bulletin-podium-preview"
                        role="group"
                        aria-label={archiveIsFinal ? 'Alpha Season 1 final podium' : 'Alpha Season 1 podium archive'}
                    >
                        <p className="bulletin-podium-status">
                            {archiveIsFinal ? 'Final podium' : alphaSeasonOne.status}
                        </p>
                        <div className="bulletin-podium-slots">
                            {finalPodium.map(entry => (
                                <div className={`bulletin-podium-slot place-${entry.place}`} key={entry.place}>
                                    <span className="bulletin-podium-place">{entry.place}</span>
                                    <strong>{entry.player || 'See archive'}</strong>
                                    <span>{entry.label}</span>
                                </div>
                            ))}
                        </div>
                        <p className="bulletin-archive-note">
                            {archiveIsFinal
                                ? 'These names come directly from the frozen Alpha Season 1 scoreboard.'
                                : alphaSeasonOne.archiveNote}
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
                        <h2 id="build-journal-heading">Alpha Season 1: the build so far</h2>
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
                Shaped with player feedback during Alpha Season 1. Season Recaps holds the official historical record.
            </footer>
        </div>
    );
};

export default BulletinView;
