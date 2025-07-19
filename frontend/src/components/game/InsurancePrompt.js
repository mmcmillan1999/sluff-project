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

    // Define colors for button states
    const buttonColors = {
        give: '#ef4444', // Red 500
        get: '#22c55e',  // Green 500
        neutral: '#3b82f6' // Blue 500
    };

    const getButtonColor = (value) => {
        if (isBidder) {
            // Bidders are always asking to GET points, so their options are "good".
            return buttonColors.get;
        }
        // For defenders, giving points is "bad" (red), getting is "good" (green).
        if (value > 0) return buttonColors.give;
        if (value < 0) return buttonColors.get;
        return buttonColors.neutral; // For the '0' option
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
        onClose(); // Close the modal after a choice is made
    };

    return (
        <div className="initial-prompt-modal-overlay">
            <div className="initial-prompt-modal">
                <h3 style={{ fontFamily: 'Oswald, sans-serif', margin: '0 0 15px 0' }}>{title}</h3>
                
                {/* Explanatory text for defenders */}
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
                                    // FIX: Explicitly set background properties to override global .game-button styles
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
                <p style={{ fontSize: '0.8em', fontStyle: 'italic', marginTop: '15px', color: '#666' }}>
                    You can change this at any time using the main insurance panel below.
                </p>
                 <button onClick={onClose} style={{marginTop: '10px', background: 'none', border: '1px solid #aaa', padding: '5px 10px', borderRadius: '4px', cursor: 'pointer'}}>Skip</button>
            </div>
        </div>
    );
};

export default InitialInsurancePrompt;
