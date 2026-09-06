'use strict';

// Persistence for tournaments: registrations, buy-ins and refunds, round
// records, results and prizes. Two implementations of one interface — the
// in-memory store drives the tests and the headless simulator, the Postgres
// store is production. All money is integer cents at this boundary; the
// ledger's DECIMAL(10,2) tokens are converted at the SQL edge.

const { loadBotBalances } = require('../data/botAccounts');

const TOURNAMENT_STATUSES = Object.freeze(['registering', 'running', 'complete', 'cancelled', 'voided']);

function insufficientTokens(username) {
    const error = new Error(`${username} has insufficient tokens for this buy-in.`);
    error.code = 'INSUFFICIENT_TOKENS';
    return error;
}

function tokens(cents) {
    return (cents / 100).toFixed(2);
}

function toCents(value) {
    return Math.round(Number(value || 0) * 100);
}

// ----------------------------------------------------------------------------
// In-memory store
// ----------------------------------------------------------------------------

function createMemoryStore({ seasonId = 1, balances = {} } = {}) {
    const state = {
        nextTournamentId: 1,
        nextEntryId: 1,
        tournaments: new Map(),
        entries: [],
        rounds: [],
        results: [],
        transactions: [],
        snapshots: new Map(),
        balances: new Map(Object.entries(balances).map(([id, cents]) => [Number(id), Number(cents)])),
    };
    const balanceOf = userId => state.balances.get(Number(userId)) || 0;
    const post = ({ userId, tournamentId, type, cents, description }) => {
        state.transactions.push({ userId, tournamentId, type, cents, description });
        state.balances.set(Number(userId), balanceOf(userId) + cents);
    };
    const entryFor = (tournamentId, userId) => state.entries.find(entry => (
        entry.tournamentId === tournamentId && entry.userId === Number(userId)
    ));

    return {
        kind: 'memory',
        state,
        setBalance(userId, cents) { state.balances.set(Number(userId), Number(cents)); },
        balanceOf,

        async createTournament(fields) {
            const tournamentId = state.nextTournamentId++;
            state.tournaments.set(tournamentId, {
                ...fields,
                tournamentId,
                seasonId,
                status: 'registering',
                currentRound: 0,
                createdAt: new Date(),
            });
            return { tournamentId, seasonId };
        },

        async updateStatus(tournamentId, status, fields = {}) {
            const row = state.tournaments.get(tournamentId);
            if (!row) throw new Error(`Unknown tournament ${tournamentId}`);
            if (!TOURNAMENT_STATUSES.includes(status)) throw new Error(`Bad status ${status}`);
            Object.assign(row, { status, ...fields });
        },

        async addEntry({ tournamentId, userId, username, isBot, buyInCents, allowNegative, startingStack }) {
            if (entryFor(tournamentId, userId)?.status === 'registered') {
                throw new Error(`${username} is already entered.`);
            }
            if (!allowNegative && balanceOf(userId) < buyInCents) throw insufficientTokens(username);
            const entry = {
                entryId: state.nextEntryId++,
                tournamentId,
                userId: Number(userId),
                username,
                isBot: Boolean(isBot),
                status: 'registered',
                stack: startingStack,
                sitOuts: 0,
                deals: 0,
                bustedRound: null,
                place: null,
                prizeCents: 0,
            };
            state.entries.push(entry);
            post({ userId, tournamentId, type: 'tournament_buy_in', cents: -buyInCents, description: `Tournament buy-in #${tournamentId}` });
            return { entryId: entry.entryId, balanceCents: balanceOf(userId) };
        },

        async withdrawEntry({ tournamentId, userId, buyInCents }) {
            const entry = entryFor(tournamentId, userId);
            if (!entry || entry.status !== 'registered') throw new Error('No registration to withdraw.');
            entry.status = 'withdrawn';
            post({ userId, tournamentId, type: 'tournament_refund', cents: buyInCents, description: `Tournament withdrawal refund #${tournamentId}` });
            return { balanceCents: balanceOf(userId) };
        },

        async saveRound({ tournamentId, roundNumber, tables, entryUpdates, drain = null }) {
            state.rounds.push({ tournamentId, roundNumber, tables: structuredClone(tables), drain: drain ? structuredClone(drain) : null });
            for (const update of entryUpdates) {
                const entry = entryFor(tournamentId, update.userId);
                if (entry) Object.assign(entry, update);
            }
            const row = state.tournaments.get(tournamentId);
            if (row) row.currentRound = roundNumber;
        },

        async finish({ tournamentId, fieldSize, buyInCents, results, endedAt = new Date() }) {
            const row = state.tournaments.get(tournamentId);
            if (!row || row.status !== 'running') throw new Error(`Tournament ${tournamentId} is not running.`);
            for (const result of results) {
                state.results.push({ tournamentId, seasonId, fieldSize, buyInCents, ...result });
                const entry = entryFor(tournamentId, result.userId);
                if (entry) Object.assign(entry, { status: 'finished', place: result.place, prizeCents: result.prizeCents, stack: result.stack });
                if (result.prizeCents > 0) {
                    post({ userId: result.userId, tournamentId, type: 'tournament_prize', cents: result.prizeCents, description: `Tournament #${tournamentId}: ${ordinal(result.place)} place` });
                }
            }
            Object.assign(row, { status: 'complete', endedAt });
        },

        async refundAll({ tournamentId, status, refunds, reason }) {
            const row = state.tournaments.get(tournamentId);
            if (!row) throw new Error(`Unknown tournament ${tournamentId}`);
            for (const refund of refunds) {
                post({ userId: refund.userId, tournamentId, type: 'tournament_refund', cents: refund.cents, description: `Tournament #${tournamentId} ${status}: ${reason}` });
                const entry = entryFor(tournamentId, refund.userId);
                if (entry) entry.status = 'refunded';
            }
            Object.assign(row, { status, endedAt: new Date(), closeReason: reason });
        },

        async loadBotBalances(botIds) {
            return new Map(botIds.map(id => [Number(id), balanceOf(id)]));
        },

        async loadRegistering() {
            return [...state.tournaments.values()]
                .filter(row => row.status === 'registering')
                .map(row => ({
                    tournament: { ...row },
                    entries: state.entries.filter(entry => entry.tournamentId === row.tournamentId && entry.status === 'registered'),
                }));
        },

        async saveSnapshot(tournamentId, snapshot) {
            state.snapshots.set(Number(tournamentId), { snapshot: structuredClone(snapshot), createdAt: Date.now() });
        },

        async claimSnapshots() {
            const rows = [...state.snapshots.entries()].map(([tournamentId, saved]) => ({
                tournamentId,
                status: state.tournaments.get(tournamentId)?.status ?? null,
                snapshot: structuredClone(saved.snapshot),
                ageMs: Date.now() - saved.createdAt,
            }));
            state.snapshots.clear();
            return rows;
        },

        async voidRunningExcept(keepIds = [], reason = 'The tournament could not be resumed after a restart.') {
            const keep = new Set(keepIds.map(Number));
            const voided = [];
            for (const row of state.tournaments.values()) {
                if (row.status !== 'running' || keep.has(row.tournamentId)) continue;
                const refunds = state.entries
                    .filter(entry => entry.tournamentId === row.tournamentId && !['withdrawn', 'refunded'].includes(entry.status))
                    .map(entry => ({ userId: entry.userId, cents: row.buyInCents }));
                await this.refundAll({ tournamentId: row.tournamentId, status: 'voided', refunds, reason });
                voided.push(row.tournamentId);
            }
            return voided;
        },

        async voidRunning(reason = 'Server restarted mid-tournament.') {
            const voided = [];
            for (const row of state.tournaments.values()) {
                if (row.status !== 'running') continue;
                const refunds = state.entries
                    .filter(entry => entry.tournamentId === row.tournamentId && !['withdrawn', 'refunded'].includes(entry.status))
                    .map(entry => ({ userId: entry.userId, cents: row.buyInCents }));
                await this.refundAll({ tournamentId: row.tournamentId, status: 'voided', refunds, reason });
                voided.push(row.tournamentId);
            }
            return voided;
        },
    };
}

