// frontend/src/utils/CardSpacingEngine.js
// Card spacing calculations based on Excel logic specifications

class CardSpacingEngine {
    constructor() {
        // Constants
        this.ASPECT_RATIO = 0.714; // Card width/height ratio (5:7)
        this.CARD_HEIGHT_PERCENTAGE = 0.10; // 10% of viewport height
        this.CONTAINER_PADDING_PERCENTAGE = 0.04; // 4% for padding calculation (reduced from 6%)
        this.BETWEEN_CARD_MARGIN_PERCENTAGE = 0.01; // 1% for card margins
    }

    /**
     * Calculate all spacing parameters for card layout
     * @param {number} viewportWidth - Current viewport width in pixels
     * @param {number} viewportHeight - Current viewport height in pixels
     * @param {number} cardsInHand - Number of cards in the player's hand
     * @returns {Object} Complete layout configuration
     */
    calculateLayout(viewportWidth, viewportHeight, cardsInHand) {
        // Core dimensions
        const cardHeight = Math.round(viewportHeight * this.CARD_HEIGHT_PERCENTAGE);
        const cardWidth = Math.round(cardHeight * this.ASPECT_RATIO);
        
        // Container padding - based on viewport with aspect ratio adjustment
        const playerHandPadding = viewportHeight * this.ASPECT_RATIO * this.CONTAINER_PADDING_PERCENTAGE;
        const containerLeftPadding = Math.round(playerHandPadding / 2);
        const containerRightPadding = containerLeftPadding;
        
        // Container width after padding
        const containerWidth = viewportWidth - (containerLeftPadding + containerRightPadding);
        
        // Card spacing
        const betweenCardMargin = Math.round(viewportHeight * this.ASPECT_RATIO * this.BETWEEN_CARD_MARGIN_PERCENTAGE);
        
        // Calculate total width needed for all cards with margins
        const totalHandWidth = (cardsInHand * cardWidth) + ((cardsInHand - 1) * betweenCardMargin);
        
        // Determine layout mode
        const layoutMode = totalHandWidth <= containerWidth ? 'CENTER_MODE' : 'OVERLAP_MODE';
        
        // Calculate card positions based on mode
        let cardPositions = [];
        let effectiveMargin = 0;
        
        if (layoutMode === 'OVERLAP_MODE') {
            // Overlap mode: edge-anchored with equal spacing
            const rightCardPosition = containerWidth - cardWidth;
            const spacing = cardsInHand > 1 ? rightCardPosition / (cardsInHand - 1) : 0;
            
            for (let i = 0; i < cardsInHand; i++) {
                cardPositions.push({
                    index: i,
                    left: Math.round(i * spacing),
                    mode: 'overlap'
                });
            }
            
            // For CSS margin calculation
            effectiveMargin = spacing - cardWidth;
            
        } else {
            // Center mode: cards centered with fixed margins
            const totalGroupWidth = totalHandWidth;
            const firstCardOffset = (containerWidth - totalGroupWidth) / 2;
            
            for (let i = 0; i < cardsInHand; i++) {
                cardPositions.push({
                    index: i,
                    left: Math.round(firstCardOffset + (i * (cardWidth + betweenCardMargin))),
                    mode: 'center'
                });
            }
            
            effectiveMargin = betweenCardMargin;
        }
        
        // Return comprehensive layout data
        return {
            // Viewport info
            viewport: {
                width: viewportWidth,
                height: viewportHeight
            },
            
            // Card dimensions
            card: {
                height: cardHeight,
                width: cardWidth,
                aspectRatio: this.ASPECT_RATIO
            },
            
            // Container configuration
            container: {
                width: containerWidth,
                leftPadding: containerLeftPadding,
                rightPadding: containerRightPadding,
                totalPadding: containerLeftPadding + containerRightPadding
            },
            
            // Layout mode and spacing
            layout: {
                mode: layoutMode,
                cardsInHand: cardsInHand,
                totalHandWidth: totalHandWidth,
                betweenCardMargin: betweenCardMargin,
                effectiveMargin: effectiveMargin,
                positions: cardPositions
            },
            
            // Debug information
            debug: {
                wouldFitWithMargins: totalHandWidth <= containerWidth,
                overlapAmount: layoutMode === 'OVERLAP_MODE' ? 
                    Math.round((cardWidth + effectiveMargin) - (containerWidth / (cardsInHand - 1))) : 0,
                excessSpace: layoutMode === 'CENTER_MODE' ? 
                    containerWidth - totalHandWidth : 0
            }
        };
    }
    
    /**
     * Calculate layout for a specific row (used in two-row Frog layout)
     * @param {number} viewportWidth - Current viewport width
     * @param {number} viewportHeight - Current viewport height  
     * @param {number} numCards - Number of cards in this row
     * @returns {Object} Layout configuration for the row
     */
    calculateRowLayout(viewportWidth, viewportHeight, numCards) {
        // Use main calculation but for specific card count
        return this.calculateLayout(viewportWidth, viewportHeight, numCards);
    }
    
    /**
     * Get CSS variables for styling
     * @param {Object} layout - Layout object from calculateLayout
     * @returns {Object} CSS variable key-value pairs
     */
    getCSSVariables(layout) {
        return {
            '--card-height': `${layout.card.height}px`,
            '--card-width': `${layout.card.width}px`,
            '--container-padding-left': `${layout.container.leftPadding}px`,
            '--container-padding-right': `${layout.container.rightPadding}px`,
            '--card-margin-left': `${layout.layout.effectiveMargin}px`,
            '--layout-mode': layout.layout.mode
        };
    }
    
    /**
     * Debug logger for development
     * @param {Object} layout - Layout object from calculateLayout
     */
    logDebugInfo(layout) {
        console.group('CardSpacingEngine Debug');
        console.log('Mode:', layout.layout.mode);
        console.log('Cards:', layout.layout.cardsInHand);
        console.log('Card Size:', `${layout.card.width}x${layout.card.height}px`);
        console.log('Container Width:', layout.container.width, 'px');
        console.log('Total Hand Width:', layout.layout.totalHandWidth, 'px');
        console.log('Effective Margin:', layout.layout.effectiveMargin, 'px');
        
        if (layout.layout.mode === 'OVERLAP_MODE') {
            console.log('Overlap Amount:', layout.debug.overlapAmount, 'px per card');
        } else {
            console.log('Excess Space:', layout.debug.excessSpace, 'px');
            console.log('Center Offset:', (layout.debug.excessSpace / 2), 'px');
        }
        
        console.table(layout.layout.positions);
        console.groupEnd();
    }
}

export default CardSpacingEngine;