import React from 'react';
import './InsuranceControls.css'; // Import the new CSS file

/**
 * Renders a super-compact insurance negotiation panel for 3-player games,
 * focusing on values and buttons with no text labels.
 */
const InsuranceControls = ({ insuranceState, selfPlayerName, isSpectator, emitEvent }) => {

    if (!insuranceState || !insuranceState.isActive || isSpectator) {
        return null;
    }

    const { bidderPlayerName, bidderRequirement, defenderOffers, dealExecuted } = insuranceState;
    const isBidder = selfPlayerName === bidderPlayerName;
    const myOffer = defenderOffers ? defenderOffers[selfPlayerName] : undefined;
    const isDefender = myOffer !== undefined;

    const handleAdjustInsurance = (amount) => {
        if (dealExecuted) return; // Don't allow changes after a deal is made
        let settingType, currentValue;
        if (isBidder) {
            settingType = 'bidderRequirement';
            currentValue = bidderRequirement;
        } else if (isDefender) {
            settingType = 'defenderOffer';
            currentValue = myOffer;
        } else {
            return;
        }
        const newValue = currentValue + amount;
        emitEvent("updateInsuranceSetting", { settingType, value: newValue });
    };

    const sumOfOffers = Object.values(defenderOffers || {}).reduce((sum, offer) => sum + offer, 0);
    const gapToDeal = bidderRequirement - sumOfOffers;
    const playerValue = isBidder ? bidderRequirement : myOffer;

    // --- Build className strings dynamically ---
    const gapValueClasses = [
        'value-display',
        'gap-value',
        gapToDeal <= 0 ? 'zero-or-less' : 'positive'
    ].join(' ');

    const playerValueClasses = ['value-display'];
    if (isBidder) {
        playerValueClasses.push('player-value-get');
    } else if (isDefender) {
        if (playerValue > 0) playerValueClasses.push('player-value-give');
        else playerValueClasses.push('player-value-get');
    }

    // --- Determine button colors based on role ---
    const decreaseButtonClasses = ['adjust-button'];
    const increaseButtonClasses = ['adjust-button'];

    if (isBidder) {
        // For bidder: increasing is good (green), decreasing is bad (red)
        increaseButtonClasses.push('adjust-green');
        decreaseButtonClasses.push('adjust-red');
    } else if (isDefender) {
        // For defender: increasing offer is bad (red), decreasing is good (green)
        increaseButtonClasses.push('adjust-red');
        decreaseButtonClasses.push('adjust-green');
    }


    return (
        <div className="insurance-controls-container">
            {dealExecuted ? (
                <div className="deal-made-text">DEAL!</div>
            ) : (
                <>
                    {/* Gap to Deal Value */}
                    <div className={gapValueClasses} title="Gap to Deal">{gapToDeal}</div>

                    {/* Player Controls */}
                    {(isBidder || isDefender) && (
                        <>
                            <div className={playerValueClasses.join(' ')} title={isBidder ? 'Your Ask' : 'Your Offer'}>{playerValue}</div>
                            <button onClick={() => handleAdjustInsurance(-1)} className={decreaseButtonClasses.join(' ')} title="Decrease">-</button>
                            <button onClick={() => handleAdjustInsurance(1)} className={increaseButtonClasses.join(' ')} title="Increase">+</button>
                        </>
                    )}
                </>
            )}
        </div>
    );
};

export default InsuranceControls;
