// frontend/src/utils/clientSession.js
// One account, one live client — the browser half of
// backend/src/events/sessionArbiter.js.
//
// Every socket handshake says which client this is and whether the player
// asked for it:
//
//   clientId — this tab, kept in sessionStorage so a reload is still the same
//              client and a second tab or device is a different one.
//   intent   — 'claim' when the player deliberately opened Sluff here (a
//              visible page load, a login, the "Play here" button); 'resume'
//              for everything the machine does by itself. Only a claim may
//              take the account from another live client, which is what
//              stops a laptop left open from kicking the phone mid-hand.
//
// A client the server has put down is "parked": it makes no connection of
// its own, across reloads too, until the player taps "Play here".

const CLIENT_ID_KEY = 'sluff_client_id';
const PARKED_KEY = 'sluff_session_parked';
const AUTO_RELOAD_KEY = 'sluff_auto_reload';

// sessionStorage can throw (private windows, blocked site data); every read
// and write degrades to in-memory state for this page load.
const read = (key) => {
    try { return window.sessionStorage.getItem(key); } catch (error) { return null; }
};
const write = (key, value) => {
    try {
        if (value === null) window.sessionStorage.removeItem(key);
        else window.sessionStorage.setItem(key, value);
    } catch (error) { /* in-memory only */ }
};

const randomId = () => {
    const bytes = new Uint8Array(16);
    if (window.crypto?.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
};

let memoryClientId = null;
export function clientId() {
    if (memoryClientId) return memoryClientId;
    memoryClientId = read(CLIENT_ID_KEY);
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(memoryClientId || '')) {
        memoryClientId = randomId();
        write(CLIENT_ID_KEY, memoryClientId);
    }
    return memoryClientId;
}

let parkedReason = read(PARKED_KEY);
export const parkedAs = () => parkedReason || null;
export function setParked(reason) {
    parkedReason = reason || null;
    write(PARKED_KEY, parkedReason);
}

// The version check reloads the page by itself; the page it boots into must
// not read as the player opening Sluff.
export const markAutoReload = () => write(AUTO_RELOAD_KEY, '1');

const bootedByAutoReload = read(AUTO_RELOAD_KEY) === '1';
write(AUTO_RELOAD_KEY, null);

// A page the player is looking at when it loads is a deliberate open. A tab
// the browser restored in the background, an automatic reload, or a parked
// tab is not. The claim stays pending until a connection lands, so a retry
// after a failed first attempt still carries it.
let claimPending = !bootedByAutoReload
    && !parkedReason
    && typeof document !== 'undefined'
    && document.visibilityState === 'visible';

export const requestClaim = () => { claimPending = true; };
export const settleClaim = () => { claimPending = false; };
export const connectIntent = () => (claimPending ? 'claim' : 'resume');

// Socket.IO calls this for every connection attempt, automatic ones too.
export const socketAuthFor = (token) => (send) => send({
    token,
    clientId: clientId(),
    intent: connectIntent(),
});
