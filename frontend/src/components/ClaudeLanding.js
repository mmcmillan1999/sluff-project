import React, { useEffect, useRef } from 'react';
import LandingCardPhysics from '../utils/LandingCardPhysics.js';
import { trackEvent } from '../services/api.js';
import './ClaudeLanding.css';

const VENUES = [
    {
        id: 'fort-creek',
        name: 'Fort Creek',
        eyebrow: 'Oakley ranch nights',
        description: 'Cowhide, leather, and campfire cards.',
        image: '/assets/themes/fort-creek-lobby-v2.webp',
        alt: 'The Fort Creek venue, a rustic ranch card room',
    },
    {
        id: 'shirecliff',
        name: 'Shirecliff',
        eyebrow: 'Grandpa George’s table',
        description: 'Dark walnut and old-school polish.',
        image: '/assets/themes/shirecliff-lobby-v2.webp',
        alt: 'The Shirecliff venue, an elegant walnut card room',
    },
    {
        id: 'eaglewood',
        name: 'Eaglewood',
        eyebrow: 'Above the Great Salt Lake',
        description: 'Deck games at sunset.',
        image: '/assets/themes/eaglewood-lobby-v2.webp',
        alt: 'The Eaglewood venue, a sunset deck overlooking the Great Salt Lake',
    },
    {
        id: 'academy',
        name: 'The Academy',
        eyebrow: 'Miss Paul’s classroom',
        description: 'Learn the game on the green felt, with a coach at your side.',
        image: '/assets/themes/academy-lobby-v2.webp',
        alt: 'The Academy venue, a friendly classroom card table for beginners',
        badge: 'Beginners start here',
    },
];

const FEATURES = [
    {
        id: 'physics',
        icon: '→',
        title: 'Cards you actually throw',
        body: 'No tap-to-play here. Drag, aim, and flick — every card carries real momentum, '
            + 'spins through the air, and settles onto the felt the way it should.',
    },
    {
        id: 'full-table',
        icon: '♟',
        title: 'Always a full table',
        body: 'Quick Play deals you in within seconds, day or night. No waiting around '
            + 'for a fourth — the chairs fill fast and the game gets going.',
    },
    {
        id: 'live',
        icon: '●',
        title: 'Live with friends',
        body: 'Private tables, invite links, and real-time play on any phone or laptop. '
            + 'Nothing to download.',
    },
];

const STEPS = [
    {
        number: '1',
        title: 'Bid for trump',
        body: 'Frog, Solo, or Heart Solo. The boldest bid wins the round — and plays alone '
            + 'against the rest of the table.',
    },
    {
        number: '2',
        title: 'Fight for 60',
        body: 'Every round holds 120 card points. The bidder needs more than 60 to get paid; '
            + 'the defenders team up to stop them.',
    },
    {
        number: '3',
        title: 'Or cut a deal',
        body: 'Mid-round insurance lets both sides negotiate a payout before the last trick '
            + 'falls. Read the table. Take the money. Or don’t.',
    },
];

const HAND_CARDS = [
    { rank: 'A', suit: '♥', red: true },
    { rank: '10', suit: '♦', red: true },
    { rank: 'K', suit: '♠', red: false },
    { rank: 'Q', suit: '♣', red: false },
];

