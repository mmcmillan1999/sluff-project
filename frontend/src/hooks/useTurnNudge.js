// frontend/src/hooks/useTurnNudge.js
import { useEffect, useRef, useState } from 'react';

export const NUDGE_AT_MS = 5000;
export const URGENT_AT_MS = 15000;
const TICK_MS = 250;

// Escalation levels: 0 calm, 1 nudge, 2 urgent.
//
// The trigger is idle time, not elapsed turn time. A player who is dragging a
// card around the felt plainly knows the action is on them — yelling at them
// would be worse than saying nothing — so any real input restarts the clock.
// The player we are actually chasing is the one who has stopped touching the
// screen because they never noticed the turn passed to them.
//
// One interval polls instead of two timers so that input can reset the clock
// without re-running the effect (and without re-rendering the table on every
// tap, which would fight the card physics engine mid-drag).
export const useTurnNudge = ({ actionKey, onEscalate }) => {
    const [level, setLevel] = useState(0);
    const escalateRef = useRef(onEscalate);

    useEffect(() => { escalateRef.current = onEscalate; });

    useEffect(() => {
        setLevel(0);
        if (!actionKey) return undefined;

        let lastInputAt = Date.now();
        let shown = 0;

        const restart = () => {
            lastInputAt = Date.now();
            if (shown !== 0) {
                shown = 0;
                setLevel(0);
            }
        };

        const inputs = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
        const options = { capture: true, passive: true };
        inputs.forEach(type => window.addEventListener(type, restart, options));

        const tick = setInterval(() => {
            const idleMs = Date.now() - lastInputAt;
            const next = idleMs >= URGENT_AT_MS ? 2 : (idleMs >= NUDGE_AT_MS ? 1 : 0);
            if (next === shown) return;
            shown = next;
            setLevel(next);
            // Sound and haptics fire once per level, never per frame.
            if (next > 0) escalateRef.current?.(next);
        }, TICK_MS);

        return () => {
            clearInterval(tick);
            inputs.forEach(type => window.removeEventListener(type, restart, options));
        };
    }, [actionKey]);

    return level;
};

export default useTurnNudge;
