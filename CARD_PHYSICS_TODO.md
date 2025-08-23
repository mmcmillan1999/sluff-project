# Card Physics & Layout Integration TODO
*Created: 8/22/2025*

## Context: Recent PlayerHand Layout Changes
- Refactored to use `CardSpacingEngine.js` for all layout calculations
- Changed from flex layout with margins to absolute positioning
- Cards positioned using `cardLayout.layout.positions[index].left`
- Container padding: 4% of viewport * aspect ratio
- Turn indicator dynamically adjusts to card positions

## 🔴 Critical Issues to Fix

### 1. Card Return-to-Home Position Bug
**Problem**: When cards are picked up but not played, they don't return to correct position
- Physics engine stores `originalPosition` as screen coordinates (rect.left, rect.top)
- With new absolute positioning, cards need their calculated position from `cardLayout.layout.positions[index].left`
- Cards don't know their index in the hand during drag operations

**Solution Required**:
- Pass card's layout index to physics engine when grabbing
- Store reference to cardLayout positions
- Calculate proper home position based on card's current index in hand

### 2. Physics Docking Target Wrong
**Problem**: Cards fly toward table center instead of PlayerHand position
- `dropZoneCenter` calculated from dropZoneRef (center of table)
- For return home, should target actual card slot in PlayerHand

**Solution Required**:
- Calculate proper home position using CardSpacingEngine layout
- Include container padding in position calculation
- Target should be card's slot position, not table center

## 🟡 Improvements Needed

### 3. Position Tracking During Drag
- Need to maintain card-to-index mapping throughout drag operation
- Handle case where hand changes while card is being dragged

### 4. Physics-Spacing Engine Integration
- Physics engine should use CardSpacingEngine positions as docking targets
- Need to pass cardLayout reference to physics engine
- Update home positions when hand layout changes

### 5. Stale Position Handling
- When cards are played/drawn, all positions recalculate
- Cards in flight may have outdated home positions
- Need position update mechanism for airborne cards

## 📍 Key Files to Modify
1. `frontend/src/components/game/PlayerHand.js`
   - Lines 184-295: handleDragStart/handleDragEnd
   - Need to pass card index and layout positions

2. `frontend/src/utils/CardPhysicsEngine.js`
   - `grabCard()`: Store card's layout index
   - `releaseCard()`: Use proper home position
   - `returnCardHome()`: Calculate position from layout

3. `frontend/src/utils/CardSpacingEngine.js`
   - May need method to get specific card position by index

## 🎯 Expected Behavior
1. Card picked up → stores its index and layout position
2. Card released outside drop zone → returns to exact slot in hand
3. Return animation targets PlayerHand position, not table center
4. Cards maintain proper spacing even after failed drop attempts

## 💡 Implementation Notes
- Card positions are relative to `.player-hand-cards` container
- Container has padding from CardSpacingEngine (4% of viewport)
- Positions are absolute within the container
- Turn indicator can extend beyond container bounds

## Testing Scenarios
1. Pick up card and release outside drop zone
2. Pick up card, drag around, return to hand
3. Pick up multiple cards in sequence without playing
4. Pick up card while another is animating back
5. Test in both CENTER_MODE and OVERLAP_MODE layouts