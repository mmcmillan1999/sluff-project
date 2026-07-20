// backend/tests/gameLogic.unit.test.js

const assert = require('assert');
// --- PATH CORRECTION ---
const gameLogic = require('../src/core/logic');

function runGameLogicTests() {
    console.log('Running gameLogic.js tests...');

    let testCounter = 1;
    const pass = (testName) => console.log(`  âœ” Test ${testCounter++}: ${testName}`);

    // --- Trick Winner Tests ---
    const playsTrump = [ { userId: 1, playerName: 'Alice', card: '10H' }, { userId: 2, playerName: 'Bob', card: 'AS' }, { userId: 3, playerName: 'Carol', card: 'KH' }];
    let result = gameLogic.determineTrickWinner(playsTrump, 'H', 'S');
    assert.strictEqual(result.playerName, 'Bob');
    pass('Trump should win trick.');

    const followsSuit = [ { userId: 1, playerName: 'Alice', card: '10H' }, { userId: 2, playerName: 'Bob', card: 'AH' }, { userId: 3, playerName: 'Carol', card: 'KH' }];
    result = gameLogic.determineTrickWinner(followsSuit, 'H', 'S');
    assert.strictEqual(result.playerName, 'Bob');
    pass('Highest of lead suit should win.');

    // --- Payout Tests ---
    const forfeitTable = {
        theme: 'fort-creek',
        players: {
            1: { userId: 1, playerName: 'Alice', isSpectator: false },
            2: { userId: 2, playerName: 'Bob', isSpectator: false },
            3: { userId: 3, playerName: 'Carol', isSpectator: false },
        },
        scores: { 'Alice': 120, 'Bob': 80, 'Carol': 100 }
    };
    let payout = gameLogic.calculateForfeitPayout(forfeitTable, 'Bob');
    assert.strictEqual(payout['Alice'].totalGain.toFixed(3), '1.545');
    pass('Forfeit payout for Alice is correct.');
    assert.strictEqual(payout['Carol'].totalGain.toFixed(3), '1.455');
    pass('Forfeit payout for Carol is correct.');

    const drawTable3Player = {
        theme: 'fort-creek', // Buy-in is 1 token
        players: {
            1: { userId: 1, playerName: 'Alice', isSpectator: false },
            2: { userId: 2, playerName: 'Bob', isSpectator: false },
            3: { userId: 3, playerName: 'Carol', isSpectator: false },
        },
        scores: { 'Alice': 90, 'Bob': 80, 'Carol': 60 }
    };
    let drawResult = gameLogic.calculateDrawSplitPayout(drawTable3Player);
    assert.strictEqual(drawResult.wash, false, '3-player draw with different scores should be a split.');
    pass('Draw Split: Correctly identifies a 3-player split.');
    assert.ok(Math.abs(drawResult.payouts['Carol'].totalReturn - 0.50) < 0.001, 'Lowest player (Carol) should get 50% of buy-in back.');
    pass('Draw Split: Lowest player payout is correct.');
    assert.ok(Math.abs(drawResult.payouts['Alice'].totalReturn - 1.2647) < 0.001, 'Highest player (Alice) share is incorrect.');
    pass('Draw Split: Highest player payout is correct.');
    assert.ok(Math.abs(drawResult.payouts['Bob'].totalReturn - 1.2352) < 0.001, 'Middle player (Bob) share is incorrect.');
    pass('Draw Split: Middle player payout is correct.');

    const drawTable4Player = { ...drawTable3Player, players: {...drawTable3Player.players, 4: {userId: 4, playerName: 'Dave'}}};
    let washResult = gameLogic.calculateDrawSplitPayout(drawTable4Player);
    assert.strictEqual(washResult.wash, true, 'A 4-player game draw should always be a wash.');
    pass('Draw Wash: Correctly identifies a 4-player game as a wash.');
    
    // --- Scoring Tests ---
    const mockScoringTable = {
        playerOrderActive: [1, 2, 3], 
        playerMode: 3,
        players: { 1: { playerName: 'Alice' }, 2: { playerName: 'Bob' }, 3: { playerName: 'Carol' } },
        insurance: { dealExecuted: false, defenderOffers: {} },
        capturedTricks: {},
        originalDealtWidow: []
    };
    
    let succeedResult = gameLogic.calculateRoundScoreDetails({ ...mockScoringTable, bidWinnerInfo: { playerName: 'Alice', bid: 'Solo' }, bidderTotalCardPoints: 70 });
    assert.strictEqual(succeedResult.pointChanges['Alice'], 40);
    pass('Bidder success points correct.');
    assert.strictEqual(succeedResult.pointChanges['Bob'], -20);
    pass('Defender loss points correct.');

    let failResult3Player = gameLogic.calculateRoundScoreDetails({ ...mockScoringTable, bidWinnerInfo: { playerName: 'Alice', bid: 'Solo' }, bidderTotalCardPoints: 50 });
    assert.strictEqual(failResult3Player.pointChanges['Alice'], -60);
    pass('3-player bidder fail points correct.');
    assert.strictEqual(failResult3Player.pointChanges['Bob'], 20);
    pass('3-player defender win points correct.');
    assert.strictEqual(failResult3Player.pointChanges['ScoreAbsorber'], 20);
    pass('3-player ScoreAbsorber points correct.');
    
    // --- THIS IS THE OLD WIDOW LOGIC TEST ---
    const widowPts = 15;
    const mockWidow = ['AC', 'KC']; // Worth 11 + 4 = 15 points
    const baseTrickPoints = 50;

    const hsWinTable = { ...mockScoringTable, bidWinnerInfo: { playerName: 'Alice', bid: 'Heart Solo' }, originalDealtWidow: mockWidow, bidderTotalCardPoints: baseTrickPoints + widowPts };
    let hsWinResult = gameLogic.calculateRoundScoreDetails(hsWinTable);
    assert.strictEqual(hsWinResult.finalBidderPoints, 65, 'HS Win: Bidder points incorrect.');
    pass('Heart Solo: Widow points are correctly assigned.');
    
    const soloTable = { ...mockScoringTable, bidWinnerInfo: { playerName: 'Alice', bid: 'Solo' }, originalDealtWidow: mockWidow, bidderTotalCardPoints: baseTrickPoints + widowPts };
    let soloResult = gameLogic.calculateRoundScoreDetails(soloTable);
    assert.strictEqual(soloResult.finalBidderPoints, 65, 'Solo: Bidder points incorrect.');
    pass('Solo Bid: Widow points go to bidder.');

    // --- THIS IS THE NEW TEST CASE ---
    const mockDiscards = ['AD', 'KD']; // Worth 11 + 4 = 15 points
    const frogTable = { ...mockScoringTable, bidWinnerInfo: { playerName: 'Alice', bid: 'Frog' }, widowDiscardsForFrogBidder: mockDiscards, bidderTotalCardPoints: baseTrickPoints + widowPts };
    let frogResult = gameLogic.calculateRoundScoreDetails(frogTable);
    assert.strictEqual(frogResult.finalBidderPoints, 65, 'Frog: Bidder points incorrect.');
    pass('Frog Bid: Bidder gets points from their discarded cards.');

    // --- Insurance Hindsight Tests ---
    // No deal: hindsight compares the cards against the deal that was on the
    // table (each defender's own final offer; the bidder receives their sum),
    // NOT an even split of the bidder's ask.
    // Solo (x2), ask 40, Bob offered 10, Cara... Carol offered 15 (sum 25,
    // gap 15). Bidder plays it out and wins 68 (+8 diff, exchange 16):
    // Alice +32, Bob -16, Carol -16.
    const noDealTable = {
        ...mockScoringTable,
        insurance: {
            dealExecuted: false,
            isActive: true,
            bidMultiplier: 2,
            bidderPlayerName: 'Alice',
            bidderRequirement: 40,
            defenderOffers: { Bob: 10, Carol: 15 },
        },
        bidWinnerInfo: { playerName: 'Alice', bid: 'Solo' },
        bidderTotalCardPoints: 68,
        bidderCardPoints: 68,
    };
    let noDealResult = gameLogic.calculateRoundScoreDetails(noDealTable);
    assert.strictEqual(noDealResult.pointChanges['Alice'], 32, 'No-deal: bidder actual points incorrect.');
    // Alice: actual +32 vs declined offers of 25 -> playing on earned +7.
    assert.strictEqual(noDealResult.insuranceHindsight['Alice'].hindsightValue, 7, 'No-deal: bidder hindsight must compare against the sum of offers.');
    pass('Insurance hindsight (no deal): bidder measured against the declined offers.');
    // Bob: actual -16 vs his own offer of -10 -> the deal would have saved 6.
    assert.strictEqual(noDealResult.insuranceHindsight['Bob'].hindsightValue, -6, 'No-deal: Bob hindsight must use his own offer.');
    // Carol: actual -16 vs her offer of -15 -> the deal would have saved 1.
    assert.strictEqual(noDealResult.insuranceHindsight['Carol'].hindsightValue, -1, 'No-deal: Carol hindsight must use her own offer.');
    pass('Insurance hindsight (no deal): defenders measured against their own offers, not an even split.');

    // Deal executed, bidder would have FAILED: the played-out downside for the
    // bidder includes the widow/absorber share (3x exchange in 3-player).
    // Deal: Alice settles for 20 (Bob 8, Carol 12). Cards would have scored
    // bidder 50 (-10 diff, exchange 20): Alice would be -60, defenders +20.
    const dealMadeTable = {
        ...mockScoringTable,
        insurance: {
            dealExecuted: true,
            isActive: true,
            bidMultiplier: 2,
            bidderPlayerName: 'Alice',
            bidderRequirement: 20,
            defenderOffers: { Bob: 8, Carol: 12 },
            executedDetails: {
                agreement: {
                    bidderPlayerName: 'Alice',
                    bidderRequirement: 20,
                    bidderSettlement: 20,
                    defenderOffers: { Bob: 8, Carol: 12 },
                },
            },
        },
        bidWinnerInfo: { playerName: 'Alice', bid: 'Solo' },
        bidderTotalCardPoints: 50,
        bidderCardPoints: 50,
    };
    let dealMadeResult = gameLogic.calculateRoundScoreDetails(dealMadeTable);
    assert.strictEqual(dealMadeResult.pointChanges['Alice'], 20, 'Deal-made: bidder settlement incorrect.');
    // Alice: deal +20 vs playing out -60 (2 defenders + absorber at 20 each)
    // -> the deal saved 80.
    assert.strictEqual(dealMadeResult.insuranceHindsight['Alice'].hindsightValue, 80, 'Deal-made: bidder failure potential must include the absorber share (3x exchange).');
    pass('Insurance hindsight (deal made): failed-bid potential includes the widow/absorber share.');
    // Bob: deal -8 vs playing out +20 -> the deal cost him 28.
    assert.strictEqual(dealMadeResult.insuranceHindsight['Bob'].hindsightValue, -28, 'Deal-made: defender hindsight incorrect.');
    pass('Insurance hindsight (deal made): defender comparison correct.');

    console.log('\n  âœ” All gameLogic.js tests passed!');
}

if (require.main === module) {
    runGameLogicTests();
}

module.exports = runGameLogicTests;