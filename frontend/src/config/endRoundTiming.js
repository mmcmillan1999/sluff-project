// frontend/src/config/endRoundTiming.js
//
// Timing for the trick magnet + end-of-round celebration. Shared so the
// animations in TableLayout and the recap-modal delay in GameTableView stay in
// lockstep.
//
// End-of-round timeline (ms, from when the round-end state arrives):
//   0      final trick cards magnet onto the winning pile, then fade in
//   2000   "WIDOW REVEAL!" banner + drumroll begin
//   3500   widow cards fly (face-down) from the widow pile to center
//   4500   widow cards held face-down in center (drumroll anticipation)
//   6500   widow cards flip face-up + round-end fanfare plays
//   8200   widow cards fly to the awarded team's pile
//   9200   recap modal appears

export const FINAL_TRICK_HOLD_MS = 630;   // hold before a completed trick flies
export const FINAL_TRICK_FLY_MS = 1200;   // trick fly duration

export const BANNER_START_MS = 2000;      // WIDOW REVEAL banner + drumroll start
export const BANNER_DURATION_MS = 1500;   // how long the banner stays up

export const WIDOW_TO_CENTER_START_MS = 3500; // widow overlay mounts + flies to center
export const WIDOW_TO_CENTER_MS = 1000;       // widow pile -> center fly duration
export const WIDOW_ANTICIPATION_MS = 2000;    // face-down hold in center (the dramatic +2s)
export const WIDOW_FLIP_MS = 500;             // face-down -> face-up flip duration
export const WIDOW_REVEALED_HOLD_MS = 1200;   // hold revealed before flying to pile
export const WIDOW_TO_PILE_MS = 1000;         // center -> awarded pile fly duration

// When the cards flip face-up (and the fanfare plays), from round-end.
export const WIDOW_FLIP_START_MS = WIDOW_TO_CENTER_START_MS + WIDOW_TO_CENTER_MS + WIDOW_ANTICIPATION_MS; // 6500

// When the widow cards leave center for the awarded pile, from round-end.
export const WIDOW_TO_PILE_START_MS = WIDOW_FLIP_START_MS + WIDOW_FLIP_MS + WIDOW_REVEALED_HOLD_MS; // 8200

// Delay (from when the overlay mounts) before the widow flies to the pile.
export const WIDOW_OVERLAY_TO_PILE_MS = WIDOW_TO_CENTER_MS + WIDOW_ANTICIPATION_MS + WIDOW_FLIP_MS + WIDOW_REVEALED_HOLD_MS; // 4700

// Total before the recap modal is allowed to appear.
export const END_ROUND_TOTAL_MS = WIDOW_TO_PILE_START_MS + WIDOW_TO_PILE_MS; // 9200

// Once score counting finishes, keep the settled recap visible long enough
// for players to read and absorb every new total before the table advances.
export const SETTLED_RECAP_HOLD_MS = 5000;
