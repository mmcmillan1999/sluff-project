# CLAUDE.md — Sluff Card Game

Real-time multiplayer trick-taking card game (4-player Sluff) with LLM-powered bot opponents.

## Stack
- **Frontend** (`/frontend`): React 19 + Vite 6, plain JS (no TypeScript), Socket.IO client, CSS files (no framework). Tests: Vitest + Testing Library.
- **Backend** (`/backend`): Node 22, Express 4, Socket.IO 4, PostgreSQL (`pg`), JWT auth, SendGrid email. Tests: plain-Node suite in `backend/tests` (`run_all_tests.js`).
- **AI bots** (`backend/src/services/aiService.js`): multi-provider (OpenAI, Anthropic, Google, Groq) with a single `MODELS` registry, legacy-ID aliases, and a cross-provider fallback chain. Verify model changes with `node scripts/smoke-test-ai.js`.

## Commands
```bash
cd frontend && npm run dev        # Vite dev server, port 3000
cd frontend && npm run build      # production build -> frontend/build
cd frontend && npm test           # Vitest
cd backend && npm run dev:simple  # nodemon server, port 3005
cd backend && npm test            # game-logic test suite
```
Debug overlay in game: `Shift+D`.

## Deployment (verify before assuming — was down June 2026)
- **Frontend**: Netlify, auto-deploys from `main` (`netlify.toml` at repo root, publishes `frontend/build`, Node 22).
- **Backend**: Render web service (`npm start`). NOT Heroku.
- **Database**: PostgreSQL on Render via `POSTGRES_CONNECT_STRING`. Schema created at boot by `backend/src/data/createTables.js` (no migration tool).
- **URLs**: playsluff.com (frontend domain); backend is **sluff-backend.onrender.com** (verified July 2026 — `api.playsluff.com` is dead and `sluff-backend-pilot.onrender.com` is a dormant stage service running old code). Frontend auto-detects backend URL by hostname in `frontend/src/services/api.js`; `VITE_SERVER_URL` overrides.
- **Netlify gotcha (July 2026)**: webhook-triggered deploys can all show "skipped — a new deploy was scheduled for the same branch" (suspected duplicate deploy triggers). If pushes to `main` skip, use Deploys → "Trigger deploy" in the dashboard. Verify what's live via `https://playsluff.com/version.json` and the Client stamp in the lobby footer.

## Env vars (backend/.env, see .env.example)
`POSTGRES_CONNECT_STRING`, `JWT_SECRET`, `CLIENT_ORIGIN`, `PORT`, `RESEND_API_KEY` (transactional email; `SENDGRID_API_KEY` is a legacy fallback), `SENDER_EMAIL_ADDRESS`, `ADMIN_SECRET`, `AI_SECRET_KEY`, plus `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GOOGLE_API_KEY` / `GROQ_API_KEY` for bots.

## Architecture map
- `backend/src/core/` — GameEngine (state machine), BotPlayer/SuperBot, handlers (bidding, card play, scoring, insurance), legalMoves.
- `backend/src/events/gameEvents.js` — all Socket.IO handlers.
- `backend/src/services/GameService.js` — table orchestration.
- `backend/src/api/` — REST routes (auth, leaderboard, admin, feedback, chat, ai, ping). `/health` endpoint checks DB.
- `frontend/src/components/game/` — game UI; `GameTableView` orchestrates, `TableLayout` lays out the oval, `PlayerHand` renders the hand.
- `frontend/src/utils/CardPhysicsEngine.js` — momentum drag physics (~3k lines, the crown jewel).
- `frontend/src/utils/CardSpacingEngine.js` — CENTER/OVERLAP card spacing math (`docs/CARD_SPACING_LOGIC.md`).

## Conventions
- Game layout sizes in vh/vw only; cards keep 5:7 aspect ratio; header is 7.5vh.
- Positioning uses wrapper components (`docs/PLAYERSEAT_POSITIONING_SYSTEM.md`).
- 4-space indent, single quotes, CommonJS in backend, ESM in frontend.

## Known quirks
- 11 Vitest failures in physics/spacing suites are stale Aug-2025 behavioral expectations, not regressions — don't "fix" engine behavior to satisfy them without testing real gameplay.
- `docs/archive/` is historical; don't treat as current.
- Local Python tooling in `tools/legacy-agents/` is unrelated to the app (gitignored).

## Goals (June 2026)
Revive deployment (Render + domain), keep modernizing, then App Store release via a Capacitor wrapper (PWA manifest exists; no service worker or native shell yet).
