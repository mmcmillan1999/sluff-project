'use strict';

// One account, one live client.
//
// Two signed-in clients on one account (laptop + phone, a second tab, PWA +
// Safari) used to fight: every connect took the seat, the other client was
// rejected on its next action, cycled its socket and took the seat back —
// forever, dropping the tournament voice room on every swap. Sept 16 2026:
// one player logged 211 socket swaps in an hour that way.
//
// The rule here is the one chat and poker clients use: the client the player
// deliberately opened is the session, and every other client is put down
// until the player picks it up again ("Play here"). What makes it hold is
// telling a deliberate open from a machine reconnecting on its own:
//
//   claim  — a visible page load, a login, or the "Play here" button.
//            Always wins and displaces every other client.
//   resume — everything automatic: Socket.IO's reconnect, the foreground
//            cycle, the seat-reclaim cycle, a background reload. Never
//            displaces a live client it does not own; it is parked instead.
//
// The owner is the client that last claimed. Its own resume still wins for
// OWNER_GRACE_MS after it drops, so a phone coming back from a network blip
// takes its seat back from a laptop that woke up during the gap.
//
// A socket with no clientId is a build from before this existed. It keeps
// the old newest-wins behaviour untouched (clients update themselves within
// minutes of a deploy), and a modern client treats it as just another
// client to displace.

const OWNER_GRACE_MS = 2 * 60 * 1000;
const OWNER_PRUNE_THRESHOLD = 500;
const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

function readClientSession(socket) {
    const auth = socket?.handshake?.auth;
    const clientId = typeof auth?.clientId === 'string' && CLIENT_ID_PATTERN.test(auth.clientId)
        ? auth.clientId
        : null;
    return { clientId, intent: auth?.intent === 'claim' ? 'claim' : 'resume' };
}

// Pure ruling. `others` are this account's other live sockets as
// { socketId, clientId }; `owner` is { clientId, goneAt } or null.
function arbitrate({ clientId, intent, others = [], owner = null, now = Date.now() }) {
    if (!clientId) return { verdict: 'legacy', basis: 'legacy', displace: [], owner };

    const predecessors = others.filter(other => other.clientId === clientId);
    const foreign = others.filter(other => other.clientId !== clientId);
    const standingOwner = owner && (owner.goneAt == null || now - owner.goneAt <= OWNER_GRACE_MS)
        ? owner
        : null;
    const ids = list => list.map(other => other.socketId);
    const own = { clientId, goneAt: null };

    if (intent === 'claim') {
        return { verdict: 'accept', basis: 'claim', displace: ids([...foreign, ...predecessors]), owner: own };
    }
    if (foreign.length === 0) {
        // Alone on the account. If the owner dropped moments ago this client
        // is only keeping the seat warm: the owner's return still wins.
        const keepsOwner = standingOwner && standingOwner.clientId !== clientId;
        return { verdict: 'accept', basis: 'sole', displace: ids(predecessors), owner: keepsOwner ? standingOwner : own };
    }
    if (standingOwner && standingOwner.clientId === clientId) {
        return { verdict: 'accept', basis: 'owner', displace: ids([...foreign, ...predecessors]), owner: own };
    }
    return { verdict: 'park', basis: 'active-elsewhere', displace: [], owner };
}

function createSessionRegistry({ now = () => Date.now() } = {}) {
    const owners = new Map(); // userId -> { clientId, goneAt }

    const prune = () => {
        if (owners.size <= OWNER_PRUNE_THRESHOLD) return;
        const cutoff = now() - OWNER_GRACE_MS;
        for (const [key, owner] of owners) {
            if (owner.goneAt != null && owner.goneAt < cutoff) owners.delete(key);
        }
    };

    return {
        arbitrate(userId, session, others) {
            const key = String(userId);
            const ruling = arbitrate({ ...session, others, owner: owners.get(key) || null, now: now() });
            if (ruling.verdict === 'accept' && ruling.owner) owners.set(key, ruling.owner);
            return ruling;
        },
        // The owner's last socket closed: start its grace clock.
        noteDisconnect(userId, clientId, clientStillConnected) {
            if (!clientId || clientStillConnected) return;
            const owner = owners.get(String(userId));
            if (owner && owner.clientId === clientId && owner.goneAt == null) owner.goneAt = now();
            prune();
        },
        ownerOf(userId) {
            return owners.get(String(userId)) || null;
        },
    };
}

module.exports = {
    OWNER_GRACE_MS,
    arbitrate,
    createSessionRegistry,
    readClientSession,
};
