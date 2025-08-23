// PlayerSeatConfig.js
// Centralized configuration for player seat positioning
// Fixed positions - no collision detection or rotation

export const PLAYER_SEAT_CONFIG = {
    // West (Left) Player Configuration
    west: {
        // Fixed anchor point - bottom center of nameplate is pinned here
        anchorX: 15,    // vw units - FIXED
        anchorY: 45,    // vh units - FIXED
        rotation: 0     // degrees - NO ROTATION
    },
    
    // East (Right) Player Configuration
    east: {
        // Fixed anchor point - bottom center of nameplate is pinned here
        anchorX: 85,    // vw units - FIXED
        anchorY: 45,    // vh units - FIXED
        rotation: 0     // degrees - NO ROTATION
    },
    
    // South (Bottom) Player Configuration
    south: {
        // Fixed anchor point - bottom center of nameplate is pinned here
        anchorX: 50,    // vw units - FIXED (center)
        anchorY: 75,    // vh units - FIXED
        rotation: 0     // degrees - NO ROTATION
    },
    
    // North (Top) Player Configuration - for 4th player/widow
    north: {
        // Fixed anchor point - bottom center of nameplate is pinned here
        anchorX: 50,    // vw units - centered at 50vw
        anchorY: 17,    // vh units - at 17vh from top
        rotation: 0     // degrees - no rotation
    },
    
    // Global settings
    global: {
        enableDebugAnchors: false,  // Show anchor point indicators (controlled by debug overlay)
        smoothTransitions: true     // Smooth animation between positions
    }
};

// Helper function to get configuration for a specific seat
// Simply returns the fixed configuration for each seat
export const getSeatConfig = (seatPosition) => {
    const positionMap = {
        'left': 'west',
        'right': 'east',
        'bottom': 'south',
        'top': 'north'  // Added for widow/4th player
    };
    
    const configKey = positionMap[seatPosition] || seatPosition;
    const config = PLAYER_SEAT_CONFIG[configKey];
    
    return config || {};
};