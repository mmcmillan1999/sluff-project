# CardPhysicsEngine Test Suite

## Overview

This comprehensive test suite validates the CardPhysicsEngine's physics simulation capabilities, including finger movement detection, torque calculations, gravity effects, and damping systems.

## Test Categories

### 1. Constructor and Initialization
- Verifies correct physics constants setup
- Confirms initial state is clean

### 2. Card Grabbing and Initial Setup
- Tests card physics state initialization
- Validates pivot offset calculations
- Confirms physics loop startup

### 3. Finger Movement and Torque Calculations
- **Finger movements create angular velocity changes**: Verifies that finger movements generate torque
- **Circular finger movements create appropriate torque**: Tests that circular motions create sustained rotation
- **Rapid finger movements create higher torque**: Validates torque scaling with movement speed

### 4. Gravity and Equilibrium Physics
- **Gravity returns card to equilibrium**: Tests that cards settle when finger stops moving
- **Equilibrium angle calculation**: Validates center of mass physics calculations

### 5. Damping System
- **Damping reduces angular velocity over time**: Confirms angular velocity decreases without input
- **Damping system functions correctly**: Verifies physics stability

### 6. Edge Cases and Robustness
- **Very small finger movements**: Tests sub-pixel movement handling
- **Zero time delta**: Ensures no NaN/Infinity values with zero time steps
- **Maximum angular velocity limiting**: Confirms velocity capping works
- **Rapid direction changes**: Tests stability with erratic input

### 7. Center of Mass Calculations
- **Different card ranks**: Verifies face cards vs number cards have different physics
- **Different suits**: Tests subtle weight differences between suits

### 8. Touch History and Velocity Calculation
- **Touch history management**: Tests circular buffer behavior
- **Velocity calculation**: Validates speed calculation from touch points

### 9. Cleanup and Memory Management
- **Card cleanup**: Tests proper DOM element cleanup
- **Cancel all**: Verifies bulk cleanup functionality

### 10. Physics Integration Test
- **Complete simulation**: End-to-end test with grab, movement, and gravity phases

## Running the Tests

```bash
# Run just the CardPhysicsEngine tests
npm test -- --testPathPattern=CardPhysicsEngine.test.js

# Run with verbose output
npm test -- --testPathPattern=CardPhysicsEngine.test.js --verbose

# Run with console output visible
npm test -- --testPathPattern=CardPhysicsEngine.test.js --verbose --silent
```

## Console Output

The tests include extensive console logging to demonstrate the physics calculations:

- **Torque calculations**: Shows cross product math for finger movements
- **Equilibrium angles**: Displays center of mass calculations
- **Physics state**: Tracks rotation and angular velocity over time
- **Edge case handling**: Logs how the engine handles unusual inputs

## Mock Data

The tests use realistic mock data:
- **Card dimensions**: 80x120 pixels (standard playing card aspect ratio)
- **Touch points**: Screen coordinates in pixels
- **Timing**: 60fps simulation (16ms frame intervals)
- **Physics constants**: Real values from the engine

## Key Validation Points

1. **Torque Physics**: Verifies τ = r × F calculations work correctly
2. **Gravity Simulation**: Confirms pendulum-like behavior
3. **Damping Effects**: Tests angular velocity decay
4. **Numerical Stability**: Ensures no NaN/Infinity values
5. **Memory Safety**: Validates proper cleanup

## Test Philosophy

These tests focus on **behavior verification** rather than implementation details:
- Tests what the physics engine **does**, not how it does it
- Uses console logging to show intermediate calculations
- Validates edge cases and robustness
- Ensures numerical stability under all conditions

The extensive logging allows developers to see the physics engine working in real-time, making it easier to understand and debug the complex physics calculations.