import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    buildDealSequence,
    DEAL_CARD_FLIGHT_MS,
    DEAL_CARD_STAGGER_MS,
} from './dealSequence';
import './DealAnimation.css';

const CARD_HEIGHT_RATIO = 0.06;
const CARD_ASPECT_RATIO = 0.714;
const TRICK_EASING = [0.45, 0.05, 0.4, 1];
const MOTION_SAMPLE_TIMES = [0, 0.16, 0.32, 0.5, 0.68, 0.84, 1];

const centerOf = (element) => {
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    if (!Number.isFinite(rect.left) || !Number.isFinite(rect.top)) return null;
    return {
        x: rect.left + (rect.width / 2),
        y: rect.top + (rect.height / 2),
    };
};

const findPlayerTarget = (scope, playerName) => (
    Array.from(scope.querySelectorAll('[data-deal-player]'))
        .find((element) => element.dataset.dealPlayer === playerName) || null
);

const findTarget = (scope, step, localPlayerName) => {
    if (step.type === 'widow') {
        return {
            element: scope.querySelector('[data-deal-target="widow"]'),
            destination: 'widow',
        };
    }

    if (step.playerName === localPlayerName) {
        return {
            element: scope.querySelector('[data-deal-target="local-hand"]'),
            destination: 'local-hand',
        };
    }

    return {
        element: findPlayerTarget(scope, step.playerName),
        destination: step.playerName,
    };
};

const cubicBezierCoordinate = (time, firstControl, secondControl) => {
    const inverse = 1 - time;
    return (3 * inverse * inverse * time * firstControl)
        + (3 * inverse * time * time * secondControl)
        + (time * time * time);
};

// Convert wall-clock progress to the same weighted progress used by the
// trick-collection magnet: cubic-bezier(0.45, 0.05, 0.4, 1).
const trickEaseProgress = (time) => {
    if (time <= 0 || time >= 1) return time;
    const [x1, y1, x2, y2] = TRICK_EASING;
    let low = 0;
    let high = 1;

    for (let iteration = 0; iteration < 14; iteration += 1) {
        const candidate = (low + high) / 2;
        const x = cubicBezierCoordinate(candidate, x1, x2);
        if (x < time) low = candidate;
        else high = candidate;
    }

    return cubicBezierCoordinate((low + high) / 2, y1, y2);
};

const quadraticPoint = (source, control, target, progress) => {
    const inverse = 1 - progress;
    return {
        x: (inverse * inverse * source.x)
            + (2 * inverse * progress * control.x)
            + (progress * progress * target.x),
        y: (inverse * inverse * source.y)
            + (2 * inverse * progress * control.y)
            + (progress * progress * target.y),
    };
};

const rotationAt = (progress, start, peak, end) => {
    const peakAt = 0.62;
    if (progress <= peakAt) {
        return start + ((peak - start) * (progress / peakAt));
    }
    return peak + ((end - peak) * ((progress - peakAt) / (1 - peakAt)));
};

export const buildDealFlightGeometry = (source, target, index, destination = 'player') => {
    const viewportHeight = typeof window === 'undefined' ? 0 : window.innerHeight;
    const cardHeight = viewportHeight * CARD_HEIGHT_RATIO;
    const cardWidth = Math.round(cardHeight * CARD_ASPECT_RATIO);
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const distance = Math.hypot(dx, dy) || 1;
    const perpendicularX = -dy / distance;
    const perpendicularY = dx / distance;
    const bendVariation = 0.92 + ((index % 3) * 0.08);
    const bend = Math.min(64, Math.max(24, distance * 0.11 * bendVariation));
    // A quadratic curve reaches half of the control point's perpendicular
    // offset at its midpoint, so double the desired visible bend here.
    const control = {
        x: ((source.x + target.x) / 2) + (perpendicularX * bend * 2),
        y: ((source.y + target.y) / 2) + (perpendicularY * bend * 2),
    };
    const rotationDirection = index % 2 === 0 ? 1 : -1;
    const startRotation = ((index * 5) % 9) - 4;
    const peakRotation = startRotation + (rotationDirection * (22 + ((index % 4) * 2)));
    const endRotation = ((index * 3) % 9) - 4;
    const endScale = destination === 'local-hand'
        ? 1.36
        : (destination === 'widow' ? 0.9 : 0.72);
    const samples = MOTION_SAMPLE_TIMES.map((time) => {
        const progress = trickEaseProgress(time);
        return {
            time,
            progress,
            point: quadraticPoint(source, control, target, progress),
            rotation: rotationAt(progress, startRotation, peakRotation, endRotation),
            scale: 1 + ((endScale - 1) * progress),
        };
    });

    const style = {
        '--deal-flight-duration': `${DEAL_CARD_FLIGHT_MS}ms`,
        '--deal-start-x': `${source.x - (cardWidth / 2)}px`,
        '--deal-start-y': `${source.y - (cardHeight / 2)}px`,
        '--deal-end-x': `${target.x - (cardWidth / 2)}px`,
        '--deal-end-y': `${target.y - (cardHeight / 2)}px`,
    };

    samples.forEach((sample, sampleIndex) => {
        style[`--deal-p${sampleIndex}-x`] = `${sample.point.x - (cardWidth / 2)}px`;
        style[`--deal-p${sampleIndex}-y`] = `${sample.point.y - (cardHeight / 2)}px`;
        style[`--deal-r${sampleIndex}`] = `${sample.rotation}deg`;
        style[`--deal-s${sampleIndex}`] = String(sample.scale);
    });

    return {
        style,
        path: { source, control, target, samples, bend },
        rotation: { start: startRotation, peak: peakRotation, end: endRotation },
    };
};

