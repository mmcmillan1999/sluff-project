# Responsive Layout Designer Tool - Plan

## Overview
Create an interactive HTML tool to test Sluff game layouts across different screen sizes and prevent element overlap. The tool will allow visual editing and generate layout configurations.

## Core Concept
Build a visual layout designer that:
1. Emulates different device screen sizes
2. Shows key UI elements as draggable/resizable boxes
3. Detects overlaps automatically
4. Allows manual adjustment of elements
5. Exports configurations for implementation

## Key Features

### 1. Device Emulation Panel
```javascript
const DEVICE_PRESETS = {
  // Critical Devices (60% market share)
  'iPhone SE': { width: 375, height: 667 },
  'iPhone 14': { width: 393, height: 852 },
  'Samsung Galaxy': { width: 360, height: 800 },
  'iPad': { width: 810, height: 1080 },
  'Desktop HD': { width: 1920, height: 1080 },
  
  // Edge Cases
  'Small Android': { width: 320, height: 568 },
  'Ultrawide': { width: 2560, height: 1080 },
  'Square (Facebook)': { width: 810, height: 810 }
};
```

### 2. Game Elements to Track
```javascript
const GAME_ELEMENTS = {
  // Fixed Elements
  'table-oval': { 
    type: 'scalable',
    maintainAspect: true,
    minSize: { w: 300, h: 200 }
  },
  
  // Player Panels (must not overlap)
  'player-north': { type: 'fixed', priority: 1 },
  'player-east': { type: 'fixed', priority: 1 },
  'player-west': { type: 'fixed', priority: 1 },
  'player-south': { type: 'fixed', priority: 1 },
  
  // Critical UI
  'player-hand': { type: 'flexible', priority: 2 },
  'trick-pile-left': { type: 'fixed', priority: 3 },
  'trick-pile-right': { type: 'fixed', priority: 3 },
  'widow-cards': { type: 'fixed', priority: 3 },
  
  // Secondary UI
  'chat-button': { type: 'movable', priority: 4 },
  'menu-button': { type: 'movable', priority: 4 },
  'insurance-slider': { type: 'flexible', priority: 4 }
};
```

### 3. Interactive Features

#### Unlock/Edit Mode
- Click "Unlock Mode" button to enable editing
- Elements become draggable with resize handles
- Shows grid overlay and snap points
- Real-time overlap detection with red highlighting

#### Overlap Detection
```javascript
function detectOverlaps() {
  const overlaps = [];
  elements.forEach((el1, i) => {
    elements.forEach((el2, j) => {
      if (i < j && isOverlapping(el1, el2)) {
        overlaps.push({
          elements: [el1.id, el2.id],
          area: calculateOverlapArea(el1, el2)
        });
      }
    });
  });
  return overlaps;
}
```

#### Recording System
```javascript
// Export format for layout configurations
{
  deviceSize: { width: 393, height: 852 },
  orientation: 'portrait',
  elements: {
    'player-north': { x: 50, y: 10, width: 150, height: 80 },
    'player-hand': { x: 0, y: 700, width: '100%', height: 152 },
    // ... etc
  },
  constraints: {
    'table-oval': { 
      maxWidth: '90%',
      centerX: true,
      centerY: true
    }
  }
}
```

## Tool Structure

### HTML Layout
```html
<!DOCTYPE html>
<html>
<head>
  <title>Sluff Layout Designer</title>
</head>
<body>
  <!-- Control Panel -->
  <div id="control-panel">
    <select id="device-selector">
      <option value="iphone-se">iPhone SE (375×667)</option>
      <option value="custom">Custom Size...</option>
    </select>
    
    <button id="rotate-btn">Rotate</button>
    <button id="unlock-btn">Unlock Mode</button>
    <button id="detect-overlaps">Check Overlaps</button>
    <button id="export-btn">Export Layout</button>
  </div>
  
  <!-- Device Frame -->
  <div id="device-frame">
    <div id="game-container">
      <!-- Game elements as divs -->
      <div class="element" id="table-oval">Table</div>
      <div class="element" id="player-north">North Player</div>
      <!-- etc... -->
    </div>
  </div>
  
  <!-- Overlap Report -->
  <div id="overlap-report">
    <h3>Overlap Issues:</h3>
    <ul id="overlap-list"></ul>
  </div>
  
  <!-- Export Panel -->
  <div id="export-panel">
    <textarea id="export-code"></textarea>
    <button id="copy-btn">Copy to Clipboard</button>
  </div>
</body>
</html>
```

### Interactive Features Implementation

#### Draggable Elements
```javascript
class DraggableElement {
  constructor(element) {
    this.el = element;
    this.isDragging = false;
    this.isResizing = false;
    this.initDrag();
    this.initResize();
  }
  
  initDrag() {
    this.el.addEventListener('mousedown', (e) => {
      if (!unlockMode) return;
      this.isDragging = true;
      this.startX = e.clientX - this.el.offsetLeft;
      this.startY = e.clientY - this.el.offsetTop;
    });
  }
  
  initResize() {
    // Add resize handles to corners
    ['nw', 'ne', 'sw', 'se'].forEach(corner => {
      const handle = document.createElement('div');
      handle.className = `resize-handle ${corner}`;
      this.el.appendChild(handle);
    });
  }
}
```

