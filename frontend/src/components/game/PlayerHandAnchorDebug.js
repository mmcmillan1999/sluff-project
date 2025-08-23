import React, { useState, useEffect } from 'react';
import './PlayerHandAnchorDebug.css';

// Component to render measurement rulers for player seats
const PlayerSeatRulers = () => {
    const [measurements, setMeasurements] = useState({
        west: { width: 0, height: 0, widthVw: 0, heightVh: 0 },
        east: { width: 0, height: 0, widthVw: 0, heightVh: 0 }
    });

    useEffect(() => {
        const measureSeats = () => {
            const vw = window.innerWidth / 100;
            const vh = window.innerHeight / 100;
            
            // Find West player seat
            const westElements = document.querySelectorAll('.player-seat-positioner.player-seat-left .player-seat');
            if (westElements.length > 0) {
                const westRect = westElements[0].getBoundingClientRect();
                setMeasurements(prev => ({
                    ...prev,
                    west: { 
                        width: Math.round(westRect.width), 
                        height: Math.round(westRect.height),
                        widthVw: Math.round((westRect.width / vw) * 10) / 10,
                        heightVh: Math.round((westRect.height / vh) * 10) / 10,
                        left: westRect.left,
                        top: westRect.top,
                        right: westRect.right,
                        bottom: westRect.bottom
                    }
                }));
            }

            // Find East player seat
            const eastElements = document.querySelectorAll('.player-seat-positioner.player-seat-right .player-seat');
            if (eastElements.length > 0) {
                const eastRect = eastElements[0].getBoundingClientRect();
                setMeasurements(prev => ({
                    ...prev,
                    east: { 
                        width: Math.round(eastRect.width), 
                        height: Math.round(eastRect.height),
                        widthVw: Math.round((eastRect.width / vw) * 10) / 10,
                        heightVh: Math.round((eastRect.height / vh) * 10) / 10,
                        left: eastRect.left,
                        top: eastRect.top,
                        right: eastRect.right,
                        bottom: eastRect.bottom
                    }
                }));
            }
        };

        // Initial measurement
        measureSeats();
        
        // Update on resize
        const interval = setInterval(measureSeats, 500);
        window.addEventListener('resize', measureSeats);
        
        return () => {
            clearInterval(interval);
            window.removeEventListener('resize', measureSeats);
        };
    }, []);

    return (
        <>
            {/* West player ruler - positioned above and to the right */}
            {measurements.west.width > 0 && (
                <div 
                    className="seat-ruler west-ruler"
                    style={{
                        position: 'fixed',
                        left: `${measurements.west.right + 10}px`,
                        top: `${measurements.west.top - 30}px`,
                        pointerEvents: 'none',
                        zIndex: 10002
                    }}
                >
                    <div className="ruler-measurement">
                        W: {measurements.west.widthVw}vw
                    </div>
                    <div className="ruler-measurement">
                        H: {measurements.west.heightVh}vh
                    </div>
                </div>
            )}

            {/* East player ruler - positioned above and to the left */}
            {measurements.east.width > 0 && (
                <div 
                    className="seat-ruler east-ruler"
                    style={{
                        position: 'fixed',
                        right: `${window.innerWidth - measurements.east.left + 10}px`,
                        top: `${measurements.east.top - 30}px`,
                        pointerEvents: 'none',
                        zIndex: 10002
                    }}
                >
                    <div className="ruler-measurement">
                        W: {measurements.east.widthVw}vw
                    </div>
                    <div className="ruler-measurement">
                        H: {measurements.east.heightVh}vh
                    </div>
                </div>
            )}

            {/* Visual ruler lines for West */}
            {measurements.west.width > 0 && (
                <>
                    {/* Horizontal ruler line (width) */}
                    <div 
                        className="ruler-line horizontal"
                        style={{
                            position: 'fixed',
                            left: `${measurements.west.left}px`,
                            top: `${measurements.west.top - 15}px`,
                            width: `${measurements.west.width}px`,
                            height: '1px',
                            background: '#00ff00',
                            pointerEvents: 'none',
                            zIndex: 10001
                        }}
                    />
                    {/* Vertical ruler line (height) */}
                    <div 
                        className="ruler-line vertical"
                        style={{
                            position: 'fixed',
                            left: `${measurements.west.right + 5}px`,
                            top: `${measurements.west.top}px`,
                            width: '1px',
                            height: `${measurements.west.height}px`,
                            background: '#00ff00',
                            pointerEvents: 'none',
                            zIndex: 10001
                        }}
                    />
                </>
            )}

            {/* Visual ruler lines for East */}
            {measurements.east.width > 0 && (
                <>
                    {/* Horizontal ruler line (width) */}
                    <div 
                        className="ruler-line horizontal"
                        style={{
                            position: 'fixed',
                            left: `${measurements.east.left}px`,
                            top: `${measurements.east.top - 15}px`,
                            width: `${measurements.east.width}px`,
                            height: '1px',
                            background: '#00ff00',
                            pointerEvents: 'none',
                            zIndex: 10001
                        }}
                    />
                    {/* Vertical ruler line (height) */}
                    <div 
                        className="ruler-line vertical"
                        style={{
                            position: 'fixed',
                            left: `${measurements.east.left - 5}px`,
                            top: `${measurements.east.top}px`,
                            width: '1px',
                            height: `${measurements.east.height}px`,
                            background: '#00ff00',
                            pointerEvents: 'none',
                            zIndex: 10001
                        }}
                    />
                </>
            )}
        </>
    );
};

