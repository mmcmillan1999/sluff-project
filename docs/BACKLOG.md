# Backlog

Ideas accepted but not scheduled. Move items out when work starts.

## The Midnight Special 🌙🚂 — v1 SHIPPED Aug 6 2026

**Shipped:** `backend/src/core/midnightSpecial.js` proves the strict claim
(leader wins every remaining trick vs best defense; opponents bled of trump;
run rides a second suit; ≥3 tricks left) after each resolved trick, fires a
`midnightSpecial` table event once per round; the client sweeps a night sky
across the felt with a train and a synthesized two-chime whistle
(`midnightWhistle` in soundSynth.js — no licensing exposure).

**Remaining ideas:** a tolerance knob (fire one guarded-honor early, matching
how the table lore *feels*); swap the synth sting for a real "Midnight
Special" cover if licensing is ever sorted; a podium stat line ("rode the
Midnight Special ×2").

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

- Playout-vote adversarial review (owed since July 27 — see memory).
- Winner and wash podium stings to join the loss sting.
