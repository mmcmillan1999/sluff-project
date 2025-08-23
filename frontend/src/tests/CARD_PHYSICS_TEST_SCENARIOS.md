# Card Physics Test Scenarios

## Overview

This document outlines comprehensive test scenarios for the card physics system, focusing on drag/drop edge cases, hand changes during drag operations, and system robustness. These scenarios are designed to validate the interaction between `CardPhysicsEngine`, `CardSpacingEngine`, and `PlayerHand` components.

## Test Environment Setup

### Prerequisites
- Browser with touch/mouse support
- Game in "Playing Phase" with legal moves available
- PlayerHand component with multiple cards (5+ recommended)
- DropZone component active and visible

### Debug Tools
- Enable physics debugging: `localStorage.setItem('CARD_TRACERS', '1')`
- Enable pivot debugging: `localStorage.setItem('DEBUG_CARD_PIVOT', '1')`
- Monitor physics state: `window.__SLUFF_DEBUG_TRACERS__ = true`

---

## 1. Basic Drag/Drop Tests

### 1.1 Pick Up and Cancel
**Description**: Pick up a card, drag it around, then release outside drop zone

**Test Steps**:
1. MouseDown/TouchStart on a legal card
2. Drag card away from hand area
3. Move card around the screen (avoid drop zone)
4. Release card outside drop zone

**Expected Behavior**:
- Card follows cursor/finger with physics momentum
- Card shows dragging visual state (elevated z-index, scale)
- Physics engine applies gravity and angular velocity
- On release, card animates back to original position in hand
- Card position updates to match current hand layout

**Verification**:
- Card returns to exact position calculated by CardSpacingEngine
- No visual glitches during return animation
- Card remains selectable after return
- Physics state is properly cleaned up

**Potential Failure Modes**:
- Card gets stuck in dragging state
- Card returns to wrong position
- Animation doesn't complete
- Memory leak in physics engine

### 1.2 Pick Up and Play Successfully
**Description**: Pick up a card and successfully play it to the drop zone

**Test Steps**:
1. MouseDown/TouchStart on a legal card
2. Drag card towards drop zone
3. Enter drop zone (should see visual feedback)
4. Release card inside drop zone

**Expected Behavior**:
- Card follows cursor with physics
- Drop zone shows visual feedback when card enters
- Visual feedback scales with proximity to drop zone center
- Card is successfully played to the table
- PlayCard event is emitted

**Verification**:
- Card disappears from hand
- Card appears in played cards area
- Hand layout recalculates for remaining cards
- Game state updates correctly

**Potential Failure Modes**:
- Drop zone doesn't detect card entry
- Card plays but visual state remains inconsistent
- Hand layout doesn't update
- Event not emitted properly

### 1.3 Rapid Pick Up and Release
**Description**: Very quick grab and release operations

**Test Steps**:
1. Rapidly click/tap a card (< 100ms contact time)
2. Immediately release without significant movement
3. Repeat with different cards in quick succession

**Expected Behavior**:
- Physics engine handles short contact times gracefully
- Cards don't get stuck in intermediate states
- No phantom drag operations remain active
- Touch history is managed correctly

**Verification**:
- All cards return to proper positions
- No cards remain in "dragging" state
- Physics engine activeCards map is clean
- Performance remains smooth

**Potential Failure Modes**:
- Cards get stuck in dragging state
- Physics calculations produce NaN/Infinity
- Touch event listeners not properly removed
- Memory accumulation

---

## 2. Multiple Card Operations

### 2.1 Sequential Card Pickup Without Playing
**Description**: Pick up multiple cards in sequence without playing any

**Test Steps**:
1. Pick up Card A, drag around, release outside drop zone
2. Wait for Card A to finish returning animation
3. Pick up Card B, drag around, release outside drop zone
4. Repeat for Card C
5. Verify all cards are in correct positions

**Expected Behavior**:
- Each card returns to its correct position
- Hand layout remains consistent throughout
- Physics engine handles sequential operations cleanly
- No interference between card operations

**Verification**:
- All cards end up in CardSpacingEngine calculated positions
- Z-index ordering is correct
- No visual artifacts or overlapping
- Physics activeCards map shows 0 active cards

