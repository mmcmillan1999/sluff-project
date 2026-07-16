import React from 'react';
import './LegalPage.css';

// TODO(owner): confirm this inbox exists before launch
const SUPPORT_EMAIL = 'support@playsluff.com';

const PrivacyPolicy = ({ onNavigate }) => {
    return (
        <div className='legal-page'>
            {/* Draft for review — not yet reviewed by a lawyer. */}
            <div className='legal-page-inner'>
                <button
                    type='button'
                    className='legal-back-button'
                    onClick={() => onNavigate('landing')}
                >
                    &larr; Back to Sluff
                </button>

                <h1>Privacy Policy</h1>
                <p className='legal-meta'>Effective date: July 16, 2026</p>
                <p className='legal-intro'>
                    This is a plain-language policy. Sluff is a free online card game made by
                    an independent developer, and we try to collect as little of your
                    information as possible — just enough to run the game. Here&apos;s exactly
                    what we collect, why, and what we do with it.
                </p>

                <h2>What we collect</h2>
                <h3>Your account</h3>
                <p>
                    When you sign up, we ask for a username, an email address, and a password.
                    Your password is never stored in readable form — we keep only a bcrypt
                    hash of it. Your email is used for account verification and password
                    resets, and that&apos;s it. We don&apos;t send marketing email.
                </p>
                <h3>Your gameplay</h3>
                <p>
                    Playing Sluff naturally creates records: your game history and results,
                    season standings, and a ledger of token wins and losses. We also store
                    chat messages you send at the table and in the lobby. If you send us
                    feedback through the in-game feedback form, we may attach a snapshot of
                    the game state so we can reproduce the problem you saw.
                </p>
                <h3>Technical stuff</h3>
                <p>
                    Like almost every website, our servers keep logs that include IP
                    addresses and timestamps. We use these for security, debugging, and
                    keeping the game running. We do not use advertising trackers or
                    third-party analytics cookies. We may use a first-party session
                    identifier to measure anonymous things like how many visitors make it
                    from the front page into a game.
                </p>

                <h2>Why we collect it</h2>
                <ul>
                    <li>To run your account and let you sign in.</li>
                    <li>To keep games, standings, and token balances accurate and fair.</li>
                    <li>To moderate chat and investigate cheating or abuse reports.</li>
                    <li>To fix bugs and improve the game.</li>
                    <li>To protect the service from attacks and misuse.</li>
                </ul>
                <p>
                    We don&apos;t sell your data. We don&apos;t share it with advertisers.
                </p>

                <h2>Who helps us run Sluff</h2>
                <p>
                    A few companies process data on our behalf, purely to host and operate
                    the game:
                </p>
                <ul>
                    <li><strong>Netlify</strong> — hosts the website you&apos;re looking at.</li>
                    <li><strong>Render</strong> — hosts the game server and our PostgreSQL database.</li>
                    <li><strong>Resend</strong> — delivers transactional emails (verification and password resets).</li>
                </ul>
                <p>Data is stored in the United States.</p>

                <h2>How long we keep things</h2>
                <p>
                    We keep your account and gameplay data while your account is active.
                    Season results may be preserved in season archives as part of the
                    game&apos;s history. If you want your account deleted, email us at{' '}
                    <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> and we&apos;ll
                    remove your account data. Server logs are kept for a limited time for
                    security and debugging, then rotated out.
                </p>

                <h2>Security</h2>
                <p>
                    Passwords are stored only as bcrypt hashes, and connections to Sluff use
                    TLS encryption. No system is perfectly secure, but we take reasonable
                    measures to protect what we hold — which, by design, isn&apos;t much.
                </p>

                <h2>Kids</h2>
                <p>
                    Sluff is not intended for children under 13, and we don&apos;t knowingly
                    collect information from them. If you&apos;re under 18, you need a parent
                    or guardian&apos;s permission to play. If you believe a child under 13 has
                    created an account, email us and we&apos;ll delete it.
                </p>

                <h2>Your choices</h2>
                <ul>
                    <li>You can play without chatting — chat is always optional.</li>
                    <li>You can request a copy of the data we hold about you.</li>
                    <li>
                        You can request account deletion any time by emailing{' '}
                        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
                    </li>
                </ul>

                <h2>Changes to this policy</h2>
                <p>
                    Sluff is in an alpha season and things change. If we change this policy,
                    we&apos;ll update the effective date above and post a notice on the site.
                    Meaningful changes won&apos;t be applied quietly.
                </p>

                <h2>Contact</h2>
                <p>
                    Questions? Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
                    A real person reads it.
                </p>

                <div className='legal-crosslink'>
                    <p>
                        You may also want to read our{' '}
                        <button
                            type='button'
                            className='legal-link-button'
                            onClick={() => onNavigate('terms')}
                        >
                            Terms of Service
                        </button>.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default PrivacyPolicy;
