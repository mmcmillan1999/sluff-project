// frontend/src/components/game/InsurancePrompt.js

import React, { useState, useEffect, useMemo } from 'react';
import './InsurancePrompt.css';

/**
 * A modal that prompts the user for their initial insurance setting
 * at the beginning of the playing phase with a modern slider interface.
 */
const InitialInsurancePrompt = ({ show, insuranceState, selfPlayerName, emitEvent, onClose }) => {
    const [sliderValue, setSliderValue] = useState(0);
    const [actualValue, setActualValue] = useState(0);
    const [valueChanged, setValueChanged] = useState(false);
    const [selectedButton, setSelectedButton] = useState(null);
    const [isInitialized, setIsInitialized] = useState(false);

    const { bidMultiplier } = insuranceState || {};
    const isBidder = selfPlayerName === insuranceState?.bidderPlayerName;
    
    // Memoize configuration values to prevent unnecessary re-renders
    const config = useMemo(() => {
        if (!insuranceState) return null;
        
        if (isBidder) {
            const minValue = 20 * (bidMultiplier || 1);
            const maxValue = 120 * (bidMultiplier || 1);
            const quickJumpValues = [20, 30, 40, 60, 80].map(v => v * (bidMultiplier || 1));
            
            return {
                title: "Choose Your Insurance Ask",
                settingType: 'bidderRequirement',
                minValue,
                maxValue,
                quickJumpValues
            };
        } else {
            const minValue = -60 * (bidMultiplier || 1);
            const maxValue = 20 * (bidMultiplier || 1);
            const quickJumpValues = [-60, -10, -5, 0, 5, 10, 15, 20].map(v => v * (bidMultiplier || 1));
            
            return {
                title: "Choose Your Insurance Offer",
                settingType: 'defenderOffer',
                minValue,
                maxValue,
                quickJumpValues
            };
        }
    }, [isBidder, bidMultiplier, insuranceState]);

    const buttonColors = {
        give: '#ef4444',
        get: '#22c55e',
        neutral: '#3b82f6'
    };

    // Initialize slider to a sensible default value only once when modal opens
    useEffect(() => {
        if (!show || !config || isInitialized) return;
        
        const savedValue = isBidder
            ? Number(insuranceState?.bidderRequirement)
            : Number(insuranceState?.defenderOffers?.[selfPlayerName]);
        let defaultValue;
        if (Number.isFinite(savedValue) && savedValue >= config.minValue && savedValue <= config.maxValue) {
            defaultValue = savedValue;
        } else if (isBidder) {
            // Start bidders at a moderate requirement (second quick jump value)
            defaultValue = config.quickJumpValues[1] || (config.minValue + config.maxValue) / 2;
        } else {
            // Start defenders at 0 or close to neutral
            defaultValue = config.quickJumpValues.find(v => v === 0) || config.quickJumpValues[Math.floor(config.quickJumpValues.length / 2)];
        }
        
        setSliderValue(defaultValue);
        setActualValue(defaultValue);
        setSelectedButton(defaultValue);
        setIsInitialized(true);
    }, [show, config, isBidder, isInitialized, insuranceState, selfPlayerName]);

    // Reset initialization state when modal closes
    useEffect(() => {
        if (!show) {
            setIsInitialized(false);
        }
    }, [show]);

    if (!show || !config) {
        return null;
    }

    const handleSliderChange = (e) => {
        const value = parseInt(e.target.value);
        setSliderValue(value);
        setActualValue(value);
        setValueChanged(true);
        // Clear button selection when slider is manually moved
        setSelectedButton(null);
        setTimeout(() => setValueChanged(false), 300);
    };

    const handleQuickJump = (value) => {
        setSliderValue(value);
        setActualValue(value);
        setSelectedButton(value); // Track button selection
        setValueChanged(true);
        setTimeout(() => setValueChanged(false), 300);
    };

    const handleSubmit = () => {
        emitEvent("updateInsuranceSetting", { settingType: config.settingType, value: actualValue });
        onClose();
    };

    const handlePass = () => {
        onClose();
    };

    const getValueColor = (value) => {
        if (isBidder) return buttonColors.get;
        if (value > 0) return buttonColors.give;
        if (value < 0) return buttonColors.get;
        return buttonColors.neutral;
    };

    const getValueDescription = () => {
        if (isBidder) {
            return `Ask defenders to offer at least ${actualValue} points in total`;
        } else {
            if (actualValue > 0) {
                return `Your offer would pay ${actualValue} points to the bidder`;
            } else if (actualValue < 0) {
                return `Your offer asks the bidder to pay you ${Math.abs(actualValue)} points`;
            } else {
                return `Your offer adds no points to either side`;
            }
        }
    };

    const defenderOffers = insuranceState?.defenderOffers || {};
    const currentOffer = Number(defenderOffers[selfPlayerName]) || 0;
    const currentOfferTotal = Object.values(defenderOffers).reduce((sum, offer) => sum + (Number(offer) || 0), 0);
    const previewOfferTotal = isBidder ? currentOfferTotal : currentOfferTotal - currentOffer + actualValue;
    const previewAsk = isBidder ? actualValue : (Number(insuranceState?.bidderRequirement) || 0);
    const previewGap = previewAsk - previewOfferTotal;

    return (
        <div className="insurance-prompt-modal">
            <div className="insurance-prompt-content" role="dialog" aria-modal="true" aria-labelledby="insurance-prompt-title" aria-describedby="insurance-explainer">
                <h4 className="insurance-prompt-title" id="insurance-prompt-title">{config.title}</h4>
                <div className="insurance-explainer" id="insurance-explainer">
                    <strong>Why insure?</strong> Lock a known point exchange instead of waiting for the trick result. A deal locks when the defenders' combined offers meet the bidder's ask.
                </div>
                
                {/* Value Display */}
                <div className="current-value-display">
                    <span 
                        className={`current-value ${valueChanged ? 'value-changing' : ''}`}
                        style={{ color: getValueColor(actualValue) }}
                    >
                        {actualValue}
                    </span>
                    <div className="value-description">
                        {getValueDescription()}
                    </div>
                    <div className={`insurance-gap-preview ${previewGap <= 0 ? 'is-ready' : ''}`}>
                        {previewGap <= 0
                            ? 'This setting reaches the deal threshold and would lock the agreement.'
                            : `Deal gap: ${previewGap} more point${previewGap === 1 ? '' : 's'} needed.`}
                    </div>
                </div>

                {/* Slider Container */}
                <div className="slider-container">
                    <div className="slider-track-background">
                        <input
                            type="range"
                            min={config.minValue}
                            max={config.maxValue}
                            step={bidMultiplier || 1}
                            value={sliderValue}
                            onChange={handleSliderChange}
                            className="insurance-slider"
                            aria-label={isBidder ? 'Insurance ask' : 'Insurance offer'}
                        />
                        <div className="slider-markers">
                            <span className="marker-label">{config.minValue}</span>
                            <span className="marker-label">{config.maxValue}</span>
                        </div>
                    </div>
                </div>

                {/* Quick Jump Buttons */}
                <div className="quick-jump-container">
                    <div className="quick-jump-label">Quick Select:</div>
                    <div className="quick-jump-buttons">
                        {config.quickJumpValues.map(value => (
                            <button
                                key={value}
                                className={`quick-jump-button ${selectedButton === value ? 'active' : ''}`}
                                style={{
                                    backgroundColor: selectedButton === value ? getValueColor(value) : undefined,
                                    borderColor: getValueColor(value)
                                }}
                                onClick={() => handleQuickJump(value)}
                                aria-label={`Set ${isBidder ? 'ask' : 'offer'} to ${value}`}
                            >
                                {value}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Action Buttons */}
                <div className="action-buttons">
                    <button
                        className="submit-button"
                        onClick={handleSubmit}
                        style={{ backgroundColor: getValueColor(actualValue) }}
                    >
                        Save {isBidder ? 'Ask' : 'Offer'}
                    </button>
                    <button
                        className="pass-button"
                        onClick={handlePass}
                    >
                        Keep Current Setting
                    </button>
                </div>

                {/* Helper Text */}
                {!isBidder && (
                    <div className="helper-text">
                        <span style={{ color: buttonColors.get }}>Green/negative</span> = ask the bidder to pay you ·
                        <span style={{ color: buttonColors.give }}>Red/positive</span> = offer points to the bidder
                    </div>
                )}
                
                <p className="adjustment-note">
                    You can adjust this at any time using the insurance controls during the game.
                </p>
            </div>
        </div>
    );
};

export default InitialInsurancePrompt;
