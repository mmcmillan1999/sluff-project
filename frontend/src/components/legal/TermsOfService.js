import React from 'react';
import './LegalPage.css';

// TODO(owner): confirm this inbox exists before launch
const SUPPORT_EMAIL = 'support@playsluff.com';

const TermsOfService = ({ onNavigate }) => {
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

                <h1>Terms of Service</h1>
                <p className='legal-meta'>Effective date: July 16, 2026</p>
                <p className='legal-intro'>
                    This is a plain-language policy. Sluff (playsluff.com) is a free online
                    trick-taking card game run by an independent developer. By creating an
                    account or playing, you agree to these terms. They&apos;re short — please
                    actually read them.
                </p>

                <h2>The basics</h2>
                <ul>
                    <li>Sluff is free to play.</li>
                    <li>You need an account to play, and you&apos;re responsible for keeping your password to yourself.</li>
                    <li>One person per account — don&apos;t share accounts or impersonate others.</li>
                    <li>Give us accurate information when you sign up.</li>
                </ul>

                <h2>Age requirement</h2>
                {/* TODO(owner): confirm the 13+ threshold is the right one before launch. */}
                <p>
                    You must be at least 13 years old to play Sluff. If you&apos;re under 18,
                    you need permission from a parent or guardian.
                </p>

                <h2>Tokens have no cash value</h2>
                <p className='legal-callout'>
                    Sluff tokens are play money, for entertainment only. They cannot be
                    purchased with real money, and they cannot be redeemed, transferred,
                    sold, or exchanged for money or anything of value — inside or outside
                    the game. Sluff is not gambling.
                </p>
                <p>
                    You get tokens free when you sign up, you win and lose them in games,
                    and we occasionally grant more for free. That&apos;s the whole economy.
                    Tokens are a scorekeeping mechanic, not property, and you have no
                    ownership interest in them. Buying, selling, or trading tokens or
                    accounts outside the game is prohibited and may get your account
                    suspended.
                </p>

                <h2>Alpha status: things will change</h2>
                <p>
                    Sluff is in an alpha season. Features, game balance, and the token
                    economy may change at any time. Seasons may end and reset token
                    balances — when that happens, your results are preserved in the season
                    archives, but balances start fresh. Please don&apos;t get attached to a
                    number.
                </p>

                <h2>Play nice</h2>
                <p>You agree not to:</p>
                <ul>
                    <li>Cheat — including colluding with other players, using bots or automation we didn&apos;t provide, exploiting bugs, or playing multiple seats in the same game.</li>
                    <li>Harass, threaten, or abuse other players.</li>
                    <li>Post offensive, hateful, or inappropriate content in chat. Keep it civil — there are real people at the table.</li>
                    <li>Attack, probe, or interfere with the service or other players&apos; connections.</li>
                    <li>Use Sluff for anything illegal.</li>
                </ul>
                <p>
                    If you find a bug that gives an unfair advantage, tell us through the
                    feedback form instead of exploiting it. We&apos;ll be grateful; the
                    leaderboard will too.
                </p>

                <h2>Suspension and termination</h2>
                <p>
                    We may suspend or close accounts that cheat, abuse other players, post
                    offensive content, or otherwise break these terms — with or without
                    warning, depending on severity. You can close your own account any time
                    by emailing <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
                    Because tokens have no value, no compensation is owed for tokens on a
                    closed or suspended account.
                </p>

                <h2>Your content</h2>
                <p>
                    You own what you write in chat and feedback, but you give us permission
                    to store, display, and moderate it as needed to run the game. Don&apos;t
                    post anything you don&apos;t have the right to share.
                </p>

                <h2>No warranty</h2>
                <p>
                    Sluff is provided &quot;as is&quot; and &quot;as available,&quot; without
                    warranties of any kind, express or implied. It&apos;s an alpha-stage game
                    run by one person — outages, bugs, and lost connections will happen. We
                    don&apos;t promise the service will be uninterrupted, error-free, or that
                    any particular feature will stick around.
                </p>

                <h2>Limitation of liability</h2>
                <p>
                    To the maximum extent permitted by law, Sluff and its operator are not
                    liable for any indirect, incidental, special, consequential, or
                    exemplary damages arising from your use of the game — including lost
                    tokens, lost standings, or lost data. Since the game is free and tokens
                    have no value, our total liability for any claim is limited to the
                    amount you paid us to play: zero.
                </p>

                <h2>Changes to these terms</h2>
                <p>
                    We may update these terms as the game evolves. When we do, we&apos;ll
                    update the effective date above and post a notice on the site.
                    Continuing to play after a change means you accept the updated terms.
                </p>

                <h2>Governing law</h2>
                <p>
                    These terms are governed by the laws of the State of Utah, USA, without
                    regard to conflict-of-law rules.
                </p>

                <h2>Contact</h2>
                <p>
                    Questions about these terms? Email{' '}
                    <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
                </p>

                <div className='legal-crosslink'>
                    <p>
                        You may also want to read our{' '}
                        <button
                            type='button'
                            className='legal-link-button'
                            onClick={() => onNavigate('privacy')}
                        >
                            Privacy Policy
                        </button>.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default TermsOfService;
