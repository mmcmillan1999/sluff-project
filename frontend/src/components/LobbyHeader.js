// frontend/src/components/LobbyHeader.js
import React from 'react';
import AdvertisingHeader from './AdvertisingHeader';

/**
 * LobbyHeader - Wrapper component for the lobby view header
 * Allows independent configuration of the lobby header without affecting game view
 */
const LobbyHeader = ({ onAdClick, eligibleForMercy }) => {
    // You can add lobby-specific header customizations here
    // For example: different ad campaigns, different styling, etc.
    
    return (
        <AdvertisingHeader
            onAdClick={onAdClick}
            eligibleForMercy={eligibleForMercy}
            viewType="lobby"
        />
    );
};

export default LobbyHeader;