**Potential Failure Modes**:
- Cards return to wrong positions
- Layout calculation errors accumulate
- Visual z-index conflicts
- Physics engine doesn't clean up properly

### 2.2 Pick Up Card While Another Is Animating
**Description**: Start new drag operation while previous card is still returning

**Test Steps**:
1. Pick up Card A, drag, release outside drop zone
2. Before Card A finishes returning animation, pick up Card B
3. Drag Card B around while Card A is still animating
4. Release Card B outside drop zone

**Expected Behavior**:
- Card A continues its return animation uninterrupted
- Card B starts new drag operation smoothly
- Physics engine manages both cards simultaneously
- No interference between animations
- Both cards return to correct final positions

**Verification**:
- Card A reaches its target position
- Card B starts from correct hand position
- Final layout is accurate for all cards
- Physics engine activeCards properly managed

**Potential Failure Modes**:
- Animations interfere with each other
- Second card starts from wrong position
- Physics engine gets confused by multiple active cards
- Performance degradation

### 2.3 Rapid Successive Pickup of Different Cards
**Description**: Very quickly pick up different cards without allowing returns

**Test Steps**:
1. Pick up Card A, immediately release
2. Before Card A starts returning, pick up Card B
3. Before Card B starts returning, pick up Card C
4. Continue rapidly for several cards
5. Stop and observe all cards returning

**Expected Behavior**:
- Each card starts return animation when released
- Physics engine queues and manages multiple return animations
- All cards eventually reach their correct positions
- System remains responsive throughout

**Verification**:
- All cards return to CardSpacingEngine positions
- No cards get lost or stuck
- Hand layout is correct at the end
- Performance doesn't degrade significantly

**Potential Failure Modes**:
- Animation queue overflow
- Cards return to wrong positions
- System becomes unresponsive
- Memory usage spikes

---

## 3. Hand Change During Drag

### 3.1 Card Being Dragged When Another Card Is Played
**Description**: Player drags Card A while another player plays a card, changing hand contents

