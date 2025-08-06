// frontend/src/utils/CardPhysicsEngine.js

class CardPhysicsEngine {
    constructor() {
        // Physics constants
        this.gravity = 500; // pixels/second^2 (scaled for screen)
        this.angularDamping = 0.92; // Angular velocity damping
        this.linearDamping = 0.98; // Default linear damping (overridden by directional air resistance)
        this.minThrowVelocity = 100; // Reduced - magnetic field helps capture cards
        this.maxRotationSpeed = 15; // Increased to allow more spin from finger movements
        
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
    }
    
    // Start tracking a card when touched
    grabCard(cardId, touchPoint, cardElement, cardCenter) {
        // Get the visual position (includes margins)
        const rect = cardElement.getBoundingClientRect();
        
        // Get computed styles to check for margins
        const computedStyle = window.getComputedStyle(cardElement);
        const marginLeft = parseFloat(computedStyle.marginLeft) || 0;
        
        // Store initial rect for reference
        const initialRect = { ...rect, left: rect.left, top: rect.top };
        
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
            originalPosition: { x: rect.left, y: rect.top },
            cardCenter: actualCenter,
            grabTime: performance.now(),
            lifted: true,
            scale: 1.0, // Start at normal scale to avoid snap
            targetScale: 1.05, // Target scale for smooth animation
            totalRotation: 0 // Track total rotation for continuous spinning
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
        
        // Add pencil stab visual marker using pixel positioning
        const stabMarker = document.createElement('div');
        stabMarker.className = 'pencil-stab-marker';
        
        // Calculate marker position in pixels from card's top-left
        const markerLeft = (rect.width / 2) + pivotOffset.x;
        const markerTop = (rect.height / 2) + pivotOffset.y;
        
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
        
        // Add arrow pointing to center of mass
        const arrowElement = document.createElement('div');
        arrowElement.className = 'center-of-mass-arrow';
        
        // Calculate the true center of mass (accounting for card design)
        const centerOfMass = this.calculateCenterOfMass(cardId, rect);
        
        // Arrow should show the direction of gravity pull - from COM to where it wants to go (down from pivot)
        // When at rest, COM should be directly below pivot, so arrow points from pivot to COM
        const arrowDx = centerOfMass.x - pivotOffset.x;
        const arrowDy = centerOfMass.y - pivotOffset.y;
        const arrowLength = Math.sqrt(arrowDx * arrowDx + arrowDy * arrowDy);
        const arrowAngle = Math.atan2(arrowDy, arrowDx);
        
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
        
        // Add arrowhead
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
        
        // Add a vertical reference line for debugging
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
        this.activeCards.get(cardId).centerOfMass = centerOfMass;
        this.activeCards.get(cardId).verticalLine = verticalLine;
        
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
        const card = this.activeCards.get(cardId);
        
        // Debug: Check if pencil marker is at finger position after transform
        if (process.env.NODE_ENV === 'development') {
            // Wait two frames to ensure all updates have been applied
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                const cardRect = cardElement.getBoundingClientRect();
                const markerRect = stabMarker.getBoundingClientRect();
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
    
    // Release card and calculate trajectory
    releaseCard(cardId, dropZoneCenter, onComplete) {
        const card = this.activeCards.get(cardId);
        if (!card) return;
        
        // Critical check - if no drop zone, return card home
        if (!dropZoneCenter) {
            console.error('No dropZoneCenter provided - card will return home');
            card.targetPosition = card.originalPosition;
            card.isReturning = true;
            card.onComplete = () => {
                this.cleanupCard(cardId);
                if (typeof onComplete === 'function') {
                    onComplete(false);
                }
            };
            return;
        }
        
        card.isDragging = false;
        card.releaseTime = performance.now();
        
        // Calculate release velocity
        const velocity = this.calculateVelocity();
        card.velocity = velocity;
        
        // Detect throw intention based on velocity and drag duration
        const speed = Math.sqrt(velocity.x ** 2 + velocity.y ** 2);
        const dragDuration = (performance.now() - card.grabTime) / 1000; // seconds
        
        // Determine if this is an intentional throw vs a drop/misclick
        const isIntentionalThrow = speed > 150 || // Moving fast enough
                                   (speed > 50 && dragDuration > 0.2); // Or moderate speed with deliberate drag
        
        // Mark the card's throw intention
        card.isIntentionalThrow = isIntentionalThrow;
        
        // Boost velocity slightly for better feel (only for intentional throws)
        if (isIntentionalThrow) {
            card.velocity.x *= 1.5;
            card.velocity.y *= 1.5;
        }
        
        // IMPORTANT: Preserve angular momentum from dragging
        // The angular velocity should continue from whatever spin the user imparted
        // Don't reset or modify it here - let it carry through to the flight
        
        // Get current card center
        const rect = card.element.getBoundingClientRect();
        const currentCenter = {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
        };
        
        console.log('Card released:', {
            cardId,
            speed: speed.toFixed(1),
            dragDuration: dragDuration.toFixed(2),
            isIntentionalThrow,
            currentCenter: { x: currentCenter.x.toFixed(1), y: currentCenter.y.toFixed(1) },
            dropZoneCenter: dropZoneCenter ? { x: dropZoneCenter.x.toFixed(1), y: dropZoneCenter.y.toFixed(1) } : null,
            angularVelocity: (card.angularVelocity * 180 / Math.PI).toFixed(1) + '°/s'
        });
        
        // Check if throw will reach drop zone
        const trajectory = this.predictTrajectory({
            ...card,
            position: currentCenter
        }, dropZoneCenter);
        
        console.log('Trajectory prediction result:', {
            cardId,
            willReach: trajectory.willReach,
            finalDistance: trajectory.distance.toFixed(1),
            finalSpeed: trajectory.speed.toFixed(1),
            boostedVelocity: { x: card.velocity.x.toFixed(1), y: card.velocity.y.toFixed(1) }
        });
        
        // ALWAYS attempt to dock - let the physics decide if it makes it
        // This is crucial for drag-and-drop and forgiving gameplay
        card.targetPosition = {
            x: dropZoneCenter.x - rect.width / 2,
            y: dropZoneCenter.y - rect.height / 2
        };
        card.dropZoneCenter = dropZoneCenter; // Store for physics calculations
        card.isReturning = false;
        
        // Mark cards that need extra help
        if (!trajectory.willReach) {
            console.log('Card needs assistance to reach dock:', {
                cardId,
                reason: trajectory.reason || 'Unknown',
                distance: trajectory.distance
            });
            card.needsMagneticAssist = true;
        }
        
        card.onComplete = (success) => {
            console.log('Card onComplete callback called:', {
                cardId,
                success,
                calledFrom: 'dock attempt'
            });
            // Don't clean up here - pass success to game first
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
    
    // Update physics after release
    updateThrowPhysics(card, deltaTime) {
        const toTarget = {
            x: card.targetPosition.x - card.position.x,
            y: card.targetPosition.y - card.position.y
        };
        
        const distance = Math.sqrt(toTarget.x ** 2 + toTarget.y ** 2);
        
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
                
                // Calculate how many quarter turns we need
                const quarterTurns = Math.ceil(Math.abs(currentRotation) / (Math.PI / 2));
                const targetRotation = quarterTurns * (Math.PI / 2) * Math.sign(currentRotation);
                
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
            const DOCKING_ZONE = 150; // Larger zone for final approach
            
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
            const ACCEPT_ANY_ANGLE = true; // Cards can land at any angle
            
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
    
    // Cleanup card after animation
    cleanupCard(cardId) {
        if (!cardId) {
            console.warn('cleanupCard called without cardId');
            return;
        }
        
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
            
            this.activeCards.delete(cardId);
        }
    }
    
    // Cancel all active animations
    cancelAll() {
        this.activeCards.forEach((card, cardId) => {
            this.cleanupCard(cardId);
        });
        
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
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