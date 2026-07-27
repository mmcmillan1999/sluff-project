// frontend/src/components/game/TipsBeacon.js
// The quick-tips "i" beacon (top-left of the game header) and its tip card.
// Shows a count of tips the player hasn't dismissed yet — the catalogue
// lives in config/tips.js. Dismissals persist server-side per user (with a
// localStorage fallback for offline/harness sessions), and the dismissed
// card flies into the hamburger menu so players learn where the settings
// live for later.

import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import './TipsBeacon.css';
import { TIPS } from '../../config/tips';
import { getSeenTips, markTipSeen } from '../../services/api';
import { CARD_PLAY_STYLES, useCardPlayStyle, setCardPlayStyle } from '../../utils/playStyle';
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion';
import { useModalFocus } from '../../hooks/useModalFocus';

export const TIP_FLY_MS = 600;

// The local fallback cache is keyed per account so a shared device never
// hides another player's tips; the bare key covers harness/unauthenticated
// sessions.
const storageKeyFor = (userId) => (userId ? `sluff_tips_seen:${userId}` : 'sluff_tips_seen');

const localSeenIds = (userId) => {
    try {
        const stored = JSON.parse(window.localStorage.getItem(storageKeyFor(userId)));
        return Array.isArray(stored) ? stored.filter(id => typeof id === 'string') : [];
    } catch {
        return [];
    }
};

const rememberLocally = (userId, tipId) => {
    try {
        window.localStorage.setItem(
            storageKeyFor(userId),
            JSON.stringify([...new Set([...localSeenIds(userId), tipId])])
        );
    } catch {
        // Private browsing: the server row (or this session's state) stands.
    }
};

// One authenticated GET per page load, not one per round: the beacon lives
// in a portal that unmounts during every round-end presentation, so the
// mount effect would otherwise refetch forever. A failed fetch clears the
// cache so a later mount retries. Reconciliation of offline dismissals is
// tracked alongside so repeats within a session don't re-POST.
let seenTipsFetch = null;
const reconciledIds = new Set();
const fetchSeenTipsOnce = () => {
    if (!seenTipsFetch) {
        seenTipsFetch = Promise.resolve()
            .then(() => getSeenTips())
            .catch(error => {
                seenTipsFetch = null;
                throw error;
            });
    }
    return seenTipsFetch;
};
export const resetSeenTipsCacheForTests = () => {
    seenTipsFetch = null;
    reconciledIds.clear();
};

