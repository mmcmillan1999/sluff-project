# Sluff Game Design Review — Fun & Engagement Audit (June 2026)

*Produced by a game-design review agent that read the actual engine, handlers, economy, and frontend flow. Verified against code; file citations throughout.*

## Ground truth from the code

- **Rules as implemented:** 3 active players + ScoreAbsorber/dealer-out, bids Frog(1x)/Solo(2x)/Heart Solo(3x), 60-point break-even, exchange = |bidderPoints − 60| × multiplier × opponents (`backend/src/core/logic.js`, `handlers/biddingHandler.js`). Trick linger is 1000ms; bots act in 1000–2400ms; **between rounds the dealer-bot waits 8000–16000ms** before triggering the next deal (`backend/src/services/GameService.js`).
- **Insurance (3-player only):** bidder sets a requirement (default 120×mult), defenders set offers (default −60×mult); the deal auto-executes the instant `sum(offers) ≥ requirement` and replaces normal scoring; a "hindsight" calc later shows who saved/wasted points (`GameEngine.js` ~lines 367–522, `logic.js` 310–376).
- **Economy:** buy-ins 0.1/1/5/20 tokens by table theme; winner gets 2× buy-in, second ("wash") gets buy-in back, loser gets nothing; mercy token = 1 token when balance < 5, max 1/hour, after a 15-second "ad watch" (`backend/src/data/transactionManager.js`, `frontend/src/components/MercyWindow.js`). **No daily bonus, no streaks, no achievements anywhere in the codebase.**
- **Onboarding:** none. No rules screen, no tutorial, no tooltips beyond the insurance slider labels and draw-vote hover text. The lobby Bulletin is alpha-test release notes only. The only rules artifact is `CardValueKey.js` (card point values), buried in the in-game UI.
- **Verified bugs/landmines:**
  - `_resolveForfeit()` in `GameEngine.js` (line ~493) just sets `state = "Game Over"` — **no payout is computed; a forfeit eats the pot.**
  - `aiService.js` insurance/bid system prompts teach every LLM bot **inverted multipliers** ("Solo=1x, Frog=2x" — the inverse of `constants.js` Frog=1, Solo=2), call Frog the "higher bid," and misdescribe the insurance deal as conditional on the bidder winning (it's an unconditional lock-in once executed).

## TOP 5 RECOMMENDATIONS

### 1. Build the onboarding funnel: interactive "first hand" tutorial + always-available rules reference — Effort: M
A 3-minute scripted first round vs. bots (forced hand, guided bid, guided trick, one guided insurance adjustment), plus a persistent "?" rules drawer reachable from lobby and table. Sluff/Frog is obscure even among card players; every confused first-session player is a churned player. `RoundSummaryModal.js` already renders the scoring math ("Δ60: 15 pts × 2x (Solo) = 30 pts") — the teaching content exists, it's just shown *after* the player needed it.

### 2. Fix the insurance mechanic's legibility — for humans AND bots — Effort: S/M
(a) Rewrite the `aiService.js` insurance/bid system prompts (inverted multipliers, wrong bid ranking, wrong deal semantics). (b) In `InsuranceControls.js`, replace the unlabeled compact numbers with one plain-English line: "Deal gap: 35 — if defenders give 35 more, the round locks in: you get +120." (c) In `InsurancePrompt.js`, add one sentence of *why*: "Insurance lets you cash out before the cards decide." Insurance is Sluff's signature mechanic and it's currently illegible at both ends — bad bot offers built on wrong math make the negotiation feel random.

### 3. Kill the dead air: tighten inter-round pacing and add a turn timer — Effort: S
(a) Cut the bot dealer's round-end delay in `GameService.js` from 8000–16000ms to ~3000ms, or gate the next deal on the human dismissing the round summary. (b) Add a soft turn timer (30–45s with countdown, then auto-pass/auto-play) — currently **no timer exists**, so one AFK player freezes the table indefinitely. (c) Fix `_resolveForfeit()` so the abandoned pot pays out to remaining players.

### 4. Add a daily return loop: login bonus + streak — Effort: M
Daily login grant (1 token, escalating 1/1/2/2/3 with consecutive days) shown as a streak calendar in the lobby; optionally "first win of the day." The transaction infrastructure already exists in `transactionManager.js` — this is one new transaction type plus a lobby modal. Currently the only return hook is the mercy token, which is a poverty mechanic, not a retention mechanic.

### 5. Promote the LLM bots from hidden plumbing to the headline solo feature — Effort: M
(a) Surface bot reasoning to players post-round (speech-bubble snippets) — `SuperBot.js` already produces reasoning strings; `BotInsuranceStats.js` already renders decision history but is admin-locked. (b) Make model/personality selection player-facing — `SuperBotModal.js` with 9 models exists but isn't reachable by regular players. (c) Lean into bot personas. "Play cards against GPT-5.5 vs Claude vs Gemini and see them explain their reasoning" is a marketable hook — arguably stronger than the card game itself for App Store positioning.

## SMALLER WINS

1. Show buy-in cost and payout structure on the table card before joining (`LobbyTableCard`).
2. Add a trick counter and running point estimate to the table HUD — `bidderCardPoints` is already in the game state payload ("Trick 7/13 — Bidder: 41/60").
3. Table-scoped quick chat / emotes — 4–6 canned phrases; only global lobby chat exists.
4. Make spectating non-admin — the 👁️ button in `LobbyView.js` is admin-gated; friends watching friends is free top-of-funnel.
5. Celebrate the win — confetti/sound/podium on "Game Over"; `useSounds.js` has the plumbing.
6. Clickable player profiles from the leaderboard (record, favorite bid, biggest pot).
7. Explain the seat pucks — "D" dealer puck and trump/bid puck have no legend; one tooltip each.
8. Surface the insurance "hindsight" stat per-player over time — lifetime "insurance IQ: +340 pts saved" is a free, unique bragging metric (`logic.js` 310–376 computes it every round).
9. Mobile-detect the desktop-only stats sidebar in `LobbyView.js` — invisible to the mobile audience.
10. Annotate bid buttons with multipliers — "Frog (1×)" / "Solo (2×)" / "Heart Solo (3×)" in `ActionControls.js`.

## WHAT'S ALREADY WORKING — DO NOT TOUCH

1. **RoundSummaryModal's scoring transparency** — the bidder/defender point bar, explicit "Δ60 × multiplier" formula, and insurance hindsight narrative are best-in-class for a scoring system this gnarly. Build the tutorial *around* it.
2. **The core scoring/insurance math in the engine** — correctly implemented, creates real tension. The problem is presentation and AI prompts, never the rules.
3. **Tactile game feel** — card physics, 1-second trick linger, turn-alert/trick-win sounds, trump-broken announcement, and the "no peeking, cheater!" sound. That charm makes a friends-and-family game feel handmade.

**If you do only two things:** fix the `aiService.js` insurance prompt (hours, and the bots stop playing a different game than the engine) and build the first-hand tutorial (the gate every future player must pass through).
