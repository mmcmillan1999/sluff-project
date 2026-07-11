import React from 'react';
import './InsuranceControls.css'; // Import the new CSS file

/**
 * Compact insurance negotiation panel for the active three-player round.
 * Four-player games use the same trio while the dealer sits out.
 */
const InsuranceControls = ({ insuranceState, selfPlayerName, isSpectator, emitEvent, onOpenPrompt }) => {
    const isActive = !!(insuranceState && insuranceState.isActive && !isSpectator);

    const { bidderPlayerName, bidderRequirement, defenderOffers, dealExecuted } = insuranceState || {};
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

    const openDetailsOnKey = (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onOpenPrompt?.();
        }
    };

    const sumOfOffers = Object.values(defenderOffers || {}).reduce((sum, offer) => sum + (Number(offer) || 0), 0);
    const gapToDeal = (bidderRequirement ?? 0) - sumOfOffers;
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
        <div className={['insurance-controls-container', isActive ? '' : 'is-inactive'].join(' ').trim()}>
            {isActive ? (
                dealExecuted ? (
                    <div className="deal-made-text">DEAL LOCKED</div>
                ) : (
                    <>
                        <span className="insurance-purpose-label" title="Insurance can lock a known score exchange before the tricks are finished">LOCK SCORE</span>
                        <div className={gapValueClasses} title={`${gapToDeal > 0 ? `${gapToDeal} more points are needed to lock a deal` : 'The insurance deal is ready to lock'} (tap for details)`} onClick={onOpenPrompt} onKeyDown={openDetailsOnKey} role="button" tabIndex={0} aria-label={`Deal gap: ${gapToDeal}. ${gapToDeal > 0 ? `${gapToDeal} more points needed` : 'Deal threshold reached'}. Open insurance details`}>
                            <span className="insurance-value-label">GAP</span>
                            <span>{gapToDeal}</span>
                        </div>
                        {(isBidder || isDefender) && (
                            <>
                                <div className={playerValueClasses.join(' ')} title={`${isBidder ? 'Your Ask' : 'Your Offer'} (tap for details)`} onClick={onOpenPrompt} onKeyDown={openDetailsOnKey} role="button" tabIndex={0} aria-label={`${isBidder ? 'Your insurance ask' : 'Your insurance offer'}: ${playerValue}. Open details`}>
                                    <span className="insurance-value-label">{isBidder ? 'ASK' : 'OFFER'}</span>
                                    <span>{playerValue}</span>
                                </div>
                                <button onClick={() => handleAdjustInsurance(-1)} className={decreaseButtonClasses.join(' ')} title="Decrease" aria-label={`Decrease ${isBidder ? 'insurance ask' : 'insurance offer'}`}>-</button>
                                <button onClick={() => handleAdjustInsurance(1)} className={increaseButtonClasses.join(' ')} title="Increase" aria-label={`Increase ${isBidder ? 'insurance ask' : 'insurance offer'}`}>+</button>
                            </>
                        )}
                    </>
                )
            ) : (
                // Placeholder to reserve space when inactive
                <div className="insurance-placeholder" aria-hidden="true">Insurance: lock score</div>
            )}
        </div>
    );
};

export default InsuranceControls;
