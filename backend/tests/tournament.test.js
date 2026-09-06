'use strict';

// Tournament director (src/tournament/): seating, prizes, registration and
// the money around it, and whole tournaments driven headlessly through the
// real GameService, GameEngine and bot brains.

const assert = require('node:assert/strict');

const GameService = require('../src/services/GameService');
const { TournamentDirector, TournamentError, TOURNAMENT_VENUE, REGISTRATION_TTL_MS } = require('../src/tournament/TournamentDirector');
const { createMemoryStore } = require('../src/tournament/tournamentStore');
const { tableSizes, seatRound } = require('../src/tournament/seating');
const { scaleExchange } = require('../src/core/handlers/scoringHandler');
const { prizeSplitCents, rankFinishers, allocatePrizeCents } = require('../src/tournament/prizes');
const { registerBrainProfile } = require('../src/core/bot-brains');
const BotPlayer = require('../src/core/BotPlayer');
const afkTurnTimer = require('../src/core/afkTurnTimer');
const { getLegalMoves } = require('../src/core/legalMoves');
const { createGameServiceWithoutHeartbeat } = require('./test-helpers');

const pass = message => console.log(`  ✓ ${message}`);

const mockIo = { to: () => ({ emit: () => {} }), emit: () => {}, sockets: { sockets: new Map() } };
const mockPool = {
    query() { return Promise.resolve({ rows: [], rowCount: 0 }); },
    async connect() { return { query: this.query, release() {} }; },
};

// Six house players across the live brains. Names are synthetic so this
// suite never depends on the production roster.
const BOT_ACCOUNTS = [
    { id: 901, username: 'Tourney Counting A', brain: 'counting' },
    { id: 902, username: 'Tourney Flytrap A', brain: 'flytrap' },
    { id: 903, username: 'Tourney Sphinx A', brain: 'sphinx' },
    { id: 904, username: 'Tourney Coyote A', brain: 'coyote' },
    { id: 905, username: 'Tourney Counting B', brain: 'counting' },
    { id: 906, username: 'Tourney Flytrap B', brain: 'flytrap' },
];
for (const bot of BOT_ACCOUNTS) registerBrainProfile(bot.username, bot.brain);
const botProfiles = BOT_ACCOUNTS.map(({ id, username }) => ({ id, username, tokens: 100 }));

function buildHarness({ balances = {}, now = 1_800_000_000_000, boardDelayMs = 0, presentationHoldMs = 0 } = {}) {
    const timers = [];
    const gameService = createGameServiceWithoutHeartbeat(GameService, mockIo, mockPool, { botAccounts: botProfiles });
    gameService.timerOverride = (cb, duration) => { timers.push({ cb, duration }); };
    const store = createMemoryStore({ balances });
    const queue = [];
    const clock = { now };
    const director = new TournamentDirector({
        gameService,
        store,
        io: mockIo,
        now: () => clock.now,
        schedule: fn => { queue.push(fn); return queue.length; },
        cancelSchedule: () => {},
        random: () => 0,
        presentationHoldMs,
        boardDelayMs,
    });
    gameService.attachTournamentDirector(director);
    const drainQueue = async () => { while (queue.length) await queue.shift()(); };
    return { gameService, store, director, timers, queue, clock, drainQueue };
}

// Drive one tournament table to the end of its round through the service so
// every effect (including TOURNAMENT_ROUND_COMPLETE) fires. Bots use their
// brains; the test humans borrow the default brain so they bid and play
// like people rather than passing forever.
function brainFor(engine, id) {
    return engine.bots[id] || new BotPlayer(id, engine.players[id].playerName, engine);
}

async function playTable(harness, tableId) {
    const { gameService, timers } = harness;
    for (let guard = 0; guard < 4000; guard += 1) {
        const engine = gameService.getEngineById(tableId);
        if (!engine || engine.state === 'Awaiting Next Round Trigger') return;
        if (timers.length > 0) { await timers.shift().cb(); continue; }
        const state = engine.state;
        if (state === 'Dealing Pending') { await gameService.dealCards(tableId, engine.dealer); continue; }
        if (state === 'Bidding Phase' || state === 'Awaiting Frog Upgrade Decision') {
            const id = engine.biddingTurnPlayerId;
            const brain = brainFor(engine, id);
            await gameService.placeBid(tableId, id, state === 'Bidding Phase' ? brain.decideBid() : brain.decideFrogUpgrade());
            continue;
        }
        if (state === 'Trump Selection') {
            const id = engine.bidWinnerInfo.userId;
            await gameService.chooseTrump(tableId, id, brainFor(engine, id).chooseTrump());
            continue;
        }
        if (state === 'Frog Widow Exchange') {
            const id = engine.bidWinnerInfo.userId;
            await gameService.submitFrogDiscards(tableId, id, brainFor(engine, id).submitFrogDiscards());
            continue;
        }
        if (state === 'Playing Phase') {
            const id = engine.trickTurnPlayerId;
            const hand = engine.hands[engine.players[id].playerName];
            const legal = getLegalMoves(hand, engine.currentTrickCards.length === 0, engine.leadSuitCurrentTrick, engine.trumpSuit, engine.trumpBroken);
            const card = brainFor(engine, id).playCard();
            await gameService.playCard(tableId, id, legal.includes(card) ? card : legal[0]);
            continue;
        }
        throw new Error(`playTable: unexpected state ${state} on ${tableId}`);
    }
    const stuck = gameService.getEngineById(tableId);
    throw new Error(`playTable: ${tableId} did not finish; state=${stuck?.state} bidTurn=${stuck?.biddingTurnPlayerId} trickTurn=${stuck?.trickTurnPlayerId} trick=${JSON.stringify(stuck?.currentTrickCards)} playout=${stuck?.playoutVote?.isActive} draw=${stuck?.drawRequest?.isActive} hands=${JSON.stringify(Object.fromEntries(Object.entries(stuck?.hands || {}).map(([k, v]) => [k, v.length])))} bid=${JSON.stringify(stuck?.bidWinnerInfo)} trump=${stuck?.trumpSuit} tricks=${stuck?.tricksPlayedCount}`);
}

