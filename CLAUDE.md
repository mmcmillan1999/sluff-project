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
- **REQUIRED before every push to `main` that touches `backend/`**: run `cd backend && npm run deploy:check`.
  Render's service root is `backend/`, so a push that changes only `frontend/` (or docs) rebuilds Netlify
  but does NOT restart the backend (verified Sept 7 2026: two frontend-only commits produced no Render
  deploy). Any push touching `backend/` redeploys the Render backend. Since Aug 2026 the SIGTERM handler snapshots live human games to
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
`POSTGRES_CONNECT_STRING`, `JWT_SECRET`, `CLIENT_ORIGIN`, `PORT`, `RESEND_API_KEY` (transactional email; Resend is the only provider since Sept 2026), `SENDER_EMAIL_ADDRESS`, plus `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GOOGLE_API_KEY` / `GROQ_API_KEY` for bots. Optional recovery tuning: `ABANDONED_GAME_GRACE_HOURS` and `ABANDONED_GAME_RECOVERY_INTERVAL_MINUTES`.

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
  `tournament-stage` in venueThemes.css). Clock: `core/tournamentClock.js` (doubled after the first
  live event: 24 s bid, 16 s trump, 40 s discards, 12 s + 90 s bank per card; pace pressure at
  two-thirds done = free ×2/3, bank drains 2×; absent seat 6 s; playout vote 20 s) drives
  afkTurnTimer for tournament tables. Rounds open in Dealing Pending and the director deals after the round's hold — round one 18–30 s sized to Liam's welcome script (`tournamentWelcome.welcomeHoldFor`), rounds two onward 7.5 s for the ring card and round call, 2.5 s when no voice is wired
  (clients need that transition for the deal animation); one table left reopens the same engine in
  place; voice is one `tournament-<id>` room per event (socketActionGuard + TournamentVoiceDock);
  chip drain `tournaments.drain_percent` (Off/5/10/20, default 10) drops every live stack by that much between
  rounds, rounded up, before busts — but never a player's last point (`_applyDrain` floors the stack at 1: the
  drain squeezes, only the table eliminates; Matt, Sept 17) (rounds play at even stakes; the escalation multiplier was retired the same
  day because it muddied the insurance math); watchers (tournamentWatch) sit as hand-hidden spectators at a
  table still playing until the room reseats; board delay 8 s with a countdown. Deploy survival:
  `tournament_snapshots` (director.snapshotForShutdown on SIGTERM, restoreSnapshots at boot + sweep;
  a running tournament with no snapshot is voided after a 10-min grace); `npm run deploy:check` blocks
  on running tournaments with humans. Record: `tournament_results` → GET /api/tournaments/scoreboard
  (ranked by winnings = sum of prizes, never reduced) and /recent (podiums), the Tournaments panel in
  LeaderboardView, `tournaments` on the player profile, ledger category 'tournament'. Tournaments never
  touch wins/losses/washes. Spec: the tournament whiteboard artifact (see memory).
