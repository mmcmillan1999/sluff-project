import React, { useEffect, useRef, useState } from 'react';
import './InsuranceControls.css'; // Import the new CSS file

/**
 * Compact insurance negotiation panel for the active three-player round.
 * Four-player games use the same trio while the dealer sits out.
 */
const InsuranceControls = ({ insuranceState, selfPlayerName, isSpectator, emitEvent, onOpenPrompt, wagerTouched, onWagerInteract }) => {
    const isActive = !!(insuranceState && insuranceState.isActive && !isSpectator);

    const { bidderPlayerName, bidderRequirement, defenderOffers, dealExecuted, bidMultiplier } = insuranceState || {};
    const multiplier = bidMultiplier || 1;
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
        onWagerInteract?.();
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

    // The server arms each round with the maximally-unagreeable defaults
    // (ask 120xM, offers -60xM), so "still at the default and untouched this
    // round" is the signal that this player hasn't set a wager yet.
    const untouchedDefault = isBidder ? 120 * multiplier : (isDefender ? -60 * multiplier : null);
    const needsAttention = isActive && !dealExecuted
        && untouchedDefault !== null
        && !wagerTouched
        && Number(playerValue) === untouchedDefault;

    // When the gap moves while our own wager didn't, another player changed
    // theirs — bounce the GAP number and float the delta so the eye catches it.
    const [gapFx, setGapFx] = useState(null); // { key, delta }
    const prevGapRef = useRef(null);
    useEffect(() => {
        if (!isActive || dealExecuted) {
            prevGapRef.current = null;
            return;
        }
        const prev = prevGapRef.current;
        if (prev && prev.gap !== gapToDeal && prev.mine === playerValue) {
            const delta = gapToDeal - prev.gap;
            setGapFx(fx => ({ key: (fx?.key || 0) + 1, delta }));
        }
        prevGapRef.current = { gap: gapToDeal, mine: playerValue };
    }, [gapToDeal, playerValue, isActive, dealExecuted]);

    useEffect(() => {
        if (!gapFx) return undefined;
        const timer = setTimeout(() => setGapFx(null), 1200);
        return () => clearTimeout(timer);
    }, [gapFx]);

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
    if (needsAttention) playerValueClasses.push('wager-unset');

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
        <div className={['insurance-controls-container', isActive ? '' : 'is-inactive', needsAttention ? 'needs-attention' : ''].join(' ').trim()}>
            {isActive ? (
                dealExecuted ? (
                    <div className="deal-made-text">DEAL LOCKED</div>
                ) : (
                    <>
                        <span className="insurance-purpose-label" title="Insurance can lock a known score exchange before the tricks are finished">LOCK SCORE</span>
                        <div className={gapValueClasses} title={`${gapToDeal > 0 ? `${gapToDeal} more points are needed to lock a deal` : 'The insurance deal is ready to lock'} (tap for details)`} onClick={onOpenPrompt} onKeyDown={openDetailsOnKey} role="button" tabIndex={0} aria-label={`Deal gap: ${gapToDeal}. ${gapToDeal > 0 ? `${gapToDeal} more points needed` : 'Deal threshold reached'}. Open insurance details`}>
                            <span className="insurance-value-label">GAP</span>
                            <span key={gapFx?.key || 0} className={gapFx ? 'gap-number gap-bounce' : 'gap-number'}>{gapToDeal}</span>
                            {gapFx && (
                                <span
                                    className={`gap-delta ${gapFx.delta < 0 ? 'closing' : 'widening'}`}
                                    aria-hidden="true"
                                >
                                    {gapFx.delta > 0 ? `+${gapFx.delta}` : gapFx.delta}
                                </span>
                            )}
                        </div>
                        {(isBidder || isDefender) && (
                            <>
                                <div className={playerValueClasses.join(' ')} title={`${isBidder ? 'Your Ask' : 'Your Offer'}${needsAttention ? ' — not set yet' : ''} (tap for details)`} onClick={onOpenPrompt} onKeyDown={openDetailsOnKey} role="button" tabIndex={0} aria-label={`${isBidder ? 'Your insurance ask' : 'Your insurance offer'}: ${playerValue}.${needsAttention ? ' Not set yet.' : ''} Open details`}>
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
