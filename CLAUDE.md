# CLAUDE.md — Sluff Card Game

Real-time multiplayer trick-taking card game (4-player Sluff) with bot opponents.

## Stack
- **Bots**: live play uses heuristic brains (`backend/src/core/bot-brains/`, dispatched by `BotPlayer.js`; see the Bot brains memory). The bot-only exhibition (`maintenance/botExhibition.js`) is a **thermostat since Sept 6 2026**: no new bot game starts while the richest 3 bots hold more than 100 tokens between them (`BOT_EXHIBITION_TOP_BOTS` / `_TOP_BOTS_CAP_TOKENS`), and it resumes once humans win that back — so it feeds a few bots for the high tables without saturating tokens or the season board (the unthrottled loop ran ~10:1 against human games). Running games are never cut. `BOT_EXHIBITION_ENABLED=false` is the kill switch (`node scripts/rotate-render-secrets.js --set-env ... --execute`). The LLM layer (`core/SuperBot.js` + `services/aiService.js`: OpenAI, Anthropic, Google, Groq behind one `MODELS` registry with a fallback chain) is dormant — nothing in live play calls it. It has per-request timeouts and a decision deadline so it can be re-wired behind a flag; verify with `node scripts/smoke-test-ai.js`.

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
- Tournaments (Sept 2026, branch `tournament`): `backend/src/tournament/` — `TournamentDirector.js` owns
  registration, buy-ins/refunds/prizes and the round loop (one round at every table, then reseat top
  with top); `seating.js` (n = 3a + 4b tables, sit-out count) and `prizes.js` (50/30/20, 65/35 under six)
  are pure; `tournamentStore.js` has the Postgres store and an in-memory one for tests. Tables are
  ordinary GameEngines with `engine.tournament` set (`tableType: 'tournament'`, gameId null, never game
  over, no draws/forfeits/rematch, all-pass redeals keep the dealer and wash after three) that report
  a TOURNAMENT_ROUND_COMPLETE effect. Socket edge: `tournament*` events in `gameEvents.js`; the
  client lives in `frontend/src/components/tournament/` (lobby slot + popup + create sheet, the
  `tournament` view in App.js, the header cube via BrandHeader's `tournament` prop, venue
  `tournament-stage` in venueThemes.css). Clock: `core/tournamentClock.js` (12 s bid, 8 s trump,
  20 s discards, 6 s + 45 s bank per card; pace pressure at two-thirds done = 4 s free, bank drains 2×;
  absent seat 6 s; playout vote 10 s) drives afkTurnTimer for tournament tables. Deploy survival:
  `tournament_snapshots` (director.snapshotForShutdown on SIGTERM, restoreSnapshots at boot + sweep;
  a running tournament with no snapshot is voided after a 10-min grace); `npm run deploy:check` blocks
  on running tournaments with humans. Record: `tournament_results` → GET /api/tournaments/scoreboard
  (ranked by winnings = sum of prizes, never reduced) and /recent (podiums), the Tournaments panel in
  LeaderboardView, `tournaments` on the player profile, ledger category 'tournament'. Tournaments never
  touch wins/losses/washes. Spec: the tournament whiteboard artifact (see memory).
- Bot insurance (Aug 2026): `backend/src/core/bot-strategies/MarketInsuranceStrategy.js` prices
  asks/offers from a Monte Carlo rollout (`RolloutEstimator.js`) over public information only
  (`PublicRoundView.js` is the enforced no-cheating boundary — see `tests/marketInsurance.test.js`).
  `INSURANCE_STRATEGY=legacy` reverts to `AdaptiveInsuranceStrategy`, which is also the on-error fallback.

## Conventions
- Game layout sizes in vh/vw only; cards keep 5:7 aspect ratio; header is 7.5vh.
- Positioning uses wrapper components (`docs/PLAYERSEAT_POSITIONING_SYSTEM.md`).
- 4-space indent, single quotes, CommonJS in backend, ESM in frontend.
- **Orientation policy (July 2026)**: mobile portrait is the gold-standard layout. Phone landscape is intentionally blocked by `OrientationScrim` (landscape + coarse pointer + ≤600px tall) and `manifest.json` locks installed PWAs to portrait — don't build phone-landscape layouts. Portrait tablets get the phone layout (wide-mode threshold aspect ≥ 1.25 in `PlayerSeatPositioner.js`); desktop/tablet-landscape geometry is vh-capped via `min()`/`max()` terms that are no-ops on portrait.
- **Layout harness**: `npm run dev` then open `/harness.html?mode=3|4` — renders the real game table with canned state, no backend needed. Use it to screenshot layout changes at any viewport. Add `?turn=1` for a live hand (playCard really moves the card), `?playstyle=flick|fast` to preset the card play style (implies turn), `?volley=1` to have the opponents answer your lead on the bot cadence (their cards fly in from the seats, then linger + magnet, then the lead returns; add `&afk=0` so the AFK backstop doesn't play for you).

## Known quirks
- **Player name is live game-state identity.** GameEngine keys `scores`, `hands`,
  `capturedTricks`, insurance offers, and every vote map by the name string, and
  there is no re-key path — so renames are refused while seated (`isUserSeatedAnywhere`).
  `game_history.outcome` also stores names as free text, which is why accounts keep
  `previous_usernames` for `gameVoid.js` to match against.
- CORS is pinned to GET and POST (`server.js`), so new mutating routes must be POST.
- **VIP = the alpha testers.** `users.is_vip` was TRUE for every account that existed in Sept 2026; the column default is now FALSE, so accounts created from here on are not VIP. VIP-only setting `untimed_bot_games` (in-game menu "Untimed when alone", POST `/api/auth/settings`): no AFK backstop or turn call-up when that player is the only person at the table. Matt does not want that behaviour on release players, and does not want any "one human vs bots" special rules in general, because players must not learn they are playing bots.
- **Card helper is ON by default for everyone (Sept 2026)**: `cardHelperActive()` in `learnerLessons.js` is true unless the menu switch is off; only `isLearner()` (first 3 games) drives new-player-only behaviour such as the call-up exemption. A quick tip (`config/tips.js`) tells players where the switch is.
- **Turn pressure timings (Sept 2026)**: call-up at 5.75s / 17.25s (`useTurnNudge.js`), AFK backstop 51.75s (`afkTurnTimer.js`), both the July values relaxed 15%; the opening bid gets a 7s deal allowance so the clock never runs while the cards are still flying out.
- The Vitest suite is fully green as of July 2026 (the old note about 11 stale physics/spacing failures no longer applies) — treat any failure as a real regression.
- `docs/archive/` is historical; don't treat as current.
- Local Python tooling in `tools/legacy-agents/` is unrelated to the app (gitignored).

## Goals (June 2026)
Revive deployment (Render + domain), keep modernizing, then App Store release via a Capacitor wrapper (PWA manifest exists; no service worker or native shell yet).
