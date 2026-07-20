import React, { useEffect, useMemo, useRef, useState } from 'react';
import './ScoreChipStack.css';

const SCORE_CHANGE_ANIMATION_MS = 1450;

const normalizeScore = (value) => {
    if (value === null || value === undefined || value === '') return null;

    const numericValue = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numericValue) ? numericValue : null;
};

const roundScore = value => Math.round((value + Number.EPSILON) * 100) / 100;

export const formatScoreChipValue = (value) => {
    const score = normalizeScore(value);
    if (score === null) return '—';

    const rounded = roundScore(score);
    return Number.isInteger(rounded)
        ? String(rounded)
        : rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
};

const getStackCount = (score) => {
    if (score <= 40) return 1;
    if (score <= 80) return 2;
    if (score <= 120) return 3;
    if (score <= 160) return 4;
    if (score <= 200) return 5;
    return 6;
};

/**
 * Convert an exact game score into a small, bounded visual bank. The score is
 * never clamped; only the decorative number of stacks is capped.
 */
export const getScoreChipLayout = (value) => {
    const score = normalizeScore(value);

    if (score === null) {
        return {
            score: null,
            displayScore: '—',
            state: 'unavailable',
            stackCount: 0,
            stackLayers: [],
        };
    }

    if (score <= 0) {
        return {
            score,
            displayScore: formatScoreChipValue(score),
            state: 'busted',
            stackCount: 1,
            stackLayers: [1],
        };
    }

    const stackCount = getStackCount(score);
    const isLooseChip = score < 30;
    const scoreSeed = Math.abs(Math.round(score));
    const stackLayers = Array.from({ length: stackCount }, (_, index) => {
        if (isLooseChip) return 1;
        if (stackCount === 1) return 3;
        return 3 + ((scoreSeed + index * 2) % 4);
    });

    return {
        score,
        displayScore: formatScoreChipValue(score),
        state: isLooseChip ? 'loose' : 'banked',
        stackCount,
        stackLayers,
    };
};

const getScoreSizeClass = (displayScore) => {
    if (displayScore.length >= 7) return 'score-chip-total--tiny';
    if (displayScore.length >= 4) return 'score-chip-total--compact';
    return '';
};

// Visual thickness of one chip edge; each layer rides this far up the stack,
// the same straight-riser perspective the stacked card piles use.
const CHIP_THICKNESS_VH = 0.42;

const getChipLayerStyle = (stackIndex, layerIndex, isScoreLayer) => {
    // Tiny alternating horizontal jitter so tall stacks read hand-placed
    // rather than machined; vertical position is strictly layer * thickness.
    const settleX = (((stackIndex * 7 + layerIndex * 5) % 3) - 1) * 0.07;
    const settleY = -(layerIndex * CHIP_THICKNESS_VH);

    return {
        '--chip-settle-x': `${settleX.toFixed(2)}vh`,
        '--chip-settle-y': `${settleY.toFixed(2)}vh`,
        // Gains drop in from above the stack and land on top
        '--chip-entry-x': `${(settleX + 1.2).toFixed(2)}vh`,
        '--chip-entry-y': `${(settleY - 2.1).toFixed(2)}vh`,
        // Losses restack from a slumped position toward the felt
        '--chip-loss-x': `${(settleX - 0.55).toFixed(2)}vh`,
        '--chip-loss-y': `${(settleY + 0.55).toFixed(2)}vh`,
        '--chip-delay': `${stackIndex * 35 + layerIndex * 30 + (isScoreLayer ? 120 : 0)}ms`,
        zIndex: isScoreLayer ? 40 : layerIndex + 1,
    };
};

