// frontend/src/utils/micPermission.js
// Device-level memory of a microphone the browser refused to hand over.
//
// Why remember it ourselves: Safari deliberately reports
// permissions.query({name:'microphone'}) as 'prompt' even when the player has
// persistently denied (an anti-fingerprinting measure), so a remembered denial
// is only observable as the NotAllowedError from getUserMedia itself. And on
// iOS the capture attempt is not free — showing the prompt seizes the page's
// audio session and parks every AudioContext in WebKit's 'interrupted' state,
// which is how a blocked microphone was cutting off ALL game sound on every
// table entry.
//
// The flag gates only the AUTOMATIC unmute that runs when a table is joined
// with voice enabled. A deliberate tap on the mic button (or on 'Turn on
// voice') always tries again, and only a capture that actually succeeds
// clears the flag.

const STORAGE_KEY = 'sluff_mic_capture_refused';

export const getMicCaptureRefused = () => {
    try {
        return window.localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
        return false;
    }
};

export const rememberMicCaptureRefused = () => {
    try {
        window.localStorage.setItem(STORAGE_KEY, 'true');
    } catch {
        // Storage denied: worst case the auto-unmute keeps trying, which is
        // the pre-fix behavior, not a new failure.
    }
};

export const clearMicCaptureRefused = () => {
    try {
        window.localStorage.removeItem(STORAGE_KEY);
    } catch {
        // Best effort.
    }
};

// 'granted' | 'denied' | 'prompt' | 'unknown'. Chrome/Firefox report real
// states; Safari 16+ answers but masks denial as 'prompt'; older browsers and
// locked-down webviews land in 'unknown'.
const queryMicPermission = async () => {
    try {
        const status = await navigator.permissions?.query?.({ name: 'microphone' });
        return status?.state || 'unknown';
    } catch {
        return 'unknown';
    }
};

// Whether the voice auto-join may attempt getUserMedia on this device. A
// reported 'denied' is authoritative. A reported 'granted' is NOT: it only
// covers the site-level permission, and an OS-level block (Windows privacy
// toggle, macOS TCC) fails capture forever while the query keeps saying
// granted — letting 'granted' clear the flag turned that into a doomed
// attempt plus an error banner at every table. So once set, only an actual
// capture success clears the flag, and the mic button is the retry path.
export const shouldAutoUnmuteMicrophone = async () => {
    const state = await queryMicPermission();
    if (state === 'denied') {
        rememberMicCaptureRefused();
        return false;
    }
    return !getMicCaptureRefused();
};
