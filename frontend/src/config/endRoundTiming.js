// frontend/src/config/endRoundTiming.js
//
// Timing for the trick magnet + end-of-round celebration. Shared so the
// animations in TableLayout and the recap-modal delay in GameTableView stay in
// lockstep.
//
// Per-trick magnet (used every trick, incl. the final one):
//   hold the cards, then fly them onto the winning pile.
//
// End-of-round timeline (ms, from when the round-end state arrives):
//   0      final trick cards magnet onto the winning pile
//   2000   "WIDOW REVEAL!" banner appears
//   3500   banner clears; widow cards magnet from the widow pile to center
//   4500   widow cards held in the center
//   6000   widow cards fly to the awarded team's pile
//   7000   recap modal appears

export const FINAL_TRICK_HOLD_MS = 630;   // hold before a completed trick flies
export const FINAL_TRICK_FLY_MS = 1200;   // trick fly duration

export const BANNER_START_MS = 2000;      // when the WIDOW REVEAL banner shows
export const BANNER_DURATION_MS = 1500;   // how long the banner stays up

export const WIDOW_TO_CENTER_START_MS = BANNER_START_MS + BANNER_DURATION_MS; // 3500
export const WIDOW_TO_CENTER_MS = 1000;   // widow pile -> center fly duration

export const WIDOW_HOLD_START_MS = WIDOW_TO_CENTER_START_MS + WIDOW_TO_CENTER_MS; // 4500
export const WIDOW_HOLD_MS = 1500;        // held in center (per spec)

export const WIDOW_TO_PILE_START_MS = WIDOW_HOLD_START_MS + WIDOW_HOLD_MS; // 6000
export const WIDOW_TO_PILE_MS = 1000;     // center -> awarded pile fly duration

// Total before the recap modal is allowed to appear.
export const END_ROUND_TOTAL_MS = WIDOW_TO_PILE_START_MS + WIDOW_TO_PILE_MS; // 7000
