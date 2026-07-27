// frontend/src/utils/playStyle.js
// Card play style: how a card gets from the hand onto the table.
//   'flick' — the original momentum drag-and-flick physics (the designer's cut).
//   'fast'  — click once to raise the card, click again to send it to the
//             drop spot automatically; no second click within a second and
//             the card reseats itself.
// The choice persists per device in localStorage and broadcasts a window
// event so any mounted component (hand, menu) re-renders on a swap — same
// pattern as utils/cosmetics.js.

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'sluff_card_play_style';
const CHANGE_EVENT = 'sluff:play-style-changed';

export const CARD_PLAY_STYLES = [
    {
        id: 'flick',
        name: 'Flick',
        description: 'Drag a card and flick it onto the table.',
    },
    {
        id: 'fast',
        name: 'Fast',
        description: 'Click a card to raise it, click again to play it.',
    },
];

export const DEFAULT_CARD_PLAY_STYLE = 'flick';

const VALID_STYLES = new Set(CARD_PLAY_STYLES.map(style => style.id));

export const getCardPlayStyle = () => {
    let stored = null;
    try {
        stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
    } catch {
        // Corrupt JSON or a locked-down webview: fall back to the default.
    }
    return VALID_STYLES.has(stored) ? stored : DEFAULT_CARD_PLAY_STYLE;
};

export const setCardPlayStyle = (value) => {
    if (!VALID_STYLES.has(value)) return getCardPlayStyle();
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch {
        // Storage may be denied; the in-session event still applies the swap.
    }
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: value }));
    return value;
};

export const useCardPlayStyle = () => {
    const [playStyle, setPlayStyle] = useState(getCardPlayStyle);

    useEffect(() => {
        const sync = () => setPlayStyle(getCardPlayStyle());
        window.addEventListener(CHANGE_EVENT, sync);
        window.addEventListener('storage', sync);
        return () => {
            window.removeEventListener(CHANGE_EVENT, sync);
            window.removeEventListener('storage', sync);
        };
    }, []);

    return playStyle;
};
