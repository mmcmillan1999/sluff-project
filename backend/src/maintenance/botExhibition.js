'use strict';

// Bot exhibition: keeps a continuous 3-bot game running on designated lobby
// tables so round_results accumulates bot-vs-bot analytics around the clock.
// A fresh random trio is seated before every game, so individual bots
// naturally end up with very different play volumes over time. The manager
// backs off a table entirely whenever a human takes a seat there and
// reclaims it once they leave. Humans can always spectate.
//
// Two tables run by default (Aug 2026): Fort Creek #10 at 1-token stakes and
// Shirecliff #10 at 5-token stakes. The higher-stakes table is a deliberate
// slow token faucet: losers bust below the 5-token mercy threshold and drip
// back up at +1/hour, while winning bots accumulate meaningful stacks that
// humans can later win from. Seat leases keep one bot from holding chairs at
// both tables at once.
//
// Env configuration (see server.js):
//   BOT_EXHIBITION_ENABLED           default OFF since Sept 2026 ('true' enables);
//                                    bot-only games ran 10:1 against human games
//                                    and inflated the season board
//   BOT_EXHIBITION_TABLE_IDS         comma-separated, default 'table-10,table-20'
//   BOT_EXHIBITION_TABLE_ID          legacy single-table form (still honored)
//   BOT_EXHIBITION_INTERVAL_SECONDS  default 45, minimum 10

const DEFAULT_EXHIBITION_INTERVAL_MS = 45 * 1000;
const MINIMUM_EXHIBITION_INTERVAL_MS = 10 * 1000;
const DEFAULT_EXHIBITION_TABLE_IDS = Object.freeze(['table-10', 'table-20']);

function createBotExhibitionManager({
    gameService,
    tableId = null,
    tableIds = null,
    intervalMs = DEFAULT_EXHIBITION_INTERVAL_MS,
    log = console,
} = {}) {
    if (!gameService) throw new TypeError('createBotExhibitionManager requires gameService.');
    if (!Number.isFinite(intervalMs) || intervalMs < MINIMUM_EXHIBITION_INTERVAL_MS) {
        throw new Error(`Bot exhibition interval must be at least ${MINIMUM_EXHIBITION_INTERVAL_MS}ms.`);
    }
    const tables = Array.isArray(tableIds) && tableIds.length > 0
        ? [...tableIds]
        : (tableId ? [tableId] : [...DEFAULT_EXHIBITION_TABLE_IDS]);

    let timer = null;

    // Each table gets its own containment: a failure on one never blocks the
    // other's tick.
    const runNow = async () => {
        const results = [];
        for (const id of tables) {
            try {
                const result = await gameService.ensureExhibitionGame(id);
                results.push({ tableId: id, ...result });
            } catch (error) {
                log.error(`[EXHIBITION] Tick failed for ${id}: ${error.message}`);
                results.push({ tableId: id, status: 'error', message: error.message });
            }
        }
        return results;
    };

    return {
        tableIds: tables,
        intervalMs,
        runNow,
        start() {
            if (timer) return;
            timer = setInterval(runNow, intervalMs);
            timer.unref?.();
            log.log(`[EXHIBITION] Bot exhibition active on ${tables.join(', ')} (checking every ${Math.round(intervalMs / 1000)}s).`);
        },
        stop() {
            if (timer) clearInterval(timer);
            timer = null;
        },
    };
}

module.exports = {
    createBotExhibitionManager,
    DEFAULT_EXHIBITION_INTERVAL_MS,
    MINIMUM_EXHIBITION_INTERVAL_MS,
    DEFAULT_EXHIBITION_TABLE_IDS,
};