// ----------------------------------------------------------------------------
// Postgres store
// ----------------------------------------------------------------------------

function createPgStore(pool) {
    async function withTransaction(work) {
        const client = await pool.connect();
        let open = false;
        try {
            await client.query('BEGIN');
            open = true;
            const result = await work(client);
            await client.query('COMMIT');
            open = false;
            return result;
        } catch (error) {
            if (open) await client.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            client.release();
        }
    }

    async function lockedBalanceCents(client, userId) {
        await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
        const { rows } = await client.query(
            'SELECT COALESCE(SUM(amount), 0) AS tokens FROM transactions WHERE user_id = $1',
            [userId],
        );
        return toCents(rows[0]?.tokens);
    }

    async function postLedger(client, { userId, tournamentId, type, cents, description }) {
        await client.query(
            `INSERT INTO transactions (user_id, tournament_id, transaction_type, amount, description)
             VALUES ($1, $2, $3, $4, $5)`,
            [userId, tournamentId, type, tokens(cents), description],
        );
    }

    return {
        kind: 'postgres',

        async createTournament({ creatorUserId, name, venue, buyInCents, startingStack, maxSeats, startRule, startsAt, drainPercent = 0 }) {
            const { rows } = await pool.query(
                `INSERT INTO tournaments
                    (season_id, creator_user_id, name, venue, buy_in_cents, starting_stack, max_seats, start_rule, starts_at, drain_percent, status)
                 SELECT season_id, $1, $2, $3, $4, $5, $6, $7, $8, $9, 'registering'
                 FROM seasons WHERE status = 'active'
                 RETURNING tournament_id, season_id`,
                [creatorUserId, name, venue, buyInCents, startingStack, maxSeats, startRule, startsAt, drainPercent],
            );
            if (rows.length !== 1) {
                const error = new Error('Unable to attach the tournament to an active season.');
                error.code = 'ACTIVE_SEASON_REQUIRED';
                throw error;
            }
            return { tournamentId: Number(rows[0].tournament_id), seasonId: Number(rows[0].season_id) };
        },

        async updateStatus(tournamentId, status, { startedAt = null, endedAt = null, currentRound = null } = {}) {
            await pool.query(
                `UPDATE tournaments
                 SET status = $2,
                     started_at = COALESCE($3, started_at),
                     ended_at = COALESCE($4, ended_at),
                     current_round = COALESCE($5, current_round)
                 WHERE tournament_id = $1`,
                [tournamentId, status, startedAt, endedAt, currentRound],
            );
        },

        async addEntry({ tournamentId, userId, username, isBot, buyInCents, allowNegative, startingStack }) {
            return withTransaction(async client => {
                const balanceCents = await lockedBalanceCents(client, userId);
                if (!allowNegative && balanceCents < buyInCents) throw insufficientTokens(username);
                const { rows } = await client.query(
                    `INSERT INTO tournament_entries (tournament_id, user_id, is_bot, status, stack)
                     VALUES ($1, $2, $3, 'registered', $4)
                     ON CONFLICT (tournament_id, user_id) DO UPDATE
                     SET status = 'registered', stack = EXCLUDED.stack, sit_outs = 0, deals = 0,
                         busted_round = NULL, place = NULL, prize_cents = 0
                     WHERE tournament_entries.status = 'withdrawn'
                     RETURNING entry_id`,
                    [tournamentId, userId, Boolean(isBot), startingStack],
                );
                if (rows.length !== 1) throw new Error(`${username} is already entered.`);
                await postLedger(client, { userId, tournamentId, type: 'tournament_buy_in', cents: -buyInCents, description: `Tournament buy-in #${tournamentId}` });
                return { entryId: Number(rows[0].entry_id), balanceCents: balanceCents - buyInCents };
            });
        },

        async withdrawEntry({ tournamentId, userId, buyInCents }) {
            return withTransaction(async client => {
                const { rowCount } = await client.query(
                    `UPDATE tournament_entries SET status = 'withdrawn'
                     WHERE tournament_id = $1 AND user_id = $2 AND status = 'registered'`,
                    [tournamentId, userId],
                );
                if (rowCount !== 1) throw new Error('No registration to withdraw.');
                await postLedger(client, { userId, tournamentId, type: 'tournament_refund', cents: buyInCents, description: `Tournament withdrawal refund #${tournamentId}` });
                return {};
            });
        },

        async saveRound({ tournamentId, roundNumber, tables, entryUpdates, drain = null }) {
            await withTransaction(async client => {
                for (const table of tables) {
                    await client.query(
                        `INSERT INTO tournament_rounds
                            (tournament_id, round_number, table_index, player_mode, seating, dealer_user_id,
                             sit_out_user_ids, bid_type, bidder_user_id, deal_executed, point_changes, all_pass_redeals,
                             drain_percent, drain_changes)
                         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
                        [
                            tournamentId, roundNumber, table.tableIndex, table.playerMode,
                            JSON.stringify(table.seating), table.dealerUserId, JSON.stringify(table.sitOutUserIds),
                            table.bidType ?? null, table.bidderUserId ?? null, Boolean(table.dealExecuted),
                            JSON.stringify(table.pointChanges || {}), table.allPassRedeals || 0,
                            drain?.percent || 0, JSON.stringify(drain?.changes || {}),
                        ],
                    );
                }
                for (const update of entryUpdates) {
                    await client.query(
                        `UPDATE tournament_entries
                         SET stack = $3, sit_outs = $4, deals = $5, status = $6, busted_round = $7
                         WHERE tournament_id = $1 AND user_id = $2`,
                        [tournamentId, update.userId, update.stack, update.sitOuts, update.deals, update.status, update.bustedRound],
                    );
                }
                await client.query('UPDATE tournaments SET current_round = $2 WHERE tournament_id = $1', [tournamentId, roundNumber]);
            });
        },

        async finish({ tournamentId, fieldSize, buyInCents, results, endedAt = new Date() }) {
            await withTransaction(async client => {
                const { rows } = await client.query(
                    `UPDATE tournaments SET status = 'complete', ended_at = $2
                     WHERE tournament_id = $1 AND status = 'running'
                     RETURNING season_id`,
                    [tournamentId, endedAt],
                );
                if (rows.length !== 1) throw new Error(`Tournament ${tournamentId} is not running.`);
                const seasonId = rows[0].season_id;
                for (const result of results) {
                    await client.query(
                        `INSERT INTO tournament_results
                            (tournament_id, user_id, season_id, place, field_size, buy_in_cents, prize_cents, final_stack, busted_round)
                         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                         ON CONFLICT (tournament_id, user_id) DO NOTHING`,
                        [tournamentId, result.userId, seasonId, result.place, fieldSize, buyInCents, result.prizeCents, result.stack, result.bustedRound],
                    );
                    await client.query(
                        `UPDATE tournament_entries SET status = 'finished', place = $3, prize_cents = $4, stack = $5
                         WHERE tournament_id = $1 AND user_id = $2`,
                        [tournamentId, result.userId, result.place, result.prizeCents, result.stack],
                    );
                    if (result.prizeCents > 0) {
                        await postLedger(client, { userId: result.userId, tournamentId, type: 'tournament_prize', cents: result.prizeCents, description: `Tournament #${tournamentId}: ${ordinal(result.place)} place` });
                    }
                }
            });
        },

        async refundAll({ tournamentId, status, refunds, reason }) {
            await withTransaction(async client => {
                await client.query(
                    `UPDATE tournaments SET status = $2, ended_at = NOW(), close_reason = $3 WHERE tournament_id = $1`,
                    [tournamentId, status, reason],
                );
                for (const refund of refunds) {
                    await postLedger(client, { userId: refund.userId, tournamentId, type: 'tournament_refund', cents: refund.cents, description: `Tournament #${tournamentId} ${status}: ${reason}` });
                    await client.query(
                        `UPDATE tournament_entries SET status = 'refunded' WHERE tournament_id = $1 AND user_id = $2`,
                        [tournamentId, refund.userId],
                    );
                }
            });
        },

        async loadBotBalances(botIds) {
            const balances = await loadBotBalances(pool, botIds);
            return new Map([...balances].map(([id, value]) => [id, toCents(value)]));
        },

        async loadRegistering() {
            const { rows } = await pool.query(
                `SELECT t.*, u.username AS creator_name
                 FROM tournaments t JOIN users u ON u.id = t.creator_user_id
                 WHERE t.status = 'registering'
                 ORDER BY t.tournament_id`,
            );
            const results = [];
            for (const row of rows) {
                const entries = await pool.query(
                    `SELECT e.user_id, e.is_bot, e.status, e.stack, u.username
                     FROM tournament_entries e JOIN users u ON u.id = e.user_id
                     WHERE e.tournament_id = $1 AND e.status = 'registered'
                     ORDER BY e.entry_id`,
                    [row.tournament_id],
                );
                results.push({
                    tournament: {
                        tournamentId: Number(row.tournament_id),
                        seasonId: Number(row.season_id),
                        creatorUserId: Number(row.creator_user_id),
                        creatorName: row.creator_name,
                        name: row.name,
                        venue: row.venue,
                        buyInCents: Number(row.buy_in_cents),
                        startingStack: Number(row.starting_stack),
                        maxSeats: Number(row.max_seats),
                        startRule: row.start_rule,
                        startsAt: row.starts_at ? new Date(row.starts_at).getTime() : null,
                        drainPercent: Number(row.drain_percent) || 0,
                        createdAt: new Date(row.created_at).getTime(),
                    },
                    entries: entries.rows.map(entry => ({
                        userId: Number(entry.user_id),
                        username: entry.username,
                        isBot: entry.is_bot === true,
                        status: entry.status,
                        stack: Number(entry.stack),
                    })),
                });
            }
            return results;
        },

        async saveSnapshot(tournamentId, snapshot) {
            await pool.query(
                `INSERT INTO tournament_snapshots (tournament_id, snapshot)
                 VALUES ($1, $2)
                 ON CONFLICT (tournament_id) DO UPDATE SET snapshot = EXCLUDED.snapshot, created_at = CURRENT_TIMESTAMP`,
                [tournamentId, JSON.stringify(snapshot)],
            );
        },

        // Single-shot claim: two overlapping instances cannot both restore.
        async claimSnapshots() {
            const { rows } = await pool.query(
                `DELETE FROM tournament_snapshots s
                 USING tournaments t
                 WHERE t.tournament_id = s.tournament_id
                 RETURNING s.tournament_id, t.status, s.snapshot,
                           EXTRACT(EPOCH FROM (NOW() - s.created_at)) * 1000 AS age_ms`,
            );
            return rows.map(row => ({
                tournamentId: Number(row.tournament_id),
                status: row.status,
                snapshot: typeof row.snapshot === 'string' ? JSON.parse(row.snapshot) : row.snapshot,
                ageMs: Number(row.age_ms),
            }));
        },

        async voidRunningExcept(keepIds = [], reason = 'The tournament could not be resumed after a restart.') {
            const { rows } = await pool.query(
                `SELECT tournament_id, buy_in_cents FROM tournaments
                 WHERE status = 'running' AND NOT (tournament_id = ANY($1::int[]))
                 ORDER BY tournament_id`,
                [keepIds.map(Number)],
            );
            const voided = [];
            for (const row of rows) {
                const tournamentId = Number(row.tournament_id);
                const entries = await pool.query(
                    `SELECT user_id FROM tournament_entries
                     WHERE tournament_id = $1 AND status NOT IN ('withdrawn', 'refunded')`,
                    [tournamentId],
                );
                await this.refundAll({
                    tournamentId,
                    status: 'voided',
                    refunds: entries.rows.map(entry => ({ userId: Number(entry.user_id), cents: Number(row.buy_in_cents) })),
                    reason,
                });
                voided.push(tournamentId);
            }
            return voided;
        },

        async voidRunning(reason = 'Server restarted mid-tournament.') {
            const { rows } = await pool.query(
                `SELECT tournament_id, buy_in_cents FROM tournaments WHERE status = 'running' ORDER BY tournament_id`,
            );
            const voided = [];
            for (const row of rows) {
                const tournamentId = Number(row.tournament_id);
                const entries = await pool.query(
                    `SELECT user_id FROM tournament_entries
                     WHERE tournament_id = $1 AND status NOT IN ('withdrawn', 'refunded')`,
                    [tournamentId],
                );
                await this.refundAll({
                    tournamentId,
                    status: 'voided',
                    refunds: entries.rows.map(entry => ({ userId: Number(entry.user_id), cents: Number(row.buy_in_cents) })),
                    reason,
                });
                voided.push(tournamentId);
            }
            return voided;
        },
    };
}

function ordinal(place) {
    const n = Number(place);
    const suffix = (n % 100 >= 11 && n % 100 <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
    return `${n}${suffix}`;
}

module.exports = { createMemoryStore, createPgStore, TOURNAMENT_STATUSES, ordinal };
