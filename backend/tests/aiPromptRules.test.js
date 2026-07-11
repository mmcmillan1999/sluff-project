const assert = require('assert');
const aiService = require('../src/services/aiService');
const SuperBot = require('../src/core/SuperBot');
const { BID_HIERARCHY, BID_MULTIPLIERS } = require('../src/core/constants');

function testBidRulePrompts() {
    const systemPrompt = aiService._getSystemPrompt('bid');
    const decisionPrompt = aiService._buildBidPrompt({
        myHand: ['AH', '10H', 'KS'],
        scores: { Alice: 120, Bob: 120, Cara: 120 },
    }, null, null);
    const combined = `${systemPrompt}\n${decisionPrompt}`;

    assert.match(combined, new RegExp(`Bid order \\(lowest to highest\\): ${BID_HIERARCHY.join(' < ')}`));
    assert.match(combined, /Frog \(1x\): Take the 3-card widow, (?:then )?discard exactly 3 cards;? (?:and play with )?hearts (?:are|as) trump/i);
    assert.match(combined, /Solo \(2x\): Choose diamonds, clubs, or spades as trump; the bidder receives the widow points/i);
    assert.match(combined, /Heart Solo \(3x\): Hearts are trump; the (?:team that wins the last trick|last-trick winner's team) receives the widow points/i);
    assert.match(decisionPrompt, /VALID BIDS .*Pass, Frog, Solo, Heart Solo/i);

    assert.doesNotMatch(combined, /Solo=1x/i);
    assert.doesNotMatch(combined, /Frog=2x/i);
    assert.doesNotMatch(combined, /Solo\/Frog: You pick trump/i);
    assert.doesNotMatch(combined, /Frog: Higher bid/i);
}

function testDeckAndRoundPromptFacts() {
    const cardSystemPrompt = aiService._getSystemPrompt('card');
    assert.match(cardSystemPrompt, /"card": "6S"/);
    assert.doesNotMatch(cardSystemPrompt, /"card": "3S"/);

    const cardPrompt = aiService._buildCardPrompt({
        myName: 'Alice',
        myHand: ['6S'],
        currentTrick: [],
        trumpSuit: 'H',
        leadSuit: null,
        playedCards: [],
        scores: {},
        trickNumber: 1,
        capturedTricksCount: {},
        pointsCaptured: {},
        seatPosition: 'bidder',
        insurance: {},
        bidder: 'Alice',
        suitTracking: {},
        remainingHighCards: {},
    }, ['6S']);
    assert.match(cardPrompt, /Trick 1\/11/);
    assert.doesNotMatch(cardPrompt, /Trick 1\/13/);
}

function makeInsuranceState(bidType) {
    return {
        myHand: ['AH', '10H'],
        scores: { Alice: 120, Bob: 120, Cara: 120 },
        bidder: 'Alice',
        bidType,
        insurance: {},
        capturedTricksCount: { Alice: 1, Bob: 0, Cara: 0 },
        pointsCaptured: { Alice: 30, Bob: 10, Cara: 0 },
        trickNumber: 2,
        seatPosition: 'bidder',
        myName: 'Alice',
        remainingHighCards: {},
    };
}

function testInsuranceRulePrompts() {
    const systemPrompt = aiService._getSystemPrompt('insurance');
    const multiplierText = Object.entries(BID_MULTIPLIERS)
        .map(([bid, multiplier]) => `${bid}=${multiplier}x`)
        .join(', ');

    assert.match(systemPrompt, /locks immediately and unconditionally when combined defender offers meet or exceed the bidder requirement/i);
    assert.match(systemPrompt, /regardless of the card result/i);
    assert.match(systemPrompt, /replace the normal round score exchange/i);
    assert.ok(systemPrompt.includes(`Bid Multipliers: ${multiplierText}`));
    assert.doesNotMatch(systemPrompt, /Solo=1x/i);
    assert.doesNotMatch(systemPrompt, /Frog=2x/i);
    assert.doesNotMatch(systemPrompt, /If bidder WINS: Defenders pay/i);
    assert.doesNotMatch(systemPrompt, /If bidder LOSES: Bidder pays/i);
    assert.match(systemPrompt, /Positive defender offer = defender pays those points to the bidder/i);
    assert.match(systemPrompt, /Negative defender offer = defender asks the bidder to pay them/i);
    assert.match(systemPrompt, /signed engine values/i);
    assert.doesNotMatch(systemPrompt, /caller converts these positive strategy amounts/i);

    const expectedProjectedChanges = {
        Frog: 60,
        Solo: 120,
        'Heart Solo': 180,
    };
    for (const [bidType, multiplier] of Object.entries(BID_MULTIPLIERS)) {
        const prompt = aiService._buildInsurancePrompt(makeInsuranceState(bidType));
        assert.match(prompt, new RegExp(`Bid multiplier: ${multiplier}x`));
        assert.match(prompt, /Trick 2\/11/);
        assert.match(prompt, new RegExp(`Projected normal score exchange: \\+${expectedProjectedChanges[bidType]} points`));
        assert.match(prompt, /locked insurance deal replaces that result.*regardless of who wins/i);
        assert.match(prompt, /combined defender offers meet or exceed your requirement/i);
    }

    const defenderPrompt = aiService._buildInsurancePrompt({
        ...makeInsuranceState('Solo'),
        myName: 'Bob',
        seatPosition: 'defender',
    });
    assert.match(defenderPrompt, /Positive offers pay the bidder; negative offers ask the bidder to pay you/i);
}

function makeSuperBotEngine(playerName, bidderName, multiplier = 2) {
    return {
        hands: { [playerName]: ['AS'] },
        insurance: {
            isActive: true,
            bidMultiplier: multiplier,
            bidderPlayerName: bidderName,
            bidderRequirement: 0,
            defenderOffers: {},
            dealExecuted: false,
        },
        bidWinnerInfo: { playerName: bidderName, bid: 'Solo' },
        currentHighestBidDetails: null,
    };
}

function stubGameState(bot, bidderName) {
    bot._buildGameState = () => ({
        myHand: ['AS'],
        scores: {},
        pointsCaptured: {},
        capturedTricksCount: {},
        bidder: bidderName,
        bidType: 'Solo',
        trickNumber: 1,
    });
}

async function testSuperBotUsesCanonicalSignedValues() {
    const originalInsuranceDecision = aiService.getInsuranceDecision;
    const originalBidDecision = aiService.getBidDecision;
    const originalLog = console.log;
    let insuranceDecision;

    console.log = () => {};
    aiService.getInsuranceDecision = async () => insuranceDecision;
    try {
        const defender = new SuperBot(-1, 'Defender', makeSuperBotEngine('Defender', 'Bidder'));
        stubGameState(defender, 'Bidder');

        insuranceDecision = { offer: 75, requirement: 0, reasoning: 'pay for certainty' };
        assert.deepEqual(
            await defender.makeInsuranceDecision(),
            { offer: 75, requirement: 0 },
            'positive defender offers must stay positive so they can close the deal gap',
        );

        insuranceDecision = { offer: -500, requirement: 0, reasoning: 'ask to be paid' };
        assert.deepEqual(
            await defender.makeInsuranceDecision(),
            { offer: -120, requirement: 0 },
            'negative defender offers keep their sign and clamp to -60 times the multiplier',
        );

        const bidder = new SuperBot(-2, 'Bidder', makeSuperBotEngine('Bidder', 'Bidder'));
        stubGameState(bidder, 'Bidder');
        insuranceDecision = { offer: 0, requirement: -500, reasoning: 'accept a payment' };
        assert.deepEqual(
            await bidder.makeInsuranceDecision(),
            { offer: 0, requirement: -240 },
            'bidder requirements use the engine signed range',
        );

        const biddingEngine = makeSuperBotEngine('BidBot', 'Other');
        biddingEngine.currentHighestBidDetails = { bid: 'Frog' };
        const bidBot = new SuperBot(-3, 'BidBot', biddingEngine);
        stubGameState(bidBot, 'Other');
        let validBids;
        aiService.getBidDecision = async (_model, _state, _currentBid, options) => {
            validBids = options;
            return { bid: 'Solo', reasoning: 'canonical next bid' };
        };
        assert.equal(await bidBot.decideBid(), 'Solo');
        assert.deepEqual(validBids, ['Pass', 'Solo', 'Heart Solo']);
    } finally {
        aiService.getInsuranceDecision = originalInsuranceDecision;
        aiService.getBidDecision = originalBidDecision;
        console.log = originalLog;
    }
}

async function runAiPromptRuleTests() {
    testDeckAndRoundPromptFacts();
    testBidRulePrompts();
    testInsuranceRulePrompts();
    await testSuperBotUsesCanonicalSignedValues();
    console.log('AI prompt rule-contract tests passed.');
}

if (require.main === module) {
    runAiPromptRuleTests().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = runAiPromptRuleTests;
