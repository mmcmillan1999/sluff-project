// frontend/src/components/GameHeader.js
import React from 'react';
import AdvertisingHeader from './AdvertisingHeader';

/**
 * GameHeader - Wrapper component for the game view header
 * Allows independent configuration of the game header without affecting lobby view
 */
const GameHeader = ({ onAdClick, eligibleForMercy }) => {
    // You can add game-specific header customizations here
    // For example: smaller height, different ad placement, etc.
    
    return (
        <AdvertisingHeader
            onAdClick={onAdClick}
            eligibleForMercy={eligibleForMercy}
            viewType="game"
        />
    );
};

export default GameHeader;