const ScoreChipStack = ({ score, playerName, seatPosition, animationScope = null }) => {
    const layout = useMemo(() => getScoreChipLayout(score), [score]);
    const owner = playerName || 'Player';
    const normalizedAnimationScope = animationScope === null || animationScope === undefined
        ? null
        : String(animationScope);
    const previousSnapshotRef = useRef({
        score: layout.score,
        owner,
        animationScope: normalizedAnimationScope,
    });
    const animationIdRef = useRef(0);
    const [scoreChange, setScoreChange] = useState(null);

    useEffect(() => {
        const previousSnapshot = previousSnapshotRef.current;
        previousSnapshotRef.current = {
            score: layout.score,
            owner,
            animationScope: normalizedAnimationScope,
        };

        // Only the held-total -> final-total release within one authoritative
        // round presentation is animated. Joining, reconnecting, rematching,
        // changing tables, and changing the player assigned to this seat all
        // establish a quiet baseline instead of impersonating a score swing.
        const shouldEstablishBaseline = normalizedAnimationScope === null
            || previousSnapshot.animationScope !== normalizedAnimationScope
            || previousSnapshot.owner !== owner
            || previousSnapshot.score === null
            || layout.score === null;

        if (shouldEstablishBaseline) {
            setScoreChange(null);
            return undefined;
        }

        // Equivalent socket broadcasts and unrelated rerenders are inert.
        if (previousSnapshot.score === layout.score) return undefined;

        const delta = layout.score - previousSnapshot.score;
        const animationId = animationIdRef.current + 1;
        animationIdRef.current = animationId;
        setScoreChange({
            id: animationId,
            delta,
            direction: delta > 0 ? 'gain' : 'loss',
        });

        const timeoutId = window.setTimeout(() => {
            setScoreChange(current => (current?.id === animationId ? null : current));
        }, SCORE_CHANGE_ANIMATION_MS);

        return () => window.clearTimeout(timeoutId);
    }, [layout.score, normalizedAnimationScope, owner]);

    const accessibleScore = layout.score === null
        ? `${owner} score unavailable`
        : `${owner} score: ${layout.displayScore} points`;
    const motionClass = scoreChange ? `score-chip-bank--${scoreChange.direction}` : '';
    const seatClass = seatPosition ? `score-chip-bank--${seatPosition}` : '';
    const sizeClass = getScoreSizeClass(layout.displayScore);
    // Missing scores still get one neutral face for the dash, but the public
    // stack-count contract remains zero. All real layouts stay bounded at six
    // piles with no more than six flat chips per pile.
    const renderedStackLayers = layout.stackLayers.length > 0 ? layout.stackLayers : [1];
    const scoreStackIndex = Math.floor((renderedStackLayers.length - 1) / 2);

    return (
        <div
            className={`score-chip-bank score-chip-bank--${layout.state} ${motionClass} ${seatClass}`.trim()}
            role="img"
            aria-label={accessibleScore}
            data-score-chip-player={owner}
            data-stack-count={layout.stackCount}
            data-score-state={layout.state}
        >
            <div
                key={scoreChange?.id || 'settled'}
                className="score-chip-stage"
                aria-hidden="true"
            >
                <div className="score-chip-stacks">
                    {renderedStackLayers.map((layerCount, stackIndex) => (
                        <span
                            key={stackIndex}
                            className={`score-chip-stack score-chip-stack--tone-${(stackIndex % 3) + 1}`}
                            data-layer-count={layerCount}
                        >
                            {Array.from({ length: layerCount }).map((_, layerIndex) => {
                                const isScoreLayer = stackIndex === scoreStackIndex
                                    && layerIndex === layerCount - 1;

                                return (
                                    <span
                                        key={layerIndex}
                                        className={`score-chip-layer ${isScoreLayer ? 'score-chip-layer--score' : ''}`.trim()}
                                        style={getChipLayerStyle(stackIndex, layerIndex, isScoreLayer)}
                                        data-layer-index={layerIndex}
                                        data-score-chip-anchor={isScoreLayer ? 'true' : undefined}
                                    >
                                        {isScoreLayer && (
                                            <span className={`score-chip-total ${sizeClass}`.trim()}>
                                                {layout.displayScore}
                                            </span>
                                        )}
                                    </span>
                                );
                            })}
                        </span>
                    ))}
                </div>

                {scoreChange && (
                    <span className={`score-chip-delta score-chip-delta--${scoreChange.direction}`}>
                        {scoreChange.delta > 0 ? '+' : ''}{formatScoreChipValue(scoreChange.delta)}
                    </span>
                )}
            </div>
        </div>
    );
};

export default ScoreChipStack;
