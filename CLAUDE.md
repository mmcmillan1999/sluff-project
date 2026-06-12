# CLAUDE.md - Project Context for Claude Code

## Project: Sluff Card Game
A real-time multiplayer card game with WebSocket communication, built with React frontend and Node.js backend.

## Key Information
- **Project type**: Full-stack web application
- **Main languages**: JavaScript (React, Node.js)
- **Key dependencies**: React, Socket.io, Express, PostgreSQL
- **Deployment**: Netlify (frontend), Heroku (backend)

## Important Commands
- **Frontend Dev**: `cd frontend && npm start`
- **Frontend Build**: `cd frontend && npm run build`
- **Backend**: `cd backend && npm start`
- **Debug Overlay**: Press `Shift+D` in game
- **Deploy to Netlify**: Auto-deploys from GitHub main branch

## Project Structure
- `/frontend/` - React application
  - `/src/components/` - React components
  - `/src/components/game/` - Game-specific components
  - `/public/assets/` - Images and static assets
- `/backend/` - Node.js server
  - WebSocket handling
  - Game state management
  - PostgreSQL database integration

## Development Notes
- All game layout uses viewport units (vh/vw) for responsive scaling
- Cards maintain 5:7 aspect ratio (width = height * 0.714)
- Header fixed at 7.5vh, game view uses remaining space
- Z-index hierarchy carefully managed for overlays and modals

## 🎯 Core Layout Systems (Updated: 8/23/2025)

### PlayerSeat Positioning System ✅
- **Wrapper pattern** with anchor points (bottom-center pinning)
- **Collision prevention mode** triggers when seat width > 25vw
- Automatic repositioning: West→1vw, East→99vw @ 35vh with 90° rotations
- Fixed dimensions: 7vh height × 2.5 aspect ratio = 17.5vh width
- See: `PLAYERSEAT_POSITIONING_SYSTEM.md` for complete documentation

### Card Spacing Logic ✅
- **Two modes**: CENTER_MODE (cards fit) vs OVERLAP_MODE (cards overlap)
- Mathematical foundation from Excel model (perfectly replicated)
- Key constants: Card height = 10% viewport, aspect ratio = 0.714
- Edge-anchoring in overlap mode ensures perfect spread
- See: `CARD_SPACING_LOGIC.md` for complete documentation

### Card Physics Engine ✅
- Momentum-based dragging with spring return
- Compatible with both spacing modes
- Orphaned card cleanup prevents memory leaks
- Integration tested with all hand sizes (0-15 cards)

## AI Bot System
- **9 Working Models** with reasoning display
- Insurance system correctly implements point protection
- Bot decisions show genuine AI analysis (not pre-programmed)

## Project Status (Updated: 8/23/2025)

### Completed Features
- ✅ Viewport height (vh) based responsive design throughout the game
- ✅ Mathematical card spacing with CENTER/OVERLAP modes
- ✅ PlayerSeat positioning with collision prevention and rotation
- ✅ Card physics engine with momentum and spring return
- ✅ Debug overlay system (Shift+D) with rulers and measurements
- ✅ Simple FrogDiscardOverlay popup for Frog Widow Exchange
- ✅ Insurance system with point protection mechanics
- ✅ Draw voting mechanism
- ✅ Bot players with AI reasoning display
- ✅ Admin observer mode

### Current Architecture

#### Layout Hierarchy
```
GameTableView (100vh - 7.5vh header)
├── TableLayout (game-table flex container)
│   └── table-oval (max-width: min(150vh, 95vw))
│       ├── Player seats (absolute positioned)
│       ├── Trick piles (4 fixed positions)
│       └── Played cards (absolute positioned)
└── PlayerHand (footer area)
    └── player-hand-container (fixed 13vh height)
        └── player-hand-cards (with turn pulse animation)
```

#### Key Components
- **PlayerSeatPositioner**: Wrapper component for absolute seat positioning with collision prevention
- **PlayerHand**: Mathematical card spacing with CENTER/OVERLAP modes
- **CardSpacingEngine**: Pure math engine for card position calculations
- **CardPhysicsEngine**: Momentum-based dragging with spring return
- **PlayerHandAnchorDebug**: Debug overlay (Shift+D) with measurements and rulers
- **TableLayout**: Main game container with all table elements
- **FrogDiscardOverlay**: Simple popup for Frog widow exchange

## Current Focus: Fine-Tuning Details

### ✅ Recently Completed (8/22-8/23/2025)
- PlayerSeat positioning with collision prevention
- Card spacing mathematics (CENTER/OVERLAP modes)
- Debug overlay with measurements (Shift+D)
- Card physics engine integration
- ESLint warning cleanup

### 🎯 Next Fine-Tuning Tasks
1. **Turn Indicator Polish**: Ensure pulse animation properly surrounds PlayerHand
2. **Table Centering**: Verify table oval is perfectly centered
3. **Container Boundaries**: Fine-tune all margins and padding
4. **Visual Polish**: Ensure all transitions are smooth

### 📚 Key Documentation Files
- `PLAYERSEAT_POSITIONING_SYSTEM.md` - Player seat positioning guide
- `CARD_SPACING_LOGIC.md` - Card spacing mathematics
- `CARD_PHYSICS_TODO.md` - Physics implementation notes

### 🔑 Design Principles
1. **Wrapper Pattern**: Use wrappers for positioning, keep content separate
2. **Viewport Units**: All sizing in vh/vw for consistency
3. **Mathematical Precision**: All spacing calculated, not eyeballed
4. **Debug First**: Always have visual debugging available (Shift+D)