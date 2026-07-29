// frontend/src/utils/voicePreference.js
// Whether this player has opted in to table voice chat.
//
// Defaults to OFF, and nothing may touch getUserMedia until it is on. Sitting
// down at a table used to join voice and unmute the microphone immediately,
// which fires the OS permission prompt with no explanation and goes live before
// the player has agreed to anything — an App Store 5.1.1/5.1.2 rejection, and
// the wrong thing to do to someone regardless of who is reviewing it.
//
// Persists per device in localStorage and broadcasts a window event so any
// mounted control re-renders on a change — same pattern as utils/playStyle.js.

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'sluff_voice_enabled';
const CHANGE_EVENT = 'sluff:voice-preference-changed';

export const DEFAULT_VOICE_ENABLED = false;

export const getVoiceEnabled = () => {
    let stored = null;
    try {
        stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
    } catch {
        // Corrupt JSON or a locked-down webview: stay off. Failing closed is
        // the only safe direction for a microphone.
    }
    return stored === true;
};

export const setVoiceEnabled = (value) => {
    const enabled = value === true;
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(enabled));
    } catch {
        // Storage may be denied; the in-session event still applies the change.
    }
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: enabled }));
    return enabled;
};

export const useVoiceEnabled = () => {
    const [enabled, setEnabled] = useState(getVoiceEnabled);

    useEffect(() => {
        const sync = () => setEnabled(getVoiceEnabled());
        window.addEventListener(CHANGE_EVENT, sync);
        window.addEventListener('storage', sync);
        return () => {
            window.removeEventListener(CHANGE_EVENT, sync);
            window.removeEventListener('storage', sync);
        };
    }, []);

    return enabled;
};
