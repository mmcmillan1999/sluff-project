# Backlog

Ideas accepted but not scheduled. Move items out when work starts.

## New-player teaching — learner mode v1 built Aug 6 2026, follow-ups parked

Adversarial review (agent, Aug 6) found the rank order (10 beats K) was
documented NOWHERE player-facing, card values unlearnable in the moment,
and the TutorialCoach triple-gated so Quick Play novices got nothing.
Shipped v1: `components/game/coach/` — CoachCallout (anchored tips +
pointing hand + spotlight veil), learnerLessons picker, LearnerCoach
(< 3 games, any venue, receipts via /api/tips); card-point badges on card
faces via renderCard (gold A/10, parchment K/Q/J, duds bare); rank-order
sentence added to How to Play.

**Parked follow-ups from the review:**
- The 10-lead interceptor (warn before leading a 10 whose ace is live —
  hooks into fast-lift / flick drag-start; wants careful physics testing).
- Insurance first-touch tour (spotlight the ask row, then the own slider).
- Migrate the Academy TutorialCoach's banner lessons onto CoachCallout
  anchors; extend school past round 1.
- "Card helper" menu toggle (veterans opt in, learners opt out).
- Vocabulary passes: define widow/trump-broken/sluff in-game; label the
  Academy progress bars; give the tips beacon real teaching content.

## In-app purchases — foundation SHIPPED Aug 6 2026, rails pending Matt's accounts

Decision: gear for IAP from the start. First SKU: McMillan Crest deck at
$4.99 (cosmetics are the clean digital good; never sell tokens without
revisiting gambling optics). Built: `player_entitlements` table,
`services/entitlements.js` (idempotent grants, refund revocation),
`core/products.js` catalog (Apple `com.playsluff.deck.mcmillan`, Google
`deck_mcmillan`), `/api/store` (shelf + admin grant/revoke), store UI price
chip. Alpha stays free-to-try; ownership enforcement flips when a purchase
rail exists.

**Blocked on Matt's accounts** (checklist delivered Aug 6): Apple Developer
Program + Paid Apps agreement + Small Business Program; Play Console +
payments profile + 15% tier; privacy/terms pages on playsluff.com.

**Then build, in order:** Capacitor shell (+ Capgo live updates so web pushes
skip store review) → store listings + IAP products → server verification
endpoints in `api/store.js` (App Store Server API + Play Developer API,
funneling into the same entitlement grants) → flip the paywall (grandfather
alpha testers who equipped the McMillan back — Matt's call) → later: Stripe
rail for web sales, AdMob + app-ads.txt if ads ever happen.

## The Midnight Special 🌙🚂 — SHIPPED Aug 6 2026

**Shipped:** `backend/src/core/midnightSpecial.js` proves the strict claim
(leader wins every remaining trick vs best defense; ≥3 tricks left; run rides
a second suit) after each resolved trick, fires a `midnightSpecial` table
event once per round. Defenders may still hold trump — boss-trump extraction
is part of the proof (the Aug 6 rewrite; Matt's Heart Solo pinned it). The
client runs the full production: nightfall, the top-view train looping the
felt with MIDNIGHT/SPECIAL cars, smoke, karaoke chorus lines, a spotlight on
the runner, Matt's temp song clip (`midnight_special_song_v1.mp3`) over a
synthesized horn/chug bed (`midnightSpecialScore`).

**Remaining ideas:** replace the temp song clip when Matt finds a keeper;
a real licensed cover if that ever gets sorted.

### Original notes

**What it is (Matt's decades-old table lore):** the moment a player's *second*
suit becomes unstoppable. The bid winner runs, say, six hearts (trump) and
five spades — once the opponents' trumps are bled dry, the spades might as
well be trump too: holding A-10-J-7-6 over their K-9-7 / Q-8, playing spades
top-down cannot be stopped, and when they run out of spades every remaining
trick feeds the runner. The train has left the station.

**The feature:** *recognize* the phenomenon live and celebrate it — play the
"Midnight Special" song cue with an animation when a player enters an
unstoppable second-suit run.

**Recognition sketch** (all from public info per house rules):
- Trump outstanding (outside the runner's hand) = 0, AND
- the runner holds the top N cards of a side suit such that N ≥ tricks
  remaining, or their side-suit run plus remaining trumps covers every
  remaining trick (a "claim" check: no legal opposing card can win a trick
  before the run ends).
- Trigger once, when the claim first becomes true — ideally as the first
  card of the run hits the felt.
- Server detects (GameEngine has full state), emits a `midnightSpecial`
  event; client plays the song sting + animation (train? moonlit rails?).

**Notes:**
- The counting brain (bot-brains/countingBrain.js, Aug 2026) already plays
  the *mechanics* of this — with trump exhausted it cashes controlled suits
  top-down — so bots will occasionally ride the Midnight Special themselves.
  The backlog item is the *recognition + celebration*, not the play.
- Song licensing: use an original recording/cover or a soundalike sting —
  same caution as all audio (ElevenLabs / synthesized, no sampled masters).

## Parked earlier

- ~~Playout-vote adversarial review~~ — completed Aug 6 2026: all five
  flagged risk areas verified safe (state-guarded timers, executor-routed
  timeout effects, agreement-driven wrap scoring, resume evaporation);
  five adversarial regressions added to `tests/playoutVote.test.js`.
- ~~Winner and wash podium stings~~ — built Aug 6 2026: `podiumWin` greets
  the sole real champion on the podium (forfeit wins and shared victories
  stay quiet); `drawWash` shrugs a settled draw away at DrawComplete. Three
  Liam takes of each await Matt's audition in `frontend/public/Sounds`
  (`podium_win_v*` / `draw_wash_v*`, v1 wired; gitignored — the winners
  need `git add -f`). Generator: `backend/scripts/generate-podium-stings.js`.
- ~~Midnight Special podium stat~~ — built Aug 6 2026: the rider is stamped
  onto each round-history entry; the podium tallies rides per player (🚂 ×N
  under the score) and marks ridden rounds in the round-by-round table.
