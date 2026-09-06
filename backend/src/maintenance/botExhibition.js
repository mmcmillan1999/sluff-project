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
// Funding gate (Matt, Sept 6 2026). Left to itself the exhibition played ten
// bot-only games for every human one and the richest bots ran away with the
// season board. Its real job is to keep a few bots rich enough for humans to
// play against on the high tables, so it is now a thermostat: no new bot game
// starts while the richest TOP_BOTS bots together hold more than CAP tokens,
// and the loop resumes once humans have won enough of that back. A game that
// is already running is never cut short; the check is only ever made before a
// start. Loose at the edges by design.
//
// Env configuration (see server.js):
//   BOT_EXHIBITION_ENABLED               default true ('false' is the kill switch)
//   BOT_EXHIBITION_TABLE_IDS             comma-separated, default 'table-10,table-20'
//   BOT_EXHIBITION_TABLE_ID              legacy single-table form (still honored)
//   BOT_EXHIBITION_INTERVAL_SECONDS      default 45, minimum 10
//   BOT_EXHIBITION_TOP_BOTS              default 3: how many of the richest bots count
//   BOT_EXHIBITION_TOP_BOTS_CAP_TOKENS   default 100: pause while they hold more than this

const DEFAULT_EXHIBITION_INTERVAL_MS = 45 * 1000;
const MINIMUM_EXHIBITION_INTERVAL_MS = 10 * 1000;
const DEFAULT_EXHIBITION_TABLE_IDS = Object.freeze(['table-10', 'table-20']);
const DEFAULT_EXHIBITION_FUNDING_GATE = Object.freeze({ topBots: 3, capTokens: 100 });

function normalizeFundingGate(gate) {
    const topBots = Number(gate?.topBots);
    const capTokens = Number(gate?.capTokens);
    if (!Number.isInteger(topBots) || topBots < 1) {
        throw new Error('Bot exhibition funding gate: topBots must be a whole number of at least 1.');
    }
    if (!Number.isFinite(capTokens) || capTokens < 0) {
        throw new Error('Bot exhibition funding gate: capTokens must be a number of at least 0.');
    }
    return { topBots, capTokens };
}

/**
 * Should the exhibition hold off starting a game? `balances` is a Map of
 * bot id -> wallet tokens (every bot, not just the affordable ones). The
 * richest `topBots` are summed; over the cap means paused. Unknown balances
 * (no bot roster, as in unit engines) never block: `known` is false and the
 * verdict is "not paused".
 */
function evaluateExhibitionFundingGate(balances, gate = DEFAULT_EXHIBITION_FUNDING_GATE) {
    const { topBots, capTokens } = normalizeFundingGate(gate);
    if (!(balances instanceof Map)) {
        return { known: false, paused: false, total: 0, richest: [], topBots, capTokens };
    }
    const richest = [...balances.entries()]
        .map(([botId, tokens]) => ({ botId, tokens: Number.isFinite(Number(tokens)) ? Number(tokens) : 0 }))
        .sort((left, right) => right.tokens - left.tokens)
        .slice(0, topBots);
    const total = Math.round(richest.reduce((sum, bot) => sum + bot.tokens, 0) * 100) / 100;
    return { known: true, paused: total > capTokens, total, richest, topBots, capTokens };
}

function createBotExhibitionManager({
    gameService,
    tableId = null,
    tableIds = null,
    intervalMs = DEFAULT_EXHIBITION_INTERVAL_MS,
    fundingGate = DEFAULT_EXHIBITION_FUNDING_GATE,
    log = console,
} = {}) {
    if (!gameService) throw new TypeError('createBotExhibitionManager requires gameService.');
    if (!Number.isFinite(intervalMs) || intervalMs < MINIMUM_EXHIBITION_INTERVAL_MS) {
        throw new Error(`Bot exhibition interval must be at least ${MINIMUM_EXHIBITION_INTERVAL_MS}ms.`);
    }
    const gate = normalizeFundingGate(fundingGate);
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
                const result = await gameService.ensureExhibitionGame(id, { fundingGate: gate });
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
        fundingGate: gate,
        runNow,
        start() {
            if (timer) return;
            timer = setInterval(runNow, intervalMs);
            timer.unref?.();
            log.log(`[EXHIBITION] Bot exhibition active on ${tables.join(', ')} (checking every ${Math.round(intervalMs / 1000)}s; runs only while the top ${gate.topBots} bots hold at most ${gate.capTokens} tokens between them).`);
        },
        stop() {
            if (timer) clearInterval(timer);
            timer = null;
        },
    };
}

module.exports = {
    createBotExhibitionManager,
    evaluateExhibitionFundingGate,
    DEFAULT_EXHIBITION_FUNDING_GATE,
    DEFAULT_EXHIBITION_INTERVAL_MS,
    MINIMUM_EXHIBITION_INTERVAL_MS,
    DEFAULT_EXHIBITION_TABLE_IDS,
};