const TipsBeacon = ({ userId = null }) => {
    const [seenIds, setSeenIds] = useState(() => new Set(localSeenIds(userId)));
    const [open, setOpen] = useState(false);
    // { tip, dx, dy, launched } while a dismissed card flies to the menu.
    const [flight, setFlight] = useState(null);
    const cardRef = useRef(null);
    const prefersReducedMotion = usePrefersReducedMotion();
    const playStyle = useCardPlayStyle();
    // House modal-focus pattern: focus the card while it is open (not while
    // flying away), trap Tab inside, restore focus on close.
    const cardFocusRef = useModalFocus(open && !flight, '.tips-card-close');

    // The server knows what this account has dismissed on other devices;
    // merge rather than replace so a local dismissal never resurfaces. Any
    // dismissal the server missed (made offline) is pushed back up.
    useEffect(() => {
        let cancelled = false;
        fetchSeenTipsOnce()
            .then(ids => {
                if (cancelled || !Array.isArray(ids)) return;
                setSeenIds(prev => new Set([...prev, ...ids]));
                localSeenIds(userId)
                    .filter(id => !ids.includes(id) && !reconciledIds.has(id))
                    .forEach(id => {
                        reconciledIds.add(id);
                        Promise.resolve()
                            .then(() => markTipSeen(id))
                            .catch(() => reconciledIds.delete(id));
                    });
            })
            .catch(() => { /* offline or harness: local fallback stands */ });
        return () => { cancelled = true; };
    }, [userId]);

    const unseenTips = TIPS.filter(tip => !seenIds.has(tip.id));
    const currentTip = unseenTips[0] || null;
    const shownTip = flight?.tip || currentTip;

    const dismissTip = () => {
        if (!currentTip || flight) return;
        const tip = currentTip;

        rememberLocally(userId, tip.id);
        Promise.resolve()
            .then(() => markTipSeen(tip.id))
            .catch(() => { /* local fallback stands */ });
        setSeenIds(prev => new Set([...prev, tip.id]));

        // Fly the card into the hamburger so the player learns where the
        // setting lives from now on.
        const cardElement = cardRef.current;
        const menuButton = document.querySelector('.game-header-menu-btn');
        if (!cardElement || !menuButton || prefersReducedMotion) {
            setOpen(false);
            return;
        }
        const from = cardElement.getBoundingClientRect();
        const to = menuButton.getBoundingClientRect();
        setFlight({
            tip,
            dx: (to.left + to.width / 2) - (from.left + from.width / 2),
            dy: (to.top + to.height / 2) - (from.top + from.height / 2),
            launched: false,
        });
    };

    // Launch one committed frame after the flight state mounts so the
    // transition animates from the card's resting spot.
    useLayoutEffect(() => {
        if (!flight || flight.launched) return;
        if (cardRef.current) void cardRef.current.offsetWidth;
        setFlight(current => (
            current && !current.launched ? { ...current, launched: true } : current
        ));
    }, [flight]);

    useEffect(() => {
        if (!flight?.launched) return undefined;
        const timer = setTimeout(() => {
            setFlight(null);
            setOpen(false);
        }, TIP_FLY_MS);
        return () => clearTimeout(timer);
    }, [flight?.launched]);

    if (!currentTip && !flight) return null;

    const flightStyle = flight ? {
        transform: flight.launched
            ? `translate(${flight.dx}px, ${flight.dy}px) scale(0.08)`
            : 'none',
        opacity: flight.launched ? 0.1 : 1,
        transition: flight.launched
            ? `transform ${TIP_FLY_MS}ms cubic-bezier(0.55, -0.05, 0.7, 0.5), opacity ${TIP_FLY_MS}ms ease-in`
            : 'none',
    } : undefined;

    return (
        <>
            {unseenTips.length > 0 && (
                <button
                    type="button"
                    className="tips-beacon-btn"
                    aria-label={`${unseenTips.length} new tip${unseenTips.length === 1 ? '' : 's'}`}
                    aria-haspopup="dialog"
                    aria-expanded={open}
                    // Ignored mid-flight: toggling then would unmount the
                    // flying card and later remount it as a shrunken ghost.
                    onClick={() => { if (!flight) setOpen(previous => !previous); }}
                >
                    <span className="tips-beacon-i" aria-hidden="true">i</span>
                    <span className="tips-beacon-count" aria-hidden="true">{unseenTips.length}</span>
                </button>
            )}
            {open && shownTip && (
                <div
                    className={`tips-card${flight ? ' is-flying' : ''}`}
                    ref={(el) => {
                        cardRef.current = el;
                        cardFocusRef.current = el;
                    }}
                    style={flightStyle}
                    role="dialog"
                    aria-label="Quick tip"
                    onKeyDown={(event) => {
                        // Escape closes without dismissing; the tip stays unseen.
                        if (event.key === 'Escape' && !flight) setOpen(false);
                    }}
                >
                    <button
                        type="button"
                        className="tips-card-close"
                        aria-label="Dismiss tip"
                        onClick={dismissTip}
                    >
                        &times;
                    </button>
                    <p className="tips-card-eyebrow">Quick Tip</p>
                    <h4 className="tips-card-title">{shownTip.title}</h4>
                    <p className="tips-card-body">{shownTip.body}</p>
                    {shownTip.widget === 'play-style' && (
                        <div className="play-style-toggle" role="group" aria-label="Card play style">
                            {CARD_PLAY_STYLES.map(style => (
                                <button
                                    key={style.id}
                                    type="button"
                                    className={`play-style-option${playStyle === style.id ? ' selected' : ''}`}
                                    aria-pressed={playStyle === style.id}
                                    onClick={() => setCardPlayStyle(style.id)}
                                >
                                    {style.name}
                                </button>
                            ))}
                        </div>
                    )}
                    <p className="tips-card-hint">Find this later under the menu &#9776; up top.</p>
                </div>
            )}
        </>
    );
};

export default TipsBeacon;
