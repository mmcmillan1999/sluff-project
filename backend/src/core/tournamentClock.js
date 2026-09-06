'use strict';

// The tournament shot clock (the Sluff Tournament whiteboard, Sept 2026).
//
// A tournament round has to end for every table at about the same time, so
// the 51.75 s per-turn backstop of a cash game gives way to a shot clock:
// every decision gets a short free allowance, and card play draws on a
// personal 45 s bank per round once the free time is gone. When the bank is
// empty the house plays the cheapest legal card, exactly as the backstop
// does today. Human think time is 3.5 s at the median and 10 s at the 90th
// percentile, so a normal round never touches the bank; it exists for the
// two or three genuinely hard tricks a round can contain.
//
// Pace pressure: when most tables have finished, the stragglers go "on the
// clock" — the free allowance shrinks and the bank drains at double speed.
// The director flips the switch (TournamentDirector._applyPacePressure).
//
// The clock lives on the engine as `engine.tournamentClock`, plain JSON so
// it survives a deploy snapshot with the rest of the round.

const { ROUND_PRESENTATION_LOCK_MS } = require('./constants');

// Doubled after the first live tournament (Matt, 6 Sept 2026: "it felt a
// bit too rushed ... allow twice as much time"). The absent-seat clock is
// the one value that stays short.
const TOURNAMENT_CLOCK = Object.freeze({
    freeMs: Object.freeze({
        bid: 24_000,
        upgrade: 24_000,
        trump: 16_000,
        discards: 40_000,
        play: 12_000,
        deal: 12_000,
    }),
    bankMs: 90_000,
    // A seat nobody is sitting in: the house acts after this, not after the
    // bank, so a dropped player cannot hold the room for a minute a card.
    absentMs: 6_000,
    pressure: Object.freeze({ freeScale: 4 / 6, drainRate: 2 }),
    playoutVoteSeconds: 20,
    presentationHoldMs: ROUND_PRESENTATION_LOCK_MS,
    boardDelayMs: 40_000,
    // The round opens on screen before the cards fly, so every client sees
    // the deal animation rather than landing on a dealt table.
    dealDelayMs: 2_500,
    // One table left: the room stays seated and the next round follows the
    // recap after this, with no trip to the board.
    singleTableDelayMs: 4_000,
});

function newRoundClock(userIds, { bankMs = TOURNAMENT_CLOCK.bankMs } = {}) {
    const banks = {};
    for (const userId of userIds) banks[String(userId)] = bankMs;
    return { banks, onTheClock: false, bankMs };
}

function drainRate(clock) {
    return clock?.onTheClock ? TOURNAMENT_CLOCK.pressure.drainRate : 1;
}

function freeMsFor(clock, kind) {
    const base = TOURNAMENT_CLOCK.freeMs[kind] ?? TOURNAMENT_CLOCK.freeMs.play;
    return clock?.onTheClock ? Math.round(base * TOURNAMENT_CLOCK.pressure.freeScale) : base;
}

function bankFor(clock, userId) {
    const value = Number(clock?.banks?.[String(userId)]);
    return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * How long the table waits on this seat before the house acts for it:
 * the decision's free allowance, plus (for card play) whatever is left in
 * the seat's bank at the current drain rate. An absent seat gets the short
 * absent clock instead, unless it was restored from a deploy and its owner
 * is still on the way back.
 */
function allowanceMs(engine, pending) {
    const clock = engine?.tournamentClock || null;
    const kind = pending?.kind || 'play';
    let allowance = freeMsFor(clock, kind);
    if (kind === 'play') allowance += Math.round(bankFor(clock, pending?.userId) / drainRate(clock));
    const player = engine?.players?.[pending?.userId];
    if (player?.disconnected === true && player.resumePending !== true) {
        allowance = Math.min(allowance, TOURNAMENT_CLOCK.absentMs);
    }
    return allowance;
}

/** Charge the seat's bank for a play that ran past the free allowance. */
function chargeBank(engine, userId, elapsedMs) {
    const clock = engine?.tournamentClock;
    const key = String(userId);
    if (!clock?.banks || !(key in clock.banks)) return 0;
    const overage = Math.max(0, Number(elapsedMs) - freeMsFor(clock, 'play'));
    const charge = Math.min(clock.banks[key], Math.round(overage * drainRate(clock)));
    clock.banks[key] -= charge;
    return charge;
}

/** The house played for this seat: whatever bank was left is spent. */
function exhaustBank(engine, userId) {
    const clock = engine?.tournamentClock;
    const key = String(userId);
    if (!clock?.banks || !(key in clock.banks)) return;
    clock.banks[key] = 0;
}

function setOnTheClock(engine, onTheClock) {
    if (!engine?.tournamentClock) return false;
    const next = Boolean(onTheClock);
    const changed = engine.tournamentClock.onTheClock !== next;
    engine.tournamentClock.onTheClock = next;
    return changed;
}

/** What clients see: banks by player name in whole seconds, and the pressure flag. */
function publicClock(engine) {
    const clock = engine?.tournamentClock;
    if (!clock) return null;
    const banks = {};
    for (const [userId, bankMs] of Object.entries(clock.banks || {})) {
        const name = engine.players?.[userId]?.playerName;
        if (name) banks[name] = Math.round(bankMs / 1000);
    }
    return {
        onTheClock: clock.onTheClock === true,
        banks,
        freeSeconds: {
            play: Math.round(freeMsFor(clock, 'play') / 1000),
            bid: Math.round(freeMsFor(clock, 'bid') / 1000),
        },
        bankSeconds: Math.round((clock.bankMs || TOURNAMENT_CLOCK.bankMs) / 1000),
    };
}

module.exports = {
    TOURNAMENT_CLOCK,
    newRoundClock,
    allowanceMs,
    freeMsFor,
    bankFor,
    chargeBank,
    exhaustBank,
    setOnTheClock,
    publicClock,
};