const PlayerHandAnchorDebug = () => {
    const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
    const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [panelPosition, setPanelPosition] = useState({ x: window.innerWidth / 2 - 140, y: window.innerHeight / 2 - 150 });
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const [debugMode, setDebugMode] = useState('playerseat'); // 'playerseat' or 'playerhand'
    const [panelScale, setPanelScale] = useState(1); // Scale factor for zoom
    const [playerHandInfo, setPlayerHandInfo] = useState({
        cardWidth: 0,
        cardHeight: 0,
        cardCount: 0,
        mode: 'unknown',
        containerWidth: 0
    });
    const [seatWidthInfo, setSeatWidthInfo] = useState({
        widthVw: 0,
        isWideMode: false
    });

    const handleDragStart = (e) => {
        setIsDragging(true);
        setDragStart({
            x: e.clientX - panelPosition.x,
            y: e.clientY - panelPosition.y
        });
        e.preventDefault();
    };

    const handleZoomIn = () => {
        setPanelScale(prev => Math.min(prev * 1.05, 2)); // Max 2x scale
    };

    const handleZoomOut = () => {
        setPanelScale(prev => Math.max(prev * 0.95, 0.5)); // Min 0.5x scale
    };

    useEffect(() => {
        const handleMouseMove = (e) => {
            setMousePos({ x: e.clientX, y: e.clientY });
            
            if (isDragging) {
                setPanelPosition({
                    x: e.clientX - dragStart.x,
                    y: e.clientY - dragStart.y
                });
            }
        };
        
        const handleMouseUp = () => {
            setIsDragging(false);
        };

        const handleResize = () => {
            setViewportSize({
                width: window.innerWidth,
                height: window.innerHeight
            });
            
            // Calculate seat width in vw
            const seatWidthVh = 17.5; // 7vh * 2.5 aspect ratio
            const vh = window.innerHeight / 100;
            const vw = window.innerWidth / 100;
            const seatWidthInPixels = seatWidthVh * vh;
            const seatWidthInVw = seatWidthInPixels / vw;
            
            // Debug log
            console.log('[Debug Overlay] Seat width calc:', {
                viewport: `${window.innerWidth}x${window.innerHeight}`,
                seatWidthVh,
                vh,
                vw,
                seatWidthInPixels,
                seatWidthInVw,
                shouldBeWide: seatWidthInVw > 25
            });
            
            setSeatWidthInfo({
                widthVw: Math.round(seatWidthInVw * 10) / 10,
                isWideMode: seatWidthInVw > 25
            });
        };

        // Initial setup
        handleResize();

        // Add event listeners
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
            window.removeEventListener('resize', handleResize);
        };
    }, [isDragging, dragStart]);

    // Update PlayerHand info when in playerhand mode
    useEffect(() => {
        if (debugMode !== 'playerhand') return;

        const updatePlayerHandInfo = () => {
            const handContainer = document.querySelector('.player-hand-container');
            const handCards = document.querySelector('.player-hand-cards');
            // Look for cards with multiple possible selectors
            let cards = document.querySelectorAll('.player-hand-cards .card-display');
            if (cards.length === 0) {
                cards = document.querySelectorAll('.player-hand-cards button.card-display');
            }
            if (cards.length === 0) {
                cards = document.querySelectorAll('.player-hand-cards span.card-display');
            }
            
            if (handCards && cards.length > 0) {
                const firstCard = cards[0];
                const wrapper = firstCard.closest('.player-hand-card-wrapper');
                const wrapperStyle = wrapper ? window.getComputedStyle(wrapper) : null;
                const vh = window.innerHeight / 100;
                
                // Calculate card dimensions
                const cardHeight = firstCard.offsetHeight;
                const cardWidth = firstCard.offsetWidth;
                
                // Determine mode based on centered-spacing class or margin from wrapper
                const isCentered = handCards.classList.contains('centered-spacing');
                const marginLeft = wrapperStyle ? parseFloat(wrapperStyle.marginLeft) || 0 : 0;
                
                // Get the CSS variable for card margin
                const handCardsStyle = window.getComputedStyle(handCards);
                const cssMargin = parseFloat(handCardsStyle.getPropertyValue('--card-margin-left')) || 0;
                
                let mode = 'unknown';
                if (isCentered) {
                    mode = 'Centered (2px gaps)';
                } else if (cssMargin < 0) {
                    mode = `Overlap (${Math.abs(cssMargin)}px)`;
                } else if (cssMargin >= 0 && cssMargin <= 2) {
                    mode = `Edge-anchor (${cssMargin}px gap)`;
                } else {
                    mode = `Spaced (${cssMargin}px)`;
                }
                
                setPlayerHandInfo({
                    cardWidth: Math.round(cardWidth),
                    cardHeight: Math.round(cardHeight),
                    cardCount: cards.length,
                    mode: mode,
                    containerWidth: handContainer ? handContainer.offsetWidth : 0
                });
            } else {
                // No cards found, show debug info
                setPlayerHandInfo({
                    cardWidth: 0,
                    cardHeight: 0,
                    cardCount: 0,
                    mode: 'No cards detected',
                    containerWidth: handContainer ? handContainer.offsetWidth : 0
                });
            }
        };

        // Initial update with a small delay to ensure DOM is ready
        setTimeout(updatePlayerHandInfo, 100);

        // Update on resize and periodically
        const interval = setInterval(updatePlayerHandInfo, 500);
        window.addEventListener('resize', updatePlayerHandInfo);

        return () => {
            clearInterval(interval);
            window.removeEventListener('resize', updatePlayerHandInfo);
        };
    }, [debugMode]);

    // Calculate VW and VH values
    const vw = viewportSize.width / 100;
    const vh = viewportSize.height / 100;
    
    // Convert mouse position to VW/VH
    const mouseVw = vw > 0 ? Math.round(mousePos.x / vw * 10) / 10 : 0;
    const mouseVh = vh > 0 ? Math.round(mousePos.y / vh * 10) / 10 : 0;
    
    // Calculate the gap between West player seat and card play area
    const calculateWestGap = () => {
        // Player seat calculations
        const seatEdgeOffset = 2.5; // vh from edge
        const seatWidth = 22; // vh width
        
        // Convert vh to vw for consistent units
        const vhToVw = vh / vw;
        const seatRightEdgeVw = (seatEdgeOffset + seatWidth) * vhToVw;
        
        // Card play area calculations
        const cardHeight = 10; // vh (standard card height)
        const cardWidth = cardHeight * 0.714; // aspect ratio
        const cardHalfWidth = cardWidth / 2;
        const cardPadding = 1; // vh padding
        
        // Card is centered at 50vw, so left edge is at:
        const cardLeftEdgeVw = 50 - ((cardHalfWidth + cardPadding) * vhToVw);
        
        // Calculate gap
        const gap = cardLeftEdgeVw - seatRightEdgeVw;
        
        // Round to 1 decimal place
        return Math.round(gap * 10) / 10;
    };

    // Define anchor points for reference positions (removed West/East as they're now controlled by PlayerSeatPositioner)
    const anchors = [
        // Bottom player (South) - center bottom
        { 
            name: 'South', 
            style: { 
                left: '50%', 
                bottom: '12%',
                transform: 'translateX(-50%)'
            }
        },
        // Top player (North/Widow) - center top
        { 
            name: 'North', 
            style: { 
                left: '50%', 
                top: '0.25vh',
                transform: 'translateX(-50%)'
            }
        }
    ];

    return (
        <div className="playerhand-anchor-debug">
            {/* Viewport and Mouse Info Panel */}
            <div 
                className="debug-info-panel"
                style={{
                    left: `${panelPosition.x}px`,
                    top: `${panelPosition.y}px`,
                    right: 'auto',
                    transform: `scale(${panelScale})`,
                    transformOrigin: 'top left',
                    cursor: isDragging ? 'grabbing' : 'default'
                }}
            >
                <div className="debug-panel-header">
                    <div className="debug-title">DEBUG OVERLAY</div>
                    <div className="debug-controls">
                        <button 
                            className="debug-zoom-btn"
                            onClick={handleZoomOut}
                            title="Zoom out (5%)"
                        >
                            −
                        </button>
                        <button 
                            className="debug-zoom-btn"
                            onClick={handleZoomIn}
                            title="Zoom in (5%)"
                        >
                            +
                        </button>
                        <button 
                            className="debug-drag-handle"
                            onMouseDown={handleDragStart}
                            title="Drag to move panel"
                        >
                            ⋮⋮
                        </button>
                    </div>
                </div>
                <div className="debug-mode-toggles">
                    <button 
                        className={`debug-mode-btn ${debugMode === 'playerseat' ? 'active' : ''}`}
                        onClick={() => setDebugMode('playerseat')}
                    >
                        PlayerSeat
                    </button>
                    <button 
                        className={`debug-mode-btn ${debugMode === 'playerhand' ? 'active' : ''}`}
                        onClick={() => setDebugMode('playerhand')}
                    >
                        PlayerHand
                    </button>
                </div>
                <div className="debug-info-grid">
                    {debugMode === 'playerseat' ? (
                        <>
                            <div className="debug-row">
                                <span className="debug-label">Viewport:</span>
                                <span className="debug-value">{viewportSize.width} x {viewportSize.height}</span>
                            </div>
                            <div className="debug-row">
                                <span className="debug-label">Mouse X:</span>
                                <span className="debug-value">{mousePos.x}</span>
                            </div>
                            <div className="debug-row">
                                <span className="debug-label">Mouse Y:</span>
                                <span className="debug-value">{mousePos.y}</span>
                            </div>
                            <div className="debug-row">
                                <span className="debug-label">VW/VH:</span>
                                <span className="debug-value">{mouseVw}vw, {mouseVh}vh</span>
                            </div>
                            <div className="debug-separator"></div>
                            <div className="debug-row">
                                <span className="debug-label">1vw =</span>
                                <span className="debug-value">{Math.round(vw * 10) / 10}px</span>
                            </div>
                            <div className="debug-row">
                                <span className="debug-label">1vh =</span>
                                <span className="debug-value">{Math.round(vh * 10) / 10}px</span>
                            </div>
                            <div className="debug-separator"></div>
                            <div className="debug-row">
                                <span className="debug-label">Aspect Ratio:</span>
                                <span className="debug-value">{viewportSize.height > 0 ? (viewportSize.width / viewportSize.height).toFixed(2) : '0'}</span>
                            </div>
                            <div className="debug-separator"></div>
                            <div className="debug-row">
                                <span className="debug-label">Seat Width:</span>
                                <span className="debug-value" style={{color: seatWidthInfo.isWideMode ? '#ff0000' : '#00ff00'}}>
                                    {seatWidthInfo.widthVw}vw
                                </span>
                            </div>
                            <div className="debug-row">
                                <span className="debug-label">Mode:</span>
                                <span className="debug-value" style={{
                                    color: seatWidthInfo.isWideMode ? '#ff0000' : '#00ff00',
                                    fontWeight: 'bold'
                                }}>
                                    {seatWidthInfo.isWideMode ? 'COLLISION PREVENT' : 'Normal'}
                                </span>
                            </div>
                            {seatWidthInfo.isWideMode && (
                                <>
                                    <div className="debug-row">
                                        <span className="debug-label" style={{color: '#ff0000'}}>Positions:</span>
                                        <span className="debug-value" style={{color: '#ff0000', fontSize: '10px'}}>
                                            W: 1vw, E: 99vw @ 35vh
                                        </span>
                                    </div>
                                    <div className="debug-row">
                                        <span className="debug-label" style={{color: '#ff0000'}}>Rotations:</span>
                                        <span className="debug-value" style={{color: '#ff0000', fontSize: '10px'}}>
                                            W: 90°, E: -90°
                                        </span>
                                    </div>
                                </>
                            )}
                        </>
                    ) : (
                        <>
                            <div className="debug-row">
                                <span className="debug-label">Viewport:</span>
                                <span className="debug-value">{viewportSize.width} x {viewportSize.height}</span>
                            </div>
                            <div className="debug-row">
                                <span className="debug-label">Mouse X/Y:</span>
                                <span className="debug-value">{mousePos.x}, {mousePos.y}</span>
                            </div>
                            <div className="debug-separator"></div>
                            <div className="debug-row">
                                <span className="debug-label">Card Size:</span>
                                <span className="debug-value">{playerHandInfo.cardWidth} x {playerHandInfo.cardHeight}px</span>
                            </div>
                            <div className="debug-row">
                                <span className="debug-label">Cards:</span>
                                <span className="debug-value">{playerHandInfo.cardCount} cards</span>
                            </div>
                            <div className="debug-row">
                                <span className="debug-label">Mode:</span>
                                <span className="debug-value" style={{fontSize: '11px'}}>{playerHandInfo.mode}</span>
                            </div>
                            <div className="debug-separator"></div>
                            <div className="debug-row">
                                <span className="debug-label">Container:</span>
                                <span className="debug-value">{playerHandInfo.containerWidth}px wide</span>
                            </div>
                            <div className="debug-row">
                                <span className="debug-label">Card VH:</span>
                                <span className="debug-value">{playerHandInfo.cardHeight > 0 ? (playerHandInfo.cardHeight / vh).toFixed(1) : 0}vh</span>
                            </div>
                            <div className="debug-row">
                                <span className="debug-label">Aspect:</span>
                                <span className="debug-value">{playerHandInfo.cardHeight > 0 ? (playerHandInfo.cardWidth / playerHandInfo.cardHeight).toFixed(3) : '0.714'}</span>
                            </div>
                        </>
                    )}
                </div>
            </div>
            
            {/* PlayerHand debug mode content */}
            {debugMode === 'playerhand' && (
                <div className="playerhand-debug-overlay">
                    <div className="game-footer-outline">
                        <div className="debug-label-overlay" style={{backgroundColor: 'rgba(255, 102, 0, 0.9)'}}>Game Footer (20vh)</div>
                    </div>
                    <div className="playerhand-container-outline">
                        <div className="debug-label-overlay" style={{backgroundColor: 'rgba(255, 0, 255, 0.9)'}}>PlayerHand Container (13vh)</div>
                    </div>
                    <div className="playerhand-cards-outline">
                        <div className="debug-label-overlay" style={{backgroundColor: 'rgba(0, 255, 255, 0.9)', top: '50%', transform: 'translateY(-50%)'}}>Cards Area</div>
                    </div>
                    <div className="turn-indicator-outline">
                        <div className="debug-label-overlay" style={{backgroundColor: 'rgba(255, 255, 0, 0.9)', top: 'auto', bottom: '5px'}}>Turn Indicator (pulses)</div>
                    </div>
                    <div className="footer-controls-outline">
                        <div className="debug-label-overlay" style={{backgroundColor: 'rgba(0, 255, 0, 0.9)', top: '50%', transform: 'translateY(-50%)'}}>Footer Controls (Insurance + Menu) 7vh</div>
                    </div>
                </div>
            )}

            {/* Render anchor dots only in playerseat mode */}
            {debugMode === 'playerseat' && anchors.filter(a => !a.name.includes('Puck')).map((anchor, index) => (
                <div 
                    key={index}
                    className={`anchor-dot ${anchor.small ? 'anchor-dot-small' : ''}`}
                    style={anchor.style}
                    title={anchor.name}
                >
                    <div className="anchor-label">{anchor.name}</div>
                </div>
            ))}
            
            {/* Removed PlayerSeatMarkers - now using anchor indicators in PlayerSeatPositioner */}
            
            {/* Add ruler measurements for player seats */}
            {debugMode === 'playerseat' && <PlayerSeatRulers />}

            {/* Grid overlay for reference - only in playerseat mode */}
            {debugMode === 'playerseat' && (
            <div className="debug-grid-overlay">
                {/* Vertical center line */}
                <div className="debug-line vertical-center"></div>
                {/* Horizontal center line */}
                <div className="debug-line horizontal-center"></div>
                {/* Edge markers */}
                <div className="debug-edge-marker top">TOP</div>
                <div className="debug-edge-marker bottom">BOTTOM</div>
                <div className="debug-edge-marker left">LEFT</div>
                <div className="debug-edge-marker right">RIGHT</div>
            </div>
            )}
        </div>
    );
};

export default PlayerHandAnchorDebug;