// frontend/src/components/game/InsurancePrompt.js

import React from 'react';

/**
 * A modal that prompts the user for their initial insurance setting
 * at the beginning of the playing phase.
 */
const InitialInsurancePrompt = ({ show, insuranceState, selfPlayerName, emitEvent, onClose }) => {

    if (!show || !insuranceState) {
        return null;
    }

    const { bidMultiplier } = insuranceState;
    const isBidder = selfPlayerName === insuranceState.bidderPlayerName;
    
    let title, options, settingType;

    const buttonColors = {
        give: '#ef4444',
        get: '#22c55e',
        neutral: '#3b82f6'
    };

    const getButtonColor = (value) => {
        if (isBidder) return buttonColors.get;
        if (value > 0) return buttonColors.give;
        if (value < 0) return buttonColors.get;
        return buttonColors.neutral;
    };

    if (isBidder) {
        title = "Set Your Initial Requirement";
        settingType = 'bidderRequirement';
        options = [20, 30, 40, 60, 80].map(v => v * bidMultiplier);
    } else {
        title = "Make Your Initial Offer";
        settingType = 'defenderOffer';
        options = [-10, -5, 0, 5, 10, 15, 20].map(v => v * bidMultiplier);
    }

    const handleChoice = (value) => {
        emitEvent("updateInsuranceSetting", { settingType, value });
        onClose();
    };

    // --- NEW LOGIC for the "Pass" button ---
    let passValue;
    let passButtonText;
    let passButtonColor;

    if (isBidder) {
        passValue = 120 * bidMultiplier;
        passButtonText = `Pass (+${passValue})`;
        passButtonColor = buttonColors.get; // Green for 'get'
    } else {
        // A defender's default is to offer a value of -60 * multiplier
        passValue = -60 * bidMultiplier;
        passButtonText = `Pass (${passValue})`;
        passButtonColor = buttonColors.get; // This is green because negative values are what defenders 'get'
    }

    const handlePass = () => {
        // "Passing" simply closes the prompt, leaving the default server value unchanged.
        onClose();
    };

    return (
        <div className="action-prompt-container">
            <h4>{title}</h4>
            
            {!isBidder && (
                <div style={{ fontSize: '0.9em', marginBottom: '15px', textAlign: 'center' }}>
                    <span style={{ color: buttonColors.get, fontWeight: 'bold' }}>Green values</span> are points you GET.
                    <br />
                    <span style={{ color: buttonColors.give, fontWeight: 'bold' }}>Red values</span> are points you GIVE.
                </div>
            )}

            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '10px' }}>
                {options.map(value => {
                    const color = getButtonColor(value);
                    return (
                        <button
                            key={value}
                            className="game-button"
                            style={{
                                fontSize: '1.1em',
                                minWidth: '60px',
                                color: 'white',
                                textShadow: '1px 1px 2px rgba(0,0,0,0.7)',
                                backgroundImage: 'none',
                                backgroundColor: color,
                                borderColor: color
                            }}
                            onClick={() => handleChoice(value)}
                        >
                            {value}
                        </button>
                    );
                })}
            </div>
            <p style={{ fontSize: '0.8em', fontStyle: 'italic', marginTop: '15px', color: '#aaa' }}>
                You can change this at any time using the main insurance panel below.
            </p>
             <button
                onClick={handlePass}
                className="game-button"
                style={{
                    marginTop: '15px',
                    fontSize: '1.1em',
                    width: '100%',
                    backgroundImage: 'none',
                    backgroundColor: passButtonColor,
                    borderColor: passButtonColor,
                    opacity: 0.8
                }}
            >
                {passButtonText}
            </button>
        </div>
    );
};

export default InitialInsurancePrompt;