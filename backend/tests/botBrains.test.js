// backend/tests/botBrains.test.js
//
// Brain profiles for the card-play A/B: the classic brain stays locked as
// the control (bot.test.js pins its exact behavior), the counting brain
// carries Matt's rules — cheapest-sufficient wins gated on later safety,
// real overruffs, any-seat schmears on a secure boss, and a full played-card
// memory built strictly from public information.

const assert = require('assert');
const BotPlayer = require('../src/core/BotPlayer');
const { brainNameFor, BRAIN_PROFILES } = require('../src/core/bot-brains');

// A fuller mock than bot.test.js uses: the counting brain reads the public
// round view, which wants seats, trick attribution, and captured tricks.
const NAMES = ['Bidder', 'Ally', 'Me'];
function makeEngine({
    myName = 'Me',
    myHand,
    bidderName = 'Bidder',
    bid = 'Solo',
    trumpSuit = 'H',
    trumpBroken = true,
    capturedTricks = {},
    currentTrickCards = [],
    trickLeaderName = null,
    tricksPlayedCount = 0,
} = {}) {
    const ids = { Bidder: 1, Ally: 2, Me: 3 };
    const players = {};
    NAMES.forEach(name => { players[ids[name]] = { userId: ids[name], playerName: name, isBot: true }; });
    const leadSuit = currentTrickCards.length
        ? currentTrickCards[0].card.slice(-1)
        : null;
    return {
        players,
        playerOrder: { turnOrder: NAMES.map(n => ids[n]) },
        playerMode: 3,
        state: 'Playing Phase',
        bidWinnerInfo: { userId: ids[bidderName], playerName: bidderName, bid },
        trumpSuit,
        trumpBroken,
        hands: { [myName]: myHand },
        capturedTricks,
        currentTrickCards,
        leadSuitCurrentTrick: leadSuit,
        lastCompletedTrick: null,
        tricksPlayedCount,
        bidderCardPoints: 0,
        defenderCardPoints: 0,
        trickLeaderId: ids[trickLeaderName || (currentTrickCards[0]?.playerName ?? myName)],
        revealedWidowForFrog: [],
        widowDiscardsForFrogBidder: [],
        scores: { Bidder: 120, Ally: 120, Me: 120, ScoreAbsorber: 120 },
        insurance: { isActive: false },
    };
}

// Rebuild an engine where the counting-brain bot occupies the "Me" seat but
// carries a trial-roster name so brain resolution picks 'counting'.
function makeCountingEngine(options) {
    const engine = makeEngine(options);
    engine.players[3] = { userId: 3, playerName: 'Kimba', isBot: true };
    engine.hands = { 'Kimba': options.myHand };
    if (engine.bidWinnerInfo.playerName === 'Me') engine.bidWinnerInfo.playerName = 'Kimba';
    return engine;
}

