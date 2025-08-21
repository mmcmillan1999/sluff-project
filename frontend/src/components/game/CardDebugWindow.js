// frontend/src/components/game/CardDebugWindow.js
import React, { useState, useEffect } from 'react';
import './CardDebugWindow.css';
import { calculateCardLayoutMode } from '../../utils/cardLayoutCalculations';

const CardDebugWindow = ({ currentTableState, playerId }) => {
    const [cardWidth, setCardWidth] = useState(0);
    const [cardHeight, setCardHeight] = useState(0);
    const [cardCount, setCardCount] = useState(0);
    const [viewportWidth, setViewportWidth] = useState(window.innerWidth);
    const [actualLastCardRight, setActualLastCardRight] = useState(0);

    useEffect(() => {
        // Update viewport width on resize
        const updateViewport = () => {
            setViewportWidth(window.innerWidth);
        };

        window.addEventListener('resize', updateViewport);
        return () => window.removeEventListener('resize', updateViewport);
    }, []);

    useEffect(() => {
        // Calculate card dimensions based on viewport
        const calculateCardSize = () => {
            // Card height is 13vh (from PlayerHand.css)
            const height = window.innerHeight * 0.13;
            // Card width maintains 5:7 aspect ratio (width = height * 0.714)
            const width = height * 0.714;
            
            setCardHeight(Math.round(height));
            setCardWidth(Math.round(width));
        };

        calculateCardSize();
        window.addEventListener('resize', calculateCardSize);
        
        return () => window.removeEventListener('resize', calculateCardSize);
    }, []);

    useEffect(() => {
        // Count cards in player's hand
        if (currentTableState && playerId) {
            const player = Object.values(currentTableState.players || {}).find(p => p.userId === playerId);
            if (player && currentTableState.hands && currentTableState.hands[player.playerName]) {
                setCardCount(currentTableState.hands[player.playerName].length);
            } else {
                setCardCount(0);
            }
        }
    }, [currentTableState, playerId]);

    // Use shared calculation function for consistency
    const layoutInfo = cardCount > 0 && cardWidth > 0 ? 
        calculateCardLayoutMode(cardWidth, cardCount, viewportWidth) : 
        {
            mode: 'CENTER',
            shouldOverlap: false,
            padding: viewportWidth / 200,
            spacing: 0,
            firstCardPosition: 0,
            cardPositions: [],
            totalSpaceNeeded: 0,
            spaceDeficit: 0
        };
    
    const {
        mode,
        shouldOverlap,
        padding,
        spacing: actualSpacing,
        firstCardPosition,
        cardPositions,
        totalSpaceNeeded,
        spaceDeficit,
        leftMargin,
        rightMargin,
        innerCardMargin
    } = layoutInfo;
    
    const recommendedMode = mode + " MODE";
    const modeColor = shouldOverlap ? "#ff9900" : "#00ffff";
    const totalCardWidth = cardWidth * cardCount;
    
    // Find where the last card ACTUALLY is
    useEffect(() => {
        const findLastCard = () => {
            const cardElements = document.querySelectorAll('.player-hand-card-wrapper');
            if (cardElements.length > 0) {
                const lastCard = cardElements[cardElements.length - 1];
                const rect = lastCard.getBoundingClientRect();
                setActualLastCardRight(Math.round(rect.right));
                
                // Log all the debug info to console
                console.log('=== CARD LAYOUT DEBUG (SHARED CALC) ===');
                console.log(`Mode: ${mode}`);
                console.log(`Card Size: ${cardWidth} x ${cardHeight}px`);
                console.log(`Cards in Hand: ${cardCount}`);
                console.log(`Viewport: ${viewportWidth}px`);
                console.log(`Space Needed: ${totalSpaceNeeded.toFixed(2)}px`);
                console.log(`Space Deficit: ${spaceDeficit.toFixed(2)}px`);
                console.log(`Card Spacing: ${actualSpacing.toFixed(2)}px`);
                console.log(`First Card: ${firstCardPosition.toFixed(2)}px`);
                if (cardPositions.length > 0) {
                    console.log(`SHOULD BE: ${cardPositions[0].left.toFixed(0)} → ${cardPositions[cardPositions.length - 1].right.toFixed(0)}px`);
                }
                console.log(`Last Card IS: ${Math.round(rect.right)}px`);
                console.log('========================');
            }
        };
        
        // Check position after a short delay to let cards render
        setTimeout(findLastCard, 100);
        
        // Also check on resize
        window.addEventListener('resize', findLastCard);
        return () => window.removeEventListener('resize', findLastCard);
    }, [cardCount, viewportWidth, cardWidth, cardHeight, totalCardWidth, actualSpacing, padding, cardPositions, recommendedMode, shouldOverlap, mode, totalSpaceNeeded, spaceDeficit, firstCardPosition]);

    return (
        <div className="card-debug-window">
            <div className="card-debug-title">Card Layout Debug</div>
            <div className="card-debug-info">
                <div className="card-debug-section">
                    <span className="card-debug-label">Card Size:</span>
                    <span className="card-debug-value">{cardWidth} x {cardHeight}px</span>
                </div>
                <div className="card-debug-section">
                    <span className="card-debug-label">Cards in Hand:</span>
                    <span className="card-debug-value">{cardCount}</span>
                </div>
                <div className="card-debug-section">
                    <span className="card-debug-label">Total Width:</span>
                    <span className="card-debug-value">{totalCardWidth}px</span>
                </div>
                <div className="card-debug-section" style={{ borderTop: '2px solid #00ff00', paddingTop: '8px', marginTop: '8px' }}>
                    <span className="card-debug-label">SHOULD BE:</span>
                    <span className="card-debug-value" style={{ color: '#00ffff' }}>
                        {cardPositions.length > 0 ? 
                            `${Math.round(cardPositions[0].left)} → ${Math.round(cardPositions[cardPositions.length - 1].right)}px` :
                            'Calculating...'}
                    </span>
                </div>
                <div className="card-debug-section">
                    <span className="card-debug-label">Card Spacing:</span>
                    <span className="card-debug-value">
                        {actualSpacing ? actualSpacing.toFixed(2) : '0'}px
                        {shouldOverlap ? ' (overlap)' : ' (center)'}
                    </span>
                </div>
                <div className="card-debug-section">
                    <span className="card-debug-label">Padding:</span>
                    <span className="card-debug-value">{padding.toFixed(2)}px</span>
                </div>
                <div className="card-debug-section">
                    <span className="card-debug-label">Last Card IS:</span>
                    <span className="card-debug-value" style={{ color: actualLastCardRight < viewportWidth - 100 ? '#ff0000' : '#00ff00' }}>
                        {actualLastCardRight}px
                    </span>
                </div>
                <div className="card-debug-section">
                    <span className="card-debug-label">10th Card:</span>
                    <span className="card-debug-value" style={{ color: '#ffff00' }}>
                        {cardCount >= 10 ? `${cardPositions[9].left.toFixed(1)} → ${cardPositions[9].right.toFixed(1)}px` : 'N/A'}
                    </span>
                </div>
                <div className="card-debug-section" style={{ borderTop: '2px solid #00ff00', paddingTop: '8px', marginTop: '8px' }}>
                    <span className="card-debug-label">Mode:</span>
                    <span className="card-debug-value" style={{ color: modeColor, fontWeight: 'bold' }}>
                        {recommendedMode}
                    </span>
                </div>
                <div className="card-debug-section">
                    <span className="card-debug-label">Space Needed:</span>
                    <span className="card-debug-value">
                        {totalSpaceNeeded.toFixed(1)}px
                    </span>
                </div>
                <div className="card-debug-section">
                    <span className="card-debug-label">Space Deficit:</span>
                    <span className="card-debug-value" style={{ color: spaceDeficit > 0 ? '#ff9900' : '#00ff00' }}>
                        {spaceDeficit > 0 ? '+' : ''}{spaceDeficit.toFixed(1)}px
                    </span>
                </div>
                <div className="card-debug-section" style={{ borderTop: '2px solid #00ff00', paddingTop: '8px', marginTop: '8px' }}>
                    <span className="card-debug-label">Left Margin:</span>
                    <span className="card-debug-value">
                        {leftMargin ? leftMargin.toFixed(4) : '0'}px
                    </span>
                </div>
                <div className="card-debug-section">
                    <span className="card-debug-label">Right Margin:</span>
                    <span className="card-debug-value">
                        {rightMargin ? rightMargin.toFixed(4) : '0'}px
                    </span>
                </div>
                <div className="card-debug-section">
                    <span className="card-debug-label">Inner Card Margin:</span>
                    <span className="card-debug-value" style={{ 
                        color: innerCardMargin < 0 ? '#ff6666' : 
                               innerCardMargin === 0 ? '#ffff00' : 
                               '#00ff00' 
                    }}>
                        {innerCardMargin ? innerCardMargin.toFixed(4) : '0'}px
                        {innerCardMargin < 0 ? ' (overlap)' : 
                         innerCardMargin === 0 ? ' (touch)' : 
                         ' (gap)'}
                    </span>
                </div>
                <div className="card-debug-comparison">
                    <span style={{ color: '#888', fontSize: '18px' }}>
                        {totalSpaceNeeded.toFixed(0)}px {shouldOverlap ? '>' : '≤'} {viewportWidth}px viewport
                    </span>
                </div>
            </div>
        </div>
    );
};

export default CardDebugWindow;