# Physics Engine Lessons Learned: Card Dragging and Rotation

## Key Insights for Maintaining Finger-to-Object Lock

### 1. The Pencil Stab Problem
**Challenge**: When dragging an object from an arbitrary point (not the center), that exact point must stay locked to the finger position throughout all rotations.

**Solution**: 
- Store the initial "pivot offset" - the vector from object center to touch point
- Every frame, recalculate the object's position based on:
  ```javascript
  // The pivot point must stay at finger position
  card.position.x = card.touchPoint.x;
  card.position.y = card.touchPoint.y;
  
  // Then adjust rendering position based on rotation
  const cos = Math.cos(card.rotation);
  const sin = Math.sin(card.rotation);
  const rotatedPivotX = pivotOffset.x * cos - pivotOffset.y * sin;
  const rotatedPivotY = pivotOffset.x * sin + pivotOffset.y * cos;
  
  // Calculate where center must be for pivot to stay at finger
  const centerX = touchPoint.x - rotatedPivotX;
  const centerY = touchPoint.y - rotatedPivotY;
  ```

### 2. CSS Margin/Transform Gotchas
**Challenge**: Cards with negative margins (for overlap effect) would snap/jump when switching to physics control.

**Solution**:
- Use `getComputedStyle()` to detect actual margin values
- Add margin offset to initial position calculations
- Remove margins entirely during physics control (`style.margin = '0'`)
- Restore original margins on cleanup

### 3. Position System Architecture
**Best Practice**: Use fixed positioning for physics-controlled elements
- Switch to `position: fixed` immediately on grab
- Use `transform: translate(x, y) rotate(θ)` for all movement
- Set `left: 0; top: 0` as baseline
- This avoids parent container constraints and scroll issues

### 4. Gravity and Center of Mass
**Physics Implementation**:
- True center of mass rarely equals geometric center
- For playing cards: face cards are top-heavy due to artwork
- Calculate equilibrium angle where COM hangs directly below pivot:
  ```javascript
  // Vector from pivot to center of mass
  const pivotFromCOM = {
    x: pivotOffset.x - centerOfMass.x,
    y: pivotOffset.y - centerOfMass.y
  };
  
  // Angle where this vector points straight down
  const equilibriumAngle = Math.atan2(pivotFromCOM.x, pivotFromCOM.y) + Math.PI;
  ```

### 5. Preventing Event Conflicts
**Challenge**: Touch events with preventDefault in React cause passive listener warnings.

**Solution**: Use ref callbacks to attach non-passive listeners:
```javascript
ref={(el) => {
  if (el && isLegal) {
    el._touchHandler = (e) => {
      e.preventDefault();
      handleDragStart(e, card);
    };
    el.addEventListener('touchstart', el._touchHandler, { passive: false });
  }
}}
```

### 6. Frame-Perfect Position Updates
**Critical**: Position must be recalculated AFTER rotation updates
- Update rotation based on physics
- Immediately recalculate position to maintain pivot lock
- Apply both in single transform to avoid visual artifacts

### 7. Debugging Techniques
**Visual Markers**:
- Add a bright marker at the grab point ("pencil stab")
- Draw arrow from grab point to center of mass
- Add vertical reference line to verify equilibrium
- These make physics bugs immediately visible

**Coordinate System Clarity**:
- Screen Y-positive points down
- Rotation angle 0 is rightward
- Always document which coordinate system you're using

### 8. Performance Considerations
- Use `requestAnimationFrame` for all updates
- Batch DOM reads before DOM writes
- Store element dimensions once during grab (not every frame)
- Use CSS transforms exclusively (no top/left animations)

### 9. State Management
**Avoid Stale Closures**: Use refs for values that change during drag
```javascript
const dragStateRef = useRef(dragState);
dragStateRef.current = dragState; // Keep ref synced
```

### 10. Smooth Physics Parameters
For realistic card physics:
- Gravity strength: 20.0 (strong pull to equilibrium)
- Angular damping: 0.98 when far, 0.92 when close
- Snap to equilibrium when within 0.02 radians
- Scale animation: Start at 1.0, animate to 1.05

## Summary
The key to perfect dragging physics is maintaining the grab point position as the highest priority constraint. Everything else (rotation, center of mass, visual effects) must be calculated to preserve this fundamental rule: **where you grab it, it stays grabbed**.