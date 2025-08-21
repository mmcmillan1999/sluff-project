// Shared card layout calculations for consistency between components

export const calculateCardLayoutMode = (cardWidth, cardCount, viewportWidth) => {
    // YOUR EXACT FORMULA for mode decision
    const padding = viewportWidth / 200; // viewport/200 for edge padding
    const betweenCardPadding = viewportWidth / 200; // viewport/200 for between cards in center mode
    
    console.log('BETWEEN-CARD PADDING (vw/200):', betweenCardPadding.toFixed(4), 'px');
    
    // Calculate total space needed for center mode
    const totalCardsWidth = cardWidth * cardCount;
    const totalBetweenCardPadding = betweenCardPadding * (cardCount - 1);
    const totalEdgePadding = padding * 2;
    const totalPaddingRequired = totalEdgePadding + totalBetweenCardPadding;
    const totalSpaceNeeded = totalCardsWidth + totalPaddingRequired;
    
    // Mode decision: overlap if space needed > viewport
    const shouldOverlap = totalSpaceNeeded > viewportWidth;
    
    // Debug the mode decision
    console.log('MODE DECISION CALCULATION:');
    console.log('  Card width:', cardWidth, '× count:', cardCount, '=', totalCardsWidth);
    console.log('  Between-card padding:', betweenCardPadding.toFixed(4), '× gaps:', (cardCount - 1), '=', totalBetweenCardPadding.toFixed(4));
    console.log('  Edge padding:', padding.toFixed(4), '× 2 =', totalEdgePadding.toFixed(4));
    console.log('  Total padding:', totalPaddingRequired.toFixed(4));
    console.log('  Total space needed:', totalSpaceNeeded.toFixed(4));
    console.log('  Viewport:', viewportWidth);
    console.log('  Deficit:', (totalSpaceNeeded - viewportWidth).toFixed(4));
    console.log('  Mode:', shouldOverlap ? 'OVERLAP' : 'CENTER');
    
    // Calculate positions based on mode
    let cardPositions = [];
    let spacing = 0;
    let firstCardPosition = 0;
    
    if (shouldOverlap) {
        // OVERLAP MODE: Edge-anchored positioning
        const totalAvailable = viewportWidth - (padding * 2);
        const remainingSpace = totalAvailable - cardWidth; // Space for N-1 cards
        spacing = cardCount > 1 ? remainingSpace / (cardCount - 1) : 0;
        firstCardPosition = padding;
        
        for (let i = 0; i < cardCount; i++) {
            const left = padding + (i * spacing);
            const right = left + cardWidth;
            cardPositions.push({ left, right });
        }
    } else {
        // CENTER MODE: Your corrected spreadsheet formula
        // Cards are centered with equal left/right margins
        const totalCardsPlusGaps = totalCardsWidth + totalBetweenCardPadding;
        const leftMargin = (viewportWidth - totalCardsPlusGaps) / 2;
        firstCardPosition = leftMargin; // Start at left margin (11.1275px in your example)
        spacing = cardWidth + betweenCardPadding; // 127 + 3.305 = 130.305px
        
        console.log('CENTER MODE POSITIONING:');
        console.log('  First card starts at:', firstCardPosition.toFixed(4), 'px');
        console.log('  Card width:', cardWidth, 'px');
        console.log('  Inner margin (vw/200):', betweenCardPadding.toFixed(4), 'px');
        console.log('  Card-to-card spacing:', spacing.toFixed(4), 'px');
        
        for (let i = 0; i < cardCount; i++) {
            const left = firstCardPosition + (i * spacing);
            const right = left + cardWidth;
            cardPositions.push({ left, right });
            
            // Log the gap between cards
            if (i > 0) {
                const prevCardRight = cardPositions[i-1].right;
                const gap = left - prevCardRight;
                console.log(`  Gap between card ${i} and ${i+1}: ${gap.toFixed(4)}px (should be ${betweenCardPadding.toFixed(4)}px)`);
            }
        }
        
        const lastCardRight = cardPositions[cardCount - 1].right;
        console.log('  Last card ends at:', lastCardRight.toFixed(4), 'px');
        console.log('  Right margin:', (viewportWidth - lastCardRight).toFixed(4), 'px');
    }
    
    // Calculate margins
    const leftMargin = shouldOverlap ? padding : firstCardPosition;
    const rightMargin = shouldOverlap ? padding : 
        (viewportWidth - (firstCardPosition + (cardCount - 1) * spacing + cardWidth));
    
    // Calculate inner card margin (gap between cards)
    // In CENTER mode: always vw/200
    // In OVERLAP mode: spacing - cardWidth (can be negative)
    const innerCardMargin = shouldOverlap ? 
        spacing - cardWidth :  // Can be negative when overlapping
        betweenCardPadding;     // Always vw/200 in center mode
    
    return {
        mode: shouldOverlap ? 'OVERLAP' : 'CENTER',
        shouldOverlap,
        padding,
        betweenCardPadding,
        spacing,
        firstCardPosition,
        cardPositions,
        totalSpaceNeeded,
        spaceDeficit: totalSpaceNeeded - viewportWidth,
        leftMargin,
        rightMargin,
        innerCardMargin,
        // Debug info
        totalCardsWidth,
        totalBetweenCardPadding,
        totalPaddingRequired
    };
};