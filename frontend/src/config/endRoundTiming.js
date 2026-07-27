// frontend/src/config/endRoundTiming.js
//
// Timing for the trick magnet + end-of-round celebration. Shared so the
// animations in TableLayout and the recap-modal delay in GameTableView stay in
// lockstep.
//
// End-of-round timeline (ms, from when the round-end state arrives). The reveal
// itself (drumroll -> flip -> hand off to the pile) was halved: it used to run
// 2000 -> 9200 and now runs 2000 -> 5600. The trick magnet ahead of it is
// unchanged because it also drives every mid-round trick.
//   0      final trick cards magnet onto the winning pile, then fade in
//   2000   drumroll begins
//   2750   widow cards fly (face-down) from the widow pile to center
//   3250   widow cards held face-down in center (drumroll anticipation)
//   4250   widow cards flip face-up + round-end fanfare plays
//   5100   widow cards fly to the awarded team's pile
//   5600   recap modal appears

export const FINAL_TRICK_HOLD_MS = 630;   // hold before a completed trick flies
export const FINAL_TRICK_FLY_MS = 1200;   // trick fly duration

export const BANNER_START_MS = 2000;      // WIDOW REVEAL banner + drumroll start
export const BANNER_DURATION_MS = 750;    // how long the banner stays up

export const WIDOW_TO_CENTER_START_MS = 2750; // widow overlay mounts + flies to center
export const WIDOW_TO_CENTER_MS = 500;        // widow pile -> center fly duration
export const WIDOW_ANTICIPATION_MS = 1000;    // face-down hold in center (the dramatic beat)
export const WIDOW_FLIP_MS = 250;             // face-down -> face-up flip duration
export const WIDOW_REVEALED_HOLD_MS = 600;    // hold revealed before flying to pile
export const WIDOW_TO_PILE_MS = 500;          // center -> awarded pile fly duration

// When the cards flip face-up (and the fanfare plays), from round-end.
export const WIDOW_FLIP_START_MS = WIDOW_TO_CENTER_START_MS + WIDOW_TO_CENTER_MS + WIDOW_ANTICIPATION_MS; // 4250

// The drumroll clip is longer than the shortened window, so we play only its
// final slice — the build still crests exactly on the flip instead of running
// over the fanfare.
export const DRUMROLL_TAIL_MS = WIDOW_FLIP_START_MS - BANNER_START_MS; // 2250

// When the widow cards leave center for the awarded pile, from round-end.
export const WIDOW_TO_PILE_START_MS = WIDOW_FLIP_START_MS + WIDOW_FLIP_MS + WIDOW_REVEALED_HOLD_MS; // 5100

// Delay (from when the overlay mounts) before the widow flies to the pile.
export const WIDOW_OVERLAY_TO_PILE_MS = WIDOW_TO_CENTER_MS + WIDOW_ANTICIPATION_MS + WIDOW_FLIP_MS + WIDOW_REVEALED_HOLD_MS; // 2350

// Total before the recap modal is allowed to appear.
export const END_ROUND_TOTAL_MS = WIDOW_TO_PILE_START_MS + WIDOW_TO_PILE_MS; // 5600

// Players get ten seconds to study the recap before score counting begins.
// They may add four ten-second extensions, capping this reading window at 50s.
export const ROUND_RECAP_ACTION_MS = 10_000;
export const ROUND_RECAP_EXTENSION_MS = 10_000;
export const ROUND_RECAP_MAX_EXTENSIONS = 4;

// Once score counting finishes, keep the settled recap visible long enough
// for players to read and absorb every new total before the table advances.
export const SETTLED_RECAP_HOLD_MS = 5000;
