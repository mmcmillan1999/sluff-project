#!/bin/bash
# Card Physics Test Runner
# Comprehensive test execution for the card physics system

echo "🃏 Card Physics Test Suite"
echo "=========================="
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to run tests with nice output
run_test() {
    local test_name="$1"
    local test_pattern="$2"
    local description="$3"
    
    echo -e "${BLUE}🧪 Running: ${test_name}${NC}"
    echo -e "${YELLOW}Description: ${description}${NC}"
    echo "----------------------------------------"
    
    if npm test -- --testPathPattern="$test_pattern" --verbose --watchAll=false; then
        echo -e "${GREEN}✅ ${test_name} PASSED${NC}"
    else
        echo -e "${RED}❌ ${test_name} FAILED${NC}"
        return 1
    fi
    echo ""
}

# Main test execution
echo "Starting comprehensive physics test suite..."
echo ""

# Run unit tests
run_test "Unit Tests" "CardPhysicsEngine.test.js" "Core physics engine functionality, edge cases, and robustness"

if [ $? -eq 0 ]; then
    # Run integration tests if unit tests pass
    run_test "Integration Tests" "CardPhysicsEngineIntegration.test.js" "Hand changes, window resize, multiple cards, and drop zone integration"
else
    echo -e "${RED}⚠️  Skipping integration tests due to unit test failures${NC}"
    exit 1
fi

# Run all physics-related tests
echo -e "${BLUE}🔄 Running all physics-related tests...${NC}"
npm test -- --testPathPattern="CardPhysics" --watchAll=false

echo ""
echo -e "${GREEN}🎉 Card Physics Test Suite Complete!${NC}"
echo ""
echo "📋 Manual Test Scenarios:"
echo "   - See: src/tests/CARD_PHYSICS_TEST_SCENARIOS.md"
echo ""
echo "📊 Test Summary:"
echo "   - See: src/tests/CARD_PHYSICS_TESTING_SUMMARY.md"
echo ""
echo -e "${YELLOW}💡 Next Steps:${NC}"
echo "   1. Run manual tests on real devices"
echo "   2. Test with actual game scenarios"  
echo "   3. Monitor performance in staging"
echo "   4. Collect user feedback on drag/drop feel"