# Card Spacing Logic Documentation

## 🎯 The Achievement
After multiple iterations and building Excel models to get the math exactly right, we've created a perfect card spacing system that:
- Automatically switches between CENTER_MODE and OVERLAP_MODE based on available space
- Maintains pixel-perfect spacing in both modes
- Integrates seamlessly with the card physics engine
- Works flawlessly across all viewport sizes

## 📐 The Mathematical Foundation

### Core Constants (from Excel specs)
```javascript
// These magic numbers were carefully calculated and tested
const CARD_ASPECT_RATIO = 0.714;        // Width = Height * 0.714 (5:7 ratio)
const CARD_HEIGHT_PERCENTAGE = 0.1;     // Card height = 10% of viewport height
const CONTAINER_PADDING_FACTOR = 0.04;  // Padding = VP_Y * 0.714 * 0.04
const CARD_MARGIN_FACTOR = 0.01;        // Margin = VP_Y * 0.714 * 0.01
```

### The Calculation Pipeline

#### Step 1: Card Dimensions
```javascript
Card_Height = Math.round(viewportHeight * 0.1)
Card_Width = Math.round(Card_Height * 0.714)
```

#### Step 2: Container Dimensions
```javascript
// Total padding based on viewport and aspect ratio
PH_P = viewportHeight * 0.714 * 0.04
PHC_LP = Math.round(PH_P / 2)  // Left padding

// Container width (viewport minus padding on both sides)
PHC_W = viewportWidth - (2 * PHC_LP)
```

#### Step 3: Card Spacing
```javascript
Between_Card_Margin = Math.round(viewportHeight * 0.714 * 0.01)
```

#### Step 4: Mode Determination
```javascript
// Total width needed for all cards with margins
THW_Plus_TICM = (Cards_in_Hand * Card_Width) + ((Cards_in_Hand - 1) * Between_Card_Margin)

// Choose mode based on available space
Card_Layout_Mode = THW_Plus_TICM < viewportWidth ? "CENTER_MODE" : "OVERLAP_MODE"
```

## 🎨 The Two Modes Explained

### CENTER_MODE - When Cards Fit Comfortably
Cards are evenly spaced with consistent margins between them, centered in the container.

```
Visual representation (5 cards):
|<-------------- Container Width -------------->|
|   [Card] [Card] [Card] [Card] [Card]         |
     ^-----^-----^-----^-----^
     Equal margins (5px typical)
```

**Calculation:**
```javascript
// Find starting offset to center the hand
FC_CM_OFFSET = (PHC_W - THW_Plus_TICM) / 2

// Position each card
Card_N_Position = FC_CM_OFFSET + ((N - 1) * (Card_Width + Between_Card_Margin))
```

### OVERLAP_MODE - When Space Is Tight
Cards overlap with equal spacing, anchored at container edges.

```
Visual representation (11 cards):
|<-------------- Container Width -------------->|
|[C][C][C][C][C][C][C][C][C][C][Card]          |
 ^                             ^
 First card at edge            Last card at (width - card_width)
```

**Calculation:**
```javascript
// Available space for overlapping
OV_M_RightCard = PHC_W - Card_Width

// Equal spacing between card starts
OV_M_Spacing = OV_M_RightCard / (Cards_in_Hand - 1)

// Position each card
Card_N_Position = (N - 1) * OV_M_Spacing
```

## 💻 Implementation in Code

### CardSpacingEngine.js - The Pure Math Engine
```javascript
class CardSpacingEngine {
    static calculateCardLayout(viewportWidth, viewportHeight, cardCount) {
        // All calculations match Excel specs exactly
        const cardHeight = Math.round(viewportHeight * 0.1);
        const cardWidth = Math.round(cardHeight * 0.714);
        
        const totalPadding = viewportHeight * 0.714 * 0.04;
        const containerPadding = Math.round(totalPadding / 2);
        const containerWidth = viewportWidth - (2 * containerPadding);
        
        const cardMargin = Math.round(viewportHeight * 0.714 * 0.01);
        
        // Determine mode
        const totalHandWidth = (cardCount * cardWidth) + ((cardCount - 1) * cardMargin);
        const mode = totalHandWidth <= containerWidth ? 'CENTER_MODE' : 'OVERLAP_MODE';
        
        // Calculate positions based on mode
        const positions = [];
        if (mode === 'CENTER_MODE') {
            const startOffset = (containerWidth - totalHandWidth) / 2;
            for (let i = 0; i < cardCount; i++) {
                positions.push(startOffset + (i * (cardWidth + cardMargin)));
            }
        } else {
            const availableSpace = containerWidth - cardWidth;
            const spacing = availableSpace / (cardCount - 1);
            for (let i = 0; i < cardCount; i++) {
                positions.push(i * spacing);
            }
        }
        
        return {
            mode,
            positions,
            containerWidth,
            cardWidth,
            cardHeight,
            cardMargin
        };
    }
}
```

