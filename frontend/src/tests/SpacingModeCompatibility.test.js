// SpacingModeCompatibility.test.js
// Verification that physics engine works with both CENTER_MODE and OVERLAP_MODE

const CardSpacingEngine = require('../utils/CardSpacingEngine').default;
const CardPhysicsEngine = require('../utils/CardPhysicsEngine').default;

describe('Spacing Mode Compatibility Tests', () => {
    let spacingEngine;
    let physicsEngine;
    let mockContainerElement;
    let mockCardElement;
    
    beforeEach(() => {
        spacingEngine = new CardSpacingEngine();
        physicsEngine = new CardPhysicsEngine();
        
        // Mock container element
        mockContainerElement = {
            getBoundingClientRect: () => ({
                left: 100,
                top: 500,
                width: 1200,
                height: 130,
                right: 1300,
                bottom: 630
            })
        };
        
        // Mock card element
        mockCardElement = {
            getBoundingClientRect: () => ({
                left: 200,
                top: 500,
                width: 71,
                height: 100,
                right: 271,
                bottom: 600
            }),
            style: {},
            dataset: {},
            addEventListener: jest.fn(),
            removeEventListener: jest.fn()
        };
    });
    
    describe('CENTER_MODE Compatibility', () => {
        test('should correctly handle CENTER_MODE positions', () => {
            // Calculate layout for 5 cards (should be CENTER_MODE)
            const layout = spacingEngine.calculateLayout(1400, 800, 5);
            
            expect(layout.layout.mode).toBe('CENTER_MODE');
            
            // Verify positions are centered
            const positions = layout.layout.positions;
            expect(positions.length).toBe(5);
            
            // Check that cards are centered in container
            const containerWidth = layout.container.width;
            const totalHandWidth = layout.layout.totalHandWidth;
            const expectedOffset = (containerWidth - totalHandWidth) / 2;
            
            expect(positions[0].left).toBeCloseTo(expectedOffset, 0);
            expect(positions[0].mode).toBe('center');
        });
        
        test('should pass CENTER_MODE positions correctly to physics engine', () => {
            const layout = spacingEngine.calculateLayout(1400, 800, 5);
            const cardIndex = 2; // Middle card
            const cardPosition = layout.layout.positions[cardIndex];
            
            // Create layout context as PlayerHand does
            const layoutContext = {
                cardIndex,
                containerRelativePosition: {
                    x: cardPosition.left,
                    y: 0
                },
                containerElement: mockContainerElement
            };
            
            // Verify physics engine can use the position
            const touchPoint = { x: 300, y: 550 };
            const cardCenter = { x: 235, y: 550 };
            
            const grabResult = physicsEngine.grabCard(
                'card-2',
                touchPoint,
                mockCardElement,
                cardCenter,
                layoutContext
            );
            
            expect(grabResult).toBeTruthy();
            
            // Check that physics engine stored the layout context
            const activeCard = physicsEngine.activeCards.get('card-2');
            expect(activeCard).toBeDefined();
            expect(activeCard.layoutContext).toEqual(layoutContext);
            expect(activeCard.layoutContext.containerRelativePosition.x).toBe(cardPosition.left);
        });
    });
    
    describe('OVERLAP_MODE Compatibility', () => {
        test('should correctly handle OVERLAP_MODE positions', () => {
            // Calculate layout for 13 cards (should trigger OVERLAP_MODE)
            const layout = spacingEngine.calculateLayout(1400, 800, 13);
            
            expect(layout.layout.mode).toBe('OVERLAP_MODE');
            
            // Verify positions are edge-anchored
            const positions = layout.layout.positions;
            expect(positions.length).toBe(13);
            
            // First card should be at left edge
            expect(positions[0].left).toBe(0);
            expect(positions[0].mode).toBe('overlap');
            
            // Last card should be at right edge minus card width
            const lastPosition = positions[positions.length - 1].left;
            const expectedLastPosition = layout.container.width - layout.card.width;
            expect(lastPosition).toBeCloseTo(expectedLastPosition, 0);
        });
        
        test('should pass OVERLAP_MODE positions correctly to physics engine', () => {
            const layout = spacingEngine.calculateLayout(1400, 800, 13);
            const cardIndex = 6; // Middle card in overlap
            const cardPosition = layout.layout.positions[cardIndex];
            
            // Create layout context as PlayerHand does
            const layoutContext = {
                cardIndex,
                containerRelativePosition: {
                    x: cardPosition.left,
                    y: 0
                },
                containerElement: mockContainerElement
            };
            
            // Verify physics engine can use the position
            const touchPoint = { x: 500, y: 550 };
            const cardCenter = { x: 500, y: 550 };
            
            const grabResult = physicsEngine.grabCard(
                'card-6',
                touchPoint,
                mockCardElement,
                cardCenter,
                layoutContext
            );
            
            expect(grabResult).toBeTruthy();
            
            // Check that physics engine stored the layout context
            const activeCard = physicsEngine.activeCards.get('card-6');
            expect(activeCard).toBeDefined();
            expect(activeCard.layoutContext).toEqual(layoutContext);
            expect(activeCard.layoutContext.containerRelativePosition.x).toBe(cardPosition.left);
        });
    });
    
    describe('Mode Transition Handling', () => {
        test('should handle transition from CENTER_MODE to OVERLAP_MODE', () => {
            // Start with CENTER_MODE (5 cards)
            let layout = spacingEngine.calculateLayout(1400, 800, 5);
            expect(layout.layout.mode).toBe('CENTER_MODE');
            
            const cardIndex = 2;
            let cardPosition = layout.layout.positions[cardIndex];
            
            // Simulate grabbing a card
            const layoutContext = {
                cardIndex,
                containerRelativePosition: {
                    x: cardPosition.left,
                    y: 0
                },
                containerElement: mockContainerElement
            };
            
            physicsEngine.grabCard(
                'test-card',
                { x: 300, y: 550 },
                mockCardElement,
                { x: 300, y: 550 },
                layoutContext
            );
            
            // Now simulate hand growing to 13 cards (OVERLAP_MODE)
            layout = spacingEngine.calculateLayout(1400, 800, 13);
            expect(layout.layout.mode).toBe('OVERLAP_MODE');
            
            // Update the active card's position
            const handArray = Array.from({ length: 13 }, (_, i) => i === 2 ? 'test-card' : `card-${i}`);
            physicsEngine.updateAllActiveCardPositions(handArray, layout, mockContainerElement);
            
            // Verify the card's position was updated
            const activeCard = physicsEngine.activeCards.get('test-card');
            expect(activeCard).toBeDefined();
            expect(activeCard.layoutContext.cardIndex).toBe(2);
            
            // The new position should be from OVERLAP_MODE
            const newPosition = layout.layout.positions[2];
            expect(activeCard.layoutContext.containerRelativePosition.x).toBe(newPosition.left);
        });
        
        test('should handle airborne cards during mode transition', () => {
            // Start with OVERLAP_MODE (13 cards)
            let layout = spacingEngine.calculateLayout(1400, 800, 13);
            expect(layout.layout.mode).toBe('OVERLAP_MODE');
            
            const cardIndex = 6;
            const cardPosition = layout.layout.positions[cardIndex];
            
            // Grab and release card (make it airborne/returning)
            const layoutContext = {
                cardIndex,
                containerRelativePosition: {
                    x: cardPosition.left,
                    y: 0
                },
                containerElement: mockContainerElement
            };
            
            physicsEngine.grabCard(
                'airborne-card',
                { x: 500, y: 550 },
                mockCardElement,
                { x: 500, y: 550 },
                layoutContext
            );
            
            // Mark card as returning (airborne)
            const activeCard = physicsEngine.activeCards.get('airborne-card');
            activeCard.isReturning = true;
            
            // Now simulate hand shrinking to 5 cards (CENTER_MODE)
            layout = spacingEngine.calculateLayout(1400, 800, 5);
            expect(layout.layout.mode).toBe('CENTER_MODE');
            
            // Update positions including airborne card
            const handArray = ['card-0', 'card-1', 'airborne-card', 'card-3', 'card-4'];
            physicsEngine.updateAllActiveCardPositions(handArray, layout, mockContainerElement);
            
            // Verify the airborne card's target was updated
            expect(activeCard.targetPosition).toBeDefined();
            
            // Target should be the new CENTER_MODE position
            const newIndex = 2; // airborne-card is now at index 2
            const newPosition = layout.layout.positions[newIndex];
            const containerRect = mockContainerElement.getBoundingClientRect();
            
            expect(activeCard.targetPosition.x).toBeCloseTo(
                containerRect.left + newPosition.left,
                0
            );
        });
    });
    
    describe('Physics Engine Mode Agnosticism', () => {
        test('physics engine should not care about spacing mode', () => {
            // The physics engine should work identically regardless of mode
            // It only cares about the actual positions, not how they were calculated
            
            const centerLayout = spacingEngine.calculateLayout(1400, 800, 5);
            const overlapLayout = spacingEngine.calculateLayout(1400, 800, 13);
            
            // Both modes provide positions in the same format
            expect(centerLayout.layout.positions[0]).toHaveProperty('left');
            expect(overlapLayout.layout.positions[0]).toHaveProperty('left');
            
            // Physics engine uses positions the same way
            const createLayoutContext = (position) => ({
                cardIndex: 0,
                containerRelativePosition: { x: position.left, y: 0 },
                containerElement: mockContainerElement
            });
            
            // Test with CENTER_MODE position
            const centerContext = createLayoutContext(centerLayout.layout.positions[0]);
            physicsEngine.grabCard('center-card', { x: 100, y: 500 }, mockCardElement, { x: 100, y: 500 }, centerContext);
            
            // Test with OVERLAP_MODE position
            const overlapContext = createLayoutContext(overlapLayout.layout.positions[0]);
            physicsEngine.grabCard('overlap-card', { x: 100, y: 500 }, mockCardElement, { x: 100, y: 500 }, overlapContext);
            
            // Both should work identically
            expect(physicsEngine.activeCards.has('center-card')).toBe(true);
            expect(physicsEngine.activeCards.has('overlap-card')).toBe(true);
            
            // Clean up
            physicsEngine.cleanupCard('center-card');
            physicsEngine.cleanupCard('overlap-card');
        });
    });
});