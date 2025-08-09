// frontend/src/utils/CardPhysicsEngine.js

class CardPhysicsEngine {
    constructor() {
        // Physics constants
        this.gravity = 500; // pixels/second^2 (scaled for screen)
        this.angularDamping = 0.92; // Angular velocity damping
        this.linearDamping = 0.98; // Default linear damping (overridden by directional air resistance)
        this.minThrowVelocity = 100; // Reduced - magnetic field helps capture cards
        this.maxRotationSpeed = 15; // Increased to allow more spin from finger movements
        
        // Sophisticated Flight Physics Constants
        this.CARD_WIDTH = 80; // Standard card width in pixels
        this.CARD_HEIGHT = 120; // Standard card height in pixels
        this.MIN_DISTANCE_FOR_VALID_THROW = 2 * this.CARD_HEIGHT; // 240px
        // Make MAX_AIM_OFFSET responsive to screen size
        this.calculateMaxAimOffset = () => {
            const screenWidth = window.innerWidth;
            const isMobile = screenWidth < 768;
            const isTablet = screenWidth >= 768 && screenWidth < 1024;
            
            if (isMobile) {
                return 3.5 * this.CARD_WIDTH; // 280px for mobile
            } else if (isTablet) {
                return 5 * this.CARD_WIDTH; // 400px for tablet
            } else {
                // Desktop - more forgiving due to larger screens
                return 8 * this.CARD_WIDTH; // 640px for desktop
            }
        };
        this.MAX_AIM_OFFSET = this.calculateMaxAimOffset();
        this.DOCKING_TIME_LIMIT = 2.5; // seconds - extra time for non-vertical cards to dock
        
        // Velocity thresholds for throw classification
        this.VELOCITY_SLOW_THRESHOLD = 300; // px/s - Below this is slow
        this.VELOCITY_MEDIUM_THRESHOLD = 1200; // px/s - Below this is medium, above is fast
        
        // Distance-based correction zones (in card widths)
        this.ZONE_MINIMAL_CORRECTION = 2.0 * this.CARD_WIDTH;
        this.ZONE_MODERATE_CORRECTION = 3.5 * this.CARD_WIDTH;
        this.ZONE_STRONG_CORRECTION = 5.0 * this.CARD_WIDTH;
        
        // Air resistance factors - tuned for shuffleboard feel
        this.airResistanceAway = 0.94; // Moderate drag when moving away (6% loss/frame)
        this.airResistanceAwayFar = 0.88; // Heavy drag when far and moving away (12% loss/frame)
        this.airResistanceToward = 0.96; // Light drag when moving toward (4% loss/frame)
        this.airResistanceMagnetic = 0.995; // Very light drag when in magnetic field
        
        // Animation state
        this.activeCards = new Map();
        this.animationFrame = null;
        this.lastTimestamp = 0;
        
        // Touch tracking
        this.touchHistory = [];
        this.maxTouchHistory = 5;
        
        // Flight physics state
        this.airbornCards = new Set(); // Track cards currently in flight
        this.playerPickingUp = false; // Flag for immediate card return
        
        // Bezier curve helpers for smooth arcs
        this.bezierCache = new Map(); // Cache computed bezier paths
        
        // Debug visualization elements (can be toggled on at runtime)
        this.debugContainer = null;
        this.fingerTrackingLine = null;
        this.trajectoryPath = null;
        this.actualPathLine = null;
        this.actualPathSvg = null;
        // Visual debug tracing is disabled by default; enable via
        //   window.__SLUFF_DEBUG_TRACERS__ = true
        // or localStorage.setItem('CARD_TRACERS', '1')
        this.debugVisualsEnabled = false;
    // Pivot/COM overlays toggle (pencil stab + arrow + vertical line)
    //   window.__SLUFF_DEBUG_PIVOT__ = true
    // or localStorage.setItem('DEBUG_CARD_PIVOT', '1')
    this.debugPivotEnabled = false;
        this.initDebugVisualization();
    }
    
    // Runtime toggle check for visual tracers
    isVisualsEnabled() {
        try {
            const ls = typeof window !== 'undefined' && window.localStorage ? window.localStorage.getItem('CARD_TRACERS') === '1' : false;
            const flag = typeof window !== 'undefined' ? window.__SLUFF_DEBUG_TRACERS__ === true : false;
            return !!(this.debugVisualsEnabled || ls || flag);
        } catch {
            return !!this.debugVisualsEnabled;
        }
    }

    // Runtime toggle check for pivot/COM overlays
    isPivotDebugEnabled() {
        try {
            const ls = typeof window !== 'undefined' && window.localStorage ? window.localStorage.getItem('DEBUG_CARD_PIVOT') === '1' : false;
            const flag = typeof window !== 'undefined' ? window.__SLUFF_DEBUG_PIVOT__ === true : false;
            return !!(this.debugPivotEnabled || ls || flag);
        } catch {
            return !!this.debugPivotEnabled;
        }
    }
    