- Voted point drain — "Speed up the game" (Sept 17 2026): a normal table can vote in what tournaments get
  from the director. `core/pointDrain.js` is the one rule for both (`drainDrop`: the percentage, rounded UP,
  never a LAST point; options 5 / 7.5 / 10 / 15 / 20, 10 recommended — the tournament's own Off/5/10/20 host
  setting is unchanged). `GameEngine.proposePointDrain(userId, percent)` / `submitDrainVote(userId, 'yes'|'no')`
  (socket events `proposePointDrain`, `submitDrainVote`; `pointDrainProposalError` is the single source of "why
  not", used by the socket validator too): any held seat of a started non-tournament game, during play or
  between rounds, while no draw / playout / drain vote is open; one proposal per player per round; percent 0
  ("stop") only while a drain runs. EVERY seat that is there must say yes within 30 s — one no or silence
  leaves things as they are; a seat whose player is disconnected is not asked (the rematch offer's rule), so a
  table waiting on a dropped player can still speed up. **The vote never stops play**: no state change, one
  `setTimeout` and an `endsAt` the client counts down from (not the draw vote's per-second broadcast), and
  house seats answer yes on a human pause from `GameService._scheduleBotDrainVotes` (not the bot trigger,
  which stands down while a bot card is pending). An agreed drain lands in `requestNextRound` — after a SCORED
  round only, as the next one is dealt (`_applyPointDrain`; all-pass redeals cost nothing; the sitting-out
  dealer drops too, the absorber never) — so the round summary's score ceremony stays true and the drain can
  never end a game. `pointDrain = { percent, par, last }`: `par` is what an untouched 120 is worth now, and
  the split draw pays the low seat against it (`scorePar` in the settlement snapshot, `gameSettlement.
  buildDrawSettlement`) instead of a flat 120; `last` = the drops just taken, for the client's notice. Per game
  (reset on start / rematch), carried across deploys (`gameResume` COPY_FIELDS; an open vote is not). Client:
  `components/game/PointDrainVote.js` (a DOCKED card under the header, never a modal — full card until you
  answer, a slim strip after, then the outcome, then each round's drops) and `PointDrainSheet.js` (game menu →
  "Speed up the game"); preview `/harness.html?mode=3&drain=vote|waiting|agreed|declined|notice|active` and
  `?mode=drainsheet[&active=10]`. Measured on 300 simulated games a setting: mean rounds 7.7 → 6.4 / 5.8 / 5.5 /
  5.1 / 4.8, 90th percentile 15 → 11 / 10 / 9 / 8 / 7 — it mostly cuts the marathons. Tests:
  `tests/pointDrain.test.js`, `PointDrainVote.test.js`.
- Bot insurance (Aug 2026): `backend/src/core/bot-strategies/MarketInsuranceStrategy.js` prices
  asks/offers from a Monte Carlo rollout (`RolloutEstimator.js`) over public information only
  (`PublicRoundView.js` is the enforced no-cheating boundary — see `tests/marketInsurance.test.js`).
  `INSURANCE_STRATEGY=legacy` reverts to `AdaptiveInsuranceStrategy`, which is also the on-error fallback.
  **Pricing rule (Sept 17 2026): `informed`, in `bot-strategies/insurancePricing.js`** (pure; shared by the
  live strategy and the harness). The Aug rule priced the ROUND (certainty equivalent ± a decaying margin) and
  lost to the PERSON: in human games humans took 13.1 pts a deal off the bots, because a human knows their own
  hand and only accepts a quote that is wrong in their favour (a failing human bidder escaped for 5×m where the
  cards cost 35×m; a bot bidder sold a winner for 20 where cards paid 35). `informedQuote` posts the quote that
  earns the most GIVEN that the other side only accepts what is good for them — so a winning bot bidder does
  not sell, a failing bidder must pay the defenders their card value plus a slice of the absorber's share.
  **A price on the table, to the last card (same day, two steps):** the first live game under that rule had
  Matt making a Heart Solo while both bot defenders sat at the default for seven tricks ("bots not playing
  insurance at all") — right, and no fun. Then Matt on the first fix: "I don't want them to withdraw their bid…
  they should just keep a small margin… closer to the end it should dial in closer and closer… okay if they
  leak some points." So a bot now (1) always shows the friendliest price it can afford (`lossBudget` 0.25×m of
  expected loss per card state against someone who KNOWS the result); (2) backs it off by a margin sized to
  what is still unknown (`safetyPerSd` 0.7 × the estimate's spread per share: ~12 at the deal, a point or two
  by the last tricks, zero on a decided hand — a midnight-special Frog with 35 banked against it asks exactly
  50); (3) never quotes past what the banked points allow (`bounds`: defenders on 50 → a Frog bidder cannot
  ask more than 20); (4) assumes the other side needs a reason to say yes (`entice` 2×m — the bidder going
  down 10 offers −26, not −20, so all three gain); (5) quotes to the LAST card, re-priced on every card (moves
  under a quarter of the margin, max 3×m, are not sent). Only a price off the scale sits at the default — and a
  defender at −60×m is usually demanding the cap, not silent. Unseen 3,300 rounds, bots per 100 rounds vs the
  harness adversary (25%/50%/oracle; striking at +3): this rule +18/+9/+16 with a deal struck in 44% of rounds
  (57% vs an eager +1 adversary, bots +31/+26/+45); entice 1 +77 (21%); entice 3 −99 (55%); the first fix (flat
  margin 12, down at trick 10) +29 (6%); Aug rule −533 (54%). Tried and dropped: a budget that grows late
  (−180 to −300: late is when the other side knows most). Table feel: a bidder who makes it sees the two
  offers ~110 per 1x under the card value at the deal, 66 by tricks 6–7, 40 by 8–9, 9 on the last trick; a bot
  bidder asks its fair value from trick 8. `INSURANCE_ALWAYS_QUOTE=false` = quote only what it wants.
  **The estimate it prices from** (`insurancePricing.INFORMED_VIEW` / `INFORMED_ESTIMATE`, informed rule only):
  `unbiasedDeal` + `exactTricks: 3`. `RolloutEstimator.dealHands` had a void-order bias — an unweighted seat
  takes the FRONT of what is left, which after an earlier seat is "cards that seat could hold, then cards its
  voids refused", so the second seat almost never got a card in a suit the first is void in (exactly where
  those cards are) and they fell to the widow; a bidder on the last trick "knew" in 160 worlds of 160 the jack
  of trump was not out. `view.unbiasedDeal` reshuffles before every zone. **It is OFF for the raven brains and
  the market rule — measured, not pending:** raven-1.2 with it vs without (search-brain profile option
  `unbiasedDeal`), 48,000 paired rounds over four tables: defending +0.11 ±0.06 / +0.12 ±0.06 (the bidder takes
  a shade more; Heart Solo +0.64 ±0.22), bidding +0.18 ±0.07 — a wash. The search barely meets the bias: it
  bites only when a seat is dealt with no weight function after a seat with a void, and the played-low floors
  weight nearly every seat (3–5% of a search brain's decisions exposed vs 31–54% for the insurance estimator,
  which has no floors). Don't chase it again. The last three tricks
  are solved per world with `ravenSearch.solveExact` instead of played out. Correction table
  (`ESTIMATOR_CORRECTION`, re-measured on every card state of 4,500 rounds, columns 0-1/2-3/4-5/6-7/8/9/10):
  a defender's view underrates the bidder by 3–10 pts early, fading to 0; mid-round both seats are 4–9 pts
  overconfident. Whole points, no steps of five. `GameService` re-quotes during
  `TrickCompleteLinger` too and lands any move that TIGHTENS a quote at once (only loosening waits out the
  human-like pause). All 20 bots share this logic — brains differ in card play only. Harness:
  `scripts/simulate-insurance.js record|analyze [--threshold=N] [--rules=file]` (an adversary who strikes
  whenever a deal suits them; records every card state with `q` = Aug estimator, `qn` = informed estimator,
  `bp`/`dp` = banked points; default rules = the live rule and its ablations). Rollback:
  `INSURANCE_PRICING=market`. Wrapped-early rounds are never logged to `round_results`, so every logged deal is
  one a human voted to play out.
  **Nobody may offer more insurance points than they hold (Sept 17 2026):** the most a seat can put up is
  every point but its last — `core/insuranceLimits.js`, one pure rule shared by `GameEngine.
  updateInsuranceSetting` (humans and bots, regular and tournament tables: the score IS the stack), the market
  strategy, and `GameService._withinInsuranceLimits` (holds the legacy fallback strategy to it and stops a bot
  at its limit from re-submitting every tick). "Offering" is the PAYING direction of each control — a
  defender's positive offer, a bidder's NEGATIVE ask; receiving is never stack-limited. A value past the limit
  is pulled back to it (a value outside ±60×m / ±120×m is still ignored). The client state carries
  `insurance.limits[name] = {min, max}` so the stepper, quick picks and prompt stop there; preview with
  `/harness.html?mode=insurance&stack=13[&role=bidder]`.
- Search brains (Sept 2026): `bot-brains/ravenBrain.js` exports `createSearchBrain(profile)` — raven is the
  empty profile, and `ravenNextBrain.js` holds **raven-1.1 / raven-1.2** — raven with a repaired defense, same
  offense card for card. **raven-1.2 plays Grandpa George and Courtney M. since Sept 17 2026** (Matt's call;
  raven and raven-1.1 stay registered for the simulators and as a one-line rollback in `BRAIN_PROFILES`;
  `tests/ravenNext.test.js` pins the seats). Proven on 25,581 paired rounds: −0.25 ±0.05 pts/round conceded
  (z −5.2), and 44.9% vs raven's 43.1% in the five-brain round robin.
  They exist because the raven seats led 10s under unplayed aces: the search was sound but the shared world
  sampler believed a Frog bidder buries ACES (weight `1 + points/2`; truth over 8,264 Frog rounds: never).
  Opt-in sampler repairs, all off for raven and the insurance market: `frogBuryModel: 'calibrated'` and
  `keyCardModel: 'calibrated'` (`RolloutEstimator.placeKeyCards` + the measured `keyCardTable.json`: a
  defender's unseen Aces/10s go to bidder / partner / buried by odds keyed on public facts only — bid type,
  trump or side, is the 10's ace gone, `PublicRoundView.suitLeads`, round phase). Decision opt-ins:
  `tenLeadGuard` (a defender may not lead a 10 under an unaccounted ace when the bidder holds it in more than
  that share of sampled worlds) and `riskAversion` (regret-averse defender score). Tools: `scripts/
  analyze-ten-leads.js` (the behaviour + belief-vs-truth), `calibrate-sampler.js` (regenerates the table;
  WHO plays matters — strong bidders sit on aces, so it is fitted on a mixed raven/sphinx/counting/flytrap
  table), `simulate-defense.js --json` + `compare-defense.js` (paired diff ±SE on identical deals, `--by-bid`,
  pooled seeds), and `LAB_PROFILE='{...}'` for an ad-hoc search brain `lab` in any simulator. Paired runs need
  `RAVEN_TIME_MS=1000000` — the 90 ms wall-clock guard makes a loaded machine non-deterministic. Do NOT "fix"
  the market's Frog prior in isolation: the market under-estimates bidders everywhere and that prior masks it.

- Opus 5.5 (Sept 2026): `bot-brains/opusBrain.js` — raven-1.2's card play plus its OWN auction, Solo trump call
  and Frog burial, searched by playing the hand out over random deals of the unseen cards (`opusBidding.js`:
  48 worlds per contract, face-up bias subtracted per bid type from `opusBidCalibration.json`, bid bar −10).
  `BotPlayer` defers decideBid / chooseTrump / decideFrogUpgrade / submitFrogDiscards to a brain that defines
  them — only opus does. **Plays Courtney M. since Sept 24 2026; Grandpa George stays raven-1.2 as the live
  control.** Measured vs raven-1.2 in the same seat, 12,000 fresh paired rounds: +2.6 to +3.8 pts/round
  (`scripts/simulate-seat.js`, the whole-round harness — bids differ, so it pairs the seat's score); round
  robin 50.8% vs 42.6%. Tuned against bots only. Table-reading inference (`playInference.js`, option
  `inference`) is built and OFF: truer beliefs, no better play. Both raven seats' think time runs at
  `botPacing.HUMAN_SPEED` 0.67 since Sept 24 (mean ~2.2 s, median ~1.8 s).

## Conventions
- Game layout sizes in vh/vw only; cards keep 5:7 aspect ratio; header is 7.5vh.
- Positioning uses wrapper components (`docs/PLAYERSEAT_POSITIONING_SYSTEM.md`).
- 4-space indent, single quotes, CommonJS in backend, ESM in frontend.
- **Orientation policy (July 2026)**: mobile portrait is the gold-standard layout. Phone landscape is intentionally blocked by `OrientationScrim` (landscape + coarse pointer + ≤600px tall) and `manifest.json` locks installed PWAs to portrait — don't build phone-landscape layouts. Portrait tablets get the phone layout (wide-mode threshold aspect ≥ 1.25 in `PlayerSeatPositioner.js`); desktop/tablet-landscape geometry is vh-capped via `min()`/`max()` terms that are no-ops on portrait.
- **Layout harness**: `npm run dev` then open `/harness.html?mode=3|4` — renders the real game table with canned state, no backend needed. Use it to screenshot layout changes at any viewport. Add `?turn=1` for a live hand (playCard really moves the card), `?playstyle=flick|fast` to preset the card play style (implies turn), `?volley=1` to have the opponents answer your lead on the bot cadence (their cards fly in from the seats, then linger + magnet, then the lead returns; add `&afk=0` so the AFK backstop doesn't play for you). `?mode=lobby` renders the lobby (three columns at ≥1024 px landscape) with canned venues, private tables and a tournament slot (`?tables=0`, `?tourney=open|running|none`); `?mode=tourney`, `?ringcard=N&players=M&hold=1` and `?tourneyname=…&left=N` cover the tournament screens — the full list is in the `devHarness.jsx` header.

## Known quirks
- **Player name is live game-state identity.** GameEngine keys `scores`, `hands`,
  `capturedTricks`, insurance offers, and every vote map by the name string, and
  there is no re-key path — so renames are refused while seated (`isUserSeatedAnywhere`).
  `game_history.outcome` also stores names as free text, which is why accounts keep
  `previous_usernames` for `gameVoid.js` to match against.
- CORS is pinned to GET and POST (`server.js`), so new mutating routes must be POST.
- **One account, one live client (Sept 2026).** Two signed-in clients on one account used to trade the seat (and the tournament voice room) back and forth forever — one player logged 211 socket swaps in an hour. `backend/src/events/sessionArbiter.js` rules on every socket at the top of the connection handler from two handshake fields sent by `frontend/src/utils/clientSession.js`: `clientId` (per tab, sessionStorage) and `intent`. A **claim** (visible page load, login, the "Play here" button) displaces every other client; a **resume** (every automatic reconnect: Socket.IO's own, the foreground cycle, the seat-reclaim cycle, the version auto-reload) is parked if another client is live, unless it is the owner — the last claimer — back within 2 min (`OWNER_GRACE_MS`), so a phone returning from a blip beats a laptop that woke up. A put-down client gets `sessionDisplaced`, is closed by the server (so Socket.IO does not reconnect), and renders only `SessionScrim` until "Play here"; the parked flag survives reloads. New code that calls `socket.connect()` must respect `sessionDisplacedRef` and must not invent a claim. Displacement runs *after* the new socket holds the seat, because a disconnect before the deal removes the seat. Sockets with no `clientId` (old builds, the test harnesses) keep newest-wins untouched. Watch it with the `[SESSION]` log lines and `funnel_events` names `session_displaced` / `session_parked`; preview the scrim at `/harness.html?mode=session`.
- **VIP = the alpha testers.** `users.is_vip` was TRUE for every account that existed in Sept 2026; the column default is now FALSE, so accounts created from here on are not VIP. VIP-only setting `untimed_bot_games` (in-game menu "Untimed when alone", POST `/api/auth/settings`): no AFK backstop or turn call-up when that player is the only person at the table. Matt does not want that behaviour on release players, and does not want any "one human vs bots" special rules in general, because players must not learn they are playing bots.
- **Card helper vs coaching tips (Sept 2026)**: the point badges (`cardHelperActive()` in `learnerLessons.js`) are ON for everyone unless the menu switch is off. The coaching tips on the felt (`coachTipsActive()`, `LearnerCoach`) are ON only for a NEW player (`isLearner()`, first 3 games) unless their own menu switch is set — on Sept 6 they briefly rode on the helper flag and veterans got the introduction explained to them. `isLearner()` also drives the call-up exemption. A quick tip (`config/tips.js`) tells players where the switches are.
- **Turn pressure timings (Sept 2026)**: call-up at 5.75s / 17.25s (`useTurnNudge.js`), AFK backstop 51.75s (`afkTurnTimer.js`), both the July values relaxed 15%; the opening bid gets a 7s deal allowance so the clock never runs while the cards are still flying out.
- The Vitest suite is fully green as of July 2026 (the old note about 11 stale physics/spacing failures no longer applies) — treat any failure as a real regression.
- `docs/archive/` is historical; don't treat as current.
- Local Python tooling in `tools/legacy-agents/` is unrelated to the app (gitignored).

## Goals (June 2026)
Revive deployment (Render + domain), keep modernizing, then App Store release via a Capacitor wrapper (PWA manifest exists; no service worker or native shell yet).
