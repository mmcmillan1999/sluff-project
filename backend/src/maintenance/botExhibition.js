'use strict';

// Bot exhibition: keeps one continuous 3-bot game running on a designated
// lobby table so round_results accumulates bot-vs-bot analytics around the
// clock. A fresh random trio is seated before every game, so individual
// bots naturally end up with very different play volumes over time. The
// manager backs off entirely whenever a human takes a seat at the table
// and reclaims it once they leave. Humans can always spectate.
//
// Env configuration (see server.js):
//   BOT_EXHIBITION_ENABLED           default true ('false' disables)
//   BOT_EXHIBITION_TABLE_ID          default 'table-10' (Fort Creek #10)
//   BOT_EXHIBITION_INTERVAL_SECONDS  default 45, minimum 10

const DEFAULT_EXHIBITION_INTERVAL_MS = 45 * 1000;
const MINIMUM_EXHIBITION_INTERVAL_MS = 10 * 1000;

function createBotExhibitionManager({
    gameService,
    tableId = 'table-10',
    intervalMs = DEFAULT_EXHIBITION_INTERVAL_MS,
    log = console,
} = {}) {
    if (!gameService) throw new TypeError('createBotExhibitionManager requires gameService.');
    if (!Number.isFinite(intervalMs) || intervalMs < MINIMUM_EXHIBITION_INTERVAL_MS) {
        throw new Error(`Bot exhibition interval must be at least ${MINIMUM_EXHIBITION_INTERVAL_MS}ms.`);
    }

    let timer = null;

    const runNow = async () => {
        try {
            return await gameService.ensureExhibitionGame(tableId);
        } catch (error) {
            log.error(`[EXHIBITION] Tick failed for ${tableId}: ${error.message}`);
            return { status: 'error', message: error.message };
        }
    };

    return {
        tableId,
        intervalMs,
        runNow,
        start() {
            if (timer) return;
            timer = setInterval(runNow, intervalMs);
            timer.unref?.();
            log.log(`[EXHIBITION] Bot exhibition active on ${tableId} (checking every ${Math.round(intervalMs / 1000)}s).`);
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
};