    // Initialize debug visualization container
    initDebugVisualization() {
        if (!this.isVisualsEnabled()) {
            this.debugContainer = null;
            return;
        }
        // Create container for debug lines if it doesn't exist
        const existing = typeof document !== 'undefined' ? document.getElementById('card-physics-debug') : null;
        if (!existing && typeof document !== 'undefined') {
            this.debugContainer = document.createElement('div');
            this.debugContainer.id = 'card-physics-debug';
            this.debugContainer.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                pointer-events: none;
                z-index: 9999;
            `;
            document.body.appendChild(this.debugContainer);
        } else {
            this.debugContainer = existing;
        }
    }
    
    // Clear all debug visualizations
    clearDebugVisualizations() {
    if (this.debugContainer) {
            this.debugContainer.innerHTML = '';
        }
        this.fingerTrackingLine = null;
        this.trajectoryPath = null;
        this.actualPathLine = null;
        this.actualPathSvg = null;
    }
    
    // Start tracking actual card path
    startActualPathTracking(startPos) {
    if (!this.isVisualsEnabled()) return;
    if (!this.debugContainer) this.initDebugVisualization();
        // Create SVG for actual path
        this.actualPathSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        this.actualPathSvg.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
        `;
        
        this.actualPathLine = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        this.actualPathLine.setAttribute('stroke', '#ff6600'); // Orange for actual path
        this.actualPathLine.setAttribute('stroke-width', '3');
        this.actualPathLine.setAttribute('fill', 'none');
        this.actualPathLine.setAttribute('opacity', '0.8');
        this.actualPathLine.setAttribute('points', `${startPos.x},${startPos.y}`);
        
        this.actualPathSvg.appendChild(this.actualPathLine);
        this.debugContainer.appendChild(this.actualPathSvg);
    }
    
    // Update actual card path
    updateActualPath(position) {
    if (!this.isVisualsEnabled()) return;
    if (this.actualPathLine && position && !isNaN(position.x) && !isNaN(position.y)) {
            const currentPoints = this.actualPathLine.getAttribute('points');
            this.actualPathLine.setAttribute('points', `${currentPoints} ${position.x},${position.y}`);
        }
    }
    
    // Create or update finger tracking line
    updateFingerTrackingLine(touchPoint) {
    if (!this.isVisualsEnabled()) return;
    if (!this.debugContainer) this.initDebugVisualization();
        if (!this.fingerTrackingLine) {
            // Create SVG for finger tracking
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.style.cssText = `
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                pointer-events: none;
            `;
            
            this.fingerTrackingLine = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
            this.fingerTrackingLine.setAttribute('stroke', '#00ff00');
            this.fingerTrackingLine.setAttribute('stroke-width', '2');
            this.fingerTrackingLine.setAttribute('fill', 'none');
            this.fingerTrackingLine.setAttribute('points', `${touchPoint.x},${touchPoint.y}`);
            
            svg.appendChild(this.fingerTrackingLine);
            this.debugContainer.appendChild(svg);
        } else {
            // Add point to existing line
            const currentPoints = this.fingerTrackingLine.getAttribute('points');
            this.fingerTrackingLine.setAttribute('points', `${currentPoints} ${touchPoint.x},${touchPoint.y}`);
        }
    }
    
    // Draw trajectory path from release point to dock
    drawTrajectoryPath(startPos, endPos, curveType, velocity) {
    if (!this.isVisualsEnabled()) return;
    if (!this.debugContainer) this.initDebugVisualization();
        // Create SVG for trajectory
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
        `;
        
        // Calculate control points based on curve type and velocity
        let pathData;
        const dx = endPos.x - startPos.x;
        const dy = endPos.y - startPos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (curveType === 'straight') {
            pathData = `M ${startPos.x} ${startPos.y} L ${endPos.x} ${endPos.y}`;
        } else {
            // Calculate initial trajectory direction based on velocity
            const speed = velocity ? Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y) : 0;
            let initialReach = Math.min(distance * 0.4, speed * 0.3); // How far the card goes before curving
            
            // First control point follows initial velocity direction
            const cp1 = velocity && speed > 0 ? {
                x: startPos.x + (velocity.x / speed) * initialReach,
                y: startPos.y + (velocity.y / speed) * initialReach
            } : {
                x: startPos.x + dx * 0.3,
                y: startPos.y + dy * 0.3
            };
            
            // Second control point pulls toward dock
            const cp2 = {
                x: endPos.x - dx * 0.2,
                y: endPos.y - dy * 0.2
            };
            
            if (curveType === 'moderate_s' || curveType === 'strong_arc') {
                // More dramatic curve for off-target
                const perpX = -dy / distance * 100;
                const perpY = dx / distance * 100;
                cp1.x += perpX * 0.5;
                cp1.y += perpY * 0.5;
            }
            
            pathData = `M ${startPos.x} ${startPos.y} C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${endPos.x} ${endPos.y}`;
        }
        
        this.trajectoryPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        this.trajectoryPath.setAttribute('d', pathData);
        this.trajectoryPath.setAttribute('stroke', '#ff00ff');
        this.trajectoryPath.setAttribute('stroke-width', '2');
        this.trajectoryPath.setAttribute('stroke-dasharray', '10,5');
        this.trajectoryPath.setAttribute('fill', 'none');
        
        svg.appendChild(this.trajectoryPath);
        this.debugContainer.appendChild(svg);
    }
    
    // Start tracking a card when touched with airborne card management
    grabCard(cardId, touchPoint, cardElement, cardCenter) {
        // Clear all debug visualizations when picking up a new card
        this.clearDebugVisualizations();
        
        // Start tracking finger movement
        this.updateFingerTrackingLine(touchPoint);
        
        // SOPHISTICATED PHYSICS: Return all airborne cards when picking up new card
        if (this.airbornCards.size > 0 && !this.airbornCards.has(cardId)) {
            console.log(`Returning ${this.airbornCards.size} airborne cards before grabbing ${cardId}`);
            this.returnAllAirborneCards();
        }
        
        // Comprehensive error handling
        try {
            if (!cardId || !touchPoint || !cardElement) {
                throw new Error(`Invalid parameters for grabCard: cardId=${cardId}, touchPoint=${touchPoint}, cardElement=${cardElement}`);
            }
            
            if (typeof touchPoint.x !== 'number' || typeof touchPoint.y !== 'number') {
                throw new Error(`Invalid touch point coordinates: x=${touchPoint.x}, y=${touchPoint.y}`);
            }
            
            return this.originalGrabCard(cardId, touchPoint, cardElement, cardCenter);
            
        } catch (error) {
            console.error('Error in grabCard:', error);
            // Cleanup any partial state
            this.airbornCards.delete(cardId);
            if (this.activeCards.has(cardId)) {
                this.cleanupCard(cardId);
            }
            throw error;
        }
    }
    
    // Original grab card implementation
    originalGrabCard(cardId, touchPoint, cardElement, cardCenter) {
        // Get the visual position (includes margins)
        const rect = cardElement.getBoundingClientRect();
        
        // Get computed styles to check for margins
        const computedStyle = window.getComputedStyle(cardElement);
        const marginLeft = parseFloat(computedStyle.marginLeft) || 0;
        
        // Store initial rect for reference
        // Initial rect tracking removed - not needed
        
        // Get the actual current center based on rendered position
        const actualCenter = {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
        };
        
        // Calculate pivot point relative to actual card center
        const pivotOffset = {
            x: touchPoint.x - actualCenter.x,
            y: touchPoint.y - actualCenter.y
        };
        
        if (process.env.NODE_ENV === 'development' && marginLeft !== 0) {
            console.log('Card has margin-left:', marginLeft);
        }
        
        // Start with no rotation to avoid initial snap
        const initialRotation = 0;
        
        // Adjust docking position on desktop (15% higher)
        const isDesktop = window.innerWidth >= 1024;
        const dockingOffset = isDesktop ? -rect.height * 0.15 : 0;
        
        // Initialize card physics state
        this.activeCards.set(cardId, {
            element: cardElement,
            position: { x: touchPoint.x, y: touchPoint.y }, // Position is where the pivot is (at finger)
            velocity: { x: 0, y: 0 },
            rotation: initialRotation,
            angularVelocity: 0,
            pivotOffset: pivotOffset,
            touchPoint: touchPoint,
            lastTouchPoint: null, // Initialize as null, will be set after first frame
            initialTouch: { x: touchPoint.x, y: touchPoint.y },
            initialCardPos: { x: rect.left, y: rect.top },
            cardDimensions: { width: rect.width, height: rect.height },
            isDragging: true,
            originalPosition: { x: rect.left, y: rect.top + dockingOffset },
            cardCenter: actualCenter,
            grabTime: performance.now(),
            lifted: true,
            scale: 1.0, // Start at normal scale to avoid snap
            targetScale: 1.05, // Target scale for smooth animation
            totalRotation: 0, // Track total rotation for continuous spinning
            forceDocking: false, // Reset force docking flag
            forceDockStartPos: null,
            forceDockStartTime: null
        });
        
        // CRITICAL: Apply positioning styles and calculate initial position
        // to place pivot exactly at touch point
        cardElement.style.position = 'fixed';
        cardElement.style.left = '0';
        cardElement.style.top = '0';
        
        // Calculate initial position so pivot is at touch point
        // CRITICAL: Account for margin-left when positioning
        const initialCenterX = touchPoint.x - pivotOffset.x;
        const initialCenterY = touchPoint.y - pivotOffset.y;
        const initialTopLeftX = initialCenterX - rect.width / 2;
        const initialTopLeftY = initialCenterY - rect.height / 2;
        
        // The card's visual position needs to account for the margin that's being removed
        // When we switch to fixed positioning, the margin no longer affects position
        const adjustedTopLeftX = initialTopLeftX + marginLeft;
        
        cardElement.style.transform = `translate(${adjustedTopLeftX}px, ${initialTopLeftY}px)`;
        
        // Force layout calculation
        void cardElement.offsetHeight;
        
        // Now set remaining styles
        cardElement.setAttribute('data-physics-controlled', 'true');
        cardElement.style.transition = 'none';
        cardElement.style.zIndex = '99999';
        cardElement.style.transformOrigin = 'center'; // Always rotate around center
        cardElement.style.filter = 'drop-shadow(0 10px 20px rgba(0,0,0,0.3))';
        cardElement.style.pointerEvents = 'auto';
        cardElement.style.touchAction = 'none';
        cardElement.style.margin = '0'; // Remove any margins when dragging
        
    // Always compute and store center of mass for physics
    const centerOfMass = this.calculateCenterOfMass(cardId, rect);
    this.activeCards.get(cardId).centerOfMass = centerOfMass;

    // Optional debug overlays: pencil stab + COM arrow + vertical line
    // Controlled by Debug_Card_Pivot toggle
    if (this.isPivotDebugEnabled()) {
            // Calculate marker position in pixels from card's top-left
            const markerLeft = (rect.width / 2) + pivotOffset.x;
            const markerTop = (rect.height / 2) + pivotOffset.y;

            // Pencil stab marker
            const stabMarker = document.createElement('div');
            stabMarker.className = 'pencil-stab-marker';
            stabMarker.style.cssText = `
                position: absolute;
                width: 16px;
                height: 16px;
                background: radial-gradient(circle, #ff0000 0%, #ff0000 30%, transparent 40%, #8B0000 50%, transparent 60%);
                border-radius: 50%;
                left: ${markerLeft}px;
                top: ${markerTop}px;
                transform: translate(-50%, -50%);
                z-index: 10;
                pointer-events: none;
                box-shadow: 0 0 4px rgba(0,0,0,0.5);
            `;
            cardElement.appendChild(stabMarker);

            const arrowDx = centerOfMass.x - pivotOffset.x;
            const arrowDy = centerOfMass.y - pivotOffset.y;
            const arrowLength = Math.sqrt(arrowDx * arrowDx + arrowDy * arrowDy);
            const arrowAngle = Math.atan2(arrowDy, arrowDx);

            // COM arrow
            const arrowElement = document.createElement('div');
            arrowElement.className = 'center-of-mass-arrow';
            arrowElement.style.cssText = `
                position: absolute;
                width: ${arrowLength}px;
                height: 2px;
                background: linear-gradient(to right, rgba(0,0,255,0.7) 0%, rgba(0,0,255,0.7) 85%, transparent 85%);
                left: ${markerLeft}px;
                top: ${markerTop}px;
                transform-origin: 0 50%;
                transform: rotate(${arrowAngle}rad) translateY(-1px);
                z-index: 9;
                pointer-events: none;
            `;
            const arrowhead = document.createElement('div');
            arrowhead.style.cssText = `
                position: absolute;
                width: 0;
                height: 0;
                border-left: 8px solid rgba(0,0,255,0.7);
                border-top: 4px solid transparent;
                border-bottom: 4px solid transparent;
                right: -8px;
                top: 50%;
                transform: translateY(-50%);
            `;
            arrowElement.appendChild(arrowhead);
            cardElement.appendChild(arrowElement);

            // Vertical reference line
            const verticalLine = document.createElement('div');
            verticalLine.className = 'vertical-reference-line';
            verticalLine.style.cssText = `
                position: absolute;
                width: 1px;
                height: 100px;
                background: rgba(255, 0, 0, 0.3);
                left: ${markerLeft}px;
                top: ${markerTop}px;
                transform-origin: 0 0;
                z-index: 8;
                pointer-events: none;
            `;
            cardElement.appendChild(verticalLine);

            // Store references for cleanup
            this.activeCards.get(cardId).stabMarker = stabMarker;
            this.activeCards.get(cardId).arrowElement = arrowElement;
            this.activeCards.get(cardId).verticalLine = verticalLine;
        }
        
        // Debug: Ensure parent containers don't constrain movement
        let parent = cardElement.parentElement;
        const parentOverflows = [];
        while (parent && parent !== document.body) {
            const overflow = getComputedStyle(parent).overflow;
            if (overflow === 'hidden' || overflow === 'auto' || overflow === 'scroll') {
                parentOverflows.push({ element: parent, originalOverflow: parent.style.overflow });
                parent.style.overflow = 'visible';
            }
            parent = parent.parentElement;
        }
        
        // Store parent overflows to restore later
        this.activeCards.get(cardId).parentOverflows = parentOverflows;
        
        // Debug initial setup (only in development)
        if (process.env.NODE_ENV === 'development') {
            console.log('Card grabbed:', {
                cardId,
                position: this.activeCards.get(cardId).position,
                elementStyles: {
                    position: cardElement.style.position,
                    left: cardElement.style.left,
                    top: cardElement.style.top,
                    zIndex: cardElement.style.zIndex
                },
                rect,
                touchPoint,
                parentOverflows: parentOverflows.length
            });
        }
        
        // Don't call applyTransform here - we already set the correct transform above
        
        // Debug: Check if pencil marker is at finger position after transform
    if (process.env.NODE_ENV === 'development') {
            // Wait two frames to ensure all updates have been applied
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                const cardRect = cardElement.getBoundingClientRect();
        // If pivot debug is disabled, skip marker alignment logging
        if (!this.isPivotDebugEnabled()) return;
        const stab = this.activeCards.get(cardId)?.stabMarker;
        if (!stab) return;
        const markerRect = stab.getBoundingClientRect();
                const markerCenter = {
                    x: markerRect.left + markerRect.width / 2,
                    y: markerRect.top + markerRect.height / 2
                };
                const cardCenter = {
                    x: cardRect.left + cardRect.width / 2,
                    y: cardRect.top + cardRect.height / 2
                };
                
                // Calculate where the marker should be based on pivot offset
                const expectedMarkerX = cardCenter.x + pivotOffset.x;
                const expectedMarkerY = cardCenter.y + pivotOffset.y;
                
                const offset = {
                    x: markerCenter.x - touchPoint.x,
                    y: markerCenter.y - touchPoint.y
                };
                
                if (Math.abs(offset.x) > 2 || Math.abs(offset.y) > 2) {
                    console.warn('Pencil marker offset from finger:', offset);
                    console.log('Debug info:', {
                        markerCenter,
                        touchPoint,
                        cardCenter,
                        pivotOffset,
                        expectedMarker: { x: expectedMarkerX, y: expectedMarkerY },
                        markerVsExpected: { 
                            x: markerCenter.x - expectedMarkerX, 
                            y: markerCenter.y - expectedMarkerY 
                        }
                    });
                }
                });
            });
        }
        
        // Start physics loop if not running
        if (!this.animationFrame) {
            this.startPhysicsLoop();
        }
        
        // Track touch for velocity calculation
        this.addTouchPoint(touchPoint);
    }
    
    // Update card position during drag
    dragCard(cardId, touchPoint) {
        const card = this.activeCards.get(cardId);
        if (!card || !card.isDragging) return;
        
        // Update finger tracking line
        this.updateFingerTrackingLine(touchPoint);
        
        // Track touch history for velocity
        this.addTouchPoint(touchPoint);
        
        // Update touch point (but keep lastTouchPoint for delta calculation)
        card.touchPoint = { x: touchPoint.x, y: touchPoint.y };
        
        // Calculate velocity from touch history
        const velocity = this.calculateVelocity();
        card.velocity = velocity;
        
        // Debug log to ensure dragCard is being called
        if (card.frameCount === undefined) card.frameCount = 0;
        card.frameCount++;
        if (card.frameCount % 30 === 0) { // Log every 30 frames
            console.log('dragCard called:', {
                frame: card.frameCount,
                touchPoint: { x: touchPoint.x.toFixed(1), y: touchPoint.y.toFixed(1) },
                lastTouchPoint: card.lastTouchPoint ? 
                    { x: card.lastTouchPoint.x.toFixed(1), y: card.lastTouchPoint.y.toFixed(1) } : 
                    'null'
            });
        }
    }
    
    // Release card and calculate trajectory with sophisticated physics
    releaseCard(cardId, dropZoneCenter, onComplete) {
        const card = this.activeCards.get(cardId);
        if (!card) return;
        
        // Critical check - if no drop zone, return card home
        if (!dropZoneCenter) {
            console.error('No dropZoneCenter provided - card will return home');
            this.returnCardHome(card, cardId, onComplete, 'No drop zone');
            return;
        }
        
        // Add card to airborne tracking
        this.airbornCards.add(cardId);
        
        card.isDragging = false;
        card.releaseTime = performance.now();
        
        // Calculate release velocity
        const velocity = this.calculateVelocity();
        card.velocity = velocity;
        
        // Debug: Log velocity angle
        const releaseAngle = Math.atan2(velocity.y, velocity.x) * 180 / Math.PI;
        console.log('Release velocity:', {
            vx: velocity.x.toFixed(1),
            vy: velocity.y.toFixed(1),
            angle: releaseAngle.toFixed(1) + '°',
            interpretation: releaseAngle > 45 && releaseAngle < 135 ? 'DOWNWARD' : 
                           releaseAngle < -45 && releaseAngle > -135 ? 'UPWARD' :
                           Math.abs(releaseAngle) < 45 ? 'RIGHTWARD' : 'LEFTWARD'
        });
        
        // Get current card position for calculations
        const rect = card.element.getBoundingClientRect();
        const currentCenter = {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
        };
        
        // SOPHISTICATED FLIGHT PHYSICS: Invalid throw detection
        const invalidThrowResult = this.detectInvalidThrow(currentCenter, dropZoneCenter, velocity, card);
        
        if (invalidThrowResult.isInvalid) {
            console.log(`Invalid throw detected: ${invalidThrowResult.reason}`);
            this.returnCardHome(card, cardId, onComplete, invalidThrowResult.reason);
            return;
        }
        
        // Classify throw velocity
        const throwClassification = this.classifyThrowVelocity(velocity);
        card.throwType = throwClassification.type;
        card.throwSpeed = throwClassification.speed;
        
        // Determine if throw is on-target or off-target
        const aimAnalysis = this.analyzeThrowAim(currentCenter, dropZoneCenter, velocity);
        card.aimOffset = aimAnalysis.offset;
        card.isOnTarget = aimAnalysis.isOnTarget;
        
        console.log(`Throw Analysis: ${throwClassification.type} ${aimAnalysis.isOnTarget ? 'on-target' : 'off-target'} throw`, {
            speed: throwClassification.speed.toFixed(1),
            offset: aimAnalysis.offset.toFixed(1),
            reason: aimAnalysis.reason
        });
        
        // IMPORTANT: Preserve angular momentum from dragging
        // The angular velocity should continue from whatever spin the user imparted
        // Don't reset or modify it here - let it carry through to the flight
        
        console.log('Card released:', {
            cardId,
            speed: throwClassification.speed.toFixed(1),
            dragDuration: ((performance.now() - card.grabTime) / 1000).toFixed(2),
            throwType: throwClassification.type,
            currentCenter: { x: currentCenter.x.toFixed(1), y: currentCenter.y.toFixed(1) },
            dropZoneCenter: dropZoneCenter ? { x: dropZoneCenter.x.toFixed(1), y: dropZoneCenter.y.toFixed(1) } : null,
            angularVelocity: (card.angularVelocity * 180 / Math.PI).toFixed(1) + '°/s'
        });
        
        // Setup sophisticated flight physics based on throw analysis
        card.targetPosition = {
            x: dropZoneCenter.x - rect.width / 2,
            y: dropZoneCenter.y - rect.height / 2
        };
        card.dropZoneCenter = dropZoneCenter;
        card.isReturning = false;
        card.flightStartTime = performance.now();
        card.currentPosition = { ...currentCenter };
        
        // Initialize flight physics based on throw type and aim
        this.initializeFlightPhysics(card, currentCenter, dropZoneCenter, aimAnalysis, throwClassification);
        
        // Draw the intended trajectory path
        const curveType = card.flightPhysics && card.flightPhysics.curveType ? 
                         card.flightPhysics.curveType : 
                         aimAnalysis.isOnTarget ? 'gentle' : 'moderate_s';
        this.drawTrajectoryPath(currentCenter, dropZoneCenter, curveType, velocity);
        
        // Start tracking actual card path
        this.startActualPathTracking(currentCenter);
        
        card.onComplete = (success) => {
            console.log('Card onComplete callback called:', {
                cardId,
                success,
                calledFrom: 'sophisticated flight physics'
            });
            
            // Remove from airborne tracking
            this.airbornCards.delete(cardId);
            
            if (typeof onComplete === 'function') {
                onComplete(success !== false);
            }
            
            // Clean up after a delay to let game process the play
            setTimeout(() => {
                this.cleanupCard(cardId);
            }, 500);
        };
        
        // Clear touch history
        this.touchHistory = [];
    }
    
    // SOPHISTICATED FLIGHT PHYSICS METHODS
    
    /**
     * Detect invalid throws that should immediately return home
     * @param {Object} startPos - Current card position
     * @param {Object} targetPos - Target drop zone position  
     * @param {Object} velocity - Throw velocity
     * @param {Object} card - Card object
     * @returns {Object} - {isInvalid: boolean, reason: string}
     */
    detectInvalidThrow(startPos, targetPos, velocity, card) {
        try {
            // Validate inputs
            if (!startPos || !targetPos || !velocity) {
                return { isInvalid: true, reason: 'Invalid input parameters' };
            }
            
            if (!this.isValidPosition(startPos) || !this.isValidPosition(targetPos)) {
                return { isInvalid: true, reason: 'Invalid position coordinates' };
            }
            
            if (!this.isValidVelocity(velocity)) {
                return { isInvalid: true, reason: 'Invalid velocity values' };
            }
            
            const speed = Math.sqrt(velocity.x ** 2 + velocity.y ** 2);
            
            // Check 1: Downward throws (pointing mostly down, between 45° and 135°)
            // In screen coordinates: 0° = right, 90° = down, 180° = left, -90° = up
            const throwAngle = Math.atan2(velocity.y, velocity.x);
            const throwAngleDegrees = throwAngle * 180 / Math.PI;
            
            // Reject if pointing downward (between 45° and 135°)
            if (throwAngle > Math.PI / 4 && throwAngle < 3 * Math.PI / 4) {
                console.log(`Invalid downward throw: angle=${throwAngleDegrees.toFixed(1)}°`);
                return { isInvalid: true, reason: 'Downward throw angle' };
            }
            
            // Check 2: Insufficient velocity to travel minimum distance
            const distanceToTarget = Math.sqrt(
                Math.pow(targetPos.x - startPos.x, 2) + 
                Math.pow(targetPos.y - startPos.y, 2)
            );
            
            if (speed < 50 && distanceToTarget > this.MIN_DISTANCE_FOR_VALID_THROW) {
                return { isInvalid: true, reason: 'Insufficient velocity for distance' };
            }
            
            // Check 3: Aim offset beyond acceptable range
            const aimOffset = this.calculateAimOffset(startPos, targetPos, velocity);
            // Recalculate MAX_AIM_OFFSET in case screen size changed
            const currentMaxOffset = this.calculateMaxAimOffset();
            if (aimOffset > currentMaxOffset) {
                return { isInvalid: true, reason: `Aim offset too large: ${aimOffset.toFixed(1)}px` };
            }
            
            return { isInvalid: false, reason: '' };
            
        } catch (error) {
            console.error('Error in detectInvalidThrow:', error);
            return { isInvalid: true, reason: 'Error in throw detection' };
        }
    }
    
    /**
     * Validate position object
     * @param {Object} pos - Position to validate
     * @returns {boolean} - True if valid
     */
    isValidPosition(pos) {
        return pos && 
               typeof pos.x === 'number' && 
               typeof pos.y === 'number' && 
               isFinite(pos.x) && 
               isFinite(pos.y);
    }
    
    /**
     * Validate velocity object
     * @param {Object} vel - Velocity to validate
     * @returns {boolean} - True if valid
     */
    isValidVelocity(vel) {
        return vel && 
               typeof vel.x === 'number' && 
               typeof vel.y === 'number' && 
               isFinite(vel.x) && 
               isFinite(vel.y);
    }
    
    /**
     * Classify throw velocity into Fast/Medium/Slow categories
     * @param {Object} velocity - Throw velocity vector
     * @returns {Object} - {type: string, speed: number}
     */
    classifyThrowVelocity(velocity) {
        const speed = Math.sqrt(velocity.x ** 2 + velocity.y ** 2);
        
        if (speed >= this.VELOCITY_MEDIUM_THRESHOLD) {
            return { type: 'Fast', speed };
        } else if (speed >= this.VELOCITY_SLOW_THRESHOLD) {
            return { type: 'Medium', speed };
        } else {
            return { type: 'Slow', speed };
        }
    }
    
    /**
     * Analyze throw aim to determine if it's on-target or off-target
     * @param {Object} startPos - Starting position
     * @param {Object} targetPos - Target position
     * @param {Object} velocity - Throw velocity
     * @returns {Object} - {isOnTarget: boolean, offset: number, reason: string}
     */
    analyzeThrowAim(startPos, targetPos, velocity) {
        const aimOffset = this.calculateAimOffset(startPos, targetPos, velocity);
        const speed = Math.sqrt(velocity.x ** 2 + velocity.y ** 2);
        
        // For truly fast throws, be more conservative about calling them "on-target"
        // Fast throws need tighter aim to be considered on-target
        const speedAdjustedThreshold = speed > 1200 ? 
            this.ZONE_MINIMAL_CORRECTION : // Fast throws: only perfect aim is "on-target"
            this.ZONE_MODERATE_CORRECTION;  // Normal/Medium speed: more forgiving
        
        const isOnTarget = aimOffset <= speedAdjustedThreshold;
        
        let reason;
        if (aimOffset <= this.ZONE_MINIMAL_CORRECTION) {
            reason = speed > 1200 ? 'Fast but well-aimed' : 'Perfect aim';
        } else if (aimOffset <= this.ZONE_MODERATE_CORRECTION) {
            reason = speed > 1200 ? 'Fast and slightly off' : 'Good aim';
        } else if (aimOffset <= this.ZONE_STRONG_CORRECTION) {
            reason = 'Moderate off-target';
        } else {
            reason = 'Significantly off-target';
        }
        
        return { isOnTarget, offset: aimOffset, reason };
    }
    
    /**
     * Calculate the perpendicular distance between throw trajectory and target
     * @param {Object} startPos - Starting position
     * @param {Object} targetPos - Target position
     * @param {Object} velocity - Throw velocity
     * @returns {number} - Aim offset in pixels
     */
    calculateAimOffset(startPos, targetPos, velocity) {
        // Calculate the closest point on the trajectory line to the target
        const dx = targetPos.x - startPos.x;
        const dy = targetPos.y - startPos.y;
        const vx = velocity.x;
        const vy = velocity.y;
        
        // If velocity is zero, return direct distance
        if (vx === 0 && vy === 0) {
            return Math.sqrt(dx * dx + dy * dy);
        }
        
        // Parameter t for closest approach
        const t = (dx * vx + dy * vy) / (vx * vx + vy * vy);
        
        // If t < 0, trajectory points away from target
        if (t < 0) {
            return Math.sqrt(dx * dx + dy * dy); // Return direct distance
        }
        
        // Calculate closest point on trajectory
        const closestX = startPos.x + vx * t;
        const closestY = startPos.y + vy * t;
        
        // Return distance from closest point to target
        return Math.sqrt(
            Math.pow(closestX - targetPos.x, 2) + 
            Math.pow(closestY - targetPos.y, 2)
        );
    }
    
    /**
     * Initialize sophisticated flight physics based on throw analysis
     * @param {Object} card - Card object
     * @param {Object} startPos - Starting position
     * @param {Object} targetPos - Target position
     * @param {Object} aimAnalysis - Aim analysis result
     * @param {Object} throwClassification - Throw velocity classification
     */
    initializeFlightPhysics(card, startPos, targetPos, aimAnalysis, throwClassification) {
        card.flightPhysics = {
            startPos: { ...startPos },
            targetPos: { ...targetPos },
            aimOffset: aimAnalysis.offset,
            isOnTarget: aimAnalysis.isOnTarget,
            throwType: throwClassification.type,
            initialVelocity: { ...card.velocity },
            guidanceActive: false,
            guidanceStartTime: null,
            correctionIntensity: this.calculateCorrectionIntensity(aimAnalysis.offset),
            bezierPath: null,
            pathProgress: 0,
            useGuidance: this.shouldUseGuidance(throwClassification, aimAnalysis)
        };
        
        // Pre-calculate bezier path for off-target throws
        if (!aimAnalysis.isOnTarget && card.flightPhysics.useGuidance) {
            card.flightPhysics.bezierPath = this.calculateBezierPath(startPos, targetPos, card.velocity, aimAnalysis.offset);
        }
        
        console.log('Flight physics initialized:', {
            throwType: throwClassification.type,
            aimOffset: aimAnalysis.offset.toFixed(1),
            correctionIntensity: card.flightPhysics.correctionIntensity,
            useGuidance: card.flightPhysics.useGuidance,
            hasBezierPath: !!card.flightPhysics.bezierPath
        });
    }
    
    /**
     * Calculate correction intensity based on aim offset
     * @param {number} aimOffset - Aim offset in pixels
     * @returns {number} - Correction intensity (0-1)
     */
    calculateCorrectionIntensity(aimOffset) {
        if (aimOffset <= this.ZONE_MINIMAL_CORRECTION) {
            return 0.2; // Minimal correction
        } else if (aimOffset <= this.ZONE_MODERATE_CORRECTION) {
            return 0.5; // Moderate S-curve
        } else if (aimOffset <= this.ZONE_STRONG_CORRECTION) {
            return 0.8; // Strong curve/horseshoe
        } else {
            return 1.0; // Maximum correction
        }
    }
    
    /**
     * Determine if guidance should be used based on throw characteristics
     * @param {Object} throwClassification - Throw velocity classification
     * @param {Object} aimAnalysis - Aim analysis result
     * @returns {boolean} - Whether to use guidance
     */
    shouldUseGuidance(throwClassification, aimAnalysis) {
        // Always use guidance for off-target throws
        if (!aimAnalysis.isOnTarget) return true;
        
        // Use gentle guidance for slow on-target throws
        if (throwClassification.type === 'Slow') return true;
        
        // Minimal guidance for fast/medium on-target throws
        return throwClassification.type !== 'Fast';
    }
    
    /**
     * Calculate bezier curve path for smooth arcing trajectories
     * @param {Object} startPos - Starting position
     * @param {Object} targetPos - Target position
     * @param {Object} initialVelocity - Initial velocity vector
     * @param {number} aimOffset - Aim offset for curve calculation
     * @returns {Object} - Bezier path data
     */
    calculateBezierPath(startPos, targetPos, initialVelocity, aimOffset) {
        const dx = targetPos.x - startPos.x;
        const dy = targetPos.y - startPos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // Control point calculation for horseshoe effect
        // Currently not used but may be needed for future bezier adjustments
        // const midX = startPos.x + dx * 0.5;
        // const midY = startPos.y + dy * 0.5;
        
        // Perpendicular vector for arc displacement
        const perpX = -dy / distance;
        const perpY = dx / distance;
        
        // Arc intensity based on offset and distance
        const arcIntensity = Math.min(aimOffset * 0.5, distance * 0.3);
        
        // Create bezier control points for toilet bowl effect
        const cp1X = startPos.x + dx * 0.25 + perpX * arcIntensity;
        const cp1Y = startPos.y + dy * 0.25 + perpY * arcIntensity;
        const cp2X = startPos.x + dx * 0.75 + perpX * arcIntensity * 0.5;
        const cp2Y = startPos.y + dy * 0.75 + perpY * arcIntensity * 0.5;
        
        return {
            p0: { ...startPos },
            cp1: { x: cp1X, y: cp1Y },
            cp2: { x: cp2X, y: cp2Y },
            p3: { ...targetPos },
            totalLength: distance,
            arcIntensity
        };
    }
    
    /**
     * Return card home immediately with direct path
     * @param {Object} card - Card object
     * @param {string} cardId - Card ID
     * @param {Function} onComplete - Completion callback
     * @param {string} reason - Reason for return
     */
    returnCardHome(card, cardId, onComplete, reason) {
        console.log(`Returning card home: ${reason}`);
        
        card.targetPosition = card.originalPosition;
        card.isReturning = true;
        card.velocity = { x: 0, y: 0 }; // Stop current motion
        card.returnReason = reason;
        
        // Direct line return - no arc
        card.onComplete = () => {
            this.airbornCards.delete(cardId);
            this.cleanupCard(cardId);
            if (typeof onComplete === 'function') {
                onComplete(false);
            }
        };
    }
    
    /**
     * Force immediate return of all airborne cards (when player picks up another card)
     */
    returnAllAirborneCards() {
        console.log(`Returning ${this.airbornCards.size} airborne cards immediately`);
        
        this.airbornCards.forEach(cardId => {
            const card = this.activeCards.get(cardId);
            if (card && !card.isReturning) {
                this.returnCardHome(card, cardId, card.onComplete, 'Player picked up another card');
            }
        });
    }
    
    /**
     * Update sophisticated flight physics with intelligent guidance
     * @param {Object} card - Card object
     * @param {number} deltaTime - Time delta in seconds
     * @param {number} distance - Distance to target
     * @param {Object} toTarget - Vector to target
     */
    updateSophisticatedFlightPhysics(card, deltaTime, distance, toTarget) {
        const physics = card.flightPhysics;
        const flightTime = (performance.now() - card.flightStartTime) / 1000;
        
        // DOCK CAPTURE ZONE - Prevent skip-over
        const DOCK_CAPTURE_RADIUS = 100; // Generous capture zone
        const MAX_DOCK_SPEED = 500; // Max speed for docking
        
        if (distance < DOCK_CAPTURE_RADIUS) {
            const currentSpeed = Math.sqrt(card.velocity.x ** 2 + card.velocity.y ** 2);
            
            // Check if we're approaching the dock
            const approachingDock = (toTarget.x * card.velocity.x + toTarget.y * card.velocity.y) > 0;
            
            if (approachingDock) {
                // Within capture zone and approaching - ensure smooth docking
                if (currentSpeed > MAX_DOCK_SPEED) {
                    // Too fast - apply braking
                    const brakeFactor = MAX_DOCK_SPEED / currentSpeed;
                    card.velocity.x *= brakeFactor;
                    card.velocity.y *= brakeFactor;
                    console.log('Braking for dock approach:', currentSpeed.toFixed(1), '->', MAX_DOCK_SPEED);
                }
                
                // Magnetic pull toward dock center
                const magneticStrength = (1 - distance / DOCK_CAPTURE_RADIUS) * 200;
                const dirX = toTarget.x / distance;
                const dirY = toTarget.y / distance;
                card.velocity.x += dirX * magneticStrength * deltaTime;
                card.velocity.y += dirY * magneticStrength * deltaTime;
                
                // Check for immediate docking - more forgiving for rotated cards
                const rotationFactor = Math.abs(Math.cos(card.rotation)); // 1 when vertical, 0 when horizontal
                const dockingThreshold = 20 + (1 - rotationFactor) * 15; // 20-35 based on rotation
                if (distance < dockingThreshold) {
                    this.completeDocking(card, 'Magnetic dock capture');
                    return;
                }
            }
        }
        
        // Apply different physics based on throw characteristics
        if (physics.isOnTarget) {
            this.updateOnTargetThrow(card, deltaTime, distance, toTarget, flightTime);
        } else {
            this.updateOffTargetThrow(card, deltaTime, distance, toTarget, flightTime);
        }
        
        // Apply motion with near-dock overshoot protection and viewport clamping
        let nextX = card.position.x + card.velocity.x * deltaTime;
        let nextY = card.position.y + card.velocity.y * deltaTime;

        // Compute centers for overshoot detection
        const cardHalfW = (card.cardDimensions ? card.cardDimensions.width : this.CARD_WIDTH) / 2;
        const cardHalfH = (card.cardDimensions ? card.cardDimensions.height : this.CARD_HEIGHT) / 2;
        const nextCenterX = nextX + cardHalfW;
        const nextCenterY = nextY + cardHalfH;
        const targetCenterX = card.targetPosition.x + cardHalfW;
        const targetCenterY = card.targetPosition.y + cardHalfH;
        const nextToTargetX = targetCenterX - nextCenterX;
        const nextToTargetY = targetCenterY - nextCenterY;
        const nextDistance = Math.sqrt(nextToTargetX * nextToTargetX + nextToTargetY * nextToTargetY);

        // If we're close to dock, don't allow a single step to increase distance dramatically
        // This avoids a last-frame spike that can shoot the card offscreen
        const NEAR_DOCK_RADIUS = 180; // Slightly larger than capture radius
        if (distance < NEAR_DOCK_RADIUS) {
            // If proposed step increases distance notably, clamp step toward target and damp velocity
            if (nextDistance > distance + 30) {
                const dirX = distance > 0 ? toTarget.x / distance : 0;
                const dirY = distance > 0 ? toTarget.y / distance : 0;
                const maxStep = Math.max(20, distance * 0.5); // Limit how far we can move in one frame near dock
                nextX = card.position.x + dirX * maxStep;
                nextY = card.position.y + dirY * maxStep;
                // Update velocity to reflect clamped step
                if (deltaTime > 0) {
                    card.velocity.x = (nextX - card.position.x) / deltaTime;
                    card.velocity.y = (nextY - card.position.y) / deltaTime;
                }
            }
        }

        // Viewport safety clamp to prevent temporary offscreen jumps
        const PAD = 60; // Allow a little leeway beyond edges
        const maxX = (window.innerWidth || 0) - (card.cardDimensions ? card.cardDimensions.width : this.CARD_WIDTH) + PAD;
        const maxY = (window.innerHeight || 0) - (card.cardDimensions ? card.cardDimensions.height : this.CARD_HEIGHT) + PAD;
        const minX = -PAD;
        const minY = -PAD;
        if (isFinite(maxX) && isFinite(maxY)) {
            if (nextX < minX || nextX > maxX || nextY < minY || nextY > maxY) {
                // Softly steer back in-bounds by damping velocity
                card.velocity.x *= 0.8;
                card.velocity.y *= 0.8;
                nextX = Math.min(Math.max(nextX, minX), maxX);
                nextY = Math.min(Math.max(nextY, minY), maxY);
            }
        }
        
        // Smooth final approach when very close - expanded range for rotated cards
        const currentSpeed = Math.sqrt(card.velocity.x ** 2 + card.velocity.y ** 2);
        const rotationFactor = Math.abs(Math.cos(card.rotation)); // Account for card rotation
        const approachThreshold = 30 + (1 - rotationFactor) * 20; // 30-50 based on rotation
        if (distance < approachThreshold && !physics.wrapAroundActive) {  
            // Very close - ensure smooth docking
            const dockX = card.targetPosition.x + card.cardDimensions.width / 2;
            const dockY = card.targetPosition.y + card.cardDimensions.height / 2;
            
            // Blend toward dock position smoothly
            const magnetFactor = Math.min(0.4, (approachThreshold - distance) / approachThreshold); // Stronger as we get closer
            const targetSpeed = Math.min(currentSpeed, 200); // Cap speed for final approach
            
            const dirX = (dockX - card.position.x) / Math.max(distance, 1);
            const dirY = (dockY - card.position.y) / Math.max(distance, 1);
            
            // Blend velocity instead of replacing it
            card.velocity.x = card.velocity.x * (1 - magnetFactor) + dirX * targetSpeed * magnetFactor;
            card.velocity.y = card.velocity.y * (1 - magnetFactor) + dirY * targetSpeed * magnetFactor;
        }
        
        // Safe to move
    card.position.x = nextX;
    card.position.y = nextY;
        
        // Track actual path for debug visualization
        const cardCenterX = card.position.x + (card.cardDimensions ? card.cardDimensions.width / 2 : 40);
        const cardCenterY = card.position.y + (card.cardDimensions ? card.cardDimensions.height / 2 : 60);
        this.updateActualPath({ x: cardCenterX, y: cardCenterY });
        
        // Maintain angular momentum (never alter spin)
        // More forgiving damping for non-vertical cards
        // rotationFactor already calculated above for approach threshold
        if (distance > approachThreshold) {
            card.angularVelocity *= 0.998; // Almost no damping during flight
        } else {
            // Less damping for rotated cards to let them settle naturally
            const dampingRate = 0.92 + (1 - rotationFactor) * 0.03; // 0.92-0.95 based on rotation
            card.angularVelocity *= dampingRate;
        }
        
        card.rotation += card.angularVelocity * deltaTime;
    }
    
    /**
     * Update physics for on-target throws
     * @param {Object} card - Card object
     * @param {number} deltaTime - Time delta
     * @param {number} distance - Distance to target
     * @param {Object} toTarget - Vector to target
     * @param {number} flightTime - Total flight time
     */
    updateOnTargetThrow(card, deltaTime, distance, toTarget, flightTime) {
        const physics = card.flightPhysics;
        
        // CORE DOCKING TIME GUARANTEE
        const elapsedTime = flightTime;
        const remainingTime = this.DOCKING_TIME_LIMIT - elapsedTime;
        
        if (remainingTime <= 0) {
            // Smoothly transition to dock if time's up
            if (!card.forceDocking) {
                card.forceDocking = true;
                card.forceDockStartPos = { ...card.position };
                card.forceDockStartTime = performance.now();
            }
            
            // Smooth transition over 100ms
            const forceDockElapsed = (performance.now() - card.forceDockStartTime) / 100;
            const forceDockProgress = Math.min(forceDockElapsed, 1.0);
            const easeProgress = this.easeInOutQuad(forceDockProgress);
            
            const targetX = card.targetPosition.x + card.cardDimensions.width / 2;
            const targetY = card.targetPosition.y + card.cardDimensions.height / 2;
            
            card.position.x = card.forceDockStartPos.x + (targetX - card.forceDockStartPos.x) * easeProgress;
            card.position.y = card.forceDockStartPos.y + (targetY - card.forceDockStartPos.y) * easeProgress;
            
            if (forceDockProgress >= 1.0) {
                this.completeDocking(card, 'Time limit reached - smooth docking');
            }
            return;
        }
        
        // Calculate if we'll make it in time
        const currentSpeed = Math.sqrt(card.velocity.x ** 2 + card.velocity.y ** 2);
        const estimatedTimeToDoc = distance / currentSpeed;
        
        if (physics.throwType === 'Slow' || estimatedTimeToDoc > remainingTime) {
            // Need acceleration to meet 1.5s deadline
            if (!physics.guidanceActive) {
                physics.guidanceActive = true;
                physics.guidanceStartTime = performance.now();
                console.log('Activating guidance to meet 1.5s deadline');
            }
            
            // Calculate required speed to reach dock in remaining time
            const requiredSpeed = distance / remainingTime;
            
            // Smooth acceleration using ease-in curve
            const guidanceTime = (performance.now() - physics.guidanceStartTime) / 1000;
            const accelerationCurve = this.easeInQuad(Math.min(guidanceTime / remainingTime, 1.0));
            
            // Gradually increase speed to meet deadline
            const targetSpeed = currentSpeed + (requiredSpeed - currentSpeed) * accelerationCurve;
            const speedMultiplier = targetSpeed / currentSpeed;
            
            // Apply acceleration while initially maintaining direction
            if (currentSpeed > 0) {
                card.velocity.x *= speedMultiplier;
                card.velocity.y *= speedMultiplier;
            }
            
            // Progressive angle adjustment that steepens over time
            const progressiveFactor = accelerationCurve * accelerationCurve; // Quadratic ramp
            const correctionStrength = 150 * progressiveFactor;
            
            // Apply direction correction toward dock
            const dirX = toTarget.x / distance;
            const dirY = toTarget.y / distance;
            card.velocity.x += dirX * correctionStrength * deltaTime;
            card.velocity.y += dirY * correctionStrength * deltaTime;
            
        } else {
            // Fast/Medium throws - need stronger guidance for high speeds
            const currentSpeed = Math.sqrt(card.velocity.x ** 2 + card.velocity.y ** 2);
            
            // Immediate guidance for fast throws (no waiting)
            if (!physics.guidanceActive) {
                physics.guidanceActive = true;
                physics.guidanceStartTime = performance.now();
                console.log(`${physics.throwType} on-target throw: Speed=${currentSpeed.toFixed(0)}, activating guidance`);
            }
            
            if (physics.guidanceActive) {
                const guidanceTime = (performance.now() - physics.guidanceStartTime) / 1000;
                
                // Calculate desired velocity to reach dock
                const timeRemaining = Math.max(0.5, remainingTime); // At least 0.5s
                const desiredSpeed = distance / timeRemaining;
                
                // Blend current velocity toward desired direction
                const targetVelX = (toTarget.x / distance) * desiredSpeed;
                const targetVelY = (toTarget.y / distance) * desiredSpeed;
                
                // Smooth blending factor - starts gentle, increases over time
                const blendFactor = Math.min(guidanceTime * 2, 1.0) * 0.3; // Max 30% blend per frame
                
                // Debug: Log velocity before and after guidance
                const velBefore = { x: card.velocity.x, y: card.velocity.y };
                
                // Blend toward target velocity
                card.velocity.x = card.velocity.x * (1 - blendFactor) + targetVelX * blendFactor;
                card.velocity.y = card.velocity.y * (1 - blendFactor) + targetVelY * blendFactor;
                
                // Log every 10th frame to avoid spam
                if (Math.random() < 0.1) {
                    const currentSpeed = Math.sqrt(card.velocity.x ** 2 + card.velocity.y ** 2);
                    console.log('Guidance blending:', {
                        velBefore: { x: velBefore.x.toFixed(1), y: velBefore.y.toFixed(1) },
                        velAfter: { x: card.velocity.x.toFixed(1), y: card.velocity.y.toFixed(1) },
                        targetVel: { x: targetVelX.toFixed(1), y: targetVelY.toFixed(1) },
                        blendFactor: blendFactor.toFixed(3),
                        distance: distance.toFixed(1),
                        currentSpeed: currentSpeed.toFixed(1),
                        desiredSpeed: desiredSpeed.toFixed(1)
                    });
                }
            }
        }
        
        // Natural air resistance
        card.velocity.x *= 0.995;
        card.velocity.y *= 0.995;
    }
    
    /**
     * Update physics for off-target throws with graduated response
     * @param {Object} card - Card object
     * @param {number} deltaTime - Time delta
     * @param {number} distance - Distance to target
     * @param {Object} toTarget - Vector to target
     * @param {number} flightTime - Total flight time
     */
    updateOffTargetThrow(card, deltaTime, distance, toTarget, flightTime) {
        const physics = card.flightPhysics;
        
        // CORE DOCKING TIME GUARANTEE
        const elapsedTime = flightTime;
        const remainingTime = this.DOCKING_TIME_LIMIT - elapsedTime;
        
        if (remainingTime <= 0) {
            // Smoothly transition to dock if time's up
            if (!card.forceDocking) {
                card.forceDocking = true;
                card.forceDockStartPos = { ...card.position };
                card.forceDockStartTime = performance.now();
            }
            
            // Smooth transition over 100ms
            const forceDockElapsed = (performance.now() - card.forceDockStartTime) / 100;
            const forceDockProgress = Math.min(forceDockElapsed, 1.0);
            const easeProgress = this.easeInOutQuad(forceDockProgress);
            
            const targetX = card.targetPosition.x + card.cardDimensions.width / 2;
            const targetY = card.targetPosition.y + card.cardDimensions.height / 2;
            
            card.position.x = card.forceDockStartPos.x + (targetX - card.forceDockStartPos.x) * easeProgress;
            card.position.y = card.forceDockStartPos.y + (targetY - card.forceDockStartPos.y) * easeProgress;
            
            if (forceDockProgress >= 1.0) {
                this.completeDocking(card, 'Time limit reached - smooth docking');
            }
            return;
        }
        
        // Calculate current speed first (needed for multiple checks)
        const currentSpeed = Math.sqrt(card.velocity.x ** 2 + card.velocity.y ** 2);
        
        // Check if card is going offscreen (check screen bounds)
        const screenPadding = 100; // Start wrapping before fully offscreen
        const isOffscreen = card.position.x < -screenPadding || 
                           card.position.x > window.innerWidth + screenPadding ||
                           card.position.y < -screenPadding || 
                           card.position.y > window.innerHeight + screenPadding;
        
        if (isOffscreen || distance > 600) {
            // Initiate horseshoe wrap-around trajectory
            if (!physics.wrapAroundActive) {
                physics.wrapAroundActive = true;
                physics.wrapStartTime = performance.now();
                console.log('Card offscreen - initiating horseshoe wrap-around');
                
                // Store initial velocity for smooth transition
                physics.wrapInitialVelocity = { ...card.velocity };
            }
            
            const wrapTime = (performance.now() - physics.wrapStartTime) / 1000;
            const wrapProgress = Math.min(wrapTime / 1.0, 1.0); // 1 second for full wrap
            
            // Create horseshoe curve by blending velocities
            // Start with current direction, gradually curve back
            const curveFactor = this.easeInOutCubic(wrapProgress);
            
            // Calculate perpendicular force for horseshoe effect (with safety check)
            const safeSpeed = Math.max(currentSpeed, 1); // Avoid division by zero
            const perpX = -card.velocity.y / safeSpeed;
            const perpY = card.velocity.x / safeSpeed;
            
            // Blend original velocity with return direction
            const returnForce = 400 + (600 * curveFactor); // Increasing pull
            const curveForce = 300 * Math.sin(wrapProgress * Math.PI); // Arc shape
            
            const dirX = toTarget.x / distance;
            const dirY = toTarget.y / distance;
            
            // Apply horseshoe forces
            card.velocity.x = physics.wrapInitialVelocity.x * (1 - curveFactor) + // Fade original
                             dirX * returnForce * curveFactor + // Add return force
                             perpX * curveForce; // Add curve
            
            card.velocity.y = physics.wrapInitialVelocity.y * (1 - curveFactor) +
                             dirY * returnForce * curveFactor +
                             perpY * curveForce;
            
            // Don't skip other guidance - let it blend
        }
        
        // Calculate if we'll make it in time (currentSpeed already calculated above)
        const estimatedTimeToDoc = currentSpeed > 0 ? distance / currentSpeed : 999;
        
        if (physics.throwType === 'Slow' || estimatedTimeToDoc > remainingTime) {
            // Need acceleration to meet 1.5s deadline
            if (!physics.guidanceActive) {
                physics.guidanceActive = true;
                physics.guidanceStartTime = performance.now();
                console.log('Off-target: Activating guidance to meet 1.5s deadline');
            }
            
            // Calculate required speed
            const requiredSpeed = distance / remainingTime;
            
            // Smooth acceleration
            const guidanceTime = (performance.now() - physics.guidanceStartTime) / 1000;
            const accelerationCurve = this.easeInQuad(Math.min(guidanceTime / remainingTime, 1.0));
            
            // Speed adjustment
            const targetSpeed = currentSpeed + (requiredSpeed - currentSpeed) * accelerationCurve;
            const speedMultiplier = targetSpeed / currentSpeed;
            
            if (currentSpeed > 0) {
                card.velocity.x *= speedMultiplier;
                card.velocity.y *= speedMultiplier;
            }
            
            // Aggressive angle correction for off-target
            const aggressiveFactor = accelerationCurve * physics.correctionIntensity;
            const correctionStrength = 300 * aggressiveFactor;
            
            const dirX = toTarget.x / distance;
            const dirY = toTarget.y / distance;
            card.velocity.x += dirX * correctionStrength * deltaTime;
            card.velocity.y += dirY * correctionStrength * deltaTime;
            
        } else {
            // Fast/Medium off-target: Use graduated S-curve based on aim offset
            if (!physics.guidanceActive) {
                physics.guidanceActive = true;
                physics.guidanceStartTime = performance.now();
                
                // Instead of horseshoe, use momentum-respecting arc
                const aimOffsetWidths = physics.aimOffset / this.CARD_WIDTH;
                
                if (aimOffsetWidths < 2.5) {
                    physics.curveType = 'gentle_s';
                    physics.curveStrength = 0.3;
                } else if (aimOffsetWidths < 3.5) {
                    physics.curveType = 'moderate_s';
                    physics.curveStrength = 0.6;
                } else {
                    physics.curveType = 'strong_arc';
                    physics.curveStrength = 0.8;
                }
                
                console.log(`Off-target ${physics.throwType}: ${physics.curveType} curve`);
            }
            
            if (physics.guidanceActive) {
                const guidanceTime = (performance.now() - physics.guidanceStartTime) / 1000;
                const curveProgress = Math.min(guidanceTime / 1.2, 1.0);
                
                // Momentum-respecting curve (not toilet bowl)
                const curveFactor = this.easeInOutQuad(curveProgress) * physics.curveStrength;
                const lateralCorrection = 200 * curveFactor;
                
                // Apply graduated correction
                const dirX = toTarget.x / distance;
                const dirY = toTarget.y / distance;
                card.velocity.x += dirX * lateralCorrection * deltaTime;
                card.velocity.y += dirY * lateralCorrection * deltaTime;
            }
        }
        
        // Natural air resistance
        card.velocity.x *= 0.99;
        card.velocity.y *= 0.99;
    }
    
    /**
     * Apply bezier curve guidance for smooth horseshoe/toilet bowl arcs
     * @param {Object} card - Card object
     * @param {number} deltaTime - Time delta
     * @param {number} distance - Distance to target
     * @param {Object} toTarget - Vector to target
     * @param {number} flightTime - Total flight time
     */
    applyBezierCurveGuidance(card, deltaTime, distance, toTarget, flightTime) {
        const physics = card.flightPhysics;
        const bezier = physics.bezierPath;
        
        // Calculate progress along bezier curve (0 to 1)
        const guidanceTime = (performance.now() - physics.guidanceStartTime) / 1000;
        const totalGuidanceTime = 1.2; // Total time for bezier guidance
        physics.pathProgress = Math.min(guidanceTime / totalGuidanceTime, 1.0);
        
        // Calculate desired position on bezier curve
        const t = this.easeInOutCubic(physics.pathProgress);
        const desiredPos = this.calculateBezierPoint(bezier, t);
        
        // Calculate correction force toward desired position
        const toDesired = {
            x: desiredPos.x - card.position.x,
            y: desiredPos.y - card.position.y
        };
        const distanceToDesired = Math.sqrt(toDesired.x ** 2 + toDesired.y ** 2);
        
        if (distanceToDesired > 0) {
            // Apply bezier curve guidance force
            const curveForce = 150 * physics.correctionIntensity;
            const dirX = toDesired.x / distanceToDesired;
            const dirY = toDesired.y / distanceToDesired;
            
            card.velocity.x += dirX * curveForce * deltaTime;
            card.velocity.y += dirY * curveForce * deltaTime;
        }
        
        // Add direct correction toward target as we progress
        const directCorrectionFactor = physics.pathProgress * physics.pathProgress; // Quadratic ramp
        const directForce = 100 * directCorrectionFactor;
        
        const dirToTarget = {
            x: toTarget.x / distance,
            y: toTarget.y / distance
        };
        
        card.velocity.x += dirToTarget.x * directForce * deltaTime;
        card.velocity.y += dirToTarget.y * directForce * deltaTime;
    }
    
    /**
     * Calculate a point on a bezier curve
     * @param {Object} bezier - Bezier curve data
     * @param {number} t - Parameter (0 to 1)
     * @returns {Object} - Point on curve
     */
    calculateBezierPoint(bezier, t) {
        const { p0, cp1, cp2, p3 } = bezier;
        const u = 1 - t;
        const tt = t * t;
        const uu = u * u;
        const uuu = uu * u;
        const ttt = tt * t;
        
        return {
            x: uuu * p0.x + 3 * uu * t * cp1.x + 3 * u * tt * cp2.x + ttt * p3.x,
            y: uuu * p0.y + 3 * uu * t * cp1.y + 3 * u * tt * cp2.y + ttt * p3.y
        };
    }
    
    /**
     * Ease-in-out cubic function for smooth acceleration/deceleration
     * @param {number} t - Input parameter (0 to 1)
     * @returns {number} - Eased output (0 to 1)
     */
    easeInOutCubic(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }
    
    easeInQuad(t) {
        return t * t;
    }
    
    easeInCubic(t) {
        return t * t * t;
    }
    
    easeInOutQuad(t) {
        return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    }
    
    /**
     * Complete the docking sequence
     * @param {Object} card - Card object
     * @param {string} reason - Reason for docking
     */
    completeDocking(card, reason) {
        if (card.isDocking) return; // Already docking
        
        console.log(`Docking completed: ${reason}`);
        card.position = { ...card.targetPosition };
        card.velocity = { x: 0, y: 0 };
        card.isDocking = true;
        
        // Smooth rotation to nearest upright position
        const currentRotation = card.rotation;
        const nearestUpright = Math.round(currentRotation / (Math.PI / 2)) * (Math.PI / 2);
        card.dockTargetRotation = nearestUpright;
        card.dockStartRotation = currentRotation;
        card.dockStartTime = performance.now();
        
        // Complete after brief docking animation
        setTimeout(() => {
            if (card.onComplete && typeof card.onComplete === 'function' && !card.dockingCompleted) {
                card.dockingCompleted = true;
                card.onComplete(true);
            }
        }, 200); // Quick completion for responsive feel
    }
    
    // LEGACY METHOD - kept for backward compatibility
    // Predict if card will reach drop zone with magnetic assistance
    predictTrajectory(card, dropZoneCenter) {
        const distance = Math.sqrt(
            (dropZoneCenter.x - card.position.x) ** 2 + 
            (dropZoneCenter.y - card.position.y) ** 2
        );
        
        const speed = Math.sqrt(card.velocity.x ** 2 + card.velocity.y ** 2);
        
        // Enhanced prediction with magnetic zones - very forgiving
        const MAGNETIC_RANGE = 300; // Must match updateThrowPhysics
        const MIN_SPEED_IN_MAGNETIC = 20; // Very low threshold when in magnetic range
        const MIN_SPEED_OUTSIDE = 50; // Much lower threshold outside range
        
        let willReach = false;
        let reason = '';
        
        if (distance < MAGNETIC_RANGE) {
            // Already in magnetic range - very likely to dock
            willReach = speed > MIN_SPEED_IN_MAGNETIC;
            reason = willReach ? 'In magnetic range with sufficient speed' : 'In magnetic range but too slow';
        } else {
            // Check for early interception potential
            const vx = card.velocity.x;
            const vy = card.velocity.y;
            const dx = card.position.x - dropZoneCenter.x;
            const dy = card.position.y - dropZoneCenter.y;
            
            // Time to closest approach
            const t = -(dx * vx + dy * vy) / (vx * vx + vy * vy);
            
            if (t > 0 && t < 2) {
                // Will pass by soon - check closest approach
                const closestDist = Math.sqrt(
                    Math.pow(card.position.x + vx * t - dropZoneCenter.x, 2) +
                    Math.pow(card.position.y + vy * t - dropZoneCenter.y, 2)
                );
                
                console.log('Trajectory interception check:', {
                    timeToClosest: t.toFixed(2),
                    closestDistance: closestDist.toFixed(1),
                    currentDistance: distance.toFixed(1)
                });
                
                if (closestDist < 300) {
                    // Will pass close enough for early interception
                    willReach = speed > 80; // Lower threshold for intercepts
                    reason = willReach ? 'Will pass close for interception' : 'Will pass close but too slow';
                } else {
                    // Normal trajectory check
                    const velocityTowardCenter = this.calculateVelocityTowardTarget(
                        card.velocity, 
                        card.position, 
                        dropZoneCenter
                    );
                    willReach = speed > MIN_SPEED_OUTSIDE && velocityTowardCenter > 0.3;
                    reason = willReach ? 'Fast enough and aimed at target' : 
                            speed <= MIN_SPEED_OUTSIDE ? 'Too slow for distance' : 'Not aimed at target';
                }
            } else {
                // Not on intercept course
                willReach = false;
                reason = 'Not on intercept course';
            }
        }
        
        console.log('Trajectory analysis:', {
            willReach,
            reason,
            distance: distance.toFixed(1),
            speed: speed.toFixed(1),
            magneticRange: MAGNETIC_RANGE,
            thresholds: { inMagnetic: MIN_SPEED_IN_MAGNETIC, outside: MIN_SPEED_OUTSIDE }
        });
        
        return { willReach, distance, speed };
    }
    
    // Helper: Calculate how much velocity is aimed toward target (0-1)
    calculateVelocityTowardTarget(velocity, currentPos, target) {
        const dx = target.x - currentPos.x;
        const dy = target.y - currentPos.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const speed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y);
        
        if (distance === 0 || speed === 0) return 0;
        
        // Normalize vectors and calculate dot product
        const targetDirX = dx / distance;
        const targetDirY = dy / distance;
        const velocityDirX = velocity.x / speed;
        const velocityDirY = velocity.y / speed;
        
        // Dot product gives us cos(angle) between vectors
        const dotProduct = targetDirX * velocityDirX + targetDirY * velocityDirY;
        
        // Return value from 0 (perpendicular) to 1 (directly toward)
        return Math.max(0, dotProduct);
    }
    
    // Main physics update loop
    startPhysicsLoop() {
        // Physics loop starting
        const update = (timestamp) => {
            const deltaTime = Math.min((timestamp - this.lastTimestamp) / 1000, 0.1);
            this.lastTimestamp = timestamp;
            
            let hasActiveCards = false;
            
            this.activeCards.forEach((card, cardId) => {
                if (card.isDragging) {
                    // Apply gravity rotation while dragging
                    this.updateDragPhysics(card, deltaTime);
                } else {
                    // Update throw/return physics
                    this.updateThrowPhysics(card, deltaTime);
                }
                
                // Apply transformations
                this.applyTransform(card);
                
                // Keep card active during docking sequence
                hasActiveCards = true;
            });
            
            if (hasActiveCards) {
                this.animationFrame = requestAnimationFrame(update);
            } else {
                // Physics loop ending - no active cards
                this.animationFrame = null;
            }
        };
        
        this.lastTimestamp = performance.now();
        this.animationFrame = requestAnimationFrame(update);
    }
    
    // Update physics while dragging
    updateDragPhysics(card, deltaTime) {
        // Pure gravity physics: card hangs from the grabbed point
        // Based on the principle that center of mass must be directly below pivot
        
        if (card.touchPoint && card.touchPoint.x && card.touchPoint.y) {
            // CORRECT PHYSICS: The equilibrium angle is where the center of mass
            // hangs directly below the pivot point
            
            // We need to find what rotation makes our pivot point be directly above center of mass
            // The center of mass is offset from geometric center
            const comOffsetX = card.centerOfMass.x;
            const comOffsetY = card.centerOfMass.y;
            
            // Pivot position relative to center of mass (not geometric center)
            const pivotFromCOM = {
                x: card.pivotOffset.x - comOffsetX,
                y: card.pivotOffset.y - comOffsetY
            };
            
            // At equilibrium, the center of mass should be directly below the pivot
            // This means the vector from pivot to COM should point straight down
            // We need to find what card rotation makes this happen
            
            // The equilibrium angle is when the pivot-to-COM vector points down
            // We need to rotate the card so that this vector aligns with the downward direction
            // Since down is +Y in screen coordinates, we want the angle that makes the vector point to (0, positive)
            
            // Add π (180°) to flip the vector so it points down instead of up
            const equilibriumAngle = Math.atan2(pivotFromCOM.x, pivotFromCOM.y) + Math.PI;
            
            // Debug: Log the calculation details once
            if (!card.loggedEquilibrium) {
                console.log('Equilibrium calculation:', {
                    cardId: card.element.id,
                    pivotOffset: card.pivotOffset,
                    centerOfMass: card.centerOfMass,
                    pivotFromCOM: pivotFromCOM,
                    equilibriumAngle: (equilibriumAngle * 180 / Math.PI).toFixed(1) + '°',
                    explanation: 'Card will rest when pivot is directly above COM'
                });
                card.loggedEquilibrium = true;
            }
            
            // Calculate shortest rotation to equilibrium
            let angleDiff = equilibriumAngle - card.rotation;
            while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
            while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
            
            // Calculate finger movement for torque calculation
            let fingerTorque = 0;
            let isFingerMoving = false;
            
            if (card.lastTouchPoint) {
                // Calculate movement delta
                const dx = card.touchPoint.x - card.lastTouchPoint.x;
                const dy = card.touchPoint.y - card.lastTouchPoint.y;
                const movementDistance = Math.sqrt(dx * dx + dy * dy);
                
                // Lowered movement threshold from 0.5 to 0.1 pixels for more sensitivity
                if (movementDistance > 0.1 && deltaTime > 0) {
                    isFingerMoving = true;
                    
                    // CORRECTED PHYSICS: Proper torque calculation using τ = r × F
                    // Position vector from center of mass to finger position
                    const rX = card.pivotOffset.x - comOffsetX;
                    const rY = card.pivotOffset.y - comOffsetY;
                    
                    // Force vector (finger movement per unit time)
                    const forceX = dx / deltaTime;
                    const forceY = dy / deltaTime;
                    
                    // Cross product: τ = r × F (2D cross product gives scalar torque)
                    const torqueMagnitude = rX * forceY - rY * forceX;
                    
                    // Scale finger influence significantly (increased from 2.0 to 50.0+)
                    const fingerInfluence = 50.0;
                    fingerTorque = torqueMagnitude * fingerInfluence * 0.001; // Scale down for stability
                    
                    // Debug logging
                    if (Math.abs(fingerTorque) > 0.1) {
                        console.log('Finger torque calculation:', {
                            movement: { dx: dx.toFixed(1), dy: dy.toFixed(1) },
                            positionVector: { x: rX.toFixed(1), y: rY.toFixed(1) },
                            force: { x: forceX.toFixed(1), y: forceY.toFixed(1) },
                            torque: fingerTorque.toFixed(3),
                            direction: fingerTorque > 0 ? 'counter-clockwise' : 'clockwise'
                        });
                    }
                }
            }
            
            // Store current as last for next frame
            card.lastTouchPoint = { ...card.touchPoint };
            
            // Apply gravity torque - reduced strength from 5.0 to 2.0
            const baseGravityStrength = 2.0;
            
            // Implement finger override mode: reduce gravity when finger is actively moving
            const gravityReductionFactor = isFingerMoving ? 0.3 : 1.0; // 70% reduction when finger moving
            const gravityStrength = baseGravityStrength * gravityReductionFactor;
            const gravityTorque = Math.sin(angleDiff) * gravityStrength;
            
            // Apply combined torques to angular velocity
            card.angularVelocity += (gravityTorque + fingerTorque) * deltaTime;
            
            // Dynamic damping - less aggressive when finger is moving
            let damping;
            if (isFingerMoving) {
                // Much lighter damping when finger is actively moving
                damping = 0.98;
            } else {
                // Variable damping based on distance from equilibrium
                damping = Math.abs(angleDiff) > 0.1 ? 0.95 : 0.90; // Less aggressive than original 0.92
            }
            card.angularVelocity *= damping;
            
            // Limit maximum angular velocity to prevent crazy spinning
            const maxAngularVelocity = 15.0; // radians per second
            card.angularVelocity = Math.max(-maxAngularVelocity, Math.min(maxAngularVelocity, card.angularVelocity));
            
            // Debug logging for physics state
            if (process.env.NODE_ENV === 'development' && card.frameCount % 60 === 0) {
                console.log('Physics state:', {
                    cardId: card.element.id,
                    currentRotation: (card.rotation * 180 / Math.PI).toFixed(1) + '°',
                    equilibriumAngle: (equilibriumAngle * 180 / Math.PI).toFixed(1) + '°',
                    angleDiff: (angleDiff * 180 / Math.PI).toFixed(1) + '°',
                    gravityTorque: gravityTorque.toFixed(4),
                    fingerTorque: fingerTorque.toFixed(4),
                    isFingerMoving: isFingerMoving,
                    gravityReduction: gravityReductionFactor.toFixed(2),
                    damping: damping.toFixed(3),
                    angularVelocity: card.angularVelocity.toFixed(4)
                });
            }
            
            // Update rotation
            card.rotation += card.angularVelocity * deltaTime;
            
            // CRITICAL: Always update position to keep pivot locked to finger
            // This ensures the pencil stab stays exactly under the finger
            card.position.x = card.touchPoint.x;
            card.position.y = card.touchPoint.y;
            
            // Smooth scale animation
            if (card.scale < card.targetScale) {
                card.scale = Math.min(card.scale + 0.02, card.targetScale);
            }
        }
    }
    
    // Update physics after release with sophisticated flight physics
    updateThrowPhysics(card, deltaTime) {
        // Calculate target info first - use center positions for consistency
        const cardCenterX = card.position.x + (card.cardDimensions ? card.cardDimensions.width / 2 : 40);
        const cardCenterY = card.position.y + (card.cardDimensions ? card.cardDimensions.height / 2 : 60);
        const targetCenterX = card.targetPosition.x + (card.cardDimensions ? card.cardDimensions.width / 2 : 40);
        const targetCenterY = card.targetPosition.y + (card.cardDimensions ? card.cardDimensions.height / 2 : 60);
        
        const toTarget = {
            x: targetCenterX - cardCenterX,
            y: targetCenterY - cardCenterY
        };
        
        const distance = Math.sqrt(toTarget.x ** 2 + toTarget.y ** 2);
        
        // Use sophisticated flight physics if available (let it handle time limits)
        if (card.flightPhysics && !card.isReturning) {
            this.updateSophisticatedFlightPhysics(card, deltaTime, distance, toTarget);
            return;
        }
        
        // Check for time limit only for legacy physics
        const flightTime = (performance.now() - card.flightStartTime) / 1000;
        if (flightTime > this.DOCKING_TIME_LIMIT && !card.isReturning && !card.isDocking) {
            console.log(`Docking time limit exceeded: ${flightTime.toFixed(2)}s`);
            this.returnCardHome(card, card.element.id, card.onComplete, 'Docking time limit exceeded');
            return;
        }
        
        // Legacy physics path (fallback)
        if (distance < 5) {
            // Reached target - but don't complete immediately
            card.position = { ...card.targetPosition };
            card.velocity = { x: 0, y: 0 };
            
            // Start docking sequence if not already docking
            if (!card.isDocking) {
                card.isDocking = true;
                card.dockStartTime = performance.now();
                
                // Find nearest upright position in the same rotation direction
                const currentRotation = card.rotation;
                const rotationDirection = Math.sign(card.angularVelocity) || 1;
                
                // Quarter turns calculation removed - not used
                
                // If we're very close to upright already, just use current position
                const uprightPositions = [0, Math.PI/2, Math.PI, 3*Math.PI/2];
                const normalizedRotation = Math.abs(currentRotation % (2 * Math.PI));
                
                let isNearUpright = false;
                for (const upright of uprightPositions) {
                    if (Math.abs(normalizedRotation - upright) < 0.1) {
                        isNearUpright = true;
                        break;
                    }
                }
                
                if (isNearUpright) {
                    card.dockTargetRotation = currentRotation;
                } else {
                    // Continue rotating in same direction to next upright
                    card.dockTargetRotation = currentRotation + 
                        (rotationDirection * Math.PI / 2);
                }
                
                card.dockStartRotation = card.rotation;
                
                console.log('Docking rotation setup:', {
                    current: currentRotation,
                    target: card.dockTargetRotation,
                    direction: rotationDirection > 0 ? 'clockwise' : 'counter-clockwise',
                    angularVelocity: card.angularVelocity
                });
            }
            
            // Animate rotation during docking
            const dockDuration = 0.3; // 300ms to dock
            const dockProgress = Math.min((performance.now() - card.dockStartTime) / 1000 / dockDuration, 1.0);
            
            // Smooth rotation to target
            card.rotation = card.dockStartRotation + (card.dockTargetRotation - card.dockStartRotation) * dockProgress;
            card.angularVelocity = 0;
            
            // Scale down slightly during dock
            card.scale = 1.05 - (0.05 * dockProgress);
            
            // Visual feedback during docking
            const glowIntensity = 1.0 - dockProgress;
            card.element.style.filter = `drop-shadow(0 10px 20px rgba(0, 255, 0, ${glowIntensity * 0.6}))`;
            
            // Complete after docking animation
            if (dockProgress >= 1.0 && card.onComplete && typeof card.onComplete === 'function' && !card.dockingCompleted) {
                // Store the callback and clear it immediately to prevent multiple calls
                const callback = card.onComplete;
                card.onComplete = null;
                card.dockingCompleted = true; // Prevent any other completion paths
                
                // Add a small delay to ensure the game can process the card
                setTimeout(() => {
                    try {
                        // Timeout docking counts as success
                        const success = !card.isReturning || card.timeoutDocking;
                        
                        // Log docking completion
                        console.log('Card docking complete (animated):', {
                            cardId: card.element.id,
                            success,
                            isReturning: card.isReturning,
                            timeoutDocking: card.timeoutDocking,
                            position: { x: card.position.x, y: card.position.y },
                            targetPosition: card.targetPosition,
                            flightTime: (performance.now() - card.releaseTime) / 1000
                        });
                        
                        callback(success);
                    } catch (error) {
                        console.error('Error in card onComplete callback:', error);
                        // Clean up the card even if callback fails
                        this.cleanupCard(card.element.id || card.element.getAttribute('id'));
                    }
                }, 500); // 500ms delay - plenty of time for game to register
            }
        } else {
            // Calculate magnetic docking physics
            const MAGNETIC_RANGE = 300; // Good magnetic capture range
            const MAGNETIC_STRENGTH = 1200; // Stronger pull to guide cards in
            // DOCKING_ZONE removed - not used
            
            // Check for successful docking conditions FIRST
            const dockCenterX = card.targetPosition.x + card.cardDimensions.width / 2;
            const dockCenterY = card.targetPosition.y + card.cardDimensions.height / 2;
            const distToDock = Math.sqrt(
                Math.pow(dockCenterX - card.position.x, 2) +
                Math.pow(dockCenterY - card.position.y, 2)
            );
            
            const currentSpeed = Math.sqrt(card.velocity.x ** 2 + card.velocity.y ** 2);
            const rotationAligned = Math.abs(card.rotation % (Math.PI / 2)) < 0.15; // Within ~8.5 degrees of upright
            
            // Natural docking check - like real card games
            const ACCEPT_ZONE = 200; // Very large, forgiving zone
            const ACCEPT_SPEED = 300; // Allow fast throwing speeds
            // ACCEPT_ANY_ANGLE removed - not used
            
            // Progressive docking - get more lenient as cards get closer
            const progressiveFactor = Math.max(0, 1 - (distToDock / 300));
            const dynamicSpeedLimit = ACCEPT_SPEED + (progressiveFactor * 200); // Much more lenient when close
            
            // Check if card is ready to dock - no rotation requirement!
            if (distToDock < ACCEPT_ZONE && currentSpeed < dynamicSpeedLimit && !card.isReturning && !card.isDocking && !card.dockingCompleted) {
                console.log('Natural docking achieved:', {
                    cardId: card.element.id,
                    distance: distToDock.toFixed(1),
                    speed: currentSpeed.toFixed(1),
                    rotation: (card.rotation * 180 / Math.PI).toFixed(1) + '°',
                    anyAngleAccepted: true,
                    flightTime: ((performance.now() - card.releaseTime) / 1000).toFixed(2)
                });
                
                // CRITICAL: Mark as docking to prevent multiple triggers
                card.isDocking = true;
                card.dockingCompleted = true; // Prevent any other completion paths
                
                // Smooth transition to dock position - no snapping
                if (distToDock > 5) {
                    // Still some distance - guide smoothly
                    const snapForce = Math.min(distToDock * 2, 50);
                    const dirX = (dockCenterX - card.position.x) / distToDock;
                    const dirY = (dockCenterY - card.position.y) / distToDock;
                    card.velocity.x = dirX * snapForce;
                    card.velocity.y = dirY * snapForce;
                } else {
                    // Very close - gentle settle
                    card.position.x += (dockCenterX - card.position.x) * 0.3;
                    card.position.y += (dockCenterY - card.position.y) * 0.3;
                    card.velocity.x *= 0.5;
                    card.velocity.y *= 0.5;
                }
                
                // Keep the card's natural rotation - don't force alignment
                // This gives a more realistic feel like physical card games
                card.angularVelocity *= 0.95; // Gently slow down the spin
                
                // Complete the docking IMMEDIATELY for faster response
                if (card.onComplete && typeof card.onComplete === 'function') {
                    const callback = card.onComplete;
                    card.onComplete = null; // Clear immediately to prevent double calls
                    
                    // Call immediately for instant game response
                    try {
                        callback(true);
                        // Visual cleanup after a delay
                        setTimeout(() => {
                            if (this.activeCards.has(card.element.id || card.element.getAttribute('id'))) {
                                this.cleanupCard(card.element.id || card.element.getAttribute('id'));
                            }
                        }, 300); // Cleanup after visual completion
                    } catch (error) {
                        console.error('Error in card onComplete callback:', error);
                    }
                }
                return; // Exit early - we're done!
            }
            
            // Check for timeout - generous time for natural settling
            const flightTime = (performance.now() - card.releaseTime) / 1000; // Convert to seconds
            const timeoutDuration = 4.0; // 4 seconds - plenty of time for natural docking
            const warningTime = 3.5; // Warning at 3.5 seconds
            
            // Visual warning when approaching timeout
            if (flightTime > warningTime && !card.isReturning && !card.timeoutDocking) {
                // Flash blue shadow as warning (docking imminent)
                const flashIntensity = Math.sin((flightTime - warningTime) * 10) * 0.5 + 0.5;
                card.element.style.filter = `drop-shadow(0 10px 20px rgba(139, 195, 247, ${flashIntensity * 0.8}))`;
            }
            
            if (flightTime > timeoutDuration && !card.isReturning && !card.timeoutDocking) {
                console.log('Timeout reached - forcing dock:', {
                    cardId: card.element.id,
                    distance: distToDock.toFixed(1),
                    speed: currentSpeed.toFixed(1),
                    rotation: (card.rotation * 180 / Math.PI).toFixed(1) + '°',
                    aligned: rotationAligned,
                    wouldDockNormally: distToDock < 60 && currentSpeed < 80 && rotationAligned
                });
                
                // Time's up! Force dock it
                card.timeoutDocking = true;
                card.targetPosition = {
                    x: card.targetPosition.x, // Already set to dock position
                    y: card.targetPosition.y
                };
                
                // Calculate direct path to dock
                const dockDirection = {
                    x: card.targetPosition.x + card.cardDimensions.width / 2 - card.position.x,
                    y: card.targetPosition.y + card.cardDimensions.height / 2 - card.position.y
                };
                const dockDist = Math.sqrt(dockDirection.x ** 2 + dockDirection.y ** 2);
                
                if (dockDist > 0) {
                    // Gentle velocity toward dock - no rush
                    card.velocity.x = (dockDirection.x / dockDist) * 300;
                    card.velocity.y = (dockDirection.y / dockDist) * 300;
                }
                
                // Keep current angular velocity - don't stop rotation yet!
                // Rotation will be handled when we reach the docking zone
            }
            
            // Move towards target with physics
            if (card.isReturning) {
                // Spring back to hand
                const springForce = 0.2;
                card.velocity.x += toTarget.x * springForce;
                card.velocity.y += toTarget.y * springForce;
            } else {
                // Early trajectory interception for near-misses (only for intentional throws)
                if (card.isIntentionalThrow && distance > MAGNETIC_RANGE && distance < MAGNETIC_RANGE * 1.5) {
                    // Predict if card will pass close by the dock
                    const speed = Math.sqrt(card.velocity.x ** 2 + card.velocity.y ** 2);
                    
                    if (speed > 50) {
                        // Calculate closest approach distance if we continue on current path
                        const vx = card.velocity.x;
                        const vy = card.velocity.y;
                        const dx = card.position.x - (card.targetPosition.x + card.cardDimensions.width / 2);
                        const dy = card.position.y - (card.targetPosition.y + card.cardDimensions.height / 2);
                        
                        // Time to closest approach
                        const t = -(dx * vx + dy * vy) / (vx * vx + vy * vy);
                        
                        if (t > 0 && t < 2) { // Will pass by in next 2 seconds
                            // Position at closest approach
                            const closestX = card.position.x + vx * t;
                            const closestY = card.position.y + vy * t;
                            const closestDist = Math.sqrt(
                                Math.pow(closestX - (card.targetPosition.x + card.cardDimensions.width / 2), 2) +
                                Math.pow(closestY - (card.targetPosition.y + card.cardDimensions.height / 2), 2)
                            );
                            
                            // If it will pass within 300px, intercept it early
                            if (closestDist < 300 && closestDist > 50) {
                                // Calculate intercept vector
                                const interceptForce = 5.0; // Strong early correction
                                const interceptX = -(closestX - (card.targetPosition.x + card.cardDimensions.width / 2)) / closestDist;
                                const interceptY = -(closestY - (card.targetPosition.y + card.cardDimensions.height / 2)) / closestDist;
                                
                                // Apply early course correction
                                card.velocity.x += interceptX * interceptForce;
                                card.velocity.y += interceptY * interceptForce;
                                
                                // Mark for fast docking
                                card.earlyIntercept = true;
                                
                                // Visual feedback for interception
                                card.element.style.filter = 'drop-shadow(0 15px 30px rgba(0, 255, 0, 0.4))';
                            }
                        }
                    }
                }
                
                // Gentle pull for timeout docking
                if (card.timeoutDocking) {
                    // Gentle constant pull - no need to rush
                    const pullStrength = 4.0;
                    const dirX = toTarget.x / distance;
                    const dirY = toTarget.y / distance;
                    
                    // Add to velocity instead of overriding
                    card.velocity.x += dirX * pullStrength;
                    card.velocity.y += dirY * pullStrength;
                    
                    // Light damping to prevent overshooting
                    card.velocity.x *= 0.98;
                    card.velocity.y *= 0.98;
                }
                // Enhanced magnetic attraction for drop zone
                else if (distance < MAGNETIC_RANGE) {
                    // Calculate perpendicular force for toilet bowl effect
                    const centerX = card.targetPosition.x + card.cardDimensions.width / 2;
                    const centerY = card.targetPosition.y + card.cardDimensions.height / 2;
                    
                    // Get velocity direction
                    const speed = Math.sqrt(card.velocity.x ** 2 + card.velocity.y ** 2);
                    
                    if (speed > 100 && distance > 80 && !card.earlyIntercept && card.isIntentionalThrow) { // Only spiral if fast and not too close
                        // Calculate cross product to determine which way to spiral
                        const relX = card.position.x - centerX;
                        const relY = card.position.y - centerY;
                        const crossProduct = relX * card.velocity.y - relY * card.velocity.x;
                        
                        // Perpendicular force creates the spiral
                        const perpX = -relY / distance;
                        const perpY = relX / distance;
                        
                        // Gentler spiral that decreases near the center
                        const spiralStrength = Math.max(0, (distance - 80) / (MAGNETIC_RANGE - 80));
                        const spiralForce = spiralStrength * 1.5; // Much gentler spiral
                        
                        // Apply perpendicular force based on cross product direction
                        if (crossProduct > 0) {
                            // Clockwise spiral
                            card.velocity.x += perpX * spiralForce * deltaTime;
                            card.velocity.y += perpY * spiralForce * deltaTime;
                        } else {
                            // Counter-clockwise spiral
                            card.velocity.x -= perpX * spiralForce * deltaTime;
                            card.velocity.y -= perpY * spiralForce * deltaTime;
                        }
                        
                        // Track total rotation around center for 270° limit
                        if (!card.spiralStartAngle) {
                            card.spiralStartAngle = Math.atan2(relY, relX);
                            card.totalSpiralRotation = 0;
                            card.spiralTrail = []; // Store trail positions
                        }
                        
                        // Add to spiral trail for visual effect
                        if (!card.spiralTrail) card.spiralTrail = [];
                        card.spiralTrail.push({ x: card.position.x, y: card.position.y });
                        if (card.spiralTrail.length > 20) card.spiralTrail.shift(); // Keep last 20 positions
                        
                        const currentAngle = Math.atan2(relY, relX);
                        let angleDiff = currentAngle - card.spiralStartAngle;
                        
                        // Handle angle wrap-around
                        if (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
                        if (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
                        
                        card.totalSpiralRotation = angleDiff;
                        
                        // If we've spiraled more than 270°, force direct approach
                        if (Math.abs(card.totalSpiralRotation) > 3 * Math.PI / 2) {
                            // Smoothly transition to direct pull
                            const transitionFactor = Math.min(1.0, (Math.abs(card.totalSpiralRotation) - 3 * Math.PI / 2) / (Math.PI / 4));
                            const directPull = 8.0 * transitionFactor;
                            const spiralReduction = 1.0 - transitionFactor;
                            
                            // Blend between spiral and direct motion
                            card.velocity.x = card.velocity.x * spiralReduction - relX / distance * directPull;
                            card.velocity.y = card.velocity.y * spiralReduction - relY / distance * directPull;
                            
                            // Add visual feedback for spiral completion
                            card.element.style.filter = 'drop-shadow(0 10px 20px rgba(139, 195, 247, 0.6))';
                        }
                    }
                    
                    // Standard magnetic attraction (adjusted based on throw intention)
                    let magneticStrength = MAGNETIC_STRENGTH;
                    
                    // Cards that need assistance get maximum pull
                    if (card.needsMagneticAssist) {
                        magneticStrength *= 4.0; // 4x strength for cards that need help
                    } else if (!card.isIntentionalThrow) {
                        magneticStrength *= 0.5; // Half strength for drops/misclicks
                    } else if (card.earlyIntercept) {
                        magneticStrength *= 2.0; // Double strength for intercepted cards
                    }
                    
                    // Progressive magnetic strength based on distance
                    if (distance < 100) {
                        // Very close - strong pull to complete docking
                        magneticStrength *= 2.0;
                    } else if (distance < 150 && speed < 100) {
                        // Close but slow - help it along
                        magneticStrength *= 1.5;
                    }
                    
                    const magneticForce = magneticStrength / (distance * distance);
                    const maxForce = card.earlyIntercept ? 10.0 : (speed > 50 ? 3.0 : 8.0); // Increased max force
                    const appliedForce = Math.min(magneticForce, maxForce);
                    
                    // Apply magnetic attraction toward center
                    const dirX = toTarget.x / distance;
                    const dirY = toTarget.y / distance;
                    card.velocity.x += dirX * appliedForce * deltaTime;
                    card.velocity.y += dirY * appliedForce * deltaTime;
                    
                    // Natural rotation damping - no forced alignment
                    if (distance < 80) {
                        // Just slow down rotation naturally as card approaches dock
                        const dampingFactor = Math.max(0.85, 1 - (80 - distance) / 80);
                        card.angularVelocity *= dampingFactor;
                        
                        // Stop excessive spinning but don't force alignment
                        const maxSpinRate = 5.0; // radians per second
                        if (Math.abs(card.angularVelocity) > maxSpinRate) {
                            card.angularVelocity = Math.sign(card.angularVelocity) * maxSpinRate;
                        }
                    }
                } else {
                    // Gentle attraction when outside magnetic range
                    const attraction = 0.05;
                    card.velocity.x += toTarget.x * attraction * deltaTime;
                    card.velocity.y += toTarget.y * attraction * deltaTime;
                }
            }
            
            // Apply velocity
            card.position.x += card.velocity.x * deltaTime;
            card.position.y += card.velocity.y * deltaTime;
            
            // Natural physics with smooth guidance
            const speed = Math.sqrt(card.velocity.x ** 2 + card.velocity.y ** 2);
            
            if (!card.isReturning) {
                // Calculate trajectory characteristics
                const velocityDotProduct = card.velocity.x * toTarget.x + card.velocity.y * toTarget.y;
                const isMovingToward = velocityDotProduct > 0;
                
                // Initialize flight tracking if not done
                if (card.flightTime === undefined) {
                    card.flightTime = 0;
                    card.initialSpeed = speed;
                    card.trajectoryConfirmed = false;
                }
                card.flightTime += deltaTime;
                
                // Natural guidance forces - no hard stops
                if (distance < MAGNETIC_RANGE) {
                    // Close range - gentle magnetic pull
                    const pullStrength = Math.min(300 / (distance + 50), 6);
                    const dirX = toTarget.x / distance;
                    const dirY = toTarget.y / distance;
                    
                    card.velocity.x += dirX * pullStrength * deltaTime * 60;
                    card.velocity.y += dirY * pullStrength * deltaTime * 60;
                    
                    // Very light damping in magnetic field
                    card.velocity.x *= 0.995;
                    card.velocity.y *= 0.995;
                    
                } else if (!isMovingToward && card.flightTime > 0.3) {
                    // Only guide if card has been flying away for 0.3+ seconds
                    // This prevents interfering with natural arcs from upward flicks
                    
                    if (!card.guidanceStarted) {
                        card.guidanceStarted = true;
                        card.guidanceTime = 0;
                        // Determine natural curve direction based on lateral position
                        card.curveDirection = (card.position.x < (card.targetPosition.x + card.cardDimensions.width/2)) ? 1 : -1;
                    }
                    
                    card.guidanceTime += deltaTime;
                    const guidanceProgress = Math.min(card.guidanceTime / 2.0, 1.0); // 2 second gentle curve
                    
                    // Natural curve using physics-based forces
                    if (speed > 30) { // Only curve if moving fast enough
                        // Perpendicular force for natural arc
                        const perpX = -card.velocity.y / speed;
                        const perpY = card.velocity.x / speed;
                        
                        // Gentle, progressive curve force
                        const curveStrength = 80 * guidanceProgress * (1 - guidanceProgress * 0.5); // Peaks mid-flight
                        card.velocity.x += perpX * card.curveDirection * curveStrength * deltaTime;
                        card.velocity.y += perpY * card.curveDirection * curveStrength * deltaTime;
                        
                        // Gradual redirection toward target
                        const redirectStrength = 40 * guidanceProgress * guidanceProgress; // Accelerates over time
                        const dirX = toTarget.x / distance;
                        const dirY = toTarget.y / distance;
                        
                        card.velocity.x += dirX * redirectStrength * deltaTime;
                        card.velocity.y += dirY * redirectStrength * deltaTime;
                    }
                    
                    // Natural air resistance - smooth deceleration
                    const naturalDamping = 0.985 + (0.01 * guidanceProgress); // 98.5% to 99.5%
                    card.velocity.x *= naturalDamping;
                    card.velocity.y *= naturalDamping;
                    
                } else {
                    // Normal flight - just natural physics
                    // Light, consistent air resistance
                    card.velocity.x *= 0.99;
                    card.velocity.y *= 0.99;
                }
                
                // Remove any blur effects - keep visuals clean
                if (card.element.style.filter && card.element.style.filter.includes('blur')) {
                    card.element.style.filter = 'drop-shadow(0 10px 20px rgba(0,0,0,0.3))';
                }
            } else {
                // Returning to hand - smooth spring physics
                const returnForce = 0.15;
                card.velocity.x += toTarget.x * returnForce;
                card.velocity.y += toTarget.y * returnForce;
                card.velocity.x *= 0.92;
                card.velocity.y *= 0.92;
            }
            
            // Maintain angular momentum during flight
            if (!card.isReturning) {
                // Keep full rotation until very close to dock
                const FINAL_DOCK_ZONE = 30;
                const flightAngularDamping = distance < FINAL_DOCK_ZONE ? 
                    this.angularDamping * 0.8 : // Strong damping only at final approach
                    0.998; // Almost no damping during flight - keep spinning!
                    
                card.angularVelocity *= flightAngularDamping;
                
                // For timeout docking, just maintain spin - no acceleration
                if (card.timeoutDocking && distance > FINAL_DOCK_ZONE) {
                    // Don't accelerate - just reduce damping
                    card.angularVelocity *= 0.999; // Almost no damping
                }
                
                // Prevent rotation direction reversal
                if (card.initialAngularVelocity === undefined && card.angularVelocity !== 0) {
                    card.initialAngularVelocity = card.angularVelocity;
                }
                
                // If rotation direction would reverse, stop it at zero
                if (card.initialAngularVelocity && 
                    Math.sign(card.angularVelocity) !== Math.sign(card.initialAngularVelocity) &&
                    Math.abs(card.angularVelocity) > 0.01) {
                    card.angularVelocity = 0;
                }
            } else {
                // Normal damping when returning to hand
                card.angularVelocity *= this.angularDamping;
            }
            
            // Always update rotation
            card.rotation += card.angularVelocity * deltaTime;
        }
    }
    
    // Apply visual transformations
    applyTransform(card) {
        if (card.isDragging && card.position) {
            // During drag, we need to position the card so the pivot stays at finger
            // The card.position is where the pivot point should be (at the finger)
            
            // Account for rotation: rotate the pivot offset
            const cos = Math.cos(card.rotation);
            const sin = Math.sin(card.rotation);
            const rotatedPivotX = card.pivotOffset.x * cos - card.pivotOffset.y * sin;
            const rotatedPivotY = card.pivotOffset.x * sin + card.pivotOffset.y * cos;
            
            // Calculate where card center needs to be for pivot to stay at finger
            const centerX = card.position.x - rotatedPivotX;
            const centerY = card.position.y - rotatedPivotY;
            
            // Calculate top-left position from center (for translate)
            const topLeftX = centerX - card.cardDimensions.width / 2;
            const topLeftY = centerY - card.cardDimensions.height / 2;
            
            // Apply transform with rotation around center
            const transform = `translate(${topLeftX}px, ${topLeftY}px) rotate(${card.rotation}rad) scale(${card.scale})`;
            card.element.style.transform = transform;
            card.element.style.transformOrigin = 'center';
        } else {
            // Original transform logic for throw physics
            const transform = `translate(${card.position.x}px, ${card.position.y}px) rotate(${card.rotation}rad) scale(${card.scale})`;
            card.element.style.transform = transform;
        }
    }
    
    // Track touch points for velocity calculation
    addTouchPoint(point) {
        this.touchHistory.push({
            x: point.x,
            y: point.y,
            timestamp: performance.now()
        });
        
        // Keep only recent points
        if (this.touchHistory.length > this.maxTouchHistory) {
            this.touchHistory.shift();
        }
    }
    
    // Calculate velocity from touch history
    calculateVelocity() {
        if (this.touchHistory.length < 2) {
            return { x: 0, y: 0 };
        }
        
        const recent = this.touchHistory[this.touchHistory.length - 1];
        const previous = this.touchHistory[0];
        const timeDiff = (recent.timestamp - previous.timestamp) / 1000;
        
        if (timeDiff === 0) {
            return { x: 0, y: 0 };
        }
        
        return {
            x: (recent.x - previous.x) / timeDiff,
            y: (recent.y - previous.y) / timeDiff
        };
    }
    
    // Enhanced cleanup with sophisticated physics state management
    cleanupCard(cardId) {
        if (!cardId) {
            console.warn('cleanupCard called without cardId');
            return;
        }
        
        try {
            // Remove from airborne tracking
            this.airbornCards.delete(cardId);
            
            // Clear bezier cache for this card
            this.bezierCache.delete(cardId);
            
            const card = this.activeCards.get(cardId);
            if (card && card.element) {
                // CRITICAL FIX: Use requestAnimationFrame for cleanup to avoid React conflicts
                requestAnimationFrame(() => {
                    // Remove pencil stab marker
                    if (card.stabMarker && card.stabMarker.parentNode) {
                        card.stabMarker.remove();
                    }
                    
                    // Remove arrow element
                    if (card.arrowElement && card.arrowElement.parentNode) {
                        card.arrowElement.remove();
                    }
                    
                    // Remove vertical line
                    if (card.verticalLine && card.verticalLine.parentNode) {
                        card.verticalLine.remove();
                    }
                    
                    // Reset styles
                    card.element.style.transition = '';
                    card.element.style.transform = '';
                    card.element.style.zIndex = '';
                    card.element.style.filter = '';
                    card.element.style.transformOrigin = '';
                    card.element.style.pointerEvents = '';
                    card.element.style.touchAction = '';
                    card.element.style.position = '';
                    card.element.style.left = '';
                    card.element.style.top = '';
                    card.element.style.margin = ''; // Restore original margin
                    
                    // CRITICAL FIX: Remove physics control marker
                    card.element.removeAttribute('data-physics-controlled');
                    
                    // Force style recalculation
                    void card.element.offsetHeight; // eslint-disable-line no-void
                });
                
                // Restore parent overflows
                if (card.parentOverflows) {
                    card.parentOverflows.forEach(({ element, originalOverflow }) => {
                        element.style.overflow = originalOverflow;
                    });
                }
            }
            
            this.activeCards.delete(cardId);
        } catch (error) {
            console.error('Error in cleanupCard:', error);
            // Force cleanup even on error
            this.airbornCards.delete(cardId);
            this.bezierCache.delete(cardId);
            this.activeCards.delete(cardId);
        }
    }
    
    // Enhanced cancel all with sophisticated physics cleanup
    cancelAll() {
        try {
            console.log(`Cancelling ${this.activeCards.size} active cards and ${this.airbornCards.size} airborne cards`);
            
            // Cleanup all active cards
            this.activeCards.forEach((card, cardId) => {
                this.cleanupCard(cardId);
            });
            
            // Clear all tracking sets
            this.airbornCards.clear();
            this.bezierCache.clear();
            
            // Cancel animation frame
            if (this.animationFrame) {
                cancelAnimationFrame(this.animationFrame);
                this.animationFrame = null;
            }
            
            // Clear touch history
            this.touchHistory = [];
            
            console.log('All card physics cleaned up successfully');
            
        } catch (error) {
            console.error('Error in cancelAll:', error);
            // Force cleanup even on error
            this.activeCards.clear();
            this.airbornCards.clear();
            this.bezierCache.clear();
            this.touchHistory = [];
            if (this.animationFrame) {
                cancelAnimationFrame(this.animationFrame);
                this.animationFrame = null;
            }
        }
    }
    
    /**
     * Component unmount cleanup - ensure no memory leaks
     */
    destroy() {
        console.log('Destroying CardPhysicsEngine');
        this.cancelAll();
        
        // Additional cleanup for sophisticated physics
        this.playerPickingUp = false;
        
        // Clear any remaining timeouts or intervals
        if (this.cleanupTimeout) {
            clearTimeout(this.cleanupTimeout);
        }
    }
    
    /**
     * Get current flight physics status for debugging
     * @returns {Object} - Flight physics status
     */
    getFlightPhysicsStatus() {
        const airborneCards = Array.from(this.airbornCards);
        const activeFlights = [];
        
        airborneCards.forEach(cardId => {
            const card = this.activeCards.get(cardId);
            if (card && card.flightPhysics) {
                const flightTime = (performance.now() - card.flightStartTime) / 1000;
                activeFlights.push({
                    cardId,
                    throwType: card.flightPhysics.throwType,
                    isOnTarget: card.flightPhysics.isOnTarget,
                    guidanceActive: card.flightPhysics.guidanceActive,
                    flightTime: flightTime.toFixed(2),
                    aimOffset: card.flightPhysics.aimOffset.toFixed(1)
                });
            }
        });
        
        return {
            totalAirborne: this.airbornCards.size,
            totalActive: this.activeCards.size,
            activeFlights,
            bezierCacheSize: this.bezierCache.size
        };
    }
    
    /**
     * Emergency return all cards home (for error recovery)
     */
    emergencyReturnAll() {
        console.warn('Emergency return all cards activated');
        
        this.activeCards.forEach((card, cardId) => {
            if (card && !card.isReturning && !card.isDocking) {
                try {
                    this.returnCardHome(card, cardId, card.onComplete, 'Emergency return');
                } catch (error) {
                    console.error(`Error in emergency return for card ${cardId}:`, error);
                    // Force cleanup on error
                    this.cleanupCard(cardId);
                }
            }
        });
    }
    
    // Calculate the center of mass for a playing card
    calculateCenterOfMass(cardId, rect) {
        // For a more realistic simulation, playing cards have slightly more mass
        // at the top due to the printed pips/symbols
        
        // Extract rank and suit from cardId (e.g., "AS" -> rank="A", suit="S")
        const rank = cardId.slice(0, -1);
        const suit = cardId.slice(-1);
        
        // Default center of mass (relative to card center)
        let comX = 0;
        let comY = 0;
        
        // Adjust center of mass based on card rank
        // Face cards and high pip cards have more ink at the top
        switch(rank) {
            case 'K':
            case 'Q':
            case 'J':
                // Face cards have heavy printing, slightly top-heavy
                comY = -rect.height * 0.02; // 2% toward top
                break;
            case 'A':
                // Ace usually has large center symbol
                comY = 0; // Perfect center
                break;
            case '10':
                // 10 has most pips, slightly top-heavy
                comY = -rect.height * 0.015;
                break;
            case '9':
            case '8':
            case '7':
                // Mid-range cards fairly balanced
                comY = -rect.height * 0.01;
                break;
            default:
                // Low cards (2-6) are quite balanced
                comY = -rect.height * 0.005;
        }
        
        // Suits can also affect balance slightly (spades/clubs darker than hearts/diamonds)
        if (suit === 'S' || suit === 'C') {
            comY -= rect.height * 0.005; // Slightly more top-heavy for black suits
        }
        
        // Add small random variation to simulate manufacturing differences
        comX += (Math.random() - 0.5) * rect.width * 0.01;
        comY += (Math.random() - 0.5) * rect.height * 0.01;
        
        return { x: comX, y: comY };
    }
}

export default CardPhysicsEngine;