async function runBotBrainTests() {
    console.log('Running bot brain profile tests...');
    let testCounter = 1;
    const pass = (name) => console.log(`  ✔ Test ${testCounter++}: ${name}`);

    // 1) Profile resolution: the trial trio counts cards, everyone else is classic.
    {
        assert.strictEqual(brainNameFor('Kimba'), 'counting');
        assert.strictEqual(brainNameFor('Grampa Blane'), 'counting');
        assert.strictEqual(brainNameFor('Courtney Sr.'), 'counting');
        assert.strictEqual(brainNameFor('Ace McGraw'), 'classic');
        assert.strictEqual(brainNameFor('TestBot'), 'classic');
        assert.strictEqual(Object.keys(BRAIN_PROFILES).length, 6);
        pass('Grampa Blane, Courtney Sr., and Kimba carry the counting brain; the rest stay classic.');
    }

    // 2) Matt's overruff rule: partner led, the bid winner trumped with the
    //    queen — never slide the 6 of trump under it while holding the king.
    {
        const engine = makeCountingEngine({
            myHand: ['KH', '6H', 'AS'],
            currentTrickCards: [
                { userId: 2, playerName: 'Ally', card: 'KD' },
                { userId: 1, playerName: 'Bidder', card: 'QH' },
            ],
            trickLeaderName: 'Ally',
        });
        const bot = new BotPlayer(3, 'Kimba', engine);
        assert.strictEqual(bot.playCard(), 'KH');
        pass('Overruffs the bidder’s queen with the king instead of bleeding the 6.');
    }

    // 3) Cheapest sufficient card when the bigger winner stays safe: fresh
    //    round, every suit still full — the jack takes it, the ace waits.
    {
        const engine = makeCountingEngine({
            myHand: ['AD', 'JD', '6C'],
            currentTrickCards: [{ userId: 1, playerName: 'Bidder', card: '9D' }],
            trickLeaderName: 'Bidder',
        });
        const bot = new BotPlayer(3, 'Kimba', engine);
        assert.strictEqual(bot.playCard(), 'JD');
        pass('Wins with the cheapest sufficient card while the ace stays safe for later.');
    }

    // 4) The IF: diamonds have run dry — outside this trick, every diamond
    //    left in the game is in the bot's own hand, so a saved 10 can only
    //    die to a ruff on some later trick. Bank it now, while it wins.
    //    (History: tricks 1–2 burned A,K,7,Q,6 of diamonds with everyone
    //    following; the current trick shows the last two others.)
    {
        const engine = makeCountingEngine({
            myHand: ['10D', 'JD', '6C'],
            capturedTricks: {
                Bidder: [
                    { trickNumber: 1, cards: ['AD', 'KD', '7D'], winnerName: 'Bidder' },
                    { trickNumber: 2, cards: ['QD', '6D', '9C'], winnerName: 'Bidder' },
                ],
            },
            tricksPlayedCount: 2,
            currentTrickCards: [
                { userId: 2, playerName: 'Ally', card: '8D' },
                { userId: 1, playerName: 'Bidder', card: '9D' },
            ],
            trickLeaderName: 'Ally',
        });
        const bot = new BotPlayer(3, 'Kimba', engine);
        assert.strictEqual(bot.playCard(), '10D');
        pass('Banks the endangered 10 while it wins, once its suit cannot be cashed later.');
    }

    // 5) Any-seat schmear: partner leads the boss card with the bot in
    //    SECOND seat (classic only schmears from third) — load the points.
    {
        const engine = makeCountingEngine({
            myHand: ['10S', '7S', '6C'],
            capturedTricks: {
                Ally: [{ trickNumber: 1, cards: ['AS', 'KS', '9S'], winnerName: 'Ally' }],
            },
            tricksPlayedCount: 1,
            // Ally now leads the QUEEN of spades — boss, because A and K
            // fell on trick one.
            currentTrickCards: [{ userId: 2, playerName: 'Ally', card: 'QS' }],
            trickLeaderName: 'Ally',
        });
        const bot = new BotPlayer(3, 'Kimba', engine);
        assert.strictEqual(bot.playCard(), '10S');
        pass('Second-seat schmear: the 10 rides the partner’s boss queen.');
    }

    // 6) Losing forced-trump never dumps the trump 10 (classic's reflex):
    //    bidder's ace of trump is winning; shed the small trump, keep the 10.
    {
        const engine = makeCountingEngine({
            myHand: ['10H', '6H', '7H'],
            currentTrickCards: [
                { userId: 2, playerName: 'Ally', card: 'KD' },
                { userId: 1, playerName: 'Bidder', card: 'AH' },
            ],
            trickLeaderName: 'Ally',
        });
        const bot = new BotPlayer(3, 'Kimba', engine);
        assert.strictEqual(bot.playCard(), '6H');
        pass('Never feeds the trump 10 to a trick the bidder already owns.');
    }

    // 7) Midnight mechanics: trump exhausted and holding the boss run — cash
    //    the controlled suit from the top instead of leading junk.
    {
        // All 9 hearts (trump) are gone: 3 in each of three captured tricks.
        const heartsOut = [
            { trickNumber: 1, cards: ['AH', 'KH', '6H'], winnerName: 'Kimba' },
            { trickNumber: 2, cards: ['10H', 'QH', '7H'], winnerName: 'Kimba' },
            { trickNumber: 3, cards: ['JH', '9H', '8H'], winnerName: 'Kimba' },
        ];
        const engine = makeCountingEngine({
            myHand: ['AS', '10S', 'JS', '6D'],
            capturedTricks: { Kimba: heartsOut },
            tricksPlayedCount: 3,
            currentTrickCards: [],
            trickLeaderName: 'Me',
        });
        engine.trickLeaderId = 3;
        const bot = new BotPlayer(3, 'Kimba', engine);
        assert.strictEqual(bot.playCard(), 'AS');
        pass('With trump bled dry, runs the controlled suit top-down (the Midnight Special, mechanically).');
    }

    // --- The flytrap profile: counting + the Venus-flytrap-of-10s rule ---

    // Rebuild the "Me" seat under a flytrap-roster name.
    const makeFlytrapEngine = (options) => {
        const engine = makeEngine(options);
        engine.players[3] = { userId: 3, playerName: 'Mike Knight', isBot: true };
        engine.hands = { 'Mike Knight': options.myHand };
        return engine;
    };

    // 9) Roster: Mike Knight, Dolly Deal, Rosie Rounds run the flytrap.
    {
        assert.strictEqual(brainNameFor('Mike Knight'), 'flytrap');
        assert.strictEqual(brainNameFor('Dolly Deal'), 'flytrap');
        assert.strictEqual(brainNameFor('Rosie Rounds'), 'flytrap');
        pass('Mike Knight, Dolly Deal, and Rosie Rounds carry the flytrap brain.');
    }

    // 10) The bait: first spade trick ever, a low-looking JS lead, and the
    //     bot holds A-9. Counting spends the Ace (its only winner); the
    //     flytrap declines with the 9 and keeps the Ace loaded for the 10.
    {
        const scenario = {
            myHand: ['AS', '9S', '6C'],
            currentTrickCards: [{ userId: 1, playerName: 'Bidder', card: 'JS' }],
            trickLeaderName: 'Bidder',
        };
        const countingEngine = makeCountingEngine(scenario);
        assert.strictEqual(new BotPlayer(3, 'Kimba', countingEngine).playCard(), 'AS');
        const flytrapEngine = makeFlytrapEngine(scenario);
        assert.strictEqual(new BotPlayer(3, 'Mike Knight', flytrapEngine).playCard(), '9S');
        pass('Flytrap refuses the first-trick bait that counting falls for.');
    }

    // 11) Stand-down: the 10 is already on the table — the Ace eats it now.
    {
        const engine = makeFlytrapEngine({
            myHand: ['AS', '9S', '6C'],
            currentTrickCards: [
                { userId: 2, playerName: 'Ally', card: '7S' },
                { userId: 1, playerName: 'Bidder', card: '10S' },
            ],
            trickLeaderName: 'Ally',
        });
        assert.strictEqual(new BotPlayer(3, 'Mike Knight', engine).playCard(), 'AS');
        pass('The trap stands down when the 10 shows itself — the Ace takes it.');
    }

    // 12) Stand-down: the suit has been played before — normal counting play.
    {
        const engine = makeFlytrapEngine({
            myHand: ['AS', '9S', '6C'],
            capturedTricks: {
                Bidder: [{ trickNumber: 1, cards: ['KS', 'QS', '8S'], winnerName: 'Bidder' }],
            },
            tricksPlayedCount: 1,
            currentTrickCards: [{ userId: 1, playerName: 'Bidder', card: 'JS' }],
            trickLeaderName: 'Bidder',
        });
        assert.strictEqual(new BotPlayer(3, 'Mike Knight', engine).playCard(), 'AS');
        pass('Once the suit has already been seen, the exception never fires.');
    }

    // 13) Stand-down: holding the 10 alongside the Ace disarms the bait
    //     ("King and under" excludes the 10 by rank), and a long suit
    //     (three-plus support) fights normally too.
    {
        const withTen = makeFlytrapEngine({
            myHand: ['AS', '10S', '6C'],
            currentTrickCards: [{ userId: 1, playerName: 'Bidder', card: 'JS' }],
            trickLeaderName: 'Bidder',
        });
        // Counting logic: cheapest sufficient winner is the 10.
        assert.strictEqual(new BotPlayer(3, 'Mike Knight', withTen).playCard(), '10S');

        const longSuit = makeFlytrapEngine({
            myHand: ['AS', 'KS', 'QS', '8S'],
            currentTrickCards: [{ userId: 1, playerName: 'Bidder', card: '7S' }],
            trickLeaderName: 'Bidder',
        });
        assert.strictEqual(new BotPlayer(3, 'Mike Knight', longSuit).playCard(), '8S');
        pass('Holding the 10 or a long suit disarms the trap; counting logic resumes.');
    }

    // 8) The classic brain is untouched by all of the above: same overruff
    //    scenario, classic bot still bleeds the low trump (locked behavior).
    {
        const engine = makeEngine({
            myHand: ['KH', '6H', 'AS'],
            currentTrickCards: [
                { userId: 2, playerName: 'Ally', card: 'KD' },
                { userId: 1, playerName: 'Bidder', card: 'QH' },
            ],
            trickLeaderName: 'Ally',
        });
        const bot = new BotPlayer(3, 'Me', engine);
        assert.strictEqual(bot.playCard(), '6H');
        pass('Classic control group still plays its locked (leaky) line.');
    }

    console.log('All bot brain profile tests passed!');
}

if (require.main === module) {
    runBotBrainTests().catch(error => { console.error(error); process.exitCode = 1; });
}

module.exports = runBotBrainTests;