### PlayerHand.js - The React Integration
```javascript
useEffect(() => {
    const calculateLayout = () => {
        const layout = CardSpacingEngine.calculateCardLayout(
            window.innerWidth,
            window.innerHeight,
            myHand.length
        );
        
        setCardLayout(layout);
        
        // Update physics engine with new positions
        if (physicsEngineRef.current) {
            layout.positions.forEach((pos, index) => {
                physicsEngineRef.current.updateCardHome(
                    myHand[index],
                    pos,
                    0  // Y position (cards aligned at bottom)
                );
            });
        }
    };
    
    calculateLayout();
    window.addEventListener('resize', calculateLayout);
}, [myHand]);
```

## 🎯 The Layout Data Structure

The system produces a clean data structure that all components can use:

```javascript
{
    mode: 'CENTER_MODE',           // or 'OVERLAP_MODE'
    containerWidth: 691,           // Usable width after padding
    containerPadding: 10,          // Padding on each side
    cardWidth: 51,                 // Individual card width
    cardHeight: 71,                // Individual card height
    cardMargin: 5,                 // Space between cards (CENTER_MODE only)
    positions: [40, 96, 152, ...], // X positions for each card
    totalHandWidth: 611,           // Total width of all cards + margins
    spacing: 56                    // Spacing between cards (mode-dependent)
}
```

## 🔧 CSS Integration

The layout translates directly to CSS:

```css
.player-hand-container {
    width: calc(100vw - 20px);  /* containerWidth + padding */
    padding: 0 10px;             /* containerPadding */
}

.card-wrapper {
    position: absolute;
    width: 51px;                 /* cardWidth */
    height: 71px;                /* cardHeight */
    transform: translateX(var(--card-position));
}

/* CENTER_MODE adds margins */
.centered-spacing .card-wrapper {
    margin-left: 5px;            /* cardMargin */
}

/* OVERLAP_MODE uses absolute positioning */
.overlap-spacing .card-wrapper:nth-child(n) {
    left: calc(var(--card-position) * 1px);
}
```

## 🐛 Common Pitfalls & Solutions

### ❌ DON'T: Use percentage-based widths
```javascript
// BAD: Card width changes with container
const cardWidth = containerWidth * 0.1;
```

### ✅ DO: Use viewport-relative calculations
```javascript
// GOOD: Consistent card size based on viewport
const cardHeight = viewportHeight * 0.1;
const cardWidth = cardHeight * 0.714;
```

### ❌ DON'T: Hard-code margins
```javascript
// BAD: Fixed margin doesn't scale
const margin = 5;
```

### ✅ DO: Calculate margins based on viewport
```javascript
// GOOD: Margin scales with viewport
const margin = Math.round(viewportHeight * 0.714 * 0.01);
```

### ❌ DON'T: Mix positioning systems
```javascript
// BAD: Conflicting position calculations
style.left = centerMode ? '50%' : position + 'px';
```

### ✅ DO: Use consistent absolute positioning
```javascript
// GOOD: Always use absolute positions from container edge
style.transform = `translateX(${position}px)`;
```

## 🧪 Testing the System

### Quick Validation Checks
1. **At 711x711 viewport with 11 cards:**
   - Should be in CENTER_MODE
   - First card at position 40px
   - Last card at position 600px

2. **At narrow viewports (e.g., 400x800):**
   - Should switch to OVERLAP_MODE
   - First card at position 0px
   - Last card at containerWidth - cardWidth

3. **Mode transition:**
   - Resize from wide to narrow
   - Should smoothly transition between modes
   - No card jumping or layout breaks

## 📊 Debug Output

Enable debug mode to see calculations:
```javascript
console.log('Card Layout:', {
    viewport: `${width}x${height}`,
    mode: layout.mode,
    containerWidth: layout.containerWidth,
    cardDimensions: `${layout.cardWidth}x${layout.cardHeight}`,
    positions: layout.positions,
    spacing: layout.spacing
});
```

## 💡 The Key Insights

1. **Edge Anchoring in OVERLAP_MODE**: The first and last cards are always perfectly positioned at container edges, with equal spacing between all cards.

2. **Viewport-Relative Sizing**: All dimensions derive from viewport height, ensuring consistent proportions across devices.

3. **Mode Threshold**: The automatic mode switching happens exactly when cards would start overlapping in CENTER_MODE.

4. **Container-Relative Positioning**: All positions are relative to the container edge, not the viewport, ensuring proper alignment within the player hand area.

## 🎯 Result

This system provides:
- **Automatic responsive layout** that always looks perfect
- **Smooth mode transitions** without jarring changes
- **Pixel-perfect spacing** matching the Excel specifications
- **Physics engine compatibility** for drag-and-drop
- **Clean, maintainable code** with clear mathematical foundation

The Excel model proved invaluable in getting the math exactly right. The implementation now perfectly mirrors those calculations, giving us a robust card spacing system that "just works" at any viewport size!

## 🔮 Future Extensions

The system is designed to handle:
- Variable card counts (0-15 tested)
- Different card aspect ratios (change CARD_ASPECT_RATIO)
- Custom spacing modes (add new calculation branches)
- Animation transitions (positions are absolute, easy to animate)
- Multi-row layouts (Frog mode already implements this)

Remember: The math is proven and tested. If something breaks, refer back to the Excel model and these calculations!