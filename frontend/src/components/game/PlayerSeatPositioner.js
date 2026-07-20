// PlayerSeatPositioner.js
// Wrapper component that provides absolute control over player seat positioning and rotation
// The anchor point (debug dot) acts as the reference point for transformations

import React, { useState, useEffect } from 'react';
import './PlayerSeatPositioner.css';

// In iPad/iPhone BROWSERS, vh measures the large viewport (URL bar collapsed)
// while the app shell lays out in dvh (the visible area) — near the bottom
// edge that gap shoved the south plaque underneath the player hand. Anchor
// the seats in dvh where the browser supports it; desktop and the Capacitor
// shell are unaffected (vh === dvh there).
const VERTICAL_UNIT = (typeof CSS !== 'undefined' && CSS.supports?.('top', '1dvh')) ? 'dvh' : 'vh';

const PlayerSeatPositioner = ({ 
    playerName, 
    currentTableState, 
    isSelf, 
    emitEvent, 
    renderCard, 
    seatPosition,
    PlayerSeat,  // Component passed as prop
    showTrumpIndicator,
    trumpIndicatorPuck,
    onPlayerProfile,
    // New positioning controls
    anchorX = null,  // vw units - if null, use default CSS positioning
    anchorY = null,  // vh units - if null, use default CSS positioning  
    rotation = 0,    // degrees
    debugMode = false // Show anchor point for debugging
}) => {
    const [isWideMode, setIsWideMode] = useState(false);
    // Horizontal distance (vw) of the side seats from center in default mode.
    // 35vw === the classic 15vw/85vw anchors; capped at 42vh-worth so seats
    // stay near the felt instead of hugging the edges of wide monitors.
    const [sideOffsetVw, setSideOffsetVw] = useState(35);

    // Configuration for each seat position's default anchor points
    const defaultAnchors = {
        left: { x: 50 - sideOffsetVw, y: 45 },     // West position from config
        right: { x: 50 + sideOffsetVw, y: 45 },    // East position from config
        bottom: { x: 50, y: 75 },   // South position from config
        top: { x: 50, y: 17, rotation: 0 }   // North position for widow - centered at 50vw, 17vh, no rotation
    };
    
    // Collision prevention mode anchor positions (when seat width > 25vw)
    // Moves seats to edges and rotates them to prevent overlap
    const wideModeAnchors = {
        left: { x: 1, y: 35, rotation: 90 },     // West: edge at 1vw, 35vh, rotate 90° clockwise
        right: { x: 99, y: 35, rotation: -90 },  // East: edge at 99vw, 35vh, rotate 90° counter-clockwise
        bottom: { x: 50, y: 66.5, rotation: 0 }, // South: moves up to 66.5vh in collision mode
        top: { x: 50, y: 17, rotation: 0 }       // North: widow stays fixed - no collision mode changes
    };
    
    // Check if player seat width exceeds the wide-mode threshold
    useEffect(() => {
        const checkSeatWidth = () => {
            // Player seat width is 17.5vh (7vh * 2.5)
            const seatWidthVh = 17.5;
            const vh = window.innerHeight / 100;
            const vw = window.innerWidth / 100;
            const seatWidthInPixels = seatWidthVh * vh;
            const seatWidthInVw = seatWidthInPixels / vw;

            // 21.875vw === aspect (H/W) > 1.25, so every portrait phone AND
            // portrait tablet gets the rotated-nameplate layout. (The old 25vw
            // threshold, aspect > 1.43, split the iPads: Mini fell to the
            // desktop layout while Air got the phone one.)
            const shouldBeWide = seatWidthInVw > 21.875;

            // Debug logging
            if (debugMode) {
                console.log('[PlayerSeatPositioner] Seat width check:', {
                    viewport: `${window.innerWidth}x${window.innerHeight}`,
                    seatWidthVh,
                    seatWidthInPixels,
                    seatWidthInVw: seatWidthInVw.toFixed(1),
                    shouldBeWide,
                    seatPosition
                });
            }

            setIsWideMode(shouldBeWide);
            // Default-mode side seats sit 35vw from center (15vw/85vw), but on
            // wide viewports that strands them in dead felt far from the played
            // cards. Cap the offset at 42vh-worth of vw; the min() only bites
            // when width > ~1.2x height, so tablets/phones are untouched.
            const aspectHoverW = window.innerHeight / window.innerWidth;
            setSideOffsetVw(Math.min(35, 42 * aspectHoverW));
        };
        
        checkSeatWidth();
        window.addEventListener('resize', checkSeatWidth);
        
        return () => window.removeEventListener('resize', checkSeatWidth);
    }, [debugMode, seatPosition]);
    
    // Select anchors based on mode (collision prevention mode when seat width > 25vw)
    const activeAnchors = isWideMode ? wideModeAnchors : defaultAnchors;
    
    // Use provided anchor or fall back to mode-appropriate defaults
    const effectiveAnchorX = anchorX !== null ? anchorX : activeAnchors[seatPosition]?.x;
    const effectiveAnchorY = anchorY !== null ? anchorY : activeAnchors[seatPosition]?.y;
    const effectiveRotation = rotation !== 0 ? rotation : (activeAnchors[seatPosition]?.rotation || 0);
    
    // Calculate the wrapper style based on effective anchor position
    const getWrapperStyle = () => {
        const style = {};
        
        // Always use the effective anchors for positioning
        if (effectiveAnchorX !== null && effectiveAnchorX !== undefined && 
            effectiveAnchorY !== null && effectiveAnchorY !== undefined) {
            style.position = 'fixed';
            style.left = `${effectiveAnchorX}vw`;
            style.top = `${effectiveAnchorY}${VERTICAL_UNIT}`;
            // Remove any default positioning
            style.right = 'auto';
            style.bottom = 'auto';
            // CRITICAL: translate -50% horizontally (center), -100% vertically (bottom at anchor)
            // This pins the bottom center of the element at the anchor point
            style.transform = `translate(-50%, -100%) rotate(${effectiveRotation}deg)`;
            // Rotate around the bottom center point (where the "dart" is stuck)
            style.transformOrigin = '50% 100%'; // bottom center
        }
        
        return style;
    };
    
    return (
        <div 
            className={`player-seat-positioner player-seat-${seatPosition} ${isWideMode ? 'wide-mode' : ''}`}
            style={getWrapperStyle()}
            data-deal-player={playerName}
            data-anchor-x={effectiveAnchorX}
            data-anchor-y={effectiveAnchorY}
            data-rotation={effectiveRotation}
            data-collision-prevention={isWideMode}
        >
            {/* Debug anchor point indicator */}
            {debugMode && (
                <div className="anchor-point-indicator" />
            )}
            
            {/* The actual player seat */}
            <PlayerSeat
                playerName={playerName}
                currentTableState={currentTableState}
                isSelf={isSelf}
                emitEvent={emitEvent}
                renderCard={renderCard}
                seatPosition={seatPosition}
                showTrumpIndicator={showTrumpIndicator}
                trumpIndicatorPuck={trumpIndicatorPuck}
                onPlayerProfile={onPlayerProfile}
            />
        </div>
    );
};

export default PlayerSeatPositioner;
