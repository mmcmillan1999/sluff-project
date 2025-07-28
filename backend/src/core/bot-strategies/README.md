# Bot Insurance Strategy System

This document explains the enhanced bot insurance decision-making system implemented for the Sluff card game.

## Overview

The bot insurance system provides intelligent, personality-driven decision making for bots during the insurance phase of 3-player games. Bots now exhibit distinct personalities and adapt their strategies based on game state and opponent behavior.

## Bot Personalities

Each bot is assigned one of three personalities based on a hash of their name, ensuring consistency across games:

### Aggressive Bots
- **Characteristics**: Quick decisions, high risk tolerance, greedy when winning
- **Bidder Behavior**: Ask for 30+ extra points when winning, hedge only 30% of losses
- **Defender Behavior**: Very stingy (15 point penalty), make up to 3 adjustments
- **Timing**: Make decisions 30% faster than baseline

### Conservative Bots  
- **Characteristics**: Thoughtful decisions, low risk tolerance, modest when winning
- **Bidder Behavior**: Ask for only 10 extra points when winning, hedge 70% of losses
- **Defender Behavior**: Less stingy (5 point penalty), highly adaptive to opponents
- **Timing**: Make decisions 30% slower than baseline

### Balanced Bots
- **Characteristics**: Moderate approach to all aspects
- **Bidder Behavior**: Ask for 20 extra points when winning, hedge 50% of losses  
- **Defender Behavior**: Moderate stinginess (10 point penalty)
- **Timing**: Standard decision speed

## Decision Factors

### For Bidders
1. **Projected Outcome**: Calculate expected final score based on current cards + hand
2. **Personality Greed**: Adjust base greed factor by personality
3. **Hand Strength**: Increase greed for very strong hands (8+ avg points per card)
4. **Opponent Behavior**: Adjust based on how aggressive/conservative opponents appear
5. **Game Progress**: More aggressive early, more conservative late in the game
6. **Risk Tolerance**: Final adjustment based on personality risk profile

### For Defenders
1. **Projected Defense**: Calculate expected defensive performance
2. **Base Stinginess**: Start with personality-based stinginess level
3. **Hand Strength**: Less stingy with strong hands, more stingy with weak hands
4. **Bidder Greed**: React to bidder's requirement (more stingy vs greedy bidders)
5. **Competitive Positioning**: Adjust offers to compete with other defenders
6. **Game Progress**: Slightly less stingy late in the game

## Behavioral Phases

The system implements realistic negotiation timing with three phases:

### Phase 1: Initial Decisions (0.5-2 seconds)
- All bots make their first insurance decision
- Timing varies by personality (Aggressive faster, Conservative slower)
- Staggered by 600ms intervals between bots

### Phase 2: Reactive Adjustments (2-4 seconds)
- Bots with high adaptiveness may adjust based on others' decisions
- Limited by personality (Conservative: 2 max, Aggressive: 3 max)
- Random timing variation for realism

### Phase 3: Final Competitive Push (4-6 seconds)
- Only occurs when a deal is close (within 20 points)
- Only highly adaptive bots (adaptiveness > 0.7) participate
- Final chance to close or prevent a deal

## Technical Implementation

### Key Files
- `InsuranceStrategy.js`: Core decision logic with personality system
- `GameService.js`: Enhanced timing and behavioral phases
- `BotPlayer.js`: Integration point for insurance decisions

### Key Functions
- `calculateInsuranceMove()`: Main decision engine
- `getBotPersonality()`: Personality assignment based on bot name
- `analyzeGameState()`: Game state analysis for strategic decisions
- `analyzeOpponentBehavior()`: Basic opponent behavior tracking

### State Tracking
The system tracks bot decision history in `engine.botInsuranceState`:
- `initialDecisionsMade`: Set of bots that made initial decisions
- `adjustmentsMade`: Map tracking adjustment count per bot
- `lastDecisionTime`: Timestamp of most recent decision

## Testing

The system includes comprehensive tests in `bot-insurance.test.js` covering:
- Personality assignment consistency
- Winning vs losing bidder behavior
- Defender responsiveness
- Personality-based decision differences
- Proper null returns when no change needed

## Future Enhancements

Potential improvements for future versions:
1. **Historical Learning**: Track opponent patterns across multiple games
2. **Bluffing**: Occasional irrational decisions to confuse human players
3. **Communication**: React to chat messages or emotes during negotiation
4. **Advanced Psychology**: Model risk aversion, loss aversion, and anchoring effects
5. **Difficulty Levels**: Adjustable intelligence levels for different player skill levels