import React, { useState, useEffect } from 'react';
import './PlayerHandAnchorDebug.css';

// Component to track actual footer element positions
const FooterPositionTracker = () => {
    const [measurements, setMeasurements] = useState({});
    const [hasLogged, setHasLogged] = useState(false);
    
    useEffect(() => {
        const measure = () => {
            const vh = window.innerHeight / 100;
            const measurements = {};
            
            // Measure game-view
            const gameView = document.querySelector('.game-view');
            if (gameView) {
                const rect = gameView.getBoundingClientRect();
                measurements.gameView = {
                    top: rect.top,
                    bottom: rect.bottom,
                    height: rect.height,
                    heightVh: (rect.height / vh).toFixed(1)
                };
            }
            
            // Measure footer
            const footer = document.querySelector('.game-footer');
            if (footer) {
                const rect = footer.getBoundingClientRect();
                measurements.footer = {
                    top: rect.top,
                    bottom: rect.bottom,
                    height: rect.height,
                    heightVh: (rect.height / vh).toFixed(1),
                    overflowPx: Math.max(0, rect.bottom - window.innerHeight)
                };
            }
            
            // Measure button panel
            const buttonPanel = document.querySelector('.button-panel');
            if (buttonPanel) {
                const rect = buttonPanel.getBoundingClientRect();
                measurements.buttonPanel = {
                    top: rect.top,
                    bottom: rect.bottom,
                    height: rect.height,
                    heightVh: (rect.height / vh).toFixed(1),
                    overflowPx: Math.max(0, rect.bottom - window.innerHeight)
                };
            }
            
            // Measure spacer
            const spacer = document.querySelector('.footer-bottom-spacer');
            if (spacer) {
                const rect = spacer.getBoundingClientRect();
                measurements.spacer = {
                    top: rect.top,
                    bottom: rect.bottom,
                    height: rect.height,
                    heightVh: (rect.height / vh).toFixed(1),
                    overflowPx: Math.max(0, rect.bottom - window.innerHeight)
                };
            }
            
            // Log to console on first measurement or when button is clicked
            if (!hasLogged && Object.keys(measurements).length > 0) {
                console.log('========================================');
                console.log('FOOTER DEBUG MEASUREMENTS');
                console.log('========================================');
                console.log(`Viewport Height: ${window.innerHeight}px (100vh)`);
                console.log('----------------------------------------');
                
                if (measurements.gameView) {
                    console.log('game-view:');
                    console.log(`  Height: ${measurements.gameView.heightVh}vh (${measurements.gameView.height}px)`);
                    console.log(`  Top: ${measurements.gameView.top}px`);
                    console.log(`  Bottom: ${measurements.gameView.bottom}px`);
                }
                
                if (measurements.footer) {
                    console.log('game-footer:');
                    console.log(`  Height: ${measurements.footer.heightVh}vh (${measurements.footer.height}px)`);
                    console.log(`  Top: ${measurements.footer.top}px`);
                    console.log(`  Bottom: ${measurements.footer.bottom}px`);
                    console.log(`  OVERFLOW: ${measurements.footer.overflowPx}px ${measurements.footer.overflowPx > 0 ? '❌ CLIPPED!' : '✅ OK'}`);
                }
                
                if (measurements.buttonPanel) {
                    console.log('button-panel:');
                    console.log(`  Height: ${measurements.buttonPanel.heightVh}vh (${measurements.buttonPanel.height}px)`);
                    console.log(`  Top: ${measurements.buttonPanel.top}px`);
                    console.log(`  Bottom: ${measurements.buttonPanel.bottom}px`);
                    console.log(`  OVERFLOW: ${measurements.buttonPanel.overflowPx}px ${measurements.buttonPanel.overflowPx > 0 ? '❌ CLIPPED!' : '✅ OK'}`);
                }
                
                if (measurements.spacer) {
                    console.log('footer-bottom-spacer:');
                    console.log(`  Height: ${measurements.spacer.heightVh}vh (${measurements.spacer.height}px)`);
                    console.log(`  Top: ${measurements.spacer.top}px`);
                    console.log(`  Bottom: ${measurements.spacer.bottom}px`);
                    console.log(`  OVERFLOW: ${measurements.spacer.overflowPx}px ${measurements.spacer.overflowPx > 0 ? '❌ CLIPPED!' : '✅ OK'}`);
                }
                
                console.log('========================================');
                console.log('Copy this data to share the measurements!');
                console.log('========================================');
                
                setHasLogged(true);
            }
            
            setMeasurements(measurements);
        };
        
        measure();
        const interval = setInterval(measure, 500);
        window.addEventListener('resize', measure);
        
        return () => {
            clearInterval(interval);
            window.removeEventListener('resize', measure);
        };
    }, [hasLogged]);
    
    return (
        <div style={{
            position: 'fixed',
            top: '50%',
            left: '20px',
            transform: 'translateY(-50%)',
            background: 'rgba(0, 0, 0, 0.9)',
            color: 'white',
            padding: '10px',
            fontSize: '11px',
            fontFamily: 'monospace',
            zIndex: 10001,
            maxWidth: '250px',
            borderRadius: '5px',
            border: '2px solid yellow'
        }}>
            <div style={{fontWeight: 'bold', marginBottom: '5px', color: 'yellow'}}>
                ACTUAL POSITIONS (px)
            </div>
            
            {measurements.gameView && (
                <div style={{marginBottom: '8px'}}>
                    <div style={{color: '#00ff00'}}>game-view:</div>
                    <div>Height: {measurements.gameView.heightVh}vh</div>
                    <div>Bottom: {measurements.gameView.bottom.toFixed(0)}px</div>
                </div>
            )}
            
            {measurements.footer && (
                <div style={{marginBottom: '8px'}}>
                    <div style={{color: '#ff00ff'}}>game-footer:</div>
                    <div>Height: {measurements.footer.heightVh}vh</div>
                    <div>Bottom: {measurements.footer.bottom.toFixed(0)}px</div>
                    <div style={{color: measurements.footer.overflowPx > 0 ? 'red' : 'lime'}}>
                        Overflow: {measurements.footer.overflowPx.toFixed(0)}px
                    </div>
                </div>
            )}
            
            {measurements.buttonPanel && (
                <div style={{marginBottom: '8px'}}>
                    <div style={{color: '#00ffff'}}>button-panel:</div>
                    <div>Height: {measurements.buttonPanel.heightVh}vh</div>
                    <div>Bottom: {measurements.buttonPanel.bottom.toFixed(0)}px</div>
                    <div style={{color: measurements.buttonPanel.overflowPx > 0 ? 'red' : 'lime'}}>
                        Overflow: {measurements.buttonPanel.overflowPx.toFixed(0)}px
                    </div>
                </div>
            )}
            
            {measurements.spacer && (
                <div style={{marginBottom: '8px'}}>
                    <div style={{color: '#ffff00'}}>spacer:</div>
                    <div>Height: {measurements.spacer.heightVh}vh</div>
                    <div>Bottom: {measurements.spacer.bottom.toFixed(0)}px</div>
                    <div style={{color: measurements.spacer.overflowPx > 0 ? 'red' : 'lime'}}>
                        Overflow: {measurements.spacer.overflowPx.toFixed(0)}px
                    </div>
                </div>
            )}
            
            <div style={{
                marginTop: '10px',
                paddingTop: '10px',
                borderTop: '1px solid #666',
                color: 'yellow'
            }}>
                Viewport: {window.innerHeight}px
            </div>
        </div>
    );
};

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
    const [debugMode, setDebugMode] = useState('playerseat'); // 'playerseat', 'playerhand', or 'footer'
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
                    <button 
                        className={`debug-mode-btn ${debugMode === 'footer' ? 'active' : ''}`}
                        onClick={() => setDebugMode('footer')}
                    >
                        Footer Debug
                    </button>
                </div>
                <div className="debug-info-grid">
                    {debugMode === 'footer' ? (
                        <>
                            <div className="debug-row">
                                <span className="debug-label">Footer Total:</span>
                                <span className="debug-value">20vh</span>
                            </div>
                            <div className="debug-row">
                                <span className="debug-label">PlayerHand:</span>
                                <span className="debug-value">flex: 1 (~14vh)</span>
                            </div>
                            <div className="debug-row">
                                <span className="debug-label">Controls:</span>
                                <span className="debug-value">flex: 0 0 6vh</span>
                            </div>
                            <div className="debug-separator"></div>
                            <div className="debug-row">
                                <span className="debug-label">White Area:</span>
                                <span className="debug-value">PlayerHand</span>
                            </div>
                            <div className="debug-row">
                                <span className="debug-label">Light Blue:</span>
                                <span className="debug-value">Controls Wrapper</span>
                            </div>
                            <div className="debug-row">
                                <span className="debug-label">Sky Blue:</span>
                                <span className="debug-value">Button Panel</span>
                            </div>
                            <div className="debug-separator"></div>
                            <div className="debug-row">
                                <span className="debug-label">Issue:</span>
                                <span className="debug-value" style={{color: 'red', fontSize: '11px'}}>
                                    Check if bottom red marker visible
                                </span>
                            </div>
                        </>
                    ) : debugMode === 'playerseat' ? (
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
            
            {/* Footer debug mode with colored backgrounds */}
            {debugMode === 'footer' && (
                <>
                    {/* Apply debug colors to actual footer elements */}
                    <style dangerouslySetInnerHTML={{__html: `
                        .game-footer {
                            background-color: rgba(255, 255, 255, 0.95) !important;
                            outline: 3px solid red !important; /* Use outline instead of border */
                        }
                        .player-hand-container {
                            background-color: rgba(255, 255, 255, 0.9) !important;
                            outline: 2px solid blue !important; /* Use outline instead of border */
                        }
                        .footer-controls-wrapper {
                            background-color: rgba(173, 216, 230, 0.95) !important; /* Light blue */
                            outline: 2px solid darkblue !important; /* Use outline instead of border */
                        }
                        .button-panel {
                            background: rgba(135, 206, 250, 0.9) !important; /* Sky blue */
                            outline: 2px solid orange !important; /* Use outline instead of border */
                        }
                        .insurance-controls-container {
                            background-color: rgba(176, 224, 230, 0.9) !important; /* Powder blue */
                            outline: 2px solid green !important; /* Use outline instead of border */
                        }
                        .footer-bottom-spacer {
                            background-color: rgba(255, 0, 0, 0.3) !important; /* Red spacer visible */
                            outline: 1px dashed yellow !important; /* Use outline instead of border */
                        }
                    `}} />
                    
                    {/* Real-time position tracker */}
                    <FooterPositionTracker />
                    
                    {/* Measurement overlay */}
                    <div className="footer-debug-measurements">
                        <div style={{
                            position: 'fixed',
                            bottom: '20vh',
                            left: '10px',
                            background: 'yellow',
                            padding: '5px',
                            fontSize: '12px',
                            fontWeight: 'bold',
                            zIndex: 10000
                        }}>
                            Footer: 20vh total
                        </div>
                        <div style={{
                            position: 'fixed',
                            bottom: '0',
                            right: '10px',
                            background: 'red',
                            color: 'white',
                            padding: '5px',
                            fontSize: '12px',
                            fontWeight: 'bold',
                            zIndex: 10000
                        }}>
                            Bottom Edge (Should see this!)
                        </div>
                    </div>
                </>
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