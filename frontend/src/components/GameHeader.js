// frontend/src/components/GameHeader.js
import React from 'react';
import BrandHeader from './BrandHeader';

/**
 * GameHeader - Wrapper component for the game view header
 * Ads are retired until there is a player base worth monetizing;
 * render the branded season strip instead (same 7.5vh slot).
 */
const GameHeader = ({ tournament = null, viewerUserId = null }) => (
    <BrandHeader viewType="game" tournament={tournament} viewerUserId={viewerUserId} />
);

export default GameHeader;
