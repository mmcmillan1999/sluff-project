import React from 'react';
import './PublicLanding.css';

const VENUES = [
    {
        id: 'fort-creek',
        name: 'Fort Creek',
        story: 'Ranch nights in Oakley',
    },
    {
        id: 'shirecliff',
        name: 'Shirecliff',
        story: "Grandpa George's table",
    },
    {
        id: 'eaglewood',
        name: 'Eaglewood',
        story: 'Sunset over the Great Salt Lake',
    },
    {
        id: 'academy',
        name: 'The Academy',
        story: 'A welcoming place to learn',
    },
];

const PublicLanding = ({ inviteTableId, onRegister, onLogin }) => {
    const hasInvite = Boolean(inviteTableId);
    const registerLabel = hasInvite ? 'Join your table' : 'Join Alpha Season 2';

    const handleRegister = () => {
        onRegister?.();
    };

    const handleLogin = () => {
        onLogin?.();
    };

    return (
        <main className="public-landing">
            <a className="public-landing__skip" href="#public-landing-content">
                Skip to Sluff introduction
            </a>

            <header className="public-landing__header" aria-label="Sluff welcome">
                <img className="public-landing__brand" src="/SluffLogo.png" alt="Sluff" />
                <button className="public-landing__sign-in" type="button" onClick={handleLogin}>
                    Sign in
                </button>
            </header>

            <div id="public-landing-content">
                <section className="public-landing__hero" aria-labelledby="public-landing-title">
                    <div className="public-landing__hero-glow" aria-hidden="true" />
                    <div className="public-landing__hero-copy">
                        <p className="public-landing__eyebrow">
                            <span aria-hidden="true" /> Now playing · Alpha Season 2
                        </p>
                        {hasInvite && (
                            <p className="public-landing__invite" role="status">
                                <span aria-hidden="true">♣</span>
                                You have a seat waiting at a Sluff table.
                            </p>
                        )}
                        <h1 id="public-landing-title">
                            Pick your card.<br />
                            <em>Send it.</em>
                        </h1>
                        <p className="public-landing__lede">
                            Sluff is a Utah-born trick-taking game made for your phone. Read the table,
                            choose your moment, then flick your card into play.
                        </p>
                        <div className="public-landing__hero-actions">
                            <button
                                className="public-landing__button public-landing__button--primary"
                                type="button"
                                onClick={handleRegister}
                            >
                                {registerLabel}
                                <span aria-hidden="true">→</span>
                            </button>
                            <button
                                className="public-landing__button public-landing__button--quiet"
                                type="button"
                                onClick={handleLogin}
                            >
                                I already play
                            </button>
                        </div>
                        <p className="public-landing__microcopy">Free to join · Built for 3–4 players</p>
                    </div>

                    <div className="public-landing__table-scene" aria-hidden="true">
                        <div className="public-landing__table-rim">
                            <div className="public-landing__table-felt">
                                <img src="/SluffLogo.png" alt="" />
                                <span className="public-landing__card public-landing__card--one">10<span>♦</span></span>
                                <span className="public-landing__card public-landing__card--two">A<span>♣</span></span>
                                <span className="public-landing__card public-landing__card--three">K<span>♥</span></span>
                                <span className="public-landing__card public-landing__card--flick">Q<span>♠</span></span>
                            </div>
                        </div>
                        <p>Every card is played with intention.</p>
                    </div>
                </section>

                <section className="public-landing__promises" aria-label="What makes Sluff special">
                    <article>
                        <span className="public-landing__promise-number">01</span>
                        <h2>Made for touch</h2>
                        <p>Cards feel physical. Lift one, reconsider, or commit with a satisfying flick.</p>
                    </article>
                    <article>
                        <span className="public-landing__promise-number">02</span>
                        <h2>Play the people</h2>
                        <p>Bidding, teams, trump, and risk turn every hand into a conversation.</p>
                    </article>
                    <article>
                        <span className="public-landing__promise-number">03</span>
                        <h2>Leave your mark</h2>
                        <p>Climb the Alpha Season 2 standings and build a history with your rivals.</p>
                    </article>
                </section>

                <section className="public-landing__venues" aria-labelledby="public-landing-venues-title">
                    <div className="public-landing__section-heading">
                        <p className="public-landing__eyebrow">Four tables · Four stories</p>
                        <h2 id="public-landing-venues-title">Every game has a sense of place.</h2>
                        <p>
                            Sluff grew around real family tables. Each venue carries a little of that
                            history into the game.
                        </p>
                    </div>
                    <div className="public-landing__venue-strip">
                        {VENUES.map((venue) => (
                            <article
                                className={`public-landing__venue public-landing__venue--${venue.id}`}
                                key={venue.id}
                            >
                                <div>
                                    <h3>{venue.name}</h3>
                                    <p>{venue.story}</p>
                                </div>
                            </article>
                        ))}
                    </div>
                </section>

                <section className="public-landing__academy" aria-labelledby="public-landing-academy-title">
                    <div className="public-landing__academy-art" aria-hidden="true">
                        <span>ABC</span>
                        <img src="/assets/themes/academy-apple.svg" alt="" />
                        <span>1 2 3</span>
                    </div>
                    <div className="public-landing__academy-copy">
                        <p className="public-landing__eyebrow">New to Sluff?</p>
                        <h2 id="public-landing-academy-title">Take your first seat at the Academy.</h2>
                        <p>
                            A guided game introduces the table one decision at a time. You can replay it
                            whenever you want a refresher, then head to the live tables when you are ready.
                        </p>
                        <button
                            className="public-landing__text-button"
                            type="button"
                            onClick={handleRegister}
                        >
                            Start with a guided game <span aria-hidden="true">→</span>
                        </button>
                    </div>
                </section>

                <section className="public-landing__alpha" aria-labelledby="public-landing-alpha-title">
                    <p className="public-landing__eyebrow">An open invitation</p>
                    <h2 id="public-landing-alpha-title">Help shape the game.</h2>
                    <p>
                        Sluff is in alpha: the game is playable, the competition is real, and the experience
                        is still evolving. Your feedback helps decide what gets refined next. Season records
                        are preserved, while balance, features, and the token economy may change as we learn.
                    </p>
                </section>

                <section className="public-landing__final" aria-labelledby="public-landing-final-title">
                    <img src="/SluffLogo.png" alt="" aria-hidden="true" />
                    <p className="public-landing__eyebrow">
                        {hasInvite ? 'Your table is ready' : 'Alpha Season 2 is underway'}
                    </p>
                    <h2 id="public-landing-final-title">
                        {hasInvite ? 'Your seat is waiting.' : 'The next hand starts with you.'}
                    </h2>
                    <button
                        className="public-landing__button public-landing__button--primary"
                        type="button"
                        onClick={handleRegister}
                    >
                        {registerLabel}
                        <span aria-hidden="true">→</span>
                    </button>
                    <button className="public-landing__footer-login" type="button" onClick={handleLogin}>
                        Already have an account? Sign in
                    </button>
                </section>
            </div>
        </main>
    );
};

export default PublicLanding;