**Test Steps**:
1. Start dragging Card A (don't release)
2. Simulate another player playing a card (trigger hand update)
3. Continue dragging Card A
4. Release Card A outside drop zone

**Expected Behavior**:
- Dragged card continues to follow cursor normally
- Hand layout recalculates for new card count (excluding dragged card)
- Physics engine updates target position for returning card
- Card returns to new calculated position in updated hand

**Verification**:
- Dragged card behavior unaffected during hand change
- Card returns to position appropriate for new hand size
- Hand layout is correct after card returns
- No visual jumps or incorrect positioning

**Potential Failure Modes**:
- Dragged card jumps to wrong position during hand update
- Return animation targets wrong location
- Layout calculation includes/excludes dragged card incorrectly
- Visual glitches during hand transition

### 3.2 Card Being Dragged When New Cards Are Drawn
**Description**: Hand size increases while card is being dragged

**Test Steps**:
1. Start with 5-card hand
2. Pick up and drag Card A
3. Simulate drawing new cards (hand becomes 7 cards)
4. Continue dragging Card A
5. Release Card A outside drop zone

**Expected Behavior**:
- Hand layout switches to appropriate mode (CENTER_MODE or OVERLAP_MODE)
- New cards appear in correct positions
- Dragged card's return target updates to accommodate new hand size
- Card returns to correct position within expanded hand

**Verification**:
- Hand layout mode is correct for new card count
- New cards positioned according to CardSpacingEngine
- Dragged card returns to proportionally correct position
- All cards end up in proper spacing configuration

**Potential Failure Modes**:
- Layout mode doesn't switch appropriately
- Dragged card returns to old position
- New cards positioned incorrectly
- Spacing calculations incorrect

### 3.3 Card Being Dragged When Cards Are Removed (Played by Others)
**Description**: Hand size decreases while card is being dragged

**Test Steps**:
1. Start with 7-card hand in OVERLAP_MODE
2. Pick up and drag middle card
3. Simulate other cards being played (hand becomes 4 cards)
4. Continue dragging the card
5. Release outside drop zone

**Expected Behavior**:
- Hand layout may switch from OVERLAP_MODE to CENTER_MODE
- Remaining cards reposition according to new layout
- Dragged card's return position recalculates
- Card returns to appropriate position in smaller hand

**Verification**:
- Layout mode switches if appropriate (OVERLAP to CENTER)
- Remaining cards have correct spacing
- Dragged card returns to correct relative position
- Final layout matches CardSpacingEngine calculations

**Potential Failure Modes**:
- Layout mode doesn't switch when it should
- Remaining cards don't reposition
- Dragged card returns to position outside visible area
- Card positioning inconsistencies

---

## 4. Window Resize Tests

### 4.1 Resize Window While Dragging Card
**Description**: User resizes browser window during card drag operation

**Test Steps**:
1. Start dragging a card
2. While dragging, resize browser window significantly
3. Continue dragging the card
4. Release card outside drop zone

**Expected Behavior**:
- Dragged card continues following cursor accurately
- Physics engine handles coordinate system changes
- Card position remains relative to cursor
- Return animation targets updated hand position

**Verification**:
- Dragged card doesn't jump or lose cursor tracking
- Card returns to position calculated for new window size
- Hand layout is appropriate for new viewport dimensions
- Drop zone detection still works accurately

**Potential Failure Modes**:
- Card loses cursor tracking
- Position calculations break with viewport change
- Card returns to position calculated for old window size
- Drop zone detection becomes inaccurate

### 4.2 Resize Window While Card Is Animating Back
**Description**: Window resize during card return animation

**Test Steps**:
1. Drag card and release outside drop zone
2. During return animation, resize window
3. Observe animation completion

**Expected Behavior**:
- Return animation updates target to new window size
- Animation continues smoothly to new target position
- Final position matches CardSpacingEngine for new viewport
- No abrupt jumps or incorrect final positioning

**Verification**:
- Animation smoothly redirects to new target
- Final card position is accurate for new window size
- Hand layout is correct after resize
- No visual artifacts

**Potential Failure Modes**:
- Animation continues to old target position
- Card snaps abruptly to new position
- Animation gets stuck or corrupted
- Final position is incorrect

### 4.3 Portrait/Landscape Orientation Change During Drag
**Description**: Mobile device orientation change while dragging

**Test Steps**:
1. On mobile device, start dragging a card
2. Rotate device to change orientation
3. Continue dragging
4. Release outside drop zone

**Expected Behavior**:
- Card continues tracking finger/cursor accurately
- Coordinate system adapts to new orientation
- Hand layout recalculates for new aspect ratio
- Drop zone repositions and remains functional

**Verification**:
- No loss of drag tracking during orientation change
- Card returns to correct position in new orientation
- Hand layout appropriate for new viewport aspect ratio
- All touch events continue working

**Potential Failure Modes**:
- Touch tracking lost during orientation change
- Card position becomes incorrect in new orientation
- Hand layout doesn't adapt properly
- Touch events stop working

---

## 5. Spacing Mode Tests

### 5.1 Test in CENTER_MODE Layout
**Description**: Drag operations when cards fit with normal spacing

**Test Steps**:
1. Ensure hand has few enough cards for CENTER_MODE (typically ≤ 5 cards)
2. Pick up first card, drag, release outside drop zone
3. Pick up middle card, drag, release outside drop zone
4. Pick up last card, drag, release outside drop zone

**Expected Behavior**:
- Cards maintain fixed spacing between them
- Return positions are calculated with betweenCardMargin spacing
- All cards remain centered in container
- No overlap between cards

**Verification**:
- `layout.mode === 'CENTER_MODE'`
- Cards have consistent margins between them
- Container padding is applied correctly
- All cards visible within container bounds

**Potential Failure Modes**:
- Cards overlap when they shouldn't
- Spacing becomes inconsistent
- Cards extend outside container bounds
- Mode calculation is incorrect

### 5.2 Test in OVERLAP_MODE Layout
**Description**: Drag operations when cards must overlap to fit

**Test Steps**:
1. Ensure hand has many cards for OVERLAP_MODE (typically ≥ 8 cards)
2. Pick up leftmost card, drag, release outside drop zone
3. Pick up rightmost card, drag, release outside drop zone
4. Pick up middle card, drag, release outside drop zone

**Expected Behavior**:
- Cards use edge-anchored positioning with calculated overlap
- First card at left edge, last card at right edge
- Intermediate cards evenly spaced between edges
- All cards remain visible (no complete occlusion)

**Verification**:
- `layout.mode === 'OVERLAP_MODE'`
- First card left position is 0
- Last card right edge at container width
- All cards partially visible
- Negative margin applied correctly

**Potential Failure Modes**:
- Cards completely occlude each other
- Edge anchoring doesn't work properly
- Spacing calculation produces negative positions
- Some cards positioned outside container

### 5.3 Switch Layout Modes During Drag
**Description**: Hand size changes cause layout mode switch during drag

**Test Steps**:
1. Start with 8 cards (OVERLAP_MODE)
2. Pick up and drag a card
3. Simulate cards being played until only 4 remain (should switch to CENTER_MODE)
4. Release dragged card outside drop zone

**Expected Behavior**:
- Layout mode switches from OVERLAP_MODE to CENTER_MODE
- Remaining cards reposition with proper spacing
- Dragged card's return position recalculates for new mode
- Card returns to CENTER_MODE positioning

**Verification**:
- Layout mode correctly switches to CENTER_MODE
- Spacing changes from overlap to margin-based
- Dragged card integrates properly with new layout
- All visual transitions are smooth

**Potential Failure Modes**:
- Mode doesn't switch when it should
- Cards don't reposition for new mode
- Dragged card returns using old mode calculations
- Visual discontinuities during mode switch

---

## 6. Edge Position Tests

### 6.1 Drag First Card in Hand
**Description**: Special handling for leftmost card position

**Test Steps**:
1. Pick up the first (leftmost) card
2. Drag around extensively
3. Release outside drop zone
4. Verify return position

**Expected Behavior**:
- First card drags normally
- Physics engine tracks correct original position
- Return animation targets leftmost position
- Hand spacing recalculates correctly without first card

**Verification**:
- Card returns to position index 0 in layout
- Other cards maintain correct relative positions
- No gaps or overlaps in final layout
- Z-index ordering remains correct

**Potential Failure Modes**:
- Card returns to wrong position in sequence
- Hand layout miscalculates without first card
- Visual artifacts during return
- Position index confusion

### 6.2 Drag Last Card in Hand
**Description**: Special handling for rightmost card position

**Test Steps**:
1. Pick up the last (rightmost) card
2. Drag around extensively
3. Release outside drop zone
4. Verify return position

**Expected Behavior**:
- Last card drags normally
- Return animation targets rightmost position
- Hand maintains proper right edge alignment
- Container padding calculations remain correct

**Verification**:
- Card returns to highest index position
- Right edge alignment maintained
- Container width calculations correct
- No positioning outside container bounds

**Potential Failure Modes**:
- Card returns outside container bounds
- Right edge alignment breaks
- Container padding miscalculated
- Visual overflow issues

### 6.3 Drag Middle Card with Many Cards (OVERLAP_MODE)
**Description**: Test middle card behavior in crowded hand

**Test Steps**:
1. Have 10+ cards in hand (heavy overlap)
2. Pick up a middle card (index 5-6)
3. Drag extensively
4. Release outside drop zone

**Expected Behavior**:
- Middle card extracts cleanly from overlap
- Remaining cards maintain edge-anchored spacing
- Return position correctly calculated within overlap sequence
- No visual jumping of adjacent cards

**Verification**:
- Card returns to correct middle position
- Adjacent cards don't shift unexpectedly
- Overlap calculations remain accurate
- Visual continuity maintained

**Potential Failure Modes**:
- Card returns to edge position instead of middle
- Adjacent cards shift to fill space incorrectly
- Overlap calculations produce wrong positions
- Z-index ordering becomes incorrect

---

## 7. Animation Interrupt Tests

### 7.1 Start New Drag While Card Is Returning
**Description**: Interrupt return animation with new drag operation

**Test Steps**:
1. Drag Card A, release outside drop zone
2. While Card A is animating back, start dragging Card A again
3. Complete second drag operation

**Expected Behavior**:
- First return animation cancels cleanly
- Second drag starts from current animated position
- Physics engine transitions smoothly between states
- No visual artifacts or position jumps

**Verification**:
- Animation cancellation is clean
- New drag starts from actual current position
- Physics state properly resets
- Visual continuity maintained

**Potential Failure Modes**:
- Animation doesn't cancel properly
- New drag starts from wrong position
- Physics engine gets into inconsistent state
- Visual jumping or artifacts

### 7.2 Click Card That's Animating Back
**Description**: Attempt to interact with card during return animation

**Test Steps**:
1. Drag card, release outside drop zone
2. While card is animating back, click/tap on the animating card
3. Observe behavior

**Expected Behavior**:
- Click is either ignored (card not interactive during animation) OR
- Animation cancels and new drag starts from current position
- Behavior is consistent and predictable
- No system confusion or errors

**Verification**:
- Behavior is deterministic
- No error states or inconsistencies
- Animation system handles interaction appropriately
- Physics state remains clean

**Potential Failure Modes**:
- Click causes animation corruption
- Physics engine enters error state
- Card becomes unresponsive after animation
- System behavior is unpredictable

### 7.3 Multiple Cards Animating Simultaneously
**Description**: Several cards returning at the same time

**Test Steps**:
1. Rapidly drag and release Cards A, B, C in quick succession
2. All should start return animations overlapping in time
3. Observe all animations completing correctly

**Expected Behavior**:
- All cards animate back simultaneously without interference
- Each card reaches its correct final position
- Performance remains acceptable
- Physics engine manages multiple animations efficiently

**Verification**:
- All cards reach CardSpacingEngine calculated positions
- Animation timing is smooth for all cards
- No performance degradation
- Memory usage remains stable

**Potential Failure Modes**:
- Animations interfere with each other
- Performance degrades significantly
- Some cards don't complete animations
- Memory usage increases dramatically

---

## 8. Boundary Tests

### 8.1 Drag Card to Screen Edges
**Description**: Extreme position testing at viewport boundaries

**Test Steps**:
1. Pick up a card
2. Drag to extreme left edge of screen
3. Drag to extreme right edge of screen
4. Drag to top edge of screen
5. Drag to bottom edge of screen
6. Release outside drop zone

**Expected Behavior**:
- Card follows cursor to all screen edges
- Physics calculations remain stable at extreme positions
- Return animation works from any extreme position
- No coordinate system overflow or underflow

**Verification**:
- Card visible at all extreme positions
- Physics values remain finite and reasonable
- Return animation paths are reasonable (not extreme loops)
- Performance remains stable

**Potential Failure Modes**:
- Card disappears at screen edges
- Physics calculations produce NaN/Infinity
- Return animation takes unreasonable path
- System becomes unresponsive

### 8.2 Very Fast Drag Movements
**Description**: Rapid mouse/finger movements stress testing

**Test Steps**:
1. Pick up a card
2. Move cursor/finger very rapidly in large movements
3. Create sharp direction changes
4. Release outside drop zone

**Expected Behavior**:
- Card follows rapid movements with appropriate physics lag
- Angular velocity increases appropriately with rapid movements
- Physics engine handles high-speed input gracefully
- System remains responsive

**Verification**:
- Card doesn't "teleport" or lose tracking
- Physics values remain within reasonable bounds
- Visual motion appears smooth despite rapid input
- No performance issues

**Potential Failure Modes**:
- Card loses cursor tracking
- Physics calculations become unstable
- Visual stuttering or jumping
- System becomes unresponsive

### 8.3 Very Slow Drag Movements
**Description**: Extremely slow, precise movements

**Test Steps**:
1. Pick up a card
2. Move very slowly (sub-pixel movements)
3. Make very precise, controlled movements
4. Release outside drop zone

**Expected Behavior**:
- Card responds to micro-movements
- Physics calculations handle small deltas gracefully
- No threshold effects or dead zones
- Smooth response to all input magnitudes

**Verification**:
- Card moves with all input, no matter how small
- Physics calculations don't produce zero-division errors
- Visual response is proportional to input
- No artificial thresholds apparent

**Potential Failure Modes**:
- Card doesn't respond to small movements
- Zero-division errors in physics calculations
- Threshold effects create dead zones
- Visual response is jerky or quantized

---

## 9. Error Recovery Tests

### 9.1 Physics Engine Error Recovery
**Description**: System behavior when physics calculations encounter errors

**Test Steps**:
1. Use browser dev tools to inject errors into physics calculations
2. Force NaN/Infinity values in position or velocity
3. Observe system recovery behavior

**Expected Behavior**:
- System detects invalid physics values
- Physics engine resets to safe state
- Card returns to valid hand position
- No permanent system corruption

**Verification**:
- Invalid values are detected and corrected
- System continues functioning after error
- Card positions remain valid
- No memory leaks or corruption

**Potential Failure Modes**:
- System doesn't detect invalid values
- Error propagates throughout system
- Cards become permanently stuck
- System requires page refresh

### 9.2 DOM Element Cleanup Recovery
**Description**: Handling of orphaned or missing DOM elements

**Test Steps**:
1. Start dragging a card
2. Use dev tools to remove card element from DOM
3. Attempt to complete drag operation

**Expected Behavior**:
- Physics engine detects missing element
- Operation fails gracefully
- System cleans up orphaned physics state
- Other cards remain functional

**Verification**:
- No JavaScript errors
- Physics engine activeCards map is cleaned
- Other cards continue working normally
- No memory leaks

**Potential Failure Modes**:
- JavaScript errors crash system
- Orphaned physics state remains
- Other cards become non-functional
- Memory leaks accumulate

---

## 10. Performance Tests

### 10.1 Long-Duration Drag Performance
**Description**: Performance during extended drag operations

**Test Steps**:
1. Pick up a card
2. Continuously drag for 60+ seconds
3. Monitor performance metrics
4. Release and observe return animation

**Expected Behavior**:
- Performance remains stable throughout long drag
- Memory usage doesn't increase significantly
- Animation remains smooth
- System remains responsive to other interactions

**Verification**:
- Frame rate remains stable
- Memory usage is bounded
- No performance degradation over time
- CPU usage remains reasonable

**Potential Failure Modes**:
- Performance degrades over time
- Memory usage increases continuously
- Animation becomes jerky
- System becomes unresponsive

### 10.2 Rapid Repeat Operations Performance
**Description**: Performance under repeated stress

**Test Steps**:
1. Rapidly pick up and release cards (100+ times)
2. Monitor system performance
3. Check for memory leaks
4. Verify continued functionality

**Expected Behavior**:
- Performance remains stable under repeated use
- Memory usage remains bounded
- All operations continue working correctly
- No accumulation of resources

**Verification**:
- Memory usage doesn't grow significantly
- All cards remain functional after stress test
- Physics engine activeCards map stays clean
- Performance metrics remain stable

**Potential Failure Modes**:
- Memory usage grows with each operation
- Cards become unresponsive after many operations
- Performance degrades significantly
- System requires refresh to restore functionality

---

## Test Execution Guidelines

### Manual Testing Protocol
1. **Environment Setup**: Ensure consistent test environment
2. **Progressive Testing**: Start with basic tests, progress to complex scenarios
3. **Documentation**: Record any unexpected behaviors or failure modes
4. **Cross-Browser Testing**: Verify behavior across different browsers
5. **Device Testing**: Test on various devices (desktop, mobile, tablet)

### Automated Testing Considerations
- Mock DOM elements and viewport dimensions
- Simulate realistic timing and input patterns  
- Test physics calculations independently
- Verify cleanup and memory management
- Stress test with rapid repeated operations

### Success Criteria
- All basic drag/drop operations work reliably
- Hand layout remains correct through all card operations
- Performance is acceptable under all tested conditions
- System recovers gracefully from error conditions
- Memory usage remains bounded over time

### Failure Investigation
When tests fail, investigate:
1. **Physics State**: Check CardPhysicsEngine activeCards map
2. **Layout State**: Verify CardSpacingEngine calculations
3. **DOM State**: Ensure card elements are in expected state
4. **Event Handling**: Confirm event listeners are properly managed
5. **Memory Usage**: Check for leaks or excessive resource consumption

This comprehensive test suite ensures the card physics system provides a robust, responsive, and reliable user experience across all edge cases and usage patterns.