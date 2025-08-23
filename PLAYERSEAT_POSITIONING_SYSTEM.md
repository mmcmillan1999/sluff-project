# PlayerSeat Positioning System Documentation

## 🎯 The Achievement
After many attempts, we successfully created a robust player seat positioning system that:
- Positions seats precisely using anchor points
- Automatically detects when collision prevention is needed
- Rotates seats smoothly while maintaining exact edge distances
- Works flawlessly across all viewport sizes

## 🔑 The Key Insight: The Wrapper Pattern

The breakthrough was creating a **wrapper component** (`PlayerSeatPositioner`) that acts as a positioning container around the actual content (`PlayerSeat`). This separation of concerns is crucial:

```
PlayerSeatPositioner (wrapper - handles positioning/rotation)
    └── PlayerSeat (content - handles display)
```

## 📍 The Anchor Point System

### The "Dart Through Paper" Mental Model
Think of each player seat as having a dart stuck through its bottom-center point. The dart pins the seat to the table at specific coordinates:

```javascript
// The anchor point is the bottom-center of the element
style.transform = `translate(-50%, -100%) rotate(${rotation}deg)`;
style.transformOrigin = '50% 100%'; // bottom center
```

- `translate(-50%, -100%)` moves the element so its bottom-center aligns with the anchor point
- `transformOrigin: '50% 100%'` ensures rotation happens around that bottom-center point

### Fixed Dimensions Are Critical
The seats have fixed dimensions that scale with viewport height:
- **Height**: 7vh (fixed)
- **Width**: 17.5vh (7vh × 2.5 aspect ratio)
- **All internal elements**: Scale proportionally using `calc(7vh * percentage)`

## 🔄 Collision Prevention Mode

### The Detection Formula
```javascript
const seatWidthVh = 17.5;  // 7vh * 2.5 aspect ratio
const vh = window.innerHeight / 100;
const vw = window.innerWidth / 100;
const seatWidthInPixels = seatWidthVh * vh;
const seatWidthInVw = seatWidthInPixels / vw;

const shouldActivateCollisionPrevention = seatWidthInVw > 25;
```

When the seat width exceeds 25vw (happens in narrow/tall viewports), collision prevention activates.

### The Position & Rotation Solution

**Normal Mode** (wide viewports):
```javascript
const defaultAnchors = {
    left: { x: 15, y: 45 },     // West: 15vw from left, 45vh from top
    right: { x: 85, y: 45 },    // East: 85vw from left, 45vh from top
    bottom: { x: 50, y: 75 }    // South: centered at 50vw, 75vh from top
};
```

**Collision Prevention Mode** (narrow viewports):
```javascript
const collisionPreventionAnchors = {
    left: { x: 1, y: 35, rotation: 90 },     // West: Edge at 1vw, rotate 90° clockwise
    right: { x: 99, y: 35, rotation: -90 },  // East: Edge at 99vw, rotate 90° counter-clockwise
    bottom: { x: 50, y: 75, rotation: 0 }    // South: No change
};
```

## 🏗️ Implementation Architecture

### 1. The Wrapper Component Structure
```jsx
const PlayerSeatPositioner = ({ 
    seatPosition,    // 'left', 'right', or 'bottom'
    PlayerSeat,      // Component to wrap
    debugMode,       // Show anchor points
    ...props
}) => {
    const [isWideMode, setIsWideMode] = useState(false);
    
    // Select anchors based on mode
    const activeAnchors = isWideMode ? collisionPreventionAnchors : defaultAnchors;
    
    // Apply positioning
    const style = {
        position: 'fixed',
        left: `${activeAnchors[seatPosition].x}vw`,
        top: `${activeAnchors[seatPosition].y}vh`,
        transform: `translate(-50%, -100%) rotate(${activeAnchors[seatPosition].rotation || 0}deg)`,
        transformOrigin: '50% 100%'
    };
    
    return (
        <div style={style}>
            <PlayerSeat {...props} />
        </div>
    );
};
```

### 2. Clean Integration in TableLayout
```jsx
// No manual positioning needed - just specify the seat position
<PlayerSeatPositioner
    seatPosition="left"
    PlayerSeat={PlayerSeat}
    playerName={seatAssignments.opponentLeft}
    // ... other props
/>
```

## 🎨 Why This Works So Well

### 1. **Absolute Control**
By using viewport units (vw/vh) and fixed positioning, we have pixel-perfect control regardless of parent container constraints.

### 2. **The Wrapper Isolation**
The wrapper handles ALL positioning logic. The inner PlayerSeat component doesn't need to know anything about where it's positioned.

### 3. **Transform Stacking**
The transform combines translation and rotation in one operation:
```css
transform: translate(-50%, -100%) rotate(90deg);
```
This ensures the rotation happens AFTER positioning, around the correct anchor point.

### 4. **Edge Distance Precision**
By anchoring at 1vw and 99vw in collision mode, seats are always exactly 1vw from the viewport edges, regardless of rotation.

## 🐛 Common Pitfalls to Avoid

### ❌ DON'T: Mix positioning systems
```javascript
// BAD: Mixing CSS classes with inline positioning
<div className="player-seat-left" style={{left: '15vw'}}>
```

### ❌ DON'T: Rotate before positioning
```javascript
// BAD: Rotation affects positioning calculations
style.transform = `rotate(90deg) translate(-50%, -100%)`;
```

### ❌ DON'T: Use percentage widths
```css
/* BAD: Width changes with parent container */
.player-seat { width: 25%; }
```

### ✅ DO: Use the wrapper pattern
```javascript
// GOOD: Clean separation of concerns
<PlayerSeatPositioner>  // Handles position
    <PlayerSeat>        // Handles content
</PlayerSeatPositioner>
```

## 🔧 Debug Tools

The system includes built-in debugging (Shift+D):
- **Anchor point visualization**: Red dots show exact anchor positions
- **Seat measurements**: Ruler shows dimensions in vw/vh
- **Mode indicator**: Shows when collision prevention is active
- **Position/rotation display**: Shows exact values being applied

## 📊 The Mathematical Foundation

### Viewport Calculations
```
1vh = window.innerHeight / 100
1vw = window.innerWidth / 100

Seat width in pixels = 17.5 * vh
Seat width in vw = (17.5 * vh) / vw
                  = 17.5 * (window.innerHeight / window.innerWidth)
```

### Collision Threshold
At 25vw threshold:
```
17.5 * (height/width) > 25
height/width > 25/17.5
height/width > 1.43
```
So collision mode activates when aspect ratio > 1.43 (taller than wide).

## 🎯 The Result

This system provides:
- **Exact positioning** at any viewport size
- **Smooth transitions** between modes
- **Perfect edge alignment** in collision prevention mode
- **Clean, maintainable code** with clear separation of concerns

The key was understanding that positioning and rotation must be handled by a wrapper element with absolute control, while the content remains unaware of its position. This pattern can be applied to any similar positioning challenge!

## 💡 Remember

> "The wrapper owns the position, the content owns the display."

This simple principle unlocked the solution after many attempts. When you need precise positioning with rotation, always think: **wrapper pattern with anchor points**.