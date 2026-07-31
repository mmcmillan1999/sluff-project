// frontend/src/hooks/useTurnNudge.js
import { useEffect, useRef, useState } from 'react';

export const NUDGE_AT_MS = 5000;
export const URGENT_AT_MS = 15000;
// How often, at most, to tell the server this player is still interacting.
export const ACTIVITY_PING_MS = 8000;
const TICK_MS = 250;

// Escalation levels: 0 calm, 1 nudge, 2 urgent.
//
// The trigger is idle time, not elapsed turn time. A player who is dragging a
// card around the felt plainly knows the action is on them — yelling at them
// would be worse than saying nothing — so any real input restarts the clock.
// The player we are actually chasing is the one who has stopped touching the
// screen because they never noticed the turn passed to them.
//
// The same inputs feed two more things:
//
//   onActivity — a throttled sign-of-life the server uses to extend the AFK
//   auto-play window. The server can only see completed actions, so without
//   this, "idle" silently meant "elapsed turn time" and a player thinking
//   through a hard trick got auto-played mid-thought.
//
//   afkSecondsLeft — a countdown to the server's auto-play deadline, so the
//   backstop is predictable instead of a surprise. It is anchored to
//   max(server deadline, local last input + window): the server extends its
//   clock on our pings without rebroadcasting, so the local anchor is what
//   keeps the display honest between broadcasts.
//
// One interval polls instead of several timers so that input can reset the
// clock without re-running the effect (and without re-rendering the table on
// every tap, which would fight the card physics engine mid-drag).
export const useTurnNudge = ({
    actionKey,
    onEscalate,
    onActivity,
    afkDeadline = null,
    afkTimeoutMs = null,
} = {}) => {
    const [state, setState] = useState({ level: 0, afkSecondsLeft: null });
    const escalateRef = useRef(onEscalate);
    const activityRef = useRef(onActivity);
    // Refreshed every render so broadcasts reach the tick without re-running
    // the effect (which would wrongly reset the idle clock).
    const afkRef = useRef({ deadline: null, timeoutMs: null });

    useEffect(() => {
        escalateRef.current = onEscalate;
        activityRef.current = onActivity;
    });
    afkRef.current = { deadline: afkDeadline, timeoutMs: afkTimeoutMs };

    useEffect(() => {
        setState({ level: 0, afkSecondsLeft: null });
        if (!actionKey) return undefined;

        let lastInputAt = Date.now();
        let lastPingAt = 0;
        // The last moment the SERVER's clock provably moved: the effect start
        // (the server arms within a heartbeat of the turn changing) or our most
        // recent ping. Anchoring the countdown to raw inputs overstated the
        // remaining time by up to a full throttle window, because inputs the
        // throttle swallowed never reached the server.
        let lastServerAnchor = Date.now();
        let shownLevel = 0;
        let shownSeconds = null;

        const restart = () => {
            lastInputAt = Date.now();
            if (shownLevel !== 0) {
                shownLevel = 0;
                setState(previous => ({ ...previous, level: 0 }));
            }
            if (lastInputAt - lastPingAt >= ACTIVITY_PING_MS) {
                lastPingAt = lastInputAt;
                lastServerAnchor = lastInputAt;
                activityRef.current?.();
            }
        };

        const inputs = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
        const options = { capture: true, passive: true };
        inputs.forEach(type => window.addEventListener(type, restart, options));

        const tick = setInterval(() => {
            const now = Date.now();
            const idleMs = now - lastInputAt;
            const nextLevel = idleMs >= URGENT_AT_MS ? 2 : (idleMs >= NUDGE_AT_MS ? 1 : 0);

            const { deadline, timeoutMs } = afkRef.current;
            let afkSecondsLeft = null;
            // Published only while the nudge shows: computing it every second at
            // level 0 forced a render per second on a calm table for a number
            // nothing displays.
            if (nextLevel > 0 && Number.isFinite(timeoutMs) && timeoutMs > 0) {
                const localDeadline = lastServerAnchor + timeoutMs;
                const serverDeadline = Number.isFinite(deadline) ? deadline : 0;
                afkSecondsLeft = Math.max(
                    0,
                    Math.ceil((Math.max(serverDeadline, localDeadline) - now) / 1000),
                );
            }

            if (nextLevel === shownLevel && afkSecondsLeft === shownSeconds) return;
            const levelRose = nextLevel !== shownLevel && nextLevel > 0;
            shownLevel = nextLevel;
            shownSeconds = afkSecondsLeft;
            setState({ level: nextLevel, afkSecondsLeft });
            // Sound and haptics fire once per level, never per frame.
            if (levelRose) escalateRef.current?.(nextLevel);
        }, TICK_MS);

        return () => {
            clearInterval(tick);
            inputs.forEach(type => window.removeEventListener(type, restart, options));
        };
    }, [actionKey]);

    return state;
};

export default useTurnNudge;