const ClaudeLanding = ({ inviteTableId, onRegister, onLogin, onNavigate }) => {
    const invited = Boolean(inviteTableId);
    const primaryCta = invited ? 'Join your friend’s table' : 'Play free now';
    const heroHandRef = useRef(null);

    const handleRegisterCta = () => {
        trackEvent('landing_cta_click');
        onRegister?.();
    };

    useEffect(() => {
        trackEvent('landing_view');
    }, []);

    useEffect(() => {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
        if (!heroHandRef.current) return undefined;
        const physics = new LandingCardPhysics();
        heroHandRef.current.querySelectorAll('.cl-hand-card').forEach((cardEl) => {
            physics.register(cardEl, cardEl.parentElement);
        });
        return () => physics.destroy();
    }, []);

    return (
        <div className="claude-landing">
            <a className="cl-skip-link" href="#cl-main">Skip to content</a>

            <header className="cl-header">
                <img className="cl-header-logo" src="/SluffLogo.png" alt="Sluff" />
                <button type="button" className="cl-btn cl-btn-ghost" onClick={onLogin}>
                    Sign in
                </button>
            </header>

            <main id="cl-main">
                <section className="cl-hero" aria-labelledby="cl-hero-title">
                    <div className="cl-hero-inner">
                        <div className="cl-hero-copy">
                            {invited ? (
                                <p className="cl-invite-banner" role="status">
                                    <strong>You’re invited.</strong> A friend saved you a seat
                                    at their Sluff table — create a free account and jump in.
                                </p>
                            ) : (
                                <p className="cl-eyebrow">Free to play · Alpha Season 2 is live</p>
                            )}
                            <h1 id="cl-hero-title" className="cl-hero-title">
                                The card game you don’t play.
                                <span className="cl-hero-title-accent"> You throw it.</span>
                            </h1>
                            <p className="cl-hero-sub">
                                Sluff is a fast four-player game of bidding, trump, and table talk
                                — passed down through a Utah family for generations, now live
                                online with real card-flinging physics.
                            </p>
                            <div className="cl-cta-row">
                                <button type="button" className="cl-btn cl-btn-primary" onClick={handleRegisterCta}>
                                    {primaryCta}
                                </button>
                                <button type="button" className="cl-btn cl-btn-secondary" onClick={onLogin}>
                                    I have an account
                                </button>
                            </div>
                            <ul className="cl-trust-row" aria-label="Why it costs you nothing to try">
                                <li>No download</li>
                                <li>Free tokens to start</li>
                                <li>A game in under a minute</li>
                            </ul>
                        </div>

                        <div className="cl-hero-visual" aria-hidden="true">
                            <div className="cl-flying-card">
                                <span className="cl-card-corner cl-card-red">J<em>♥</em></span>
                                <span className="cl-card-pip cl-card-red">♥</span>
                            </div>
                            <div className="cl-hero-hand" ref={heroHandRef}>
                                {HAND_CARDS.map((card, index) => (
                                    <div key={card.rank + card.suit} className="cl-hand-slot">
                                        <div className={'cl-hand-card cl-hand-card-' + (index + 1)}>
                                            <span className={'cl-card-corner' + (card.red ? ' cl-card-red' : '')}>
                                                {card.rank}<em>{card.suit}</em>
                                            </span>
                                            <span className={'cl-card-pip' + (card.red ? ' cl-card-red' : '')}>
                                                {card.suit}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <p className="cl-hand-hint">Go on — grab a card and throw it.</p>
                        </div>
                    </div>
                </section>

                <section className="cl-features" aria-labelledby="cl-features-title">
                    <h2 id="cl-features-title" className="cl-section-title">
                        Built for thumbs, not mouse clicks
                    </h2>
                    <div className="cl-features-grid">
                        {FEATURES.map((feature) => (
                            <article key={feature.id} className="cl-feature-card">
                                <span className="cl-feature-icon" aria-hidden="true">{feature.icon}</span>
                                <h3>{feature.title}</h3>
                                <p>{feature.body}</p>
                            </article>
                        ))}
                    </div>
                </section>

                <section className="cl-how" aria-labelledby="cl-how-title">
                    <h2 id="cl-how-title" className="cl-section-title">
                        A round of Sluff in thirty seconds
                    </h2>
                    <ol className="cl-steps">
                        {STEPS.map((step) => (
                            <li key={step.number} className="cl-step">
                                <span className="cl-step-number" aria-hidden="true">{step.number}</span>
                                <div>
                                    <h3>{step.title}</h3>
                                    <p>{step.body}</p>
                                </div>
                            </li>
                        ))}
                    </ol>
                    <p className="cl-how-footnote">
                        New to trick-taking games? The Academy walks you through your first hand,
                        card by card — or read the <a className="cl-inline-link" href="/rules/">full
                        Sluff rules</a> first.
                    </p>
                </section>

                <section className="cl-venues" aria-labelledby="cl-venues-title">
                    <h2 id="cl-venues-title" className="cl-section-title">
                        Four tables, one family story
                    </h2>
                    <p className="cl-venues-lede">
                        Sluff was born at a Utah kitchen table. The venues are the family’s
                        real haunts — pick where you want to sit.
                    </p>
                    <div className="cl-venues-grid">
                        {VENUES.map((venue) => (
                            <article key={venue.id} className="cl-venue-card">
                                <div className="cl-venue-media">
                                    <img src={venue.image} alt={venue.alt} loading="lazy" />
                                    {venue.badge && (
                                        <span className="cl-venue-badge">{venue.badge}</span>
                                    )}
                                </div>
                                <div className="cl-venue-body">
                                    <p className="cl-venue-eyebrow">{venue.eyebrow}</p>
                                    <h3>{venue.name}</h3>
                                    <p className="cl-venue-desc">{venue.description}</p>
                                </div>
                            </article>
                        ))}
                    </div>
                </section>

                <section className="cl-season" aria-labelledby="cl-season-title">
                    <div className="cl-season-inner">
                        <img
                            className="cl-season-token"
                            src="/Sluff_Token_v2.webp"
                            alt="A Sluff game token"
                        />
                        <div className="cl-season-copy">
                            <p className="cl-eyebrow cl-eyebrow-dark">Alpha Season 2</p>
                            <h2 id="cl-season-title" className="cl-section-title cl-section-title-left">
                                The season is live. The leaderboard is real.
                            </h2>
                            <p>
                                Every table plays for tokens — free to earn, never bought,
                                and worth nothing but bragging rights. Every win moves you up
                                the season standings. Season 1’s champions are already in the
                                archive; Season 2 is being written right now, one trick at a time.
                            </p>
                        </div>
                    </div>
                </section>

                <section className="cl-final" aria-labelledby="cl-final-title">
                    <h2 id="cl-final-title" className="cl-final-title">
                        {invited ? 'Your friend is waiting.' : 'Your seat is open.'}
                    </h2>
                    <p className="cl-final-sub">
                        Free account, free tokens, full table. You could be flicking cards in
                        under a minute.
                    </p>
                    <button type="button" className="cl-btn cl-btn-primary cl-btn-big" onClick={handleRegisterCta}>
                        {primaryCta}
                    </button>
                </section>
            </main>

            <footer className="cl-footer">
                <img className="cl-footer-logo" src="/SluffLogo.png" alt="Sluff" />
                <p>A family card game, brought online. © {new Date().getFullYear()} playsluff.com</p>
                <p className="cl-footer-disclaimer">
                    Sluff tokens are play money — they have no cash value and can’t be
                    bought, sold, or redeemed.
                </p>
                <div className="cl-footer-links">
                    <button type="button" className="cl-link-btn" onClick={handleRegisterCta}>
                        Create account
                    </button>
                    <button type="button" className="cl-link-btn" onClick={onLogin}>
                        Sign in
                    </button>
                    <a className="cl-link-btn" href="/rules/">
                        How to Play
                    </a>
                    <button type="button" className="cl-link-btn" onClick={() => onNavigate?.('terms')}>
                        Terms
                    </button>
                    <button type="button" className="cl-link-btn" onClick={() => onNavigate?.('privacy')}>
                        Privacy
                    </button>
                </div>
            </footer>
        </div>
    );
};

export default ClaudeLanding;