async function playRound(harness, t) {
    for (const tableId of [...t.tables.keys()]) await playTable(harness, tableId);
    await harness.drainQueue();
}

async function runTournamentTests() {
    // ------------------------------------------------------------ seating
    {
        const expected = { 3: [3], 4: [4], 5: [5], 6: [3, 3], 7: [3, 4], 8: [4, 4], 9: [3, 3, 3], 10: [3, 3, 4], 11: [3, 4, 4], 12: [3, 3, 3, 3], 13: [3, 3, 3, 4], 14: [3, 3, 4, 4], 15: [3, 3, 3, 3, 3] };
        for (const [n, sizes] of Object.entries(expected)) assert.deepEqual(tableSizes(Number(n)), sizes, `tableSizes(${n})`);
        assert.deepEqual(tableSizes(2), []);
        pass('Fields of 3 to 15 split into threes and fours exactly as agreed.');

        const eight = [
            { userId: 1, stack: 300 }, { userId: 2, stack: 250 }, { userId: 3, stack: 200 }, { userId: 4, stack: 150 },
            { userId: 5, stack: 100, sitOuts: 1 }, { userId: 6, stack: 90 }, { userId: 7, stack: 80 }, { userId: 8, stack: 20, sitOuts: 1 },
        ];
        const plan = seatRound(eight, { random: () => 0 });
        assert.equal(plan.length, 2);
        assert.deepEqual(plan[0].seats, [1, 2, 3, 4]);
        assert.equal(plan[0].playerMode, 4);
        assert.equal(plan[0].dealerUserId, 4, 'fewest sit-outs, then the shortest stack sits out');
        assert.deepEqual(plan[1].seats, [5, 6, 7, 8]);
        assert.equal(plan[1].dealerUserId, 7, 'players who already sat out are passed over');
        assert.deepEqual(plan[1].sitOutUserIds, [7]);
        pass('Top with top; the sit-out is the fewest-sat-out, then the shortest stack.');

        const five = seatRound([
            { userId: 1, stack: 200 }, { userId: 2, stack: 180 }, { userId: 3, stack: 160 }, { userId: 4, stack: 140 }, { userId: 5, stack: 120 },
        ]);
        assert.equal(five.length, 1);
        assert.equal(five[0].playerMode, 4);
        assert.deepEqual(five[0].sitOutUserIds, [5, 4], 'two share the widow seat at five');
        assert.equal(five[0].dealerUserId, 5);
        assert.deepEqual(five[0].spectatorUserIds, [4]);
        assert.deepEqual(five[0].seats, [1, 2, 3, 5]);
        pass('At five players, two share the widow seat.');

        const three = seatRound([{ userId: 1, stack: 100, deals: 2 }, { userId: 2, stack: 90, deals: 1 }, { userId: 3, stack: 80, deals: 2 }]);
        assert.equal(three[0].playerMode, 3);
        assert.equal(three[0].dealerUserId, 2, 'the seat that has dealt the fewest times deals');
        pass('A three-seat table deals from the seat with the fewest deals.');
    }

    // ------------------------------------------------------------- prizes
    {
        assert.deepEqual(prizeSplitCents(900, 9), [450, 270, 180]);
        assert.deepEqual(prizeSplitCents(100, 3), [65, 35]);
        assert.deepEqual(prizeSplitCents(101, 6), [51, 30, 20], 'the odd cent goes to first');
        assert.deepEqual(prizeSplitCents(0, 9), [0, 0, 0]);
        const placings = rankFinishers({
            survivors: [{ userId: 1, stack: 300 }, { userId: 2, stack: 40 }],
            busted: [{ userId: 3, stack: -10, bustedRound: 7 }, { userId: 4, stack: -60, bustedRound: 7 }, { userId: 5, stack: 0, bustedRound: 3 }],
        });
        assert.deepEqual(placings.map(p => [p.userId, p.place]), [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5]]);
        const prizes = allocatePrizeCents(placings, 500, 5);
        assert.equal(prizes.get(1), 325);
        assert.equal(prizes.get(2), 175);
        assert.equal(prizes.get(3), 0);
        const tied = rankFinishers({ survivors: [{ userId: 8, stack: 100 }, { userId: 9, stack: 100 }], busted: [{ userId: 7, stack: -5, bustedRound: 2 }] });
        assert.deepEqual(tied.map(p => p.place), [1, 1, 3]);
        const tiedPrizes = allocatePrizeCents(tied, 301, 6);
        assert.equal(tiedPrizes.get(8) + tiedPrizes.get(9), 151 + 90, 'tied first and second pool both prizes');
        assert.equal(tiedPrizes.get(7), 60);
        pass('Prizes pay 50/30/20 (65/35 under six), in exact cents, with ties pooled.');
    }

    // ------------------------------------------------- registration rules
    {
        const harness = buildHarness({ balances: { 11: 500, 12: 0, 901: 1000, 902: 900, 903: 50, 904: 800, 905: 700, 906: 600 } });
        const { director, store, gameService } = harness;
        const matt = { id: 11, username: 'Matt', is_vip: true };
        await assert.rejects(() => director.create({ id: 5, username: 'Nobody', is_vip: false }, { buyInTokens: 1, startingStack: 120 }), /VIP/);
        await assert.rejects(() => director.create(matt, { buyInTokens: 51, startingStack: 120 }), err => err.code === 'BAD_BUY_IN');
        await assert.rejects(() => director.create(matt, { buyInTokens: 1, startingStack: 100 }), err => err.code === 'BAD_STACK');
        await assert.rejects(() => director.create(matt, { buyInTokens: 1, startingStack: 120, maxSeats: 16 }), err => err.code === 'BAD_SEATS');
        await assert.rejects(() => director.create(matt, { buyInTokens: 1, startingStack: 120, startRule: 'at_time', startsAt: harness.clock.now + 60_000 }), err => err.code === 'START_TIME_TOO_SOON');
        pass('Creation is VIP-only and validates buy-in (≤ 50), stack, seats (≤ 15) and start time.');

        const created = await director.create(matt, { buyInTokens: 1, startingStack: 120, maxSeats: 9, venue: TOURNAMENT_VENUE, startRule: 'creator' });
        assert.equal(created.status, 'registering');
        assert.equal(created.name, "Matt's Tournament");
        await assert.rejects(() => director.create(matt, { buyInTokens: 1, startingStack: 120 }), err => err.code === 'TOURNAMENT_ALREADY_OPEN');
        pass('One tournament is open for registration at a time.');

        await director.register(created.id, matt);
        await director.register(created.id, { id: 12, username: 'Broke Bob' });
        assert.equal(store.balanceOf(12), -100, 'alpha: a human may register into a negative balance');
        await assert.rejects(() => director.register(created.id, matt), err => err.code === 'ALREADY_ENTERED');
        assert.equal(gameService.isUserSeatedAnywhere(12), true, 'a registered player counts as seated for renames and joins');
        pass('Humans register with the buy-in charged, negative balances allowed during alpha.');

        await assert.rejects(() => director.findPlayer(created.id, 12), err => err.code === 'CREATOR_ONLY');
        const afterFind = await director.findPlayer(created.id, 11);
        const found = afterFind.entries.find(e => e.userId === 901);
        assert.ok(found, 'the richest house player who can afford it is seated first');
        assert.equal(store.balanceOf(901), 900);
        assert.equal(gameService.botSeatLeases.get(901)?.tableId, 'tn-1', 'the tournament holds the lease');
        assert.ok(!('isBot' in found), 'public state never says who is a house player');
        await director.findPlayer(created.id, 11); // 902
        await director.findPlayer(created.id, 11); // 904 (903 cannot afford it)
        await director.findPlayer(created.id, 11); // 905
        await director.findPlayer(created.id, 11); // 906
        assert.equal(director.get(created.id).entries.has(903), false, 'a house player short of the buy-in is skipped');
        await assert.rejects(() => director.findPlayer(created.id, 11), err => err.code === 'NO_HOUSE_PLAYER_AVAILABLE');
        pass('Find player seats house players richest-first while any can cover the buy-in.');

        await director.withdraw(created.id, 12);
        assert.equal(store.balanceOf(12), 0, 'withdrawing before the start refunds the buy-in');
        assert.equal(director.publicState(director.get(created.id)).seatsTaken, 6);
        await director.register(created.id, { id: 12, username: 'Broke Bob' });
        pass('Withdrawing refunds; the seat can be taken again.');

        await director.cancel(created.id, 11, 'Testing the refund path.');
        const t = director.get(created.id);
        assert.equal(t.status, 'cancelled');
        assert.equal(store.balanceOf(11), 500);
        assert.equal(store.balanceOf(12), 0);
        assert.equal(store.balanceOf(901), 1000);
        assert.equal(gameService.botSeatLeases.size, 0, 'cancelling releases every house player');
        assert.equal(store.state.transactions.filter(tx => tx.type === 'tournament_refund').length, 8);
        pass('Cancelling refunds every buy-in and frees the house players.');
    }

    // ------------------------------------------------- timed start + expiry
    {
        const harness = buildHarness({ balances: { 901: 1000, 902: 1000, 903: 1000 } });
        const { director, clock, store } = harness;
        const matt = { id: 11, username: 'Matt', is_vip: true };
        const t = await director.create(matt, { buyInTokens: 0.5, startingStack: 60, maxSeats: 6, startRule: 'at_time', startsAt: clock.now + 15 * 60_000 });
        await director.register(t.id, matt);
        clock.now += 15 * 60_000;
        await director.tick();
        assert.equal(director.get(t.id).status, 'cancelled', 'a timed start with fewer than three cancels');
        assert.equal(store.balanceOf(11), 0 - 50 + 50);
        pass('A timed start with fewer than three players cancels and refunds.');

        const t2 = await director.create(matt, { buyInTokens: 0.5, startingStack: 60, maxSeats: 6, startRule: 'creator' });
        await director.register(t2.id, matt);
        clock.now += REGISTRATION_TTL_MS;
        await director.tick();
        assert.equal(director.get(t2.id).status, 'cancelled', 'a registration older than a day expires');
        pass('A tournament nobody starts within a day cancels and refunds.');

        const t3 = await director.create(matt, { buyInTokens: 0.5, startingStack: 60, maxSeats: 3, startRule: 'when_full' });
        await director.register(t3.id, matt);
        await director.findPlayer(t3.id, 11);
        await director.findPlayer(t3.id, 11);
        assert.equal(director.get(t3.id).status, 'running', '"when full" starts the moment the last seat fills');
        assert.equal(director.get(t3.id).round, 1);
        assert.equal(director.get(t3.id).tables.size, 1);
        await director.voidTournament(t3.id, 'test void');
        assert.equal(director.get(t3.id).status, 'voided');
        assert.equal(store.balanceOf(11), 0, 'voiding refunds the buy-in');
        assert.equal(harness.gameService.getEngineById('tn-3-r1-t1'), undefined, 'voiding tears the tables down');
        pass('"When full" starts by itself; voiding refunds and clears the tables.');
    }

    // ---------------------------------------- engine hooks for a tournament
    {
        const harness = buildHarness();
        const { gameService } = harness;
        const lease = gameService.createBotSeatLease('tn-test');
        const engine = gameService.createTournamentEngine({ tableId: 'tn-x', venue: 'fort-creek', tableName: 'X', leaseController: lease });
        engine.startTournamentRound({
            tournament: { tournamentId: 42, name: 'X', roundNumber: 1, tableIndex: 0 },
            seats: [
                { userId: 21, playerName: 'Ada', isBot: false, connected: false },
                { userId: 901, playerName: 'Tourney Counting A', isBot: true },
                { userId: 902, playerName: 'Tourney Flytrap A', isBot: true },
            ],
            stacks: { 21: 120, 901: 90, 902: 60 },
            dealerUserId: 21,
            playerMode: 3,
        });
        assert.equal(engine.tableType, 'tournament');
        assert.equal(engine.scores.Ada, 120);
        assert.equal(engine.scores.ScoreAbsorber, 120);
        assert.equal(engine.players[21].disconnected, true, 'an absent human is seated as disconnected');
        assert.equal(engine.state, 'Dealing Pending');
        const dealerBefore = engine.dealer;
        engine._advanceRound();
        assert.equal(engine.dealer, dealerBefore, 'all pass keeps the dealer');
        assert.equal(engine.tournamentAllPassRedeals, 1);
        assert.equal(engine.state, 'Dealing Pending');
        assert.deepEqual(engine.requestNextRound(21).effects.map(e => e.type), ['BROADCAST_STATE']);
        assert.equal(engine.state, 'Dealing Pending', 'a tournament table never advances itself');
        assert.deepEqual(engine.requestDraw(21).effects, []);
        assert.deepEqual(engine.forfeitGame(21).effects, []);
        assert.deepEqual(engine.startForfeitTimer(901, 'Ada').effects, []);
        assert.deepEqual(engine.reset().effects, [], 'nothing but the director resets a tournament table');
        engine.players[21].socketId = 'sock-21';
        engine.players[21].disconnected = false;
        engine.leaveTable(21);
        assert.ok(engine.players[21], 'leaving keeps the seat');
        assert.equal(engine.players[21].disconnected, true);
        assert.equal(gameService.getLobbyState().themes.every(theme => theme.tables.every(table => table.tableId !== 'tn-x')), true, 'tournament tables stay out of the lobby list');
        pass('A tournament table never ends, forfeits, draws or reseats itself; leaving is a disconnect.');

        // The house plays for an absent seat on the short tournament clock.
        engine.dealCards(engine.dealer);
        engine.biddingTurnPlayerId = 21;
        const now = 1_000_000;
        assert.equal(afkTurnTimer.evaluate(engine, { now, timeoutMs: 51_750 }), null, 'first sight arms the clock');
        const armed = engine.afkWatch.since;
        assert.equal(afkTurnTimer.evaluate(engine, { now: armed + 5_000, timeoutMs: 51_750 }), null);
        const decision = afkTurnTimer.evaluate(engine, { now: armed + afkTurnTimer.TOURNAMENT_ABSENT_TIMEOUT_MS + 1, timeoutMs: 51_750 });
        assert.equal(decision?.action, 'bid', 'a disconnected tournament seat is played for within seconds');
        assert.equal(decision.userId, 21);
        pass('The backstop plays for an absent tournament seat on a six-second clock.');

        // Three all-pass redeals wash the round so an absent table cannot
        // hold the room hostage.
        const completions = [];
        harness.director.onTableComplete = async payload => { completions.push(payload); };
        for (let redeal = 0; redeal < 3; redeal += 1) {
            engine.state = 'Bidding Phase';
            engine.biddingTurnPlayerId = engine.playerOrder.turnOrder[0];
            for (const id of engine.playerOrder.turnOrder) await gameService.placeBid('tn-x', id, 'Pass');
            assert.equal(engine.state, 'AllPassWidowReveal');
            await harness.timers.shift().cb();
            if (redeal < 2) {
                assert.equal(engine.state, 'Dealing Pending', `redeal ${redeal + 1} goes back to the deck for the director to deal`);
                assert.equal(engine.tournamentDealDueAt, null, 'the director sets the due time on its own clock');
                engine.dealCards(engine.dealer);
                assert.equal(engine.state, 'Bidding Phase');
            }
        }
        assert.equal(engine.state, 'Awaiting Next Round Trigger', 'the third all-pass washes the round');
        assert.equal(engine.roundSummary.tournamentWash, true);
        assert.equal(completions.length, 1);
        assert.equal(completions[0].wash, true);
        assert.deepEqual(completions[0].scores, { Ada: 120, 'Tourney Counting A': 90, 'Tourney Flytrap A': 60, ScoreAbsorber: 120 }, 'nothing moved');
        pass('Three all-pass redeals wash the round with no chip movement.');
        assert.equal(gameService.destroyTournamentEngine('tn-x'), true);
        assert.equal(gameService.getEngineById('tn-x'), undefined);
    }

    // ----------------------------- the delayed deal and the all-pass redeal
    {
        const harness = buildHarness({ balances: { 901: 1000, 902: 1000 } });
        const { director, gameService, clock } = harness;
        const matt = { id: 11, username: 'Matt', is_vip: true };
        const t = await director.create(matt, { buyInTokens: 1, startingStack: 120, maxSeats: 3, startRule: 'creator', escalationPercent: 0 });
        await director.register(t.id, matt);
        for (let i = 0; i < 2; i += 1) await director.findPlayer(t.id, 11);
        await director.start(t.id, 11);
        const live = director.get(t.id);
        const [tableId] = [...live.tables.keys()];
        const engine = gameService.getEngineById(tableId);
        assert.equal(engine.state, 'Dealing Pending');
        assert.equal(director.publicState(live).tables[0].phase, 'dealing');
        // The scheduled deal is lost (say, with the process): the heartbeat
        // deals once the due time passes.
        harness.queue.length = 0;
        await director.tick();
        assert.equal(engine.state, 'Dealing Pending', 'not due yet');
        clock.now += 2_500;
        await director.tick();
        assert.equal(engine.state, 'Bidding Phase', 'the heartbeat dealt the round when it fell due');
        assert.equal(director.publicState(live).tables[0].phase, 'bidding');
        // An all-pass: the table goes back to Dealing Pending and the
        // director deals again after the deal delay, so the redeal animates.
        engine.biddingTurnPlayerId = engine.playerOrder.turnOrder[0];
        for (const id of engine.playerOrder.turnOrder) await gameService.placeBid(tableId, id, 'Pass');
        assert.equal(engine.state, 'AllPassWidowReveal');
        await harness.timers.shift().cb();
        assert.equal(engine.state, 'Dealing Pending');
        assert.equal(engine.tournamentDealDueAt, null);
        await director.tick();
        assert.equal(engine.tournamentDealDueAt, clock.now + 2_500, 'the heartbeat sets the due time on the director clock');
        assert.equal(engine.state, 'Dealing Pending');
        clock.now += 2_499;
        await director.tick();
        assert.equal(engine.state, 'Dealing Pending', 'a millisecond early is still pending');
        clock.now += 1;
        await director.tick();
        assert.equal(engine.state, 'Bidding Phase', 'the redeal lands when due');
        assert.equal(engine.tournamentAllPassRedeals, 1);
        pass('Rounds open on screen and deal after the delay; an all-pass redeal waits for the same delay.');

        // Escalation scales the exchange and keeps the round balanced.
        assert.deepEqual(scaleExchange({ Ada: -30, Bo: 15, Cy: 15 }, 'Ada', 1.21), { Bo: 18, Cy: 18, Ada: -36 });
        assert.deepEqual(scaleExchange({ Ada: 60, Bo: -20, Cy: -20, ScoreAbsorber: -20 }, 'Ada', 1.1), { Bo: -22, Cy: -22, ScoreAbsorber: -22, Ada: 66 });
        assert.equal(scaleExchange(null, 'Ada', 2), null);
        pass('Escalation multiplies every side of the exchange and the bidder balances it to the point.');
        // The ring on the felt: the seat on the clock, its free window and bank.
        engine.biddingTurnPlayerId = 11; // a human seat: house seats are never on the clock
        const turnClock = engine._getRawStateForClient().tournamentClock.turn;
        assert.equal(turnClock.playerName, 'Matt');
        assert.equal(turnClock.kind, 'bid');
        assert.equal(turnClock.freeSeconds, 24);
        assert.equal(turnClock.bankSeconds, 0, 'bids do not draw on the bank');
        pass('The public clock names the seat on the clock with its free window and bank.');
        await director.voidTournament(t.id, 'done');
    }

    // --------------------------------- watching another table while you wait
    {
        const harness = buildHarness({ balances: { 901: 1000, 902: 1000, 903: 1000, 904: 1000, 905: 1000 } });
        const { director, gameService, clock } = harness;
        const matt = { id: 11, username: 'Matt', is_vip: true };
        const sockets = new Map();
        const fakeSocket = id => {
            const socket = { id, rooms: new Set(), join(room) { this.rooms.add(room); }, leave(room) { this.rooms.delete(room); }, emit() {} };
            sockets.set(id, socket);
            return socket;
        };
        mockIo.sockets = { sockets };
        const mattSocket = fakeSocket('sock-matt');
        const t = await director.create(matt, { buyInTokens: 1, startingStack: 120, maxSeats: 6, startRule: 'creator', escalationPercent: 0 });
        await director.register(t.id, matt, { socketId: mattSocket.id });
        for (let i = 0; i < 5; i += 1) await director.findPlayer(t.id, 11);
        await director.start(t.id, 11);
        await harness.drainQueue();
        const live = director.get(t.id);
        const [tableA, tableB] = [...live.tables.keys()];
        const mine = [...live.tables.values()].find(table => table.seats.includes(11));
        const other = mine.tableId === tableA ? tableB : tableA;
        assert.throws(() => director.watchTable(t.id, 11, other, mattSocket), err => err.code === 'STILL_PLAYING', 'not while your own round is live');
        await playTable(harness, mine.tableId);
        assert.equal(gameService.getEngineById(mine.tableId).state, 'Awaiting Next Round Trigger');
        const state = director.watchTable(t.id, 11, other, mattSocket);
        assert.equal(state.viewer.watchingTableId, other);
        const watched = gameService.getEngineById(other);
        assert.equal(watched.players[11].isSpectator, true, 'seated as a spectator at the other table');
        assert.ok(mattSocket.rooms.has(other), 'the socket joined the watched table room');
        const view = watched.getStateForClient({ userId: 11, isAdmin: false });
        const shownHands = Object.entries(view.hands || {}).filter(([, cards]) => Array.isArray(cards) && cards.length > 0 && typeof cards[0] === 'string');
        assert.equal(shownHands.length, 0, 'a watcher sees no hands');
        assert.throws(() => director.watchTable(t.id, 11, mine.tableId, mattSocket), err => err.code === 'OWN_TABLE');
        director.unwatchTable(t.id, 11);
        assert.equal(watched.players[11], undefined, 'unwatching removes the spectator seat');
        assert.ok(!mattSocket.rooms.has(other));
        director.watchTable(t.id, 11, other, mattSocket);
        await playTable(harness, other);
        clock.now += 60_000;
        await harness.drainQueue(); // finishRound, then the next round starts
        assert.equal(live.round, 2);
        assert.equal(live.entries.get(11).watchingTableId, null, 'reseating ends the watch');
        assert.ok(!mattSocket.rooms.has(other), 'and leaves the old room');
        pass('A player whose table is done can watch another table; the watch ends when the room reseats.');
        await director.voidTournament(t.id, 'done');
        delete mockIo.sockets;
    }

    // --------------------------------- the shared widow seat at five players
    {
        // A creator-rule tournament waits for Start even when full.
        const harness = buildHarness({ balances: { 901: 1000, 902: 1000, 903: 1000, 904: 1000, 905: 1000 } });
        const { director, gameService, store } = harness;
        const matt = { id: 11, username: 'Matt', is_vip: true };
        const t = await director.create(matt, { buyInTokens: 1, startingStack: 120, maxSeats: 5, startRule: 'creator' });
        for (let i = 0; i < 5; i += 1) await director.findPlayer(t.id, 11);
        assert.equal(director.get(t.id).status, 'registering');
        await director.start(t.id, 11);
        const live = director.get(t.id);
        assert.equal(live.tables.size, 1);
        const [table] = [...live.tables.values()];
        assert.equal(table.playerMode, 4);
        assert.equal(table.spectatorUserIds.length, 1, 'five players: one table, two sit out, one of them watching');
        const engine = gameService.getEngineById(table.tableId);
        assert.equal(engine.players[table.spectatorUserIds[0]].isSpectator, true);
        assert.equal(engine.playerOrder.turnOrder.length, 3, 'three play');
        // Fake the round's result: the dealer collected a 30-point widow share.
        const dealerName = engine.players[table.dealerUserId].playerName;
        const scores = { ...engine.scores };
        scores[dealerName] += 30;
        engine.state = 'Awaiting Next Round Trigger';
        await director.onTableComplete({ tournamentId: t.id, roundNumber: 1, tableIndex: 0, tableId: table.tableId, scores, pointChanges: {}, bidType: 'Solo', bidderName: null, dealExecuted: false, allPassRedeals: 0 });
        await harness.drainQueue(); // finishRound, then the next round starts
        const dealerEntry = live.entries.get(table.dealerUserId);
        const watcherEntry = live.entries.get(table.spectatorUserIds[0]);
        assert.equal(dealerEntry.stack, 135, 'the sitting-out dealer keeps half the widow share');
        assert.equal(watcherEntry.stack, 135, 'the player sharing the widow seat gets the other half');
        assert.equal(dealerEntry.sitOuts, 1);
        assert.equal(watcherEntry.sitOuts, 1);
        assert.equal(store.state.rounds.length, 1);
        assert.equal(live.round, 2, 'the next round is seated');
        const [next] = [...live.tables.values()];
        assert.ok(!next.sitOutUserIds.includes(table.dealerUserId) && !next.sitOutUserIds.includes(watcherEntry.userId), 'the sit-out count rotates the widow seat');
        pass('Two players sharing the widow seat split the widow share, and the seat rotates.');
        await director.voidTournament(t.id, 'done');
    }

    // ------------------------------------------ a whole nine-seat tournament
    {
        const harness = buildHarness({ balances: { 11: 300, 12: 0, 13: 1000, 14: 250, 901: 1000, 902: 900, 903: 800, 904: 700, 905: 600, 906: 500 } });
        const { director, gameService, store } = harness;
        const matt = { id: 11, username: 'Matt', is_vip: true };
        // A 60 stack keeps this bot-only run short; at 120 with no drain a
        // nine-seat tournament can run past a hundred rounds (see the
        // whiteboard's simulation), which is a scheduling fact, not a bug.
        await assert.rejects(
            () => director.create(matt, { buyInTokens: 1, startingStack: 60, maxSeats: 9, escalationPercent: 7 }),
            err => err.code === 'BAD_ESCALATION',
        );
        const t = await director.create(matt, { name: '  Saturday Sluff  ', buyInTokens: 1, startingStack: 60, maxSeats: 9, venue: 'fort-creek', startRule: 'creator', escalationPercent: 10 });
        assert.equal(t.name, 'Saturday Sluff');
        assert.equal(t.escalationPercent, 10);
        assert.equal(t.stakesMultiplier, 1);
        for (const human of [matt, { id: 12, username: 'Broke Bob' }, { id: 13, username: 'Cara' }, { id: 14, username: 'Dee' }]) {
            await director.register(t.id, human);
        }
        for (let i = 0; i < 5; i += 1) await director.findPlayer(t.id, 11);
        assert.equal(director.publicState(director.get(t.id)).seatsTaken, 9);
        const potCents = 900;
        assert.equal(store.state.transactions.filter(tx => tx.type === 'tournament_buy_in').reduce((sum, tx) => sum - tx.cents, 0), potCents);

        await director.start(t.id, 11);
        const live = director.get(t.id);
        assert.equal(live.status, 'running');
        assert.equal(live.round, 1);
        assert.equal(live.tables.size, 3, 'nine players: three tables of three');
        for (const table of live.tables.values()) {
            const engine = gameService.getEngineById(table.tableId);
            assert.ok(engine, `${table.tableId} exists`);
            assert.equal(engine.state, 'Dealing Pending', 'the round opens on screen before the cards fly');
            assert.ok(Number.isFinite(engine.tournamentDealDueAt), 'the deal is due after the deal delay');
            assert.equal(engine.tournament.pointMultiplier, 1, 'round one is played at even stakes');
        }
        await harness.drainQueue();
        for (const table of live.tables.values()) {
            const engine = gameService.getEngineById(table.tableId);
            assert.equal(engine.state, 'Bidding Phase', 'the delayed deal lands');
            assert.equal(engine.playerMode, 3);
            assert.equal(engine.gameId, null, 'no game_history row for a tournament round');
            assert.equal(engine.tournament.roundNumber, 1);
            for (const seat of table.seats) assert.equal(engine.scores[live.entries.get(seat).username], 60);
        }
        assert.equal(gameService.hasActiveOrPendingGame(), true, 'the deploy check sees a running tournament');
        pass('Starting seats the field, opens every table, and deals after the deal delay.');

        let rounds = 0;
        let singleTableId = null;
        while (live.status === 'running' && rounds < 200) {
            rounds += 1;
            const alive = live.entries.size;
            await playRound(harness, live);
            if (live.status !== 'running') break;
            // Every remaining stack is positive and every table is fresh.
            for (const entry of live.entries.values()) {
                if (entry.status === 'playing') assert.ok(entry.stack > 0, `${entry.username} plays on with ${entry.stack}`);
                if (entry.status === 'busted') assert.ok(entry.stack <= 0 && entry.bustedRound >= 1);
            }
            assert.equal(alive, live.entries.size);
            const playing = [...live.entries.values()].filter(e => e.status === 'playing').length;
            const sizes = [...live.tables.values()].map(table => table.seats.length + table.spectatorUserIds.length);
            assert.equal(sizes.reduce((a, b) => a + b, 0), playing, 'everyone alive has a seat');
            const stakes = director.publicState(live).stakesMultiplier;
            assert.equal(stakes, Number((1.1 ** (live.round - 1)).toFixed(2)), 'stakes grow ten percent a round');
            for (const table of live.tables.values()) {
                assert.equal(gameService.getEngineById(table.tableId).tournament.pointMultiplier, stakes);
            }
            if (live.tables.size === 1) {
                const [tableId] = live.tables.keys();
                if (singleTableId) assert.equal(tableId, singleTableId, 'one table left: the room stays seated between rounds');
                singleTableId = tableId;
            }
        }
        assert.equal(live.status, 'complete', `the tournament finished (rounds played: ${rounds})`);
        assert.ok(live.round >= 2, 'at least two rounds were needed');
        const finished = [...live.entries.values()];
        assert.equal(finished.filter(e => e.status === 'finished').length, 9);
        const survivors = finished.filter(e => e.bustedRound === null);
        assert.ok(survivors.length >= 1 && survivors.length <= 2, 'the final three played to a bust');
        const places = finished.map(e => e.place).sort((a, b) => a - b);
        assert.equal(places[0], 1);
        assert.ok(places.every(p => p >= 1 && p <= 9));
        const prizes = store.state.transactions.filter(tx => tx.type === 'tournament_prize');
        assert.equal(prizes.reduce((sum, tx) => sum + tx.cents, 0), potCents, 'the pot pays out exactly');
        assert.equal(prizes.length, 3);
        const winner = finished.find(e => e.place === 1);
        assert.equal(winner.prizeCents, 450);
        assert.equal(store.state.results.length, 9, 'every entry has a result row');
        assert.equal(store.state.rounds.length, live.round, 'every round was recorded');
        assert.equal(Object.keys(gameService.engines).some(id => id.startsWith('tn-')), false, 'no tournament table is left behind');
        assert.equal(gameService.botSeatLeases.size, 0, 'house players are free again');
        assert.equal(gameService.hasActiveOrPendingGame(), false);
        assert.equal(gameService.isUserSeatedAnywhere(11), false);
        // Money: buy-ins out, prizes in, nothing else.
        const net = store.state.transactions.reduce((sum, tx) => sum + tx.cents, 0);
        assert.equal(net, 0, 'buy-ins and prizes balance to zero');
        pass(`A nine-seat tournament ran ${live.round} rounds to a podium, paid the pot exactly, and cleaned up.`);
    }

    // ----------------------------------------- quitting mid-tournament busts
    {
        const harness = buildHarness({ balances: { 901: 1000, 902: 1000, 903: 1000, 904: 1000, 905: 1000 } });
        const { director } = harness;
        const matt = { id: 11, username: 'Matt', is_vip: true };
        const t = await director.create(matt, { buyInTokens: 1, startingStack: 60, maxSeats: 6, startRule: 'creator' });
        await director.register(t.id, matt);
        for (let i = 0; i < 5; i += 1) await director.findPlayer(t.id, 11);
        await director.start(t.id, 11);
        const live = director.get(t.id);
        await director.quit(t.id, 11);
        const entry = live.entries.get(11);
        assert.equal(entry.quit, true);
        const tableWithMatt = [...live.tables.values()].find(table => table.seats.includes(11));
        const engine = harness.gameService.getEngineById(tableWithMatt.tableId);
        assert.equal(engine.players[11].disconnected, true, 'the house plays out the round for a quitter');
        await playRound(harness, live);
        assert.equal(entry.status, 'busted');
        assert.equal(entry.bustedRound, 1);
        pass('Quitting mid-tournament is a bust at the current place.');
        if (live.status === 'running') await director.voidTournament(t.id, 'done');
    }

    console.log('Tournament director tests passed.');
}

module.exports = runTournamentTests;

if (require.main === module) {
    runTournamentTests().catch(error => { console.error(error); process.exitCode = 1; });
}
