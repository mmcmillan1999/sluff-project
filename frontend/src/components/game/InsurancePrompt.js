// frontend/src/components/game/InsurancePrompt.js

import React, { useState, useEffect, useMemo, useRef } from 'react';
import './InsurancePrompt.css';

/**
 * The full insurance panel: a live view of the whole negotiation (ask,
 * every offer, and the gap) plus the editor for your own wager. Pure
 * presentation — ranges and the lock rule mirror the server exactly
 * (GameEngine.updateInsuranceSetting: ask within ±120×multiplier,
 * offers within ±60×multiplier, deal locks when ask ≤ sum of offers).
 */

const signed = (value) => (value > 0 ? `+${value}` : `${value}`);

// Renders a number that bounces whenever its value changes (not on mount).
const BouncingValue = ({ value, className = '', format = String }) => {
    const [bounceKey, setBounceKey] = useState(0);
    const prevRef = useRef(value);
    useEffect(() => {
        if (prevRef.current !== value) {
            prevRef.current = value;
            setBounceKey(key => key + 1);
        }
    }, [value]);
    return (
        <span key={bounceKey} className={`${className}${bounceKey ? ' board-value-bounce' : ''}`}>
            {format(value)}
        </span>
    );
};

const InsurancePrompt = ({ show, insuranceState, selfPlayerName, emitEvent, onClose, onWagerInteract }) => {
    const [value, setValue] = useState(0);
    const [isInitialized, setIsInitialized] = useState(false);

    const { bidMultiplier, bidderPlayerName, bidderRequirement, defenderOffers, dealExecuted } = insuranceState || {};
    const multiplier = bidMultiplier || 1;
    const isBidder = selfPlayerName === bidderPlayerName;
    const isDefender = Boolean(defenderOffers
        && Object.prototype.hasOwnProperty.call(defenderOffers, selfPlayerName));
    const isParticipant = isBidder || isDefender;

    const config = useMemo(() => {
        if (!insuranceState) return null;
        // Quick picks are tuned to real outcomes, not the theoretical range
        // (the slider still covers that). From ~2,700 logged bot rounds
        // (bot_insurance_logs, Aug 2025–Jul 2026), per multiplier unit:
        // bidder round outcome μ≈-1 σ≈37 (p10..p90 = -45..+46); defender
        // outcome σ≈16.5 with fair offers centred ≈ +6. Buttons sit at
        // ~σ-sized steps across those bands.
        if (isBidder) {
            return {
                roleLabel: 'Ask',
                settingType: 'bidderRequirement',
                minValue: -120 * multiplier,
                maxValue: 120 * multiplier,
                quickJumpValues: [-40, -20, 0, 20, 40, 60].map(v => v * multiplier),
                // For the bidder, higher = defenders pay you (green to the right)
                trackGradient: 'linear-gradient(to right, #b91c1c, #52525b 50%, #15803d)',
                untouchedValue: 120 * multiplier,
            };
        }
        return {
            roleLabel: 'Offer',
            settingType: 'defenderOffer',
            minValue: -60 * multiplier,
            maxValue: 60 * multiplier,
            quickJumpValues: [-20, -10, 0, 10, 20, 30].map(v => v * multiplier),
            // For a defender, lower = the bidder pays you (green to the left)
            trackGradient: 'linear-gradient(to right, #15803d, #52525b 50%, #b91c1c)',
            untouchedValue: -60 * multiplier,
        };
    }, [insuranceState, isBidder, multiplier]);

    const savedValue = isBidder
        ? Number(bidderRequirement)
        : Number(defenderOffers?.[selfPlayerName]);

    // Load your current saved wager once per open.
    useEffect(() => {
        if (!show || !config || isInitialized) return;
        const startValue = Number.isFinite(savedValue)
            ? Math.min(config.maxValue, Math.max(config.minValue, savedValue))
            : 0;
        setValue(startValue);
        setIsInitialized(true);
    }, [show, config, isInitialized, savedValue]);

    useEffect(() => {
        if (!show) setIsInitialized(false);
    }, [show]);

    useEffect(() => {
        if (!show) return undefined;
        const closeOnEscape = (event) => {
            if (event.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', closeOnEscape);
        return () => document.removeEventListener('keydown', closeOnEscape);
    }, [show, onClose]);

    if (!show || !config) return null;

    const clampValue = (v) => Math.min(config.maxValue, Math.max(config.minValue, v));
    const setTo = (v) => setValue(clampValue(v));

    const handleSubmit = () => {
        emitEvent('updateInsuranceSetting', { settingType: config.settingType, value });
        onWagerInteract?.();
        onClose();
    };

    // Value color: green when points flow to you, red when they flow away.
    const valueTone = (v) => {
        if (v === 0) return 'neutral';
        if (isBidder) return v > 0 ? 'get' : 'give';
        return v > 0 ? 'give' : 'get';
    };

    const getValueDescription = () => {
        if (isBidder) {
            if (value < 0) return `You'd pay the defenders ${Math.abs(value)} points to lock a deal`;
            return `Ask defenders to offer at least ${value} points in total`;
        }
        if (value > 0) return `Your offer would pay ${value} points to the bidder`;
        if (value < 0) return `Your offer asks the bidder to pay you ${Math.abs(value)} points`;
        return 'Your offer adds no points to either side';
    };

    // --- Live negotiation state (updates in real time from the server) ---
    const liveAsk = Number(bidderRequirement) || 0;
    const offerEntries = Object.entries(defenderOffers || {});
    const liveOfferTotal = offerEntries.reduce((sum, [, offer]) => sum + (Number(offer) || 0), 0);
    const liveGap = liveAsk - liveOfferTotal;

    // --- Preview of the gap if this value were saved right now ---
    const currentOffer = Number(defenderOffers?.[selfPlayerName]) || 0;
    const previewOfferTotal = isBidder ? liveOfferTotal : liveOfferTotal - currentOffer + value;
    const previewAsk = isBidder ? value : liveAsk;
    const previewGap = previewAsk - previewOfferTotal;

    const needsFirstSave = isParticipant && !dealExecuted && savedValue === config.untouchedValue;

    const offerSummary = offerEntries
        .map(([name, offer]) => `${name === selfPlayerName ? 'You' : name} ${signed(Number(offer) || 0)}`)
        .join(' · ');

    return (
        <div className="insurance-prompt-modal" onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose();
        }}>
            <div
                className="insurance-prompt-content"
                role="dialog"
                aria-modal="true"
                aria-labelledby="insurance-prompt-title"
                aria-describedby="insurance-explainer"
            >
                <button type="button" className="insurance-prompt-close" onClick={onClose} aria-label="Close insurance panel">×</button>
                <h4 className="insurance-prompt-title" id="insurance-prompt-title">Insurance — Lock the Score</h4>
                <p className="insurance-explainer" id="insurance-explainer">
                    Trade the unknown trick result for a known point exchange. The deal locks
                    the instant the defenders&rsquo; combined offers meet the bidder&rsquo;s ask.
                </p>

                {/* Live deal board: ask − offers = gap */}
                <div className="deal-board" aria-label="Current insurance negotiation">
                    <div className="deal-board-tile">
                        <span className="tile-label">Ask</span>
                        <BouncingValue value={liveAsk} className="tile-value" />
                        <span className="tile-sub">{isBidder ? 'You' : bidderPlayerName}</span>
                    </div>
                    <span className="deal-board-op" aria-hidden="true">−</span>
                    <div className="deal-board-tile">
                        <span className="tile-label">Offers</span>
                        <BouncingValue value={liveOfferTotal} className="tile-value" format={signed} />
                        <span className="tile-sub">{offerSummary}</span>
                    </div>
                    <span className="deal-board-op" aria-hidden="true">=</span>
                    <div className={`deal-board-tile gap-tile ${liveGap <= 0 || dealExecuted ? 'is-locked' : ''}`}>
                        <span className="tile-label">Gap</span>
                        {dealExecuted
                            ? <span className="tile-value">✓</span>
                            : <BouncingValue value={liveGap} className="tile-value" />}
                        <span className="tile-sub">{dealExecuted || liveGap <= 0 ? 'Deal locks' : 'to a deal'}</span>
                    </div>
                </div>

                {dealExecuted ? (
                    <div className="deal-locked-banner" role="status">
                        <strong>DEAL LOCKED</strong>
                        <p>The point exchange is set for this round — wagers can no longer change.</p>
                    </div>
                ) : !isParticipant ? (
                    <p className="insurance-observer-note">
                        You&rsquo;re not part of this round&rsquo;s insurance — the three active players negotiate it.
                    </p>
                ) : (
                    <>
                        {/* Your wager editor */}
                        <div className="wager-editor">
                            <div className="wager-editor-heading">
                                <span>Your {config.roleLabel}</span>
                                {needsFirstSave && <em className="unset-hint">not set yet</em>}
                            </div>
                            <div className="stepper-row">
                                <button
                                    type="button"
                                    className={`stepper-button ${isBidder ? 'stepper-red' : 'stepper-green'}`}
                                    onClick={() => setTo(value - multiplier)}
                                    disabled={value <= config.minValue}
                                    aria-label={`Decrease ${config.roleLabel.toLowerCase()} by ${multiplier}`}
                                >
                                    −
                                </button>
                                <span className={`current-value tone-${valueTone(value)}`}>{signed(value)}</span>
                                <button
                                    type="button"
                                    className={`stepper-button ${isBidder ? 'stepper-green' : 'stepper-red'}`}
                                    onClick={() => setTo(value + multiplier)}
                                    disabled={value >= config.maxValue}
                                    aria-label={`Increase ${config.roleLabel.toLowerCase()} by ${multiplier}`}
                                >
                                    +
                                </button>
                            </div>
                            <div className="value-description">{getValueDescription()}</div>
                            <div className={`insurance-gap-preview ${previewGap <= 0 ? 'is-ready' : ''}`}>
                                {previewGap <= 0
                                    ? 'This setting reaches the deal threshold and would lock the agreement.'
                                    : `Deal gap: ${previewGap} more point${previewGap === 1 ? '' : 's'} needed.`}
                            </div>
                        </div>

                        {/* Full-range slider */}
                        <div className="slider-container">
                            <div className="slider-zone-labels" aria-hidden="true">
                                <span className={isBidder ? 'zone-give' : 'zone-get'}>{isBidder ? 'you pay' : 'you receive'}</span>
                                <span className={isBidder ? 'zone-get' : 'zone-give'}>{isBidder ? 'you receive' : 'you pay'}</span>
                            </div>
                            <div className="slider-track-background">
                                <input
                                    type="range"
                                    min={config.minValue}
                                    max={config.maxValue}
                                    step={multiplier}
                                    value={value}
                                    onChange={(event) => setTo(parseInt(event.target.value, 10))}
                                    className="insurance-slider"
                                    style={{ '--track-gradient': config.trackGradient }}
                                    aria-label={isBidder ? 'Insurance ask' : 'Insurance offer'}
                                />
                                <span className="slider-zero-tick" aria-hidden="true" />
                            </div>
                            <div className="slider-markers" aria-hidden="true">
                                <span className="marker-label">{config.minValue}</span>
                                <span className="marker-label">0</span>
                                <span className="marker-label">{config.maxValue}</span>
                            </div>
                        </div>

                        {/* Quick picks across the whole range */}
                        <div className="quick-jump-buttons">
                            {config.quickJumpValues.map(quickValue => (
                                <button
                                    key={quickValue}
                                    type="button"
                                    className={`quick-jump-button tone-${valueTone(quickValue)} ${value === quickValue ? 'active' : ''}`}
                                    onClick={() => setTo(quickValue)}
                                    aria-label={`Set ${config.roleLabel.toLowerCase()} to ${quickValue}`}
                                >
                                    {signed(quickValue)}
                                </button>
                            ))}
                        </div>

                        <div className="action-buttons">
                            <button
                                type="button"
                                className={`submit-button ${needsFirstSave ? 'attention-pulse' : ''}`}
                                onClick={handleSubmit}
                            >
                                Save {config.roleLabel}
                            </button>
                            <button type="button" className="pass-button" onClick={onClose}>
                                Close
                            </button>
                        </div>

                        <p className="adjustment-note">
                            <span className="legend-get">Green = points come to you</span>
                            {' · '}
                            <span className="legend-give">Red = points leave you</span>
                            <br />
                            Adjust any time from the LOCK SCORE controls in the footer.
                        </p>
                    </>
                )}
            </div>
        </div>
    );
};

export default InsurancePrompt;