#### Smart Positioning
```javascript
class SmartLayout {
  constructor() {
    this.rules = {
      'player-hand': {
        position: 'bottom',
        width: '100%',
        maxHeight: '20vh',
        snapTo: 'bottom'
      },
      'table-oval': {
        center: true,
        maxWidth: '85%',
        maxHeight: '60%',
        maintainAspect: true
      }
    };
  }
  
  autoLayout(screenSize) {
    // Apply intelligent positioning based on screen size
    if (screenSize.width < 400) {
      // Mobile rules
      this.applyMobileLayout();
    } else if (screenSize.width < 768) {
      // Tablet rules
      this.applyTabletLayout();
    } else {
      // Desktop rules
      this.applyDesktopLayout();
    }
  }
  
  suggestFixes(overlaps) {
    // AI-like suggestions for fixing overlaps
    const suggestions = [];
    overlaps.forEach(overlap => {
      suggestions.push({
        problem: `${overlap.el1} overlaps ${overlap.el2}`,
        solution: this.calculateBestPosition(overlap)
      });
    });
    return suggestions;
  }
}
```

## Testing Workflow

### 1. Systematic Testing
```javascript
async function runSystematicTest() {
  const results = [];
  
  for (const [deviceName, size] of Object.entries(DEVICE_PRESETS)) {
    // Test portrait
    setDeviceSize(size);
    await wait(100);
    results.push({
      device: deviceName,
      orientation: 'portrait',
      overlaps: detectOverlaps(),
      screenshot: captureLayout()
    });
    
    // Test landscape
    setDeviceSize({ width: size.height, height: size.width });
    await wait(100);
    results.push({
      device: deviceName,
      orientation: 'landscape',
      overlaps: detectOverlaps(),
      screenshot: captureLayout()
    });
  }
  
  return generateReport(results);
}
```

### 2. Manual Adjustment Workflow
1. Select problematic device/orientation
2. Click "Unlock Mode"
3. Drag elements to better positions
4. Check for overlaps
5. Click "Record Layout"
6. Export configuration

### 3. Configuration Export
```javascript
function exportConfiguration() {
  const config = {
    timestamp: new Date().toISOString(),
    device: currentDevice,
    elements: {},
    css: {}
  };
  
  document.querySelectorAll('.element').forEach(el => {
    const rect = el.getBoundingClientRect();
    config.elements[el.id] = {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
      // Convert to percentages for responsive
      xPercent: (rect.left / window.innerWidth) * 100,
      yPercent: (rect.top / window.innerHeight) * 100,
      widthPercent: (rect.width / window.innerWidth) * 100,
      heightPercent: (rect.height / window.innerHeight) * 100
    };
  });
  
  // Generate CSS media query
  config.css = generateMediaQuery(config);
  
  return config;
}

function generateMediaQuery(config) {
  return `
@media (width: ${config.device.width}px) and (height: ${config.device.height}px) {
  ${Object.entries(config.elements).map(([id, pos]) => `
  #${id} {
    left: ${pos.xPercent}%;
    top: ${pos.yPercent}%;
    width: ${pos.widthPercent}%;
    height: ${pos.heightPercent}%;
  }`).join('\n')}
}`;
}
```

## Advanced Features

### 1. Constraint System
```javascript
const constraints = {
  'player-hand': {
    minHeight: 100,
    maxHeight: 200,
    bottom: 0,
    width: '100%'
  },
  'table-oval': {
    centerX: true,
    centerY: true,
    minMargin: 20
  }
};
```

### 2. Animation Preview
- Show card movement animations
- Test drop zones
- Verify touch targets

### 3. Performance Metrics
- Measure render time at each size
- Check for reflow/repaint issues
- Monitor memory usage

## Implementation Priority

### Phase 1: Basic Tool (Week 1)
- [ ] Device preset selector
- [ ] Basic element boxes
- [ ] Overlap detection
- [ ] Export positions

### Phase 2: Interactive Editing (Week 2)
- [ ] Drag and drop
- [ ] Resize handles
- [ ] Snap to grid
- [ ] Undo/redo

### Phase 3: Smart Features (Week 3)
- [ ] Auto-layout suggestions
- [ ] Constraint system
- [ ] Batch testing
- [ ] Visual reports

### Phase 4: Integration (Week 4)
- [ ] Generate React components
- [ ] Export CSS media queries
- [ ] Create responsive config file
- [ ] Documentation

## Benefits

1. **Visual Testing**: See problems immediately
2. **Rapid Iteration**: Adjust layouts in real-time
3. **Systematic Coverage**: Test all devices automatically
4. **Documentation**: Visual record of all layouts
5. **Collaboration**: Designers can contribute without coding

## Next Steps

1. Create basic HTML prototype
2. Add game-specific elements
3. Implement overlap detection
4. Add export functionality
5. Test with real game components

This tool will dramatically speed up responsive design and ensure Sluff works perfectly on all devices!