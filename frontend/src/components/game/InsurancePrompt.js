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
                title: "Set Your Initial Requirement",
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
                title: "Make Your Initial Offer",
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
        
        let defaultValue;
        if (isBidder) {
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
    }, [show, config, isBidder, isInitialized]);

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
            return `You will GET ${actualValue} points if insurance is claimed`;
        } else {
            if (actualValue > 0) {
                return `You will GIVE ${actualValue} points to the bidder`;
            } else if (actualValue < 0) {
                return `You will GET ${Math.abs(actualValue)} points from the bidder`;
            } else {
                return `No points exchanged`;
            }
        }
    };

    return (
        <div className="insurance-prompt-modal">
            <div className="insurance-prompt-content">
                <h4 className="insurance-prompt-title">{config.title}</h4>
                
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
                        Confirm Selection
                    </button>
                    <button
                        className="pass-button"
                        onClick={handlePass}
                    >
                        Pass (Use Default)
                    </button>
                </div>

                {/* Helper Text */}
                {!isBidder && (
                    <div className="helper-text">
                        <span style={{ color: buttonColors.get }}>Green values</span> = points you GET • 
                        <span style={{ color: buttonColors.give }}>Red values</span> = points you GIVE
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