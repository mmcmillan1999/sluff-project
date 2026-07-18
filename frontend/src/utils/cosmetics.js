// frontend/src/utils/cosmetics.js
// Player-selected cosmetic loadout: deck skins and the trump-broken effect.
// Everything is free and unlocked during alpha; ownership gates bolt on
// later without changing this API. Selections persist per device in
// localStorage and broadcast a window event so any mounted component
// (table, store, previews) re-renders on a swap.

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'sluff_cosmetics';
const CHANGE_EVENT = 'sluff:cosmetics-changed';

export const DECK_SKINS = [
    {
        id: 'classic',
        name: 'Sluff Classic',
        description: 'The house deck — deep navy and gold.',
    },
    {
        id: 'mcmillan',
        name: 'McMillan Crest',
        description: 'Clan claymore and motto over dress-tartan gold.',
    },
];

export const TRUMP_BROKEN_FX = [
    {
        id: 'lightning',
        name: 'Lightning Strike',
        description: 'The classic golden banner, flanked by bolts.',
    },
    {
        id: 'shatter',
        name: 'Shatterglass',
        description: 'Trump smashes through the table like plate glass.',
    },
];

const DEFAULTS = Object.freeze({
    deckSkin: 'classic',
    trumpBrokenFx: 'lightning',
});

const VALID_VALUES = {
    deckSkin: new Set(DECK_SKINS.map(skin => skin.id)),
    trumpBrokenFx: new Set(TRUMP_BROKEN_FX.map(fx => fx.id)),
};

export const getCosmetics = () => {
    let stored = null;
    try {
        stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
    } catch {
        // Corrupt JSON or a locked-down webview: fall back to defaults.
    }
    const merged = { ...DEFAULTS };
    if (stored && typeof stored === 'object') {
        for (const key of Object.keys(DEFAULTS)) {
            if (VALID_VALUES[key].has(stored[key])) merged[key] = stored[key];
        }
    }
    return merged;
};

export const setCosmetic = (key, value) => {
    if (!VALID_VALUES[key]?.has(value)) return getCosmetics();
    const next = { ...getCosmetics(), [key]: value };
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
        // Storage may be denied; the in-session event still applies the swap.
    }
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: next }));
    return next;
};

export const useCosmetics = () => {
    const [cosmetics, setCosmetics] = useState(getCosmetics);

    useEffect(() => {
        const sync = () => setCosmetics(getCosmetics());
        window.addEventListener(CHANGE_EVENT, sync);
        window.addEventListener('storage', sync);
        return () => {
            window.removeEventListener(CHANGE_EVENT, sync);
            window.removeEventListener('storage', sync);
        };
    }, []);

    return cosmetics;
};
