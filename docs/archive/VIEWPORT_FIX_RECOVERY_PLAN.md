# Recovery Strategy - Branch Management Plan

## Current Situation Analysis

### What We Have:
- **Current commit (eedca8d)**: "Remove all media queries from game view"
  - Deleted mobile-optimizations.css (lost card physics!)
  - Converted units to vh in several files
  - BUT: Menu and chat buttons broken

- **Previous commit (adb1081)**: "Resolve viewport height overflow and eliminate scrolling"
  - Has the excellent no-scroll fixes
  - Viewport height calculations working
  - Still has mobile-optimizations.css

- **Two commits ago (1cec71f)**: "PlayerSeat positioning accuracy complete"
  - Clean baseline before viewport fixes
  - Everything functional

### Problems Created:
1. Deleting mobile-optimizations.css was too aggressive - lost essential card physics
2. Menu/chat positioning broke somewhere in the changes
3. Mixed concerns: viewport fixes + media query removal in same commits

## Recommended Strategy

### Option A: **Save Current Work & Start Fresh** (RECOMMENDED)
1. Create branch `viewport-fixes-experimental` to preserve learning
2. Reset main branch to "PlayerSeat positioning" (1cec71f)
3. Cherry-pick specific fixes from experimental branch:
   - no-scroll-fix.css (excellent work!)
   - Viewport height calculations
   - Footer spacing fixes
4. Handle mobile-optimizations.css properly:
   - Extract card physics to separate file
   - Keep essential touch targets
   - Remove only problematic media queries

### Option B: Fix Forward
1. Restore mobile-optimizations.css from adb1081
2. Extract just card physics classes
3. Fix menu/chat positioning issues
4. Risk: More potential for accumulated errors

## Detailed Plan for Option A

### Phase 1: Preserve Current Work
```bash
git checkout -b viewport-fixes-experimental
git checkout main  # or Local_Dev
git reset --hard 1cec71f  # Back to PlayerSeat positioning
```

### Phase 2: Cherry-Pick Best Fixes
1. **no-scroll-fix.css** - This was excellent work, keep it
2. **Viewport calculations** (92.5vh game-view, 20vh footer)
3. **Footer structure** (controls wrapper, spacer)

### Phase 3: Smart Refactoring of mobile-optimizations.css
Instead of deleting entirely:
1. Extract card-physics.css (30 lines)
2. Convert game touch targets to vh (no media queries)
3. Keep lobby media queries (they're fine there)
4. Document each decision

### Phase 4: Test Checkpoints
After each change, verify:
- Card dragging works
- Menu button shows popup
- Chat positioning correct
- No scrollbars
- Touch targets adequate

## Benefits of This Approach

1. **Clean commit history** - Each commit does one thing
2. **Preserved learning** - Keep experimental branch for reference  
3. **Safer progression** - Test after each change
4. **Better organization** - Separate concerns properly

## What We'll Learn From Experimental Branch

The viewport-fixes-experimental branch taught us:
- ✅ no-scroll-fix.css approach works great
- ✅ 92.5vh/20vh split is correct
- ✅ Footer controls wrapper structure good
- ❌ Don't delete mobile-optimizations wholesale
- ❌ Test menu/chat after CSS changes
- ❌ Card physics must be preserved

## Next Steps If Approved

1. Create experimental branch to save work
2. Reset to PlayerSeat positioning commit
3. Create new branch "viewport-fixes-clean"
4. Apply fixes incrementally with testing
5. Smaller, focused commits

This gives us the best of both worlds: preserve the learning and fixes we've made, but apply them more carefully without losing functionality.