const clearRunTimers = (run) => {
    run?.timers.forEach((timer) => clearTimeout(timer));
    run?.timers.clear();
};

const DealAnimation = ({
    active,
    animationKey,
    playerOrder,
    localPlayerName,
    scopeRef,
    renderCard,
    onCardLaunch,
    onCardArrive,
    onComplete,
}) => {
    const [flights, setFlights] = useState([]);
    const mountedRef = useRef(false);
    const runRef = useRef(null);
    const callbacksRef = useRef({ onCardLaunch, onCardArrive, onComplete });
    callbacksRef.current = { onCardLaunch, onCardArrive, onComplete };

    const playerOrderKey = JSON.stringify(playerOrder || []);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            clearRunTimers(runRef.current);
            runRef.current = null;
        };
    }, []);

    useEffect(() => {
        clearRunTimers(runRef.current);
        runRef.current = null;
        setFlights([]);

        if (!active) return undefined;

        const sequence = buildDealSequence(JSON.parse(playerOrderKey));
        const run = {
            id: Symbol(String(animationKey)),
            sequence,
            timers: new Set(),
            launched: new Set(),
            arrived: new Set(),
            completed: false,
        };
        runRef.current = run;
        const total = sequence.length;

        const isCurrent = () => (
            mountedRef.current
            && runRef.current?.id === run.id
            && !run.completed
        );

        const complete = () => {
            if (!isCurrent()) return;
            run.completed = true;
            clearRunTimers(run);
            setFlights([]);
            callbacksRef.current.onComplete?.();
        };

        const arrive = (step, index) => {
            if (!isCurrent() || run.arrived.has(index)) return;
            run.arrived.add(index);
            setFlights((current) => current.filter((flight) => flight.index !== index));
            callbacksRef.current.onCardArrive?.(step, index, total);
            if (run.arrived.size === total) complete();
        };

        const launch = (step, index) => {
            if (!isCurrent() || run.launched.has(index)) return;
            run.launched.add(index);
            callbacksRef.current.onCardLaunch?.(step, index, total);

            const scope = scopeRef?.current;
            if (!scope) {
                arrive(step, index);
                return;
            }

            const sourceElement = scope.querySelector('[data-deal-source="deck"]');
            const target = findTarget(scope, step, localPlayerName);
            const sourcePoint = centerOf(sourceElement);
            const targetPoint = centerOf(target.element);

            if (!sourcePoint || !targetPoint) {
                arrive(step, index);
                return;
            }

            const geometry = buildDealFlightGeometry(
                sourcePoint,
                targetPoint,
                index,
                target.destination,
            );

            setFlights((current) => [
                ...current,
                {
                    id: `${String(animationKey)}-${index}`,
                    index,
                    step,
                    destination: target.destination,
                    style: geometry.style,
                },
            ]);

            const arrivalTimer = setTimeout(() => arrive(step, index), DEAL_CARD_FLIGHT_MS);
            run.timers.add(arrivalTimer);
        };

        const finishOnViewportChange = () => {
            if (!isCurrent()) return;
            clearRunTimers(run);
            sequence.forEach((step, index) => {
                if (!run.launched.has(index)) {
                    run.launched.add(index);
                    callbacksRef.current.onCardLaunch?.(step, index, total);
                }
                if (!run.arrived.has(index)) {
                    run.arrived.add(index);
                    callbacksRef.current.onCardArrive?.(step, index, total);
                }
            });
            complete();
        };

        if (total === 0) {
            const completionTimer = setTimeout(complete, 0);
            run.timers.add(completionTimer);
        } else {
            sequence.forEach((step, index) => {
                const launchTimer = setTimeout(
                    () => launch(step, index),
                    index * DEAL_CARD_STAGGER_MS,
                );
                run.timers.add(launchTimer);
            });
        }

        window.addEventListener('resize', finishOnViewportChange);
        window.addEventListener('orientationchange', finishOnViewportChange);

        return () => {
            window.removeEventListener('resize', finishOnViewportChange);
            window.removeEventListener('orientationchange', finishOnViewportChange);
            clearRunTimers(run);
        };
    }, [active, animationKey, localPlayerName, playerOrderKey, scopeRef]);

    if (!active || typeof document === 'undefined' || !document.body) return null;

    return createPortal(
        <div className="deal-animation-overlay" aria-hidden="true" data-animation-key={String(animationKey)}>
            {flights.map((flight) => (
                <div
                    className="deal-animation-card"
                    data-deal-index={flight.index}
                    data-deal-destination={flight.destination}
                    key={flight.id}
                    style={flight.style}
                >
                    {renderCard(null, { isFaceDown: true, small: true })}
                </div>
            ))}
        </div>,
        document.body,
    );
};

export default DealAnimation;
