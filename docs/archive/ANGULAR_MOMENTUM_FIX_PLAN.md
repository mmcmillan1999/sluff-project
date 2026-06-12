# Angular Momentum Fix Implementation Plan

This document outlines the comprehensive fix for finger-based card rotation physics and the secondary enhancement for magnetic card docking.

## Primary Issue: Angular Momentum from Finger Movements

### Problem Summary
Logs show finger movements ARE being detected and torque IS being calculated (0.1 to 2.3 values), but the card stays stuck at equilibrium angle (148.6°). The physics calculations have fundamental errors preventing visible rotation.

### Root Causes Identified

1. **Physics Calculation Errors**
   - Incorrect torque formula using `leverArm²` in denominator
   - Wrong dimensional analysis for angular velocity conversion
   - Misunderstanding of lever arm vs distance from pivot

2. **Balance Issues**
   - Gravity too strong (5.0) overpowering finger input
   - Finger influence too weak (2.0) to overcome gravity
   - Aggressive damping (0.92) removing angular velocity

3. **Threshold Problems**
   - Movement threshold (0.5 pixels) filtering out valid inputs
   - No "finger override" mode to reduce gravity during manipulation

### Solutions Implemented

#### 1. Corrected Physics (Lines 471-525)
```javascript
// Proper torque calculation: τ = r × F
const rX = currentPos.x - cardCenterX;
const rY = currentPos.y - cardCenterY;
const forceX = dx / deltaTime;
const forceY = dy / deltaTime;
const torque = rX * forceY - rY * forceX;
```

#### 2. Balanced Forces
- Reduced gravity: 5.0 → 2.0
- Increased finger influence: 2.0 → 50.0
- Dynamic damping: 0.98 when moving, 0.90 when still

#### 3. Improved Responsiveness
- Movement threshold: 0.5 → 0.1 pixels
- Gravity reduction (70%) when finger is active
- Proper angular acceleration scaling

### Test Results
Comprehensive test suite created with 23 passing tests covering:
- Torque generation from finger movements
- Circular motion creating sustained rotation
- Gravity return to equilibrium
- Edge cases (small movements, rapid changes)
- Memory management and cleanup

## Secondary Enhancement: Magnetic Card Docking

### Current Behavior
- Simple distance/speed check for docking
- Binary success/fail decision
- No magnetic attraction physics

### Proposed Enhancement

#### Three-Zone Capture System
1. **Inner Zone (120px radius)**
   - Strong magnetic pull
   - Low velocity threshold (75 px/s)
   - Almost always captures

2. **Outer Zone (200px radius)**
   - Moderate magnetic influence
   - Normal velocity threshold (150 px/s)
   - Requires good aim

3. **Beyond Zone**
   - Natural physics only
   - High velocity threshold (225 px/s)
   - Requires precise aim

#### Magnetic Physics
```javascript
// Inverse square law with cap
forceMagnitude = Math.max(50, (captureStrength * 10000) / (distance²))

// Smooth deceleration near target
proximityFactor = Math.max(0.1, distance / 100)
damping = 0.98 - (1 - proximityFactor) * 0.1
```

#### Visual Enhancements
- Expanded drop zone hitbox (400x400px)
- Multi-layer visual indicators
- Progressive magnetic activation effects

## Implementation Status

### Completed ✅
1. Fixed torque physics calculations
2. Balanced gravity vs finger forces
3. Created comprehensive test suite
4. Documented all physics formulas

### Pending Tasks 🔄
1. Test angular momentum fix with real user interaction
2. Implement magnetic docking enhancement
3. Add visual feedback for magnetic zones
4. Fine-tune physics constants based on user testing

## Next Steps When You Return

1. **Test the Angular Momentum Fix**
   - Try circular finger gestures
   - Verify cards rotate away from equilibrium
   - Check that gravity returns card when released

2. **Review Physics Constants**
   - `gravityStrength = 2.0` (adjustable)
   - `fingerInfluence = 50.0` (adjustable)
   - Movement threshold = 0.1 pixels

3. **Implement Magnetic Docking** (if angular momentum works well)
   - Add capture zone calculations
   - Implement magnetic force physics
   - Enhance visual feedback

## Files Modified

- `frontend/src/utils/CardPhysicsEngine.js` - Fixed torque physics
- `frontend/src/utils/CardPhysicsEngine.test.js` - Created test suite
- `ANGULAR_MOMENTUM_FIX_PLAN.md` - This documentation

## Console Commands for Testing

```bash
# Run physics tests
npm test -- --testPathPattern=CardPhysicsEngine.test.js --verbose

# Start dev server to test manually
npm run dev
```

The physics engine should now properly respond to finger movements with realistic torque-based rotation while maintaining gravity physics when not being touched.