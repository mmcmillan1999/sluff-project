import React, { useEffect, useRef, useState } from 'react';
import CardValueKey from './game/CardValueKey';
import { BID_HIERARCHY, BID_MULTIPLIERS } from '../constants';
import { TUTORIAL_BUY_IN_LABEL } from '../config/tutorial';
import './HowToPlayModal.css';

const BID_DETAILS = {
    Frog: 'Hearts are trump. Take the three-card widow, then discard three cards.',
    Solo: 'Choose diamonds, clubs, or spades as trump. The widow points belong to the bidder.',
    'Heart Solo': 'Hearts are trump. The last-trick winner also wins the widow points.'
};

const FOCUSABLE = [
    'button:not([disabled])',
    '[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
].join(',');

const HowToPlayModal = ({ show, onClose, returnFocusSelector, onStartGuidedGame }) => {
    const dialogRef = useRef(null);
    const closeButtonRef = useRef(null);
    const previousFocusRef = useRef(null);
    const guidedPendingRef = useRef(false);
    const [guidedPending, setGuidedPending] = useState(false);
    const [guidedError, setGuidedError] = useState('');

    useEffect(() => {
        guidedPendingRef.current = guidedPending;
    }, [guidedPending]);

    useEffect(() => {
        if (show) return;
        setGuidedPending(false);
        setGuidedError('');
    }, [show]);

    useEffect(() => {
        if (!show) return undefined;
        previousFocusRef.current = document.activeElement;
        closeButtonRef.current?.focus();

        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                if (!guidedPendingRef.current) onClose();
                return;
            }
            if (event.key !== 'Tab' || !dialogRef.current) return;

            const focusable = [...dialogRef.current.querySelectorAll(FOCUSABLE)];
            if (!focusable.length) {
                event.preventDefault();
                dialogRef.current.focus();
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            if (previousFocusRef.current?.isConnected && previousFocusRef.current !== document.body) previousFocusRef.current.focus?.();
            else if (returnFocusSelector) document.querySelector(returnFocusSelector)?.focus?.();
        };
    }, [show, onClose, returnFocusSelector]);

    if (!show) return null;

    const bids = BID_HIERARCHY.filter(bid => bid !== 'Pass');
    const startGuidedGame = async () => {
        if (!onStartGuidedGame || guidedPending) return;
        setGuidedPending(true);
        setGuidedError('');
        try {
            await onStartGuidedGame();
            onClose();
        } catch (error) {
            setGuidedError(error?.message || 'Could not open the guided game. Please try again.');
            setGuidedPending(false);
        }
    };

    return (
        <div
            className="how-to-play-overlay"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget && !guidedPending) onClose();
            }}
        >
            <section
                ref={dialogRef}
                className="how-to-play-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="how-to-play-title"
                aria-describedby="how-to-play-intro"
                tabIndex={-1}
            >
                <header className="how-to-play-header">
                    <div>
                        <p className="how-to-play-eyebrow">Sluff rules</p>
                        <h2 id="how-to-play-title">How to Play</h2>
                    </div>
                    <button ref={closeButtonRef} type="button" className="how-to-play-close" onClick={onClose} aria-label="Close How to Play" disabled={guidedPending}>×</button>
                </header>

                <div className="how-to-play-content">
                    <p id="how-to-play-intro" className="rules-lede">
                        Win tricks, collect card points, and manage the risk of being the bidder. Every round has 120 card points in play; 60 is the bidder's break-even target.
                    </p>

                    <section className="rules-section">
                        <h3>The three-player round</h3>
                        <ol>
                            <li>Deal 11 cards to each player and three cards to the widow.</li>
                            <li>Bid in order: Pass, Frog, Solo, then Heart Solo. The highest bid becomes the bidder.</li>
                            <li>Play 11 tricks. The trick winner leads the next trick.</li>
                            <li>Count card points. More than 60 succeeds, fewer than 60 fails, and exactly 60 exchanges no score.</li>
                        </ol>
                        <p>Round score movement is the bidder's distance from 60 multiplied by the bid multiplier. A game ends when a score reaches zero or below; the highest remaining score wins.</p>
                    </section>

                    <section className="rules-section">
                        <h3>Bids and risk</h3>
                        <div className="rules-bid-list">
                            {bids.map(bid => (
                                <div className="rules-bid-row" key={bid}>
                                    <strong>{bid} <span>{BID_MULTIPLIERS[bid]}×</span></strong>
                                    <p>{BID_DETAILS[bid]}</p>
                                </div>
                            ))}
                        </div>
                    </section>

                    <section className="rules-section">
                        <h3>Following suit, trump, and sluffing</h3>
                        <ul>
                            <li>Follow the led suit whenever you can.</li>
                            <li>If you cannot follow suit, you must play trump when you have it.</li>
                            <li>If you have neither the led suit nor trump, you may sluff any card.</li>
                            <li>You cannot lead trump until trump has been broken, unless your hand contains only trump.</li>
                        </ul>
                        <p>Highest trump wins; otherwise, the highest card of the led suit wins. To play, deliberately flick a legal card toward the center. A card that is not truly thrown settles back into your hand.</p>
                    </section>

                    <section className="rules-section">
                        <h3>Four-player difference</h3>
                        <p>The dealer sits out each round, leaving the same active trio and 11-trick structure. The dealer may peek at the widow, then rotates back into play on the next round.</p>
                    </section>

                    <section className="rules-section insurance-rules-section">
                        <h3>Insurance, in plain English</h3>
                        <p>Insurance lets the active trio replace an uncertain trick result with a known point agreement. The bidder sets an <strong>ask</strong>; each defender sets an <strong>offer</strong>. Positive offers pay the bidder, while negative offers ask the bidder to pay that defender.</p>
                        <p><strong>Deal gap = bidder ask − combined defender offers.</strong> When the gap reaches zero or less, the deal locks. At round end, the agreed amounts are used instead of the normal trick-based score exchange.</p>
                    </section>

                    <section className="rules-section card-points-section">
                        <h3>Card point values</h3>
                        <CardValueKey defaultExpanded embedded />
                    </section>
                </div>

                <footer className={`how-to-play-footer${onStartGuidedGame ? ' has-guided-action' : ''}`}>
                    {onStartGuidedGame && (
                        <div className="how-to-play-guided-action">
                            <div>
                                <strong>Want hands-on help?</strong>
                                <span>Replay the guided Academy game · {TUTORIAL_BUY_IN_LABEL} coin</span>
                                {guidedError && <span className="how-to-play-guided-error" role="alert">{guidedError}</span>}
                            </div>
                            <button
                                type="button"
                                className="game-button how-to-play-guided-button"
                                onClick={startGuidedGame}
                                disabled={guidedPending}
                            >
                                {guidedPending ? 'Opening Academy…' : 'Play Guided Game'}
                            </button>
                        </div>
                    )}
                    <button type="button" className="game-button" onClick={onClose} disabled={guidedPending}>Back to Sluff</button>
                </footer>
            </section>
        </div>
    );
};

export default HowToPlayModal;
