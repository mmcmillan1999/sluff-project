import React, { useEffect, useRef } from 'react';
import { alphaSeasonOne, bulletinEntries } from './BulletinContent';
import './BulletinView.css';

const BulletinView = ({ onReturnToLobby }) => {
    const headingRef = useRef(null);

    useEffect(() => {
        headingRef.current?.focus();
    }, []);

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
                        <h1 id="alpha-season-heading" ref={headingRef} tabIndex="-1">{alphaSeasonOne.title}</h1>
                        <p className="bulletin-season-summary">{alphaSeasonOne.summary}</p>
                        <div className="bulletin-spotlight">
                            <span>{alphaSeasonOne.spotlight.label}</span>
                            <strong>{alphaSeasonOne.spotlight.name}</strong>
                            <p>{alphaSeasonOne.spotlight.note}</p>
                        </div>
                    </div>

                    <div className="bulletin-podium-preview" role="group" aria-label="Alpha Season 1 podium awaiting final standings">
                        <p className="bulletin-podium-status">{alphaSeasonOne.status}</p>
                        <div className="bulletin-podium-slots">
                            {alphaSeasonOne.podium.map(entry => (
                                <div className={`bulletin-podium-slot place-${entry.place}`} key={entry.place}>
                                    <span className="bulletin-podium-place">{entry.place}</span>
                                    <strong>{entry.player || 'To be crowned'}</strong>
                                    <span>{entry.label}</span>
                                </div>
                            ))}
                        </div>
                        <p className="bulletin-archive-note">{alphaSeasonOne.archiveNote}</p>
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
                Shaped with player feedback during Alpha Season 1. Final season standings are not yet archived.
            </footer>
        </div>
    );
};

export default BulletinView;
