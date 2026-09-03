# CLAUDE.md — Sluff Card Game

Real-time multiplayer trick-taking card game (4-player Sluff) with bot opponents.

## Stack
- **Bots**: live play uses heuristic brains (`backend/src/core/bot-brains/`, dispatched by `BotPlayer.js`; see the Bot brains memory). The LLM layer (`core/SuperBot.js` + `services/aiService.js`: OpenAI, Anthropic, Google, Groq behind one `MODELS` registry with a fallback chain) is dormant — nothing in live play calls it. It has per-request timeouts and a decision deadline so it can be re-wired behind a flag; verify with `node scripts/smoke-test-ai.js`.

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
- **REQUIRED before every push to `main`**: run `cd backend && npm run deploy:check`. Any push
  redeploys the Render backend. Since Aug 2026 the SIGTERM handler snapshots live human games to
  `live_game_snapshots` and the new instance restores them (boot pass + 10-min sweep, see
  `src/serialization/gameResume.js`) — but resume is best-effort, so the check still applies: it
  exits 1 while a human is mid-game (bot-only games don't block). If humans are playing, wait for
  the check to clear or get Matt's explicit go-ahead before pushing.
- **Frontend**: Netlify, auto-deploys from `main` (`netlify.toml` at repo root, publishes `frontend/build`, Node 22).
- **Backend**: Render web service (`npm start`). NOT Heroku.
- **Database**: PostgreSQL on Render via `POSTGRES_CONNECT_STRING`. Schema created at boot by `backend/src/data/createTables.js` (no migration tool).
- **URLs**: playsluff.com (frontend domain); backend is **sluff-backend.onrender.com** (verified July 2026 — `api.playsluff.com` is dead and `sluff-backend-pilot.onrender.com` is a dormant stage service running old code). Frontend auto-detects backend URL by hostname in `frontend/src/services/api.js`; `VITE_SERVER_URL` overrides.
- **Netlify gotcha (July 2026)**: webhook-triggered deploys can all show "skipped — a new deploy was scheduled for the same branch" (suspected duplicate deploy triggers). If pushes to `main` skip, use Deploys → "Trigger deploy" in the dashboard. Verify what's live via `https://playsluff.com/version.json` and the Client stamp in the lobby footer.

## Env vars (backend/.env, see .env.example)
`POSTGRES_CONNECT_STRING`, `JWT_SECRET`, `CLIENT_ORIGIN`, `PORT`, `RESEND_API_KEY` (transactional email; `SENDGRID_API_KEY` is a legacy fallback), `SENDER_EMAIL_ADDRESS`, plus `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GOOGLE_API_KEY` / `GROQ_API_KEY` for bots. Optional recovery tuning: `ABANDONED_GAME_GRACE_HOURS` and `ABANDONED_GAME_RECOVERY_INTERVAL_MINUTES`.

## Architecture map
- `frontend/src/utils/CardPhysicsEngine.js` — momentum drag physics (~3k lines, the crown jewel).
- `frontend/src/utils/CardSpacingEngine.js` — CENTER/OVERLAP card spacing math (`docs/CARD_SPACING_LOGIC.md`).
- `play_timings` table (Aug 2026): server-measured human think time per card play (turn-open →
  card-received, bots excluded) — the reaction-time distribution is the bot-detection signal.
- Bot insurance (Aug 2026): `backend/src/core/bot-strategies/MarketInsuranceStrategy.js` prices
  asks/offers from a Monte Carlo rollout (`RolloutEstimator.js`) over public information only
  (`PublicRoundView.js` is the enforced no-cheating boundary — see `tests/marketInsurance.test.js`).
  `INSURANCE_STRATEGY=legacy` reverts to `AdaptiveInsuranceStrategy`, which is also the on-error fallback.

## Conventions
- Game layout sizes in vh/vw only; cards keep 5:7 aspect ratio; header is 7.5vh.
- Positioning uses wrapper components (`docs/PLAYERSEAT_POSITIONING_SYSTEM.md`).
- 4-space indent, single quotes, CommonJS in backend, ESM in frontend.
- **Orientation policy (July 2026)**: mobile portrait is the gold-standard layout. Phone landscape is intentionally blocked by `OrientationScrim` (landscape + coarse pointer + ≤600px tall) and `manifest.json` locks installed PWAs to portrait — don't build phone-landscape layouts. Portrait tablets get the phone layout (wide-mode threshold aspect ≥ 1.25 in `PlayerSeatPositioner.js`); desktop/tablet-landscape geometry is vh-capped via `min()`/`max()` terms that are no-ops on portrait.
- **Layout harness**: `npm run dev` then open `/harness.html?mode=3|4` — renders the real game table with canned state, no backend needed. Use it to screenshot layout changes at any viewport. Add `?turn=1` for a live hand (playCard really moves the card), `?playstyle=flick|fast` to preset the card play style (implies turn).

## Known quirks
- **Player name is live game-state identity.** GameEngine keys `scores`, `hands`,
  `capturedTricks`, insurance offers, and every vote map by the name string, and
  there is no re-key path — so renames are refused while seated (`isUserSeatedAnywhere`).
  `game_history.outcome` also stores names as free text, which is why accounts keep
  `previous_usernames` for `gameVoid.js` to match against.
- CORS is pinned to GET and POST (`server.js`), so new mutating routes must be POST.
- The Vitest suite is fully green as of July 2026 (the old note about 11 stale physics/spacing failures no longer applies) — treat any failure as a real regression.
- `docs/archive/` is historical; don't treat as current.
- Local Python tooling in `tools/legacy-agents/` is unrelated to the app (gitignored).

## Goals (June 2026)
Revive deployment (Render + domain), keep modernizing, then App Store release via a Capacitor wrapper (PWA manifest exists; no service worker or native shell yet).
