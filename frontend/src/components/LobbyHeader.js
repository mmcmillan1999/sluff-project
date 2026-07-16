// frontend/src/components/LobbyHeader.js
import React from 'react';
import BrandHeader from './BrandHeader';

/**
 * LobbyHeader - Wrapper component for the lobby view header
 * Ads are retired until there is a player base worth monetizing;
 * render the branded season strip instead (same 7.5vh slot).
 */
const LobbyHeader = () => <BrandHeader viewType="lobby" />;

export default LobbyHeader;
