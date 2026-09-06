// The tournament shot clock, drawn as a ring draining around the nameplate
// of the player on turn (Matt: "a border-changing snake timer around the
// name"). Gold while the free window runs down; when that is gone the ring
// refills red and drains again over whatever bank the seat has left.
//
// Timing is relative to when this seat's turn was first seen on this
// client, which is what the server's backstop does too (it arms on first
// sight). The server's deadline, when it arrives, corrects the end point.
import React, { useEffect, useMemo, useRef, useState } from 'react';

const PATH_LENGTH = 100;

export const ringPhaseAt = (elapsedMs, freeMs, bankMs) => {
    if (elapsedMs < freeMs || bankMs <= 0) {
        const total = Math.max(1, freeMs);
        return { phase: elapsedMs < freeMs ? 'free' : 'out', fraction: Math.min(1, Math.max(0, elapsedMs / total)) };
    }
    const inBank = elapsedMs - freeMs;
    return { phase: inBank < bankMs ? 'bank' : 'out', fraction: Math.min(1, Math.max(0, inBank / bankMs)) };
};

const TurnClockRing = ({ turnKey, freeSeconds, bankSeconds, deadlineAt = null, radius = 6 }) => {
    const startRef = useRef({ key: null, at: 0 });
    const [tick, setTick] = useState(0);
    const rectRef = useRef(null);

    const freeMs = Math.max(0, Number(freeSeconds) || 0) * 1000;
    const bankMs = Math.max(0, Number(bankSeconds) || 0) * 1000;

    // A new turn (or a new decision in the same turn) restarts the ring.
    if (startRef.current.key !== turnKey) {
        startRef.current = { key: turnKey, at: Date.now() };
    }
    // The server's deadline pins the end of the whole allowance; when it
    // says the clock started earlier than we saw it, trust the server.
    const startAt = useMemo(() => {
        const seen = startRef.current.at;
        if (!Number.isFinite(deadlineAt) || deadlineAt <= 0) return seen;
        const fromServer = deadlineAt - (freeMs + bankMs);
        return Number.isFinite(fromServer) && fromServer < seen ? fromServer : seen;
    }, [deadlineAt, freeMs, bankMs, turnKey]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        let frame = 0;
        let last = 0;
        const loop = (now) => {
            // ~10 fps is plenty for a ring; keep phones cool.
            if (now - last > 100) { last = now; setTick(t => t + 1); }
            frame = requestAnimationFrame(loop);
        };
        frame = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(frame);
    }, [turnKey]);

    const { phase, fraction } = ringPhaseAt(Date.now() - startAt, freeMs, bankMs);
    const remainingSeconds = phase === 'free'
        ? Math.ceil((freeMs - (Date.now() - startAt)) / 1000)
        : (phase === 'bank' ? Math.ceil((bankMs - (Date.now() - startAt - freeMs)) / 1000) : 0);

    return (
        <svg
            className={`turn-clock-ring is-${phase}`}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
            data-phase={phase}
            data-seconds-left={remainingSeconds}
            data-tick={tick}
        >
            <rect
                ref={rectRef}
                x="1" y="1" width="98" height="98" rx={radius} ry={radius}
                pathLength={PATH_LENGTH}
                fill="none"
                strokeDasharray={PATH_LENGTH}
                strokeDashoffset={PATH_LENGTH * fraction}
                vectorEffect="non-scaling-stroke"
            />
        </svg>
    );
};

export default TurnClockRing;
